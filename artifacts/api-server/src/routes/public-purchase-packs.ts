/**
 * public-purchase-packs.ts — Git #1316 (Phase 7 of Epic #1309)
 *
 * The REAL approve/dry-run review → real execute stage behind Buy.tsx's pack
 * checkout. Three session-keyed public endpoints:
 *
 *   GET  /api/public/purchase/pack-dry-run?sessionId=
 *        The real dry-run: every write each PAID pack will perform, resolved
 *        through the engine's own substitution (config-pack-dry-run.ts) with
 *        the ACTUAL current tenant value read live via graphFetchForTenant —
 *        replaces the marketing fixture's authored before/after values.
 *
 *   POST /api/public/purchase/pack-execute { sessionId }
 *        Fires the purchased packs through the REAL engine
 *        (config-pack-orchestrator.ts → fireWorkflowForDefinition → real Graph
 *        writes). Idempotent per (session, pack) via wf_runs.trigger_ref.
 *
 *   GET  /api/public/purchase/pack-run-status?sessionId=
 *        Real run progress for the executing/executed UI, read from wf_runs +
 *        wf_run_node_outputs — per-step ok/error/pending and the verification-
 *        gate pause state.
 *
 * Ordering gates, all fail-closed and all server-resolved (never caller input):
 *   1. live (unexpired) checkout session;
 *   2. session status "paid" — payment really landed (#1307);
 *   3. READ consent granted for the session's own tenant (#432/#1311);
 *   4. WRITE consent granted for that tenant (#1312's separate write app);
 *   5. the paid pack set = the session's own product + the packSlugs recorded
 *      server-side at payment confirmation (audit row written by
 *      public-purchase-payment.ts from the intent's server-written metadata);
 *   6. EXECUTE additionally requires the pack key to be in
 *      SELF_EXECUTABLE_PACK_KEYS — the explicit confirmed-real allowlist.
 *
 * SELF_EXECUTABLE_PACK_KEYS is deliberately an allowlist, not a derived check
 * (#1316's instruction, cross-checking #1304's real/not-real availability
 * gating): #1304/#1307 already prevent a not-yet-real pack (MFA Enforcement,
 * Oversharing, Copilot Readiness — no catalog row at all) from ever being
 * bought, but "has a priced catalog row" is a LOWER bar than "every variable
 * the pack's templates need is derivable from a checkout session". Today only
 * quickstart-v1 meets the higher bar (proven end-to-end against the testbed
 * tenant this build); the other packs need per-entity operator input (userId,
 * skuId, …) and are refused pack_not_self_executable until each is proven and
 * added here. The dry-run endpoint reports the same fact honestly via
 * `executable` / `missingOperatorVariables` per pack.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  servicesTable,
  tenantsTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfVersionsTable,
  type WfGraph,
} from "@workspace/db";
import { resolveFlowSession, resolveConsentedTenant, type FlowSession } from "./consent";
import { resolveServiceExecutable } from "../lib/remediation-catalog";
import { buildConfigPackDryRun, type ConfigPackDryRun } from "../lib/config-pack-dry-run";
import { ConfigPackError, runConfigPackForCustomer } from "../lib/config-pack-orchestrator";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.config-pack" });

const router: IRouter = Router();

/**
 * The confirmed-real, self-executable pack allowlist (see file header). Add a
 * pack key ONLY after a real end-to-end run against a test tenant has proven
 * every required variable resolves and the materialized workflow executes.
 */
export const SELF_EXECUTABLE_PACK_KEYS: ReadonlySet<string> = new Set(["quickstart-v1"]);

const runTriggerRef = (sessionId: string, packKey: string): string =>
  `purchase:${sessionId}:pack:${packKey}`;

interface PaidPack {
  serviceSlug: string;
  serviceName: string;
  priceCents: number | null;
  packKey: string | null;
}

interface PackFlowContext {
  session: FlowSession;
  customer: { id: number; tenantId: string };
  tenantDomain: string | null;
  packs: PaidPack[];
}

/**
 * Resolve + gate the whole pack flow (steps 1–5 in the file header). Responds
 * and returns null on every refusal so handlers can `if (!ctx) return;`.
 */
async function resolvePackFlow(rawSessionId: unknown, res: Response): Promise<PackFlowContext | null> {
  const session = await resolveFlowSession(rawSessionId, res);
  if (!session) return null;

  if (session.status !== "paid") {
    res.status(409).json({ error: "payment_required" });
    return null;
  }

  const customer = await resolveConsentedTenant(session, res);
  if (!customer) return null;

  const [tenantRow] = await db
    .select({ consent: tenantsTable.consent, domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customer.id))
    .limit(1);
  if (tenantRow?.consent?.writeBack?.status !== "granted") {
    res.status(409).json({ error: "write_consent_required" });
    return null;
  }

  // The paid pack set: the session's own product plus the extra packSlugs the
  // payment-confirmed handler recorded server-side (from the intent's own
  // server-written metadata — the record of WHAT was bought, #1307).
  const [paidAudit] = await db
    .select({ metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.actionType, "purchase_flow_payment_succeeded"),
        eq(auditLogsTable.entityType, "checkout_session"),
        eq(auditLogsTable.entityId, session.id),
      ),
    )
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(1);
  const auditSlugs = Array.isArray(paidAudit?.metadata?.["packSlugs"])
    ? (paidAudit.metadata["packSlugs"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const slugs = [...new Set([session.productSlug, ...auditSlugs])];

  const services = await db
    .select({
      slug: servicesTable.slug,
      name: servicesTable.name,
      category: servicesTable.category,
      priceCents: servicesTable.priceCents,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(servicesTable)
    .where(inArray(servicesTable.slug, slugs));

  const bySlug = new Map(services.map((s) => [s.slug, s]));
  const sessionService = bySlug.get(session.productSlug);
  if (!sessionService || sessionService.category !== "config_pack") {
    // Monitoring / Retainer / assessment sessions have no pack stage at all.
    res.status(409).json({ error: "packs_not_applicable" });
    return null;
  }

  const packs: PaidPack[] = [];
  for (const slug of slugs) {
    const service = bySlug.get(slug);
    if (!service || service.category !== "config_pack") {
      log.warn(
        { sessionId: session.id, slug },
        "purchase packs: paid slug does not resolve to a real config_pack catalog row — excluded",
      );
      continue;
    }
    const resolved = resolveServiceExecutable(service);
    packs.push({
      serviceSlug: slug,
      serviceName: service.name,
      priceCents: service.priceCents,
      packKey: resolved.kind === "config_pack" ? resolved.packKey : null,
    });
  }

  if (packs.length === 0) {
    res.status(409).json({ error: "packs_not_applicable" });
    return null;
  }

  return { session, customer, tenantDomain: tenantRow.domain, packs };
}

const packErrorBody = (err: ConfigPackError) => ({
  code: err.code,
  message: err.message,
  ...(err.details ?? {}),
});

// ── GET /api/public/purchase/pack-dry-run ─────────────────────────────────────

router.get("/public/purchase/pack-dry-run", async (req: Request, res: Response) => {
  const ctx = await resolvePackFlow(req.query.sessionId, res);
  if (!ctx) return;

  const results: Array<
    | ({ serviceSlug: string; serviceName: string; priceCents: number | null } & ConfigPackDryRun)
    | {
        serviceSlug: string;
        serviceName: string;
        priceCents: number | null;
        packKey: string | null;
        executable: false;
        error: { code: string; message: string };
      }
  > = [];

  for (const pack of ctx.packs) {
    if (!pack.packKey) {
      results.push({
        serviceSlug: pack.serviceSlug,
        serviceName: pack.serviceName,
        priceCents: pack.priceCents,
        packKey: null,
        executable: false,
        error: { code: "pack_unwired", message: "This product is not wired to an executable pack yet" },
      });
      continue;
    }
    try {
      const dryRun = await buildConfigPackDryRun(pack.packKey, ctx.customer.id);
      results.push({
        serviceSlug: pack.serviceSlug,
        serviceName: pack.serviceName,
        priceCents: pack.priceCents,
        ...dryRun,
      });
    } catch (err) {
      if (err instanceof ConfigPackError) {
        results.push({
          serviceSlug: pack.serviceSlug,
          serviceName: pack.serviceName,
          priceCents: pack.priceCents,
          packKey: pack.packKey,
          executable: false,
          error: packErrorBody(err),
        });
        continue;
      }
      log.error({ err, sessionId: ctx.session.id, packKey: pack.packKey }, "purchase packs: dry-run failed");
      res.status(500).json({ error: "dry_run_failed" });
      return;
    }
  }

  log.info(
    { sessionId: ctx.session.id, packCount: results.length },
    "purchase packs: real dry-run served",
  );
  res.json({
    sessionId: ctx.session.id,
    tenantDomain: ctx.tenantDomain,
    packs: results,
  });
});

// ── POST /api/public/purchase/pack-execute ────────────────────────────────────

const executeBodySchema = z.object({ sessionId: z.string() });

router.post("/public/purchase/pack-execute", async (req: Request, res: Response) => {
  const parsed = executeBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "session_invalid" });
    return;
  }
  const ctx = await resolvePackFlow(parsed.data.sessionId, res);
  if (!ctx) return;

  const results: Array<{
    serviceSlug: string;
    packKey: string | null;
    runId?: number;
    gated?: boolean;
    alreadyStarted?: boolean;
    refused?: { code: string; message: string };
  }> = [];

  for (const pack of ctx.packs) {
    if (!pack.packKey || !SELF_EXECUTABLE_PACK_KEYS.has(pack.packKey)) {
      results.push({
        serviceSlug: pack.serviceSlug,
        packKey: pack.packKey,
        refused: {
          code: "pack_not_self_executable",
          message:
            "This pack is fulfilled by your architect rather than executed automatically — it is not on the self-executable allowlist yet",
        },
      });
      continue;
    }

    const triggerRef = runTriggerRef(ctx.session.id, pack.packKey);

    // Idempotency: one live run per (session, pack). A failed or cancelled
    // run may be re-fired; anything else is returned as-is.
    const [existing] = await db
      .select({ id: wfRunsTable.id, status: wfRunsTable.status })
      .from(wfRunsTable)
      .where(eq(wfRunsTable.triggerRef, triggerRef))
      .orderBy(desc(wfRunsTable.id))
      .limit(1);
    if (existing && existing.status !== "failed" && existing.status !== "cancelled") {
      results.push({
        serviceSlug: pack.serviceSlug,
        packKey: pack.packKey,
        runId: existing.id,
        alreadyStarted: true,
      });
      continue;
    }

    try {
      const run = await runConfigPackForCustomer({
        packKey: pack.packKey,
        customerId: ctx.customer.id,
        triggeredBy: triggerRef,
        purchaseAuthorization: { checkoutSessionId: ctx.session.id },
      });
      results.push({
        serviceSlug: pack.serviceSlug,
        packKey: pack.packKey,
        runId: run.runId,
        gated: run.gated,
      });
      await createAuditLog({
        actorUserId: null,
        actorName: "public:purchase-flow",
        actorRole: "client",
        actionType: "purchase_flow_pack_execute_fired",
        entityType: "checkout_session",
        entityId: ctx.session.id,
        metadata: {
          packKey: pack.packKey,
          serviceSlug: pack.serviceSlug,
          runId: run.runId,
          definitionId: run.definitionId,
          versionId: run.versionId,
          gated: run.gated,
          customerId: ctx.customer.id,
        },
      });
      log.info(
        { sessionId: ctx.session.id, packKey: pack.packKey, runId: run.runId, customerId: ctx.customer.id },
        "purchase packs: REAL pack execution fired from paid checkout session",
      );
    } catch (err) {
      if (err instanceof ConfigPackError) {
        log.warn(
          { sessionId: ctx.session.id, packKey: pack.packKey, code: err.code },
          "purchase packs: execution refused",
        );
        results.push({ serviceSlug: pack.serviceSlug, packKey: pack.packKey, refused: packErrorBody(err) });
        continue;
      }
      log.error({ err, sessionId: ctx.session.id, packKey: pack.packKey }, "purchase packs: execution failed");
      res.status(500).json({ error: "execute_failed" });
      return;
    }
  }

  const anyFired = results.some((r) => r.runId !== undefined);
  res.status(anyFired ? 202 : 409).json({ sessionId: ctx.session.id, results });
});

// ── GET /api/public/purchase/pack-run-status ──────────────────────────────────

const WRITE_NODE_TYPES = new Set(["execute_baseline_template", "execute_monitor_check"]);

router.get("/public/purchase/pack-run-status", async (req: Request, res: Response) => {
  const ctx = await resolvePackFlow(req.query.sessionId, res);
  if (!ctx) return;

  const packs: Array<{
    serviceSlug: string;
    packKey: string | null;
    runId?: number;
    status: string;
    gated?: boolean;
    errorMessage?: string | null;
    steps?: Array<{ nodeId: string; label: string; status: "ok" | "error" | "skipped" | "pending" }>;
    completedWrites?: number;
    totalWrites?: number;
  }> = [];

  for (const pack of ctx.packs) {
    if (!pack.packKey) {
      packs.push({ serviceSlug: pack.serviceSlug, packKey: null, status: "not_started" });
      continue;
    }
    const [run] = await db
      .select({
        id: wfRunsTable.id,
        status: wfRunsTable.status,
        versionId: wfRunsTable.versionId,
        errorMessage: wfRunsTable.errorMessage,
      })
      .from(wfRunsTable)
      .where(eq(wfRunsTable.triggerRef, runTriggerRef(ctx.session.id, pack.packKey)))
      .orderBy(desc(wfRunsTable.id))
      .limit(1);

    if (!run) {
      packs.push({ serviceSlug: pack.serviceSlug, packKey: pack.packKey, status: "not_started" });
      continue;
    }

    const [version] = await db
      .select({ graph: wfVersionsTable.graph })
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.id, run.versionId))
      .limit(1);
    const graph = (version?.graph ?? { nodes: [], edges: [] }) as WfGraph;
    const writeNodes = graph.nodes.filter((n) => WRITE_NODE_TYPES.has(n.type ?? ""));
    const gated = graph.nodes.some((n) => n.type === "break_glass_verification_gate");

    const outputs = await db
      .select({ nodeId: wfRunNodeOutputsTable.nodeId, status: wfRunNodeOutputsTable.status })
      .from(wfRunNodeOutputsTable)
      .where(eq(wfRunNodeOutputsTable.runId, run.id));
    const statusByNode = new Map(outputs.map((o) => [o.nodeId, o.status]));

    const steps = writeNodes.map((n) => ({
      nodeId: n.id,
      label: (n.data?.label as string | undefined) ?? n.id,
      status: (statusByNode.get(n.id) as "ok" | "error" | "skipped" | undefined) ?? ("pending" as const),
    }));

    packs.push({
      serviceSlug: pack.serviceSlug,
      packKey: pack.packKey,
      runId: run.id,
      status: run.status,
      gated,
      errorMessage: run.errorMessage,
      steps,
      completedWrites: steps.filter((s) => s.status === "ok").length,
      totalWrites: steps.length,
    });
  }

  res.json({ sessionId: ctx.session.id, packs });
});

export default router;

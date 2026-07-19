/**
 * portal-mission-control.ts
 *
 * Customer-facing data endpoints for the Mission Control section of the
 * customer dashboard (hero, six-engine status strip, health pillar breakdown,
 * diagnostics-first findings feed with linked offers, scan status).
 *
 * All responses are customer-safe: internal signal keys (finding
 * recommendation.signalKey, offer firedSignalKeys), rule traces, and raw
 * engine internals never leave the server — finding↔offer linking happens
 * here, mirroring the privacy contract portal-offers.ts establishes with
 * toCustomerOffer (which deliberately strips firedSignalKeys).
 *
 * Routes (CustomerUser, customerId from JWT claim like portal-offers.ts):
 *   GET  /api/portal/mission-control/engines
 *     — Live run of the customer-relevant engine subset via
 *       runEngineManifestForTenant, reduced to status-strip entries plus the
 *       Health Engine pillar breakdown. Engine runs write snapshots and are
 *       expensive, so results are cached in-process per customer for a short
 *       TTL to keep dashboard refreshes from spamming snapshot rows.
 *   GET  /api/portal/mission-control/overview
 *     — Latest diagnostics run state (active or last completed) plus the most
 *       recent run's findings, each with its linked sales offer where one of
 *       the offer's fired signal keys matches the finding's recommendation
 *       signal key. No offer is fabricated where none matches.
 *   POST /api/portal/mission-control/remediate
 *     — Triggers the Quick-Start Config Pack for an instant-remediation
 *       offer. HARD server-side guard: only customers whose
 *       msp_customers.isTestbed is true may execute (the orchestrator
 *       enforces the same rule again as a second layer) — pack runs perform
 *       REAL Graph writes against the tenant.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  mspCustomersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  salesOffersTable,
  servicesTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { runEngineManifestForTenant } from "../lib/engine-registry";
import { ConfigPackError, runConfigPackForCustomer } from "../lib/config-pack-orchestrator";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

/** Resolve the customer's id from their JWT claim (same as portal-offers.ts). */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

// ── Engine status strip ───────────────────────────────────────────────────────
//
// Customer-relevant subset of ENGINE_DEFS. Excluded as MSP-internal: priority
// (ops triage ranking), pricing (revenue capture), crm (sales intent), msp
// (portfolio-wide, not tenant-scoped), forecasting (resource planning),
// sales_offer (sales pipeline — its customer-visible output is the offers
// themselves, which surface in the findings feed). sla/scope_creep follow the
// customer-safe translation precedent of portal-customer-engines.ts.

const CUSTOMER_ENGINES: Array<{ key: string; label: string }> = [
  { key: "health", label: "Tenant Health" },
  { key: "security", label: "Security" },
  { key: "drift", label: "Configuration Drift" },
  { key: "monitoring", label: "Monitoring" },
  { key: "sla", label: "Service Levels" },
  { key: "scope_creep", label: "Scope" },
];
const CUSTOMER_ENGINE_KEYS = CUSTOMER_ENGINES.map((e) => e.key);

/** Aligned with the portal card severity vocabulary (finding-offer-card.tsx). */
type EngineSeverity = "good" | "watch" | "high" | "info";

interface EngineStatusEntry {
  key: string;
  label: string;
  severity: EngineSeverity;
  statusLabel: string;
  detail: string;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Reduce one wrapped engine result to a customer-safe strip entry. Thresholds
 * mirror engine-registry.ts's display switch where it is result-sensitive
 * (health/security/drift); sla/scope_creep/monitoring have constant display
 * strings there, so severity is derived from their real output fields, using
 * the same rules as portal-customer-engines.ts's slaOverall/scopeOverall.
 */
function toStatusEntry(key: string, label: string, result: unknown): EngineStatusEntry {
  const r = (result && typeof result === "object" ? result : null) as Record<string, unknown> | null;
  if (!r) {
    return { key, label, severity: "info", statusLabel: "Unavailable", detail: "Status could not be computed right now." };
  }

  switch (key) {
    case "health": {
      // score is a higher-is-worse risk/impact sum (see health-engine.ts) —
      // same direction as security below, not a 0-100 completion percentage.
      const score = num(r.score) ?? 0;
      const severity: EngineSeverity = score > 85 ? "high" : score > 60 ? "watch" : "good";
      const statusLabel = severity === "high" ? "Critical risk" : severity === "watch" ? "Needs attention" : "Healthy";
      return { key, label, severity, statusLabel, detail: `Overall health index at ${score}.` };
    }
    case "security": {
      const score = num(r.score) ?? 0;
      const severity: EngineSeverity = score > 75 ? "high" : score > 30 ? "watch" : "good";
      const statusLabel = severity === "high" ? "Critical risk" : severity === "watch" ? "Needs attention" : "Secure";
      return { key, label, severity, statusLabel, detail: `Security posture risk score at ${score}.` };
    }
    case "drift": {
      const score = num(r.score) ?? 0;
      const trend = typeof r.trendDirection === "string" ? r.trendDirection : "flat";
      const severity: EngineSeverity = score > 30 ? "watch" : "good";
      return {
        key,
        label,
        severity,
        statusLabel: severity === "watch" ? "Drift detected" : "Stable",
        detail: `Drift score ${score}, trend ${trend}.`,
      };
    }
    case "monitoring": {
      const b = (r.breakdown && typeof r.breakdown === "object" ? r.breakdown : {}) as Record<string, unknown>;
      const total = num(b.total) ?? 0;
      const ok = num(b.ok) ?? 0;
      const errors = num(b.error) ?? 0;
      if (total === 0) {
        return { key, label, severity: "info", statusLabel: "No monitors", detail: "No monitoring checks configured yet." };
      }
      const severity: EngineSeverity = errors === 0 ? "good" : ok === 0 ? "high" : "watch";
      return {
        key,
        label,
        severity,
        statusLabel: errors === 0 ? "All checks passing" : `${errors} failing`,
        detail: `${ok} of ${total} monitoring checks passing.`,
      };
    }
    case "sla": {
      const breaches = num(r.activeBreaches) ?? 0;
      const warnings = num(r.warningTimers) ?? 0;
      const open = num(r.runningTimers) ?? 0;
      const severity: EngineSeverity = breaches > 0 ? "high" : warnings > 0 ? "watch" : "good";
      const statusLabel = severity === "high" ? "Action required" : severity === "watch" ? "Attention needed" : "On track";
      return {
        key,
        label,
        severity,
        statusLabel,
        detail:
          open === 0
            ? "No open requests at the moment."
            : `${open} open request${open === 1 ? "" : "s"}, ${breaches} overdue, ${warnings} approaching limits.`,
      };
    }
    case "scope_creep": {
      const score = (r.score && typeof r.score === "object" ? r.score : {}) as Record<string, unknown>;
      const violations = num(score.openViolations) ?? 0;
      const detections = num(score.openDetections) ?? 0;
      const severity: EngineSeverity = violations > 0 ? "high" : detections > 0 ? "watch" : "good";
      const statusLabel = severity === "high" ? "Review required" : severity === "watch" ? "Changes detected" : "On scope";
      return {
        key,
        label,
        severity,
        statusLabel,
        detail:
          violations + detections === 0
            ? "Work is aligned with the agreed scope."
            : `${violations + detections} scope item${violations + detections === 1 ? "" : "s"} under review.`,
      };
    }
    default:
      return { key, label, severity: "info", statusLabel: "Unknown", detail: "" };
  }
}

interface EnginesResponse {
  engines: EngineStatusEntry[];
  health: { score: number | null; pillars: Array<{ pillar: string; score: number }> };
  generatedAt: string;
}

async function buildEnginesResponse(customerId: number): Promise<EnginesResponse> {
  const results = await runEngineManifestForTenant(customerId, undefined, CUSTOMER_ENGINE_KEYS);

  const engines = CUSTOMER_ENGINES.map(({ key, label }) => toStatusEntry(key, label, results[key] ?? null));

  // Health pillar breakdown: 6 HEALTH_PILLARS entries plus the security entry
  // calculateArchitectureHealthScore appends. Contributions carry internal
  // signal keys, so only { pillar, score } pairs are exposed.
  const healthResult = (results["health"] && typeof results["health"] === "object" ? results["health"] : null) as
    | { score?: unknown; breakdown?: unknown }
    | null;
  const rawBreakdown = Array.isArray(healthResult?.breakdown) ? healthResult.breakdown : [];
  const pillars = rawBreakdown
    .filter((b): b is { pillar: unknown; score: unknown } => Boolean(b) && typeof b === "object" && "pillar" in (b as object))
    .map((b) => ({ pillar: String(b.pillar), score: num(b.score) ?? 0 }));

  return {
    engines,
    health: { score: healthResult ? num(healthResult.score) : null, pillars },
    generatedAt: new Date().toISOString(),
  };
}

// Engine runs are expensive (per-engine tenant profile builds) and write
// tenant_engine_snapshots rows as a side effect — a short per-customer TTL
// cache keeps dashboard reloads from producing snapshot spam. Promise-valued
// so concurrent requests share one in-flight run.
const ENGINES_CACHE_TTL_MS = 5 * 60_000;
const enginesCache = new Map<number, { at: number; promise: Promise<EnginesResponse> }>();

router.get(
  "/portal/mission-control/engines",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const cached = enginesCache.get(customerId);
      let promise = cached && Date.now() - cached.at < ENGINES_CACHE_TTL_MS ? cached.promise : null;
      if (!promise) {
        promise = buildEnginesResponse(customerId);
        enginesCache.set(customerId, { at: Date.now(), promise });
        promise.catch(() => {
          if (enginesCache.get(customerId)?.promise === promise) enginesCache.delete(customerId);
        });
      }
      res.json(await promise);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/mission-control/engines failed");
      res.status(500).json({ error: "Failed to load engine status" });
    }
  },
);

// ── Overview: scan state + findings feed with linked offers ──────────────────

const FINDING_SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

// v1 linkage between an offer's catalog service and the config pack its
// instant-remediation action runs. config_packs has no service FK yet, so the
// association is the seeded convention from 0195 (service
// 'entra-id-quickstart-v1' shipped alongside pack 'quickstart-v1'). Replace
// with a data-driven column when packs gain a service linkage.
const INSTANT_PACK_BY_SERVICE_SLUG: Record<string, string> = {
  "entra-id-quickstart-v1": "quickstart-v1",
};

router.get(
  "/portal/mission-control/overview",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const [lastCompleted] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            inArray(mspDiagnosticRunsTable.status, ["completed", "partial"]),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const findingRows = lastCompleted
        ? await db
            .select()
            .from(mspDiagnosticFindingsTable)
            .where(
              and(
                eq(mspDiagnosticFindingsTable.runId, lastCompleted.runId),
                inArray(mspDiagnosticFindingsTable.severity, ["critical", "warning", "info"]),
              ),
            )
            .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        : [];

      // Only "sent" offers are actionable from the feed — same customer
      // visibility rules as portal-offers.ts, narrowed to the linkable state.
      const offerRows = await db
        .select()
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.customerId, customerId), eq(salesOffersTable.state, "sent")))
        .orderBy(desc(salesOffersTable.score));

      const serviceIds = [...new Set(offerRows.map((o) => o.serviceId).filter((id): id is number => id != null))];
      const serviceRows = serviceIds.length
        ? await db
            .select({ id: servicesTable.id, slug: servicesTable.slug })
            .from(servicesTable)
            .where(inArray(servicesTable.id, serviceIds))
        : [];

      const [customer] = await db
        .select({ isTestbed: mspCustomersTable.isTestbed })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      const isTestbed = customer?.isTestbed === true;

      const instantServiceIds = new Set(
        serviceRows.filter((s) => s.slug != null && INSTANT_PACK_BY_SERVICE_SLUG[s.slug] != null).map((s) => s.id),
      );

      // Server-side finding→offer linking on signal keys (never exposed to the
      // client). Highest-scored offer wins when several fired on the same key.
      const offerBySignalKey = new Map<string, (typeof offerRows)[number]>();
      for (const offer of offerRows) {
        for (const signalKey of offer.firedSignalKeys ?? []) {
          if (!offerBySignalKey.has(signalKey)) offerBySignalKey.set(signalKey, offer);
        }
      }

      const findings = [...findingRows]
        .sort(
          (a, b) =>
            (FINDING_SEVERITY_RANK[a.severity] ?? 9) - (FINDING_SEVERITY_RANK[b.severity] ?? 9) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .map((f) => {
          const signalKey = f.recommendation?.signalKey;
          const offer = signalKey ? offerBySignalKey.get(signalKey) : undefined;
          return {
            id: f.id,
            checkLabel: f.checkLabel,
            severity: f.severity,
            title: f.title,
            description: f.description,
            effort: f.recommendation?.estimatedEffort ?? null,
            category: f.recommendation?.category ?? null,
            action: f.recommendation?.action ?? null,
            createdAt: f.createdAt,
            offer: offer
              ? {
                  id: offer.id,
                  title: offer.title,
                  rationale: offer.rationale,
                  adjustedPriceCents: offer.adjustedPriceCents,
                  state: offer.state,
                  instant: isTestbed && offer.serviceId != null && instantServiceIds.has(offer.serviceId),
                }
              : null,
          };
        });

      const active = latestRun != null && (latestRun.status === "pending" || latestRun.status === "running");

      res.json({
        scan: {
          active,
          runId: active ? latestRun.runId : null,
          status: latestRun?.status ?? null,
          startedAt: active ? latestRun.startedAt : null,
          lastScanAt: lastCompleted ? (lastCompleted.completedAt ?? lastCompleted.createdAt) : null,
        },
        summary: {
          critical: findings.filter((f) => f.severity === "critical").length,
          warning: findings.filter((f) => f.severity === "warning").length,
          info: findings.filter((f) => f.severity === "info").length,
          checksOk: lastCompleted?.checksOk ?? null,
          checksTotal: lastCompleted?.checksTotal ?? null,
        },
        findings,
      });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/mission-control/overview failed");
      res.status(500).json({ error: "Failed to load mission control overview" });
    }
  },
);

// ── Instant remediation trigger (testbed-only, hard server-side guard) ────────

const remediateBodySchema = z.object({ offerId: z.number().int().positive() });

const CONFIG_PACK_ERROR_STATUS: Record<ConfigPackError["code"], number> = {
  pack_not_found: 404,
  customer_not_found: 404,
  missing_variables: 400,
  concurrency_limit: 409,
  pack_not_active: 422,
  pack_empty: 422,
  dependency_not_in_pack: 422,
  dependency_cycle: 422,
  customer_not_connected: 422,
  customer_not_testbed: 403,
  tenant_domain_unresolved: 422,
};

router.post(
  "/portal/mission-control/remediate",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const body = remediateBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
      return;
    }

    try {
      const [offer] = await db
        .select()
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, body.data.offerId), eq(salesOffersTable.customerId, customerId)))
        .limit(1);
      if (!offer) {
        res.status(404).json({ error: "Offer not found" });
        return;
      }
      if (offer.state !== "sent") {
        res.status(409).json({ error: "Offer is not currently actionable" });
        return;
      }

      // HARD GUARD: instant remediation performs REAL Graph writes against the
      // tenant via the Quick-Start Config Pack, which still has unresolved
      // live-tenant blockers. Only testbed-flagged customers may execute —
      // enforced here AND again inside runConfigPackForCustomer
      // (customer_not_testbed), so a UI bug can never reach a live tenant.
      const [customer] = await db
        .select({ isTestbed: mspCustomersTable.isTestbed })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (customer?.isTestbed !== true) {
        log.warn(
          { customerId, offerId: offer.id, userId: req.user?.id },
          "mission-control remediate: blocked — customer is not a testbed tenant",
        );
        res.status(403).json({ error: "Instant remediation is not available for this account" });
        return;
      }

      const [service] = offer.serviceId != null
        ? await db
            .select({ slug: servicesTable.slug })
            .from(servicesTable)
            .where(eq(servicesTable.id, offer.serviceId))
            .limit(1)
        : [];
      const packKey = service?.slug != null ? INSTANT_PACK_BY_SERVICE_SLUG[service.slug] : undefined;
      if (!packKey) {
        res.status(400).json({ error: "This offer does not support instant remediation" });
        return;
      }

      const result = await runConfigPackForCustomer({
        packKey,
        customerId,
        triggeredBy: `mission-control:offer:${offer.id}:customer:${customerId}:user:${req.user?.id ?? "unknown"}`,
      });

      log.info(
        { customerId, offerId: offer.id, packKey, workflowRunId: result.runId, userId: req.user?.id },
        "mission-control remediate: config pack run fired for testbed customer",
      );
      void createAuditLog({
        actorUserId: req.user?.id,
        actorName: req.user?.name ?? req.user?.email ?? "customer",
        actorRole: req.user?.role ?? "client",
        actionType: "mission_control.instant_remediation_triggered",
        entityType: "sales_offer",
        entityId: offer.id,
        entityLabel: offer.title,
        metadata: { packKey, customerId, workflowRunId: result.runId, gated: result.gated },
      });

      res.status(202).json({ runId: result.runId, packKey, gated: result.gated });
    } catch (err) {
      if (err instanceof ConfigPackError) {
        log.warn({ err, customerId, code: err.code }, "mission-control remediate: config pack rejected the run");
        res.status(CONFIG_PACK_ERROR_STATUS[err.code] ?? 422).json({ error: err.message, code: err.code });
        return;
      }
      log.error({ err, customerId }, "POST /portal/mission-control/remediate failed");
      res.status(500).json({ error: "Failed to start remediation" });
    }
  },
);

export default router;

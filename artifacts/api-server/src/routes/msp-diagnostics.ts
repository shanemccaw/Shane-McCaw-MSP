/**
 * msp-diagnostics.ts
 *
 * Diagnostics Pipeline API — triggers and tracks per-customer diagnostics runs.
 *
 * MSP operator routes (require MSPOperator role):
 *   POST /api/msp/customers/:customerId/diagnostics/run
 *     — Trigger a diagnostics run. Fire-and-forget; returns runId immediately.
 *
 *   GET  /api/msp/customers/:customerId/diagnostics
 *     — List runs for a customer (most recent first).
 *
 *   GET  /api/msp/customers/:customerId/diagnostics/runs/:runId
 *     — Get run details + structured findings, each with its #379 failure
 *       `classification` (null unless that finding is a real failure).
 *
 *   GET  /api/msp/customers/:customerId/diagnostics/runs/:runId/sse
 *     — SSE stream: per-check progress → complete/error events.
 *       Uses Bearer JWT in ?jwt= query param (EventSource can't send headers).
 *       Also accepts a CustomerUser JWT when its customerId claim matches
 *       :customerId (dashboard Mission Control live scan progress).
 *
 * Customer portal routes (require CustomerUser role):
 *   GET  /api/portal/diagnostics/latest
 *     — Customer's latest run + findings summary (read-only).
 *
 *   GET  /api/portal/scripts/:checkKey/download
 *     — Download the PowerShell script that satisfies a requires_script check.
 *       Scoped to checks the caller actually has a requires_script finding for.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantsTable,
  usersTable,
  clientServicesTable,
  servicesTable,
  industryBenchmarkReferenceTable,
  monitorChecksTable,
  scriptModulesTable,
} from "@workspace/db";
import { eq, and, desc, count, or, sql, inArray } from "drizzle-orm";
import { requireRole, requireAuth, assertCustomerAccess, isCustomerBlockedByStaffScope, type AuthUser } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "tenant.portal" });
import { runDiagnostics } from "../lib/diagnostics-runner";
import { runItemDetailCollection } from "../lib/item-detail-collector";
import { registerDiagnosticsRunSSEClient } from "../lib/sse-channels";
import { calculateArchitectureHealthScore } from "../lib/health-engine";
import { computeDisplayHealth } from "../lib/health-display";
import { fetchTenantEvaluableSignalKeys } from "../lib/pillar-coverage";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine";
import { evaluateDocGateCoverage } from "../lib/doc-gate-coverage";
import { REQUIRED_MT_SCOPES } from "../lib/graph";
import { classifyMonitorFailure, type FailureClassification } from "../lib/monitor-failure-classifier";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ── #379: failure classification on each finding ──────────────────────────────
//
// COMPUTED ON READ, exactly as admin-monitor-check-runs.ts already does for
// Simulator Studio runs — no schema change for a value that is a pure function
// of text already persisted, and sharpening a signature retro-applies to every
// historical finding instead of freezing each one at whatever the rules knew on
// the day its scan ran.
//
// The classifier itself is used UNMODIFIED. It is a pure function that never
// guesses and never mutates anything, and its own header comment specifies that
// `declaredScopes` is passed IN by the caller rather than imported — so
// REQUIRED_MT_SCOPES is handed to it READ-ONLY here, purely so it can say "that
// permission is already declared, so this is a re-consent problem". Nothing on
// this path writes to it or to any permission state.

/** The subset of a msp_diagnostic_findings row this triage actually reads. */
export interface ClassifiableFinding {
  checkKey?: string | null;
  checkStatus?: string | null;
  extractedProperties?: unknown;
}

/**
 * #374 persists the real, untruncated Graph error under
 * `extractedProperties._rawGraphError`, alongside the humanized `description`.
 * Findings written before #374 landed simply don't carry it.
 */
export function rawGraphErrorOf(finding: ClassifiableFinding): string | null {
  const props = finding.extractedProperties as Record<string, unknown> | null | undefined;
  const raw = props?.["_rawGraphError"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Whether a finding is a real failure worth triaging.
 *
 * The false case matters as much as the true one: it is what stops a triage
 * verdict from ever rendering over a check that passed — the same discipline
 * classifyRunFailure() applies by returning null for a non-failed run. A finding
 * qualifies only if it carries a real raw Graph error, or if its status is one
 * of the two the executor has ALREADY classified upstream (license_gap /
 * consent_revoked); the classifier deliberately short-circuits on those rather
 * than re-deriving them from text, and both are explicitly "not a fault".
 */
export function isClassifiableFinding(finding: ClassifiableFinding): boolean {
  return (
    rawGraphErrorOf(finding) != null ||
    finding.checkStatus === "license_gap" ||
    finding.checkStatus === "consent_revoked" ||
    // #1847 — same reasoning: already classified upstream against the tenant's real
    // wire signature and licence entitlement, and explicitly "not a fault".
    finding.checkStatus === "service_not_configured"
  );
}

/**
 * Attaches `classification` to each finding — null for any that isn't a real
 * failure. Pure: the monitor_checks endpoint join is done by the caller and
 * handed in, so this stays directly testable and does no I/O of its own.
 */
export function classifyDiagnosticFindings<T extends ClassifiableFinding>(
  findings: T[],
  endpointByCheckKey: Map<string, string | null>,
): Array<T & { classification: FailureClassification | null }> {
  return findings.map((f) => ({
    ...f,
    classification: isClassifiableFinding(f)
      ? classifyMonitorFailure({
          errorMessage: rawGraphErrorOf(f),
          resultStatus: f.checkStatus ?? null,
          endpoint: f.checkKey ? endpointByCheckKey.get(f.checkKey) ?? null : null,
          declaredScopes: REQUIRED_MT_SCOPES,
        })
      : null,
  }));
}

/** Route-side wrapper: resolves the endpoints, then classifies. */
async function withFindingClassifications<T extends ClassifiableFinding>(
  findings: T[],
): Promise<Array<T & { classification: FailureClassification | null }>> {
  // msp_diagnostic_findings has no endpoint column, so the endpoint the
  // classifier corroborates against (a literal non-HTTP scheme, the /beta
  // surface) is joined from monitor_checks by check_key — one query for the
  // whole run, and only for the findings that will actually be classified.
  const keys = [
    ...new Set(
      findings
        .filter(isClassifiableFinding)
        .map((f) => f.checkKey)
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  const endpointByKey = new Map<string, string | null>();
  if (keys.length > 0) {
    const checkRows = await db
      .select({ key: monitorChecksTable.key, endpoint: monitorChecksTable.endpoint })
      .from(monitorChecksTable)
      .where(inArray(monitorChecksTable.key, keys));
    for (const row of checkRows) endpointByKey.set(row.key, row.endpoint);
  }
  return classifyDiagnosticFindings(findings, endpointByKey);
}

// ── Helpers ───────────────────────────────────────────────────────────────────


async function assertCustomerBelongsToMsp(customerId: number, mspId: number): Promise<void> {
  if (!mspId) return;
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  if (!row) throw Object.assign(new Error("Customer not found"), { status: 404 });
}

/**
 * The caller's own customer id (a tenants.id), for the customer-facing portal
 * routes below. Primary source is the JWT's customerId claim; the DB fallback
 * covers the stale-JWT window where the claim is absent because the user had
 * no tenant linkage at login time.
 *
 * Post-refactor this is simply users.tenantId — the dropped msp_users bridge
 * table's customer_id column. Deliberately NOT users.mspId: these are
 * tenant-scoped roles, which carry a tenantId and a NULL mspId, so reading the
 * MSP column here would resolve null for every real customer and silently
 * blank out their diagnostics, scripts and benchmark views.
 *
 * Replaces four copies of this lookup that each dynamically re-imported
 * mspUsersTable; usersTable is statically imported, so the dynamic import is
 * no longer needed.
 */
async function resolveCallerCustomerId(user: AuthUser): Promise<number | null> {
  if (user.customerId) return user.customerId;
  const [row] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  return row?.customerId ?? null;
}

// ── POST /api/msp/customers/:customerId/diagnostics/run ───────────────────────
// Fire-and-forget: creates ONE run record (correct mspId + packageKey) and
// immediately returns the runId so the caller can open the SSE stream.

router.post(
  "/msp/customers/:customerId/diagnostics/run",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      // 1. Look up the customer record — mspId must come from here, NOT from the
      //    caller's JWT (which is legitimately absent/zero for PlatformAdmin).
      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      // 2. Authorization: PlatformAdmin/admin can diagnose any customer.
      //    MSPOperator/MSPAdmin must own this customer.
      // Ownership + per-staff scoping via the shared source of truth. NOTE: this
      // replaced a prior tautological check that passed the customer's OWN mspId
      // (never the caller's), which did not actually fence cross-MSP access.
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(404).json({ error: "Customer not found" }); return;
      }

      // 3. Resolve packageKey.  Body override is accepted (useful for testing),
      //    but "default" and empty strings are treated as "not provided".
      //    Primary source: the customer's active monitoring subscription
      //    (users → client_services → services.type_attributes->>'packageKey').
      //    The customer's logins are every users row carrying this tenantId —
      //    the same set resolveCustomerUserIds() returns — so the subscription
      //    is found no matter which sibling login it hangs off.
      //    Fallback: core:security-baseline (always exists, has real checks).
      let packageKey = String((req.body as Record<string, unknown>).packageKey ?? "").trim();
      if (!packageKey || packageKey === "default") {
        const [pkgRow] = await db
          .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
          .from(usersTable)
          .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
          .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
          .where(
            and(
              eq(usersTable.tenantId, customerId),
              eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
              eq(clientServicesTable.status, "active"),
            )
          )
          // Deterministic: most recent active subscription wins when a
          // customer holds more than one (unordered LIMIT 1 was arbitrary).
          .orderBy(desc(clientServicesTable.id))
          .limit(1);
        packageKey = pkgRow?.packageKey ?? "core:security-baseline";
      }

      const triggeredByUserId = req.user!.id;
      const runId = randomUUID();

      // 4. Create ONE pending row with correct values, then respond immediately.
      //    Pass existingRunId to runDiagnostics so it reuses this row instead of
      //    inserting a duplicate (the old stub + runDiagnostics double-insert bug).
      await db
        .insert(mspDiagnosticRunsTable)
        .values({
          runId,
          mspId: customer.mspId,
          customerId,
          tenantId: customer.tenantId ?? undefined,
          packageKey,
          status: "pending",
          triggeredByUserId,
        });

      res.status(202).json({ runId, status: "pending", message: "Diagnostics run started" });

      // 5. Fire-and-forget: run the full diagnostics pipeline.
      // Manual MSPOperator re-check — routine, not assessment-triggered.
      void runDiagnostics({ customerId, packageKey, existingRunId: runId, triggeredByUserId, isAssessmentTriggered: false })
        .catch((err: unknown) => {
          log.error({ err, runId }, "msp-diagnostics: async run failed");
        });

      // 6. In PARALLEL with (never chained after) the scoring run above: collect
      //    the COMPLETE per-check item lists into tenant_check_item_details
      //    (#339), so remediation documents and War Room per-item dialogs have
      //    full detail already gathered rather than fetched at the point of need.
      //    Its own package, triggerId and table — it cannot affect this run's
      //    scoring, findings or SSE stream. Skipped when the customer has no
      //    connected tenant, which the scoring run reports as its own failure.
      //
      //    `scopeToPackageKey` is the SAME packageKey the scoring run above was
      //    given (#543): the detail package is linked to the entire check
      //    catalogue, so without it this parallel pass re-ran every check an
      //    operator had curated out of `packageKey` — the reported "excluded
      //    checks still execute during a scan" bug, arriving here rather than
      //    through executeMonitoringPackage.
      if (customer.tenantId) {
        void runItemDetailCollection({ tenantId: customer.tenantId, customerId, scopeToPackageKey: packageKey, parallelToRunId: runId })
          .catch((err: unknown) => {
            // runItemDetailCollection resolves rather than rejects; this is a
            // belt-and-braces guard against an unhandled rejection, never the
            // primary error path.
            log.warn({ err, runId }, "msp-diagnostics: full-item detail collection failed (non-fatal)");
          });
      }

    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "POST /msp/customers/:id/diagnostics/run error");
      if (!res.headersSent) res.status(status).json({ error: message });
    }
  },
);

// ── GET /api/msp/customers/:customerId/monitoring-package ─────────────────────
// Returns the resolved packageKey for a customer's active monitoring subscription
// so the frontend can display the package name and gate the "Run Diagnostics" button.

router.get(
  "/msp/customers/:customerId/monitoring-package",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      // Ownership + per-staff scoping via the shared source of truth. NOTE: this
      // replaced a prior tautological check that passed the customer's OWN mspId
      // (never the caller's), which did not actually fence cross-MSP access.
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(404).json({ error: "Customer not found" }); return;
      }

      const [pkgRow] = await db
        .select({
          packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'`,
          serviceId: servicesTable.id,
          serviceName: servicesTable.name,
        })
        .from(usersTable)
        .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(
          and(
            eq(usersTable.tenantId, customerId),
            eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
            eq(clientServicesTable.status, "active"),
          )
        )
        // Deterministic: most recent active subscription wins when a customer
        // holds more than one (unordered LIMIT 1 was arbitrary).
        .orderBy(desc(clientServicesTable.id))
        .limit(1);

      res.json({
        packageKey: pkgRow?.packageKey ?? null,
        serviceId: pkgRow?.serviceId ?? null,
        serviceName: pkgRow?.serviceName ?? null,
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, "GET /msp/customers/:id/monitoring-package error");
      res.status(status).json({ error: message });
    }
  },
);

// ── GET /api/msp/customers/:customerId/diagnostics ────────────────────────────

router.get(
  "/msp/customers/:customerId/diagnostics",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
      // Ownership + per-staff scoping via the shared source of truth (was a
      // tautological customer-owns-itself check that ignored the caller's mspId).
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(404).json({ error: "Customer not found" }); return;
      }

      const limit = Math.min(parseInt(String((req.query as Record<string, unknown>).limit ?? "20"), 10), 100);
      const offset = parseInt(String((req.query as Record<string, unknown>).offset ?? "0"), 10);

      const [runs, [{ total }]] = await Promise.all([
        db
          .select()
          .from(mspDiagnosticRunsTable)
          .where(eq(mspDiagnosticRunsTable.customerId, customerId))
          .orderBy(desc(mspDiagnosticRunsTable.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(mspDiagnosticRunsTable)
          .where(eq(mspDiagnosticRunsTable.customerId, customerId)),
      ]);

      res.json({ runs, total, limit, offset });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      log.error({ err }, "GET /msp/customers/:id/diagnostics error");
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── GET /api/msp/customers/:customerId/diagnostics/runs ───────────────────────
// Run history list for the customer-detail Diagnostics tab. Returns a plain
// array (most recent first) — unlike GET .../diagnostics above, which wraps
// runs in a paginated { runs, total, limit, offset } envelope.

router.get(
  "/msp/customers/:customerId/diagnostics/runs",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
      // Ownership + per-staff scoping via the shared source of truth (was a
      // tautological customer-owns-itself check that ignored the caller's mspId).
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(404).json({ error: "Customer not found" }); return;
      }

      const limit = Math.min(parseInt(String((req.query as Record<string, unknown>).limit ?? "50"), 10), 100);

      const runs = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(limit);

      res.json(runs);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      log.error({ err }, "GET /msp/customers/:id/diagnostics/runs error");
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── GET /api/msp/customers/:customerId/diagnostics/runs/:runId ────────────────

router.get(
  "/msp/customers/:customerId/diagnostics/runs/:runId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      const runId = req.params["runId"] as string;
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
      // Ownership + per-staff scoping via the shared source of truth (was a
      // tautological customer-owns-itself check that ignored the caller's mspId).
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(404).json({ error: "Customer not found" }); return;
      }

      const [run] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(and(
          eq(mspDiagnosticRunsTable.runId, runId),
          eq(mspDiagnosticRunsTable.customerId, customerId),
        ))
        .limit(1);

      if (!run) { res.status(404).json({ error: "Run not found" }); return; }

      const findings = await db
        .select()
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.runId, runId))
        .orderBy(mspDiagnosticFindingsTable.severity);

      // #379 — each failing finding carries its own triage verdict, computed on
      // read from that finding's own real error text. Additive: every existing
      // field on `findings` is unchanged.
      res.json({ run, findings: await withFindingClassifications(findings) });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      log.error({ err }, "GET /msp/customers/:id/diagnostics/runs/:runId error");
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse ────────────
// SSE endpoint for live progress. Accepts JWT via ?jwt= query param (EventSource
// cannot send Authorization headers). Validates the JWT inline.

router.get(
  "/msp/customers/:customerId/diagnostics/runs/:runId/sse",
  async (req: Request, res: Response) => {
    try {
      const customerIdStr = req.params["customerId"] as string;
      const runId = req.params["runId"] as string;
      const customerId = parseInt(customerIdStr, 10);

      // Authenticate via query JWT
      const token = String((req.query as Record<string, unknown>).jwt ?? "");
      if (!token) { res.status(401).json({ error: "JWT required" }); return; }

      const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";
      let decoded: Record<string, unknown>;
      try {
        decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      } catch {
        res.status(401).json({ error: "Invalid or expired JWT" }); return;
      }

      const userMspId = decoded.mspId as number | undefined;
      const userRole = decoded.mspRole as string | undefined;
      const isAdmin = decoded.role === "admin";

      if (!isAdmin) {
        if (userRole === "CustomerUser" || userRole === "Assessment") {
          // A customer (full portal user or Assessment-role prospect) may stream
          // progress only for runs on their own tenant. CustomerUser uses this
          // for the Mission Control scan-progress strip; Assessment uses the same
          // stream for the live deep-scan step in the assessment wizard. Both are
          // scoped to their own customerId claim — no cross-tenant access.
          const tokenCustomerId = decoded.customerId as number | undefined;
          if (tokenCustomerId !== customerId) {
            res.status(403).json({ error: "Insufficient role" }); return;
          }
        } else {
          const allowedRoles = ["MSPOperator", "MSPAdmin", "PlatformAdmin"];
          if (!userRole || !allowedRoles.includes(userRole)) {
            res.status(403).json({ error: "Insufficient role" }); return;
          }
          if (userMspId) {
            await assertCustomerBelongsToMsp(customerId, userMspId);
          }
          // Per-staff customer scoping: a scoped operator cannot stream progress
          // for a run on a customer outside their assigned set (404, not 403, to
          // avoid revealing the run exists). This hand-rolled SSE auth path can't
          // reuse assertCustomerAccess directly (no req.user), so rebuild the
          // minimal AuthUser from the verified query-JWT claims.
          const sseUser: AuthUser = {
            id: Number(decoded.id),
            email: String(decoded.email ?? ""),
            role: decoded.role === "admin" ? "admin" : "client",
            mspRole: userRole as AuthUser["mspRole"],
            mspId: userMspId,
            customerId: decoded.customerId as number | undefined,
          };
          if (await isCustomerBlockedByStaffScope(sseUser, customerId)) {
            res.status(404).json({ error: "Run not found" }); return;
          }
        }
      }

      // Verify run exists for this customer
      const [run] = await db
        .select({ runId: mspDiagnosticRunsTable.runId, status: mspDiagnosticRunsTable.status })
        .from(mspDiagnosticRunsTable)
        .where(and(
          eq(mspDiagnosticRunsTable.runId, runId),
          eq(mspDiagnosticRunsTable.customerId, customerId),
        ))
        .limit(1);

      if (!run) { res.status(404).json({ error: "Run not found" }); return; }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      registerDiagnosticsRunSSEClient(runId, res, () => {
        log.info({ runId, customerId }, "diagnostics SSE client disconnected");
      });

      const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
      }, 25_000);

      res.on("close", () => clearInterval(heartbeat));

    } catch (err) {
      log.error({ err }, "GET /msp/customers/:id/diagnostics/runs/:runId/sse error");
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/diagnostics/latest ───────────────────────────────────────
// Customer-facing: returns the customer's latest completed diagnostics run
// and a summary of findings (no raw extracted_properties).
//
// customerId may be null in the JWT when:
//   a) users.tenant_id was null at login time (stale JWT / data-gap window)
//   b) The user is a pre-purchase orphaned tenant with no tenants row yet
//
// Fallback: resolveCallerCustomerId() does a fresh users lookup so a stale JWT
// doesn't hide real data.

router.get(
  "/portal/diagnostics/latest",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Primary: use customerId from JWT. Fallback: fresh DB read (stale-JWT window).
      const customerId = await resolveCallerCustomerId(user);

      if (!customerId) { res.json({ run: null, findings: [] }); return; }

      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(and(
          eq(mspDiagnosticRunsTable.customerId, customerId),
          or(
            eq(mspDiagnosticRunsTable.status, "completed"),
            eq(mspDiagnosticRunsTable.status, "partial"),
          ),
        ))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      if (!latestRun) { res.json({ run: null, findings: [] }); return; }

      const findings = await db
        .select({
          findingId: mspDiagnosticFindingsTable.findingId,
          checkKey: mspDiagnosticFindingsTable.checkKey,
          checkLabel: mspDiagnosticFindingsTable.checkLabel,
          severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title,
          description: mspDiagnosticFindingsTable.description,
          checkStatus: mspDiagnosticFindingsTable.checkStatus,
          createdAt: mspDiagnosticFindingsTable.createdAt,
        })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.runId, latestRun.runId))
        .orderBy(mspDiagnosticFindingsTable.severity);

      res.json({ run: latestRun, findings });
    } catch (err) {
      log.error({ err }, "GET /portal/diagnostics/latest error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/scripts/:checkKey/download ────────────────────────────────
// Customer-facing: downloads the .ps1 script that satisfies a requires_script
// check. Scoped strictly to the caller's own findings — a checkKey is only
// resolvable here if the caller's customer actually has a requires_script
// finding for it, so guessing an unrelated checkKey/package never leaks
// script content that customer shouldn't see.

router.get(
  "/portal/scripts/:checkKey/download",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { checkKey } = req.params as { checkKey: string };

      const customerId = await resolveCallerCustomerId(user);

      if (!customerId) {
        res.status(404).json({ error: "No script available for this check" });
        return;
      }

      const [finding] = await db
        .select({ findingId: mspDiagnosticFindingsTable.findingId })
        .from(mspDiagnosticFindingsTable)
        .where(and(
          eq(mspDiagnosticFindingsTable.customerId, customerId),
          eq(mspDiagnosticFindingsTable.checkKey, checkKey),
          eq(mspDiagnosticFindingsTable.checkStatus, "requires_script"),
        ))
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(1);

      if (!finding) {
        res.status(404).json({ error: "No script available for this check" });
        return;
      }

      const [check] = await db
        .select({ scriptPackageId: monitorChecksTable.scriptPackageId })
        .from(monitorChecksTable)
        .where(eq(monitorChecksTable.key, checkKey))
        .limit(1);

      if (!check?.scriptPackageId) {
        res.status(404).json({ error: "No script has been assigned to this check yet" });
        return;
      }

      const modules = await db
        .select({
          filename: scriptModulesTable.filename,
          content: scriptModulesTable.content,
        })
        .from(scriptModulesTable)
        .where(eq(scriptModulesTable.packageId, check.scriptPackageId))
        .orderBy(scriptModulesTable.sortOrder)
        .limit(1);

      const [module] = modules;
      if (!module) {
        res.status(404).json({ error: "No script has been assigned to this check yet" });
        return;
      }

      const filename = module.filename?.trim() || `${checkKey}.ps1`;

      log.info({ customerId, checkKey }, "GET /portal/scripts/:checkKey/download");

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(module.content);
    } catch (err) {
      log.error({ err }, "GET /portal/scripts/:checkKey/download error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/health-benchmark ─────────────────────────────────────────
// Customer-facing: returns per-pillar displayScore (0–100, higher = healthier)
// plus industry benchmark reference data for the Benchmarking widget.
//
// Never exposes raw risk scores or breakdown.contributions.

router.get(
  "/portal/health-benchmark",
  // requireAuth, not requireRole("CustomerUser") — every other customer-facing
  // route in this file (diagnostics/latest, scripts/download, diagnostics/runs,
  // diagnostics/results) only requires authentication. The stricter floor here
  // silently 403'd Free-tier customers who already have real diagnostic data,
  // which the frontend couldn't distinguish from "no data yet" (#1157).
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const customerId = await resolveCallerCustomerId(user);

      if (!customerId) {
        res.json({ pillars: [], asOfDate: null });
        return;
      }

      const [output, { rules, groups }, benchmarks] = await Promise.all([
        calculateArchitectureHealthScore(customerId),
        fetchSignalRulesAndGroups(),
        db.select().from(industryBenchmarkReferenceTable),
      ]);

      // Restrict each pillar's theoreticalMax denominator to signals THIS
      // TENANT'S OWN scanned checks can genuinely feed. Catalog-wide scoping
      // (what this used before #413) measured the denominator over checks the
      // customer never ran while the numerator could only ever hold checks it
      // did — a clamp that no weighting could overcome.
      const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
        firedSignalKeys: output.rawSignals,
      });
      const displayPillars = computeDisplayHealth(output, rules, groups, evaluableSignalKeys);

      const benchmarkMap = new Map(benchmarks.map(b => [b.pillar, b]));

      const pillars = displayPillars.map(({ pillar, displayScore }) => {
        const ref = benchmarkMap.get(pillar);
        return {
          pillar,
          displayScore,
          industryAvgPct: ref?.industryAvgPct ?? null,
          msExcellencePct: ref?.msExcellencePct ?? null,
          source: ref?.source ?? null,
          asOfDate: ref?.asOfDate ?? null,
        };
      });

      const asOfDate = benchmarks
        .filter(b => b.asOfDate)
        .sort((a, b) => (b.asOfDate! > a.asOfDate! ? 1 : -1))[0]
        ?.asOfDate ?? null;

      res.json({ pillars, asOfDate });
    } catch (err) {
      log.error({ err }, "GET /portal/health-benchmark error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/diagnostics/runs/:runId ───────────────────────────────────
// Customer-facing detail view for a specific run.

router.get(
  "/portal/diagnostics/runs/:runId",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const customerId = user.customerId;
      if (!customerId) { res.status(403).json({ error: "No customer context" }); return; }

      const runId = req.params["runId"] as string;

      const [run] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(and(
          eq(mspDiagnosticRunsTable.runId, runId),
          eq(mspDiagnosticRunsTable.customerId, customerId),
        ))
        .limit(1);

      if (!run) { res.status(404).json({ error: "Run not found" }); return; }

      const findings = await db
        .select({
          findingId: mspDiagnosticFindingsTable.findingId,
          checkKey: mspDiagnosticFindingsTable.checkKey,
          checkLabel: mspDiagnosticFindingsTable.checkLabel,
          severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title,
          description: mspDiagnosticFindingsTable.description,
          checkStatus: mspDiagnosticFindingsTable.checkStatus,
          createdAt: mspDiagnosticFindingsTable.createdAt,
        })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.runId, runId))
        .orderBy(mspDiagnosticFindingsTable.severity);

      res.json({ run, findings });
    } catch (err) {
      log.error({ err }, "GET /portal/diagnostics/runs/:runId error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/diagnostics/results/:serviceSlug ───────────────────────────
// Customer-facing: returns the assessment run data formatted for the dashboard.

router.get(
  "/portal/diagnostics/results/:serviceSlug",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const serviceSlug = req.params["serviceSlug"] as string;

      const customerId = await resolveCallerCustomerId(user);

      if (!customerId) {
        res.json({
          serviceSlug,
          score: 0,
          status: "not_evaluated",
          findings: [],
          evaluatedAt: new Date().toISOString(),
        });
        return;
      }

      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            eq(mspDiagnosticRunsTable.packageKey, serviceSlug),
            or(
              eq(mspDiagnosticRunsTable.status, "completed"),
              eq(mspDiagnosticRunsTable.status, "partial")
            )
          )
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      if (!latestRun) {
        res.json({
          serviceSlug,
          score: 0,
          status: "not_evaluated",
          findings: [],
          evaluatedAt: new Date().toISOString(),
        });
        return;
      }

      const findingsRows = await db
        .select({
          findingId: mspDiagnosticFindingsTable.findingId,
          title: mspDiagnosticFindingsTable.title,
          severity: mspDiagnosticFindingsTable.severity,
          recommendation: mspDiagnosticFindingsTable.recommendation,
        })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.runId, latestRun.runId))
        .orderBy(mspDiagnosticFindingsTable.severity);

      let status = "healthy";
      let hasWarning = false;
      let hasCritical = false;

      const findings = findingsRows.map((f) => {
        if (f.severity === "critical") hasCritical = true;
        if (f.severity === "warning") hasWarning = true;
        return {
          id: f.findingId,
          title: f.title,
          severity: f.severity,
          recommendation: f.recommendation,
        };
      });

      if (hasCritical) status = "critical";
      else if (hasWarning) status = "warning";

      // Graded coverage gate (same helper as assessment_doc_gate / the CIO
      // narrative trigger, see doc-gate-coverage.ts): a run below the real
      // evaluable-check coverage bar does not get a fabricated numeric score.
      // Previously `score` defaulted to 100 ("healthy") whenever checksTotal
      // was 0 — the worst case of this class of bug, a fully-dark run reading
      // as a clean bill of health. Findings/status stay derived from whatever
      // real findings actually fired (real signal regardless of overall
      // coverage); only the composite score is coverage-gated.
      const cov = evaluateDocGateCoverage({
        checksOk: latestRun.checksOk ?? 0,
        checksLicenseGap: latestRun.checksLicenseGap ?? 0,
        checksError: latestRun.checksError ?? 0,
        checksTotal: latestRun.checksTotal ?? 0,
      });
      let score: number | null = null;
      const summaryObj = latestRun.summary as Record<string, unknown> | null;
      if (cov.proceed) {
        if (summaryObj && typeof summaryObj.compositeScore === "number") {
          score = summaryObj.compositeScore;
        } else if (latestRun.checksTotal > 0) {
          score = Math.round((latestRun.checksOk / latestRun.checksTotal) * 100);
        }
      }

      res.json({
        serviceSlug,
        score,
        status,
        findings,
        evaluatedAt: latestRun.completedAt?.toISOString() ?? latestRun.createdAt.toISOString(),
      });
    } catch (err) {
      log.error({ err }, "GET /portal/diagnostics/results/:serviceSlug error");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

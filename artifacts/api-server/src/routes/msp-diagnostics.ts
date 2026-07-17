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
 *     — Get run details + structured findings.
 *
 *   GET  /api/msp/customers/:customerId/diagnostics/runs/:runId/sse
 *     — SSE stream: per-check progress → complete/error events.
 *       Uses Bearer JWT in ?jwt= query param (EventSource can't send headers).
 *
 * Customer portal routes (require CustomerUser role):
 *   GET  /api/portal/diagnostics/latest
 *     — Customer's latest run + findings summary (read-only).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  mspCustomersTable,
  mspUsersTable,
  clientServicesTable,
  servicesTable,
  industryBenchmarkReferenceTable,
} from "@workspace/db";
import { eq, and, desc, count, or, sql } from "drizzle-orm";
import { requireRole, requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "tenant.portal" });
import { runDiagnostics } from "../lib/diagnostics-runner";
import { registerDiagnosticsRunSSEClient } from "../lib/sse-broadcast";
import { calculateArchitectureHealthScore } from "../lib/health-engine";
import { computeDisplayHealth } from "../lib/health-display";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────


async function assertCustomerBelongsToMsp(customerId: number, mspId: number): Promise<void> {
  if (!mspId) return;
  const [row] = await db
    .select({ id: mspCustomersTable.id })
    .from(mspCustomersTable)
    .where(and(eq(mspCustomersTable.id, customerId), eq(mspCustomersTable.mspId, mspId)))
    .limit(1);
  if (!row) throw Object.assign(new Error("Customer not found"), { status: 404 });
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
        .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId, tenantId: mspCustomersTable.tenantId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      // 2. Authorization: PlatformAdmin/admin can diagnose any customer.
      //    MSPOperator/MSPAdmin must own this customer.
      const isPlatformAdmin = req.user!.mspRole === "PlatformAdmin" || req.user!.role === "admin";
      if (!isPlatformAdmin) {
        await assertCustomerBelongsToMsp(customerId, customer.mspId);
      }

      // 3. Resolve packageKey.  Body override is accepted (useful for testing),
      //    but "default" and empty strings are treated as "not provided".
      //    Primary source: the customer's active monitoring subscription
      //    (msp_users → client_services → services.type_attributes->>'packageKey').
      //    Fallback: core:security-baseline (always exists, has real checks).
      let packageKey = String((req.body as Record<string, unknown>).packageKey ?? "").trim();
      if (!packageKey || packageKey === "default") {
        const [pkgRow] = await db
          .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
          .from(mspUsersTable)
          .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, mspUsersTable.userId))
          .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
          .where(
            and(
              eq(mspUsersTable.customerId, customerId),
              eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
              eq(clientServicesTable.status, "active"),
            )
          )
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
      void runDiagnostics({ customerId, packageKey, existingRunId: runId, triggeredByUserId })
        .catch((err: unknown) => {
          log.error({ err, runId }, "msp-diagnostics: async run failed");
        });

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
        .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      const isPlatformAdmin = req.user!.mspRole === "PlatformAdmin" || req.user!.role === "admin";
      if (!isPlatformAdmin) {
        await assertCustomerBelongsToMsp(customerId, customer.mspId);
      }

      const [pkgRow] = await db
        .select({
          packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'`,
          serviceId: servicesTable.id,
          serviceName: servicesTable.name,
        })
        .from(mspUsersTable)
        .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, mspUsersTable.userId))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(
          and(
            eq(mspUsersTable.customerId, customerId),
            eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
            eq(clientServicesTable.status, "active"),
          )
        )
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
        .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
      const isPlatformAdmin = req.user!.mspRole === "PlatformAdmin" || req.user!.role === "admin";
      if (!isPlatformAdmin) await assertCustomerBelongsToMsp(customerId, customer.mspId);

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
        .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
      const isPlatformAdmin = req.user!.mspRole === "PlatformAdmin" || req.user!.role === "admin";
      if (!isPlatformAdmin) await assertCustomerBelongsToMsp(customerId, customer.mspId);

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

      res.json({ run, findings });
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
        const allowedRoles = ["MSPOperator", "MSPAdmin", "PlatformAdmin"];
        if (!userRole || !allowedRoles.includes(userRole)) {
          res.status(403).json({ error: "Insufficient role" }); return;
        }
        if (userMspId) {
          await assertCustomerBelongsToMsp(customerId, userMspId);
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
//   a) msp_users.customer_id was null at login time (stale JWT / data-gap window)
//   b) The user is a pre-purchase orphaned tenant with no msp_customers row yet
//
// Fallback: do a fresh msp_users lookup so a stale JWT doesn't hide real data.

router.get(
  "/portal/diagnostics/latest",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Primary: use customerId from JWT. Fallback: fresh DB read (stale-JWT window).
      let customerId = user.customerId ?? null;
      if (!customerId) {
        const { mspUsersTable: muTable } = await import("@workspace/db");
        const [freshMu] = await db
          .select({ customerId: muTable.customerId })
          .from(muTable)
          .where(eq(muTable.userId, user.id))
          .limit(1);
        customerId = freshMu?.customerId ?? null;
      }

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

// ── GET /api/portal/health-benchmark ─────────────────────────────────────────
// Customer-facing: returns per-pillar displayScore (0–100, higher = healthier)
// plus industry benchmark reference data for the Benchmarking widget.
//
// Never exposes raw risk scores or breakdown.contributions.

router.get(
  "/portal/health-benchmark",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      let customerId = user.customerId ?? null;
      if (!customerId) {
        const { mspUsersTable: muTable } = await import("@workspace/db");
        const [freshMu] = await db
          .select({ customerId: muTable.customerId })
          .from(muTable)
          .where(eq(muTable.userId, user.id))
          .limit(1);
        customerId = freshMu?.customerId ?? null;
      }

      if (!customerId) {
        res.json({ pillars: [], asOfDate: null });
        return;
      }

      const [output, { rules, groups }, benchmarks] = await Promise.all([
        calculateArchitectureHealthScore(customerId),
        fetchSignalRulesAndGroups(),
        db.select().from(industryBenchmarkReferenceTable),
      ]);

      const displayPillars = computeDisplayHealth(output, rules, groups);

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

// ── GET /api/portal/assessment-results/:serviceSlug ───────────────────────────
// Customer-facing: returns the assessment run data formatted for the dashboard.

router.get(
  "/portal/assessment-results/:serviceSlug",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const serviceSlug = req.params["serviceSlug"] as string;

      let customerId = user.customerId ?? null;
      if (!customerId) {
        const { mspUsersTable: muTable } = await import("@workspace/db");
        const [freshMu] = await db
          .select({ customerId: muTable.customerId })
          .from(muTable)
          .where(eq(muTable.userId, user.id))
          .limit(1);
        customerId = freshMu?.customerId ?? null;
      }

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

      let score = 100;
      const summaryObj = latestRun.summary as Record<string, unknown> | null;
      if (summaryObj && typeof summaryObj.compositeScore === "number") {
        score = summaryObj.compositeScore;
      } else if (latestRun.checksTotal > 0) {
        score = Math.round((latestRun.checksOk / latestRun.checksTotal) * 100);
      }

      res.json({
        serviceSlug,
        score,
        status,
        findings,
        evaluatedAt: latestRun.completedAt?.toISOString() ?? latestRun.createdAt.toISOString(),
      });
    } catch (err) {
      log.error({ err }, "GET /portal/assessment-results/:serviceSlug error");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;

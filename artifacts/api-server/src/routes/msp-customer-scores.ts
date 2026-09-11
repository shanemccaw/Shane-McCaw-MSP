/**
 * msp-customer-scores.ts — Feature #3557 (Tenant Scores and Results, MSP
 * Console), Git #3558.
 *
 * MSP-side view of a single customer's composite score, per-engine scores,
 * and pillar breakdown — the same real `tenant_engine_snapshots` data behind
 * `GET /portal/dashboard` (portal-customer-engines.ts), so an MSP operator
 * sees exactly what their customer sees. Confirmed real gap: zero MSP-console
 * routes exposed this before now (see #3557's own body).
 *
 *   GET /api/msp/customers/:customerId/scores
 *
 * Ownership: `assertCustomerAccess` (the same chokepoint every other
 * single-customer `/api/msp/*` route uses, e.g. msp-remediation-tracker-
 * scores.ts, msp-engine-history.ts) — the target customer must be a tenant
 * belonging to the caller's own MSP, further narrowed by per-staff customer
 * scoping. A customerId outside that book 404s without disclosing existence,
 * matching the convention those sibling routes already established.
 *
 * Auth: requireCapability("ladder.msp-operator") — MSPOperator+ (MSPAdmin,
 * PlatformAdmin).
 *
 * Paywall — real, confirmed decision (Git #3558 dispatch, following #3557's
 * own "real decision needed before building: confirm this, don't assume"):
 * `/portal/dashboard`'s #164 free-tier paywall redacts finding/recommendation
 * TEXT behind a paid assessment SOW (composite/pillar SCORES are never
 * gated). That gate does NOT apply here — Shane is the one doing the work on
 * this tenant regardless of the customer's own paid status, so an MSP
 * operator always sees full finding/recommendation text. Do not reintroduce
 * the SOW-status check from portal-customer-engines.ts on this route.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantsTable,
  tenantEngineSnapshotsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface PriorityItem {
  checkKey: string;
  severity: "critical" | "warning";
  title: string | null;
  description: string | null;
}

/** Same resolve+authorize idiom as msp-remediation-tracker-scores.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

router.get(
  "/msp/customers/:customerId/scores",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const snapshots = await db
        .select({
          engineKey: tenantEngineSnapshotsTable.engineKey,
          score: tenantEngineSnapshotsTable.score,
          breakdown: tenantEngineSnapshotsTable.breakdown,
          runId: tenantEngineSnapshotsTable.runId,
          capturedAt: tenantEngineSnapshotsTable.capturedAt,
        })
        .from(tenantEngineSnapshotsTable)
        .where(eq(tenantEngineSnapshotsTable.customerId, customerId))
        .orderBy(desc(tenantEngineSnapshotsTable.capturedAt));

      const scores: Record<string, number> = {};
      const pillars: Record<string, { score: number; status: "complete"; findings: string[]; recommendations: string[] }> = {};
      let compositeScore = 0;
      let compositeCount = 0;
      let runId: string | null = null;
      let generatedAt: string | null = null;

      for (const snap of snapshots) {
        if (scores[snap.engineKey] === undefined && snap.score !== null) {
          scores[snap.engineKey] = snap.score;
          compositeScore += snap.score;
          compositeCount++;

          if (!runId && snap.runId) runId = snap.runId;
          if (!generatedAt && snap.capturedAt) generatedAt = snap.capturedAt.toISOString();

          const breakdown = Array.isArray(snap.breakdown) ? snap.breakdown : [];
          const findings: string[] = [];
          const recommendations: string[] = [];

          for (const item of breakdown) {
            if (typeof item === "object" && item !== null) {
              const b = item as Record<string, unknown>;
              if (b.finding) findings.push(String(b.finding));
              else if (b.message) findings.push(String(b.message));
              else if (b.label) findings.push(String(b.label));

              if (b.recommendation) recommendations.push(String(b.recommendation));
              else if (b.action) recommendations.push(String(b.action));
            }
          }

          // No paywall gate — see file header. An MSP operator always sees
          // full finding/recommendation text, unlike the customer-facing
          // /portal/dashboard route this mirrors.
          pillars[snap.engineKey] = { score: snap.score, status: "complete", findings, recommendations };
        }
      }

      // priorityItems: the customer's real critical/warning diagnostic
      // findings from their most recent scan run, worst-severity-first — same
      // "latest run for this customer" + severity-filter pattern as
      // portal-customer-engines.ts's own priorityItems block, unredacted for
      // the same reason the pillars above are.
      let priorityItems: PriorityItem[] = [];
      const [latestFindingsRun] = await db
        .select({ runId: mspDiagnosticFindingsTable.runId })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(1);

      if (latestFindingsRun) {
        const findingRows = await db
          .select({
            checkKey: mspDiagnosticFindingsTable.checkKey,
            severity: mspDiagnosticFindingsTable.severity,
            title: mspDiagnosticFindingsTable.title,
            description: mspDiagnosticFindingsTable.description,
            createdAt: mspDiagnosticFindingsTable.createdAt,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.runId, latestFindingsRun.runId),
              // #3102-style defense-in-depth — scope by tenant directly rather
              // than by inference that run_id never spans customers.
              eq(mspDiagnosticFindingsTable.customerId, customerId),
              inArray(mspDiagnosticFindingsTable.severity, ["critical", "warning"]),
            ),
          );

        const severityRank: Record<string, number> = { critical: 0, warning: 1 };
        findingRows.sort(
          (a, b) =>
            severityRank[a.severity] - severityRank[b.severity] ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );

        priorityItems = findingRows.slice(0, 5).map((row) => ({
          checkKey: row.checkKey,
          severity: row.severity as "critical" | "warning",
          title: row.title,
          description: row.description,
        }));
      }

      const [customer] = await db
        .select({ status: tenantsTable.status, customerName: tenantsTable.customerName })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const telemetryStatus = customer?.status === "onboarding" ? "in_progress" : "completed";

      res.json({
        customerId,
        customerName: customer?.customerName ?? null,
        customerStatus: customer?.status ?? null,
        telemetryStatus,
        scores: {
          security: scores.security ?? 0,
          health: scores.health ?? 0,
          drift: scores.drift ?? 0,
          sla: scores.sla ?? 0,
          scope_creep: scores.scope_creep ?? 0,
          ...scores,
        },
        results: {
          status: telemetryStatus === "in_progress" ? "running" : "complete",
          runId,
          generatedAt,
          summary: {
            compositeScore: compositeCount > 0 ? Math.round(compositeScore / compositeCount) : null,
            priorityItems,
          },
          pillars,
        },
      });
    } catch (err) {
      log.error({ err, customerId }, "msp-customer-scores: failed to load customer scores");
      res.status(500).json({ error: "Unable to load this customer's scores right now. Please try again shortly." });
    }
  },
);

export default router;

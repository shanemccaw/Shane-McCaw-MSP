/**
 * admin-testbed.ts
 *
 * Git #986 (Epic #803) — Environment-gated testbed maintenance endpoints.
 *
 * Shane's scope decision (issue #986): "this is all going to a test server,
 * there is no real data except my two test tenants. The real scope here should
 * be that NONE of these endpoints are accessible outside the dev environment.
 * ... any tenant in the dev environment as far as I am concerned is a test
 * tenant."
 *
 * So the safety model here is an ENVIRONMENT-level gate, not a per-request
 * isTestbed flag on every row: every route is structurally 403-dead unless the
 * server is running against a real Replit DEV origin (a *.replit.dev workspace
 * preview / local dev). The gate is isReplitDevEnvironment() from lib/stripe.ts
 * — the SAME REPLIT_DOMAINS check that selects sk_test_ vs sk_live_ Stripe keys,
 * deliberately reused rather than a second dev/prod detection mechanism, so the
 * two can never disagree. There is NO request parameter or header that can
 * bypass it.
 *
 * Routes (dev-origin-gated FIRST, then requireAdminOrIngestToken so the headless
 * BuildConsole test harness (#898) can reach them with BUILD_TRACKER_INGEST_TOKEN
 * exactly as #901/#965 do):
 *   POST /api/admin/testbed/reset                  — reset ONE testbed customer's
 *                                                    DB state to a known baseline
 *   POST /api/admin/testbed/teardown-graph-writes  — reverse real M365 Graph
 *                                                    writes a test run made, via
 *                                                    Launch Control's own
 *                                                    rollbackExecution() (NOT a
 *                                                    second undo mechanism)
 *
 * Everything is logged loudly on the admin.testbed channel — what was reset /
 * torn down, from where, and an explicit record that the environment gate was
 * evaluated and which way it went — because these operations destroy state and
 * #986 requires the gate firing to be auditable.
 */

import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  tenantEngineOverridesTable,
  baselineActionTemplateAuditLogTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdminOrIngestToken } from "../middlewares/requireAuth";
import { isReplitDevEnvironment } from "../lib/stripe";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.testbed" });

const router: IRouter = Router();

/**
 * Describe where a request came from, for the audit line. Best-effort — a
 * proxied dev server may only expose some of these.
 */
function describeOrigin(req: Request): Record<string, unknown> {
  return {
    host: req.headers.host ?? null,
    ip: req.ip ?? null,
    forwardedFor: req.headers["x-forwarded-for"] ?? null,
    userId: req.user?.id ?? null,
    userEmail: req.user?.email ?? null,
    replitDomains: process.env.REPLIT_DOMAINS ?? null,
  };
}

/**
 * THE load-bearing safety gate. Structurally refuses every testbed route unless
 * the server is running against a real Replit DEV origin — regardless of any
 * request parameter, body field, or header (there is no override). Reuses
 * isReplitDevEnvironment() (lib/stripe.ts), the exact same REPLIT_DOMAINS check
 * that picks sk_test_ vs sk_live_. Logs loudly either way so the gate's decision
 * is always in the record, per #986's "confirm the environment gate fired"
 * requirement.
 */
function requireDevOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!isReplitDevEnvironment()) {
    log.warn(
      { gate: "dev-origin", gatePassed: false, path: req.path, ...describeOrigin(req) },
      "admin-testbed: environment gate BLOCKED — server is not a .replit.dev dev origin; testbed endpoint refused",
    );
    res.status(403).json({
      error:
        "Testbed endpoints are only available in the dev environment (a .replit.dev origin). This server is running as a real deployment — refused.",
      gate: "dev-origin",
    });
    return;
  }
  log.info(
    { gate: "dev-origin", gatePassed: true, path: req.path, ...describeOrigin(req) },
    "admin-testbed: environment gate PASSED — dev origin confirmed",
  );
  next();
}

// ── POST /admin/testbed/reset ─────────────────────────────────────────────────
//
// Reset ONE testbed customer's accumulated test-run state back to a known
// baseline. Takes an explicit customerId (tenants.id) — never a blind full-DB
// wipe — for precision and diagnosability, per #986 ("still take a real,
// explicit parameter identifying which testbed tenant/customer to reset").
// No per-row isTestbed filtering: the dev-origin gate above IS the safety
// boundary, and within dev "any tenant ... is a test tenant" (Shane).
//
// Baseline = this customer's simulator/test scaffolding cleared:
//   - tenant_engine_overrides       (injected Graph field overrides for sim runs)
//   - baseline_action_template_audit_log rows for this customer (the write-action
//                                    execution history recorded by test runs)
// Both are unambiguously test-run artifacts and both carry an explicit customer
// scope. The set is deliberately conservative and lives in ONE transaction here;
// extend it in place as new test-generated, customer-scoped tables are added.
//
// ORDERING vs teardown: this clears the write-action audit log that the Graph
// teardown reads. Run reset as a clean-slate BEFORE a test run, or run
// teardown-graph-writes BEFORE a post-run reset — never rely on the audit log
// surviving a reset.

router.post(
  "/admin/testbed/reset",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { customerId?: number };
    const customerId =
      typeof body?.customerId === "number" && Number.isInteger(body.customerId)
        ? body.customerId
        : NaN;
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({
        error:
          "customerId (a positive integer tenants.id) is required — reset is scoped to one testbed customer, never a blind full-DB wipe",
      });
      return;
    }

    try {
      const [customer] = await db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.customerName,
          tenantId: tenantsTable.tenantId,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: `No tenant found with id ${customerId}` });
        return;
      }

      // The actual reset SQL — one transaction, everything scoped to this
      // customer. Written here as the endpoint's own deliverable (never run by
      // hand in a Claude session); Shane reviews the logic in code. .returning()
      // gives an exact per-table count for the audit line.
      const cleared = await db.transaction(async (tx) => {
        const engineOverrides = await tx
          .delete(tenantEngineOverridesTable)
          .where(eq(tenantEngineOverridesTable.testbedCustomerId, customerId))
          .returning({ id: tenantEngineOverridesTable.id });

        // afterSnapshot.customerId is the customer a write-action run targeted
        // (recorded by runBaselineTemplateAgainstTenant). Compare as TEXT
        // (jsonb ->> yields text) rather than ::int-casting — a cast would throw
        // the whole transaction if any row ever stored a non-numeric value
        // there, whereas a text match of the extracted value against the
        // customerId's string form is exact and cast-safe. customerId is a
        // validated integer, still passed as a bound parameter.
        const auditRows = await tx
          .delete(baselineActionTemplateAuditLogTable)
          .where(
            sql`(${baselineActionTemplateAuditLogTable.afterSnapshot} ->> 'customerId') = ${String(customerId)}`,
          )
          .returning({ id: baselineActionTemplateAuditLogTable.id });

        return {
          tenantEngineOverridesDeleted: engineOverrides.length,
          writeActionAuditRowsDeleted: auditRows.length,
        };
      });

      log.info(
        {
          action: "reset",
          gate: "dev-origin",
          gatePassed: true,
          customerId: customer.id,
          tenantId: customer.tenantId,
          customerName: customer.name,
          cleared,
          ...describeOrigin(req),
        },
        `admin-testbed: RESET testbed customer ${customer.id} (${customer.name ?? "unnamed"}) to baseline — cleared ${cleared.tenantEngineOverridesDeleted} engine override(s) + ${cleared.writeActionAuditRowsDeleted} write-action audit row(s)`,
      );

      res.json({
        reset: true,
        customer: { id: customer.id, name: customer.name, tenantId: customer.tenantId },
        cleared,
      });
    } catch (err) {
      log.error({ err, customerId }, "admin-testbed: reset failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to reset testbed state",
      });
    }
  },
);

// ── POST /admin/testbed/teardown-graph-writes ─────────────────────────────────
//
// Reverse the real M365 Graph write actions a test run made against a tenant.
// This implements NO new undo logic — it reuses Launch Control's own
// rollbackExecution() (lib/workflow-executor.ts) per write: read that write's
// audit row (requestVariables + afterSnapshot), then replay the paired REVERSE
// template (self-pair boolean-invert / Teams-membership special-case), exactly
// as POST /api/msp/:mspId/launch-control/rollback/:auditLogId already does.
//
// Contract is an EXPLICIT list of auditLogIds — the writes this test run made.
// Every Launch-Control / write-action /execute response returns the auditLogId
// of the write it performed; a test run collects those and hands them back here.
// Explicit (rather than "enumerate everything for this customer") is deliberate:
// it is precise, idempotent, and avoids the ping-pong hazard of re-enumerating a
// customer whose rollback rows are themselves action:"executed" writes. Undone
// in the given order — pass them newest-first (LIFO) to unwind dependent writes.
//
// Each id is attempted independently; a not-found / not-'executed' /
// not-reversible / already-undone write is recorded as failed and skipped, never
// aborting the rest of the teardown.

router.post(
  "/admin/testbed/teardown-graph-writes",
  requireDevOrigin,
  requireAdminOrIngestToken(),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { auditLogIds?: unknown };

    if (!Array.isArray(body?.auditLogIds)) {
      res.status(400).json({
        error:
          "auditLogIds (number[]) is required — the audit-log ids of the write actions this test run made (each /execute response returns one)",
      });
      return;
    }

    const auditLogIds = body.auditLogIds
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (auditLogIds.length === 0) {
      res.status(400).json({
        error: "auditLogIds contained no valid positive integers",
      });
      return;
    }

    try {
      // The one production undo path — Launch Control's reverse-template rollback.
      const { rollbackExecution } = await import("../lib/workflow-executor");

      const results: Array<{
        auditLogId: number;
        rolledBack: boolean;
        status?: number;
        rollbackAuditLogId?: number;
        reason?: string;
      }> = [];

      for (const id of auditLogIds) {
        try {
          const r = await rollbackExecution(id);
          results.push({
            auditLogId: id,
            rolledBack: r.success,
            status: r.status,
            rollbackAuditLogId: r.rollbackAuditLogId,
            reason: r.success ? undefined : r.errorType ?? "reverse call did not succeed",
          });
        } catch (itemErr) {
          // rollbackExecution throws for not-found / not-'executed' /
          // not-reversible / missing customer-tenant context — record and
          // continue, never abort the rest.
          results.push({
            auditLogId: id,
            rolledBack: false,
            reason: itemErr instanceof Error ? itemErr.message : "rollback failed",
          });
        }
      }

      const rolledBack = results.filter((r) => r.rolledBack).length;
      const failed = results.length - rolledBack;

      log.info(
        {
          action: "teardown-graph-writes",
          gate: "dev-origin",
          gatePassed: true,
          requested: auditLogIds.length,
          rolledBack,
          failed,
          results,
          ...describeOrigin(req),
        },
        `admin-testbed: TEARDOWN reversed ${rolledBack}/${auditLogIds.length} Graph write(s) via Launch Control rollbackExecution (${failed} not reversed)`,
      );

      res.json({ toreDown: true, requested: auditLogIds.length, rolledBack, failed, results });
    } catch (err) {
      log.error({ err }, "admin-testbed: teardown-graph-writes failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to tear down Graph writes",
      });
    }
  },
);

export default router;

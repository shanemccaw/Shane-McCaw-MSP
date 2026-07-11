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
} from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireRole, requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { runDiagnostics } from "../lib/diagnostics-runner";
import { registerDiagnosticsRunSSEClient } from "../lib/sse-broadcast";
import jwt from "jsonwebtoken";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMspId(req: Request): number {
  const user = req.user!;
  if (user.role === "admin") {
    const q = parseInt(String((req.query as Record<string, unknown>).mspId ?? ""), 10);
    return isNaN(q) ? 0 : q;
  }
  if (!user.mspId) throw new Error("No mspId on token");
  return user.mspId;
}

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
// Fire-and-forget: creates the run record and immediately returns the runId.
// The actual execution runs async; the caller subscribes to SSE for progress.

router.post(
  "/msp/customers/:customerId/diagnostics/run",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customerId" }); return; }

      const mspId = resolveMspId(req);
      await assertCustomerBelongsToMsp(customerId, mspId);

      const packageKey = String((req.body as Record<string, unknown>).packageKey ?? "default");
      const triggeredByUserId = req.user!.id;

      // Create the run row first so the UI can subscribe to SSE immediately
      const { mspDiagnosticRunsTable: runTable, mspCustomersTable: custTable } = await import("@workspace/db");
      const [customer] = await db
        .select({ id: custTable.id })
        .from(custTable)
        .where(eq(custTable.id, customerId))
        .limit(1);
      if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

      const [pendingRun] = await db
        .insert(runTable)
        .values({ mspId, customerId, packageKey, status: "pending", triggeredByUserId })
        .returning({ runId: runTable.runId });

      const runId = pendingRun!.runId;

      res.status(202).json({ runId, status: "pending", message: "Diagnostics run started" });

      // Fire-and-forget execution
      void (async () => {
        try {
          // Update to running and execute
          const { eq: eqFn } = await import("drizzle-orm");
          await db
            .update(runTable)
            .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
            .where(eqFn(runTable.runId, runId));

          await runDiagnostics({ mspId, customerId, packageKey, triggeredByUserId });
        } catch (err) {
          logger.error({ err, runId }, "msp-diagnostics: async run failed");
        }
      })();

    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "POST /msp/customers/:id/diagnostics/run error");
      if (!res.headersSent) res.status(status).json({ error: message });
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

      const mspId = resolveMspId(req);
      await assertCustomerBelongsToMsp(customerId, mspId);

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
      logger.error({ err }, "GET /msp/customers/:id/diagnostics error");
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

      const mspId = resolveMspId(req);
      await assertCustomerBelongsToMsp(customerId, mspId);

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
      logger.error({ err }, "GET /msp/customers/:id/diagnostics/runs/:runId error");
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
        logger.info({ runId, customerId }, "diagnostics SSE client disconnected");
      });

      const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
      }, 25_000);

      res.on("close", () => clearInterval(heartbeat));

    } catch (err) {
      logger.error({ err }, "GET /msp/customers/:id/diagnostics/runs/:runId/sse error");
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /api/portal/diagnostics/latest ───────────────────────────────────────
// Customer-facing: returns the customer's latest completed diagnostics run
// and a summary of findings (no raw extracted_properties).

router.get(
  "/portal/diagnostics/latest",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const customerId = user.customerId;
      if (!customerId) { res.json({ run: null, findings: [] }); return; }

      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(and(
          eq(mspDiagnosticRunsTable.customerId, customerId),
          eq(mspDiagnosticRunsTable.status, "completed"),
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
      logger.error({ err }, "GET /portal/diagnostics/latest error");
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
      logger.error({ err }, "GET /portal/diagnostics/runs/:runId error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

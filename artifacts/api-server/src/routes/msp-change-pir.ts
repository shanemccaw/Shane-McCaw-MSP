/**
 * msp-change-pir.ts — the Post-Implementation Review record (Git #1502): close
 * codes, verification evidence, and the drift re-scan that closes the loop
 * against the same engine that detects unauthorized change.
 *
 * ── Why this lives on the MSP operator surface ──────────────────────────────
 * Same posture as `msp-change-executions.ts` next to it: reviewing whether an
 * executed change actually landed is a delivery action the MSP performs.
 * Floors at `MSPOperator` + `resolveMspIdStrict`, matching every
 * session-scoped `/msp/...` route with no `:mspId` in the URL.
 *
 * ── SCOPE STOP (Git #1502) ───────────────────────────────────────────────────
 * This route, its store (`msp-change-pir-store.ts`) and its pure derivations
 * (`msp-change-pir.ts`) are the full deliverable — schema, migration, routes,
 * Wire* interfaces. There is no UI to wire: `artifacts/portal` has no pages and
 * `Design/portal/` carries no export for this surface. Proven against the local
 * database directly (see the build's bookend for the queries).
 *
 * ── Immutability ─────────────────────────────────────────────────────────────
 * A PIR ATTACHES to the execution it reviews — it never edits the execution or
 * its CR, and it is never edited itself: `recordPir` rejects a second PIR
 * against an already-reviewed execution (409) rather than overwriting it,
 * matching `cr_events`'s own append-only discipline. A correction is a NEW
 * execution + a NEW PIR, not a rewrite of this one.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db, mspChangeRequestsTable, CR_PIR_CLOSE_CODES } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { logger } from "../lib/logger";
import { toWireCrPir } from "../lib/msp-change-pir";
import { getPirForExecution, listPirsForChange, listPirsForMsp, recordPir } from "../lib/msp-change-pir-store";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

function mspContext(req: Request, res: Response): number | null {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return null;
  }
  return mspId;
}

const recordPirSchema = z.object({
  closeCode: z.enum(CR_PIR_CLOSE_CODES),
  summary: z.string().trim().min(1).max(4_000),
  issuesNoted: z.string().trim().max(4_000).optional(),
});

// POST /api/msp/change-control/executions/:id/pir
// Record the Post-Implementation Review for one execution — close code,
// verification evidence, and a real drift re-scan (Conditional Access only;
// every other category is honestly recorded `not_applicable`).
router.post("/msp/change-control/executions/:id/pir", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const executionId = Number(req.params.id);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    res.status(400).json({ error: "Invalid execution id" });
    return;
  }
  const parsed = recordPirSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const user = req.user!;
    const result = await recordPir({
      executionId,
      mspId,
      closeCode: parsed.data.closeCode,
      summary: parsed.data.summary,
      issuesNoted: parsed.data.issuesNoted ?? null,
      reviewedBy: user.email || `person:${personIdForUser(user.id)}`,
      reviewedByPersonId: personIdForUser(user.id),
    });
    if (!result.ok) {
      const status = result.reason === "execution_not_found" ? 404 : 409;
      const error =
        result.reason === "execution_not_found"
          ? "Execution not found for this MSP"
          : "This execution already has a Post-Implementation Review — a correction requires a new execution record";
      res.status(status).json({ error });
      return;
    }
    res.status(201).json({ pir: toWireCrPir(result.pir) });
  } catch (err) {
    log.error({ err, mspId, executionId }, "cr-pir: record failed");
    res.status(500).json({ error: "Failed to record the Post-Implementation Review" });
  }
});

// GET /api/msp/change-control/executions/:id/pir
// The PIR for one execution, if one has been recorded.
router.get("/msp/change-control/executions/:id/pir", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const executionId = Number(req.params.id);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    res.status(400).json({ error: "Invalid execution id" });
    return;
  }
  try {
    const row = await getPirForExecution(mspId, executionId);
    res.status(200).json({ pir: row ? toWireCrPir(row) : null });
  } catch (err) {
    log.error({ err, mspId, executionId }, "cr-pir: get failed");
    res.status(500).json({ error: "Failed to load the Post-Implementation Review" });
  }
});

// GET /api/msp/change-control/pirs?changeRequestId=<n>
// PIRs for one change (every execution it's had reviewed), or the MSP's recent
// PIRs when no id is given.
router.get("/msp/change-control/pirs", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  try {
    const raw = req.query.changeRequestId;
    if (raw !== undefined) {
      const changeRequestId = Number(raw);
      if (!Number.isInteger(changeRequestId) || changeRequestId <= 0) {
        res.status(400).json({ error: "Invalid changeRequestId" });
        return;
      }
      const [cr] = await db
        .select({ id: mspChangeRequestsTable.id })
        .from(mspChangeRequestsTable)
        .where(and(eq(mspChangeRequestsTable.id, changeRequestId), eq(mspChangeRequestsTable.mspId, mspId)))
        .limit(1);
      if (!cr) {
        res.status(404).json({ error: "Change request not found for this MSP" });
        return;
      }
      const rows = await listPirsForChange(mspId, changeRequestId);
      res.status(200).json({ pirs: rows.map(toWireCrPir) });
      return;
    }
    const rows = await listPirsForMsp(mspId);
    res.status(200).json({ pirs: rows.map(toWireCrPir) });
  } catch (err) {
    log.error({ err, mspId }, "cr-pir: list failed");
    res.status(500).json({ error: "Failed to load Post-Implementation Reviews" });
  }
});

export default router;

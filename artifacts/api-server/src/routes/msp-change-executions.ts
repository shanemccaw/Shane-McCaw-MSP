/**
 * msp-change-executions.ts — the Change Control EXECUTION record (Git #1499):
 * the record that binds an authorized change to the executor that carried it
 * out, the crRef writeback on completion, planned-vs-actual reconciliation, and
 * rollback-as-inverse-CR.
 *
 * ── Why this lives on the MSP operator surface ──────────────────────────────
 * A CR authorizes a change; recording who executed it, attesting a human
 * action, reconciling the plan and raising a rollback are all delivery actions
 * the MSP performs. Same posture as `msp-changes.ts` and
 * `msp-change-control-cab.ts` next to it: floors at `MSPOperator` +
 * `resolveMspIdStrict`, matching every session-scoped `/msp/...` route with no
 * `:mspId` in the URL.
 *
 * ── SCOPE STOP (Git #1499) ──────────────────────────────────────────────────
 * This route, its store (`msp-change-execution-store.ts`) and its pure
 * derivations (`msp-change-execution.ts`) are the full deliverable — schema,
 * migration, routes, Wire* interfaces. There is no UI to wire: `artifacts/portal`
 * has no pages and `Design/portal/` carries no export for this surface. Proven
 * against the local database directly (see the build's bookend for the queries).
 *
 * ── One approval model, one execution model ─────────────────────────────────
 * A rollback is itself a change: `/change-requests/:id/rollback` raises a new
 * INVERSE CR through the SAME #1496 approval seeding (`materializeApprovalsForChange`)
 * every forward change uses. There is no silent revert button and no second
 * approval path — the inverse clears its own approval and executes through the
 * same authorization gate.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db, mspChangeRequestsTable, CHANGE_REQUEST_IMPLEMENTERS, CR_ROLLBACK_OUTCOMES } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { logger } from "../lib/logger";
import { formatChangeRequestCode, toWireCrExecution } from "../lib/msp-change-execution";
import {
  attestHumanAction,
  getExecution,
  listExecutionsForChange,
  listExecutionsForMsp,
  raiseRollbackChangeRequest,
  reconcileExecutionPlan,
  recordExecution,
  verifyRollback,
  type ExecutionActor,
} from "../lib/msp-change-execution-store";

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

/** The acting operator's identity — always the MSP-side person on this surface. */
function actorIdentity(req: Request): ExecutionActor {
  const user = req.user!;
  return { email: user.email ?? "", personId: personIdForUser(user.id) };
}

/** Load a CR scoped to the caller's MSP, or null. */
async function loadScopedChange(mspId: number, changeRequestId: number) {
  const [cr] = await db
    .select({ id: mspChangeRequestsTable.id, tenantId: mspChangeRequestsTable.tenantId, implementer: mspChangeRequestsTable.implementer })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, changeRequestId), eq(mspChangeRequestsTable.mspId, mspId)))
    .limit(1);
  return cr ?? null;
}

// GET /api/msp/change-control/executions?changeRequestId=<n>
// Executions for one change, or the MSP's recent executions when no id is given.
router.get("/msp/change-control/executions", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
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
      const rows = await listExecutionsForChange(mspId, changeRequestId);
      res.status(200).json({ executions: rows.map(toWireCrExecution) });
      return;
    }
    const rows = await listExecutionsForMsp(mspId);
    res.status(200).json({ executions: rows.map(toWireCrExecution) });
  } catch (err) {
    log.error({ err, mspId }, "cr-executions: list failed");
    res.status(500).json({ error: "Failed to load executions" });
  }
});

const humanActionSchema = z.object({
  changeRequestId: z.number().int().positive(),
  implementer: z.enum(CHANGE_REQUEST_IMPLEMENTERS).optional(),
  attestationNote: z.string().trim().max(2_000).optional(),
});

// POST /api/msp/change-control/executions/human-action
// Record — and attest — a human action against a CR. A human change has no code
// path to confirm it, so this attests it at record time: who, when, against
// which CR.
router.post("/msp/change-control/executions/human-action", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const parsed = humanActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const cr = await loadScopedChange(mspId, parsed.data.changeRequestId);
    if (!cr) {
      res.status(404).json({ error: "Change request not found for this MSP" });
      return;
    }
    const actor = actorIdentity(req);
    const execution = await recordExecution({
      changeRequestId: cr.id,
      mspId,
      tenantId: cr.tenantId,
      executorKind: "human_action",
      implementer: parsed.data.implementer ?? cr.implementer ?? "msp",
      attestedBy: actor.email || `person:${actor.personId}`,
      attestedByPersonId: actor.personId,
      attestationNote: parsed.data.attestationNote ?? null,
    });
    res.status(201).json({ execution: toWireCrExecution(execution) });
  } catch (err) {
    log.error({ err, mspId }, "cr-executions: human-action record failed");
    res.status(500).json({ error: "Failed to record the human action" });
  }
});

const attestSchema = z.object({ attestationNote: z.string().trim().max(2_000).optional() });

// POST /api/msp/change-control/executions/:id/attest
// Attest a previously-recorded, still-unattested human action.
router.post("/msp/change-control/executions/:id/attest", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const executionId = Number(req.params.id);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    res.status(400).json({ error: "Invalid execution id" });
    return;
  }
  const parsed = attestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const actor = actorIdentity(req);
    const updated = await attestHumanAction(mspId, executionId, {
      attestedBy: actor.email || `person:${actor.personId}`,
      attestedByPersonId: actor.personId,
      attestationNote: parsed.data.attestationNote ?? null,
    });
    if (!updated) {
      res.status(409).json({ error: "Execution not found, not a human action, or already attested" });
      return;
    }
    res.status(200).json({ execution: toWireCrExecution(updated) });
  } catch (err) {
    log.error({ err, mspId, executionId }, "cr-executions: attest failed");
    res.status(500).json({ error: "Failed to attest the execution" });
  }
});

// POST /api/msp/change-control/executions/:id/reconcile-plan
// Diff the captured planOnly plan against the run's real outcome and persist it.
router.post("/msp/change-control/executions/:id/reconcile-plan", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const executionId = Number(req.params.id);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    res.status(400).json({ error: "Invalid execution id" });
    return;
  }
  try {
    const diff = await reconcileExecutionPlan(mspId, executionId);
    if (!diff) {
      res.status(409).json({ error: "Execution not found, or has no captured plan / bound run to reconcile" });
      return;
    }
    const updated = await getExecution(mspId, executionId);
    res.status(200).json({ diff, execution: updated ? toWireCrExecution(updated) : null });
  } catch (err) {
    log.error({ err, mspId, executionId }, "cr-executions: reconcile-plan failed");
    res.status(500).json({ error: "Failed to reconcile the plan" });
  }
});

// POST /api/msp/change-control/change-requests/:id/rollback
// Raise the INVERSE change request a rollback is. Does NOT revert the tenant —
// it creates a new CR that must clear its own approval and execute through the
// authorization gate like any change.
router.post("/msp/change-control/change-requests/:id/rollback", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const changeRequestId = Number(req.params.id);
  if (!Number.isInteger(changeRequestId) || changeRequestId <= 0) {
    res.status(400).json({ error: "Invalid change request id" });
    return;
  }
  try {
    const actor = actorIdentity(req);
    const result = await raiseRollbackChangeRequest(mspId, changeRequestId, actor);
    if (!result.ok) {
      res.status(409).json({ error: result.reason });
      return;
    }
    res.status(201).json({
      inverseChangeRequestId: result.inverse.id,
      inverseChangeCode: formatChangeRequestCode(result.inverse.id),
      rollbackOfChangeRequestId: changeRequestId,
      approvalsCreated: result.approvalsCreated,
    });
  } catch (err) {
    log.error({ err, mspId, changeRequestId }, "cr-executions: rollback raise failed");
    res.status(500).json({ error: "Failed to raise the rollback change request" });
  }
});

const verifyRollbackSchema = z.object({ outcome: z.enum(CR_ROLLBACK_OUTCOMES) });

// POST /api/msp/change-control/executions/:id/verify-rollback
// Record the verification result on a rollback execution. On `verified` this
// flips the ORIGINAL change to rolled_back.
router.post("/msp/change-control/executions/:id/verify-rollback", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const executionId = Number(req.params.id);
  if (!Number.isInteger(executionId) || executionId <= 0) {
    res.status(400).json({ error: "Invalid execution id" });
    return;
  }
  const parsed = verifyRollbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const updated = await verifyRollback(mspId, executionId, parsed.data.outcome);
    if (!updated) {
      res.status(409).json({ error: "Execution not found, or is not a rollback execution" });
      return;
    }
    res.status(200).json({ execution: toWireCrExecution(updated) });
  } catch (err) {
    log.error({ err, mspId, executionId }, "cr-executions: verify-rollback failed");
    res.status(500).json({ error: "Failed to verify the rollback" });
  }
});

export default router;

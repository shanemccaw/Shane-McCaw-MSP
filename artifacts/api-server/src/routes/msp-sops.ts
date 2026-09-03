import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspSopsTable, mspSopRunsTable, MSP_SOP_RUN_ORIGIN } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { runSopForCustomer, SopExecutionError, type SopExecutionErrorCode } from "../lib/sop-execution.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Zod validation schemas
const sopStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["manual", "automated"]),
  actionId: z.string().optional(),
  graphEndpoint: z.string().optional(),
  payloadTemplate: z.string().optional(),
  status: z.enum(["pending", "running", "success", "failed"]).optional().default("pending"),
  executedAt: z.string().optional(),
  verifiedBy: z.string().optional(),
});

const createSopSchema = z.object({
  sopId: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  version: z.string(),
  automationType: z.enum(["automated", "hybrid", "manual"]),
  estimatedMinutes: z.number().int().nonnegative(),
  complianceTags: z.array(z.string()),
  workloadTags: z.array(z.string()),
  steps: z.array(sopStepSchema),
  versionStatus: z.string(),
});

const runSopSchema = z.object({
  customerId: z.number().int().positive(),
  // Substituted for {id}/{upn} placeholders in the SOP's automated steps — the
  // run's one target entity (a user's id/UPN in every seeded SOP today).
  targetEntity: z.string().trim().max(500).optional(),
  // Any other named placeholder a step references (e.g. {messageId}).
  variables: z.record(z.string(), z.string()).optional(),
  operator: z.string().trim().max(200).optional(),
  origin: z.enum(MSP_SOP_RUN_ORIGIN).optional(),
  // #1497 — an approved Change Request authorizes this write against a live
  // tenant. Optional only for a testbed customer.
  changeRequestId: z.number().int().positive().optional(),
  // #1548 — attribute this run to the standing policy that named this SOP as
  // its enacting procedure. runSopForCustomer verifies it (this MSP, active,
  // names this same sopId) and forces origin to "policy".
  standingPolicyId: z.number().int().positive().optional(),
});

// #1938 — this route is a raw, MSPOperator-scoped INSERT with no Change Request
// and no Workflow Engine run behind it (the CR-gated execution hook is
// `runSopForCustomer`/`POST /msp/sops/:sopId/run`, #1559). It must stay
// genuinely manual-only or it becomes a way to fabricate a
// `status: "Completed"` run that the portal's audit view renders identically
// to a real, CR-authorized one:
//   - `origin` is not client-settable here — every row this route creates is
//     forced to "manual" server-side, regardless of what the caller sends.
//     A "policy"-origin run only ever comes from `runSopForCustomer`
//     (`#1548`/`policy-enactment.ts`), never from this hand-entry path, so
//     `standingPolicyId` is not accepted here either.
//   - `status` at creation must be `"In Progress"` — a run cannot be born
//     already "Completed"/"Blocked"/"Failed"; those are reached the same way
//     a real run reaches them, via `PATCH /msp/sop-runs/:runId`.
//   - `wf_run_id`/`automated_step_map` were already absent from this schema
//     (never client-settable) — those are exclusively `runSopForCustomer`'s
//     to write.
const createSopRunSchema = z.object({
  runId: z.string(),
  sopId: z.string(),
  sopTitle: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  targetEntity: z.string(),
  operator: z.string(),
  startedAt: z.string(),
  status: z.literal("In Progress"),
  currentStepIndex: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  passedStepsCount: z.number().int().nonnegative(),
  psaTicketId: z.string(),
  logs: z.array(z.string()),
});

const patchSopRunSchema = z.object({
  status: z.enum(["In Progress", "Completed", "Blocked", "Failed"]).optional(),
  currentStepIndex: z.number().int().nonnegative().optional(),
  passedStepsCount: z.number().int().nonnegative().optional(),
  completedAt: z.string().nullable().optional(),
  logs: z.array(z.string()).optional(),
});

// GET /api/msp/sops
// Get SOP templates for active MSP
router.get(
  "/msp/sops",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rows = await db
        .select()
        .from(mspSopsTable)
        .where(eq(mspSopsTable.mspId, mspId))
        .orderBy(desc(mspSopsTable.id));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/sops failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/sops
// Create a new SOP template
router.post(
  "/msp/sops",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsedBody = createSopSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid SOP template data", parsedBody.error.flatten());
        return;
      }

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const nowUtc = new Date().toISOString().substring(0, 10);

      const [inserted] = await db
        .insert(mspSopsTable)
        .values({
          mspId,
          sopId: parsedBody.data.sopId,
          code: parsedBody.data.code,
          title: parsedBody.data.title,
          description: parsedBody.data.description,
          category: parsedBody.data.category,
          version: parsedBody.data.version,
          automationType: parsedBody.data.automationType,
          estimatedMinutes: parsedBody.data.estimatedMinutes,
          complianceTags: parsedBody.data.complianceTags,
          workloadTags: parsedBody.data.workloadTags,
          steps: parsedBody.data.steps,
          lastUpdatedBy: userEmail,
          lastUpdatedAt: nowUtc,
          versionStatus: parsedBody.data.versionStatus,
        })
        .returning({ id: mspSopsTable.id });

      res.status(201).json({
        id: inserted.id,
        sopId: parsedBody.data.sopId,
        message: "SOP template created successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/sops failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/sops/:sopId/run
//
// The execution hook (#1559): fire an SOP's automated steps for real against a
// customer's tenant. Routed through the SAME machinery a config-pack run uses
// (see sop-execution.ts's header) — the #1497 Change Control gate and the
// Workflow Engine's own graph_write_operation node — never a second,
// direct-Graph-write path. Writes the msp_sop_runs row nothing wrote before
// this issue.
const SOP_RUN_ERROR_STATUS: Record<SopExecutionErrorCode, number> = {
  sop_not_found: 404,
  customer_not_found: 404,
  customer_wrong_msp: 403,
  sop_not_runnable: 422,
  customer_not_connected: 422,
  missing_variables: 400,
  customer_not_testbed: 422,
  // #1497 — reached the write path without an approved, unconsumed CR.
  change_request_not_authorized: 403,
  concurrency_limit: 409,
  // #1550 — a policy-enacted run with no explicit CR could not auto-raise one
  // (the bound catalog item is missing/draft/revoked).
  standing_policy_catalog_item_not_approved: 409,
  // #1548 — a run claiming a standingPolicyId that doesn't check out.
  standing_policy_not_found: 404,
  standing_policy_inactive: 422,
  standing_policy_sop_mismatch: 422,
  standing_policy_requires_policy_origin: 400,
};

router.post(
  "/msp/sops/:sopId/run",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const sopId = String(req.params.sopId);
      const parsedBody = runSopSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid run request", parsedBody.error.flatten());
        return;
      }

      const result = await runSopForCustomer({
        mspId,
        sopId,
        customerId: parsedBody.data.customerId,
        targetEntity: parsedBody.data.targetEntity,
        variables: parsedBody.data.variables,
        operator: parsedBody.data.operator ?? req.user?.email ?? "unknown",
        origin: parsedBody.data.origin,
        standingPolicyId: parsedBody.data.standingPolicyId,
        triggeredBy: `sop:${sopId}:customer:${parsedBody.data.customerId}:operator:${req.user?.id ?? "unknown"}`,
        ...(parsedBody.data.changeRequestId != null
          ? { changeRequestAuthorization: { changeRequestId: parsedBody.data.changeRequestId } }
          : {}),
      });

      res.status(202).json({
        id: result.runId,
        runId: result.runIdentifier,
        wfRunId: result.wfRunId,
        definitionId: result.definitionId,
        versionId: result.versionId,
        reusedVersion: result.reusedVersion,
        sopId,
        customerId: parsedBody.data.customerId,
        automatedStepCount: result.automatedStepCount,
        totalSteps: result.totalSteps,
        authorizingChangeRequestId: result.authorizingChangeRequestId,
        standingPolicyId: parsedBody.data.standingPolicyId ?? null,
      });
    } catch (err: unknown) {
      if (err instanceof SopExecutionError) {
        res.status(SOP_RUN_ERROR_STATUS[err.code] ?? 422).json({ error: err.message, code: err.code, ...(err.details ?? {}) });
        return;
      }
      log.error({ err }, "POST /api/msp/sops/:sopId/run failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// GET /api/msp/sop-runs
// Get SOP execution runs for active MSP
router.get(
  "/msp/sop-runs",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rows = await db
        .select()
        .from(mspSopRunsTable)
        .where(eq(mspSopRunsTable.mspId, mspId))
        .orderBy(desc(mspSopRunsTable.id));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/sop-runs failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/sop-runs
// Create / start a new SOP run
router.post(
  "/msp/sop-runs",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsedBody = createSopRunSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid SOP run data", parsedBody.error.flatten());
        return;
      }

      // #1558 — the version this run actually followed, captured from the base
      // definition NOW rather than trusted from the caller: the base SOP keeps
      // moving forward under `version` as it is republished, so this has to be
      // read at the instant the run starts or it stops meaning anything. "" (no
      // definition found for this sopId) reads honestly as not recorded, same
      // as every other server-captured field's empty default.
      const [sop] = await db
        .select({ version: mspSopsTable.version })
        .from(mspSopsTable)
        .where(and(eq(mspSopsTable.mspId, mspId), eq(mspSopsTable.sopId, parsedBody.data.sopId)))
        .limit(1);

      const [inserted] = await db
        .insert(mspSopRunsTable)
        .values({
          mspId,
          runId: parsedBody.data.runId,
          sopId: parsedBody.data.sopId,
          sopTitle: parsedBody.data.sopTitle,
          tenantId: parsedBody.data.tenantId,
          tenantName: parsedBody.data.tenantName,
          targetEntity: parsedBody.data.targetEntity,
          operator: parsedBody.data.operator,
          // #1938 — forced, never client-settable: this route is a hand-entry
          // path with no Change Request and no Workflow Engine run behind it,
          // so every row it creates is a manual run, full stop.
          origin: "manual",
          sopVersion: sop?.version ?? "",
          startedAt: parsedBody.data.startedAt,
          status: parsedBody.data.status,
          currentStepIndex: parsedBody.data.currentStepIndex,
          totalSteps: parsedBody.data.totalSteps,
          passedStepsCount: parsedBody.data.passedStepsCount,
          psaTicketId: parsedBody.data.psaTicketId,
          logs: parsedBody.data.logs,
        })
        .returning({ id: mspSopRunsTable.id });

      res.status(201).json({
        id: inserted.id,
        runId: parsedBody.data.runId,
        message: "SOP run started successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/sop-runs failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// PATCH /api/msp/sop-runs/:runId
// Update an existing SOP run status, current step, logs, etc.
router.patch(
  "/msp/sop-runs/:runId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const runIdStr = String(req.params.runId);

      // Check if run exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspSopRunsTable)
        .where(and(eq(mspSopRunsTable.runId, runIdStr), eq(mspSopRunsTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "SOP run not found");
        return;
      }

      const parsedBody = patchSopRunSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid update payload", parsedBody.error.flatten());
        return;
      }

      const updateData: Partial<typeof mspSopRunsTable.$inferInsert> = {};
      if (parsedBody.data.status !== undefined) updateData.status = parsedBody.data.status;
      if (parsedBody.data.currentStepIndex !== undefined) updateData.currentStepIndex = parsedBody.data.currentStepIndex;
      if (parsedBody.data.passedStepsCount !== undefined) updateData.passedStepsCount = parsedBody.data.passedStepsCount;
      if (parsedBody.data.completedAt !== undefined) updateData.completedAt = parsedBody.data.completedAt;
      if (parsedBody.data.logs !== undefined) updateData.logs = parsedBody.data.logs;

      await db
        .update(mspSopRunsTable)
        .set(updateData)
        .where(eq(mspSopRunsTable.id, existing.id));

      res.json({
        runId: runIdStr,
        message: "SOP run updated successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/sop-runs/:runId failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;

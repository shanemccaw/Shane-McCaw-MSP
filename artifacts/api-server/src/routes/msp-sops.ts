import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspSopsTable, mspSopRunsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

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

const createSopRunSchema = z.object({
  runId: z.string(),
  sopId: z.string(),
  sopTitle: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  targetEntity: z.string(),
  operator: z.string(),
  startedAt: z.string(),
  status: z.enum(["In Progress", "Completed", "Blocked", "Failed"]),
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

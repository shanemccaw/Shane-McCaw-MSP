import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspChangeRequestsTable, tenantsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { logRetainerWorkFromTracker, pillarHintForCategory } from "../lib/retainer-work-logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Zod schemas for validation
const createChangeRequestSchema = z.object({
  tenantId: z.string(),
  tenantName: z.string(),
  primaryDomain: z.string(),
  title: z.string(),
  description: z.string(),
  changeClass: z.enum(["standard", "normal", "emergency"]),
  riskLevel: z.enum(["critical", "high", "medium", "low"]),
  category: z.enum(["ConditionalAccess", "Exchange", "Identity", "Intune", "Defender"]),
  targetResource: z.string(),
  psaTicketId: z.string(),
  scheduledFor: z.string(),
  impactedUsersCount: z.number().int().nonnegative(),
  preChangeSnapshot: z.record(z.any()),
  proposedPayload: z.record(z.any()),
  rollbackScriptSnippet: z.string(),
});

const patchChangeRequestSchema = z.object({
  status: z.enum(["pending_approval", "scheduled", "in_progress", "completed", "rolled_back", "rejected"]).optional(),
  approvedBy: z.string().nullable().optional(),
  executedAt: z.string().nullable().optional(),
});

// Helper to format numeric ID to human readable CR-2026-XXX
function formatCrId(id: number): string {
  return `CR-2026-${100 + id}`;
}

// Helper to parse human readable ID to numeric ID
function parseCrId(crId: string): number | null {
  const match = crId.match(/^CR-2026-(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) - 100;
}

// GET /api/msp/change-requests
// List change requests for the caller's MSP
router.get(
  "/msp/change-requests",
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
        .from(mspChangeRequestsTable)
        .where(eq(mspChangeRequestsTable.mspId, mspId))
        .orderBy(desc(mspChangeRequestsTable.id));

      const formatted = rows.map((r) => ({
        ...r,
        id: formatCrId(r.id),
      }));

      res.json(formatted);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/change-requests failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/change-requests
// Create a new change request
router.post(
  "/msp/change-requests",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsedBody = createChangeRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request data", parsedBody.error.flatten());
        return;
      }

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const nowUtc = new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC";
      // Generate a mock SHA256 backup hash
      const randomHash = "SHA256:" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

      const [inserted] = await db
        .insert(mspChangeRequestsTable)
        .values({
          mspId,
          tenantId: parsedBody.data.tenantId,
          tenantName: parsedBody.data.tenantName,
          primaryDomain: parsedBody.data.primaryDomain,
          title: parsedBody.data.title,
          description: parsedBody.data.description,
          changeClass: parsedBody.data.changeClass,
          riskLevel: parsedBody.data.riskLevel,
          category: parsedBody.data.category,
          targetResource: parsedBody.data.targetResource,
          psaTicketId: parsedBody.data.psaTicketId,
          requestedBy: userEmail,
          requestedAt: nowUtc,
          scheduledFor: parsedBody.data.scheduledFor,
          impactedUsersCount: parsedBody.data.impactedUsersCount,
          status: "pending_approval",
          backupVerified: true,
          backupHash: randomHash,
          preChangeSnapshot: parsedBody.data.preChangeSnapshot,
          proposedPayload: parsedBody.data.proposedPayload,
          rollbackScriptSnippet: parsedBody.data.rollbackScriptSnippet,
        })
        .returning({ id: mspChangeRequestsTable.id });

      const newIdFormatted = formatCrId(inserted.id);

      res.status(201).json({
        id: newIdFormatted,
        message: "Change request submitted successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-requests failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// PATCH /api/msp/change-requests/:id
// Update a change request's status (approve, reject, execute, rollback)
router.patch(
  "/msp/change-requests/:id",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const crIdStr = String(req.params.id);
      const dbId = parseCrId(crIdStr);
      if (dbId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
        return;
      }

      const parsedBody = patchChangeRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid update payload", parsedBody.error.flatten());
        return;
      }

      // Check if CR exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspChangeRequestsTable)
        .where(and(eq(mspChangeRequestsTable.id, dbId), eq(mspChangeRequestsTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }

      // Update fields
      const updateData: Partial<typeof mspChangeRequestsTable.$inferInsert> = {};
      if (parsedBody.data.status !== undefined) updateData.status = parsedBody.data.status;
      if (parsedBody.data.approvedBy !== undefined) updateData.approvedBy = parsedBody.data.approvedBy;
      if (parsedBody.data.executedAt !== undefined) updateData.executedAt = parsedBody.data.executedAt;

      await db
        .update(mspChangeRequestsTable)
        .set(updateData)
        .where(eq(mspChangeRequestsTable.id, dbId));

      // ── Retainer byproduct hook (Git #1293) ──────────────────────────────
      // Closing a change request is the real "hours-logging moment": when Shane
      // resolves a tracked item, a retainer_work_log entry is created for that
      // customer automatically, hours defaulted to 0 for him to set in AdminV2.
      // Only fire on the transition INTO `completed` (not on a re-save of an
      // already-completed CR), and resolve the CR's tenant to its customerId
      // (a tenants.id) — the CR table keys on the free-text tenantId, not on it.
      if (parsedBody.data.status === "completed" && existing.status !== "completed") {
        try {
          const [tenantRow] = await db
            .select({ id: tenantsTable.id })
            .from(tenantsTable)
            .where(and(eq(tenantsTable.mspId, mspId), eq(tenantsTable.tenantId, existing.tenantId)))
            .limit(1);
          if (tenantRow) {
            await logRetainerWorkFromTracker({
              customerId: tenantRow.id,
              mspId,
              source: "change_control",
              sourceRefId: dbId,
              item: existing.title,
              pillar: pillarHintForCategory(existing.category),
              finding: existing.linkedFinding,
              outcome: existing.description,
              loggedByUserId: req.user?.id ?? null,
            });
          } else {
            log.warn({ mspId, tenantId: existing.tenantId, crId: dbId }, "CR completed but no tenant row matched — retainer entry skipped");
          }
        } catch (hookErr) {
          // Never let retainer logging break the CR update itself.
          log.warn({ err: hookErr, crId: dbId }, "retainer byproduct hook failed on CR completion");
        }
      }

      res.json({
        id: crIdStr,
        message: "Change request updated successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/change-requests/:id failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;

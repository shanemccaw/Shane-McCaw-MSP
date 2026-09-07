/**
 * msp-poams.ts — the MSP-console (MSP-authored/managed) side of POA&Ms
 * (Git #3080, Phase 1a of #1935).
 *
 * MSP staff author and manage the plan itself: create it, edit its narrative
 * and schedule, manage its milestones, and cancel it if abandoned. The real
 * customer SIGNATURE ceremony lives on the portal side (`portal-poams.ts`),
 * mirroring the split `msp-rbd.ts` / `portal-risk-register.ts` already use —
 * see that pair's own headers for why a customer-facing signature must be
 * server-derived (timestamp/ip/hash) rather than accepted as request body
 * fields the way this MSP-console side's other writes are.
 *
 *   GET   /api/msp/poams                              — list this MSP's POA&Ms
 *   POST  /api/msp/poams                               — create one
 *   GET   /api/msp/poams/:poamId                       — one, with its milestones
 *   PATCH /api/msp/poams/:poamId                        — edit narrative/schedule/status
 *   PATCH /api/msp/poams/:poamId/cancel                 — mark cancelled
 *   POST  /api/msp/poams/:poamId/milestones             — add a milestone
 *   PATCH /api/msp/poams/:poamId/milestones/:milestoneId — edit / mark complete
 *   DELETE /api/msp/poams/:poamId/milestones/:milestoneId — remove a milestone
 *
 * Role floor matches `msp-rbd.ts`: `MSPOperator` reads and authors, `MSPAdmin`
 * cancels — cancelling a plan is the same weight as revoking an RBD.
 *
 * `available-checks` / `available-obligations` are NOT duplicated here —
 * `msp-rbd.ts` already serves the exact same `monitor_checks` /
 * `compliance_obligations` catalogs, and there is nothing POA&M-specific
 * about either list.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspPoamsTable, mspPoamMilestonesTable, POAM_STATUSES, POAM_MILESTONE_STATUSES } from "@workspace/db";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { randomPlaceholder, assignPoamId } from "../lib/poam-ref.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const createPoamSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  primaryDomain: z.string(),
  title: z.string().min(1),
  weaknessDescription: z.string().min(1),
  checkKey: z.string().nullable().optional(),
  additionalCheckKeys: z.array(z.string()).nullable().optional(),
  scheduledCompletionDate: isoDate,
  interimCompensatingControl: z.string().min(1),
  resourcesRequired: z.string().min(1),
  /** Creation only ever starts a plan `draft` or already sent `pending_signature` —
   * `active`/`completed`/`cancelled` are reached only through their own
   * dedicated transitions (sign happens on the portal; cancel/complete below). */
  status: z.enum(["draft", "pending_signature"]),
  sowId: z.string().uuid().nullable().optional(),
});

// GET /api/msp/poams — list all POA&Ms for the active MSP
router.get(
  "/msp/poams",
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
        .from(mspPoamsTable)
        .where(eq(mspPoamsTable.mspId, mspId))
        .orderBy(desc(mspPoamsTable.id));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/poams failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// POST /api/msp/poams — author a new POA&M
router.post(
  "/msp/poams",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsed = createPoamSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid POA&M data", parsed.error.flatten());
        return;
      }
      const data = parsed.data;
      const placeholder = randomPlaceholder();

      const [inserted] = await db
        .insert(mspPoamsTable)
        .values({
          mspId,
          poamId: placeholder,
          tenantId: data.tenantId,
          tenantName: data.tenantName,
          primaryDomain: data.primaryDomain,
          title: data.title,
          weaknessDescription: data.weaknessDescription,
          checkKey: data.checkKey ?? null,
          additionalCheckKeys: data.additionalCheckKeys ?? null,
          // Set identical at creation — see schema header. Only
          // `scheduledCompletionDate` ever moves after this.
          scheduledCompletionDate: data.scheduledCompletionDate,
          originalScheduledCompletionDate: data.scheduledCompletionDate,
          interimCompensatingControl: data.interimCompensatingControl,
          resourcesRequired: data.resourcesRequired,
          status: data.status,
          sowId: data.sowId ?? null,
        })
        .returning({ id: mspPoamsTable.id });

      const poamId = await assignPoamId(inserted.id, placeholder);

      res.status(201).json({
        id: inserted.id,
        poamId,
        message: "POA&M created successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/poams failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

async function loadOwnScoped(mspId: number, poamId: string) {
  const [existing] = await db
    .select()
    .from(mspPoamsTable)
    .where(and(eq(mspPoamsTable.poamId, poamId), eq(mspPoamsTable.mspId, mspId)))
    .limit(1);
  return existing ?? null;
}

// GET /api/msp/poams/:poamId — one plan, with its milestones
router.get(
  "/msp/poams/:poamId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const existing = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const milestones = await db
        .select()
        .from(mspPoamMilestonesTable)
        .where(eq(mspPoamMilestonesTable.poamId, existing.id))
        .orderBy(asc(mspPoamMilestonesTable.sortOrder), asc(mspPoamMilestonesTable.id));

      res.json({ ...existing, milestones });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/poams/:poamId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const updatePoamSchema = z.object({
  title: z.string().min(1).optional(),
  weaknessDescription: z.string().min(1).optional(),
  checkKey: z.string().nullable().optional(),
  additionalCheckKeys: z.array(z.string()).nullable().optional(),
  // The current, LIVE target — the one date this route may move. NOTE:
  // `originalScheduledCompletionDate` is deliberately absent from this schema
  // — it is set once at creation and this route has no path to touch it.
  scheduledCompletionDate: isoDate.optional(),
  interimCompensatingControl: z.string().min(1).optional(),
  resourcesRequired: z.string().min(1).optional(),
  sowId: z.string().uuid().nullable().optional(),
  /** `active` is reached only via the portal signature ceremony; this route
   * refuses it explicitly, below. */
  status: z.enum(POAM_STATUSES).optional(),
});

// PATCH /api/msp/poams/:poamId — edit narrative/schedule/status
router.patch(
  "/msp/poams/:poamId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsed = updatePoamSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid POA&M update", parsed.error.flatten());
        return;
      }

      const existing = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      if (parsed.data.status === "active") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "A POA&M only becomes active through the customer signature ceremony");
        return;
      }
      if (existing.status === "cancelled" || existing.status === "completed") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `POA&M is ${existing.status} and cannot be edited`);
        return;
      }

      const { status, ...rest } = parsed.data;
      await db
        .update(mspPoamsTable)
        .set({ ...rest, ...(status ? { status } : {}), updatedAt: new Date() })
        .where(eq(mspPoamsTable.id, existing.id));

      res.json({ poamId: existing.poamId, message: "POA&M updated successfully" });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/poams/:poamId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// PATCH /api/msp/poams/:poamId/cancel — mark cancelled (same weight as an RBD revoke)
router.patch(
  "/msp/poams/:poamId/cancel",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const existing = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }
      if (existing.status === "cancelled" || existing.status === "completed") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `POA&M is already ${existing.status}`);
        return;
      }

      await db
        .update(mspPoamsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(mspPoamsTable.id, existing.id));

      res.json({ poamId: existing.poamId, message: "POA&M cancelled successfully" });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/poams/:poamId/cancel failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const createMilestoneSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: isoDate,
  sortOrder: z.number().int().optional(),
});

// POST /api/msp/poams/:poamId/milestones — add a milestone
router.post(
  "/msp/poams/:poamId/milestones",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const existing = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const parsed = createMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid milestone data", parsed.error.flatten());
        return;
      }

      const [inserted] = await db
        .insert(mspPoamMilestonesTable)
        .values({
          poamId: existing.id,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          dueDate: parsed.data.dueDate,
          sortOrder: parsed.data.sortOrder ?? 0,
          status: "pending",
        })
        .returning({ id: mspPoamMilestonesTable.id });

      res.status(201).json({ id: inserted.id, message: "Milestone added successfully" });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/poams/:poamId/milestones failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const updateMilestoneSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: isoDate.optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(POAM_MILESTONE_STATUSES).optional(),
});

// PATCH /api/msp/poams/:poamId/milestones/:milestoneId — edit, or mark complete
router.patch(
  "/msp/poams/:poamId/milestones/:milestoneId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parent = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!parent) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const milestoneId = parseInt(String(req.params.milestoneId), 10);
      if (isNaN(milestoneId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid milestone id");
        return;
      }

      const [existing] = await db
        .select()
        .from(mspPoamMilestonesTable)
        .where(and(eq(mspPoamMilestonesTable.id, milestoneId), eq(mspPoamMilestonesTable.poamId, parent.id)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Milestone not found");
        return;
      }

      const parsed = updateMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid milestone update", parsed.error.flatten());
        return;
      }

      // NEVER EDITABLE AFTER THE FACT once completed — same discipline as the
      // parent's signature. Nothing un-completes a milestone through this route.
      if (existing.status === "completed") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This milestone is already completed and cannot be changed");
        return;
      }

      const { status, ...rest } = parsed.data;
      await db
        .update(mspPoamMilestonesTable)
        .set({
          ...rest,
          ...(status === "completed" ? { status: "completed" as const, completedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(mspPoamMilestonesTable.id, milestoneId), isNull(mspPoamMilestonesTable.completedAt)));

      res.json({ id: milestoneId, message: "Milestone updated successfully" });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/poams/:poamId/milestones/:milestoneId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// DELETE /api/msp/poams/:poamId/milestones/:milestoneId — remove a milestone
router.delete(
  "/msp/poams/:poamId/milestones/:milestoneId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parent = await loadOwnScoped(mspId, String(req.params.poamId));
      if (!parent) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const milestoneId = parseInt(String(req.params.milestoneId), 10);
      if (isNaN(milestoneId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid milestone id");
        return;
      }

      const deleted = await db
        .delete(mspPoamMilestonesTable)
        .where(and(eq(mspPoamMilestonesTable.id, milestoneId), eq(mspPoamMilestonesTable.poamId, parent.id)))
        .returning({ id: mspPoamMilestonesTable.id });

      if (deleted.length === 0) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Milestone not found");
        return;
      }

      res.json({ id: milestoneId, message: "Milestone removed successfully" });
    } catch (err: unknown) {
      log.error({ err }, "DELETE /api/msp/poams/:poamId/milestones/:milestoneId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;

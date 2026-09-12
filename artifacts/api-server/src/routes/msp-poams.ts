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
 *   POST  /api/msp/poams/:poamId/convert-to-risk-acceptance — convert this
 *         plan to an accepted risk (Git #3081, Phase 1b of #1935): the plan's
 *         cost/factors turned out too high. Creates a new, signable
 *         `msp_risk_decisions` row (same `pending_signature` → sign-on-portal
 *         path a fresh RBD already goes through) and marks this plan
 *         `converted_to_risk_acceptance`, pointed at it. `MSPAdmin`-gated —
 *         same weight as cancel, since it both ends this record and creates a
 *         new liability instrument.
 *   POST  /api/msp/poams/:poamId/milestones             — add a milestone
 *   PATCH /api/msp/poams/:poamId/milestones/:milestoneId — edit / mark complete
 *   DELETE /api/msp/poams/:poamId/milestones/:milestoneId — remove a milestone
 *   DELETE /api/msp/poams/:poamId                        — soft-delete the plan
 *         itself (Git #3451): distinct from `cancel` above, which only flips a
 *         status and keeps the row live. This goes through the platform
 *         retention lifecycle (`softDelete()`) — recoverable for the tenant's
 *         configured soft-delete window, then eligible for the #1571
 *         accelerated-delete review queue, same as every other retained
 *         record type once one actually registers.
 *
 * Role floor matches `msp-rbd.ts`: `MSPOperator` reads and authors, `MSPAdmin`
 * cancels or deletes — deleting a plan carries the same weight as revoking an
 * RBD or cancelling a plan.
 *
 * `available-checks` / `available-obligations` are NOT duplicated here —
 * `msp-rbd.ts` already serves the exact same `monitor_checks` /
 * `compliance_obligations` catalogs, and there is nothing POA&M-specific
 * about either list.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspPoamsTable, mspPoamMilestonesTable, mspRiskDecisionsTable, mspAuditLogsTable, POAM_STATUSES, POAM_MILESTONE_STATUSES, type CompensatingControl, type MspAssessor, type ClientApprover } from "@workspace/db";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireCapability } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { randomPlaceholder, assignPoamId } from "../lib/poam-ref.ts";
import { assignRegisterRef } from "../lib/risk-register-ref.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
import { softDelete, RetentionError } from "../lib/retention/lifecycle.ts";
import { registerPoamRetention } from "../lib/retention/wiring/msp-poams.ts";

// Git #3451 — registers `msp_poams` with the platform retention lifecycle. See that
// file's own header for why this is a plain import-time side effect.
registerPoamRetention();

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
  requireCapability("ladder.msp-operator"),
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
        // Git #3451: reads exclude soft-deleted rows by default (the platform
        // convention `lifecycle.ts` documents) — a deleted plan still exists for the
        // retention clock/queue, but a plain list is not where it's found.
        .where(and(eq(mspPoamsTable.mspId, mspId), isNull(mspPoamsTable.deletedAt)))
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
  requireCapability("ladder.msp-operator"),
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
  requireCapability("ladder.msp-operator"),
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
  requireCapability("ladder.msp-operator"),
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
      if (parsed.data.status === "cancelled") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Cancelling a POA&M requires MSPAdmin — use PATCH /api/msp/poams/:poamId/cancel");
        return;
      }
      if (parsed.data.status === "converted_to_risk_acceptance") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Converting a POA&M to a risk acceptance requires MSPAdmin — use POST /api/msp/poams/:poamId/convert-to-risk-acceptance");
        return;
      }
      if (
        existing.status === "cancelled" ||
        existing.status === "completed" ||
        existing.status === "converted_to_risk_acceptance"
      ) {
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
  requireCapability("ladder.msp-admin"),
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

const convertToRiskAcceptanceSchema = z.object({
  /** Real, required reasoning for why this plan is being abandoned in favour
   * of accepting the risk instead — never inferred. Becomes both rows'
   * `conversionReason` and the new risk decision's `rationale`. */
  reason: z.string().min(1),
  controlViolated: z.string().min(1),
  framework: z.string().min(1),
  rawRiskLevel: z.enum(["critical", "high", "medium"]),
  residualRiskLevel: z.enum(["high", "medium", "low"]),
  rawRiskScore: z.number().int(),
  residualRiskScore: z.number().int(),
  liabilityValueUsd: z.number().int(),
  graphEndpoint: z.string().optional().default(""),
  /** Optional — when omitted, this plan's own real, already-recorded
   * `interimCompensatingControl` becomes the sole compensating control on the
   * new risk decision, rather than inventing a fresh one. */
  compensatingControls: z
    .array(z.object({ type: z.enum(["technical", "administrative", "operational"]), description: z.string() }))
    .optional(),
  clientApprover: z.object({
    name: z.string(),
    title: z.string(),
    email: z.string(),
  }),
  expirationDate: z.string().min(1),
});

// POST /api/msp/poams/:poamId/convert-to-risk-acceptance — Git #3081, Phase 1b of #1935.
router.post(
  "/msp/poams/:poamId/convert-to-risk-acceptance",
  requireAuth,
  requireCapability("ladder.msp-admin"),
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
      if (existing.status !== "active") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `POA&M must be active to convert — current status is ${existing.status}`);
        return;
      }

      const parsed = convertToRiskAcceptanceSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid conversion data", parsed.error.flatten());
        return;
      }
      const data = parsed.data;

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const userName = req.user?.name || "MSP Assessor";
      const nowUtc = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";
      const mspAssessor: MspAssessor = { name: userName, upn: userEmail, timestamp: nowUtc };
      const clientApprover: ClientApprover = {
        name: data.clientApprover.name,
        title: data.clientApprover.title,
        email: data.clientApprover.email,
        signedAt: null,
        ipAddress: null,
        signatureHash: null,
      };
      const compensatingControls: CompensatingControl[] =
        data.compensatingControls && data.compensatingControls.length > 0
          ? data.compensatingControls
          : [{ type: "operational", description: existing.interimCompensatingControl }];

      // Deterministic on the source POA&M — a repeat call reuses the same row
      // via the (mspId, rbdId) unique constraint below rather than creating a
      // second one.
      const rbdId = `RBD-${existing.poamId}`;

      const [inserted] = await db
        .insert(mspRiskDecisionsTable)
        .values({
          mspId,
          rbdId,
          tenantId: existing.tenantId,
          tenantName: existing.tenantName,
          primaryDomain: existing.primaryDomain,
          title: existing.title,
          controlViolated: data.controlViolated,
          framework: data.framework,
          checkKey: existing.checkKey,
          additionalCheckKeys: existing.additionalCheckKeys,
          rawRiskLevel: data.rawRiskLevel,
          residualRiskLevel: data.residualRiskLevel,
          rawRiskScore: data.rawRiskScore,
          residualRiskScore: data.residualRiskScore,
          liabilityValueUsd: data.liabilityValueUsd,
          hazardDescription: existing.weaknessDescription,
          graphEndpoint: data.graphEndpoint,
          compensatingControls,
          mspAssessor,
          clientApprover,
          expirationDate: data.expirationDate,
          status: "pending_signature",
          rationale: data.reason,
          // Accountability carries over — same workload/holders this plan
          // already resolved, never re-derived.
          authorizingWorkloadId: existing.authorizingWorkloadId,
          authorizingWorkloadLabel: existing.authorizingWorkloadLabel,
          authorizingHolderPersonIds: existing.authorizingHolderPersonIds,
          spawnedByPoamId: existing.id,
        })
        .onConflictDoUpdate({
          target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId],
          set: { updatedAt: new Date() },
        })
        .returning({ id: mspRiskDecisionsTable.id });

      const registerRef = await assignRegisterRef(inserted.id);

      await db
        .update(mspPoamsTable)
        .set({
          status: "converted_to_risk_acceptance",
          convertedToRiskDecisionId: inserted.id,
          conversionReason: data.reason,
          updatedAt: new Date(),
        })
        .where(eq(mspPoamsTable.id, existing.id));

      await db.insert(mspAuditLogsTable).values({
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.mspRole ?? req.user?.role ?? null,
        mspId,
        actionType: "msp.poam.convert_to_risk_acceptance",
        entityType: "msp_poam",
        entityId: String(existing.id),
        entityLabel: existing.poamId,
        correlationId: getRequestContext()?.traceId ?? randomUUID(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        outcome: "success",
        metadata: { poamId: existing.poamId, riskDecisionId: inserted.id, rbdId, reason: data.reason },
      });

      log.info({ mspId, poamId: existing.poamId, riskDecisionId: inserted.id, rbdId }, "POA&M converted to risk acceptance (#3081)");

      res.status(201).json({
        poamId: existing.poamId,
        riskDecisionId: inserted.id,
        rbdId,
        registerRef,
        message: "POA&M converted to a risk acceptance successfully — awaiting customer signature",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/poams/:poamId/convert-to-risk-acceptance failed");
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
  requireCapability("ladder.msp-operator"),
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
  requireCapability("ladder.msp-operator"),
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
  requireCapability("ladder.msp-operator"),
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

const deletePoamSchema = z.object({
  reason: z.string().trim().min(1),
});

// DELETE /api/msp/poams/:poamId — Git #3451. Soft-delete the plan itself through the
// platform retention lifecycle, distinct from `cancel` above (a status flip that keeps
// the row live). MSPAdmin-gated, same weight as cancel/convert-to-risk-acceptance.
router.delete(
  "/msp/poams/:poamId",
  requireAuth,
  requireCapability("ladder.msp-admin"),
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

      const parsed = deletePoamSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "A delete reason is required.");
        return;
      }

      const user = req.user!;
      const deletion = await softDelete({
        recordType: "msp_poams",
        recordId: String(existing.id),
        reason: parsed.data.reason,
        actor: { name: user.name ?? user.email, role: "admin", userId: user.id, side: "operator" },
      });

      res.json({ poamId: existing.poamId, deletion, message: "POA&M deleted successfully" });
    } catch (err: unknown) {
      if (err instanceof RetentionError) {
        res.status(err.httpStatus).json({ error: err.message });
        return;
      }
      log.error({ err }, "DELETE /api/msp/poams/:poamId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;

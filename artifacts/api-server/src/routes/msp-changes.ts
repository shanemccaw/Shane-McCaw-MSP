import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspChangeRequestsTable, portalChangeControlPolicyTable, tenantsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { logRetainerWorkFromTracker, pillarHintForCategory } from "../lib/retainer-work-logger.ts";
import { workloadForCategory } from "../lib/portal-change-control.ts";
import { activeFreezeForSubmit, freezeForBookedWindow, recordFreezeException } from "../lib/portal-change-freeze-store.ts";
import { personIdForUser } from "../lib/portal-ownership.ts";
import {
  addAttachment,
  addComment,
  listAttachmentsForChangeIds,
  listCommentsForChangeIds,
  listEventsForChangeIds,
  recordCrEvent,
} from "../lib/portal-change-timeline-store.ts";

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
  // #1762 — the booked window as a REAL instant, additive alongside the required
  // free-text `scheduledFor` label. Optional ISO-8601; when both are given, end
  // must be after start.
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  scheduledEnd: z.string().datetime({ offset: true }).optional(),
  impactedUsersCount: z.number().int().nonnegative(),
  preChangeSnapshot: z.record(z.any()),
  proposedPayload: z.record(z.any()),
  rollbackScriptSnippet: z.string(),
  // #1500 — the ONLY way through an active freeze window: a written
  // justification, submitted with the change itself.
  freezeException: z.object({ justification: z.string().trim().min(1).max(2_000) }).optional(),
  // #1773 — optional. Set this to `pack:<packKey>` or `sop:<sopId>` when this
  // CR is being raised specifically to authorize one automated config-pack/SOP
  // run (e.g. before handing its id to execute_write_pack) — the write gate
  // then refuses to let it authorize anything else. Omitted for a general,
  // non-catalog change request, which keeps #1497's original tenant-granularity
  // authorization unchanged.
  authorizedTargetKey: z.string().trim().min(1).optional(),
}).refine(
  (d) => !(d.scheduledStart && d.scheduledEnd) || new Date(d.scheduledEnd).getTime() > new Date(d.scheduledStart).getTime(),
  { message: "Scheduled end must be after scheduled start", path: ["scheduledEnd"] },
);

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

      // #1500 — enforcement at submit, server-side, same gate the customer
      // wizard's create route enforces (`portal-change-control.ts`) — an MSP
      // console create is a second door into the same table and must not be
      // able to bypass a freeze that door blocks. The policy lives on the
      // TENANT (customer_id = tenants.id), so it is resolved from the free-text
      // (mspId, tenantId) pair this route works in, same as the retainer hook
      // below already does for the same reason.
      const [tenantForPolicy] = await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.mspId, mspId), eq(tenantsTable.tenantId, parsedBody.data.tenantId)))
        .limit(1);
      let policyRow: { enabled: boolean; enforceFreezeCalendar: boolean } | undefined;
      if (tenantForPolicy) {
        [policyRow] = await db
          .select({ enabled: portalChangeControlPolicyTable.enabled, enforceFreezeCalendar: portalChangeControlPolicyTable.enforceFreezeCalendar })
          .from(portalChangeControlPolicyTable)
          .where(eq(portalChangeControlPolicyTable.customerId, tenantForPolicy.id))
          .limit(1);
      }
      const freezeEnforced = policyRow?.enabled === true && policyRow?.enforceFreezeCalendar === true;
      const workload = workloadForCategory(parsedBody.data.category);
      const freezeCtx = { mspId, tenantId: parsedBody.data.tenantId, workload };
      const submitFreeze = freezeEnforced ? await activeFreezeForSubmit(freezeCtx, new Date()) : null;

      // #1762 — the MSP console is a second door into the same table and must
      // enforce the same booked-window check the customer wizard does, gated on
      // the same policy pair. Only fires when a real `scheduledStart` was given.
      const bookedFreeze =
        freezeEnforced && parsedBody.data.scheduledStart
          ? await freezeForBookedWindow(
              freezeCtx,
              new Date(parsedBody.data.scheduledStart),
              parsedBody.data.scheduledEnd ? new Date(parsedBody.data.scheduledEnd) : null,
            )
          : null;

      const blockingFreeze = submitFreeze ?? bookedFreeze;
      if (blockingFreeze && !parsedBody.data.freezeException) {
        apiError(
          res,
          409,
          ApiErrorCode.CONFLICT,
          submitFreeze
            ? `"${blockingFreeze.name}" is an active change freeze. Raising a change now requires a written exception.`
            : `The booked window overlaps the "${blockingFreeze.name}" change freeze. Scheduling into it requires a written exception.`,
        );
        return;
      }

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
          // #1762 — the real booked instant when supplied; NULL otherwise (never
          // a guess). `scheduledFor` (the label) is always kept.
          scheduledStart: parsedBody.data.scheduledStart ? new Date(parsedBody.data.scheduledStart) : null,
          scheduledEnd: parsedBody.data.scheduledEnd ? new Date(parsedBody.data.scheduledEnd) : null,
          impactedUsersCount: parsedBody.data.impactedUsersCount,
          status: "pending_approval",
          backupVerified: true,
          backupHash: randomHash,
          preChangeSnapshot: parsedBody.data.preChangeSnapshot,
          proposedPayload: parsedBody.data.proposedPayload,
          rollbackScriptSnippet: parsedBody.data.rollbackScriptSnippet,
          authorizedTargetKey: parsedBody.data.authorizedTargetKey ?? null,
        })
        .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

      // #1503 — every CR-creation path emits the `raised` event that opens its timeline.
      await recordCrEvent({
        changeRequestId: inserted.id,
        mspId,
        tenantId: parsedBody.data.tenantId,
        eventType: "raised",
        fromValue: null,
        toValue: "pending_approval",
        actorRole: "msp",
        actorPersonId: req.user ? personIdForUser(req.user.id) : null,
        actorName: userEmail,
        occurredAt: inserted.createdAt,
      });

      // #1500 — allowed through an active freeze ONLY because a justification
      // was given; that becomes its own higher-bar approval stage (MSP
      // sign-off required). Non-fatal: the CR already exists either way.
      if (blockingFreeze && parsedBody.data.freezeException) {
        try {
          await recordFreezeException({
            changeRequestId: inserted.id,
            mspId,
            tenantId: parsedBody.data.tenantId,
            freezeWindowId: blockingFreeze.id,
            justification: parsedBody.data.freezeException.justification,
            requestedBy: userEmail,
          });
        } catch (err) {
          log.error({ err, crId: inserted.id }, "change request created but freeze-exception stage failed to record");
        }
      }

      const newIdFormatted = formatCrId(inserted.id);

      res.status(201).json({
        id: newIdFormatted,
        message: "Change request submitted successfully",
        freezeException: blockingFreeze !== null,
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

      // #1503 — this generic PATCH is how the MSP console drives scheduled /
      // in_progress / completed / rolled_back / rejected. Every REAL status
      // change (not a re-save of the same status) is a transition the timeline
      // must have a hole-free record of. `pending_approval` has no lifecycle
      // event of its own — a CR arrives there via its `raised` event and never
      // legitimately transitions back into it — so it is not emitted here.
      const CR_STATUS_EVENT_TYPES = new Set(["scheduled", "in_progress", "completed", "rolled_back", "rejected"]);
      if (
        parsedBody.data.status !== undefined &&
        parsedBody.data.status !== existing.status &&
        CR_STATUS_EVENT_TYPES.has(parsedBody.data.status)
      ) {
        await recordCrEvent({
          changeRequestId: dbId,
          mspId,
          tenantId: existing.tenantId,
          eventType: parsedBody.data.status as "scheduled" | "in_progress" | "completed" | "rolled_back" | "rejected",
          fromValue: existing.status,
          toValue: parsedBody.data.status,
          actorRole: "msp",
          actorPersonId: req.user ? personIdForUser(req.user.id) : null,
          actorName: req.user?.email ?? null,
        });
      }

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

// ── Timeline: events, comments, attachments (#1503) — MSP-operator side ──────
//
// Mirrors the customer-portal routes in `routes/portal-change-control.ts` over
// the same three tables, scoped to `mspId` the same way every other route in
// this file is. `cr_events` is read-only here too — it is appended exclusively
// from the transitions above and from the customer-portal approval model
// (#1496); an operator posts a COMMENT, never an event directly.

interface WireCrEvent {
  readonly eventType: string;
  readonly fromValue: string | null;
  readonly toValue: string;
  readonly stage: number | null;
  readonly actorRole: string;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
}

interface WireCrComment {
  readonly authorRole: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

interface WireCrAttachment {
  readonly kind: string;
  readonly label: string;
  readonly externalUrl: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedByRole: string;
  readonly uploadedByName: string;
  readonly createdAt: string;
}

// GET /api/msp/change-requests/:id/timeline
router.get(
  "/msp/change-requests/:id/timeline",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }
      const dbId = parseCrId(String(req.params.id));
      if (dbId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
        return;
      }
      const [existing] = await db
        .select({ id: mspChangeRequestsTable.id })
        .from(mspChangeRequestsTable)
        .where(and(eq(mspChangeRequestsTable.id, dbId), eq(mspChangeRequestsTable.mspId, mspId)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }

      const [events, comments, attachments] = await Promise.all([
        listEventsForChangeIds([dbId]),
        listCommentsForChangeIds([dbId]),
        listAttachmentsForChangeIds([dbId]),
      ]);

      res.json({
        id: formatCrId(dbId),
        events: events.map((e): WireCrEvent => ({
          eventType: e.eventType,
          fromValue: e.fromValue,
          toValue: e.toValue,
          stage: e.stage,
          actorRole: e.actorRole,
          actorName: e.actorName,
          reason: e.reason,
          occurredAt: e.occurredAt.toISOString(),
        })),
        comments: comments.map((c): WireCrComment => ({
          authorRole: c.authorRole,
          authorName: c.authorName,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
        attachments: attachments.map((a): WireCrAttachment => ({
          kind: a.kind,
          label: a.label,
          externalUrl: a.externalUrl,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          uploadedByRole: a.uploadedByRole,
          uploadedByName: a.uploadedByName,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/change-requests/:id/timeline failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

const mspCommentSchema = z.object({ body: z.string().trim().min(1).max(4_000) });

// POST /api/msp/change-requests/:id/comments
router.post(
  "/msp/change-requests/:id/comments",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }
      const dbId = parseCrId(String(req.params.id));
      if (dbId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
        return;
      }
      const parsedBody = mspCommentSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid comment payload", parsedBody.error.flatten());
        return;
      }
      const [existing] = await db
        .select({ id: mspChangeRequestsTable.id, tenantId: mspChangeRequestsTable.tenantId })
        .from(mspChangeRequestsTable)
        .where(and(eq(mspChangeRequestsTable.id, dbId), eq(mspChangeRequestsTable.mspId, mspId)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }

      const comment = await addComment({
        changeRequestId: dbId,
        mspId,
        tenantId: existing.tenantId,
        authorRole: "msp",
        authorPersonId: req.user ? personIdForUser(req.user.id) : "unknown",
        authorName: req.user?.email || "unknown@mspplatform.com",
        body: parsedBody.data.body,
      });
      res.status(201).json({
        id: formatCrId(dbId),
        comment: { authorRole: comment.authorRole, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt.toISOString() } satisfies WireCrComment,
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-requests/:id/comments failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

const mspAttachmentSchema = z.object({
  kind: z.enum(["evidence", "test_result", "approval_email", "other"]).default("other"),
  label: z.string().trim().min(1).max(200),
  externalUrl: z.string().trim().url().max(2_000).optional(),
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().min(0).max(1_000_000_000).optional(),
});

// POST /api/msp/change-requests/:id/attachments
router.post(
  "/msp/change-requests/:id/attachments",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }
      const dbId = parseCrId(String(req.params.id));
      if (dbId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
        return;
      }
      const parsedBody = mspAttachmentSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid attachment payload", parsedBody.error.flatten());
        return;
      }
      const [existing] = await db
        .select({ id: mspChangeRequestsTable.id, tenantId: mspChangeRequestsTable.tenantId })
        .from(mspChangeRequestsTable)
        .where(and(eq(mspChangeRequestsTable.id, dbId), eq(mspChangeRequestsTable.mspId, mspId)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }

      const attachment = await addAttachment({
        changeRequestId: dbId,
        mspId,
        tenantId: existing.tenantId,
        kind: parsedBody.data.kind,
        label: parsedBody.data.label,
        externalUrl: parsedBody.data.externalUrl ?? null,
        mimeType: parsedBody.data.mimeType ?? null,
        sizeBytes: parsedBody.data.sizeBytes ?? null,
        uploadedByRole: "msp",
        uploadedByPersonId: req.user ? personIdForUser(req.user.id) : "unknown",
        uploadedByName: req.user?.email || "unknown@mspplatform.com",
      });
      res.status(201).json({
        id: formatCrId(dbId),
        attachment: {
          kind: attachment.kind,
          label: attachment.label,
          externalUrl: attachment.externalUrl,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uploadedByRole: attachment.uploadedByRole,
          uploadedByName: attachment.uploadedByName,
          createdAt: attachment.createdAt.toISOString(),
        } satisfies WireCrAttachment,
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-requests/:id/attachments failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;

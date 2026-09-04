/**
 * THE DELETION LIFECYCLE (Git #1947, EPIC #1944 parts 1-8).
 *
 * The one write path for every deletion in the platform. A module registers itself
 * (`registry.ts`) and its blocking edges (`reference-guard.ts`), and then calls
 * `softDelete()` instead of writing `DELETE FROM`.
 *
 *     delete → [ soft ]      ghost, customer-recoverable
 *            → [ semi_hard ] ghost, operator-recoverable only
 *            →   purged      genuinely gone; the ledger row survives
 *
 * Everything irreversible here is deliberately narrow: `purgeNow()` is the only
 * function that destroys a record, and the only ways to reach it are the clock running
 * out, an operator-approved acceleration, or a manual-origin bypass that also passed
 * the referential guard.
 *
 * NOT here, on purpose:
 *   * **No SWEEP-BOUNDARY notification firing.** #1944 part 1 routes the boundary
 *     alerts (soft → semi_hard, semi_hard → purged) through the existing POA&M
 *     escalation machinery *"rather than a second scheduler"*, and the rules are
 *     recorded on #1942. This module makes those boundaries observable —
 *     `advanceDueDeletions()` returns every transition it made — and #1942's rules
 *     consume them. `restore()` is a one-shot operator action, not a scheduled
 *     boundary crossing, so it is exempt from that split: it fires its own real
 *     trigger directly (#2764, EPIC #1944 part 5 — *"they should not discover it by
 *     noticing a row reappear"*), via `notifyRetentionRestore()`.
 *   * **No audit table.** #1946 owns the trail; this consumes it through the existing
 *     `createAuditLog`.
 *   * **No permission check.** Which principal may recover from which tier is #1704's
 *     `can(principal, action, resource)` — part 1 is explicit that it is a permission
 *     boundary, *"not a role-ladder comparison, and not a flag on the row"*. Callers
 *     evaluate `can()` and then call in here.
 */

import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  recordDeletionsTable,
  type RecordDeletion,
  type RetentionAccelerationReason,
  type RetentionAccelerationState,
  type RetentionDeleteSide,
  type RetentionStage,
} from "@workspace/db";
import { logger } from "../logger";
import { createAuditLog } from "../audit";
import { notifyRetentionRestore } from "../notification-center";
import {
  advanceStageClock,
  freezeClock,
  isDue,
  isRunningStage,
  nextStage,
  remainingSeconds,
  resumeClock,
  startClock,
  stageDurations,
  stageSeconds,
  type RetentionClockState,
} from "./clock";
import { isManualOrigin } from "./origin-registry";
import {
  DeleteRefusedError,
  checkDeleteAllowed,
  type DeleteGuardTarget,
  type ReferenceEdge,
} from "./reference-guard";
import { isRetentionClockRunning, resolveRetentionPolicy } from "./policy";
import { requireRetainedRecordType, type RetentionTx } from "./registry";

const log = logger.child({ channel: "system.core" });

export interface RetentionActor {
  /** Display identity, captured verbatim — it must survive the user being removed. */
  name: string;
  role: "admin" | "client";
  userId?: number | null;
  /** Which side of the relationship acted. Drives the #1571 operator queue's grouping. */
  side: RetentionDeleteSide;
}

/** Read the clock columns off a ledger row into the shape `clock.ts` operates on. */
export function clockOf(row: RecordDeletion): RetentionClockState {
  return {
    stageEnteredAt: row.stageEnteredAt,
    stageRemainingSeconds: row.stageRemainingSeconds,
    stageDueAt: row.stageDueAt,
    frozenAt: row.frozenAt,
    frozenReason: row.frozenReason,
    totalFrozenSeconds: row.totalFrozenSeconds,
    freezeCount: row.freezeCount,
  };
}

function clockColumns(clock: RetentionClockState) {
  return {
    stageEnteredAt: clock.stageEnteredAt,
    stageRemainingSeconds: clock.stageRemainingSeconds,
    stageDueAt: clock.stageDueAt,
    frozenAt: clock.frozenAt,
    frozenReason: clock.frozenReason,
    totalFrozenSeconds: clock.totalFrozenSeconds,
    freezeCount: clock.freezeCount,
  };
}

/**
 * `checkDeleteAllowed`, but throwing — and **auditing the refusal**.
 *
 * #1944: *"A refused delete is an audited action... A customer repeatedly attempting to
 * delete a risk with an open POA&M against it is a signal worth having, and it belongs
 * in the same operator view as the accelerated-delete queue."* The audit trail itself
 * is #1946's; this consumes it through the existing `createAuditLog` rather than
 * opening a second one.
 *
 * It lives here rather than in `reference-guard.ts` so that module stays free of the
 * database and the platform logger, and its rules stay testable as pure functions.
 */
export async function assertDeleteAllowed(
  target: DeleteGuardTarget,
  actor: { name: string; role: "admin" | "client"; userId?: number | null },
): Promise<void> {
  const result = await checkDeleteAllowed(target, {
    onEdgeError: (edge: ReferenceEdge, err: unknown) =>
      log.error(
        { err, edgeId: edge.id, recordType: target.recordType, recordId: target.recordId },
        "retention: reference edge failed; refusing the delete rather than assuming no dependants",
      ),
  });
  if (result.allowed) return;

  await createAuditLog({
    actorUserId: actor.userId ?? null,
    actorName: actor.name,
    actorRole: actor.role,
    actionType: "retention.delete_refused",
    entityType: target.recordType,
    entityId: target.recordId,
    entityLabel: target.label ?? null,
    clientId: target.tenantId,
    metadata: { blockers: result.blockers, message: result.message },
  });

  throw new DeleteRefusedError(target, result.blockers);
}

export class RetentionError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "RetentionError";
    this.httpStatus = httpStatus;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

export interface SoftDeleteInput {
  recordType: string;
  recordId: string;
  reason: string;
  actor: RetentionActor;
  /**
   * Request the manual-origin hard-delete bypass — straight to purge, skipping both
   * recoverable tiers. Only honoured when the record's provenance actually resolves to
   * manual; a system-origin record is refused rather than silently soft-deleted, because
   * a caller that asked for an irreversible action must not be told it happened when it
   * did not.
   *
   * The escalating friction #1935 part 4 requires — warning, stronger warning, type the
   * exact name, final confirmation — is a UI obligation, not something this function can
   * verify. It records that the bypass was taken.
   */
  hardDeleteBypass?: boolean;
}

/**
 * Soft-delete a record: refuse it if anything still depends on it, then mark the
 * record and open its ledger row in ONE transaction so the cheap read-path marker and
 * the authoritative lifecycle state can never disagree.
 *
 * A delete with no reason is impossible by construction (#1944 part 5) — the reason is
 * required here, `record_deletions.delete_reason` is `NOT NULL`, and a blank string is
 * rejected rather than stored.
 */
export async function softDelete(input: SoftDeleteInput): Promise<RecordDeletion> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new RetentionError("A delete reason is required.", 400);
  }

  const type = requireRetainedRecordType(input.recordType);
  const snapshot = await type.load(input.recordId);
  if (!snapshot) {
    throw new RetentionError(`${type.displayName} ${input.recordId} does not exist.`, 404);
  }
  if (snapshot.alreadyDeleted) {
    throw new RetentionError(`${type.displayName} ${input.recordId} is already deleted.`, 409);
  }

  const target = {
    recordType: input.recordType,
    recordId: input.recordId,
    tenantId: snapshot.tenantId,
    mspId: snapshot.mspId,
    label: snapshot.label,
  };

  // GATE 1 — references. Independent of provenance, and the bypass does not skip it:
  // "a record that other records already depend on is not a mistake-create, whatever
  // its origin." Throws DeleteRefusedError naming every blocker, and audits the refusal.
  await assertDeleteAllowed(target, { name: input.actor.name, role: input.actor.role, userId: input.actor.userId });

  // GATE 2 — provenance, and only for the bypass. A normal soft delete does not consult it.
  const originManual = isManualOrigin(input.recordType, snapshot.rawOrigin);
  if (input.hardDeleteBypass && !originManual) {
    throw new RetentionError(
      `${type.displayName} ${input.recordId} was not created by hand, so it cannot be hard-deleted. ` +
        "It runs the normal retention lifecycle.",
      403,
    );
  }

  const now = new Date();
  const policy = await resolveRetentionPolicy(snapshot.tenantId);
  const durations = stageDurations(policy.softDelete.days, policy.semiHardDelete.days);
  const running = await isRetentionClockRunning(snapshot.tenantId);

  let clock = startClock(durations.softSeconds, now);
  if (!running) {
    // The customer's subscription is not active, so the clock freezes on arrival
    // (#1944 part 7). A record deleted during lock-down does not quietly serve its
    // 90 days while the tenant is gone.
    clock = freezeClock(clock, now, "subscription_inactive");
  }

  const bypassing = input.hardDeleteBypass === true;
  const stage: RetentionStage = bypassing ? "purged" : "soft";

  // A bypass destroys the row outright, so the soft-delete triple is never written —
  // marking a row deleted and then deleting it in the same statement pair would be a
  // write with no reader.
  const row = await db.transaction(async (tx) => {
    if (bypassing) {
      await type.hardDelete(tx, input.recordId);
    } else {
      await type.markDeleted(tx, input.recordId, { deletedAt: now, deletedBy: input.actor.name, deleteReason: reason });
    }
    const [inserted] = await tx
      .insert(recordDeletionsTable)
      .values({
        mspId: snapshot.mspId,
        tenantId: snapshot.tenantId,
        recordType: input.recordType,
        recordId: input.recordId,
        recordLabel: snapshot.label,
        stage,
        deletedAt: now,
        deletedBy: input.actor.name,
        deletedByUserId: input.actor.userId ?? null,
        deletedBySide: input.actor.side,
        deleteReason: reason,
        recordOrigin: snapshot.rawOrigin,
        originManual,
        bypassUsed: bypassing,
        purgedAt: bypassing ? now : null,
        // A purged row has no clock at all — not a frozen one. Leaving `frozenAt` set
        // on a record that is already gone would make the ledger read as though
        // something were still waiting to resume.
        ...clockColumns(
          bypassing
            ? { ...clock, stageRemainingSeconds: 0, stageDueAt: null, frozenAt: null, frozenReason: null }
            : clock,
        ),
      })
      .returning();
    return inserted;
  });

  await createAuditLog({
    actorUserId: input.actor.userId ?? null,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actionType: bypassing ? "retention.hard_delete_bypass" : "retention.soft_delete",
    entityType: input.recordType,
    entityId: input.recordId,
    entityLabel: snapshot.label,
    clientId: snapshot.tenantId,
    metadata: {
      reason,
      stage,
      recordOrigin: snapshot.rawOrigin,
      originManual,
      softDeleteDays: policy.softDelete.days,
      softDeleteDaysIsDefault: policy.softDelete.isDefault,
      clockFrozenOnArrival: !running,
    },
  });

  log.info(
    { recordType: input.recordType, recordId: input.recordId, stage, frozen: !running },
    "retention: record deleted",
  );
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bring a record back. #1944 part 5: the restore reason is REQUIRED, the customer is
 * told the record came back, and the reason is reachable from the record itself in one
 * click — *"a record silently returning after they deleted it is confusing."* The
 * notification is #1942's rule; this writes the reason it will quote.
 *
 * Which principal may restore from which stage is #1704's `can()` — a caller evaluates
 * that and then calls in here. The stage is not a permission and is not re-checked as one.
 */
export async function restore(input: {
  deletionId: number;
  reason: string;
  actor: RetentionActor;
}): Promise<RecordDeletion> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new RetentionError("A restore reason is required.", 400);
  }

  const [row] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, input.deletionId)).limit(1);
  if (!row) throw new RetentionError(`Deletion ${input.deletionId} does not exist.`, 404);
  if (row.stage === "purged") {
    throw new RetentionError("This record was purged and cannot be restored.", 410);
  }
  if (row.stage === "restored") {
    throw new RetentionError("This record has already been restored.", 409);
  }

  const type = requireRetainedRecordType(row.recordType);
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    await type.clearDeleted(tx, row.recordId);
    const [next] = await tx
      .update(recordDeletionsTable)
      .set({
        stage: "restored",
        restoredAt: now,
        restoredBy: input.actor.name,
        restoreReason: reason,
        // The clock stops meaning anything once the record is back. Null rather than a
        // frozen remainder: a restored record is not paused, it is alive, and leaving a
        // due date behind would put it back in the sweep's index.
        stageDueAt: null,
        frozenAt: null,
        frozenReason: null,
        updatedAt: now,
      })
      .where(eq(recordDeletionsTable.id, row.id))
      .returning();
    return next;
  });

  await createAuditLog({
    actorUserId: input.actor.userId ?? null,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actionType: "retention.restore",
    entityType: row.recordType,
    entityId: row.recordId,
    entityLabel: row.recordLabel,
    clientId: row.tenantId,
    metadata: { reason, restoredFromStage: row.stage },
  });

  // The real trigger #2764 asks for. Best-effort and never throws (see
  // notifyRetentionRestore's own doc comment) -- a delivery failure must not make
  // this function report the restore itself as having failed.
  await notifyRetentionRestore({
    tenantId: row.tenantId,
    recordType: row.recordType,
    recordLabel: row.recordLabel,
    restoreReason: reason,
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accelerated delete (#1944 parts 1, 2, 4, 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A customer (or the operator) asks for the clock to be cut short.
 *
 * **It does not execute.** Part 2: *"A customer can request acceleration. It does not
 * execute until the operator agrees."* Requesting is itself an audited action whatever
 * the outcome, because a customer dropping policies, risk decisions and POA&Ms in
 * volume is a signal about that account.
 *
 * Both halves of the reason are captured — the kind and the free text — and where the
 * kind is `superseded_by`, the successor record is recorded as a real edge rather than
 * mentioned in prose.
 */
export async function requestAcceleration(input: {
  deletionId: number;
  reasonKind: RetentionAccelerationReason;
  reason: string;
  supersededBy?: { recordType: string; recordId: string } | null;
  actor: RetentionActor;
}): Promise<RecordDeletion> {
  const reason = input.reason?.trim();
  if (!reason) throw new RetentionError("An acceleration reason is required.", 400);
  if (input.reasonKind === "superseded_by" && !input.supersededBy) {
    throw new RetentionError("A 'superseded by' acceleration must name the record that replaced this one.", 400);
  }

  const [row] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, input.deletionId)).limit(1);
  if (!row) throw new RetentionError(`Deletion ${input.deletionId} does not exist.`, 404);
  if (!isRunningStage(row.stage as RetentionStage)) {
    throw new RetentionError("Only a record still inside its retention window can be accelerated.", 409);
  }
  if (row.accelerationState === "pending") {
    throw new RetentionError("An acceleration request is already awaiting review for this record.", 409);
  }

  const now = new Date();
  const [updated] = await db
    .update(recordDeletionsTable)
    .set({
      accelerationState: "pending",
      accelerationRequestedAt: now,
      accelerationRequestedBy: input.actor.name,
      accelerationReasonKind: input.reasonKind,
      accelerationReason: reason,
      supersededByRecordType: input.supersededBy?.recordType ?? null,
      supersededByRecordId: input.supersededBy?.recordId ?? null,
      // Cleared, so a re-request after a decline does not read as still-declined.
      accelerationDecidedAt: null,
      accelerationDecidedBy: null,
      accelerationDecisionNote: null,
      updatedAt: now,
    })
    .where(eq(recordDeletionsTable.id, row.id))
    .returning();

  await createAuditLog({
    actorUserId: input.actor.userId ?? null,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actionType: "retention.acceleration_requested",
    entityType: row.recordType,
    entityId: row.recordId,
    entityLabel: row.recordLabel,
    clientId: row.tenantId,
    metadata: { reasonKind: input.reasonKind, reason, supersededBy: input.supersededBy ?? null },
  });

  return updated;
}

/**
 * The operator's decision on an acceleration request (#1944 parts 2 and 4).
 *
 *   approve → the purge proceeds now
 *   decline → the record runs the normal clock instead. *"Nothing is lost."*
 *
 * The third outcome part 4 describes — discuss, then restore and modify — is
 * `decideAcceleration({ approve: false })` followed by `restore()`; the conversation
 * happens outside the product and there is no third state to model.
 */
export async function decideAcceleration(input: {
  deletionId: number;
  approve: boolean;
  note?: string | null;
  actor: RetentionActor;
}): Promise<RecordDeletion> {
  const [row] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, input.deletionId)).limit(1);
  if (!row) throw new RetentionError(`Deletion ${input.deletionId} does not exist.`, 404);
  if (row.accelerationState !== "pending") {
    throw new RetentionError("There is no acceleration request awaiting review for this record.", 409);
  }

  const now = new Date();
  await db
    .update(recordDeletionsTable)
    .set({
      accelerationState: input.approve ? "approved" : "declined",
      accelerationDecidedAt: now,
      accelerationDecidedBy: input.actor.name,
      accelerationDecisionNote: input.note?.trim() || null,
      updatedAt: now,
    })
    .where(eq(recordDeletionsTable.id, row.id));

  await createAuditLog({
    actorUserId: input.actor.userId ?? null,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actionType: input.approve ? "retention.acceleration_approved" : "retention.acceleration_declined",
    entityType: row.recordType,
    entityId: row.recordId,
    entityLabel: row.recordLabel,
    clientId: row.tenantId,
    metadata: { note: input.note ?? null },
  });

  if (!input.approve) {
    const [current] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, row.id)).limit(1);
    return current;
  }
  return purgeNow({ deletionId: row.id, actor: input.actor, cause: "acceleration_approved" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Purge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * T-0. The record is genuinely destroyed and the ledger row survives it (#1944 part 2 —
 * *"a purge that also erases the evidence it happened is not a retention policy, it is
 * amnesia"*).
 *
 * The record and the ledger row move in ONE transaction, so there is no window in
 * which the row is gone and nothing records that it was.
 */
export async function purgeNow(input: {
  deletionId: number;
  actor: RetentionActor;
  cause: "clock_expired" | "acceleration_approved" | "hard_delete_bypass" | "post_termination";
}): Promise<RecordDeletion> {
  const [row] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, input.deletionId)).limit(1);
  if (!row) throw new RetentionError(`Deletion ${input.deletionId} does not exist.`, 404);
  if (row.stage === "purged") return row;
  if (row.stage === "restored") {
    throw new RetentionError("This record was restored and is no longer scheduled for purge.", 409);
  }

  const type = requireRetainedRecordType(row.recordType);
  const now = new Date();

  const updated = await db.transaction(async (tx: RetentionTx) => {
    await type.hardDelete(tx, row.recordId);
    const [next] = await tx
      .update(recordDeletionsTable)
      .set({
        stage: "purged",
        purgedAt: now,
        stageRemainingSeconds: 0,
        stageDueAt: null,
        frozenAt: null,
        frozenReason: null,
        updatedAt: now,
      })
      .where(eq(recordDeletionsTable.id, row.id))
      .returning();
    return next;
  });

  await createAuditLog({
    actorUserId: input.actor.userId ?? null,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actionType: "retention.purged",
    entityType: row.recordType,
    entityId: row.recordId,
    entityLabel: row.recordLabel,
    clientId: row.tenantId,
    metadata: { cause: input.cause, deletedAt: row.deletedAt, deleteReason: row.deleteReason },
  });

  log.info({ recordType: row.recordType, recordId: row.recordId, cause: input.cause }, "retention: record purged");
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Freeze / resume — the tenant-level clock control (#1944 part 7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Freeze every running clock for one customer. Called when a subscription lapses.
 *
 * *"Per-record clocks FREEZE. Whatever state each record is in (live, ghosted,
 * semi-hard) holds exactly where it was."*
 *
 * Idempotent — a record already frozen is skipped rather than re-stamped, so a repeated
 * sweep cannot quietly extend anything's life.
 */
export async function freezeTenantClocks(tenantId: number, reason = "subscription_inactive"): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(recordDeletionsTable)
    .where(
      and(
        eq(recordDeletionsTable.tenantId, tenantId),
        inArray(recordDeletionsTable.stage, ["soft", "semi_hard"]),
        sql`${recordDeletionsTable.frozenAt} IS NULL`,
      ),
    );

  for (const row of rows) {
    const frozen = freezeClock(clockOf(row), now, reason);
    await db
      .update(recordDeletionsTable)
      .set({ ...clockColumns(frozen), updatedAt: now })
      .where(eq(recordDeletionsTable.id, row.id));
  }

  if (rows.length > 0) {
    log.info({ tenantId, count: rows.length, reason }, "retention: froze tenant clocks");
  }
  return rows.length;
}

/**
 * Resume every frozen clock for one customer, from exactly the remainder it froze with.
 * Called when the subscription goes active again — the gate is symmetric and
 * re-evaluated live, not a one-time transition (part 8).
 */
export async function resumeTenantClocks(tenantId: number): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(recordDeletionsTable)
    .where(
      and(
        eq(recordDeletionsTable.tenantId, tenantId),
        inArray(recordDeletionsTable.stage, ["soft", "semi_hard"]),
        isNotNull(recordDeletionsTable.frozenAt),
      ),
    );

  for (const row of rows) {
    const resumed = resumeClock(clockOf(row), now);
    await db
      .update(recordDeletionsTable)
      .set({ ...clockColumns(resumed), updatedAt: now })
      .where(eq(recordDeletionsTable.id, row.id));
  }

  if (rows.length > 0) {
    log.info({ tenantId, count: rows.length }, "retention: resumed tenant clocks");
  }
  return rows.length;
}

/**
 * Reconcile every tenant's clocks against its real billing state, in both directions.
 * This is what makes the freeze live rather than transition-triggered: a subscription
 * that lapsed while nothing was watching still freezes on the next pass.
 */
export async function reconcileTenantClocks(tenantIds: number[]): Promise<{ frozen: number; resumed: number }> {
  let frozen = 0;
  let resumed = 0;
  for (const tenantId of tenantIds) {
    if (await isRetentionClockRunning(tenantId)) {
      resumed += await resumeTenantClocks(tenantId);
    } else {
      frozen += await freezeTenantClocks(tenantId);
    }
  }
  return { frozen, resumed };
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

export interface StageTransition {
  deletionId: number;
  recordType: string;
  recordId: string;
  tenantId: number;
  from: RetentionStage;
  to: RetentionStage;
}

/**
 * Advance every deletion whose current stage has run out: soft → semi_hard, and
 * semi_hard → purged.
 *
 * A frozen record is absent from the query by index shape (`stage_due_at` is null while
 * frozen and the sweep index is partial on `stage_due_at IS NOT NULL`), and `isDue()`
 * asserts it again in code. Two independent guards, because the failure mode is
 * irreversible.
 *
 * Returns every transition it made. Those are the boundary crossings #1942's alert
 * rules fire on — this module deliberately does not fire them itself, so there is one
 * scheduler rather than two (#1944 part 1).
 */
export async function advanceDueDeletions(options?: { limit?: number; actor?: RetentionActor }): Promise<StageTransition[]> {
  const now = new Date();
  const actor: RetentionActor = options?.actor ?? { name: "retention-sweep", role: "admin", side: "system" };

  const due = await db
    .select()
    .from(recordDeletionsTable)
    .where(
      and(
        inArray(recordDeletionsTable.stage, ["soft", "semi_hard"]),
        isNotNull(recordDeletionsTable.stageDueAt),
        lte(recordDeletionsTable.stageDueAt, now),
      ),
    )
    .limit(options?.limit ?? 500);

  const transitions: StageTransition[] = [];

  for (const row of due) {
    const clock = clockOf(row);
    // Belt and braces: the partial index already excludes frozen rows.
    if (!isDue(clock, now)) continue;

    const from = row.stage as RetentionStage;
    const to = nextStage(from);
    if (!to) continue;

    if (to === "purged") {
      await purgeNow({ deletionId: row.id, actor, cause: "clock_expired" });
    } else {
      const policy = await resolveRetentionPolicy(row.tenantId);
      const durations = stageDurations(policy.softDelete.days, policy.semiHardDelete.days);
      const advanced = advanceStageClock(clock, stageSeconds(to, durations), now);
      await db
        .update(recordDeletionsTable)
        .set({ stage: to, ...clockColumns(advanced), updatedAt: now })
        .where(eq(recordDeletionsTable.id, row.id));
    }

    transitions.push({
      deletionId: row.id,
      recordType: row.recordType,
      recordId: row.recordId,
      tenantId: row.tenantId,
      from,
      to,
    });
  }

  if (transitions.length > 0) {
    log.info({ count: transitions.length }, "retention: advanced due deletions");
  }
  return transitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** A single ledger row by its own id. Used by a caller that already has a `deletionId` — the operator queue's own actions, in particular. */
export async function getDeletionById(deletionId: number): Promise<RecordDeletion | null> {
  const [row] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, deletionId)).limit(1);
  return row ?? null;
}

/** The open deletion for a record, if it has one. Used by a module's own read path. */
export async function findOpenDeletion(recordType: string, recordId: string): Promise<RecordDeletion | null> {
  const [row] = await db
    .select()
    .from(recordDeletionsTable)
    .where(
      and(
        eq(recordDeletionsTable.recordType, recordType),
        eq(recordDeletionsTable.recordId, recordId),
        inArray(recordDeletionsTable.stage, ["soft", "semi_hard"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * How a ghosted record reads to a surface. #1944 part 5: the ghost state is *"a real,
 * designed state, not a greyed-out row: clearly deleted, clearly not final, clearly
 * awaiting review"*, and the backlog must be countable.
 *
 * `remainingSeconds` is null while frozen — an unknown-length freeze has no honest
 * countdown, and showing one would be inventing a number.
 */
export interface GhostState {
  deletionId: number;
  stage: RetentionStage;
  deletedAt: Date;
  deletedBy: string;
  deleteReason: string;
  frozen: boolean;
  remainingSeconds: number | null;
  underReview: boolean;
}

export function ghostStateOf(row: RecordDeletion, now = new Date()): GhostState {
  const clock = clockOf(row);
  const frozen = clock.frozenAt !== null;
  return {
    deletionId: row.id,
    stage: row.stage as RetentionStage,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    deleteReason: row.deleteReason,
    frozen,
    remainingSeconds: frozen ? null : remainingSeconds(clock, now),
    underReview: row.accelerationState === "pending",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The #1571 operator review queue (#2764, EPIC #1944 parts 2, 4-5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row of the accelerated-delete review queue, shaped for an operator to triage
 * without opening each record individually. `deleteReason` is the ORIGINAL reason
 * captured at delete time — #1944's own example is the reason this needs to be its
 * own field alongside the acceleration reason: *"'superseded by the new CA policy'
 * and 'we don't agree with this finding' need completely different responses"* —
 * that is what tells an operator a supersession apart from a disagreement without
 * opening the record (#2764 item 4).
 */
export interface AccelerationQueueItem {
  deletionId: number;
  recordType: string;
  recordId: string;
  recordLabel: string | null;
  tenantId: number;
  stage: RetentionStage;
  deletedAt: Date;
  deletedBy: string;
  deletedBySide: RetentionDeleteSide;
  deleteReason: string;
  accelerationState: RetentionAccelerationState;
  accelerationRequestedAt: Date;
  accelerationRequestedBy: string;
  accelerationReasonKind: RetentionAccelerationReason;
  accelerationReason: string;
  supersededByRecordType: string | null;
  supersededByRecordId: string | null;
}

/**
 * Every pending acceleration request across an MSP's book, newest request first —
 * uses `record_deletions_acceleration_queue_idx` (#1947), the index built for
 * exactly this read. `tenantIds`, when given, restricts to that set — the caller's
 * own per-staff scoping (`resolveStaffScopedCustomerIds`), since cross-customer
 * visibility for a scoped operator is a hard boundary (#1949's own standing
 * constraint, which this backend honours even though that issue's UI was reset).
 */
export async function listAccelerationQueue(
  mspId: number,
  options?: { tenantIds?: number[] | null },
): Promise<AccelerationQueueItem[]> {
  const rows = await db
    .select()
    .from(recordDeletionsTable)
    .where(
      and(
        eq(recordDeletionsTable.mspId, mspId),
        eq(recordDeletionsTable.accelerationState, "pending"),
        ...(options?.tenantIds ? [inArray(recordDeletionsTable.tenantId, options.tenantIds)] : []),
      ),
    )
    .orderBy(desc(recordDeletionsTable.accelerationRequestedAt));

  return rows.map((row): AccelerationQueueItem => ({
    deletionId: row.id,
    recordType: row.recordType,
    recordId: row.recordId,
    recordLabel: row.recordLabel,
    tenantId: row.tenantId,
    stage: row.stage as RetentionStage,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    deletedBySide: row.deletedBySide as RetentionDeleteSide,
    deleteReason: row.deleteReason,
    accelerationState: row.accelerationState as RetentionAccelerationState,
    // Non-null by construction: the WHERE clause above restricts to
    // accelerationState = "pending", and requestAcceleration() never sets that
    // state without also setting these four columns in the same write.
    accelerationRequestedAt: row.accelerationRequestedAt as Date,
    accelerationRequestedBy: row.accelerationRequestedBy as string,
    accelerationReasonKind: row.accelerationReasonKind as RetentionAccelerationReason,
    accelerationReason: row.accelerationReason as string,
    supersededByRecordType: row.supersededByRecordType,
    supersededByRecordId: row.supersededByRecordId,
  }));
}

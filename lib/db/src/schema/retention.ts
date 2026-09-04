/**
 * PLATFORM RETENTION & SOFT DELETE (Git #1947, foundation for EPIC #1944).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this file is, and what it deliberately is NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #1944 settled a three-tier deletion lifecycle:
 *
 *     delete → [ soft, 90d ]      recoverable by the customer (permission-gated)
 *            → [ semi-hard, 30d ] recoverable by the operator only
 *            →   T-0              PURGED — genuinely gone
 *
 * Those durations are **per-customer policy defaults, not constants** (epic body),
 * so they live in `retention_policies` below, per tenant, with the platform default
 * used — and reported AS the default — when a customer has no override.
 *
 * This file is the FOUNDATION only: the policy, the shared soft-delete column shape,
 * and the lifecycle/clock ledger. It contains:
 *
 *   - NO tenant lock-down flag. #1944 part 8 REVERSED part 7 on this point: lock-down
 *     is a routing-layer active-subscription gate sitting ahead of `can()`, not a
 *     column. *"No schema for a lock-down flag. No new auth mode."* The clock's freeze
 *     input is therefore read from the tenant's existing billing state
 *     (`tenants.status`), never from a second "is this tenant locked down" flag.
 *   - NO audit table. #1944 part 2 settled that the deletion account is an audit
 *     sequence and #1946 owns the audit trail; this epic **consumes** it. The one
 *     record kept here is the `record_deletions` row itself, which by the same part-2
 *     ruling is explicitly NOT subject to the retention policy it enforces — it
 *     survives the purge of the record it describes.
 *   - NO per-module wiring. `softDeleteColumns()` is the shape each consuming
 *     module's own issue spreads into its own table; nothing is added to any
 *     existing table here.
 *   - NO backfill. Epic question E: *"do not backfill a deletion timestamp onto
 *     anything"*. Every column added by a consuming module is nullable-by-absence and
 *     history begins when the mechanism lands.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mspsTable, tenantsTable } from "./msp";

// ─────────────────────────────────────────────────────────────────────────────
// Platform defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The platform's own retention numbers, settled on #1944 parts 1 and 7. These are
 * the values used when a customer has no `retention_policies` row, or has a row that
 * leaves a given duration null. **They are a default, and a surface showing one must
 * say it is the default** — the epic's standing constraint is that a policy with no
 * configured value shows the default and says so, never a blank.
 *
 * `postTerminationYears` is a different clock from the other two: the per-record
 * 90/30 clock runs while the customer is active, and FREEZES entirely when the
 * subscription lapses (part 7). The 7-year figure is the window the whole dataset
 * is held for after cancellation, at the end of which everything is purged with no
 * cold-storage exception.
 */
export const RETENTION_DEFAULT_SOFT_DELETE_DAYS = 90;
export const RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS = 30;
export const RETENTION_DEFAULT_POST_TERMINATION_YEARS = 7;

/**
 * Which `tenants.status` values mean "the per-record retention clock is running".
 *
 * #1947's body is explicit that the subscription gate reads `tenants.status` (or
 * whatever real billing-state column governs it) and **does not introduce a second
 * "is this tenant locked down" flag**. `msp_subscriptions` is the MSP's own
 * subscription to the platform (one row per MSP), not a per-customer one, so
 * `tenants.status` is genuinely the only per-customer billing state that exists
 * today.
 *
 * `onboarding` counts as running: a customer being onboarded has not cancelled, and
 * freezing their clocks would be a freeze with no cancellation behind it. `inactive`
 * and `archived` are the states that mean the relationship has stopped, and those
 * are what freeze the clock.
 *
 * If a real per-tenant subscription/billing-state column ever lands, THIS constant
 * is the one place that has to change — nothing else in the mechanism reads tenant
 * status directly.
 */
export const RETENTION_CLOCK_RUNNING_TENANT_STATUSES = ["active", "onboarding"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Vocabularies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a deleted record sits in the lifecycle. Plain text with an `enum` union for
 * the type and no DB CHECK — the same widen-in-code convention `msp_sop_runs.origin`
 * and `msp_sop_runs.status` already follow, so a stage can be added without a
 * migration.
 *
 * `soft` and `semi_hard` are BOTH the "ghost" state from #1944 part 5 — the record
 * stays visible to the customer, visually marked deleted-and-under-review. Ghost is
 * not a fourth stage; it is how stages 1 and 2 render. What distinguishes the two is
 * **who can recover it**, which resolves through #1704's `can()`, not through a flag
 * on the row (part 1: *"Recoverability is what distinguishes the tiers, not
 * visibility"*).
 *
 * `restored` is terminal for this ledger row: the record came back, and a subsequent
 * delete opens a NEW row rather than reviving this one, so the account of each
 * deletion stays separate.
 */
export const RETENTION_STAGES = ["soft", "semi_hard", "purged", "restored"] as const;
export type RetentionStage = (typeof RETENTION_STAGES)[number];

/** Who asked for the delete. Drives the #1571 operator review queue's grouping. */
export const RETENTION_DELETE_SIDES = ["customer", "operator", "system"] as const;
export type RetentionDeleteSide = (typeof RETENTION_DELETE_SIDES)[number];

/**
 * #1944 part 2 — a customer CAN request that a delete be accelerated straight to
 * purge, but it does not execute until the operator agrees. `none` is the normal
 * case (the record just runs its clock).
 */
export const RETENTION_ACCELERATION_STATES = ["none", "pending", "approved", "declined"] as const;
export type RetentionAccelerationState = (typeof RETENTION_ACCELERATION_STATES)[number];

/**
 * #1944 part 1 — the two real reasons for accelerating, and **both are captured, not
 * just the decision**. `superseded_by` points at the record that replaced this one,
 * which is a real edge and the same idea as #1508's supersession chain — see
 * `supersededByRecordType` / `supersededByRecordId` below.
 */
export const RETENTION_ACCELERATION_REASONS = ["superseded_by", "no_longer_needed"] as const;
export type RetentionAccelerationReason = (typeof RETENTION_ACCELERATION_REASONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// The shared soft-delete column shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE soft-delete triple, defined once (#1947: *"consistent shape across tables"*).
 *
 * A consuming module spreads this into its own table rather than hand-declaring three
 * columns, which is what stops the four-modules-four-mechanisms drift #1944 was filed
 * to end:
 *
 * ```ts
 * export const someTable = pgTable("some_table", {
 *   id: serial("id").primaryKey(),
 *   ...softDeleteColumns(),
 * });
 * ```
 *
 * Drizzle column builders are constructed per call, so calling this once per table is
 * correct and the returned builders are never shared between tables.
 *
 * **These three columns are a denormalized marker, not the lifecycle state.** They
 * exist so a module's ordinary read path can say `WHERE deleted_at IS NULL` without
 * joining anything — that is #1944 part 1's "reads exclude soft-deleted rows by
 * default" convention, and a join per list query would make it expensive enough that
 * modules would skip it. The authoritative lifecycle state — stage, clock, freeze,
 * acceleration, restore, purge — is the `record_deletions` row, and both are written
 * in ONE transaction by the platform helper so they cannot drift.
 *
 * `deleteReason` is `notNull`-when-set by construction rather than by column
 * constraint: the column has to be nullable because a live row has no reason, and a
 * nullable column cannot express "required at delete time". #1944 part 5 is explicit
 * that *"a delete with no reason should not be possible"*, so that requirement is
 * enforced at the one write path (`softDelete()`), and the DB-level guarantee that
 * matches it lives on `record_deletions.delete_reason`, which IS `notNull`.
 */
export function softDeleteColumns() {
  return {
    /** When this record was soft-deleted. Null on every live row; never backfilled. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * Display identity of whoever deleted it, captured at delete time. Text rather
     * than a user FK because the deleter may be an operator, a portal user or a
     * system principal, and the account of who deleted a record must survive that
     * user being removed. The resolvable id, where there is one, is on
     * `record_deletions.deleted_by_user_id`.
     */
    deletedBy: text("deleted_by"),
    /**
     * Required at delete time (#1944 part 5). This is what makes the operator review
     * queue useful rather than a stack of anonymous deletions — *"superseded by the
     * new CA policy"* and *"we don't agree with this finding"* need completely
     * different responses.
     */
    deleteReason: text("delete_reason"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-customer retention policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-customer retention policy. **Shane configures, the customer reads** (epic body,
 * point 4) — there is deliberately no customer-writable path to this table.
 *
 * A tenant with no row here runs entirely on the platform defaults above. Every
 * duration column is NULLABLE and null means "use the platform default", so a policy
 * can override one duration without restating the others, and a surface can tell an
 * override from a default without a second flag column.
 */
export const retentionPoliciesTable = pgTable("retention_policies", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The customer this policy governs. One policy per tenant. */
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),

  /** Override for tier 1 (customer-recoverable). Null → `RETENTION_DEFAULT_SOFT_DELETE_DAYS`. */
  softDeleteDays: integer("soft_delete_days"),
  /** Override for tier 2 (operator-recoverable). Null → `RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS`. */
  semiHardDeleteDays: integer("semi_hard_delete_days"),
  /**
   * Override for the post-termination window. Null →
   * `RETENTION_DEFAULT_POST_TERMINATION_YEARS`. Distinct from the two above: this is
   * a whole-dataset clock that starts at cancellation, not a per-record one.
   */
  postTerminationYears: integer("post_termination_years"),

  /**
   * Why this customer differs from the platform default. Shown to the customer
   * alongside the durations — they can see the configuration and what it does, they
   * just cannot influence it.
   */
  notes: text("notes"),

  /** Operator identity that last changed this, for the #1946 audit trail's benefit. */
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("retention_policies_tenant_uidx").on(t.tenantId),
  index("retention_policies_msp_idx").on(t.mspId),
]);

export type RetentionPolicy = typeof retentionPoliciesTable.$inferSelect;
export type InsertRetentionPolicy = typeof retentionPoliciesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// The deletion lifecycle ledger — one row per soft-deleted record, all record types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per deletion, across every record type covered by the lifecycle.
 *
 * WHY A CENTRAL LEDGER RATHER THAN MORE COLUMNS PER TABLE. Three of #1944's
 * requirements are cross-type by construction and cannot be answered from per-table
 * columns without a UNION over every covered table:
 *
 *   1. The purge sweep has to find "everything due" in one indexed scan.
 *   2. The #1571 operator queue is a single list of pending accelerations across all
 *      record types, and part 5 requires the ghost backlog be *"filterable and
 *      countable"* — *"a customer with fifteen ghosted records"* is one number.
 *   3. Part 2 requires the account of a deletion to **survive the purge of the record
 *      it describes**. A column on the record cannot outlive the record.
 *
 * The per-record `softDeleteColumns()` triple stays as the cheap read-path marker;
 * this table is the state machine. One helper writes both in one transaction.
 *
 * THIS TABLE IS EXEMPT FROM THE RETENTION POLICY IT ENFORCES (#1944 part 2 —
 * *"audit records are therefore not subject to the retention policy they enforce"*).
 * A purge sets `stage = 'purged'` and `purged_at`; it never deletes this row.
 */
export const recordDeletionsTable = pgTable("record_deletions", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /**
   * The customer whose retention policy governs this record's clock. Question A's
   * settled working answer (part 6) is that the lifecycle covers **customer-scoped
   * data records**, so a deletion always has a customer.
   *
   * `onDelete: "restrict"` and not `"cascade"`: this row is the surviving account of
   * a deletion, and it must not be destroyed as a side effect of the tenant row going
   * away. Post-termination purge (part 7) removes tenant data deliberately, through
   * the purge path, not by cascade.
   */
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "restrict" }),

  /**
   * The deleted record's identity: its registry key (conventionally its real table
   * name, e.g. `"msp_risk_decisions"`) and its primary key rendered as text.
   *
   * Text rather than integer because primary keys are not uniformly integers in this
   * schema — `msp_sop_runs` carries a text `run_id`, others are serial ints. No FK is
   * possible here by construction: this column points at a different table per row,
   * and after a purge it points at nothing at all, which is the intended end state
   * (part 2 — *"the audit references something that no longer exists — that is
   * correct and intended"*).
   */
  recordType: text("record_type").notNull(),
  recordId: text("record_id").notNull(),
  /**
   * Human label for the record as it read at delete time, so the operator queue and
   * the audit account stay readable after the record is purged and its title is gone.
   */
  recordLabel: text("record_label"),

  stage: text("stage", { enum: RETENTION_STAGES }).notNull().default("soft"),

  // ── The soft-delete triple, authoritative copy ────────────────────────────
  /** When the delete happened. Immutable; the clock columns move, this does not. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  deletedBy: text("deleted_by").notNull(),
  /** `users.id` where the deleter was a resolvable portal/platform user. */
  deletedByUserId: integer("deleted_by_user_id"),
  deletedBySide: text("deleted_by_side", { enum: RETENTION_DELETE_SIDES }).notNull().default("customer"),
  /**
   * REQUIRED — `notNull` with no default, deliberately. #1944 part 5: *"a delete with
   * no reason should not be possible"*. This is the DB-level half of that guarantee;
   * the record's own `delete_reason` column has to stay nullable because live rows
   * have no reason.
   */
  deleteReason: text("delete_reason").notNull(),

  // ── Provenance, for the hard-delete bypass gate ───────────────────────────
  /**
   * The record's own provenance value AS ITS OWN TABLE RECORDS IT, verbatim —
   * `"manual"` from `msp_sop_runs.origin`, `"baseline"` from
   * `msp_diagnostic_findings.finding_source`, `"microsoft_change"` from
   * `msp_change_requests.source_kind`, and so on.
   *
   * It is stored raw and un-normalized on purpose. #1947 asked whether #1556's
   * `origin: policy | lifecycle | remediation | manual` generalizes across record
   * types; it does not (see `origin-registry.ts` in the api-server for the evidence —
   * five record classes, five vocabularies, three column names, and
   * `config_resources.origin` already using the identical column name for an entirely
   * different axis). Flattening five real vocabularies into one shared enum here
   * would be inventing a vocabulary that maps onto nothing, which is exactly what
   * this project's standing rule forbids.
   */
  recordOrigin: text("record_origin"),
  /**
   * The ONE thing the bypass gate actually needs, resolved at delete time from the
   * raw value above by the platform origin registry: was this record created by hand,
   * or generated by a system path?
   *
   * #1944 part 1 — the hard-delete bypass exists only for a genuine mistake-create.
   * *"A record generated from a finding, a scan, a drift event, a policy evaluation
   * or any other system path is evidence, and evidence does not get a bypass
   * checkbox — the box should not render, rather than rendering and refusing."*
   *
   * Defaults to `false` (not bypass-eligible), because the safe reading of an
   * unresolvable provenance is "this might be evidence".
   */
  originManual: boolean("origin_manual").notNull().default(false),
  /**
   * True when this deletion actually took the manual-origin hard-delete bypass —
   * straight to purge, skipping both recoverable tiers. Recorded because a bypass is
   * irreversible and the account of it having been taken is the only trace left.
   */
  bypassUsed: boolean("bypass_used").notNull().default(false),

  // ── The clock. Freeze-safe by construction (#1944 part 7, #1947). ─────────
  //
  // The requirement is exact: a record's remaining time must survive a freeze of
  // unknown duration — up to seven years — and resume EXACTLY where it left off.
  //
  // So the clock is stored as a REMAINING DURATION plus the instant that duration
  // started counting down, never as `deleted_at + 90 days`. A computed target of that
  // shape is silently wrong the moment a freeze happens, and wrong in the direction
  // that destroys data early.
  //
  //   running:  remaining(now) = stageRemainingSeconds - (now - stageEnteredAt)
  //   frozen:   remaining(now) = stageRemainingSeconds                (constant)
  //
  //   freeze():  stageRemainingSeconds = remaining(now); frozenAt = now; stageDueAt = null
  //   resume():  stageEnteredAt = now; frozenAt = null; stageDueAt = now + remaining
  //
  /** When the current stage's countdown last started or resumed. */
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Seconds left in the current stage AS OF `stageEnteredAt` — the durable half of
   * the clock. This is the number a freeze preserves and a resume replays.
   */
  stageRemainingSeconds: integer("stage_remaining_seconds").notNull(),
  /**
   * The maintained boundary instant, `stageEnteredAt + stageRemainingSeconds`, kept
   * ONLY so the purge sweep is an indexed range scan rather than a full table
   * arithmetic scan.
   *
   * **NULL whenever the clock is frozen.** That is what makes this a safe derived
   * column rather than the corruptible `deleted_at + 90d` the issue warns against: a
   * freeze cannot leave a stale due date behind to fire on, because there is no due
   * date at all while frozen. It is recomputed from the remaining duration on resume,
   * never carried across the freeze.
   */
  stageDueAt: timestamp("stage_due_at", { withTimezone: true }),
  /** Non-null while the clock is frozen. */
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  /** Why it froze — today always the customer's subscription lapsing (part 7/8). */
  frozenReason: text("frozen_reason"),
  /** Cumulative frozen time, for display and for explaining a long-ghosted record. */
  totalFrozenSeconds: integer("total_frozen_seconds").notNull().default(0),
  /** How many separate freezes this record has been through. */
  freezeCount: integer("freeze_count").notNull().default(0),

  // ── Accelerated delete (#1944 parts 1, 2, 4, 5) ───────────────────────────
  accelerationState: text("acceleration_state", { enum: RETENTION_ACCELERATION_STATES }).notNull().default("none"),
  accelerationRequestedAt: timestamp("acceleration_requested_at", { withTimezone: true }),
  accelerationRequestedBy: text("acceleration_requested_by"),
  accelerationReasonKind: text("acceleration_reason_kind", { enum: RETENTION_ACCELERATION_REASONS }),
  /** The free-text half — captured alongside the kind, not instead of it. */
  accelerationReason: text("acceleration_reason"),
  /**
   * When the reason is `superseded_by`, the record that replaced this one — the same
   * shape as `recordType`/`recordId` above, and the same idea as #1508's supersession
   * chain rather than a second link concept.
   */
  supersededByRecordType: text("superseded_by_record_type"),
  supersededByRecordId: text("superseded_by_record_id"),
  accelerationDecidedAt: timestamp("acceleration_decided_at", { withTimezone: true }),
  accelerationDecidedBy: text("acceleration_decided_by"),
  accelerationDecisionNote: text("acceleration_decision_note"),

  // ── Restore (#1944 part 5) ────────────────────────────────────────────────
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  restoredBy: text("restored_by"),
  /**
   * REQUIRED at restore time (part 5), and reachable from the record itself in one
   * click — the customer gets told their record came back and can read why without
   * digging through an audit view.
   */
  restoreReason: text("restore_reason"),

  // ── Purge ─────────────────────────────────────────────────────────────────
  /** Set when the record itself was actually destroyed. This row survives it. */
  purgedAt: timestamp("purged_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /**
   * At most ONE open deletion per record. Partial, over the two live stages only:
   * a record that was restored, or one that was purged and whose id was later reused
   * by a text-keyed table, must not collide with its own historical account.
   */
  uniqueIndex("record_deletions_open_record_uidx")
    .on(t.recordType, t.recordId)
    .where(sql`stage IN ('soft', 'semi_hard')`),
  /**
   * THE SWEEP INDEX. `stage_due_at` is null while frozen, so a frozen record is
   * physically absent from this index and cannot be picked up by the sweep — the
   * freeze is enforced by the index shape, not only by the query's WHERE clause.
   */
  index("record_deletions_due_idx")
    .on(t.stageDueAt)
    .where(sql`stage IN ('soft', 'semi_hard') AND stage_due_at IS NOT NULL`),
  /** The #1571 operator review queue: pending accelerations, newest first. */
  index("record_deletions_acceleration_queue_idx")
    .on(t.mspId, t.accelerationRequestedAt.desc())
    .where(sql`acceleration_state = 'pending'`),
  /** The per-customer ghost backlog — "how many ghosted records does this tenant have". */
  index("record_deletions_tenant_stage_idx").on(t.tenantId, t.stage),
  /** "Is this specific record deleted, and what is its state" — the guard's lookup. */
  index("record_deletions_record_idx").on(t.recordType, t.recordId),
]);

export type RecordDeletion = typeof recordDeletionsTable.$inferSelect;
export type InsertRecordDeletion = typeof recordDeletionsTable.$inferInsert;

/**
 * Configuration change ATTRIBUTION and LIFECYCLE (Git #2759).
 *
 * `./config-diffs` answers "what changed between these two snapshots", property by
 * property, and seals the answer. It deliberately says nothing about WHY a change
 * happened or whether anyone is meant to act on it — a diff row is a fact about two
 * immutable inputs, and the differ has no business inventing intent.
 *
 * This file is the layer that answers the second question, and it answers it from
 * REAL RECORDED DECISIONS rather than a heuristic:
 *
 *   - `msp_change_requests` (#1486) is the platform's real record of an MSP-initiated
 *     change: approved, scheduled, executed, with a `cr_executions` row carrying the
 *     real `executed_at`. A diff row covered by one of those is an EXPECTED change.
 *   - `msp_risk_decisions` (#1487) is the real record of a deviation somebody
 *     deliberately accepted. A diff row covered by an active one is an ACCEPTED RISK,
 *     the same relationship #1279's alert suppression already honours.
 *   - Everything else is genuinely UNATTRIBUTED — configuration moved and no recorded
 *     decision explains it. That is the honest "needs review" state the old
 *     `drift_events` lifecycle was reaching for without the attribution data to back
 *     it.
 *
 * ─── Why attribution is a SIBLING table, not columns on config_diff_changes ─────
 * `config_diff_changes` is sealed: `config_diff_reject_mutation_on_sealed()` refuses
 * every UPDATE and DELETE once its diff is sealed. That is correct and must not be
 * relaxed — a diff is evidence. But a verdict is NOT immutable: a change request
 * approved an hour after the diff was computed legitimately turns an `unattributed`
 * row into an `attributed_change`, and a risk acceptance that expires legitimately
 * turns one back. So the verdict lives beside the evidence, is versioned
 * (`attribution_version`), and can be recomputed without touching the sealed row.
 *
 * ─── Why a SCOPE table sits between the two ────────────────────────────────────
 * Neither source names a configuration resource in a form a differ can join on. A
 * change request carries free-text `target_resource`, a coarse `category`, and a
 * `pack:`/`sop:`-shaped `authorized_target_key`; a risk decision carries free-text
 * `control_violated` and a `graph_endpoint` string. None of those is
 * `graph:v1.0:/identity/conditionalAccess/policies`.
 *
 * `config_change_scopes` is that bridge, and every row states the BASIS it was derived
 * from — the same discipline `config_diff_property_rules` uses for the noise ruleset,
 * for the same reason: a claim that cannot be audited will eventually be believed
 * without evidence. A scope derived by walking a CR's real config pack down to its
 * `baseline_action_templates.endpoint` and resolving that against the real resource
 * registry is a different quality of claim than a human typing one in, and the two are
 * not stored as if they were the same.
 *
 * Nothing here guesses. A change request with no derivable scope produces no scope
 * rows and therefore attributes nothing — every change under it stays `unattributed`,
 * which is the correct answer, not a gap.
 *
 * ─── Precision is recorded, so PARTIAL coverage is representable ───────────────
 * A scope may name a resource type, one object within it, or one property path on one
 * object. `config_change_attribution_matches.match_scope` records which of those
 * actually matched, so "CR-2026-101 covers this policy's `state`" and "CR-2026-101
 * covers Conditional Access generally" are never collapsed into the same claim. A diff
 * that a change request only partly explains needs no special verdict: its covered rows
 * attribute and its uncovered rows do not, and the roll-up says so.
 *
 * ─── Contested is a real state, not a tie to break ─────────────────────────────
 * A resource can be covered by BOTH an executed change request and an active accepted
 * risk at the same time. Those two say different things — "we did this on purpose" and
 * "we know this is wrong and chose to live with it" — and silently preferring one would
 * be inventing a resolution the recorded data does not contain. `contested` is
 * therefore its own verdict, both edges are kept, and the resolution is a human call.
 * (Two change requests both covering a row is NOT contested: they agree on the verdict,
 * so the most precise one wins the edge and the other is still stored as a match.)
 */

import {
  pgTable,
  serial,
  bigserial,
  bigint,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable, mspChangeRequestsTable, mspRiskDecisionsTable } from "./msp";
import { configDiffsTable, configDiffChangesTable } from "./config-diffs";

// ── Vocabularies ─────────────────────────────────────────────────────────────

/**
 * The two systems that can explain a configuration change. Both are real, populated
 * stores with their own approval model; neither is a label this file invented.
 */
export const CONFIG_CHANGE_SCOPE_SOURCES = ["change_request", "risk_decision"] as const;
export type ConfigChangeScopeSource = (typeof CONFIG_CHANGE_SCOPE_SOURCES)[number];

/**
 * How a scope row came to exist. This is the audit trail for the bridge, and it is
 * ordered here from strongest evidence to weakest:
 *
 *  - execution_record   read off `cr_executions` — the endpoint a change request
 *                       ACTUALLY wrote, with the real `executed_at` behind it. The
 *                       strongest claim available, because it describes what happened
 *                       rather than what was intended.
 *  - template_endpoint  derived by walking change_catalog_items → config_packs →
 *                       config_pack_templates → baseline_action_templates.endpoint and
 *                       resolving that endpoint against `config_snapshot_resource_types`.
 *                       Describes intent, not outcome: the CR would have written here.
 *  - graph_endpoint     resolved from `msp_risk_decisions.graph_endpoint` against the
 *                       same registry. The one structured configuration pointer a risk
 *                       decision carries.
 *  - check_key          resolved from a risk decision's `check_key` /
 *                       `additional_check_keys` via a monitor check that has a real
 *                       configuration resource behind it. Only written when that
 *                       mapping genuinely exists.
 *  - declared           stated explicitly by an operator through the API. Weakest as
 *                       evidence precisely because nothing derived it — kept separate
 *                       so a re-derivation never silently erases a human's claim, and
 *                       never silently launders one into a derived-looking fact.
 */
export const CONFIG_CHANGE_SCOPE_BASES = [
  "execution_record",
  "template_endpoint",
  "graph_endpoint",
  "check_key",
  "declared",
] as const;
export type ConfigChangeScopeBasis = (typeof CONFIG_CHANGE_SCOPE_BASES)[number];

/**
 * The verdict on ONE diff change row. Five values, and every diff change row gets
 * exactly one — including the ignored ones, so a count of verdicts always reconciles
 * against `config_diffs.changes_total`.
 *
 *  - attributed_change  a real change request covers this row. Expected.
 *  - accepted_risk      an active risk decision covers it. Known, deliberately carried.
 *  - contested          BOTH cover it, and they mean different things. See the file
 *                       header — this is a state, not a tie waiting to be broken.
 *  - unattributed       neither covers it. The honest "needs review" state.
 *  - ignored            the diff row is `is_ignored` — suppressed by a
 *                       `config_diff_property_rules` noise rule. Not a claim about
 *                       intent at all, which is exactly why it is not folded into
 *                       `unattributed`: noise and unexplained change are different
 *                       findings and must not share a count.
 */
export const CONFIG_CHANGE_VERDICTS = [
  "attributed_change",
  "accepted_risk",
  "contested",
  "unattributed",
  "ignored",
] as const;
export type ConfigChangeVerdict = (typeof CONFIG_CHANGE_VERDICTS)[number];

/**
 * How precisely a scope matched a change row. A scope that names only the resource type
 * covers every object and property under it; one that names an object covers every
 * property on that object; one that names a property path covers exactly that. The
 * precision is recorded because "this CR explains this specific setting" and "this CR
 * touched this area" are different statements and a consumer must be able to tell them
 * apart.
 */
export const CONFIG_CHANGE_MATCH_SCOPES = ["property", "object", "resource"] as const;
export type ConfigChangeMatchScope = (typeof CONFIG_CHANGE_MATCH_SCOPES)[number];

/**
 * Lifecycle of a drifted setting across successive comparisons — the same three states
 * `drift_events` used (#1290), keyed on the differ's own identity instead of the drift
 * collector's, and driven by real observed values rather than a collector's bookkeeping.
 *
 *  - open      the setting has moved off the value it held when first detected.
 *  - resolved  a later comparison observed it back AT that value.
 *  - reopened  it moved off that value again after having been resolved.
 *
 * The resolution rule is stated on `config_change_lifecycle` itself and is deliberately
 * narrow: only an observed value closes a row. Absence from a later diff never does.
 */
export const CONFIG_CHANGE_LIFECYCLE_STATUSES = ["open", "resolved", "reopened"] as const;
export type ConfigChangeLifecycleStatus = (typeof CONFIG_CHANGE_LIFECYCLE_STATUSES)[number];

// ── 1. The scope bridge ──────────────────────────────────────────────────────

/**
 * ONE ROW PER (source record, configuration scope). A change request that writes three
 * different resources has three rows; one that writes one property on one object has
 * one, at property precision.
 *
 * `tenant_id` is the INTEGER `tenants.id`, resolved once at derivation time from the
 * source record's TEXT M365 tenant id via `tenants.tenant_id`. Both `msp_change_requests`
 * and `msp_risk_decisions` key on the text GUID; `config_diffs` keys on the integer row
 * id. Doing that translation here, once, at write time, is what lets attribution be a
 * plain indexed join instead of a per-row lookup — and a source record whose tenant is
 * not onboarded as a `tenants` row simply produces no scope, rather than a scope that
 * silently attributes against the wrong tenant.
 *
 * The effective window bounds when this scope may attribute. For a change request it is
 * the real execution window (`cr_executions.executed_at`, or the scheduled window when
 * that is all that exists), widened by a tolerance the deriver states in `notes`; for a
 * risk decision it is acceptance → expiry. An unbounded side is NULL, and both being
 * NULL means "whenever" — which is only ever written for a `declared` scope, because
 * every derived source carries a real time.
 */
export const configChangeScopesTable = pgTable("config_change_scopes", {
  id: serial("id").primaryKey(),

  sourceKind: text("source_kind", { enum: CONFIG_CHANGE_SCOPE_SOURCES }).notNull(),
  /** Exactly one of these two is set — see the check constraint. */
  changeRequestId: integer("change_request_id")
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  riskDecisionId: integer("risk_decision_id")
    .references(() => mspRiskDecisionsTable.id, { onDelete: "cascade" }),

  /** Resolved integer tenant — see the table comment for why the translation happens here. */
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),

  /** Joins `config_diff_changes.resource_key` exactly. Never a pattern, never a prefix. */
  resourceKey: text("resource_key").notNull(),
  /** NULL = every object of that resource type. */
  objectIdentity: text("object_identity"),
  /**
   * NULL = every property of the covered object(s). Compared against
   * `config_diff_changes.property_path_normalized`, so a scope written from a raw
   * property path must be normalised by the deriver before it is stored.
   */
  propertyPathNormalized: text("property_path_normalized"),

  basis: text("basis", { enum: CONFIG_CHANGE_SCOPE_BASES }).notNull(),
  /**
   * The literal thing the basis was read from — a graph endpoint, a template id, a
   * check key. Kept verbatim so a wrong scope can be traced back to the record that
   * produced it rather than re-derived and re-guessed.
   */
  basisRef: text("basis_ref"),

  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),

  /** Human note from the deriver — e.g. the tolerance it applied and why. */
  notes: text("notes"),
  /** Which deriver version wrote this, so a re-derivation can find its own old rows. */
  derivedBy: text("derived_by"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /** The attribution join: tenant + resource, then narrowed in SQL. */
  index("config_change_scopes_lookup_idx").on(t.tenantId, t.resourceKey),
  index("config_change_scopes_cr_idx").on(t.changeRequestId),
  index("config_change_scopes_rbd_idx").on(t.riskDecisionId),
  index("config_change_scopes_window_idx").on(t.effectiveFrom, t.effectiveTo),
  /**
   * One scope per (source, target, basis), so a re-derivation upserts rather than
   * accumulating a duplicate every time it runs.
   *
   * The REAL index is expression-based — it wraps every nullable member in `COALESCE`,
   * because `object_identity` and `property_path_normalized` are legitimately NULL on a
   * resource-wide scope and NULLs never compare equal in a Postgres unique index, so a
   * plain column list would let every re-derivation insert another copy. Drizzle cannot
   * express that, so the authoritative definition is the `CREATE UNIQUE INDEX` in
   * `lib/db/migrations/manual/2026-09-04-config-change-attribution-2759.sql`; this
   * declaration exists so the constraint is visible from the schema and is deliberately
   * NOT the one the database runs.
   */
  uniqueIndex("config_change_scopes_natural_uidx").on(
    t.sourceKind, t.changeRequestId, t.riskDecisionId, t.resourceKey,
    t.objectIdentity, t.propertyPathNormalized, t.basis,
  ),
  /** A scope belongs to exactly one source record, and it must be the declared kind. */
  check(
    "config_change_scopes_one_source",
    sql`(source_kind = 'change_request' AND change_request_id IS NOT NULL AND risk_decision_id IS NULL)
        OR (source_kind = 'risk_decision' AND risk_decision_id IS NOT NULL AND change_request_id IS NULL)`,
  ),
  /**
   * Property precision requires object precision. "Every object's `state` property"
   * is not a claim any real source makes, and allowing it would let one CR attribute
   * a property change on an object it never touched.
   */
  check(
    "config_change_scopes_property_needs_object",
    sql`property_path_normalized IS NULL OR object_identity IS NOT NULL`,
  ),
  check(
    "config_change_scopes_window_ordered",
    sql`effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to`,
  ),
]);

export type ConfigChangeScope = typeof configChangeScopesTable.$inferSelect;
export type InsertConfigChangeScope = typeof configChangeScopesTable.$inferInsert;

// ── 2. Lifecycle across comparisons ──────────────────────────────────────────

/**
 * ONE ROW PER (tenant, resource, object, property) that has ever been observed to move —
 * the open / resolved / reopened question, answered from real observed values.
 *
 * ─── The resolution rule, and what it deliberately refuses to infer ────────────
 * A row opens with `baseline_value` set to the `old_value` of the change that first
 * detected it: the value this setting held before anything moved it. It resolves ONLY
 * when a later diff emits a change on the same key whose `new_value` equals that
 * baseline — the setting was observed back where it started. It reopens when a resolved
 * row is moved off that baseline again.
 *
 * ABSENCE FROM A LATER DIFF IS NOT RESOLUTION, and this is the single most important
 * rule in this table. A `drift` diff compares snapshot N-1 with snapshot N; a setting
 * that moved between snapshot 1 and 2 and then sat still emits NO row in the 2→3 diff,
 * because nothing changed between those two — it is still drifted. Closing on absence
 * would mark every unfixed drift resolved on the very next scan, and would do it
 * silently. The same distinction `config_diff_resource_status` draws between absence and
 * unreadability applies here between absence and return.
 *
 * `baseline_value` is therefore never overwritten while a row is open; only a real
 * resolve-then-reopen cycle rebases it, and the reopen keeps the original so the round
 * trip stays visible.
 */
export const configChangeLifecycleTable = pgTable("config_change_lifecycle", {
  id: serial("id").primaryKey(),

  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),
  objectIdentity: text("object_identity").notNull(),
  /**
   * The normalised property path, or the empty string for object-level change kinds
   * (`object_added` / `object_removed` / …), which have no property path at all.
   * Empty string rather than NULL because this participates in the unique key and
   * NULLs do not compare equal in a Postgres unique index — two object-level rows for
   * the same object would both insert.
   */
  propertyPathNormalized: text("property_path_normalized").notNull(),

  status: text("status", { enum: CONFIG_CHANGE_LIFECYCLE_STATUSES }).notNull().default("open"),

  /** The value held before this setting first moved. The target a resolution must match. */
  baselineValue: jsonb("baseline_value").$type<unknown>(),
  /** Whether a baseline value was genuinely observed — `null` is a real JSON value. */
  baselineValuePresent: text("baseline_value_present").notNull().default("false"),
  /** The most recently observed value for this key. */
  currentValue: jsonb("current_value").$type<unknown>(),
  currentValuePresent: text("current_value_present").notNull().default("false"),

  /** The change row that opened this lifecycle, and the most recent one to touch it. */
  firstChangeId: bigint("first_change_id", { mode: "number" })
    .references(() => configDiffChangesTable.id, { onDelete: "set null" }),
  lastChangeId: bigint("last_change_id", { mode: "number" })
    .references(() => configDiffChangesTable.id, { onDelete: "set null" }),
  lastDiffRowId: integer("last_diff_row_id").references(() => configDiffsTable.id, { onDelete: "set null" }),

  firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().defaultNow(),
  lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().defaultNow(),
  /** When it was last observed back at baseline. NULL while open/reopened. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** When it last moved off baseline again after a resolution. NULL if never reopened. */
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenCount: integer("reopen_count").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_change_lifecycle_key_uidx")
    .on(t.tenantId, t.resourceKey, t.objectIdentity, t.propertyPathNormalized),
  index("config_change_lifecycle_tenant_status_idx").on(t.tenantId, t.status, t.lastDetectedAt),
  index("config_change_lifecycle_reopened_idx").on(t.tenantId, t.reopenedAt),
  check("config_change_lifecycle_reopen_count_nonneg", sql`reopen_count >= 0`),
  /** The timestamps must agree with the status they claim. */
  check(
    "config_change_lifecycle_status_timestamps",
    sql`(status = 'resolved' AND resolved_at IS NOT NULL)
        OR (status = 'reopened' AND reopened_at IS NOT NULL AND reopen_count >= 1)
        OR (status = 'open')`,
  ),
]);

export type ConfigChangeLifecycle = typeof configChangeLifecycleTable.$inferSelect;
export type InsertConfigChangeLifecycle = typeof configChangeLifecycleTable.$inferInsert;

// ── 3. The verdict of record ─────────────────────────────────────────────────

/**
 * ONE ROW PER `config_diff_changes` ROW, always — including the rows that attribute to
 * nothing. An attribution pass that only wrote the rows it could explain would make
 * "not yet attributed" and "attributed to nothing" indistinguishable, which is the
 * whole failure the old `drift_events` verdict had.
 *
 * `bigserial` and a `bigint` FK for the same reason `config_diff_changes` uses one: a
 * single sealed diff of a real tenant carried 340 change rows and the store is expected
 * to hold many diffs per tenant.
 */
export const configChangeAttributionsTable = pgTable("config_change_attributions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  changeId: bigint("change_id", { mode: "number" }).notNull()
    .references(() => configDiffChangesTable.id, { onDelete: "cascade" }),
  /**
   * Denormalised from the change row. A verdict roll-up for one diff is the single most
   * common read in this subsystem, and doing it without a join to 340 change rows is
   * worth one integer. Safe because a change row's diff cannot move.
   */
  diffRowId: integer("diff_row_id").notNull().references(() => configDiffsTable.id, { onDelete: "cascade" }),
  /** The HEAD tenant of the diff — the tenant whose configuration this row is about. */
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),

  verdict: text("verdict", { enum: CONFIG_CHANGE_VERDICTS }).notNull(),

  /**
   * The winning edge. Both may be set at once, and that is exactly the `contested`
   * case — the two are kept rather than one being dropped, so the human resolving it
   * can see both records without a second query.
   *
   * `set null` on both: an attribution is real history about what was known when it was
   * computed, and it must survive a pruned change request the same way `drift_events`
   * survives one.
   */
  changeRequestId: integer("change_request_id")
    .references(() => mspChangeRequestsTable.id, { onDelete: "set null" }),
  /** Display code (`CR-2026-101`), kept alongside the FK so a pruned CR still reads. */
  crRef: text("cr_ref"),
  riskDecisionId: integer("risk_decision_id")
    .references(() => mspRiskDecisionsTable.id, { onDelete: "set null" }),
  /** `msp_risk_decisions.rbd_id` (`RBD-2026-575`), same reasoning as `cr_ref`. */
  rbdRef: text("rbd_ref"),

  /** How precisely the winning scope matched. NULL when nothing matched. */
  matchScope: text("match_scope", { enum: CONFIG_CHANGE_MATCH_SCOPES }),
  /** The scope row that won, for a one-hop trace from verdict back to its basis. */
  scopeId: integer("scope_id").references(() => configChangeScopesTable.id, { onDelete: "set null" }),
  /** How many scopes matched in total, winner included. > 1 means the row is worth auditing. */
  matchCount: integer("match_count").notNull().default(0),

  /**
   * The lifecycle row this change belongs to. NULL only for change kinds that have no
   * stable per-property identity to track across diffs (object-level kinds without a
   * property path still get one; see `config_change_lifecycle`).
   */
  lifecycleId: integer("lifecycle_id").references(() => configChangeLifecycleTable.id, { onDelete: "set null" }),

  /**
   * Which pass wrote this. A verdict is recomputable and its inputs move, so a row that
   * cannot say which logic produced it cannot be re-judged — the same reason
   * `config_diffs` carries `differ_version`.
   */
  attributionVersion: text("attribution_version").notNull(),
  attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /** One verdict per change row. Re-running the pass updates in place. */
  uniqueIndex("config_change_attributions_change_uidx").on(t.changeId),
  /** The roll-up read: verdict counts for one diff. */
  index("config_change_attributions_diff_verdict_idx").on(t.diffRowId, t.verdict),
  /** "What is unexplained on this tenant right now" — the operator read. */
  index("config_change_attributions_tenant_verdict_idx").on(t.tenantId, t.verdict, t.attributedAt),
  index("config_change_attributions_cr_idx").on(t.changeRequestId),
  index("config_change_attributions_rbd_idx").on(t.riskDecisionId),
  index("config_change_attributions_lifecycle_idx").on(t.lifecycleId),
  /**
   * The verdict and its edges must agree. A row claiming `attributed_change` with no
   * change request is not a weaker claim, it is an unfalsifiable one.
   */
  check(
    "config_change_attributions_verdict_edges",
    sql`(verdict = 'attributed_change' AND change_request_id IS NOT NULL AND risk_decision_id IS NULL)
        OR (verdict = 'accepted_risk' AND risk_decision_id IS NOT NULL AND change_request_id IS NULL)
        OR (verdict = 'contested' AND change_request_id IS NOT NULL AND risk_decision_id IS NOT NULL)
        OR (verdict IN ('unattributed', 'ignored') AND change_request_id IS NULL AND risk_decision_id IS NULL)`,
  ),
  /** A verdict that names an edge must also say how precisely it matched. */
  check(
    "config_change_attributions_scope_matches_verdict",
    sql`(verdict IN ('unattributed', 'ignored') AND match_scope IS NULL)
        OR (verdict IN ('attributed_change', 'accepted_risk', 'contested') AND match_scope IS NOT NULL)`,
  ),
  check("config_change_attributions_match_count_nonneg", sql`match_count >= 0`),
]);

export type ConfigChangeAttribution = typeof configChangeAttributionsTable.$inferSelect;
export type InsertConfigChangeAttribution = typeof configChangeAttributionsTable.$inferInsert;

// ── 4. Every match, not just the winner ──────────────────────────────────────

/**
 * ONE ROW PER (attribution, scope that matched). The winner is `rank = 1`.
 *
 * This is what makes a contested or over-covered row auditable instead of merely
 * flagged. "Two change requests and an accepted risk all claim this property" is a real
 * operational situation, and the answer to it is the list — not a single winner with
 * the rest discarded and a boolean saying something was discarded.
 */
export const configChangeAttributionMatchesTable = pgTable("config_change_attribution_matches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  attributionId: bigint("attribution_id", { mode: "number" }).notNull()
    .references(() => configChangeAttributionsTable.id, { onDelete: "cascade" }),
  scopeId: integer("scope_id").notNull()
    .references(() => configChangeScopesTable.id, { onDelete: "cascade" }),

  sourceKind: text("source_kind", { enum: CONFIG_CHANGE_SCOPE_SOURCES }).notNull(),
  changeRequestId: integer("change_request_id")
    .references(() => mspChangeRequestsTable.id, { onDelete: "set null" }),
  riskDecisionId: integer("risk_decision_id")
    .references(() => mspRiskDecisionsTable.id, { onDelete: "set null" }),

  matchScope: text("match_scope", { enum: CONFIG_CHANGE_MATCH_SCOPES }).notNull(),
  /**
   * 1 = the edge the verdict carries. Ranking is precision first (property beats object
   * beats resource), then the narrower effective window, then the more recent source —
   * a total order, so the winner is reproducible rather than whatever the planner
   * returned first.
   */
  rank: integer("rank").notNull(),
  /** Why this one ranked where it did, in plain words, for the audit trail. */
  reason: text("reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_change_attribution_matches_uidx").on(t.attributionId, t.scopeId),
  index("config_change_attribution_matches_attribution_idx").on(t.attributionId, t.rank),
  check("config_change_attribution_matches_rank_positive", sql`rank >= 1`),
]);

export type ConfigChangeAttributionMatch = typeof configChangeAttributionMatchesTable.$inferSelect;
export type InsertConfigChangeAttributionMatch = typeof configChangeAttributionMatchesTable.$inferInsert;

/**
 * Tenant configuration DIFF store (Git #1797).
 *
 * `./config-state` is the MODEL (what a configuration resource *is*).
 * `./config-snapshots` is the STORE (what one tenant's configuration *was*, at an
 * instant, verbatim off the wire). This file is the DIFFERENCE between two of those
 * snapshots — computed once, stored, and never recomputed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four constraints decide every choice below. They are not style preferences.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. ABSENCE, UNREADABILITY AND DELETION ARE THREE DIFFERENT THINGS.
 *
 *    This is the single most important correctness rule in #1797. A resource that
 *    could not be read in one snapshot is NOT a deletion, and reporting it as one
 *    ("your Conditional Access policy was deleted") destroys trust in every other
 *    answer the feature gives.
 *
 *    The store already made this expressible: `tenant_config_snapshot_resource_status`
 *    carries one row per targeted resource per snapshot, with `collected` / `empty` /
 *    `partial` / `skipped` / `failed` and a mandatory reason for the last three. This
 *    file consumes that honestly, in `config_diff_resource_status.comparability`:
 *
 *      comparable            both sides read successfully (`collected` or `empty`).
 *                            An object present on one side only is a REAL add or
 *                            remove, and is reported as one.
 *      partially_comparable  at least one side is `partial` — the read succeeded but
 *                            the SET is known incomplete. Objects present on BOTH
 *                            sides are still compared property-by-property, because
 *                            that comparison rests on real data. Objects present on
 *                            one side only are `object_indeterminate` — never an add,
 *                            never a remove.
 *      not_comparable        at least one side is `skipped`, `failed`, or was never
 *                            targeted at all. NO change rows are emitted for the
 *                            resource, at any level. The row itself, carrying both
 *                            sides' real status and reason, IS the output.
 *
 *    Both sides' `status`, `skip_reason` and `reason_detail` are copied onto the diff
 *    row, so the verdict can be audited without re-reading two snapshots that may by
 *    then have aged out of retention.
 *
 * 2. PROPERTY-LEVEL, NOT OBJECT-LEVEL.
 *
 *    "This policy changed" is not a product. "`state` went from `enabledForReporting‑
 *    OnlyAsSecurityDefaults` to `enabled`" is. Every row in `config_diff_changes` names
 *    one property path and carries its two values.
 *
 *    This is the concrete improvement over the existing `detectDrift`
 *    (`pcc/drift-detector.ts`), which the drift collector uses today: that primitive
 *    compares arrays POSITIONALLY and, on any length change, emits a single `replace`
 *    of the whole array with no property detail at all. A reordered policy list — which
 *    Graph does not promise to order — reads there as a total rewrite.
 *
 * 3. STABLE AND ORDERED. The same pair, under the same ruleset, always produces the
 *    same rows in the same order.
 *
 *    `config_diff_changes.sequence` is assigned from a total sort over
 *    (`resource_key`, `object_identity`, `property_path`, `change_kind`), so a diff is
 *    reproducible and two runs can be compared row for row. Scalar arrays are compared
 *    as MULTISETS rather than positionally, so member order — which no Graph collection
 *    guarantees — cannot manufacture churn; a pure reorder is reported once, as its own
 *    `array_reordered` kind, rather than as N false value changes.
 *
 * 4. NOISE CONTROL IS DATA, NOT A HARDCODED LIST.
 *
 *    `config_diff_property_rules` holds the rules. Each row states its BASIS, and
 *    `observed_volatile` rows carry the real measurement that produced them — the two
 *    snapshots compared and how many objects the path moved in — so a rule can be
 *    audited and withdrawn rather than believed.
 *
 *    An ignored change is STORED, with `is_ignored = true` and the rule that ignored
 *    it. Nothing is dropped. `changes_significant` and `changes_ignored` on the header
 *    are therefore both honest, and a rule that turns out to be wrong can be re-judged
 *    against rows that still exist.
 *
 * IMMUTABILITY. A diff between two SEALED snapshots is a fact about two immutable
 * inputs, so it is itself immutable and is sealed the same way (triggers live in
 * `lib/db/migrations/manual/2026-08-30-config-diff-store-1797.sql`, since Drizzle
 * cannot express them). Because the result also depends on the ruleset, the header
 * records `ruleset_fingerprint`; the uniqueness key is (base, head, mode, fingerprint),
 * so changing the rules produces a NEW diff rather than silently rewriting an old one.
 *
 * NO APPLY PATH. This file computes and stores differences. It never applies them.
 * Applying configuration is the Config Pack write path with its consent gates,
 * break-glass gate and approval steps; joining the two is a separate decision and is
 * explicitly out of scope for #1797.
 *
 * The existing drift tables (`drift_baseline_snapshots`, `drift_events`,
 * `drift_collection_status`) are NOT touched, replaced or deprecated here. They have a
 * live consumer (`artifacts/portal/src/components/useHltDriftLive.ts`). Retirement is
 * its own issue, with evidence.
 *
 * Timezone convention: all timestamps UTC (withTimezone: true), localized at display.
 */

import {
  pgTable,
  serial,
  bigserial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantsTable } from "./msp";
import {
  tenantConfigSnapshotsTable,
  SNAPSHOT_RESOURCE_STATUSES,
  SNAPSHOT_SKIP_REASONS,
  SNAPSHOT_IDENTITY_STRATEGIES,
} from "./config-snapshots";

// ── Vocabularies ─────────────────────────────────────────────────────────────
// Real enums only. Every value below names a state the differ actually produces.
// None of them is a display vocabulary.

/**
 * The four capabilities #1797 identifies as ONE engine over different input pairs.
 * The mode is not a behaviour switch on the comparison itself — the comparison is
 * identical in all four — it is a statement of what the pair MEANS, which is what a
 * consumer needs to interpret the result and is what makes the pairing validatable.
 *
 *  - drift                  tenant now vs that same tenant's earlier/approved snapshot.
 *                           Both sides MUST be the same tenant; a "drift" between two
 *                           tenants is a category error, and the check below rejects it.
 *  - baseline_assessment    tenant now vs a known-good configuration. The known-good may
 *                           be an earlier snapshot of the same tenant or a snapshot of a
 *                           reference tenant, so neither same-tenant nor cross-tenant is
 *                           required.
 *  - tenant_compare         tenant A vs tenant B. MUST be different tenants.
 *  - promotion              a source environment vs a target environment, for
 *                           Dev→Test→Prod. MUST be different tenants. Computing the
 *                           difference ONLY — this store has no apply path and #1797
 *                           forbids adding one here.
 */
export const CONFIG_DIFF_MODES = [
  "drift",
  "baseline_assessment",
  "tenant_compare",
  "promotion",
] as const;
export type ConfigDiffMode = typeof CONFIG_DIFF_MODES[number];

/**
 * Lifecycle of a diff header.
 *
 *  - computing  the differ is walking the pair. Rows are being written and the result
 *               is not yet readable as a whole.
 *  - sealed     finished. Immutable, and the database triggers enforce it. As with a
 *               snapshot, `sealed` says nothing about COMPLETENESS — `is_complete`
 *               answers that separately and honestly.
 *  - failed     the run aborted. Sealed anyway and KEPT, because a failed comparison is
 *               evidence; discarding it would leave a hole indistinguishable from a
 *               comparison nobody ever ran.
 */
export const CONFIG_DIFF_STATUSES = ["computing", "sealed", "failed"] as const;
export type ConfigDiffStatus = typeof CONFIG_DIFF_STATUSES[number];

/**
 * How a diff run was initiated. Mirrors `SNAPSHOT_TRIGGERS` deliberately: the same four
 * ways a run can actually start in this platform, and no list of business reasons that
 * nothing emits.
 */
export const CONFIG_DIFF_TRIGGERS = ["manual", "scheduled", "workflow", "api"] as const;
export type ConfigDiffTrigger = typeof CONFIG_DIFF_TRIGGERS[number];

/**
 * Whether a resource's two sides can be compared at all — constraint 1, made into a
 * column. See the file header for the full reasoning; in short:
 *
 *  - comparable            both sides `collected` or `empty`. Absence means absence.
 *  - partially_comparable  a side is `partial`. Paired objects compare normally;
 *                          unpaired ones are `object_indeterminate`, never add/remove.
 *  - not_comparable        a side is `skipped`, `failed`, or absent. No change rows at
 *                          all — the status row is the whole honest answer.
 */
export const CONFIG_DIFF_COMPARABILITY = [
  "comparable",
  "partially_comparable",
  "not_comparable",
] as const;
export type ConfigDiffComparability = typeof CONFIG_DIFF_COMPARABILITY[number];

/**
 * What a single change row asserts. Ten values; every one is something the differ can
 * actually emit, and the last three exist precisely to avoid overstating a finding.
 *
 *  - property_changed       the property exists on BOTH sides with different values.
 *                           The core product.
 *  - property_added         present in head, absent in base, on a PAIRED object.
 *  - property_removed       present in base, absent in head, on a PAIRED object. Note
 *                           this is a property disappearing from an object that was
 *                           read successfully on both sides — not an unread resource.
 *  - array_member_added     a scalar array gained a member. Named rather than folded
 *                           into `property_changed` so the answer is "`includeUsers`
 *                           gained `<guid>`", not "the whole list changed".
 *  - array_member_removed   a scalar array lost a member.
 *  - array_reordered        a scalar array's MEMBERS are identical as a multiset but
 *                           their order differs. Reported, because for an ordered
 *                           collection (transport rule priority) it could matter — and
 *                           reported SEPARATELY, because for the many collections Graph
 *                           does not order it is pure noise. A default rule ships this
 *                           as ignorable; the rule is data and can be withdrawn.
 *  - object_added           an object identity present in head only, resource comparable.
 *  - object_removed         an object identity present in base only, resource comparable.
 *                           This is the ONLY row that ever means "this was deleted", and
 *                           it is reachable only when both sides read successfully.
 *  - object_indeterminate   present on one side only, but the resource is
 *                           `partially_comparable`, so the absence is UNKNOWN. Not an
 *                           add, not a remove.
 *  - object_unpairable      present on one side only, and the object's identity is
 *                           `content-hash` — so a modification is indistinguishable from
 *                           a delete-plus-add. `config-snapshots` documents this exact
 *                           limitation; this value carries it into the diff instead of
 *                           silently reporting a confident add/remove pair.
 */
export const CONFIG_DIFF_CHANGE_KINDS = [
  "property_changed",
  "property_added",
  "property_removed",
  "array_member_added",
  "array_member_removed",
  "array_reordered",
  "object_added",
  "object_removed",
  "object_indeterminate",
  "object_unpairable",
] as const;
export type ConfigDiffChangeKind = typeof CONFIG_DIFF_CHANGE_KINDS[number];

/** Change kinds that assert something about a single property inside a paired object. */
export const PROPERTY_LEVEL_CHANGE_KINDS: readonly ConfigDiffChangeKind[] = [
  "property_changed",
  "property_added",
  "property_removed",
  "array_member_added",
  "array_member_removed",
  "array_reordered",
] as const;

/** Change kinds that assert something about an object's presence rather than its content. */
export const OBJECT_LEVEL_CHANGE_KINDS: readonly ConfigDiffChangeKind[] = [
  "object_added",
  "object_removed",
  "object_indeterminate",
  "object_unpairable",
] as const;

/**
 * What a noise rule does to a matching change.
 *
 *  - ignore         the change is stored with `is_ignored = true` and excluded from the
 *                   significant count. It is NOT deleted — see constraint 4.
 *  - always_report  an explicit rescue. A narrow `always_report` beats a broad `ignore`,
 *                   so one genuinely meaningful property can be kept visible under a
 *                   wildcard that suppresses its neighbours. Without this, the only way
 *                   to un-ignore one path would be to abandon the broad rule.
 */
export const CONFIG_DIFF_RULE_ACTIONS = ["ignore", "always_report"] as const;
export type ConfigDiffRuleAction = typeof CONFIG_DIFF_RULE_ACTIONS[number];

/**
 * WHY a rule exists. The whole point of constraint 4 — a suppression whose grounds are
 * not recorded is indistinguishable from hiding a real finding.
 *
 *  - observed_volatile       MEASURED. The path differed between two snapshots of the
 *                            same tenant with no intervening configuration change, so it
 *                            moves on read. `evidence_*` columns carry the actual
 *                            measurement: which pair, and how many objects it moved in.
 *  - structural_annotation   the path is transport bookkeeping rather than tenant
 *                            configuration — `@odata.context`, `@odata.etag`,
 *                            `@odata.nextLink` and their kin. Structural, so a pattern
 *                            over the name is legitimate where a guess about semantics
 *                            would not be.
 *  - operator_declared       a human decided it. Requires `declared_by_user_id` and a
 *                            `rationale`, so the decision has an owner.
 */
export const CONFIG_DIFF_RULE_BASIS = [
  "observed_volatile",
  "structural_annotation",
  "operator_declared",
] as const;
export type ConfigDiffRuleBasis = typeof CONFIG_DIFF_RULE_BASIS[number];

// ── 1. The noise ruleset ─────────────────────────────────────────────────────

/**
 * Rules that classify a property path as ignorable. DATA, deliberately — #1797 requires
 * noise control "driven by data rather than a hardcoded list", and this table is that
 * requirement's whole implementation. The differ reads it; it contains no property names
 * of its own.
 *
 * MATCHING. `property_path_pattern` is matched against a change's
 * `property_path_normalized` — the path with every array subscript collapsed to `[]`, so
 * a rule is written once and holds for every member. Three forms, and no others, because
 * a richer pattern language would be a guess about paths nobody has seen:
 *
 *   exact       `conditions.users.includeUsers`   matches that path only
 *   prefix      `conditions.users.*`              matches that path and everything under it
 *   suffix      `*@odata.etag`                    matches any path ending that way
 *
 * SPECIFICITY, so precedence is deterministic rather than insertion-ordered: exact (300)
 * beats prefix/suffix (200 + pattern length), and a rule naming a `resource_key` beats
 * the same pattern at `*` (+1000). At equal specificity `always_report` wins, because a
 * deliberate rescue should never lose a coin toss to a suppression. `specificity` is
 * computed and stored by the writer so the ordering is visible in the data rather than
 * hidden in a comparator.
 *
 * A rule is soft-disabled by `is_active = false` rather than deleted, so a diff computed
 * under it stays explicable.
 */
export const configDiffPropertyRulesTable = pgTable("config_diff_property_rules", {
  id: serial("id").primaryKey(),

  /**
   * The resource this rule applies to, or `*` for every resource. Text rather than an
   * FK for the same reason the store uses text `resource_key` throughout: the derived
   * model is rebuilt wholesale with new primary keys, and a rule must outlive that.
   */
  resourceKey: text("resource_key").notNull().default("*"),

  /** See the table comment for the three supported forms. */
  propertyPathPattern: text("property_path_pattern").notNull(),

  action: text("action", { enum: CONFIG_DIFF_RULE_ACTIONS }).notNull(),
  basis: text("basis", { enum: CONFIG_DIFF_RULE_BASIS }).notNull(),

  /** Precomputed precedence — see the table comment. Higher wins. */
  specificity: integer("specificity").notNull().default(0),

  /** Why, in a sentence. Required for `operator_declared`; enforced by a CHECK below. */
  rationale: text("rationale"),
  /**
   * No FK: `usersTable` lives in `./index`, which re-exports this file, so a reference
   * here would be circular. `tenant_config_snapshots.requested_by_user_id` makes the
   * same choice for the same reason.
   */
  declaredByUserId: integer("declared_by_user_id"),

  // ── Evidence, for `observed_volatile` rules ────────────────────────────────
  /** The diff whose measurement produced this rule. Real, not asserted. */
  evidenceDiffId: integer("evidence_diff_id"),
  /** How many distinct objects this path moved in, in that measurement. */
  evidenceObjectCount: integer("evidence_object_count"),
  /** When the measurement was taken. A volatility claim ages. */
  evidenceObservedAt: timestamp("evidence_observed_at", { withTimezone: true }),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_diff_property_rules_uidx").on(t.resourceKey, t.propertyPathPattern, t.action),
  /** The differ's own read: every active rule, in precedence order. */
  index("config_diff_property_rules_active_idx").on(t.isActive, t.specificity),
  index("config_diff_property_rules_resource_idx").on(t.resourceKey),

  /**
   * An operator suppression without a stated owner and reason is exactly the thing
   * constraint 4 exists to prevent, so it cannot be written at all.
   */
  check(
    "config_diff_property_rules_operator_needs_rationale",
    sql`basis <> 'operator_declared' OR (rationale IS NOT NULL AND declared_by_user_id IS NOT NULL)`,
  ),
  /**
   * `observed_volatile` means MEASURED. A rule claiming measurement must carry the
   * measurement.
   */
  check(
    "config_diff_property_rules_observed_needs_evidence",
    sql`basis <> 'observed_volatile'
        OR (evidence_diff_id IS NOT NULL AND evidence_object_count IS NOT NULL
            AND evidence_observed_at IS NOT NULL)`,
  ),
]);

export type ConfigDiffPropertyRule = typeof configDiffPropertyRulesTable.$inferSelect;
export type InsertConfigDiffPropertyRule = typeof configDiffPropertyRulesTable.$inferInsert;

// ── 2. The diff header ───────────────────────────────────────────────────────

/**
 * One row per computed comparison of two snapshots.
 *
 * `ruleset_fingerprint` is what makes storing the result sound. A diff is a function of
 * (base, head, ruleset); the two snapshots are immutable but the ruleset is not, so
 * caching on the pair alone would serve a stale answer after a rule changed. The
 * uniqueness key includes the fingerprint, so a rule change yields a NEW diff row beside
 * the old one and both stay explicable.
 *
 * `is_complete` is the honest-completeness flag, and it is about the INPUTS: false as
 * soon as any resource landed on `partially_comparable` or `not_comparable`. A diff over
 * a snapshot pair where 778 resources failed to collect is a real, useful answer about
 * the 93 that did — but it is not a statement about the whole tenant, and this column
 * stops it being read as one.
 */
export const configDiffsTable = pgTable("config_diffs", {
  id: serial("id").primaryKey(),
  /** Stable external identifier, safe to hand to a consumer. */
  diffId: uuid("diff_id").notNull().defaultRandom(),

  mode: text("mode", { enum: CONFIG_DIFF_MODES }).notNull(),

  /**
   * The two inputs. `base` is the reference side (baseline, known-good, source
   * environment, tenant A); `head` is the subject side (now, tenant B, target
   * environment). Every change row reads "from base to head".
   *
   * Cascade on delete: a diff whose inputs have aged out of retention cannot be
   * re-derived or audited, so keeping it would be keeping an unfalsifiable claim.
   */
  baseSnapshotRowId: integer("base_snapshot_row_id").notNull()
    .references(() => tenantConfigSnapshotsTable.id, { onDelete: "cascade" }),
  headSnapshotRowId: integer("head_snapshot_row_id").notNull()
    .references(() => tenantConfigSnapshotsTable.id, { onDelete: "cascade" }),

  /** Denormalised from the headers. Safe because a sealed snapshot's tenant cannot change. */
  baseTenantId: integer("base_tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  headTenantId: integer("head_tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),

  /** SHA-256 over the active ruleset. See the table comment for why it is part of identity. */
  rulesetFingerprint: text("ruleset_fingerprint").notNull(),
  /** How many active rules that fingerprint covered — a cheap tripwire on an empty ruleset. */
  rulesetSize: integer("ruleset_size").notNull().default(0),

  /**
   * Fingerprint of the `resourceKeys` scope this diff was computed over (Git #2032).
   * `'*'` means every resource either side targeted (`resourceKeys` omitted); any other
   * value is a SHA-256 over the sorted, deduplicated scope. Part of identity for the same
   * reason `rulesetFingerprint` is: a diff scoped to a handful of resource keys is a
   * DIFFERENT computed answer than the same pair's full-tenant diff, even though both
   * share the same (base, head, mode, ruleset). Before this column existed, both shared
   * the same cache row, so a scoped recompute silently overwrote full-tenant evidence
   * with a fragment of it — see `fingerprintResourceKeys` in `config-snapshot-differ.ts`.
   *
   * NOT NULL, with a `'*'` sentinel rather than NULL for "unscoped": a unique index does
   * not treat two NULLs as equal, so a nullable column here would stop deduplicating the
   * common full-tenant case — the exact regression this column exists to close.
   */
  resourceKeysFingerprint: text("resource_keys_fingerprint").notNull().default("*"),

  differVersion: text("differ_version").notNull(),
  status: text("status", { enum: CONFIG_DIFF_STATUSES }).notNull().default("computing"),
  sealedAt: timestamp("sealed_at", { withTimezone: true }),

  // ── Resource-level roll-up: the completeness story ─────────────────────────
  resourceTypesCompared: integer("resource_types_compared").notNull().default(0),
  resourceTypesPartial: integer("resource_types_partial").notNull().default(0),
  resourceTypesNotComparable: integer("resource_types_not_comparable").notNull().default(0),

  // ── Object-level roll-up ──────────────────────────────────────────────────
  objectsPaired: integer("objects_paired").notNull().default(0),
  objectsAdded: integer("objects_added").notNull().default(0),
  objectsRemoved: integer("objects_removed").notNull().default(0),
  objectsIndeterminate: integer("objects_indeterminate").notNull().default(0),
  objectsUnpairable: integer("objects_unpairable").notNull().default(0),

  // ── Change-level roll-up ──────────────────────────────────────────────────
  changesTotal: integer("changes_total").notNull().default(0),
  /** Changes NOT suppressed by a rule. The number a human is meant to look at. */
  changesSignificant: integer("changes_significant").notNull().default(0),
  /** Changes suppressed by a rule. Stored, counted, never silently dropped. */
  changesIgnored: integer("changes_ignored").notNull().default(0),

  /**
   * False as soon as any resource was `partially_comparable` or `not_comparable`.
   * See the table comment — this is about the completeness of the INPUTS.
   */
  isComplete: boolean("is_complete").notNull().default(false),

  trigger: text("trigger", { enum: CONFIG_DIFF_TRIGGERS }).notNull().default("manual"),
  /** Free text for the business reason, for the same reason the store uses it: no enum member nothing emits. */
  triggerRef: text("trigger_ref"),
  wfRunId: integer("wf_run_id"),
  /** No FK — see `config_diff_property_rules.declared_by_user_id` for why. */
  requestedByUserId: integer("requested_by_user_id"),

  error: text("error"),
  notes: text("notes"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_diffs_diff_id_uidx").on(t.diffId),
  /**
   * The cache key. A repeat request for the same pair, mode and ruleset finds the
   * stored answer instead of walking 50,000 objects again.
   */
  uniqueIndex("config_diffs_pair_uidx")
    .on(t.baseSnapshotRowId, t.headSnapshotRowId, t.mode, t.rulesetFingerprint,
      t.resourceKeysFingerprint),
  /** "What has been compared for this tenant lately" — the operator read. */
  index("config_diffs_head_tenant_idx").on(t.headTenantId, t.mode, t.createdAt),
  index("config_diffs_status_idx").on(t.status),

  /**
   * A snapshot cannot be diffed against itself: the answer is trivially "no changes"
   * and storing it would put a meaningless row in the cache that a caller could mistake
   * for a real all-clear.
   */
  check("config_diffs_distinct_sides", sql`base_snapshot_row_id <> head_snapshot_row_id`),
  /**
   * Mode/tenant coherence — see `CONFIG_DIFF_MODES`. `drift` between two tenants and a
   * `tenant_compare` of a tenant with itself are both category errors, and neither can
   * be written.
   */
  check(
    "config_diffs_mode_tenant_coherence",
    sql`(mode = 'drift' AND base_tenant_id = head_tenant_id)
        OR (mode IN ('tenant_compare', 'promotion') AND base_tenant_id <> head_tenant_id)
        OR mode = 'baseline_assessment'`,
  ),
  /** The counts must add up. A roll-up that disagrees with its own rows is not evidence. */
  check(
    "config_diffs_change_counts_add_up",
    sql`changes_total = changes_significant + changes_ignored`,
  ),
]);

export type ConfigDiff = typeof configDiffsTable.$inferSelect;
export type InsertConfigDiff = typeof configDiffsTable.$inferInsert;

// ── 3. Per-resource comparability — constraint 1, as a table ────────────────

/**
 * ONE ROW PER RESOURCE KEY seen on either side, ALWAYS — including for every resource
 * that could not be compared. This table is what lets a diff state its own completeness
 * rather than imply it by what happens to be present, exactly as
 * `tenant_config_snapshot_resource_status` does for a snapshot.
 *
 * Read it as: "for this pair, here is every resource we tried to compare, whether the
 * comparison was possible, and — where it was not — what each side actually said."
 *
 * The `base_*` / `head_*` columns are copied verbatim from the two snapshots' status
 * rows and are NULL only when that side never targeted the resource at all, which is
 * itself a distinct and visible fact from having targeted and failed it.
 */
export const configDiffResourceStatusTable = pgTable("config_diff_resource_status", {
  id: serial("id").primaryKey(),

  diffRowId: integer("diff_row_id").notNull()
    .references(() => configDiffsTable.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),

  comparability: text("comparability", { enum: CONFIG_DIFF_COMPARABILITY }).notNull(),
  /**
   * REQUIRED for `partially_comparable` and `not_comparable`; FORBIDDEN for
   * `comparable`. The same structural honesty rule the snapshot store uses: there is no
   * way to write "we could not compare this" without saying why.
   */
  notComparableReason: text("not_comparable_reason"),

  // ── What each side actually said. NULL = never targeted on that side. ──────
  baseStatus: text("base_status", { enum: SNAPSHOT_RESOURCE_STATUSES }),
  baseSkipReason: text("base_skip_reason", { enum: SNAPSHOT_SKIP_REASONS }),
  baseReasonDetail: text("base_reason_detail"),
  baseObjectCount: integer("base_object_count").notNull().default(0),

  headStatus: text("head_status", { enum: SNAPSHOT_RESOURCE_STATUSES }),
  headSkipReason: text("head_skip_reason", { enum: SNAPSHOT_SKIP_REASONS }),
  headReasonDetail: text("head_reason_detail"),
  headObjectCount: integer("head_object_count").notNull().default(0),

  // ── What the comparison found, for this resource ──────────────────────────
  objectsPaired: integer("objects_paired").notNull().default(0),
  objectsAdded: integer("objects_added").notNull().default(0),
  objectsRemoved: integer("objects_removed").notNull().default(0),
  objectsIndeterminate: integer("objects_indeterminate").notNull().default(0),
  objectsUnpairable: integer("objects_unpairable").notNull().default(0),
  changesTotal: integer("changes_total").notNull().default(0),
  changesSignificant: integer("changes_significant").notNull().default(0),
}, (t) => [
  uniqueIndex("config_diff_resource_status_uidx").on(t.diffRowId, t.resourceKey),
  /** "What could this diff not compare, and why" — the completeness report itself. */
  index("config_diff_resource_status_comparability_idx").on(t.diffRowId, t.comparability),
  /** "Has this resource been uncomparable across runs" — the trend that finds a blind spot. */
  index("config_diff_resource_status_resource_idx").on(t.resourceKey, t.comparability),

  check(
    "config_diff_resource_status_reason_required",
    sql`(comparability IN ('partially_comparable', 'not_comparable') AND not_comparable_reason IS NOT NULL)
        OR (comparability = 'comparable' AND not_comparable_reason IS NULL)`,
  ),
  /**
   * THE RULE THIS WHOLE FILE EXISTS FOR, made structural. A resource that was not fully
   * comparable can never carry an add or a remove — those two words mean "created" and
   * "deleted", and neither is knowable when a side could not be read. The differ already
   * refuses to emit them; this makes the refusal impossible to regress past.
   */
  check(
    "config_diff_resource_status_no_addremove_when_not_comparable",
    sql`comparability = 'comparable' OR (objects_added = 0 AND objects_removed = 0)`,
  ),
]);

export type ConfigDiffResourceStatus = typeof configDiffResourceStatusTable.$inferSelect;
export type InsertConfigDiffResourceStatus = typeof configDiffResourceStatusTable.$inferInsert;

// ── 4. The changes ───────────────────────────────────────────────────────────

/**
 * One row per difference. The product.
 *
 * `bigserial` for the same reason the object store uses it: rows here are the product of
 * diffs x resources x objects x properties, and diffs accumulate by design.
 *
 * `property_path` is the human-readable path inside the object, dot-separated with array
 * subscripts — `conditions.users.includeUsers[2]`, `Rules[id=abc].Action`.
 * `property_path_normalized` is the same path with every subscript collapsed to `[]`,
 * and it is what noise rules match against, so a rule survives reindexing and reordering.
 * Both are stored: the first is what an operator reads, the second is what the engine
 * matches, and conflating them would make rules index-dependent.
 *
 * Object-level kinds (`object_added` and friends) carry NO property path — there is no
 * property to name — and their `old_value`/`new_value` hold the object's own hash and
 * display name rather than a whole 40-property body, which is already in the snapshot.
 */
export const configDiffChangesTable = pgTable("config_diff_changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  diffRowId: integer("diff_row_id").notNull()
    .references(() => configDiffsTable.id, { onDelete: "cascade" }),

  /**
   * Position in the diff's total order. Assigned from a deterministic sort over
   * (resource_key, object_identity, property_path, change_kind) — constraint 3. Two runs
   * of the same pair under the same ruleset produce identical sequences, which is what
   * makes "the same pair always produces the same result" checkable rather than asserted.
   */
  sequence: integer("sequence").notNull(),

  resourceKey: text("resource_key").notNull(),
  /** The pairing key, from `tenant_config_snapshot_objects.object_identity`. */
  objectIdentity: text("object_identity").notNull(),
  /** Label for operator surfaces, from whichever side has one. Never used for pairing. */
  objectDisplayName: text("object_display_name"),
  /**
   * The strategy that produced `object_identity`. Carried because it qualifies how much
   * the row can be trusted: a `content-hash` identity cannot distinguish a modification
   * from a delete-plus-add, which is what `object_unpairable` records.
   */
  identityStrategy: text("identity_strategy", { enum: SNAPSHOT_IDENTITY_STRATEGIES }),

  changeKind: text("change_kind", { enum: CONFIG_DIFF_CHANGE_KINDS }).notNull(),

  /** NULL for object-level kinds — see the table comment. */
  propertyPath: text("property_path"),
  /** The rule-matching form: every array subscript collapsed to `[]`. */
  propertyPathNormalized: text("property_path_normalized"),

  /**
   * The two values, as JSON. Stored as `jsonb` rather than text so a consumer gets the
   * real type back — `false` and `"false"` are different configurations and a diff that
   * cannot tell them apart is not doing its job.
   *
   * Both are nullable, and the null is meaningful: `property_added` has no old value,
   * `property_removed` has no new one. `value_json` wrappers are avoided; the column
   * holds the value itself, including a JSON `null` where the property really is null —
   * `old_value_present` / `new_value_present` disambiguate "absent" from "present and
   * null", which is a distinction Graph genuinely makes.
   */
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  oldValuePresent: boolean("old_value_present").notNull().default(false),
  newValuePresent: boolean("new_value_present").notNull().default(false),

  /** Suppressed by a rule. STORED, never dropped — constraint 4. */
  isIgnored: boolean("is_ignored").notNull().default(false),
  /**
   * The rule that suppressed it. `restrict` on delete, deliberately: rules are
   * soft-disabled with `is_active = false`, never deleted, precisely so a diff computed
   * under one stays explicable. Cascading would delete real findings along with a rule;
   * setting null would leave an ignored change with no stated grounds, which the CHECK
   * below forbids outright.
   */
  ignoredByRuleId: integer("ignored_by_rule_id")
    .references(() => configDiffPropertyRulesTable.id, { onDelete: "restrict" }),
}, (t) => [
  /** Constraint 3: the order is part of the result, so it is unique and indexed. */
  uniqueIndex("config_diff_changes_sequence_uidx").on(t.diffRowId, t.sequence),
  /** The default read: significant changes of one diff, in order. */
  index("config_diff_changes_significant_idx").on(t.diffRowId, t.isIgnored, t.sequence),
  /** Drilling into one resource, or one object, of one diff. */
  index("config_diff_changes_resource_idx").on(t.diffRowId, t.resourceKey, t.objectIdentity),
  /**
   * "Which property paths move most often across diffs" — the query that MEASURES
   * volatility and therefore produces `observed_volatile` rules. The noise ruleset is
   * meant to be derived from this, not typed in.
   */
  index("config_diff_changes_path_idx").on(t.resourceKey, t.propertyPathNormalized),

  /**
   * Property-level kinds must name a property; object-level kinds must not. Without
   * this, an object-level finding could be written with a path that means nothing, and a
   * property-level one without the path that IS the product.
   */
  check(
    "config_diff_changes_path_matches_kind",
    sql`(change_kind IN ('property_changed', 'property_added', 'property_removed',
                         'array_member_added', 'array_member_removed', 'array_reordered')
         AND property_path IS NOT NULL AND property_path_normalized IS NOT NULL)
        OR (change_kind IN ('object_added', 'object_removed', 'object_indeterminate',
                            'object_unpairable')
            AND property_path IS NULL AND property_path_normalized IS NULL)`,
  ),
  /**
   * A change must actually assert a difference: at least one side present, and for the
   * kinds that mean "both sides exist", both present. A `property_changed` with nothing
   * on one side is a `property_added`/`property_removed` mislabelled.
   */
  check(
    "config_diff_changes_value_presence_matches_kind",
    sql`(change_kind IN ('property_changed', 'array_reordered')
         AND old_value_present AND new_value_present)
        OR (change_kind IN ('property_added', 'array_member_added', 'object_added')
            AND NOT old_value_present AND new_value_present)
        OR (change_kind IN ('property_removed', 'array_member_removed', 'object_removed')
            AND old_value_present AND NOT new_value_present)
        OR (change_kind IN ('object_indeterminate', 'object_unpairable')
            AND (old_value_present OR new_value_present))`,
  ),
  /** An ignored change names the rule that ignored it, and a rule names nothing else. */
  check(
    "config_diff_changes_ignored_names_rule",
    sql`(is_ignored AND ignored_by_rule_id IS NOT NULL)
        OR (NOT is_ignored AND ignored_by_rule_id IS NULL)`,
  ),
]);

export type ConfigDiffChange = typeof configDiffChangesTable.$inferSelect;
export type InsertConfigDiffChange = typeof configDiffChangesTable.$inferInsert;

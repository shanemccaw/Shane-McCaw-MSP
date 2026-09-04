/**
 * Tenant configuration SNAPSHOT STORE (Git #1795).
 *
 * `./config-state` is the MODEL — what a tenant configuration resource *is*, derived
 * from published sources. This file is the STORE — what a specific tenant's
 * configuration actually WAS, at a specific instant, as read off the wire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four constraints decide every choice below. They are not style preferences.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. FULL FIDELITY. `tenant_config_snapshot_objects.object_json` holds the WHOLE
 *    object exactly as the transport returned it. It is not a projection onto the
 *    derived property model, and it must never become one.
 *
 *    Git #1846 proved why, live: Microsoft Graph returns properties its own
 *    published `$metadata` does not declare — `createdDateTime`,
 *    `externalSourceName` and `sourceType` on `/devices`, and `createdDateTime` on
 *    `/servicePrincipals`, appear in NEITHER v1.0 nor beta CSDL yet come back on
 *    the wire. `extensionAttributes` and `domainName` on `/devices` are beta-only.
 *    A store typed strictly from `config_resource_properties` would silently drop
 *    all six. The consequence lands on #1797: a differ cannot see a property change
 *    if the store never kept the property, and it would report that blindness as
 *    "no change" — a confident wrong answer, which is worse than a gap.
 *
 *    The same applies to the PowerShell half. Per #1853 those shapes are
 *    DSC-derived, so they are incomplete by construction too. **The store records
 *    what came back, not what something said should come back.** The derived
 *    property model is a typing hint and documentation — never a filter, never a
 *    validation gate.
 *
 *    This is deliberately the OPPOSITE of `tenant_monitor_profiles`, whose
 *    `extracted_properties` is a lossy summary BY DESIGN. That shape is not reused
 *    here and the two must not be conflated: a check can be derived from a config
 *    snapshot; a snapshot can never be derived from checks.
 *
 * 2. IMMUTABLE AND POINT-IN-TIME. Snapshots accumulate and are never updated in
 *    place, because diffing two instants is a first-class use. Once a snapshot is
 *    sealed, its objects and its completeness rows are evidence and are frozen.
 *    This is enforced in the DATABASE, not by convention — see the
 *    `config_snapshot_reject_mutation_on_sealed` triggers installed by
 *    `lib/db/migrations/manual/2026-08-30-config-snapshot-store-1795.sql`. Drizzle
 *    cannot express a trigger, so the guarantee lives in the migration; this
 *    comment exists so nobody assumes the guarantee is absent because the TS is
 *    silent about it.
 *
 * 3. STABLE IDENTITY, OR NO COLLECTION AT ALL. Diff pairs objects between two
 *    snapshots on (`resource_key`, `object_identity`). If identity is not stable
 *    across snapshots, every object reads as deleted-and-recreated and the diff is
 *    worthless. So identity strategy is declared per resource type UP FRONT in
 *    `config_snapshot_resource_types.identity_strategy`, and the value
 *    `unresolved` is a real, expected state that means "not collectable yet" — not
 *    a default to be papered over with a row number or an array index.
 *
 * 4. HONEST COMPLETENESS. `tenant_config_snapshot_resource_status` carries ONE row
 *    per registered resource type per snapshot, always — including for the ones
 *    that were skipped or failed. A snapshot that silently omits what it could not
 *    read is indistinguishable from a tenant that genuinely does not have those
 *    objects, and that distinction is the whole product. This is exactly the
 *    conflation Git #1847 found in the wild: ten `devices:*` checks each persisting
 *    `status: 'ok', item_count: 0` against a tenant where Intune was never stood up.
 *    The `collected` / `empty` / `skipped` / `failed` split below exists to make
 *    that conflation unrepresentable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why NOTHING here has a foreign key to `config_resources.id`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `scripts/config-state/build-resource-model.mjs` DELETEs and re-INSERTs every
 * `config_resources` row on each run (see its "Building config_resources" step),
 * so the serial primary keys are re-issued from scratch every rebuild.
 * `config_resources.id` is a volatile identifier.
 *
 * A cascading FK from a snapshot table to that id would wipe accumulated live
 * evidence on the next model rebuild — which is precisely the bug Git #1895 found
 * in `config_resource_samples`, and precisely the failure mode #1795 was told this
 * store must not repeat: derived data must never destroy accumulated observation.
 * `config_resource_property_divergence` already set the precedent; this file
 * follows it.
 *
 * Therefore every link to the resource model is the STABLE TEXT `resource_key`
 * (e.g. `graph:v1.0:/policies/conditionalAccessPolicies`, `m365dsc:EXOAcceptedDomain`),
 * carried as a plain column with no FK constraint. Snapshots outlive any particular
 * rebuild of the model, as evidence must.
 *
 * No collector lives here — that is #1796. No UI — that is later still.
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
  CONFIG_READ_TRANSPORTS,
  CONFIG_SURFACES,
  CONFIG_AVAILABILITY,
  GRAPH_VERSIONS,
} from "./config-state";

// ── Vocabularies ─────────────────────────────────────────────────────────────
// Real enums only. Every value below names a state something in this store is
// actually in, and — for the skip reasons especially — a state this platform has
// already observed for real. None of them is a display vocabulary.

/**
 * How an object is given an identity that survives across snapshots. Declared per
 * resource type, because it is a property of the RESOURCE, not of any one object.
 *
 *  - graph-id         the entity's own `id` (the CSDL `<Key>`). The normal case for
 *                     any Graph collection.
 *  - graph-singleton  the resource is a single object, so the resource itself is the
 *                     identity — e.g. `/policies/authorizationPolicy`. Exactly one
 *                     object per snapshot.
 *  - dsc-identity     the PowerShell/Microsoft365DSC `Identity` property, which is
 *                     how Exchange Online, Purview and Teams name their objects.
 *  - composite-key    no single property is unique; identity is several named
 *                     properties joined in declared order. The properties are named
 *                     in `identity_property_names`, never inferred at collection time.
 *  - content-hash     LAST RESORT, and labelled as one. The resource has no stable
 *                     key at all, so identity is a hash of the canonical object.
 *                     A modified object therefore pairs with nothing and reads as a
 *                     delete plus an add. That is a real limitation of the diff for
 *                     these types and it is recorded rather than hidden.
 *  - unresolved       no strategy has been established. The type is NOT collectable:
 *                     collecting it would produce objects the differ cannot pair, and
 *                     an unpairable object is worse than an absent one because it
 *                     manufactures false churn on every diff.
 */
export const SNAPSHOT_IDENTITY_STRATEGIES = [
  "graph-id",
  "graph-singleton",
  "dsc-identity",
  "composite-key",
  "content-hash",
  "unresolved",
] as const;
export type SnapshotIdentityStrategy = typeof SNAPSHOT_IDENTITY_STRATEGIES[number];

/**
 * Where the property shape backing a resource type came from — Git #1853's
 * epistemic distinction, carried into the store so it cannot be collapsed.
 *
 * A cmdlet whose shape was read off a real object and one whose shape came from a
 * Microsoft365DSC MOF are different states of knowledge. Shane's recorded decision
 * on #1853 chose DSC derivation for the 130 shapeless cmdlets *and* required that
 * it be labelled as derived, never presented as live evidence. Live outranks
 * derived; derived never overwrites observed.
 *
 * This is documentation of what is known about the type. It is NOT a filter on
 * what gets stored — see constraint 1 in the file header.
 */
export const SNAPSHOT_SHAPE_PROVENANCE = [
  "observed_live",
  "derived_from_graph_metadata",
  "derived_from_dsc",
  "none",
] as const;
export type SnapshotShapeProvenance = typeof SNAPSHOT_SHAPE_PROVENANCE[number];

/**
 * How a snapshot run was initiated. Four values, matching the ways a run can
 * actually start in this platform — deliberately NOT a list of business reasons
 * (pre-change, promotion rehearsal, onboarding), which are recorded as free text in
 * `trigger_ref` because no code path emits them yet and an enum member that nothing
 * can produce is a display vocabulary.
 */
export const SNAPSHOT_TRIGGERS = ["manual", "scheduled", "workflow", "api"] as const;
export type SnapshotTrigger = typeof SNAPSHOT_TRIGGERS[number];

/**
 * Lifecycle of a snapshot header.
 *
 *  - running    collection is in flight. NOT yet immutable, and must not be diffed —
 *               its object set is incomplete by definition.
 *  - sealed     collection finished. The snapshot is now immutable; the database
 *               triggers reject any further write to its objects or status rows.
 *               Note this says nothing about COMPLETENESS: a sealed snapshot may
 *               still have skipped and failed resources. `is_complete` answers that,
 *               separately and honestly.
 *  - failed     the run aborted. Sealed anyway, and KEPT, because the record of a
 *               failed collection is evidence — silently discarding it would leave a
 *               hole in the history indistinguishable from a period nobody collected.
 *  - abandoned  the run died without ever sealing itself (process crash, container
 *               restart — both really happened during #1793). Marked by a later
 *               sweep, never by the dead run itself. Visible on purpose so a gap in
 *               snapshot history has a stated cause.
 */
export const SNAPSHOT_STATUSES = ["running", "sealed", "failed", "abandoned"] as const;
export type SnapshotStatus = typeof SNAPSHOT_STATUSES[number];

/**
 * Per-resource collection outcome within one snapshot. The `collected` / `empty`
 * split is the point of the whole table.
 *
 *  - collected  read succeeded and at least one object was stored
 *  - empty      read succeeded and the tenant GENUINELY HAS ZERO objects of this
 *               type. Distinct from every failure state, and distinct from `skipped`.
 *               This is the value that stops "we could not read it" from being
 *               reported as "you do not have any".
 *  - partial    read succeeded but is known incomplete — paging truncated, or the
 *               run's budget ran out mid-collection. The objects stored are real;
 *               the SET is not whole. A diff must treat a `partial` resource's
 *               absences as unknown, never as deletions.
 *  - skipped    deliberately not attempted. `skip_reason` says why.
 *  - failed     attempted and errored. `skip_reason` classifies it and the wire
 *               evidence columns carry the actual response.
 */
export const SNAPSHOT_RESOURCE_STATUSES = [
  "collected",
  "empty",
  "partial",
  "skipped",
  "failed",
] as const;
export type SnapshotResourceStatus = typeof SNAPSHOT_RESOURCE_STATUSES[number];

/**
 * Why a resource was not fully collected. #1795 names four families — permission,
 * licence, transport, error — and each value below is the specific, distinguishable
 * cause this platform has ALREADY OBSERVED for real, so none of them is speculative:
 *
 *  - permission_denied       403 / `access_denied`. 502 `config_resources` rows sit at
 *                            `needs_additional_scope`; #1793's survey recorded 5
 *                            `access_denied` cmdlets live.
 *  - license_required        a real SKU gap. The four `needs_license` rows
 *                            (`/auditLogs/signIns`, `/identityProtection/riskDetections`,
 *                            `/reports/authenticationMethods/userRegistrationDetails`,
 *                            `/roleManagement/directory/roleEligibilitySchedules`) each
 *                            carry `verification_status = 'failed_live'` with the real
 *                            Graph error behind the verdict.
 *  - service_not_configured  the service itself is not stood up on this tenant, though
 *                            the permission is held — Git #1847's Intune finding. Joins
 *                            `tenant_service_availability` for the tenant-level fact
 *                            rather than re-deciding it per resource.
 *  - no_executor             this platform has NO code path for the resource's
 *                            transport. Git #1849: 22 `azure-rm` + 6 `power-platform`
 *                            resources are unreachable by any executor that exists.
 *  - transport_error         the transport itself failed rather than the resource —
 *                            the ps-execution container timing out or wedging
 *                            (Git #1852), a 5xx, a dropped connection. Explicitly NOT
 *                            a statement about the tenant, and must never be recorded
 *                            as `empty`.
 *  - cmdlet_unavailable      the cmdlet is not present in the session (3 observed).
 *  - not_supported_app_only  the cmdlet/API exists but refuses app-only auth. Originally
 *                            2 observed PowerShell cmdlets; #2115 added the Graph-side
 *                            match, literal `"Requested API is not supported in
 *                            application-only context"` (412 PreconditionFailed).
 *  - not_applicable_to_account_type  Git #2115/#1962: the endpoint is real, but Graph
 *                            says it does not apply to THIS tenant/account — three
 *                            observed literals, all the same underlying fact: `"This
 *                            API is not supported for AAD accounts"`, `"Request not
 *                            applicable to target tenant"`, and `AADSTS500011` ("The
 *                            resource principal ... was not found in the tenant" — a
 *                            backend service principal Microsoft never provisioned
 *                            for this tenant type). 178 rows on the #2115 snapshot
 *                            alone, previously all `unknown_error`.
 *  - endpoint_not_found      Git #2115/#1962: the resource does not exist at this
 *                            path/version at all — a genuine 404, the OData literal
 *                            `"Resource not found for the segment '<x>'"`, or Graph's
 *                            own `innerError.code: "apiNotFound"`. Distinct from
 *                            `not_applicable_to_account_type`: that family says "this
 *                            tenant can't use this", this one says "this URL is not a
 *                            thing" — most likely the registry's CSDL-derived resource
 *                            model naming an endpoint Graph never actually serves.
 *                            173 rows on the #2115 snapshot, previously all
 *                            `unknown_error`.
 *  - identity_unresolved     the registry has no identity strategy for this type, so
 *                            collecting it would yield unpairable objects (see
 *                            `SNAPSHOT_IDENTITY_STRATEGIES.unresolved`).
 *  - not_collectable         deliberately disabled in the registry, with a reason.
 *  - budget_exhausted        the run hit its own time or size budget before reaching
 *                            this resource. #1793 hit this for real.
 *  - unknown_error           errored with no classifiable cause. Kept as a real value
 *                            so an unclassified failure is never quietly filed under a
 *                            cause somebody guessed at.
 */
export const SNAPSHOT_SKIP_REASONS = [
  "permission_denied",
  "license_required",
  "service_not_configured",
  "no_executor",
  "transport_error",
  "cmdlet_unavailable",
  "not_supported_app_only",
  "not_applicable_to_account_type",
  "endpoint_not_found",
  "identity_unresolved",
  "not_collectable",
  "budget_exhausted",
  "unknown_error",
] as const;
export type SnapshotSkipReason = typeof SNAPSHOT_SKIP_REASONS[number];

/**
 * The canonicalisation used to compute `object_hash`, recorded per object so the
 * hash stays verifiable if the algorithm ever changes. A hash whose recipe is not
 * written down is not evidence, it is a number.
 *
 *  - jcs-sha256  RFC 8785 JSON Canonicalization Scheme, then SHA-256, hex.
 */
export const SNAPSHOT_HASH_ALGORITHMS = ["jcs-sha256"] as const;
export type SnapshotHashAlgorithm = typeof SNAPSHOT_HASH_ALGORITHMS[number];

// ── 1. The registry: what the snapshot collector is allowed to collect ───────

/**
 * The durable, snapshot-facing catalog of collectable resource types.
 *
 * This is NOT a duplicate of `config_resources`, and the difference is the reason it
 * exists. `config_resources` is a DERIVED model: 1,539 rows rebuilt wholesale from
 * published sources on every extraction run, with new primary keys each time. This
 * table is CURATED and STABLE: it holds only the types the collector actually
 * targets, keyed by the text `resource_key` that survives a rebuild, and it carries
 * the two facts the derived model has no place for —
 *
 *   - `identity_strategy` / `identity_property_names`, which no published source
 *     states and which the differ cannot work without; and
 *   - `is_collectable` plus its reason, an operational decision rather than a
 *     description of Microsoft's API surface.
 *
 * `last_known_availability` is a CACHE of `config_resources.availability`, refreshed
 * by the collector and stamped with `availability_refreshed_at`. It is a scheduling
 * hint — "do not bother asking for this today" — and is never treated as evidence.
 * The evidence for what happened lives per snapshot in
 * `tenant_config_snapshot_resource_status`. Git #1895 is exactly why these are kept
 * apart: the derived verdict regressed silently once already, and a store that took
 * it at face value would have recorded a licence gap as a mystery 400.
 */
export const configSnapshotResourceTypesTable = pgTable("config_snapshot_resource_types", {
  id: serial("id").primaryKey(),

  /**
   * Stable identity, matching `config_resources.resource_key` by VALUE — deliberately
   * not by foreign key. See the file header for why an FK here would be a bug.
   */
  resourceKey: text("resource_key").notNull(),
  displayName: text("display_name").notNull(),
  surface: text("surface", { enum: CONFIG_SURFACES }).notNull(),
  workload: text("workload").notNull(),

  // ── How it is read ─────────────────────────────────────────────────────────
  readTransport: text("read_transport", { enum: CONFIG_READ_TRANSPORTS }).notNull(),
  graphVersion: text("graph_version", { enum: GRAPH_VERSIONS }),
  /** Addressable path relative to the Graph version root, when transport is `graph`. */
  graphPath: text("graph_path"),
  /** True when the path yields a collection; false for a singleton. */
  isCollection: boolean("is_collection").notNull().default(false),
  /** Read cmdlets, when the transport is `powershell`. From Microsoft365DSC / #1793. */
  readCmdlets: jsonb("read_cmdlets").$type<string[]>().notNull().default([]),

  // ── Identity, without which diff is impossible ─────────────────────────────
  identityStrategy: text("identity_strategy", { enum: SNAPSHOT_IDENTITY_STRATEGIES })
    .notNull().default("unresolved"),
  /**
   * The property names forming the identity, in declared order. One entry for
   * `graph-id` / `dsc-identity`, several for `composite-key`, empty for
   * `graph-singleton`, `content-hash` and `unresolved`.
   */
  identityPropertyNames: jsonb("identity_property_names").$type<string[]>().notNull().default([]),
  /** Why this strategy — the evidence, so a later reader need not re-derive it. */
  identityBasis: text("identity_basis"),

  // ── Permission requirement (copied from the model, for scheduling) ─────────
  /** Microsoft365DSC's ALL-OF set. Kept separate from the ANY-OF set below, per #1794. */
  requiredAppPermissions: jsonb("required_app_permissions").$type<string[]>().notNull().default([]),
  /** Microsoft's own published ANY-OF set for a GET on this path. Holding one suffices. */
  graphReadPermissionOptions: jsonb("graph_read_permission_options").$type<string[]>().notNull().default([]),

  // ── Operational state ──────────────────────────────────────────────────────
  /**
   * Whether the collector should attempt this type at all. False for anything with
   * `identity_strategy = 'unresolved'`, for transports with no executor, and for
   * deliberate exclusions — each with `not_collectable_reason` stating which.
   */
  isCollectable: boolean("is_collectable").notNull().default(false),
  notCollectableReason: text("not_collectable_reason", { enum: SNAPSHOT_SKIP_REASONS }),
  /** Lower runs first. Lets cheap, high-value resources land before a budget expires. */
  collectionOrder: integer("collection_order").notNull().default(1000),

  /** Cached scheduling hint from the derived model — never evidence. See table comment. */
  lastKnownAvailability: text("last_known_availability", { enum: CONFIG_AVAILABILITY })
    .notNull().default("unknown"),
  availabilityRefreshedAt: timestamp("availability_refreshed_at", { withTimezone: true }),

  /** What is known about this type's property shape, and how well. Git #1853. */
  shapeProvenance: text("shape_provenance", { enum: SNAPSHOT_SHAPE_PROVENANCE })
    .notNull().default("none"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_snapshot_resource_types_key_uidx").on(t.resourceKey),
  index("config_snapshot_resource_types_collectable_idx").on(t.isCollectable, t.collectionOrder),
  index("config_snapshot_resource_types_transport_idx").on(t.readTransport),
  index("config_snapshot_resource_types_surface_idx").on(t.surface),

  /**
   * Constraint 3, made structural: a type with no identity strategy CANNOT be marked
   * collectable. Collecting it would produce objects the differ cannot pair, which
   * manufactures false churn on every diff — so the database refuses the combination
   * rather than trusting the collector to remember.
   */
  check(
    "config_snapshot_resource_types_collectable_needs_identity",
    sql`is_collectable = false OR identity_strategy <> 'unresolved'`,
  ),
  /** A type excluded from collection must say which reason excluded it. */
  check(
    "config_snapshot_resource_types_not_collectable_needs_reason",
    sql`is_collectable = true OR not_collectable_reason IS NOT NULL`,
  ),
  /** Strategies that name properties must actually name them. */
  check(
    "config_snapshot_resource_types_identity_props_present",
    sql`identity_strategy NOT IN ('graph-id', 'dsc-identity', 'composite-key')
        OR jsonb_array_length(identity_property_names) > 0`,
  ),
]);

export type ConfigSnapshotResourceType = typeof configSnapshotResourceTypesTable.$inferSelect;
export type InsertConfigSnapshotResourceType = typeof configSnapshotResourceTypesTable.$inferInsert;

// ── 2. The snapshot header ───────────────────────────────────────────────────

/**
 * One row per collection run against one tenant at one instant.
 *
 * `captured_at` is the logical instant the snapshot represents and is what diff and
 * "latest snapshot" order by. It is set once and never moved.
 *
 * Both tenant keys are carried on purpose, because this codebase genuinely uses two
 * and picking one would force every consumer to join to translate:
 *   - `tenant_id` — `tenants.id`, the platform's own customer key, with a real FK.
 *     Used by `config_resource_samples`.
 *   - `entra_tenant_id` — the Microsoft tenant GUID actually authenticated against.
 *     Used by `tenant_monitor_profiles` and `tenant_service_availability`.
 * Recording the GUID that was really used also means a snapshot stays interpretable
 * if a `tenants` row is later re-pointed at a different directory.
 */
export const tenantConfigSnapshotsTable = pgTable("tenant_config_snapshots", {
  id: serial("id").primaryKey(),
  /** Stable external identity, safe to hand out and to reference across systems. */
  snapshotId: uuid("snapshot_id").notNull().defaultRandom(),

  tenantId: integer("tenant_id").notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  /** The Microsoft Graph tenant GUID actually collected against. */
  entraTenantId: text("entra_tenant_id").notNull(),

  /** The instant this snapshot represents. Immutable; the ordering key for diff. */
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),

  trigger: text("trigger", { enum: SNAPSHOT_TRIGGERS }).notNull(),
  /**
   * Free text naming what asked for it — a change-control id, a promotion rehearsal,
   * an operator's reason. Free text rather than an enum because no code path emits
   * these yet; see `SNAPSHOT_TRIGGERS`.
   */
  triggerRef: text("trigger_ref"),
  /**
   * The Workflow Engine run that produced this snapshot. Every automated collection
   * is a visible workflow node, never a bare scheduler, so a `scheduled` snapshot
   * should always carry one. Nullable because a `manual` snapshot legitimately has none.
   */
  wfRunId: integer("wf_run_id"),
  /** The user who asked, for a `manual` snapshot. */
  requestedByUserId: integer("requested_by_user_id"),

  status: text("status", { enum: SNAPSHOT_STATUSES }).notNull().default("running"),

  /**
   * Set when the snapshot stops being writable. From this moment the database
   * triggers reject writes to its objects and status rows. Null only while `running`.
   */
  sealedAt: timestamp("sealed_at", { withTimezone: true }),

  // ── Completeness summary, all counted from real rows, never estimated ──────
  /** Registered collectable types this run set out to collect. The denominator. */
  resourceTypesTargeted: integer("resource_types_targeted").notNull().default(0),
  /** Types that returned objects (`collected`). */
  resourceTypesCollected: integer("resource_types_collected").notNull().default(0),
  /** Types that answered honestly with zero objects (`empty`). NOT a failure. */
  resourceTypesEmpty: integer("resource_types_empty").notNull().default(0),
  /** Types read but known-truncated (`partial`). */
  resourceTypesPartial: integer("resource_types_partial").notNull().default(0),
  /** Types deliberately not attempted (`skipped`). */
  resourceTypesSkipped: integer("resource_types_skipped").notNull().default(0),
  /** Types attempted that errored (`failed`). */
  resourceTypesFailed: integer("resource_types_failed").notNull().default(0),
  /** Total objects stored under this snapshot. */
  objectCount: integer("object_count").notNull().default(0),

  /**
   * TRUE only when every targeted type finished `collected` or `empty` — i.e. the
   * snapshot is a whole picture of the tenant, safe to promote from and safe to diff
   * without qualification.
   *
   * Stored rather than derived at read time deliberately: it is a fact ABOUT a frozen
   * snapshot, it never changes after sealing, and the promotion path must not depend
   * on a consumer remembering to recompute it correctly. A snapshot with any
   * `partial`, `skipped` or `failed` resource is NOT complete, and #1795's whole
   * premise is that the difference must be impossible to overlook.
   */
  isComplete: boolean("is_complete").notNull().default(false),

  /** The collector build that produced this, so a fidelity bug can be scoped later. */
  collectorVersion: text("collector_version"),
  /** Why the run ended, when it ended badly. */
  error: text("error"),
  notes: text("notes"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tenant_config_snapshots_uuid_uidx").on(t.snapshotId),
  /**
   * READ PATTERN 1 — "the latest snapshot for a tenant". Partial, over sealed
   * snapshots only, because a `running` or `abandoned` snapshot is never the answer
   * to that question and should not sit at the head of the index.
   */
  index("tenant_config_snapshots_tenant_latest_idx")
    .on(t.tenantId, t.capturedAt.desc())
    .where(sql`status = 'sealed'`),
  /** The unfiltered history, for retention sweeps and for auditing failed runs. */
  index("tenant_config_snapshots_tenant_captured_idx").on(t.tenantId, t.capturedAt.desc()),
  index("tenant_config_snapshots_entra_idx").on(t.entraTenantId),
  index("tenant_config_snapshots_status_idx").on(t.status),

  /**
   * Constraint 2, made structural: a snapshot is writable exactly while it is
   * `running`, and sealed the instant it is anything else. The two facts cannot
   * disagree.
   */
  check(
    "tenant_config_snapshots_sealed_at_matches_status",
    sql`(status = 'running' AND sealed_at IS NULL)
        OR (status <> 'running' AND sealed_at IS NOT NULL)`,
  ),
  /**
   * Constraint 4, made structural: `is_complete` cannot be asserted while any
   * targeted resource was truncated, skipped or failed. This is the flag the
   * Dev→Test→Prod promotion path keys off, so it must be impossible to set
   * optimistically — a promotion rehearsed from an incomplete snapshot is the exact
   * failure #1795 exists to prevent.
   */
  check(
    "tenant_config_snapshots_complete_means_complete",
    sql`is_complete = false
        OR (resource_types_partial = 0 AND resource_types_skipped = 0 AND resource_types_failed = 0)`,
  ),
  /** Counts are counts. */
  check(
    "tenant_config_snapshots_counts_nonnegative",
    sql`resource_types_targeted >= 0 AND resource_types_collected >= 0
        AND resource_types_empty >= 0 AND resource_types_partial >= 0
        AND resource_types_skipped >= 0 AND resource_types_failed >= 0
        AND object_count >= 0`,
  ),
]);

export type TenantConfigSnapshot = typeof tenantConfigSnapshotsTable.$inferSelect;
export type InsertTenantConfigSnapshot = typeof tenantConfigSnapshotsTable.$inferInsert;

// ── 3. The object store ──────────────────────────────────────────────────────

/**
 * One row per configuration object, holding THE REAL OBJECT.
 *
 * `object_json` is the verbatim response body for this object, exactly as the
 * transport returned it, including `@odata.*` annotations and including every
 * property no published metadata declares. Nothing is projected away. Constraint 1
 * in the file header is enforced here or nowhere.
 *
 * `bigserial` rather than `serial`: this is the one table in the store whose row
 * count is the product of tenants x resource types x objects x retained snapshots,
 * and snapshots accumulate forever by design. A 2.1-billion ceiling is a real
 * horizon here in a way it is not for any other table in this file.
 *
 * `tenant_id` is denormalised from the header. Safe precisely because snapshots are
 * immutable — a sealed snapshot's tenant can never change, so the copy cannot drift
 * — and it lets #1797 read one object's history across snapshots without a join.
 */
export const tenantConfigSnapshotObjectsTable = pgTable("tenant_config_snapshot_objects", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  snapshotRowId: integer("snapshot_row_id").notNull()
    .references(() => tenantConfigSnapshotsTable.id, { onDelete: "cascade" }),
  /** Denormalised from the header — see table comment for why this cannot drift. */
  tenantId: integer("tenant_id").notNull(),

  /** Stable text key into the resource model. No FK, by design — see file header. */
  resourceKey: text("resource_key").notNull(),

  /**
   * THE DIFF PAIRING KEY. Stable across snapshots for the same real-world object,
   * computed by the strategy declared on the resource type. Unique within a snapshot
   * for a given resource key — enforced below, because two objects sharing an
   * identity would make pairing ambiguous and the differ would have to guess.
   */
  objectIdentity: text("object_identity").notNull(),
  /**
   * The strategy that actually produced `object_identity` for THIS object. Normally
   * equals the resource type's declared strategy; recorded per object so a fallback
   * (e.g. an object missing its `id`, resolved by `content-hash`) is visible in the
   * data instead of being silently mixed in with properly-keyed rows.
   */
  identityStrategy: text("identity_strategy", { enum: SNAPSHOT_IDENTITY_STRATEGIES }).notNull(),
  /** Human-readable label for operator surfaces. Never used for pairing. */
  displayName: text("display_name"),

  /** THE REAL OBJECT, verbatim and complete. Never a projection. */
  objectJson: jsonb("object_json").$type<Record<string, unknown>>().notNull(),

  /**
   * Hash of the canonicalised object, so the differ can reject an unchanged pair in
   * one comparison instead of walking the JSON. Equal hashes mean equal objects;
   * different hashes mean a real difference to describe.
   */
  objectHash: text("object_hash").notNull(),
  hashAlgorithm: text("hash_algorithm", { enum: SNAPSHOT_HASH_ALGORITHMS })
    .notNull().default("jcs-sha256"),

  /** Top-level property count of the stored object. A cheap fidelity tripwire. */
  propertyCount: integer("property_count").notNull().default(0),
  /**
   * The object's `@odata.type` when Graph supplied one. Collections are frequently
   * polymorphic — `/policies/conditionalAccessPolicies` and the `deviceManagement`
   * configuration collections especially — so the concrete type is part of the object's
   * meaning and is lifted out for querying rather than left buried in the JSON.
   */
  odataType: text("odata_type"),
  /** The exact path or cmdlet that returned this object. Provenance, per object. */
  sourceRef: text("source_ref"),

  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /**
   * READ PATTERN 2 — "pair objects across two snapshots for diff", and the ambiguity
   * guard at the same time. A differ scans `snapshot_row_id IN (a, b)` and merges on
   * (`resource_key`, `object_identity`); this index serves that directly and makes a
   * duplicate identity within one snapshot impossible to insert.
   */
  uniqueIndex("tenant_config_snapshot_objects_identity_uidx")
    .on(t.snapshotRowId, t.resourceKey, t.objectIdentity),
  /**
   * The same pairing driven from the object's side — one object's whole history
   * across every snapshot, which is how a "when did this change" answer is built.
   */
  index("tenant_config_snapshot_objects_history_idx")
    .on(t.resourceKey, t.objectIdentity, t.snapshotRowId),
  /** Reading one resource's objects out of one snapshot — the collector's own readback. */
  index("tenant_config_snapshot_objects_snapshot_resource_idx")
    .on(t.snapshotRowId, t.resourceKey),
  /** Cross-snapshot equality shortcut, and duplicate-object detection within a tenant. */
  index("tenant_config_snapshot_objects_hash_idx").on(t.tenantId, t.objectHash),
]);

export type TenantConfigSnapshotObject = typeof tenantConfigSnapshotObjectsTable.$inferSelect;
export type InsertTenantConfigSnapshotObject = typeof tenantConfigSnapshotObjectsTable.$inferInsert;

// ── 4. Per-resource completeness — the honest record ─────────────────────────

/**
 * ONE ROW PER TARGETED RESOURCE TYPE PER SNAPSHOT, ALWAYS — including for every type
 * that was skipped or failed. This table is what makes a snapshot able to state its
 * own completeness rather than merely imply it by what happens to be present.
 *
 * Read it as: "for this snapshot, here is every question we set out to ask, what the
 * answer was, and — where there was no answer — exactly why not." A resource with no
 * row here was never targeted at all, which is itself a distinct and visible fact
 * from having been targeted and skipped.
 *
 * The wire-evidence columns (`http_status`, `error_code`, `error_message`,
 * `request_ref`) hold what actually came back, not a summary of it. Git #1793 proved
 * the cost of the alternative: a driver that recorded transport failures as
 * per-cmdlet errors produced a table of false negatives, and the whole survey run had
 * to be discarded.
 */
export const tenantConfigSnapshotResourceStatusTable = pgTable("tenant_config_snapshot_resource_status", {
  id: serial("id").primaryKey(),

  snapshotRowId: integer("snapshot_row_id").notNull()
    .references(() => tenantConfigSnapshotsTable.id, { onDelete: "cascade" }),
  /** Stable text key into the resource model. No FK, by design — see file header. */
  resourceKey: text("resource_key").notNull(),
  /** Denormalised so a completeness report reads without joining the registry. */
  readTransport: text("read_transport", { enum: CONFIG_READ_TRANSPORTS }).notNull(),

  status: text("status", { enum: SNAPSHOT_RESOURCE_STATUSES }).notNull(),
  /**
   * REQUIRED for `partial`, `skipped` and `failed`; FORBIDDEN for `collected` and
   * `empty`. A CHECK constraint enforces exactly that, so an incomplete read without
   * a stated cause cannot be written at all — which is the entire point of the
   * "honest completeness" constraint. `partial` is included deliberately: a truncated
   * read has a cause (budget, transport, paging) and a differ needs it to know
   * whether a missing object is a deletion or an unknown.
   */
  skipReason: text("skip_reason", { enum: SNAPSHOT_SKIP_REASONS }),
  /** The specific sentence, from the real observation. Never a filled-in template. */
  reasonDetail: text("reason_detail"),

  /** Objects stored for this resource in this snapshot. 0 is normal for `empty`. */
  objectCount: integer("object_count").notNull().default(0),
  /** Pages actually fetched — the evidence behind a `partial` verdict. */
  pageCount: integer("page_count"),

  // ── Wire evidence, verbatim ────────────────────────────────────────────────
  /** The exact path or cmdlet asked for. */
  requestRef: text("request_ref"),
  httpStatus: integer("http_status"),
  /** The provider's own error literal, e.g. `Authorization_RequestDenied`. */
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),

  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tenant_config_snapshot_resource_status_uidx").on(t.snapshotRowId, t.resourceKey),
  /** "What did this snapshot fail to read, and why" — the completeness report itself. */
  index("tenant_config_snapshot_resource_status_status_idx").on(t.snapshotRowId, t.status),
  /** "Has this resource been failing for this reason across runs" — trend over history. */
  index("tenant_config_snapshot_resource_status_resource_idx").on(t.resourceKey, t.status),
  index("tenant_config_snapshot_resource_status_skip_idx").on(t.skipReason),

  /**
   * The honest-completeness rule, made structural. An incomplete outcome MUST carry
   * its reason; a successful one must not carry a spurious once. There is no way to
   * write "we did not get this" without saying why.
   */
  check(
    "tenant_config_snapshot_resource_status_reason_required",
    sql`(status IN ('partial', 'skipped', 'failed') AND skip_reason IS NOT NULL)
        OR (status IN ('collected', 'empty') AND skip_reason IS NULL)`,
  ),
  /**
   * `collected` means objects were stored; `empty` means the tenant genuinely has
   * none. Neither may lie about its own object count, because that conflation is the
   * precise bug Git #1847 found in the `devices:*` checks.
   */
  check(
    "tenant_config_snapshot_resource_status_object_count_matches",
    sql`object_count >= 0
        AND (status <> 'collected' OR object_count > 0)
        AND (status <> 'empty' OR object_count = 0)`,
  ),
]);

export type TenantConfigSnapshotResourceStatus = typeof tenantConfigSnapshotResourceStatusTable.$inferSelect;
export type InsertTenantConfigSnapshotResourceStatus = typeof tenantConfigSnapshotResourceStatusTable.$inferInsert;

// ── 5. The baseline registry — which snapshot is the KNOWN-GOOD one (Git #1843) ──

/**
 * What a registered baseline is FOR. Two values, and both name a differ entry point
 * that already exists in `config-snapshot-differ.ts` — this is not a display
 * vocabulary:
 *
 *  - known_good        the reference a tenant is assessed against →
 *                      `diffAgainstBaseline` (`mode: 'baseline_assessment'`).
 *  - promotion_source  the source environment a target is promoted from →
 *                      `diffPromotion` (`mode: 'promotion'`). Distinct from
 *                      `known_good` because a promotion source is a *different
 *                      tenant's* configuration, and the differ enforces that
 *                      difference with a CHECK constraint on `config_diffs`.
 *
 * There is deliberately no `approved` / `signed_off` value. Approval is a workflow
 * state this platform records elsewhere, and duplicating it here would let a
 * baseline claim an approval nothing produced.
 */
export const CONFIG_BASELINE_PURPOSES = ["known_good", "promotion_source"] as const;
export type ConfigBaselinePurpose = typeof CONFIG_BASELINE_PURPOSES[number];

/**
 * Names a specific, already-collected snapshot as the reference for assessment or
 * promotion.
 *
 * ─── Why this table has to exist ────────────────────────────────────────────────
 * #1797 landed `diffAgainstBaseline(knownGoodSnapshotRowId, currentSnapshotRowId)`
 * and #1843 has to serve "assess a tenant against a baseline" over HTTP. Nothing in
 * the store said WHICH snapshot is the known-good one — `tenant_config_snapshots`
 * carries no baseline flag, and `drift_baseline_snapshots` is a different thing
 * entirely (the drift engine's per-domain `(text tenant_id, domain_key)` config blob,
 * 4 rows, no relationship to the full-fidelity snapshot store). Without a registry
 * "assess against a baseline" degenerates into "diff two snapshots you happened to
 * remember the row ids of", which is `tenant_compare` under a different name.
 *
 * So the baseline is a NAMED POINTER at real stored evidence, and nothing more. It
 * holds no configuration of its own: everything it asserts is `snapshot_row_id`, and
 * the snapshot it points at is immutable by database trigger. A baseline therefore
 * cannot drift away from what was actually observed.
 *
 * ─── Deletion semantics, chosen deliberately ────────────────────────────────────
 * `snapshot_row_id` is `NO ACTION` (checked at end-of-statement), not `CASCADE` and
 * not `RESTRICT`:
 *
 *  - not CASCADE, because retention-deleting a snapshot that something was being
 *    assessed against would silently remove the reference and leave every past
 *    assessment unexplainable.
 *  - not RESTRICT, because RESTRICT fires immediately and would abort the legitimate
 *    whole-tenant cascade (`tenants` → snapshots AND baselines in one statement).
 *
 * `NO ACTION` gives exactly the wanted behaviour: deleting a referenced snapshot on
 * its own fails loudly; deleting the whole tenant succeeds, because the baseline row
 * is gone by the time the constraint is checked.
 *
 * ─── Scoping ───────────────────────────────────────────────────────────────────
 * `msp_id` is carried explicitly rather than resolved through `tenant_id` on every
 * read. An operator surface lists baselines for its own MSP's book, and a join to
 * `tenants` to discover that is a join that can be forgotten. The column is the
 * predicate.
 */
export const configSnapshotBaselinesTable = pgTable("config_snapshot_baselines", {
  id: serial("id").primaryKey(),
  baselineId: uuid("baseline_id").notNull().defaultRandom(),

  /** The MSP whose operators may see and use this baseline. The scoping predicate. */
  mspId: integer("msp_id").notNull(),
  /** The tenant the referenced snapshot was collected FROM. */
  tenantId: integer("tenant_id").notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  /**
   * The snapshot this baseline IS. Immutable by trigger, so the baseline's content
   * cannot change underneath an assessment. See the deletion note in the header.
   */
  snapshotRowId: integer("snapshot_row_id").notNull(),

  /** Operator-chosen label. Unique within an MSP so it can be referenced by name. */
  name: text("name").notNull(),
  description: text("description"),
  purpose: text("purpose", { enum: CONFIG_BASELINE_PURPOSES }).notNull(),

  /**
   * Retired rather than deleted, so an assessment run months ago against a baseline
   * nobody uses now is still explainable. A retired baseline MUST say why — same
   * rule the completeness table enforces, for the same reason.
   */
  isActive: boolean("is_active").notNull().default(true),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredReason: text("retired_reason"),

  declaredByUserId: integer("declared_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_snapshot_baselines_uuid_uidx").on(t.baselineId),
  /** Referenceable by name within one MSP's book. */
  uniqueIndex("config_snapshot_baselines_msp_name_uidx").on(t.mspId, t.name),
  /** "Which baselines can this operator choose from" — the list read. */
  index("config_snapshot_baselines_msp_active_idx").on(t.mspId, t.isActive),
  /** "Is this snapshot spoken for" — checked before a retention delete. */
  index("config_snapshot_baselines_snapshot_idx").on(t.snapshotRowId),

  check(
    "config_snapshot_baselines_retired_needs_reason",
    sql`(is_active = true AND retired_at IS NULL AND retired_reason IS NULL)
        OR (is_active = false AND retired_at IS NOT NULL AND retired_reason IS NOT NULL)`,
  ),
  check("config_snapshot_baselines_name_not_blank", sql`length(btrim(name)) > 0`),
]);

export type ConfigSnapshotBaseline = typeof configSnapshotBaselinesTable.$inferSelect;
export type InsertConfigSnapshotBaseline = typeof configSnapshotBaselinesTable.$inferInsert;

// ── 6. Retention — the prune run audit trail (Git #2114) ─────────────────────

/**
 * One row per execution of the `config_snapshot_prune` workflow node.
 *
 * The store accumulates by design (see the file header): 34 MB / 50,176 object
 * rows per full snapshot was measured live with NO retention in place, and every
 * manual snapshot run adds another. The policy is a per-tenant COUNT CAP — keep
 * the most recent `keep_per_tenant` non-running snapshots for each tenant, delete
 * the rest — with two hard exclusions the prune query enforces before it ever
 * issues a DELETE:
 *
 *   - a snapshot named by ANY `config_diffs.base_snapshot_row_id` or
 *     `head_snapshot_row_id` row, ever (not just a "currently active" one — a
 *     diff is permanent evidence per #1797's own immutability rule, and that file's
 *     FK is `ON DELETE CASCADE`, so an unfiltered prune would silently destroy an
 *     immutable diff rather than being blocked by the database).
 *   - a snapshot named by any `config_snapshot_baselines.snapshot_row_id` row.
 *     This one IS structurally blocked by the database (`ON DELETE NO ACTION`,
 *     see that table's migration), but the prune query still pre-filters it so a
 *     baseline never turns an otherwise-clean sweep into a failed statement.
 *
 * This table exists so that exclusion, and every actual prune run, is real
 * evidence rather than an assumed side effect — the same "honest completeness"
 * discipline `tenant_config_snapshot_resource_status` applies to collection,
 * applied here to deletion. `snapshots_deleted` is what the database actually
 * removed (from the DELETE's own row count), never estimated.
 */
export const configSnapshotPruneRunsTable = pgTable("config_snapshot_prune_runs", {
  id: serial("id").primaryKey(),

  /** The cap applied on this run — the most recent N non-running snapshots kept per tenant. */
  keepPerTenant: integer("keep_per_tenant").notNull(),

  /** Distinct tenants that had at least one non-running snapshot considered. */
  tenantsConsidered: integer("tenants_considered").notNull().default(0),
  /** Snapshots beyond the cap, before exclusions were applied. */
  candidatesOverCap: integer("candidates_over_cap").notNull().default(0),
  /** Of those, excluded because a live `config_diffs` row names them. */
  protectedByDiff: integer("protected_by_diff").notNull().default(0),
  /** Of those, excluded because a `config_snapshot_baselines` row names them. */
  protectedByBaseline: integer("protected_by_baseline").notNull().default(0),
  /** Rows the DELETE actually removed — from the statement's own row count. */
  snapshotsDeleted: integer("snapshots_deleted").notNull().default(0),
  /** Sum of the deleted snapshots' own `object_count` — the real freed row estimate. */
  objectsDeletedEstimate: integer("objects_deleted_estimate").notNull().default(0),

  trigger: text("trigger", { enum: SNAPSHOT_TRIGGERS }).notNull().default("scheduled"),
  wfRunId: integer("wf_run_id"),

  durationMs: integer("duration_ms"),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("config_snapshot_prune_runs_ran_at_idx").on(t.ranAt.desc()),
  check(
    "config_snapshot_prune_runs_counts_nonnegative",
    sql`keep_per_tenant >= 0 AND tenants_considered >= 0 AND candidates_over_cap >= 0
        AND protected_by_diff >= 0 AND protected_by_baseline >= 0
        AND snapshots_deleted >= 0 AND objects_deleted_estimate >= 0`,
  ),
]);

export type ConfigSnapshotPruneRun = typeof configSnapshotPruneRunsTable.$inferSelect;
export type InsertConfigSnapshotPruneRun = typeof configSnapshotPruneRunsTable.$inferInsert;

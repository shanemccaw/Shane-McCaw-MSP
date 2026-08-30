/**
 * Tenant configuration state — the Graph/M365DSC RESOURCE MODEL (Git #1794).
 *
 * The platform is check-centric: `monitor_checks` + `tenant_monitor_profiles` store
 * the *answer to a question* about a tenant. Microsoft365DSC is state-centric: each
 * resource holds a whole configuration object with its full property set. A check can
 * be derived from a config snapshot; a snapshot can never be derived from checks.
 *
 * These tables are the missing first half of closing that gap: not the snapshots
 * themselves (that is #1795's store), but the MODEL that says what a tenant
 * configuration resource *is* — its properties and their types, the transport that
 * reads it, and the permission that transport requires.
 *
 * Everything here is derived from two PUBLISHED descriptions, never from probing:
 *   - Microsoft Graph's own CSDL `$metadata` (v1.0 and beta) — entity types, their
 *     property sets, and the EntityContainer that yields real addressable paths.
 *   - Microsoft365DSC's resource map — community-maintained open source (MIT,
 *     github.com/Microsoft365DSC/Microsoft365DSC), read for its factual mapping of
 *     configuration object → workload → cmdlet → required app-only permission.
 *
 * Live verification is a deliberately small read-only SAMPLE recorded in
 * `config_resource_samples`; every resource not sampled stays honestly labelled
 * `derived_not_verified`.
 *
 * Timezone convention: all timestamps UTC (withTimezone: true), localized at display.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { monitorChecksTable, tenantsTable, MONITOR_CHECK_EXECUTOR_TYPES } from "./msp";

// ── Vocabularies ─────────────────────────────────────────────────────────────
// Real enums only: each value below is a state something in this model is actually
// in, not a display vocabulary invented to fill a dropdown.

/** CSDL declares exactly these three type kinds. */
export const GRAPH_TYPE_KINDS = ["entityType", "complexType", "enumType"] as const;
export type GraphTypeKind = typeof GRAPH_TYPE_KINDS[number];

/** The Graph versions this platform reads. */
export const GRAPH_VERSIONS = ["v1.0", "beta"] as const;
export type GraphVersion = typeof GRAPH_VERSIONS[number];

/**
 * How a resource is READ. The first five mirror `MONITOR_CHECK_EXECUTOR_TYPES` so the
 * model and the existing monitor catalog stay on one vocabulary; the rest are real
 * transports Microsoft365DSC uses that this platform has no executor for yet — which
 * is itself part of the measured answer to "what can we not collect".
 */
export const CONFIG_READ_TRANSPORTS = [
  "graph",
  "powershell",
  "sharepoint-admin",
  "dns",
  "azure-rm",
  "power-platform",
  "unknown",
] as const;
export type ConfigReadTransport = typeof CONFIG_READ_TRANSPORTS[number];

/**
 * The transports this platform actually has an executor for, derived from
 * `MONITOR_CHECK_EXECUTOR_TYPES` itself rather than restated — so adding a fifth
 * transport to the monitor catalog (as #1869 did with `power-platform`) moves the
 * measurement automatically and the two lists structurally cannot drift apart.
 */
export const EXECUTOR_BACKED_TRANSPORTS: readonly ConfigReadTransport[] =
  MONITOR_CHECK_EXECUTOR_TYPES as readonly ConfigReadTransport[];

/**
 * Whether any code path in this platform could read a resource on this transport
 * at all — regardless of whether anyone has written a check for it yet.
 */
export function transportHasExecutor(transport: string | null | undefined): boolean {
  return Boolean(transport) && (EXECUTOR_BACKED_TRANSPORTS as readonly string[]).includes(transport as string);
}

/**
 * Coverage measurement states (Git #1849 point 3, built in #1869).
 *
 * Before this, the measurement had two states and "no check written yet" was
 * indistinguishable from "no code path could ever read this". That understated
 * the problem: 22 `azure-rm` resources looked like ordinary gaps a check author
 * could close, when in fact no executor exists to dispatch the read at all.
 *
 *  - covered      at least one monitor check reads this resource
 *  - uncovered    an executor exists for its transport, but no check reads it yet
 *                 — a genuine, closeable gap
 *  - no_executor  this platform has NO executor for the resource's transport, so
 *                 the resource is unreachable by any code path and writing a
 *                 check could not change that. Not a check-authoring gap; a
 *                 transport gap.
 */
export const CONFIG_COVERAGE_STATES = ["covered", "uncovered", "no_executor"] as const;
export type ConfigCoverageState = typeof CONFIG_COVERAGE_STATES[number];

/**
 * Classify one resource's coverage. `no_executor` is evaluated FIRST and wins:
 * a resource whose transport has no executor is unreachable whatever its check
 * count says, and reporting it as merely "uncovered" is the exact conflation
 * #1849 asked to end.
 */
export function coverageStateFor(
  transport: string | null | undefined,
  checkCoverageCount: number,
): ConfigCoverageState {
  if (!transportHasExecutor(transport)) return "no_executor";
  return checkCoverageCount > 0 ? "covered" : "uncovered";
}

/** Which part of the tenant's configuration a resource belongs to. */
export const CONFIG_SURFACES = [
  "identity",
  "directory",
  "policy",
  "applications",
  "groups",
  "teams",
  "collaboration",
  "device-management",
  "sharing",
  "exchange",
  "security",
  "compliance",
  "licensing",
  "reporting",
  "integration",
  "copilot",
  "power-platform",
  "azure",
  "tooling",
  "other",
] as const;
export type ConfigSurface = typeof CONFIG_SURFACES[number];

/**
 * Whether THIS platform, with the permissions a tenant has actually granted, can read
 * the resource today. Resolved against the real granted scope list on `tenants.consent`,
 * never assumed.
 *
 *  - available_now            every required app-only permission is already granted
 *  - needs_additional_scope   readable app-only, but a named scope is missing
 *  - needs_license            a real license/SKU gap, only ever set from live evidence
 *  - unavailable              the source states no app-only read path exists
 *  - unknown                  no source states a read permission either way
 */
export const CONFIG_AVAILABILITY = [
  "available_now",
  "needs_additional_scope",
  "needs_license",
  "unavailable",
  "unknown",
] as const;
export type ConfigAvailability = typeof CONFIG_AVAILABILITY[number];

/**
 * Evidence discipline, encoded. `derived_not_verified` is the default and the honest
 * state for anything the live sample did not touch; `not_attempted` records a
 * deliberate skip (with the reason) rather than a silent omission.
 */
export const CONFIG_VERIFICATION_STATUS = [
  "verified_live",
  "derived_not_verified",
  "not_attempted",
  "failed_live",
] as const;
export type ConfigVerificationStatus = typeof CONFIG_VERIFICATION_STATUS[number];

/** Which published source a resource row came from. */
export const CONFIG_RESOURCE_ORIGINS = ["graph-metadata", "m365dsc", "both"] as const;
export type ConfigResourceOrigin = typeof CONFIG_RESOURCE_ORIGINS[number];

/** Where a property definition came from — the two sources describe types differently. */
export const CONFIG_PROPERTY_SOURCES = ["graph-metadata", "m365dsc-mof"] as const;
export type ConfigPropertySource = typeof CONFIG_PROPERTY_SOURCES[number];

/**
 * How a `monitor_checks` row was matched to a resource. Recorded per mapping so a
 * coverage number can always be traced back to the evidence that produced it rather
 * than being taken on trust.
 */
export const CHECK_COVERAGE_MATCH_BASIS = [
  "graph-path-exact",
  "graph-path-prefix",
  "graph-root",
  "ps-cmdlet",
  "sp-operation",
  "dns",
  "unmatched",
] as const;
export type CheckCoverageMatchBasis = typeof CHECK_COVERAGE_MATCH_BASIS[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

// ── Raw Graph entity model (from $metadata) ──────────────────────────────────

/**
 * One row per type declared in a Graph `$metadata` document, per Graph version.
 * Reference data: this is the authoritative shape a config snapshot of a Graph-backed
 * resource has to be able to hold, so #1795's store can type itself against it.
 */
export const graphEntityTypesTable = pgTable("graph_entity_types", {
  id: serial("id").primaryKey(),
  graphVersion: text("graph_version", { enum: GRAPH_VERSIONS }).notNull(),
  namespace: text("namespace").notNull(),
  name: text("name").notNull(),
  /** `microsoft.graph.conditionalAccessPolicy` — namespace-qualified, unique per version. */
  qualifiedName: text("qualified_name").notNull(),
  kind: text("kind", { enum: GRAPH_TYPE_KINDS }).notNull(),
  /** CSDL BaseType reference, still alias-qualified as published (e.g. `graph.entity`). */
  baseType: text("base_type"),
  isAbstract: boolean("is_abstract").notNull().default(false),
  isOpenType: boolean("is_open_type").notNull().default(false),
  /** Names from the type's `<Key>` block. Empty for complex and enum types. */
  keyProperties: jsonb("key_properties").$type<string[]>().notNull().default([]),
  /** Members of an enumType, in declaration order. Empty for entity/complex types. */
  enumMembers: jsonb("enum_members").$type<Array<{ name: string; value: string | null }>>().notNull().default([]),
  /** Declared property count (own properties, excluding inherited). */
  propertyCount: integer("property_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("graph_entity_types_version_qname_uidx").on(t.graphVersion, t.qualifiedName),
  index("graph_entity_types_name_idx").on(t.name),
  index("graph_entity_types_kind_idx").on(t.kind),
]);

export type GraphEntityType = typeof graphEntityTypesTable.$inferSelect;
export type InsertGraphEntityType = typeof graphEntityTypesTable.$inferInsert;

/** One row per declared property or navigation property on a Graph type. */
export const graphEntityPropertiesTable = pgTable("graph_entity_properties", {
  id: serial("id").primaryKey(),
  entityTypeId: integer("entity_type_id").notNull()
    .references(() => graphEntityTypesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** "property" (structural) or "navigationProperty" (a link to another entity). */
  kind: text("kind").notNull(),
  /** EDM type with any `Collection(...)` wrapper removed, e.g. `Edm.String`. */
  edmType: text("edm_type").notNull(),
  isCollection: boolean("is_collection").notNull().default(false),
  isNullable: boolean("is_nullable").notNull().default(true),
  /** Containment navigation — the target is addressable under the parent's own path. */
  containsTarget: boolean("contains_target").notNull().default(false),
  ordinal: integer("ordinal").notNull().default(0),
}, (t) => [
  uniqueIndex("graph_entity_properties_type_kind_name_uidx").on(t.entityTypeId, t.kind, t.name),
  index("graph_entity_properties_type_idx").on(t.entityTypeId),
]);

export type GraphEntityProperty = typeof graphEntityPropertiesTable.$inferSelect;
export type InsertGraphEntityProperty = typeof graphEntityPropertiesTable.$inferInsert;

// ── The resource model ───────────────────────────────────────────────────────

/**
 * THE deliverable of #1794: one row per tenant configuration resource, carrying the
 * four things #1795 needs to build a snapshot store — what it is, what properties it
 * has, how it is read, and what permission reading it requires.
 *
 * A row can be sourced from Graph's metadata, from Microsoft365DSC, or from both when
 * the two were matched (`linkBasis` records HOW they were matched, so a merge is never
 * asserted without stating its evidence).
 */
export const configResourcesTable = pgTable("config_resources", {
  id: serial("id").primaryKey(),
  /** Stable slug, e.g. `graph:v1.0:/policies/conditionalAccessPolicies` or `m365dsc:EXOAcceptedDomain`. */
  resourceKey: text("resource_key").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  surface: text("surface", { enum: CONFIG_SURFACES }).notNull(),
  /** Product workload, e.g. AzureAD / ExchangeOnline / Intune. */
  workload: text("workload").notNull(),
  origin: text("origin", { enum: CONFIG_RESOURCE_ORIGINS }).notNull(),

  // ── Read transport ──────────────────────────────────────────────────────────
  readTransport: text("read_transport", { enum: CONFIG_READ_TRANSPORTS }).notNull(),
  graphVersion: text("graph_version", { enum: GRAPH_VERSIONS }),
  /** Addressable Graph path relative to the version root, e.g. `/policies/authorizationPolicy`. */
  graphPath: text("graph_path"),
  /** True when the path returns a collection rather than a single object. */
  graphIsCollection: boolean("graph_is_collection").notNull().default(false),
  /** entitySet | singleton | navigation | function — how the path is reached. */
  graphContainerKind: text("graph_container_kind"),
  graphEntityTypeId: integer("graph_entity_type_id")
    .references(() => graphEntityTypesTable.id, { onDelete: "set null" }),
  /** Denormalised qualified type name, kept readable without a join. */
  graphEntityType: text("graph_entity_type"),
  /** True when the same path also exists on the other Graph version. */
  alsoInBeta: boolean("also_in_beta").notNull().default(false),
  /** Read cmdlets Microsoft365DSC declares for this resource. */
  readCmdlets: jsonb("read_cmdlets").$type<string[]>().notNull().default([]),

  // ── Microsoft365DSC binding ────────────────────────────────────────────────
  m365dscResource: text("m365dsc_resource"),
  /** DSC "mode": Configuration (tenant settings) or Data (reference/lookup data). */
  m365dscMode: text("m365dsc_mode"),
  /** How a Graph row and a DSC row were matched, or null when the row has one source. */
  linkBasis: text("link_basis"),

  // ── Permissions ────────────────────────────────────────────────────────────
  /** App-only (client-credentials) permissions required to READ. The ones that matter here. */
  requiredAppPermissions: jsonb("required_app_permissions").$type<string[]>().notNull().default([]),
  /** Delegated read permissions, recorded to distinguish "no app-only path" from "no data". */
  requiredDelegatedPermissions: jsonb("required_delegated_permissions").$type<string[]>().notNull().default([]),
  /** Exchange/Purview express requirements as RBAC roles and role groups, not scopes. */
  requiredRoles: jsonb("required_roles").$type<string[]>().notNull().default([]),
  /**
   * ANY-OF app-only permissions that grant a GET on this Graph path, from Microsoft's
   * own published permissions reference. Deliberately a separate column from
   * `requiredAppPermissions`, which is Microsoft365DSC's ALL-OF list: holding ONE of
   * these is enough, whereas a DSC resource needs its whole set. Merging the two
   * would misreport availability in both directions.
   */
  graphReadPermissionOptions: jsonb("graph_read_permission_options").$type<string[]>().notNull().default([]),
  /**
   * When the permission list came from an ANCESTOR path rather than this exact path,
   * the ancestor that supplied it — so an inherited permission is never presented as
   * if Microsoft had documented it for this path directly.
   */
  permissionPathMatched: text("permission_path_matched"),
  /** Which source settled the availability verdict: m365dsc | graph-permissions | none. */
  permissionSource: text("permission_source"),

  // ── Reconciliation against what the testbed has actually granted ───────────
  availability: text("availability", { enum: CONFIG_AVAILABILITY }).notNull().default("unknown"),
  availabilityReason: text("availability_reason"),
  /** Exactly which permissions are missing — named, so the gap is actionable. */
  missingPermissions: jsonb("missing_permissions").$type<string[]>().notNull().default([]),

  // ── Evidence ───────────────────────────────────────────────────────────────
  verificationStatus: text("verification_status", { enum: CONFIG_VERIFICATION_STATUS })
    .notNull().default("derived_not_verified"),
  /** Count of properties held in config_resource_properties, excluding DSC connection params. */
  propertyCount: integer("property_count").notNull().default(0),
  /** Number of monitor_checks rows mapped onto this resource. 0 == entirely uncovered. */
  checkCoverageCount: integer("check_coverage_count").notNull().default(0),
  /** Human-readable provenance, e.g. the DSC resource directory the row was read from. */
  sourceRef: text("source_ref"),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_resources_key_uidx").on(t.resourceKey),
  index("config_resources_surface_idx").on(t.surface),
  index("config_resources_workload_idx").on(t.workload),
  index("config_resources_transport_idx").on(t.readTransport),
  index("config_resources_availability_idx").on(t.availability),
  index("config_resources_graph_path_idx").on(t.graphVersion, t.graphPath),
  index("config_resources_m365dsc_idx").on(t.m365dscResource),
  index("config_resources_coverage_idx").on(t.checkCoverageCount),
]);

export type ConfigResource = typeof configResourcesTable.$inferSelect;
export type InsertConfigResource = typeof configResourcesTable.$inferInsert;

/**
 * The property model — what a snapshot of this resource has to be able to hold.
 *
 * Both sources contribute, and `source` says which, because they use different
 * vocabularies for the same object: Graph names the wire property (`displayName`,
 * `Edm.String`) while Microsoft365DSC names the DSC parameter (`DisplayName`,
 * MOF `String`) and additionally publishes the allowed value set.
 */
export const configResourcePropertiesTable = pgTable("config_resource_properties", {
  id: serial("id").primaryKey(),
  configResourceId: integer("config_resource_id").notNull()
    .references(() => configResourcesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source", { enum: CONFIG_PROPERTY_SOURCES }).notNull(),
  /** As published: an EDM type from Graph, or a MOF type from a DSC schema. */
  dataType: text("data_type").notNull(),
  isCollection: boolean("is_collection").notNull().default(false),
  isKey: boolean("is_key").notNull().default(false),
  isRequired: boolean("is_required").notNull().default(false),
  isNullable: boolean("is_nullable").notNull().default(true),
  /** Real published vocabulary (CSDL enum members, or a MOF ValueMap). Never invented. */
  allowedValues: jsonb("allowed_values").$type<string[]>().notNull().default([]),
  /** Nested type reference: a CSDL complex type, or a DSC EmbeddedInstance class. */
  nestedTypeRef: text("nested_type_ref"),
  /**
   * True for DSC parameters that configure the CONNECTION rather than the tenant
   * (Credential, ApplicationId, TenantId, CertificateThumbprint, Ensure, ...). They
   * appear on nearly every DSC resource and belong in no configuration snapshot.
   */
  isConnectionParameter: boolean("is_connection_parameter").notNull().default(false),
  description: text("description"),
  ordinal: integer("ordinal").notNull().default(0),
}, (t) => [
  uniqueIndex("config_resource_properties_res_source_name_uidx").on(t.configResourceId, t.source, t.name),
  index("config_resource_properties_resource_idx").on(t.configResourceId),
]);

export type ConfigResourceProperty = typeof configResourcePropertiesTable.$inferSelect;
export type InsertConfigResourceProperty = typeof configResourcePropertiesTable.$inferInsert;

/**
 * Which `monitor_checks` rows touch which resource — the measurement behind "are we
 * missing checks", replacing a guess. A resource with no row here is entirely
 * uncovered by the current catalog; a check whose only row is `unmatched` asks a
 * question about a resource the model does not (yet) describe.
 */
export const configResourceCheckCoverageTable = pgTable("config_resource_check_coverage", {
  id: serial("id").primaryKey(),
  configResourceId: integer("config_resource_id")
    .references(() => configResourcesTable.id, { onDelete: "cascade" }),
  monitorCheckId: integer("monitor_check_id").notNull()
    .references(() => monitorChecksTable.id, { onDelete: "cascade" }),
  /** Denormalised `monitor_checks.key`, so coverage reads without a join. */
  checkKey: text("check_key").notNull(),
  executorType: text("executor_type").notNull(),
  matchBasis: text("match_basis", { enum: CHECK_COVERAGE_MATCH_BASIS }).notNull(),
  confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull(),
  /** The normalised endpoint/cmdlet the match was made on — the evidence itself. */
  matchedOn: text("matched_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("config_resource_check_coverage_uidx").on(t.monitorCheckId, t.configResourceId),
  index("config_resource_check_coverage_resource_idx").on(t.configResourceId),
  index("config_resource_check_coverage_basis_idx").on(t.matchBasis),
]);

export type ConfigResourceCheckCoverage = typeof configResourceCheckCoverageTable.$inferSelect;
export type InsertConfigResourceCheckCoverage = typeof configResourceCheckCoverageTable.$inferInsert;

/**
 * Live read-only verification evidence for the representative sample.
 *
 * Deliberately stores SHAPE, never values: `observedPropertyNames` and
 * `observedShape` (property → JSON type) are enough to prove the model matches
 * reality, and keep real tenant data out of the platform database. The testbed is
 * Shane's own production Microsoft 365 tenant.
 */
export const configResourceSamplesTable = pgTable("config_resource_samples", {
  id: serial("id").primaryKey(),
  sampleRunId: uuid("sample_run_id").notNull(),
  configResourceId: integer("config_resource_id").notNull()
    .references(() => configResourcesTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  graphVersion: text("graph_version", { enum: GRAPH_VERSIONS }).notNull(),
  /** The exact path requested, including any $top/$select used to keep the read small. */
  requestPath: text("request_path").notNull(),
  httpStatus: integer("http_status"),
  ok: boolean("ok").notNull().default(false),
  /** Graph's own error code literal, e.g. `Authorization_RequestDenied`. */
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  /** Items returned for a collection read; null for a single object. */
  itemCount: integer("item_count"),
  observedPropertyNames: jsonb("observed_property_names").$type<string[]>().notNull().default([]),
  /** property -> observed JSON type. Types only; no values are ever stored. */
  observedShape: jsonb("observed_shape").$type<Record<string, string>>().notNull().default({}),
  durationMs: integer("duration_ms"),
  /** Why a read was deliberately not attempted, when it was not. */
  skippedReason: text("skipped_reason"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("config_resource_samples_resource_idx").on(t.configResourceId),
  index("config_resource_samples_run_idx").on(t.sampleRunId),
  index("config_resource_samples_tenant_idx").on(t.tenantId),
]);

export type ConfigResourceSample = typeof configResourceSamplesTable.$inferSelect;
export type InsertConfigResourceSample = typeof configResourceSamplesTable.$inferInsert;

/**
 * Provenance for each extraction run: which published sources, at which version, and
 * what came out. Without this the model is a pile of rows nobody can date or re-derive.
 */
export const configModelExtractionsTable = pgTable("config_model_extractions", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().defaultRandom(),
  /** The exact Microsoft365DSC commit the resource map was read from. */
  m365dscCommit: text("m365dsc_commit"),
  m365dscResourceCount: integer("m365dsc_resource_count").notNull().default(0),
  graphV1TypeCount: integer("graph_v1_type_count").notNull().default(0),
  graphBetaTypeCount: integer("graph_beta_type_count").notNull().default(0),
  graphConfigPathCount: integer("graph_config_path_count").notNull().default(0),
  /** Permissions read from Microsoft's published permissions reference. */
  graphPermissionCount: integer("graph_permission_count").notNull().default(0),
  configResourceCount: integer("config_resource_count").notNull().default(0),
  propertyCount: integer("property_count").notNull().default(0),
  checksMapped: integer("checks_mapped").notNull().default(0),
  checksUnmatched: integer("checks_unmatched").notNull().default(0),
  resourcesCovered: integer("resources_covered").notNull().default(0),
  resourcesUncovered: integer("resources_uncovered").notNull().default(0),
  /** Granted app-only scopes the availability reconciliation was resolved against. */
  reconciledAgainstTenantId: integer("reconciled_against_tenant_id")
    .references(() => tenantsTable.id, { onDelete: "set null" }),
  grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("running"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("config_model_extractions_started_idx").on(t.startedAt),
]);

export type ConfigModelExtraction = typeof configModelExtractionsTable.$inferSelect;
export type InsertConfigModelExtraction = typeof configModelExtractionsTable.$inferInsert;

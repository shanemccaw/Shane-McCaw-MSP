/**
 * MSP Platform — Multi-Tenant Foundation Schema
 *
 * Timezone convention: ALL timestamps stored as UTC (withTimezone: true).
 * Localize only at display time in the UI.
 *
 * Ownership model: ownerType on tenant-derived data encodes who owns/generated
 * the finding — never used for access-control (that is mspId + customerId).
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  date,
  integer,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { wfRunsTable, usersTable, scriptPackagesTable, activeDirectoryOusTable, type MspRole } from "./index";

// ── MSPs (Managed Service Provider organisations) ─────────────────────────────

export const MSP_OFFBOARDING_STATES = ["cancellation_requested", "export_ready", "archival_flagged"] as const;
export type MspOffboardingState = typeof MSP_OFFBOARDING_STATES[number];

export const mspsTable = pgTable("msps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  domain: text("domain"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  status: text("status", { enum: ["active", "suspended", "trial"] }).notNull().default("active"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Recorded when status transitions to "suspended". Used to compute the 7-day
  // customer-visible banner threshold. Cleared (set to null) on re-activation.
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  // Offboarding state machine: null → cancellation_requested → export_ready → archival_flagged
  // Never silently deleted — customer owns their data per the hybrid model.
  offboardingState: text("offboarding_state", { enum: MSP_OFFBOARDING_STATES }),
  offboardingRequestedAt: timestamp("offboarding_requested_at", { withTimezone: true }),
  exportReadyAt: timestamp("export_ready_at", { withTimezone: true }),
  // Marks Shane's own MSP row — direct (non-brokered) customers default to this MSP.
  isDirectBusiness: boolean("is_direct_business").notNull().default(false),
  isTestbed: boolean("is_testbed").notNull().default(false),
  testbedMetadata: jsonb("testbed_metadata").notNull().default({}),
  customCustomerAgreement: text("custom_customer_agreement"),
  // Gates any platform-initiated email to a customer_user. Functionally inert
  // (no send occurs) unless the MSP also has an active mspMailboxConnectorsTable row.
  automatedCustomerEmailsEnabled: boolean("automated_customer_emails_enabled").notNull().default(true),
  writeBackEnabled: boolean("write_back_enabled").notNull().default(false),
  // Partner relationship fields (Git #1672) — the designated primary contact
  // at the MSP partner, an office address, and Shane's own internal notes on
  // the account. Editable from the AdminV2 Active Directory MSP canvas.
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMspSchema = createInsertSchema(mspsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Msp = typeof mspsTable.$inferSelect;
export type InsertMsp = typeof mspsTable.$inferInsert;

// ── Tenants (the real Tenant/Customer object — Tenant/User Refactor, #92) ──────
// One row per end-customer M365 tenant. The tenant GUID is first-class,
// required, and unique — never a loose optional string. The three per-resource
// consent records (Graph read / write-back app / SharePoint) fold into the
// single jsonb consent column, keyed by consent type, so future consent types
// need no new tables or columns. The three grants remain independent — one
// key's state proves nothing about another's.

export type TenantConsentRecord = {
  status: "pending" | "granted" | "declined" | "revoked";
  consentedAt?: string | null;
  revokedAt?: string | null;
  adminEmail?: string | null;
  adminDisplayName?: string | null;
  /** Graph/write-back: scopes granted; SharePoint: application permissions granted. */
  grants?: string[];
};

/**
 * The customer's answer to the Compliance Center group-membership question
 * (#432). Read-only Graph consent alone does NOT deliver the full Compliance
 * picture — the consented app registration must additionally be a member of a
 * Compliance Center role group, which is not a read-only action. The buyer
 * picks one of three paths at consent time and that choice is recorded here.
 *
 * Deliberately NOT a TenantConsentRecord: this is not a Microsoft consent grant
 * (no OAuth round-trip of its own, no scope list, no revocation semantics). The
 * `delegate_write` path's actual grant is the independent `writeBack` record;
 * this only records which path the customer chose and, for `self_add`, whether
 * they have told us they finished it.
 */
export type TenantComplianceGroupRecord = {
  /**
   * self_add       — customer adds the app registration to the Compliance
   *                  Center group themselves and confirms back to us.
   * delegate_write — customer consents to the separate write-scoped App
   *                  Registration so we perform the group addition for them.
   * declined       — customer declined both and accepts that the Compliance
   *                  pillar is excluded from (and may skew) their score.
   */
  path: "self_add" | "delegate_write" | "declined";
  /** ISO timestamp of the choice itself. */
  decidedAt: string;
  /** ISO timestamp the customer confirmed they completed the `self_add` work. */
  confirmedAt?: string | null;
};

/**
 * The Power Platform management-app enrolment record (Git #1972). NOT a
 * Microsoft consent grant like the three keys above — no scope list, no
 * OAuth round-trip of ours, no revocation semantics. It records the single
 * fact `POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION` requires: the customer's
 * OWN tenant admin has, once, registered our service principal as a Power
 * Platform management application (device-code onboarding flow — see
 * power-platform-admin.ts). Structurally independent of `graph`/`sharepoint`/
 * `writeBack` for the same reason power-platform-admin.ts's own header
 * states: a Power Platform 403 must never be allowed to imply anything about
 * Graph consent, and vice versa.
 */
export type TenantPowerPlatformEnrollmentRecord = {
  /** ISO timestamp the PUT to adminApplications actually succeeded. */
  enrolledAt: string;
  /** Best-effort UPN of the admin who completed the device-code flow, if readable off their token. */
  enrolledByUpn?: string | null;
  /** The service-principal client id that was registered (MT_APP_CLIENT_ID at the time). */
  clientId: string;
};

export type TenantConsentMap = Partial<
  Record<"graph" | "writeBack" | "sharepoint", TenantConsentRecord>
> & {
  complianceGroup?: TenantComplianceGroupRecord;
  powerPlatformEnrollment?: TenantPowerPlatformEnrollmentRecord;
};

// ── Copilot Assessment per-tenant state (epic #183 / #237) ────────────────────
// Structural mirror of msp-portal's frozen QuizProfile shape (see its types.ts,
// #184) — the wizard's own type stays the contract; this is the storage-side
// echo of it, so lib/db does not import from an app package. Deliberately not
// re-narrowed here (collaboration/workflowStyle/aiComfort are unions in the
// wizard): the route validates on the way in, and a stored row must still
// deserialize if the wizard's unions ever widen.
export type CopilotQuizProfile = {
  role: string;
  department: string;
  company?: string | null;
  phone?: string | null;
  industry: string;
  collaboration: string[];
  sensitivity: string[];
  workflowStyle: string;
  outcomePriorities: string[];
  /** 0-1 workload weights. */
  draftingLoad: number;
  researchLoad: number;
  communicationLoad: number;
  repetitiveLoad: number;
  toolUsage: string[];
  aiComfort: string;
  // Answers the quiz always collected but the wizard used to drop before
  // building the profile (#270). Optional because rows written before #270
  // genuinely have none of these keys — the route normalizes an absent value to
  // empty/null rather than inventing one, so "older profile" stays legible.
  personaClusters?: string[];
  targetPersonas?: string[];
  useCaseClusters?: string[];
  adoptionSpeed?: string | null;
  changeManagement?: string | null;
};

export type CopilotAssessmentQuizRecord = {
  profile: CopilotQuizProfile;
  /** ISO timestamp of the completion this record came from — a retake overwrites. */
  completedAt: string;
  /** users.id of the quiz-taker (the tenant may have several portal users). */
  completedByUserId?: number | null;
};

// Keyed by assessment section, exactly like `consent` above, so the epic's later
// phases (personas / use cases / final report) can persist per-tenant state
// without another column or table.
export type CopilotAssessmentStateMap = Partial<Record<"quiz", CopilotAssessmentQuizRecord>>;

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "restrict" }),
  customerName: text("customer_name").notNull(),
  tenantUrl: text("tenant_url"),
  tenantId: text("tenant_id").notNull().unique(),
  consent: jsonb("consent").$type<TenantConsentMap>().notNull().default({}),
  // Completed Copilot Assessment state (#237). Same single-jsonb-column-keyed-
  // by-section convention as `consent` — a customer who completed the quiz,
  // logged out and came back must not be made to retake all 13 steps.
  copilotAssessment: jsonb("copilot_assessment").$type<CopilotAssessmentStateMap>().notNull().default({}),
  // Restored from the dropped msp_customers table (Phase 0 didn't carry these
  // forward; re-added here in Phase 2a once portal-* consumers turned out to
  // still need them — domain/industry/status/isTestbed have no analogue
  // elsewhere on tenants). status/isTestbed keep the exact old semantics,
  // including isTestbed gating real Graph writes in the config-pack
  // orchestrator — per-tenant, deliberately independent of mspsTable.isTestbed.
  domain: text("domain"),
  industry: text("industry"),
  status: text("status", { enum: ["active", "inactive", "onboarding", "archived"] }).notNull().default("onboarding"),
  isTestbed: boolean("is_testbed").notNull().default(false),
  // The tenant's Stripe Customer (`cus_…`), created once and reused for every
  // charge this direct customer ever makes (#490).
  //
  // Before #490 the Home-page assessment flow was fully anonymous on Stripe's
  // side: `public-assessment-payment.ts` created a bare PaymentIntent with no
  // `customer`, so nothing tied the $5,000 one-time charge to a Stripe object
  // that a later Subscription could hang off. A recurring add-on cannot work
  // that way — a Subscription REQUIRES a customer, and the payment method that
  // funds it has to be attached to that same customer during the one card-entry
  // step the buyer ever sees. This column is that shared identity.
  //
  // Deliberately on `tenants` rather than on `checkout_sessions`: the Stripe
  // customer outlives any single order (a second purchase, a retainer, a
  // renewal) and belongs to the organisation, exactly like `consent` does. Note
  // this is a REAL Stripe id — unrelated to the "customerId" naming used
  // throughout consent.ts / portal routes, which everywhere else in this
  // codebase means `tenants.id`, a local row id.
  stripeCustomerId: text("stripe_customer_id"),
  /**
   * Policy Engine opt-in (#1549) — a per-customer onboarding checkbox, default
   * OFF. Distinct from `standing_policies.is_active` (whether one specific
   * policy has been switched on): this is the tenant-wide kill switch #1549's
   * SETTLED section requires — "the platform does not evaluate or act against
   * tenants that have not opted in." The continuous-evaluation reconciliation
   * loop checks BOTH: a policy only actually evaluates when its own is_active
   * is true AND its OU's tenant has opted in here.
   */
  policyEngineOptIn: boolean("policy_engine_opt_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tenants_msp_id_idx").on(t.mspId),
]);

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Tenant = typeof tenantsTable.$inferSelect;
export type InsertTenant = typeof tenantsTable.$inferInsert;

// ── Tenant add-on entitlements (Git #1173) ─────────────────────────────────────
// Per #1168's rule ("creation unconditional, gate visibility only"), a paid,
// a-la-carte add-on like Change Control needs a real record of WHICH tenant has
// actually purchased it, separate from the MSP's own platform-tier subscription
// (mspSubscriptionsTable / msp-entitlement.ts — a different axis entirely, keyed
// on mspId, not this tenant). Nothing in this codebase tracked that before this
// table: `client_services` is keyed on usersTable.id (the legacy client-portal
// axis), not tenants.id (the portal-v2 axis this table matches).
//
// `featureKey` is a free string rather than an FK to a single services row on
// purpose — the same feature (e.g. "change_control") is sold as 4 differently
// priced bracket SKUs (Micro/SMB/Mid-Market/Enterprise), and the gate only cares
// whether the tenant holds ANY of them, not which bracket. `serviceId` records
// which bracket they actually bought, for billing/support reference only.
export const tenantAddOnEntitlementsTable = pgTable("tenant_add_on_entitlements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  featureKey: text("feature_key").notNull(),
  serviceId: integer("service_id"),
  status: text("status", { enum: ["active", "canceled"] }).notNull().default("active"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("tenant_add_on_entitlements_tenant_feature_uq").on(t.tenantId, t.featureKey),
  index("tenant_add_on_entitlements_tenant_id_idx").on(t.tenantId),
]);

export type TenantAddOnEntitlement = typeof tenantAddOnEntitlementsTable.$inferSelect;
export type InsertTenantAddOnEntitlement = typeof tenantAddOnEntitlementsTable.$inferInsert;

// ── Compliance framework / obligation catalog + per-tenant scope (#1256) ──────
// No table anywhere modelled "which frameworks are in scope for this tenant and
// what state each is in" — msp_risk_decisions.framework/.obligation are free-text
// per-risk citations, not a catalog, and portal-v2-compliance-obligations.tsx
// rendered the register 100% from the CMP_OBLIGATIONS fixture. This is the
// durable catalog + scope model that unblocks #1223's "Obligations We Check
// Against" wiring.
//
// Two-level catalog: a framework (GDPR, SOX, HIPAA, PCI DSS v4.0…) owns one or
// more specific obligations (article/clause citations carrying the requirement
// text). The fixture's GDPR appearing as three rows (Art. 5(1)(e)·32, Art. 15,
// Art. 30) is exactly this framework→obligation shape.
//
// State/tone the drill-down shows are computed LIVE at read time by joining an
// in-scope obligation to the tenant's open findings (sign-off A) — deliberately
// NOT stored here. These tables carry only the durable scope decision + audit.
// DDL lands via lib/db/migrations/manual/2026-08-24-compliance-framework-obligation-catalog-1256.sql.

// The cited-authority types an obligation can carry (Git #1525). A regulation
// (GDPR) and a customer's own cyber-insurance schedule are both "authorities"
// a decision can cite, but they carry materially different consequences when
// deviated from — this is the discriminator that lets the register answer
// "which obligations is this tenant actually subject to" instead of treating
// every citation as the same kind of text.
export const AUTHORITY_TYPES = ["regulation", "certification", "contract", "insurance", "internal_schedule"] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

// Global regime catalog — reference data seeded once, shared across all tenants
// — PLUS, since #1525, MSP/tenant-authored authorities that are not global at
// all (a customer's own insurance schedule or records policy). Global rows
// have `mspId`/`tenantId` both null; a tenant-authored row has both set and is
// visible only to that (mspId, tenantId) pair — it needs no
// `tenant_compliance_scope` row because it cannot apply to any other tenant by
// construction. `tenantId` matches the free-text M365 identifier
// `msp_risk_decisions.tenant_id`/`policy_decisions.tenant_id` already use, not
// `tenants.id` — this row is looked up from the same (mspId, tenantId) pair
// `resolveTenantScope` produces for those tables, not through the Compliance
// module's own `tenants.id`-keyed scoping.
export const complianceFrameworksTable = pgTable("compliance_frameworks", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),          // stable slug, e.g. 'gdpr', 'sox', 'pci-dss-v4'
  name: text("name").notNull(),                 // display, e.g. 'GDPR', 'PCI DSS v4.0'
  authority: text("authority"),                 // 'EU', 'SEC', 'HHS', 'PCI SSC'
  category: text("category"),                   // 'privacy' | 'financial' | 'healthcare' | 'payments'
  /** AUTHORITY_TYPES. Defaults 'regulation' — every pre-#1525 row (GDPR, SOX,
   * HIPAA, PCI DSS, SEC/FINRA) genuinely is one. */
  authorityType: text("authority_type", { enum: AUTHORITY_TYPES }).notNull().default("regulation"),
  description: text("description"),
  defaultInScope: boolean("default_in_scope").notNull().default(false), // onboarding applicability hint
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set together with `tenantId` on a tenant-authored authority (a customer's
   * own insurance schedule or records policy). Null on every global/seeded row. */
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The M365 tenant identifier this authority is authored for. See the block
   * comment above — matches `msp_risk_decisions.tenant_id`'s free-text
   * convention, not `tenants.id`. Null on every global/seeded row. */
  tenantId: text("tenant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("compliance_frameworks_msp_tenant_idx").on(t.mspId, t.tenantId),
]);

export const insertComplianceFrameworkSchema = createInsertSchema(complianceFrameworksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ComplianceFramework = typeof complianceFrameworksTable.$inferSelect;
export type InsertComplianceFramework = typeof complianceFrameworksTable.$inferInsert;

// A specific obligation/clause within a framework — the "Obligations We Check
// Against" master list. Global catalog, FK → framework.
export const complianceObligationsTable = pgTable("compliance_obligations", {
  id: serial("id").primaryKey(),
  frameworkId: integer("framework_id").notNull().references(() => complianceFrameworksTable.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),          // 'gdpr-art-5-1-e', 'sox-802'
  citation: text("citation").notNull(),         // 'GDPR Art. 5(1)(e) · Art. 32'
  requires: text("requires").notNull(),         // the requirement text
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("compliance_obligations_framework_id_idx").on(t.frameworkId),
]);

export const insertComplianceObligationSchema = createInsertSchema(complianceObligationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ComplianceObligation = typeof complianceObligationsTable.$inferSelect;
export type InsertComplianceObligation = typeof complianceObligationsTable.$inferInsert;

// Per-tenant scope decision (which frameworks apply + audit). One row per
// (tenant, framework). Scope is framework-level for v1; obligations inherit.
export const tenantComplianceScopeTable = pgTable("tenant_compliance_scope", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  frameworkId: integer("framework_id").notNull().references(() => complianceFrameworksTable.id, { onDelete: "cascade" }),
  inScope: boolean("in_scope").notNull(),
  scopeReason: text("scope_reason"),            // 'Marked out of scope in onboarding — no cardholder data'
  source: text("source", { enum: ["onboarding", "manual", "advisor"] }).notNull().default("onboarding"),
  decidedBy: text("decided_by"),                // who set it
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("tenant_compliance_scope_tenant_framework_uq").on(t.tenantId, t.frameworkId),
  index("tenant_compliance_scope_tenant_id_idx").on(t.tenantId),
]);

export const insertTenantComplianceScopeSchema = createInsertSchema(tenantComplianceScopeTable).omit({ id: true, createdAt: true, updatedAt: true });
export type TenantComplianceScope = typeof tenantComplianceScopeTable.$inferSelect;
export type InsertTenantComplianceScope = typeof tenantComplianceScopeTable.$inferInsert;

// ── Copilot Assessment quiz catalog (#271, epic #183) ─────────────────────────
// The four adaptive quiz catalogs — persona clusters, personas, use cases and
// outcomes — moved out of msp-portal's hardcoded quizCatalog.ts and into real
// rows Shane populates directly by SQL. The hardcoded catalogs were 4 entries
// per industry at every level and industry-scoped only; these tables carry no
// depth ceiling and make outcomes persona-scoped.
//
// Shape deliberately mirrors the filter-tag pattern the hardcoded catalogs
// already used (a persona carries its cluster's key, a use case carries its
// persona's key) rather than introducing FK ids between the levels. That is
// what lets the wizard keep doing its filtering in memory over one fetch, so
// selecting a cluster still narrows personas without a round trip — and it is
// what makes Shane's own INSERTs writable by hand, since a row references its
// parent by the same human-readable key he is already typing.
//
// personaKey sentinel: quiz_use_cases and quiz_outcomes both scope to a
// persona. A row whose personaKey is "*" applies to EVERY persona in its
// industry — the honest encoding for content that genuinely has no persona
// linkage yet, which is exactly what the migrated outcomes are (they were
// industry-scoped before this issue). The read route maps "*" back to "no
// linkage", so such a row renders under any persona selection, identical to
// pre-#271 behaviour. Real persona-specific rows simply use the real key.
export const QUIZ_CATALOG_ALL_PERSONAS = "*" as const;

export const quizPersonaClustersTable = pgTable("quiz_persona_clusters", {
  id: serial("id").primaryKey(),
  // INDUSTRY_OPTIONS ids ("space", "healthcare", ...) plus the literal
  // "default", which the read route falls back to for an industry with no rows
  // of its own — the same `|| ADAPTIVE_X['default']` fallback the wizard did.
  industry: text("industry").notNull(),
  clusterKey: text("cluster_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  iconName: text("icon_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("quiz_persona_clusters_industry_key_uq").on(t.industry, t.clusterKey),
  index("quiz_persona_clusters_industry_idx").on(t.industry),
]);

export const quizPersonasTable = pgTable("quiz_personas", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull(),
  /** quiz_persona_clusters.cluster_key within the same industry. */
  clusterKey: text("cluster_key").notNull(),
  personaKey: text("persona_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  iconName: text("icon_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Unique on (industry, persona_key) — NOT on the cluster too: a persona key
  // is the answer value the wizard stores and every downstream lookup resolves,
  // so the same key appearing under two clusters would make that lookup
  // ambiguous. One persona belongs to exactly one cluster.
  unique("quiz_personas_industry_key_uq").on(t.industry, t.personaKey),
  index("quiz_personas_industry_cluster_idx").on(t.industry, t.clusterKey),
]);

export const quizUseCasesTable = pgTable("quiz_use_cases", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull(),
  /** quiz_personas.persona_key, or QUIZ_CATALOG_ALL_PERSONAS for industry-wide. */
  personaKey: text("persona_key").notNull(),
  useCaseKey: text("use_case_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  iconName: text("icon_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Persona is part of the key here (unlike personas above): the same use case
  // can legitimately belong to two personas, and the wizard dedupes by key when
  // several selected personas surface it.
  unique("quiz_use_cases_industry_persona_key_uq").on(t.industry, t.personaKey, t.useCaseKey),
  index("quiz_use_cases_industry_persona_idx").on(t.industry, t.personaKey),
]);

export const quizOutcomesTable = pgTable("quiz_outcomes", {
  id: serial("id").primaryKey(),
  industry: text("industry").notNull(),
  /** quiz_personas.persona_key, or QUIZ_CATALOG_ALL_PERSONAS for industry-wide. */
  personaKey: text("persona_key").notNull(),
  outcomeKey: text("outcome_key").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  iconName: text("icon_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("quiz_outcomes_industry_persona_key_uq").on(t.industry, t.personaKey, t.outcomeKey),
  index("quiz_outcomes_industry_persona_idx").on(t.industry, t.personaKey),
]);

export type QuizPersonaCluster = typeof quizPersonaClustersTable.$inferSelect;
export type InsertQuizPersonaCluster = typeof quizPersonaClustersTable.$inferInsert;
export type QuizPersona = typeof quizPersonasTable.$inferSelect;
export type InsertQuizPersona = typeof quizPersonasTable.$inferInsert;
export type QuizUseCase = typeof quizUseCasesTable.$inferSelect;
export type InsertQuizUseCase = typeof quizUseCasesTable.$inferInsert;
export type QuizOutcome = typeof quizOutcomesTable.$inferSelect;
export type InsertQuizOutcome = typeof quizOutcomesTable.$inferInsert;

export const tenantEngineOverridesTable = pgTable("tenant_engine_overrides", {
  id: serial("id").primaryKey(),
  // tenants.id of the testbed customer — successor id-space after Phase 0
  // absorbed msp_customers. FK dropped with that table and deliberately not
  // recreated. Live: read by graph.ts, simulator-events.ts and admin-engines.ts.
  testbedCustomerId: integer("testbed_customer_id").notNull(),
  runId: text("run_id"),
  graphEndpoint: text("graph_endpoint").notNull(),
  fieldPath: text("field_path").notNull(),
  injectedValue: jsonb("injected_value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantEngineOverrideSchema = createInsertSchema(tenantEngineOverridesTable).omit({ id: true, createdAt: true });
export type TenantEngineOverride = typeof tenantEngineOverridesTable.$inferSelect;
export type InsertTenantEngineOverride = typeof tenantEngineOverridesTable.$inferInsert;

// ── MSP User Role Hierarchy ────────────────────────────────────────────────────
// The role enum (MSP_ROLES/MspRole) and the single users table that carries it
// live in ./index (Tenant/User Refactor Phase 0 absorbed msp_users into users).
// MSP_ROLES is defined next to usersTable because its enum use there is eager —
// defining it here would TDZ-crash under the msp.ts ↔ index.ts circular import.

// ── MSP Staff Customer Scopes (per-staff-member tenant-access restriction) ──────
//
// Additive, opt-in restriction of which customers a specific MSP staff member
// (MSPAdmin / MSPOperator) may access. By default an MSP staff member has NO
// rows here, which means UNRESTRICTED access to every customer in their MSP —
// the historical, unchanged behavior. Once one or more rows exist for a staff
// user, that user is restricted to EXACTLY that set of customers (e.g. a junior
// technician assigned to only their book of clients).
//
// Enforcement is centralized in assertCustomerAccess() (the single source of
// truth for customer ownership) and in cross-customer list/aggregate routes,
// which narrow their results to the staff member's assigned set when scoped.
//
// staffUserId is a users.id (matches req.user.id / the :userId route param and
// the JWT claim used at every enforcement site). customerId is an
// msp_customers.id (the customer organisation). mspId is denormalized from the
// staff member's MSP for fast per-MSP indexing and a defense-in-depth fence
// (a scope row can only ever grant a customer within the same MSP).
//
// customerId is a tenants.id since Phase 0 absorbed msp_customers (the comment
// above predates that). It is load-bearing for authorization — requireAuth.ts
// reads it to narrow a scoped staff member's access — so it must not be dropped.

export const mspStaffCustomerScopesTable = pgTable("msp_staff_customer_scopes", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  staffUserId: integer("staff_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_staff_customer_scopes_staff_customer_uniq").on(t.staffUserId, t.customerId),
  index("msp_staff_customer_scopes_staff_user_id_idx").on(t.staffUserId),
  index("msp_staff_customer_scopes_customer_id_idx").on(t.customerId),
  index("msp_staff_customer_scopes_msp_id_idx").on(t.mspId),
]);

export const insertMspStaffCustomerScopeSchema = createInsertSchema(mspStaffCustomerScopesTable).omit({ id: true, createdAt: true });
export type MspStaffCustomerScope = typeof mspStaffCustomerScopesTable.$inferSelect;
export type InsertMspStaffCustomerScope = typeof mspStaffCustomerScopesTable.$inferInsert;

// ── Service Accounts (API keys for machine-to-machine) ────────────────────────

export const mspServiceAccountsTable = pgTable("msp_service_accounts", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_service_accounts_msp_id_idx").on(t.mspId),
]);

export type MspServiceAccount = typeof mspServiceAccountsTable.$inferSelect;
export type InsertMspServiceAccount = typeof mspServiceAccountsTable.$inferInsert;

// ── MSP Invites ───────────────────────────────────────────────────────────────
// MSPAdmins invite employees via email. Each invite is a one-time token that
// expires after 72 hours. On acceptance a users + msp_users row is created/linked.

export const mspInvitesTable = pgTable("msp_invites", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  mspRole: text("msp_role", { enum: ["MSPAdmin", "MSPOperator"] }).notNull().default("MSPOperator"),
  invitedByUserId: integer("invited_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_invites_msp_id_idx").on(t.mspId),
  index("msp_invites_expires_at_idx").on(t.expiresAt),
]);

export type MspInvite = typeof mspInvitesTable.$inferSelect;
export type InsertMspInvite = typeof mspInvitesTable.$inferInsert;

// ── Sliding Refresh Tokens ────────────────────────────────────────────────────
// Stored so we can rotate (slide) the 7-day window and revoke individual sessions.

export const mspRefreshTokensTable = pgTable("msp_refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedByHash: text("replaced_by_hash"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
}, (t) => [
  index("msp_refresh_tokens_user_id_idx").on(t.userId),
]);

export type MspRefreshToken = typeof mspRefreshTokensTable.$inferSelect;
export type InsertMspRefreshToken = typeof mspRefreshTokensTable.$inferInsert;

// ── User Sessions (self-service device list + login history) ─────────────────
// One row per logical login (password, MFA-completed, or impersonation
// exchange) — distinct from msp_refresh_tokens above, which tracks the raw
// rotating token chain. Refresh-token rotation updates currentTokenHash on
// the SAME row (see session-tracking.ts in api-server) so lastActiveAt
// reflects the real session lifetime instead of each individual rotation.
// Impersonation sessions carry no token (they use a short-lived, non-refreshable
// JWT) so currentTokenHash stays null for those rows.

export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionType: text("session_type", { enum: ["standard", "impersonation"] }).notNull().default("standard"),
  loginMethod: text("login_method", { enum: ["password", "totp", "sms", "passkey", "impersonation", "bypass"] }).notNull(),
  currentTokenHash: text("current_token_hash"),
  impersonatedByUserId: integer("impersonated_by_user_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  index("user_sessions_user_id_idx").on(t.userId),
  index("user_sessions_current_token_hash_idx").on(t.currentTokenHash),
  index("user_sessions_created_at_idx").on(t.createdAt),
]);

export type UserSession = typeof userSessionsTable.$inferSelect;
export type InsertUserSession = typeof userSessionsTable.$inferInsert;

// ── Canonical Event Store (append-only) ───────────────────────────────────────

export interface CanonicalEventMeta {
  tenant: {
    mspId: number | null;
    customerId: number | null;
  };
  [key: string]: unknown;
}

export interface CanonicalEventActor {
  id: number | string;
  role: MspRole | "system";
  type: "user" | "service_account" | "system";
  /**
   * Present only during impersonation sessions.
   * Identifies the MSP the actor is operating on behalf of so audit trails can
   * distinguish "PlatformAdmin acting as MSP X" from a direct MSP X action.
   * Also used as the canonical billing-attribution target for AI cost accounting.
   */
  actingAs?: number;
}

export const mspEventStoreTable = pgTable("msp_event_store", {
  id: serial("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().defaultRandom(),
  eventType: text("event_type").notNull(),
  eventVersion: text("event_version").notNull().default("1.0"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  correlationId: uuid("correlation_id"),
  causationId: uuid("causation_id"),
  actor: jsonb("actor").$type<CanonicalEventActor>().notNull(),
  source: text("source").notNull(),
  meta: jsonb("meta").$type<CanonicalEventMeta>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  ownerType: text("owner_type", { enum: ["customer", "msp", "platform"] }).notNull().default("platform"),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
}, (t) => [
  index("msp_event_store_event_type_idx").on(t.eventType),
  index("msp_event_store_occurred_at_idx").on(t.occurredAt),
  index("msp_event_store_correlation_id_idx").on(t.correlationId),
  index("msp_event_store_msp_id_idx").on(t.mspId),
]);

export type MspEventStoreRow = typeof mspEventStoreTable.$inferSelect;
export type InsertMspEventStoreRow = typeof mspEventStoreTable.$inferInsert;

// ── Idempotency Store ─────────────────────────────────────────────────────────
// Deduplicates mutating API calls. Key = caller-supplied idempotency key (e.g. UUID).
// Response is cached for TTL; same key within TTL returns cached response.

export const mspIdempotencyStoreTable = pgTable("msp_idempotency_store", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  mspId: integer("msp_id"),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull().default({}),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("msp_idempotency_key_msp_idx").on(t.idempotencyKey, t.mspId),
  index("msp_idempotency_expires_at_idx").on(t.expiresAt),
]);

export type MspIdempotencyStoreRow = typeof mspIdempotencyStoreTable.$inferSelect;
export type InsertMspIdempotencyStoreRow = typeof mspIdempotencyStoreTable.$inferInsert;

// ── Dead Letter Queue (DLQ) Store ─────────────────────────────────────────────
// Holds failed events/messages for inspection and replay.

export const mspDlqStoreTable = pgTable("msp_dlq_store", {
  id: serial("id").primaryKey(),
  dlqId: uuid("dlq_id").notNull().unique().defaultRandom(),
  sourceEventId: uuid("source_event_id"),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  errorMessage: text("error_message").notNull(),
  errorStack: text("error_stack"),
  attemptCount: integer("attempt_count").notNull().default(1),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution", { enum: ["replayed", "discarded", "manual"] }),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_dlq_store_event_type_idx").on(t.eventType),
  index("msp_dlq_store_msp_id_idx").on(t.mspId),
]);

export type MspDlqStoreRow = typeof mspDlqStoreTable.$inferSelect;
export type InsertMspDlqStoreRow = typeof mspDlqStoreTable.$inferInsert;

// ── MSP SharePoint Connectors ──────────────────────────────────────────────────
// Stores MSP-owned App Registration credentials for the msp_owned connector mode.
// Platform mode uses env-level GRAPH_* secrets — no row needed.
// clientSecretRef: Key Vault secret name. For dev, clientSecretPlain (never committed).

export const MSP_SHAREPOINT_CONNECTOR_MODES = ["platform", "msp_owned"] as const;
export type MspSharepointConnectorMode = typeof MSP_SHAREPOINT_CONNECTOR_MODES[number];

export const mspSharepointConnectorsTable = pgTable("msp_sharepoint_connectors", {
  id: serial("id").primaryKey(),
  connectorId: uuid("connector_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // MSP's Azure AD tenant — required for msp_owned mode
  tenantId: text("tenant_id").notNull(),
  // App Registration client ID (msp_owned mode)
  clientId: text("client_id").notNull(),
  // Key Vault secret name where the client secret is stored. Null = use clientSecretPlain.
  clientSecretRef: text("client_secret_ref"),
  // Plaintext client secret for dev/test. MUST NOT be used in production.
  clientSecretPlain: text("client_secret_plain"),
  // MSP's SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/msp-docs)
  sharepointSiteUrl: text("sharepoint_site_url"),
  sharepointSiteId: text("sharepoint_site_id"),
  // Default folder under which documents are stored
  defaultFolderPath: text("default_folder_path").default("Documents"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sharepoint_connectors_msp_id_idx").on(t.mspId),
]);

export type MspSharepointConnector = typeof mspSharepointConnectorsTable.$inferSelect;
export type InsertMspSharepointConnector = typeof mspSharepointConnectorsTable.$inferInsert;

// ── Document Pipeline Status ───────────────────────────────────────────────────

export const DOC_PIPELINE_STATUSES = [
  "pending",
  "html_stored",
  "pdf_generating",
  "pdf_ready",
  "sharepoint_uploading",
  "sharepoint_uploaded",
  "version_registered",
  "published",
  "failed",
] as const;
export type DocPipelineStatus = typeof DOC_PIPELINE_STATUSES[number];

// ── MSP Documents ──────────────────────────────────────────────────────────────

export const mspDocumentsTable = pgTable("msp_documents", {
  id: serial("id").primaryKey(),
  documentId: uuid("document_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  ownerType: text("owner_type", { enum: ["customer", "msp", "platform"] }).notNull().default("msp"),
  title: text("title").notNull(),
  documentType: text("document_type").notNull().default("general"),
  status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
  currentVersionId: uuid("current_version_id"),
  createdByUserId: integer("created_by_user_id").notNull(),
  // Pipeline lifecycle tracking
  pipelineStatus: text("pipeline_status", { enum: DOC_PIPELINE_STATUSES }).default("pending"),
  pipelineRunId: uuid("pipeline_run_id"),
  // SharePoint connector mode for this document
  connectorMode: text("connector_mode", { enum: MSP_SHAREPOINT_CONNECTOR_MODES }).notNull().default("platform"),
  connectorId: uuid("connector_id"),
  // Publication tracking
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedByUserId: integer("published_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_documents_msp_id_idx").on(t.mspId),
  index("msp_documents_customer_id_idx").on(t.customerId),
  index("msp_documents_pipeline_status_idx").on(t.pipelineStatus),
]);

export type MspDocument = typeof mspDocumentsTable.$inferSelect;
export type InsertMspDocument = typeof mspDocumentsTable.$inferInsert;

// ── MSP Document Versions ──────────────────────────────────────────────────────

export const mspDocumentVersionsTable = pgTable("msp_document_versions", {
  id: serial("id").primaryKey(),
  versionId: uuid("version_id").notNull().unique().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => mspDocumentsTable.documentId, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  // HTML canonical source
  content: text("content"),
  contentHash: text("content_hash"),
  // PDF artifact
  storageKey: text("storage_key"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  pdfSizeBytes: integer("pdf_size_bytes"),
  // SharePoint upload result
  sharepointFileId: text("sharepoint_file_id"),
  sharepointFileUrl: text("sharepoint_file_url"),
  // Per-version pipeline status
  pipelineStatus: text("pipeline_status", { enum: DOC_PIPELINE_STATUSES }).default("pending"),
  authorUserId: integer("author_user_id").notNull(),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_document_versions_document_id_idx").on(t.documentId),
  uniqueIndex("msp_document_versions_doc_version_idx").on(t.documentId, t.versionNumber),
  index("msp_document_versions_sharepoint_file_id_idx").on(t.sharepointFileId),
]);

export type MspDocumentVersion = typeof mspDocumentVersionsTable.$inferSelect;
export type InsertMspDocumentVersion = typeof mspDocumentVersionsTable.$inferInsert;

// ── MSP Audit Logs ─────────────────────────────────────────────────────────────
// Extended audit log for all privileged/auth actions in the MSP platform.
// UTC only — no local timestamps.

export const mspAuditLogsTable = pgTable("msp_audit_logs", {
  id: serial("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().defaultRandom(),
  actorUserId: integer("actor_user_id"),
  actorServiceAccountId: integer("actor_service_account_id"),
  actorRole: text("actor_role"),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  actionType: text("action_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  entityLabel: text("entity_label"),
  correlationId: uuid("correlation_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  outcome: text("outcome", { enum: ["success", "failure", "partial"] }).notNull().default("success"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_audit_logs_msp_id_idx").on(t.mspId),
  index("msp_audit_logs_actor_user_id_idx").on(t.actorUserId),
  index("msp_audit_logs_occurred_at_idx").on(t.occurredAt),
]);

export type MspAuditLog = typeof mspAuditLogsTable.$inferSelect;
export type InsertMspAuditLog = typeof mspAuditLogsTable.$inferInsert;

// ── Fulfillment Queue ──────────────────────────────────────────────────────────
// Single cross-MSP worklist aggregating everything sold that requires delivery:
// accepted offers, signed SOWs, and new bundle assignments.

export const FULFILLMENT_DELIVERY_STATUSES = ["not_started", "in_progress", "delivered", "blocked"] as const;
export type FulfillmentDeliveryStatus = typeof FULFILLMENT_DELIVERY_STATUSES[number];

export const FULFILLMENT_SOURCE_TYPES = ["offer", "sow", "bundle"] as const;
export type FulfillmentSourceType = typeof FULFILLMENT_SOURCE_TYPES[number];

export const fulfillmentQueueTable = pgTable("fulfillment_queue", {
  id: serial("id").primaryKey(),

  // ── Purchase path that generated this entry ─────────────────────────────────
  sourceType: text("source_type", { enum: FULFILLMENT_SOURCE_TYPES }).notNull(),
  sourceId: text("source_id").notNull(),            // invoice.id, presentation.id, or client_service.id (as string)

  // ── Client context ──────────────────────────────────────────────────────────
  clientUserId: integer("client_user_id"),
  clientName: text("client_name"),
  clientEmail: text("client_email"),

  // ── MSP context ─────────────────────────────────────────────────────────────
  // Stored as plain integers (denormalized) so the queue functions independently
  // of whether the MSP base tables have been provisioned in this environment.
  mspId: integer("msp_id"),
  mspName: text("msp_name"),
  customerId: integer("customer_id"),
  customerName: text("customer_name"),

  // ── What was purchased ──────────────────────────────────────────────────────
  itemTitle: text("item_title").notNull(),
  itemDescription: text("item_description"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  purchaseAmountCents: integer("purchase_amount_cents"),
  wholesaleChargedCents: integer("wholesale_charged_cents"),
  customerQuoteCents: integer("customer_quote_cents"),

  // ── Delivery status ─────────────────────────────────────────────────────────
  deliveryStatus: text("delivery_status", { enum: FULFILLMENT_DELIVERY_STATUSES })
    .notNull()
    .default("not_started"),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
  statusUpdatedByUserId: integer("status_updated_by_user_id"),
  statusNote: text("status_note"),

  // ── Deep-link targets ───────────────────────────────────────────────────────
  projectId: integer("project_id"),
  presentationId: integer("presentation_id"),
  invoiceId: integer("invoice_id"),

  // ── Internal SLA tracking ───────────────────────────────────────────────────
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  slaThresholdDays: integer("sla_threshold_days"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fulfillment_queue_source_idx").on(t.sourceType, t.sourceId),
  index("fulfillment_queue_status_idx").on(t.deliveryStatus),
  index("fulfillment_queue_msp_id_idx").on(t.mspId),
  index("fulfillment_queue_sla_due_at_idx").on(t.slaDueAt),
  uniqueIndex("fulfillment_queue_source_unique_idx").on(t.sourceType, t.sourceId),
]);

export type FulfillmentQueueRow = typeof fulfillmentQueueTable.$inferSelect;
export type InsertFulfillmentQueueRow = typeof fulfillmentQueueTable.$inferInsert;

// ── Fulfillment SLA Configuration ─────────────────────────────────────────────
// Operator-configurable per-source-type SLA thresholds. A missing row means the
// global default (key = "default") applies.

export const fulfillmentSlaConfigTable = pgTable("fulfillment_sla_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),              // "default" | "offer" | "sow" | "bundle"
  label: text("label").notNull(),
  thresholdDays: integer("threshold_days").notNull().default(7),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
});

export type FulfillmentSlaConfig = typeof fulfillmentSlaConfigTable.$inferSelect;
export type InsertFulfillmentSlaConfig = typeof fulfillmentSlaConfigTable.$inferInsert;

// ── Tenant Consent ─────────────────────────────────────────────────────────────
// The three per-resource consent tables (tenant_consent, tenant_write_consent,
// tenant_sharepoint_consent) were retired by Tenant/User Refactor Phase 0 —
// consent now lives in tenantsTable.consent (jsonb keyed graph / writeBack /
// sharepoint). The three grants remain independent per-resource states; only
// the storage shape changed.

// ── Consent Invite Tokens ──────────────────────────────────────────────────────
// Single-use expiring tokens that wrap the admin-consent redirect URL.
// One token is created per onboarding invite; it is burned on first use or on expiry.

export const consentInviteTokensTable = pgTable("consent_invite_tokens", {
  token: text("token").primaryKey(),
  tenantId: text("tenant_id"),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  clientUserId: integer("client_user_id"),
  // Admin "add client" invites (#103): the email/name the admin specified for
  // a client with NO users row yet — consent-first means no account can exist
  // before M365 consent, so the invite itself must carry the identity. The
  // consent callback provisions the account (provisionProspectAccount) with
  // these once the tenant admin approves.
  invitedEmail: text("invited_email"),
  invitedName: text("invited_name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("consent_invite_tokens_expires_at_idx").on(t.expiresAt),
  index("consent_invite_tokens_customer_id_idx").on(t.customerId),
]);

export type ConsentInviteToken = typeof consentInviteTokensTable.$inferSelect;
export type InsertConsentInviteToken = typeof consentInviteTokensTable.$inferInsert;

// ── Background Job Queue ───────────────────────────────────────────────────────
// Persistent queue for long-running tasks (provisioning, report generation, etc.)
// Workers poll this table, lock a row with SELECT … FOR UPDATE SKIP LOCKED,
// execute the handler, then update status to 'completed' or 'failed'.
// Failed jobs are retried up to maxAttempts before being moved to msp_dlq_store.

export const MSP_JOB_STATUS = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type MspJobStatus = typeof MSP_JOB_STATUS[number];

export const mspJobQueueTable = pgTable("msp_job_queue", {
  id: serial("id").primaryKey(),
  jobId: uuid("job_id").notNull().unique().defaultRandom(),
  jobType: text("job_type").notNull(),
  status: text("status", { enum: MSP_JOB_STATUS }).notNull().default("pending"),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  errorStack: text("error_stack"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  correlationId: uuid("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_job_queue_status_scheduled_idx").on(t.status, t.scheduledAt),
  index("msp_job_queue_job_type_idx").on(t.jobType),
  index("msp_job_queue_msp_id_idx").on(t.mspId),
  index("msp_job_queue_correlation_id_idx").on(t.correlationId),
]);

export type MspJobQueueRow = typeof mspJobQueueTable.$inferSelect;
export type InsertMspJobQueueRow = typeof mspJobQueueTable.$inferInsert;

// ── Outbound Webhooks ──────────────────────────────────────────────────────────
// Customer- and MSP-level webhook registrations. Each registration holds a URL,
// a plaintext HMAC-SHA256 secret (used to sign outgoing payloads), and the set
// of event types the owner wants to receive.

export const outboundWebhooksTable = pgTable("outbound_webhooks", {
  id: serial("id").primaryKey(),
  webhookId: uuid("webhook_id").notNull().unique().defaultRandom(),
  ownerType: text("owner_type", { enum: ["msp", "customer", "platform"] }).notNull(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  label: text("label").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  secretPrefix: text("secret_prefix").notNull(),
  eventTypes: jsonb("event_types").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("outbound_webhooks_msp_id_idx").on(t.mspId),
  index("outbound_webhooks_customer_id_idx").on(t.customerId),
]);

export type OutboundWebhook = typeof outboundWebhooksTable.$inferSelect;
export type InsertOutboundWebhook = typeof outboundWebhooksTable.$inferInsert;

// ── Outbound Webhook Deliveries ────────────────────────────────────────────────
// Delivery log for outbound webhook dispatch. Each row records one HTTP attempt.
// Multiple rows per event possible (retries).

export const outboundWebhookDeliveriesTable = pgTable("outbound_webhook_deliveries", {
  id: serial("id").primaryKey(),
  deliveryId: uuid("delivery_id").notNull().unique().defaultRandom(),
  webhookId: uuid("webhook_id").notNull().references(() => outboundWebhooksTable.webhookId, { onDelete: "cascade" }),
  eventId: uuid("event_id"),
  eventType: text("event_type").notNull(),
  attempt: integer("attempt").notNull().default(1),
  status: text("status", { enum: ["pending", "success", "failed", "retrying"] }).notNull().default("pending"),
  statusCode: integer("status_code"),
  responseSnippet: text("response_snippet"),
  requestBodySnapshot: jsonb("request_body_snapshot").$type<Record<string, unknown>>(),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("outbound_webhook_deliveries_webhook_id_idx").on(t.webhookId),
  index("outbound_webhook_deliveries_event_id_idx").on(t.eventId),
  index("outbound_webhook_deliveries_created_at_idx").on(t.createdAt),
]);

export type OutboundWebhookDelivery = typeof outboundWebhookDeliveriesTable.$inferSelect;
export type InsertOutboundWebhookDelivery = typeof outboundWebhookDeliveriesTable.$inferInsert;

// ── MSP Onboarding Links ────────────────────────────────────────────────────────
// Single-use expiring links generated by an MSP operator to onboard a new customer.
// The customer opens the link on the public marketing site, reviews the selected
// service, completes App Reg consent (async), and then proceeds to Stripe checkout.
// The website is responsible for acquisition + handoff only; everything after is Portal.

export const mspOnboardingLinksTable = pgTable("msp_onboarding_links", {
  token: text("token").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // The customer's email address (pre-filled in the checkout form, not yet a user account)
  customerEmail: text("customer_email").notNull(),
  // Optional pre-selected service (from the public catalog)
  serviceId: integer("service_id"),
  // Free-text note from the MSP operator to the customer (shown on the landing page)
  note: text("note"),
  // After the customer completes checkout, which Portal URL they land on
  redirectPortalUrl: text("redirect_portal_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_onboarding_links_msp_id_idx").on(t.mspId),
  index("msp_onboarding_links_expires_at_idx").on(t.expiresAt),
]);

export type MspOnboardingLink = typeof mspOnboardingLinksTable.$inferSelect;
export type InsertMspOnboardingLink = typeof mspOnboardingLinksTable.$inferInsert;

// ── Platform Agreements (MSA + DPA versioning) ────────────────────────────────
// Shane pastes the agreement text here; publishing a new version does NOT
// invalidate prior MSPs' recorded acceptances — each acceptance records the
// exact version that was live at the time.

export const platformAgreementsTable = pgTable("platform_agreements", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  title: text("title").notNull().default("Platform MSA + DPA"),
  body: text("body").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedByUserId: integer("published_by_user_id"),
  isCurrentVersion: boolean("is_current_version").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("platform_agreements_is_current_idx").on(t.isCurrentVersion),
]);

export type PlatformAgreement = typeof platformAgreementsTable.$inferSelect;
export type InsertPlatformAgreement = typeof platformAgreementsTable.$inferInsert;

// ── MSP Agreement Acceptances (clickwrap records) ─────────────────────────────
// One row per MSP signup. A missing row means the MSP has NOT yet accepted.
// Never deleted — audit trail of who accepted what version and when.

export const mspAgreementAcceptancesTable = pgTable("msp_agreement_acceptances", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "restrict" }),
  userId: integer("user_id").notNull(),
  agreementVersion: text("agreement_version").notNull(),
  agreementId: integer("agreement_id"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  checkboxConfirmed: boolean("checkbox_confirmed").notNull().default(true),
}, (t) => [
  index("msp_agreement_acceptances_msp_id_idx").on(t.mspId),
  index("msp_agreement_acceptances_user_id_idx").on(t.userId),
]);

export type MspAgreementAcceptance = typeof mspAgreementAcceptancesTable.$inferSelect;
export type InsertMspAgreementAcceptance = typeof mspAgreementAcceptancesTable.$inferInsert;

// ── Portal Workflow Engine ─────────────────────────────────────────────────────
// Tenant-aware, durable, idempotent workflow engine for the MSP Portal.
// Tables are prefixed with portal_wf_ to distinguish them from the GUI-builder
// wf_* tables (which power the Shane consulting business workflows).

export const portalWfWorkflowsTable = pgTable("portal_wf_workflows", {
  id: serial("id").primaryKey(),
  workflowKey: text("workflow_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  graph: jsonb("graph").$type<Record<string, unknown>>().notNull().default({ nodes: [], edges: [] }),
  retryPolicy: jsonb("retry_policy").$type<Record<string, unknown>>().notNull().default({ maxAttempts: 3, backoffBaseSeconds: 30, backoffMultiplier: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PortalWfWorkflow = typeof portalWfWorkflowsTable.$inferSelect;
export type InsertPortalWfWorkflow = typeof portalWfWorkflowsTable.$inferInsert;

export const portalWfStartMappingsTable = pgTable("portal_wf_start_mappings", {
  id: serial("id").primaryKey(),
  eventPattern: text("event_pattern").notNull(),
  workflowKey: text("workflow_key").notNull().references(() => portalWfWorkflowsTable.workflowKey, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_wf_start_mappings_event_pattern_idx").on(t.eventPattern),
  index("portal_wf_start_mappings_workflow_key_idx").on(t.workflowKey),
  uniqueIndex("portal_wf_start_mappings_pattern_wf_idx").on(t.eventPattern, t.workflowKey),
]);

export type PortalWfStartMapping = typeof portalWfStartMappingsTable.$inferSelect;
export type InsertPortalWfStartMapping = typeof portalWfStartMappingsTable.$inferInsert;

export const PORTAL_WF_RUN_STATUS = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type PortalWfRunStatus = typeof PORTAL_WF_RUN_STATUS[number];

export const portalWfRunsTable = pgTable("portal_wf_runs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().unique().defaultRandom(),
  workflowKey: text("workflow_key").notNull(),
  tenantContext: jsonb("tenant_context").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: PORTAL_WF_RUN_STATUS }).notNull().default("pending"),
  triggerEventId: uuid("trigger_event_id"),
  triggerEventType: text("trigger_event_type"),
  inputPayload: jsonb("input_payload").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  // AI admission gate — persisted so paused-then-resumed runs stay admitted.
  // null = not yet evaluated, true = admitted (positive balance at first AI node),
  // false = blocked (zero/negative balance at first AI node).
  aiAdmitted: boolean("ai_admitted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_wf_runs_workflow_key_idx").on(t.workflowKey),
  index("portal_wf_runs_status_idx").on(t.status),
  index("portal_wf_runs_msp_id_idx").on(t.mspId),
  index("portal_wf_runs_customer_id_idx").on(t.customerId),
  index("portal_wf_runs_created_at_idx").on(t.createdAt),
]);

export type PortalWfRun = typeof portalWfRunsTable.$inferSelect;
export type InsertPortalWfRun = typeof portalWfRunsTable.$inferInsert;

export const PORTAL_WF_NODE_STATUS = ["pending", "running", "completed", "failed", "skipped"] as const;
export type PortalWfNodeStatus = typeof PORTAL_WF_NODE_STATUS[number];

export const portalWfNodeOutputsTable = pgTable("portal_wf_node_outputs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => portalWfRunsTable.runId, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  status: text("status", { enum: PORTAL_WF_NODE_STATUS }).notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  inputPayload: jsonb("input_payload").$type<Record<string, unknown>>(),
  outputPayload: jsonb("output_payload").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  errorStack: text("error_stack"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_wf_node_outputs_run_id_idx").on(t.runId),
  uniqueIndex("portal_wf_node_outputs_run_node_idx").on(t.runId, t.nodeId),
]);

export type PortalWfNodeOutput = typeof portalWfNodeOutputsTable.$inferSelect;
export type InsertPortalWfNodeOutput = typeof portalWfNodeOutputsTable.$inferInsert;

export const PORTAL_WF_OPERATOR_TASK_STATUS = ["open", "acknowledged", "resolved"] as const;
export type PortalWfOperatorTaskStatus = typeof PORTAL_WF_OPERATOR_TASK_STATUS[number];

export const portalWfOperatorTasksTable = pgTable("portal_wf_operator_tasks", {
  id: serial("id").primaryKey(),
  taskId: uuid("task_id").notNull().unique().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => portalWfRunsTable.runId, { onDelete: "cascade" }),
  workflowKey: text("workflow_key").notNull(),
  nodeId: text("node_id"),
  severity: text("severity", { enum: ["error", "warning"] }).notNull().default("error"),
  title: text("title").notNull(),
  description: text("description"),
  deepLink: text("deep_link"),
  status: text("status", { enum: PORTAL_WF_OPERATOR_TASK_STATUS }).notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: integer("resolved_by_user_id"),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_wf_operator_tasks_run_id_idx").on(t.runId),
  index("portal_wf_operator_tasks_status_idx").on(t.status),
  index("portal_wf_operator_tasks_msp_id_idx").on(t.mspId),
]);

export type PortalWfOperatorTask = typeof portalWfOperatorTasksTable.$inferSelect;
export type InsertPortalWfOperatorTask = typeof portalWfOperatorTasksTable.$inferInsert;

export const portalWfIdempotencyTable = pgTable("portal_wf_idempotency", {
  id: serial("id").primaryKey(),
  sideEffectKey: text("side_effect_key").notNull().unique(),
  runId: uuid("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  result: jsonb("result").$type<Record<string, unknown>>(),
}, (t) => [
  index("portal_wf_idempotency_run_id_idx").on(t.runId),
]);

// One row per MSP — links the MSP to its Stripe subscription and the Product
// Catalog tier it has purchased (services.fulfillmentType = "msp_monthly_subscription").
// This table owns dunning state. Billing for offers/SOWs is entirely separate
// (managed in portal.ts) and never intersects with this table.

// ── AI Usage Events ────────────────────────────────────────────────────────────
// Append-only log of every AI inference call. Used for billing, dashboards, and
// cost attribution. All monetary amounts in integer cents (USD).

export const AI_COST_OWNER = ["msp", "platform"] as const;
export type AiCostOwner = typeof AI_COST_OWNER[number];

export const aiUsageEventsTable = pgTable("ai_usage_events", {
  id: serial("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().defaultRandom(),
  // Which MSP this usage belongs to. Null for platform-owned operations.
  mspId: integer("msp_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  // The portal workflow node type or free-form feature label (e.g. "generate_document", "chat_message")
  nodeType: text("node_type").notNull(),
  feature: text("feature"),
  // Token counts (null when token counting unavailable)
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  // Cost in integer cents. Always non-negative.
  costCents: integer("cost_cents").notNull().default(0),
  // Who bears the cost: "msp" debits the MSP's allowance; "platform" never does.
  costOwner: text("cost_owner", { enum: AI_COST_OWNER }).notNull().default("msp"),
  // Which workflow run triggered this usage (if applicable)
  runId: text("run_id"),
  // AI model used
  model: text("model"),
  // Which customer (tenant) this usage was generated for. Null for
  // platform-level or MSP-scoped-but-not-customer-specific calls.
  customerId: integer("customer_id"),
  // Type of artifact this call generated, e.g. "sow", "governance_snapshot",
  // "assessment". Null when the call produced no persisted artifact.
  generatedArtifactType: text("generated_artifact_type"),
  // Human-readable name of the generated artifact, e.g. "SOW - Acme Corp".
  generatedArtifactName: text("generated_artifact_name"),
  // Reference to the generated artifact's row. Stored as text (not a real FK)
  // because it may point at different tables depending on artifactType.
  generatedArtifactId: text("generated_artifact_id"),
  // What triggered this call when it did not originate from a workflow node
  // (nodeType already captures that case), e.g. "simulator-studio:manual-run",
  // "support-chat".
  triggerSource: text("trigger_source"),
  // Correlation id shared across all calls in the same request/run, sourced
  // from request-context.ts's per-request/per-run traceId.
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_usage_events_msp_id_idx").on(t.mspId),
  index("ai_usage_events_occurred_at_idx").on(t.occurredAt),
  index("ai_usage_events_cost_owner_idx").on(t.costOwner),
  index("ai_usage_events_run_id_idx").on(t.runId),
  index("ai_usage_events_customer_id_idx").on(t.customerId),
  index("ai_usage_events_correlation_id_idx").on(t.correlationId),
]);

export type AiUsageEvent = typeof aiUsageEventsTable.$inferSelect;
export type InsertAiUsageEvent = typeof aiUsageEventsTable.$inferInsert;

// ── AI Balance Ledger ──────────────────────────────────────────────────────────
// Double-entry transaction log for each MSP's AI credit balance.
// All amounts in integer cents (USD). Positive = credit, negative = debit.
//
// Transaction types:
//   monthly_grant   — free allowance added at the start of each billing period
//   purchase        — MSP purchases an AI credit block via Stripe (never expires)
//   consumption     — AI was used; links to an ai_usage_events row
//   period_reset    — monthly_grant allowance expires at period end (no rollover)

export const AI_LEDGER_TXN_TYPES = ["monthly_grant", "purchase", "consumption", "period_reset"] as const;
export type AiLedgerTxnType = typeof AI_LEDGER_TXN_TYPES[number];

export const aiBalanceLedgerTable = pgTable("ai_balance_ledger", {
  id: serial("id").primaryKey(),
  ledgerId: uuid("ledger_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull(),
  txnType: text("txn_type", { enum: AI_LEDGER_TXN_TYPES }).notNull(),
  // Positive = credit (grant/purchase); negative = debit (consumption/reset).
  amountCents: integer("amount_cents").notNull(),
  description: text("description"),
  // External reference: Stripe payment intent ID, run ID, period key, etc.
  referenceId: text("reference_id"),
  // For monthly_grant/period_reset — the billing period this applies to (e.g. "2026-07")
  periodKey: text("period_key"),
  // For consumption rows — links back to the usage event
  usageEventId: uuid("usage_event_id"),
  // Running balance snapshot after this transaction (cents, MSP-scoped)
  balanceAfterCents: integer("balance_after_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: integer("created_by_user_id"),
}, (t) => [
  index("ai_balance_ledger_msp_id_idx").on(t.mspId),
  index("ai_balance_ledger_txn_type_idx").on(t.txnType),
  index("ai_balance_ledger_created_at_idx").on(t.createdAt),
  index("ai_balance_ledger_period_key_idx").on(t.periodKey),
]);

export type AiBalanceLedgerRow = typeof aiBalanceLedgerTable.$inferSelect;
export type InsertAiBalanceLedgerRow = typeof aiBalanceLedgerTable.$inferInsert;

// ── MSP AI Block Purchases ─────────────────────────────────────────────────────
// Tracks Stripe-backed AI credit block purchases. One row per Stripe checkout.
// Never expires — MSPs consume these after their monthly grant is exhausted.

export const MSP_AI_PURCHASE_STATUSES = ["pending", "active", "exhausted", "refunded"] as const;
export type MspAiPurchaseStatus = typeof MSP_AI_PURCHASE_STATUSES[number];

export const mspAiPurchasesTable = pgTable("msp_ai_purchases", {
  id: serial("id").primaryKey(),
  purchaseId: uuid("purchase_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // Stripe identifiers
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  // Credit block details
  pricePaidCents: integer("price_paid_cents").notNull(),
  creditGrantedCents: integer("credit_granted_cents").notNull(),
  status: text("status", { enum: MSP_AI_PURCHASE_STATUSES }).notNull().default("pending"),
  // Stripe customer ID for the MSP (for future re-use)
  stripeCustomerId: text("stripe_customer_id"),
  purchasedByUserId: integer("purchased_by_user_id"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_ai_purchases_msp_id_idx").on(t.mspId),
  index("msp_ai_purchases_status_idx").on(t.status),
  index("msp_ai_purchases_stripe_session_idx").on(t.stripeCheckoutSessionId),
]);

export type MspAiPurchase = typeof mspAiPurchasesTable.$inferSelect;
export type InsertMspAiPurchase = typeof mspAiPurchasesTable.$inferInsert;

export const MSP_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "unpaid"] as const;
export type MspSubscriptionStatus = typeof MSP_SUBSCRIPTION_STATUSES[number];

export const MSP_BILLING_INTERVALS = ["month", "year"] as const;
export type MspBillingInterval = typeof MSP_BILLING_INTERVALS[number];

export const MSP_DUNNING_STATES = ["reminder_sent", "suspended", "access_revoked", "archival_flagged"] as const;
export type MspDunningState = typeof MSP_DUNNING_STATES[number];

export const mspSubscriptionsTable = pgTable("msp_subscriptions", {
  id: serial("id").primaryKey(),
  // The MSP organisation this subscription belongs to. One subscription per MSP.
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // The Product Catalog row (services.fulfillmentType = "msp_monthly_subscription")
  // that defines this tier's allowances and capabilities. Not a FK to avoid
  // cross-schema circular reference in TS — enforced at DB level via migrate-prod.
  serviceId: integer("service_id").notNull(),
  // Stripe identifiers
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  // Billing interval of the currently ACTIVE Stripe price ('month' or 'year').
  billingInterval: text("billing_interval", { enum: MSP_BILLING_INTERVALS }).notNull().default("month"),
  // Self-service plan change (msp-plan-self-service.ts): set while a tier and/or
  // interval change is scheduled via a Stripe Subscription Schedule to take effect
  // at the next period start. Cleared when the schedule completes or is canceled.
  stripeScheduleId: text("stripe_schedule_id"),
  pendingServiceId: integer("pending_service_id"),
  pendingBillingInterval: text("pending_billing_interval", { enum: MSP_BILLING_INTERVALS }),
  // Subscription lifecycle
  status: text("status", { enum: MSP_SUBSCRIPTION_STATUSES }).notNull().default("trialing"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // Dunning state machine. null = fully operational.
  // Transitions: null → reminder_sent (Day 3) → suspended (Day 7) → access_revoked (Day 14) → archival_flagged (Day 30)
  dunningState: text("dunning_state", { enum: MSP_DUNNING_STATES }),
  // Set when first payment failure is detected. Dunning day-count = NOW - paymentFailedAt.
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  // Snapshot of active customer tenant count, updated by the overage metering workflow.
  tenantCountSnapshot: integer("tenant_count_snapshot").notNull().default(0),
  // Contact email for dunning notification emails
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_subscriptions_status_idx").on(t.status),
  index("msp_subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  index("msp_subscriptions_dunning_idx").on(t.dunningState),
]);

export type MspSubscription = typeof mspSubscriptionsTable.$inferSelect;
export type InsertMspSubscription = typeof mspSubscriptionsTable.$inferInsert;

// ── MSP Connector Configuration ────────────────────────────────────────────────
// One row per MSP. Stores connector mode and Exchange Online integration settings.
// Raw credential values are NEVER stored here — only Key Vault secret names.
// Exchange Online credentials are stored in Key Vault using the secretName fields.

export const MSP_CONNECTOR_MODES = ["agent", "api_key", "delegated"] as const;
export type MspConnectorMode = typeof MSP_CONNECTOR_MODES[number];

export const mspConnectorConfigsTable = pgTable("msp_connector_configs", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // Connector mode determines how the MSP integrates with customer tenants
  connectorMode: text("connector_mode", { enum: MSP_CONNECTOR_MODES }).notNull().default("delegated"),
  // Exchange Online integration fields — secrets stored in Key Vault by name only
  exchangeOnlineEnabled: boolean("exchange_online_enabled").notNull().default(false),
  exchangeOnlineTenantId: text("exchange_online_tenant_id"),
  exchangeOnlineClientIdSecretName: text("exchange_online_client_id_secret_name"),
  exchangeOnlineClientSecretName: text("exchange_online_client_secret_name"),
  // Whether the MSP has agreed to audit logging for automated actions
  auditLoggingEnabled: boolean("audit_logging_enabled").notNull().default(true),
  // Optional customer agreement template authored by the MSP
  customerAgreementTemplate: text("customer_agreement_template"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_connector_configs_msp_id_idx").on(t.mspId),
]);

export type MspConnectorConfig = typeof mspConnectorConfigsTable.$inferSelect;
export type InsertMspConnectorConfig = typeof mspConnectorConfigsTable.$inferInsert;

// ── Zoho Connection ────────────────────────────────────────────────────────────
// One row per MSP (single-tenant today: mspId 1 only, shaped for later).
// The long-lived Zoho REFRESH token lives in Key Vault under keyVaultSecretName —
// never in this table. Access tokens churn hourly and are NOT long-term secrets,
// so they are cached here (accessTokenCache/accessTokenExpiresAt) and refreshed
// from the Key Vault refresh token when expired.

export const ZOHO_CONNECTION_STATUS = ["disconnected", "connected", "error"] as const;
export type ZohoConnectionStatus = typeof ZOHO_CONNECTION_STATUS[number];

export const zohoConnectionTable = pgTable("zoho_connection", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().default(1).references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // Zoho's own org identifier, captured at OAuth callback time (best-effort)
  zohoOrgId: text("zoho_org_id"),
  // Zoho Projects' portal id — a distinct concept from zohoOrgId above (CRM's
  // org identifier). Not known at OAuth callback time, so it is resolved
  // lazily on first Zoho Projects call (GET /projects/v3/portals/) and cached
  // here rather than re-fetched on every request (#85).
  zohoPortalId: text("zoho_portal_id"),
  // Zoho Books' organization id — a third distinct Zoho identifier, separate
  // from zohoOrgId (CRM) and zohoPortalId (Projects) above. Not known at OAuth
  // callback time, so it is resolved lazily on first Zoho Books call
  // (GET /books/v3/organizations) and cached here (#87), same pattern as
  // zohoPortalId.
  zohoBooksOrgId: text("zoho_books_org_id"),
  // Zoho Desk's organization id — a fourth distinct Zoho identifier, separate
  // from zohoOrgId (CRM), zohoPortalId (Projects) and zohoBooksOrgId (Books)
  // above. Unlike those three, Zoho Desk requires this as an `orgId` HTTP
  // header on every call, not a query param or path segment. Not known at
  // OAuth callback time, so it is resolved lazily on first Zoho Desk call
  // (GET /api/v1/organizations) and cached here (#89), same pattern as
  // zohoBooksOrgId.
  zohoDeskOrgId: text("zoho_desk_org_id"),
  // Key Vault secret NAME holding the refresh token — never the value itself
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  accessTokenCache: text("access_token_cache"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  status: text("status", { enum: ZOHO_CONNECTION_STATUS }).notNull().default("disconnected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ZohoConnection = typeof zohoConnectionTable.$inferSelect;
export type InsertZohoConnection = typeof zohoConnectionTable.$inferInsert;

// ── EngageBay Connection ─────────────────────────────────────────────────────
// One row per MSP (single-tenant today: mspId 1 only, shaped for later).
// EngageBay auth is a single static API key (no OAuth, no refresh, no expiry —
// confirmed via github.com/engagebay/restapi), so unlike zoho_connection there
// is no access-token cache: the key lives in Key Vault under
// keyVaultSecretName and nowhere else.

export const ENGAGEBAY_CONNECTION_STATUS = ["disconnected", "connected", "error"] as const;
export type EngageBayConnectionStatus = typeof ENGAGEBAY_CONNECTION_STATUS[number];

export const engagebayConnectionTable = pgTable("engagebay_connection", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().default(1).references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // Key Vault secret NAME holding the API key — never the value itself
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  status: text("status", { enum: ENGAGEBAY_CONNECTION_STATUS }).notNull().default("disconnected"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EngageBayConnection = typeof engagebayConnectionTable.$inferSelect;
export type InsertEngageBayConnection = typeof engagebayConnectionTable.$inferInsert;

// ── Plan Capability Rules ──────────────────────────────────────────────────────
// Data-driven mapping: (Stripe product/service tier) → (capability key → enabled).
// Editable through the Admin Panel. Resolved at runtime by requirePlanFeature().
// One row per (serviceId, capabilityKey) pair. Missing row = capability available.

export const mspPlanCapabilitiesTable = pgTable("msp_plan_capabilities", {
  id: serial("id").primaryKey(),
  // References services.id (msp_monthly_subscription products in the product catalog)
  serviceId: integer("service_id").notNull(),
  // The feature capability key checked by requirePlanFeature()
  capabilityKey: text("capability_key").notNull(),
  // false = gated on this tier; true = available on this tier
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
}, (t) => [
  uniqueIndex("msp_plan_capabilities_service_cap_idx").on(t.serviceId, t.capabilityKey),
  index("msp_plan_capabilities_service_id_idx").on(t.serviceId),
]);

export type MspPlanCapability = typeof mspPlanCapabilitiesTable.$inferSelect;
export type InsertMspPlanCapability = typeof mspPlanCapabilitiesTable.$inferInsert;

// ── MSP Overrides ─────────────────────────────────────────────────────────────
// Per-MSP ad hoc overrides granting feature flags or custom allowances outside
// their plan. Created only by PlatformAdmin. One row per MSP (upsert).

export const mspOverridesTable = pgTable("msp_overrides", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // Feature flags overriding tier capabilities (e.g. { "advanced_signals": true })
  featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().notNull().default({}),
  // Override the tenant count allowance (null = use plan default)
  tenantAllowanceOverride: integer("tenant_allowance_override"),
  // Override the AI credit allowance (null = use plan default)
  aiCreditAllowanceOverride: integer("ai_credit_allowance_override"),
  // Human-readable reason for the override (required)
  reason: text("reason").notNull(),
  // Optional expiry — after this date the override is no longer applied
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_overrides_msp_id_idx").on(t.mspId),
  index("msp_overrides_expires_at_idx").on(t.expiresAt),
]);

export type MspOverride = typeof mspOverridesTable.$inferSelect;
export type InsertMspOverride = typeof mspOverridesTable.$inferInsert;

// ── MSP Email Templates ────────────────────────────────────────────────────────
// Per-MSP email template customization. Platform-level defaults (mspId = null)
// are seeded on startup and cannot be edited by MSP admins.
//
// Platform-locked keys (immutable): 'password_reset', 'mfa_code', 'consent_revoked'
// MSP-customizable keys: 'onboarding_welcome', 'monitoring_complete',
//   'offer_available', 'report_ready', 'invoice_due_reminder'
//
// The fallback chain: MSP row → platform default row → code default.
// Required merge fields are validated on save (server-side).

export const MSP_EMAIL_TEMPLATE_KEYS = [
  "onboarding_welcome",
  "monitoring_complete",
  "offer_available",
  "report_ready",
  "invoice_due_reminder",
  "password_reset",
  "mfa_code",
  "consent_revoked",
] as const;
export type MspEmailTemplateKey = typeof MSP_EMAIL_TEMPLATE_KEYS[number];

export const MSP_LOCKED_EMAIL_KEYS: ReadonlySet<MspEmailTemplateKey> = new Set([
  "password_reset",
  "mfa_code",
  "consent_revoked",
]);

export const mspEmailTemplatesTable = pgTable("msp_email_templates", {
  id: serial("id").primaryKey(),
  // null = platform-level default; set = MSP-specific override
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  templateKey: text("template_key", { enum: MSP_EMAIL_TEMPLATE_KEYS }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_email_templates_msp_key_idx").on(t.mspId, t.templateKey),
  index("msp_email_templates_key_idx").on(t.templateKey),
]);

export type MspEmailTemplate = typeof mspEmailTemplatesTable.$inferSelect;
export type InsertMspEmailTemplate = typeof mspEmailTemplatesTable.$inferInsert;

// ── MSP Mailbox Connectors ─────────────────────────────────────────────────────
// Stores per-MSP Exchange Online mailbox connections for outbound email.
// When connected, emails to that MSP's customers are sent through their mailbox,
// achieving real domain / SPF / DKIM / DMARC alignment.
//
// Auth flow: admin-consent with Mail.Send scope on the platform MT app for the
// MSP's own tenant. No client secret stored — uses the MT app's client_credentials
// grant after the tenant admin has consented.
//
// Fallback: when no connector row exists or isActive = false, the platform mailbox
// is used but the From/Reply-To is set to the MSP's business name.

export const mspMailboxConnectorsTable = pgTable("msp_mailbox_connectors", {
  id: serial("id").primaryKey(),
  connectorId: uuid("connector_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // MSP's Azure AD tenant ID — used to acquire an MT-app token for this tenant
  tenantId: text("tenant_id").notNull(),
  // UPN of the mailbox to send from (e.g. "noreply@contoso.com")
  mailboxUpn: text("mailbox_upn").notNull(),
  // Display name used as the "From" header (e.g. "Contoso IT Services")
  fromDisplayName: text("from_display_name").notNull(),
  // Whether this connector is active and eligible for routing
  isActive: boolean("is_active").notNull().default(true),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_mailbox_connectors_msp_id_idx").on(t.mspId),
]);

export type MspMailboxConnector = typeof mspMailboxConnectorsTable.$inferSelect;
export type InsertMspMailboxConnector = typeof mspMailboxConnectorsTable.$inferInsert;

// ── MSP Mailbox Consent States ─────────────────────────────────────────────────
// Short-lived in-flight OAuth state tokens for the mailbox-connect flow.
// One row per pending consent request; burned on first use or expiry (10 minutes).

export const mspMailboxConsentStatesTable = pgTable("msp_mailbox_consent_states", {
  state: text("state").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // The mailbox UPN the admin intends to use — recorded at request time
  mailboxUpn: text("mailbox_upn").notNull(),
  // Display name for the "From" header
  fromDisplayName: text("from_display_name").notNull(),
  // Which portal path to redirect to after consent
  returnPath: text("return_path"),
  requestedByUserId: integer("requested_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_mailbox_consent_states_msp_id_idx").on(t.mspId),
  index("msp_mailbox_consent_states_expires_at_idx").on(t.expiresAt),
]);

export type MspMailboxConsentState = typeof mspMailboxConsentStatesTable.$inferSelect;
export type InsertMspMailboxConsentState = typeof mspMailboxConsentStatesTable.$inferInsert;

// ── MSP Impersonation Tokens ───────────────────────────────────────────────────
// Tracks impersonation sessions issued by PlatformAdmin. Used to extend the
// Active Sessions view — shows both refresh-token sessions and impersonation tokens.

export const mspImpersonationTokensTable = pgTable("msp_impersonation_tokens", {
  id: serial("id").primaryKey(),
  tokenId: uuid("token_id").notNull().unique().defaultRandom(),
  // Who performed the impersonation
  actorUserId: integer("actor_user_id").notNull(),
  // Who was impersonated
  targetUserId: integer("target_user_id").notNull(),
  targetMspId: integer("target_msp_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  reason: text("reason"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
}, (t) => [
  index("msp_impersonation_tokens_actor_idx").on(t.actorUserId),
  index("msp_impersonation_tokens_target_idx").on(t.targetUserId),
  index("msp_impersonation_tokens_expires_at_idx").on(t.expiresAt),
]);

export type MspImpersonationToken = typeof mspImpersonationTokensTable.$inferSelect;
export type InsertMspImpersonationToken = typeof mspImpersonationTokensTable.$inferInsert;

// ── Monitoring Package Engine ──────────────────────────────────────────────────

export const MONITOR_CHECK_FREQUENCY = ["hourly", "daily", "live"] as const;
export type MonitorCheckFrequency = typeof MONITOR_CHECK_FREQUENCY[number];

export const MONITOR_CHECK_STATUS = ["active", "archived"] as const;
export type MonitorCheckStatus = typeof MONITOR_CHECK_STATUS[number];

// ── PowerShell-backed execution (additive, per #209's approved design) ────────
// Every existing check is Graph-REST-shaped at the transport layer. A small
// class of checks (DLP/Label policies, #208) can only be read via
// Connect-IPPSSession PowerShell cmdlets, not Graph REST. `executorType`
// discriminates which transport a check uses; everything downstream of fetch
// (mapping/severityRules/outputSchema/engines/frequency/scriptPackageId) is
// already transport-agnostic and stays completely shared between both paths.
//
// 'sharepoint-admin' (#394) is the third transport, added for exactly the same
// reason: SharePoint Online TENANT administration (tenant-wide sharing
// capability, per-site storage quota) has no Microsoft Graph equivalent at all —
// it lives on the SharePoint Online resource
// (00000003-0000-0ff1-ce00-000000000000) behind certificate-based app-only auth,
// which api-server's sharepoint-admin.ts already implements. Checks on this
// transport carry `spOperation` and nothing else; endpoint/method/fanOut*/ps*
// are unused, the same way they are for 'powershell'.
//
// 'dns' (#496) is the fourth transport, and the odd one out: it needs no
// tenant credential of any kind. SPF and DMARC are public TXT records on the
// domain itself, and DKIM is checkable the same way against Microsoft 365's
// default key-rotation selector names — all of it plain public DNS, resolved
// with Node's built-in dns module. Checks on this transport carry no
// executor-specific column at all (the tenant's own `domain` is enough);
// endpoint/method/fanOut*/ps*/spOperation are unused, the same way ps*/spOperation
// are unused for the other non-Graph transports.
//
// 'power-platform' (#1869) is the fifth transport — the Power Platform admin
// API, one credential against one tenant-level surface.
//
// 'azure-rm' (#1871, answering the other half of #1849) is the sixth transport:
// Azure Resource Manager REST (https://management.azure.com), reached with an
// app-only token whose AUDIENCE is ARM, not Graph. It exists because 22 modelled
// config resources (config_resources.read_transport = 'azure-rm') have no Graph
// or PowerShell read path at all — Microsoft365DSC reads them with
// `Invoke-AzRestMethod` against that same management URL.
//
// The thing that makes this transport structurally different from every other
// one above: **its authorization is not tenant-scoped.** Graph app permissions
// and Entra directory roles confer NOTHING on ARM — separate control planes,
// separate token audiences. Authorization comes from Azure RBAC role
// assignments made at a management-group / subscription / resource-group scope,
// which a customer must perform (see AZURE_RM_REACH_STATES). This was verified
// live, not assumed: the platform MT app acquires a perfectly valid ARM token
// for the testbed tenant and then sees ZERO subscriptions, because it holds no
// Azure role assignment there. Checks on this transport carry `armOperation`
// and nothing else; endpoint/method/fanOut*/ps*/spOperation are unused.
//
// #1869 and #1871 landed against the same enum and the same dispatch switch in
// monitor-executor.ts; both transports are listed here and both have their own
// `if (check.executorType === …)` branch. A seventh transport should be appended
// the same way rather than replacing either.
export const MONITOR_CHECK_EXECUTOR_TYPES = ["graph", "powershell", "sharepoint-admin", "dns", "power-platform", "azure-rm"] as const;
export type MonitorCheckExecutorType = typeof MONITOR_CHECK_EXECUTOR_TYPES[number];

export const monitorChecksTable = pgTable("monitor_checks", {
  id: serial("id").primaryKey(),
  checkId: uuid("check_id").notNull().unique().defaultRandom(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull().default("GET"),
  requestBody: jsonb("request_body").$type<Record<string, unknown>>(),
  selectParams: text("select_params"),
  filterParams: text("filter_params"),
  properties: jsonb("properties").$type<string[]>().notNull().default([]),
  mapping: jsonb("mapping").$type<Array<{ sourceField: string; targetField: string; transform?: string }>>().notNull().default([]),
  severityRules: jsonb("severity_rules").$type<Array<{ expression: string; severity: string; label?: string }>>().notNull().default([]),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  engines: jsonb("engines").$type<string[]>().notNull().default([]),
  frequency: text("frequency", { enum: MONITOR_CHECK_FREQUENCY }).notNull().default("daily"),
  requiresCustomerScript: boolean("requires_customer_script").notNull().default(false),
  scriptPackageId: uuid("script_package_id").references(() => scriptPackagesTable.id, { onDelete: "set null" }),
  // ── Fan-out (group-scoped) execution ──────────────────────────────────────
  // A small class of Graph endpoints have NO tenant-wide form: they require a
  // per-entity $filter (PIM for Groups eligibilitySchedules needs a groupId;
  // Planner /plans needs an owner group id). Covering a tenant means enumerating
  // every entity and issuing one request per entity, which the default
  // one-check-one-URL model can't express. When `fanOutSource` is set, the
  // executor takes an ADDITIVE fan-out path: it enumerates `fanOutSource`
  // (a Graph list endpoint, paginated), then runs the check's own `endpoint`
  // once per enumerated item with the item's id substituted into a `{itemId}`
  // placeholder, and aggregates the per-item results. NULL (the default for
  // every existing check) leaves the one-check-one-URL path completely unchanged.
  /** Graph list endpoint enumerating the items to iterate, e.g. `/groups?$select=id`. NULL = no fan-out. */
  fanOutSource: text("fan_out_source"),
  /** Field on each enumerated item whose value is substituted into the per-item `{itemId}` placeholder. Defaults to "id" when NULL. */
  fanOutItemIdField: text("fan_out_item_id_field"),
  /** Per-check cap on how many enumerated items are scanned (throttle guard). NULL = platform default (FAN_OUT_MAX_ITEMS_DEFAULT). */
  fanOutMaxItems: integer("fan_out_max_items"),
  /**
   * Optional condition-grammar expression (the SAME grammar severity_rules use)
   * evaluated against EACH enumerated source item; only items that pass are
   * fanned out. NULL = fan out to every enumerated item, i.e. exactly the prior
   * behaviour. Exists because some enumerations return a superset of what the
   * check is about — `/sites/getAllSites` returns every user's OneDrive as
   * `isPersonalSite: true`, and in a large tenant those would both waste a
   * request each and consume the fan_out_max_items cap ahead of the real
   * SharePoint sites, silently truncating the answer.
   */
  fanOutItemFilter: text("fan_out_item_filter"),
  /**
   * Key resolved server-side against a code-owned normalizer registry
   * (FAN_OUT_ITEM_NORMALIZERS in monitor-executor.ts) — an identifier only,
   * never a script string, the same contract ps_cmdlet_key follows. The
   * normalizer reshapes ONE source item's per-item results before they join the
   * flattened union, which is what lets a fan-out produce per-source-item rows
   * (one row per SharePoint site, carrying that site's real name and URL)
   * instead of an anonymous bag of child objects. NULL = flatten the raw
   * per-item results as-is, i.e. exactly the prior behaviour.
   */
  fanOutItemNormalizer: text("fan_out_item_normalizer"),
  // ── PowerShell-backed execution (additive, NULL/'graph' for every existing check) ──
  /** 'graph' (default, every existing row) = the endpoint/method/... columns above drive a Graph REST fetch. 'powershell' = psCmdletKey/psParams below drive a ps-execution container call instead; endpoint/method/requestBody/selectParams/filterParams/fanOut* are unused. */
  executorType: text("executor_type", { enum: MONITOR_CHECK_EXECUTOR_TYPES }).notNull().default("graph"),
  /** Identifier resolved server-side by the ps-execution container against its own code-owned cmdlet allowlist ($script:CmdletCatalog in entrypoint.ps1) — never a raw script string. NULL unless executorType = 'powershell'. */
  psCmdletKey: text("ps_cmdlet_key"),
  /** Static params merged with resolved tenant-identity context ({organization}/{tenantId} placeholders) at dispatch time — fill values only, never control flow. NULL unless executorType = 'powershell'. */
  psParams: jsonb("ps_params").$type<Record<string, unknown>>(),
  // ── SharePoint-admin-backed execution (additive, NULL for every other check) ──
  /**
   * Identifier resolved server-side against a code-owned operation registry
   * (SHAREPOINT_ADMIN_OPERATIONS in monitor-executor.ts) — an identifier only,
   * never a URL and never a script, the same contract ps_cmdlet_key and
   * fan_out_item_normalizer already follow. The operation decides which
   * sharepoint-admin.ts function runs; the tenant it runs against is resolved
   * from the tenant's own identity at dispatch time, never stored here.
   * NULL unless executorType = 'sharepoint-admin'.
   */
  spOperation: text("sp_operation"),
  // ── Power-Platform-backed execution (additive, NULL for every other check) ──
  /**
   * Identifier resolved server-side against a code-owned operation registry
   * (POWER_PLATFORM_OPERATIONS in monitor-executor.ts) — an identifier only,
   * never a URL and never a script, the same contract ps_cmdlet_key and
   * sp_operation already follow. The operation decides which
   * power-platform-admin.ts function runs; the tenant it runs against is
   * resolved from the tenant's own identity at dispatch time, never stored here.
   * NULL unless executorType = 'power-platform'. (#1869)
   */
  ppOperation: text("pp_operation"),
  // ── Azure Resource Manager execution (#1871, additive, NULL for every other check) ──
  /**
   * Identifier resolved server-side against a code-owned operation registry
   * (AZURE_RM_OPERATIONS in azure-rm.ts) — an identifier only, never a URL and
   * never a script, the same contract ps_cmdlet_key / sp_operation /
   * fan_out_item_normalizer already follow. The operation owns its ARM path and
   * api-version; the subscriptions it runs against come from the live reach
   * probe at dispatch time, never stored here.
   * NULL unless executorType = 'azure-rm'.
   */
  armOperation: text("arm_operation"),
  schemaVersion: integer("schema_version").notNull().default(1),
  status: text("status", { enum: MONITOR_CHECK_STATUS }).notNull().default("active"),
  /**
   * Whether this check's result is something a customer should ever see (a
   * portal finding, a remediation-KB entry, a monitoring-package listing). Real
   * `status = 'active'` checks split into two kinds that `status` alone cannot
   * distinguish: customer governance findings, and platform-internal
   * self-tests/diagnostics that happen to run against a customer's tenant
   * (e.g. `appgov:enterprise-app-registration-list` checks for THIS platform's
   * own multi-tenant app registration as a connectivity health check, not a
   * customer finding; `diagnostics:ps-execution-test` is a PowerShell-path
   * diagnostic). Defaults `true` — the common case — so every existing check
   * except the two backfilled `false` below is unaffected. #2188.
   */
  isCustomerFacing: boolean("is_customer_facing").notNull().default(true),
  createdByAdminId: integer("created_by_admin_id"),
  updatedByAdminId: integer("updated_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("monitor_checks_key_idx").on(t.key),
  index("monitor_checks_status_idx").on(t.status),
  index("monitor_checks_frequency_idx").on(t.frequency),
]);

export type MonitorCheck = typeof monitorChecksTable.$inferSelect;
export type InsertMonitorCheck = typeof monitorChecksTable.$inferInsert;

export const monitoringPackagesTable = pgTable("monitoring_packages", {
  id: serial("id").primaryKey(),
  packageId: uuid("package_id").notNull().unique().defaultRandom(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  engines: jsonb("engines").$type<string[]>().notNull().default([]),
  status: text("status", { enum: MONITOR_CHECK_STATUS }).notNull().default("active"),
  /** Platform-set cost to the MSP per assigned tenant per month (in cents). 0 = no charge. */
  platformCostCents: integer("platform_cost_cents").notNull().default(0),
  /** Which plan tier is required to include this package in a Sales Bundle. null = all tiers. */
  requiredPlanFeature: text("required_plan_feature"),
  createdByAdminId: integer("created_by_admin_id"),
  updatedByAdminId: integer("updated_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("monitoring_packages_key_idx").on(t.key),
  index("monitoring_packages_status_idx").on(t.status),
]);

export type MonitoringPackage = typeof monitoringPackagesTable.$inferSelect;
export type InsertMonitoringPackage = typeof monitoringPackagesTable.$inferInsert;

export const monitoringPackageChecksTable = pgTable("monitoring_package_checks", {
  id: serial("id").primaryKey(),
  packageKey: text("package_key").notNull().references(() => monitoringPackagesTable.key, { onDelete: "cascade" }),
  checkKey: text("check_key").notNull().references(() => monitorChecksTable.key, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("monitoring_package_checks_pkg_check_idx").on(t.packageKey, t.checkKey),
  index("monitoring_package_checks_package_idx").on(t.packageKey),
  index("monitoring_package_checks_check_idx").on(t.checkKey),
]);

export type MonitoringPackageCheck = typeof monitoringPackageChecksTable.$inferSelect;

// "license_gap": the check couldn't run because the tenant lacks the required
// Microsoft 365 SKU/add-on (e.g. Entra ID Premium, Defender for Office 365). This
// is an accurate, known limitation — NOT a security finding, a consent revocation,
// or a technical failure — and must never block a scan from completing.
//
// "partial": a fan-out (group-scoped) check completed with real aggregate data,
// but some of the per-item requests failed — e.g. 160 of 200 groups returned
// their PIM schedules and 40 errored. This is deliberately distinct from both
// "ok" (which would hide that coverage was incomplete) and "error" (which would
// throw away the real data that WAS collected). Only produced by the fan-out
// execution path; the one-check-one-URL path never yields it.
//
// "service_not_configured" (Git #1847): the check's Microsoft SERVICE will not
// answer for this tenant at all — Intune never enrolled, or never licensed. It is
// deliberately NOT "ok with zero items", which is what these checks used to record
// and which told the customer a measured zero for something never measured; and it
// is deliberately NOT "license_gap", because "you have not set this up" and "you do
// not own this product" are different customer conversations. Which of the five real
// service states it is, and the evidence, live on the ONE tenant-level
// `tenant_service_availability` row this status refers to.
//
// The next two are produced ONLY by the 'azure-rm' transport (#1871) and are
// deliberately distinct from EACH OTHER and from "error" (unreachable). Azure
// RBAC is not tenant-scoped, so "we saw no Azure" has two completely different
// causes with opposite meanings, and conflating them is the specific failure
// this transport was built to avoid:
//
// "azure_no_rbac": an ARM token was acquired for the tenant successfully, and
// GET /subscriptions returned 200 with an EMPTY list. The platform's principal
// holds no Azure role assignment anywhere it can see. This says NOTHING about
// whether the customer has Azure — an ARM listing is RBAC-filtered, so a tenant
// with fifty subscriptions and no grant to us looks exactly like this. It is an
// onboarding gap on our side, not a fact about the customer.
//
// "azure_no_subscriptions": the same empty listing, but this time the platform
// ALSO has a tenant-root/management-group-scoped read (GET
// /providers/Microsoft.Management/managementGroups returned 200). At that scope
// the listing covers every subscription in the tenant, so an empty result IS
// conclusive: the tenant genuinely has no Azure subscriptions. That is a normal,
// complete, non-error condition for an M365 governance customer.
//
// A failure to acquire the ARM token at all stays "error" (or "consent_revoked"
// on a documented consent signature) — the pre-existing "unreachable" bucket.
// "power_platform_not_registered" (Git #1972) — the customer's tenant admin has
// not yet run the one-time Power Platform management-app enrolment
// (POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION in power-platform-admin.ts).
// Distinct from "error": known cause, known one-time remediation, not a fault.
export const TENANT_MONITOR_PROFILE_STATUS = ["ok", "error", "consent_revoked", "requires_script", "license_gap", "partial", "service_not_configured", "azure_no_rbac", "azure_no_subscriptions", "power_platform_not_registered"] as const;
export type TenantMonitorProfileStatus = typeof TENANT_MONITOR_PROFILE_STATUS[number];

export const tenantMonitorProfilesTable = pgTable("tenant_monitor_profiles", {
  id: serial("id").primaryKey(),
  profileId: uuid("profile_id").notNull().unique().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  checkKey: text("check_key").notNull(),
  checkSchemaVersion: integer("check_schema_version").notNull().default(1),
  triggerId: text("trigger_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: TENANT_MONITOR_PROFILE_STATUS }).notNull().default("ok"),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
  extractedProperties: jsonb("extracted_properties").$type<Record<string, unknown>>(),
  severityMatched: text("severity_matched"),
  /**
   * The matched severity rule's OWN label, already interpolated against THIS
   * run's extracted properties (Git #549) — e.g. "No sensitivity labels are
   * configured in this tenant ...", not the band "warning".
   *
   * WHY THIS IS A STORED COLUMN AND NOT DERIVED AT READ TIME. Two independent
   * reasons, either one sufficient on its own:
   *
   *   1. `severity_matched` cannot identify WHICH rule fired. `classifySeverity()`
   *      returns the FIRST rule whose expression matches, and one check may
   *      carry several rules sharing a band with different labels — real,
   *      live example: `exchange:dkim-spf-dmarc-status` has two "warning" rules
   *      ("No SPF record found on the domain" and "No DMARC record found at
   *      _dmarc.<domain>"). A read-time lookup keyed on the band alone is
   *      therefore ambiguous and can state the wrong fact.
   *   2. Labels interpolate `{{path}}` tokens against the data of THAT run
   *      (#418), so the sentence is run-specific ("14 expired secret(s) found
   *      on this tenant's app registrations"). Storing a rule index or
   *      re-running the rules later would render it against different numbers,
   *      or against rules edited since the row was written.
   *
   * NULL is a real, honest state rather than a gap to paper over: the matched
   * rule carries no label, interpolation hit an unresolved token (#418 discards
   * the whole label rather than print a literal `{{token}}`), nothing matched
   * at all, or the row predates this column. Every consumer falls back to
   * generic text on NULL — it never invents one.
   */
  severityLabel: text("severity_label"),
  errorMessage: text("error_message"),
  itemCount: integer("item_count"),
  pageCount: integer("page_count"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tenant_monitor_profiles_idempotency_idx").on(t.idempotencyKey),
  index("tenant_monitor_profiles_tenant_check_idx").on(t.tenantId, t.checkKey),
  index("tenant_monitor_profiles_tenant_id_idx").on(t.tenantId),
  index("tenant_monitor_profiles_collected_at_idx").on(t.collectedAt),
]);

export type TenantMonitorProfile = typeof tenantMonitorProfilesTable.$inferSelect;

// ── Tenant service-plan / workload estate (Git #2008) ──────────────────────────
//
// The tenant's REAL enabled Microsoft 365 service-plan estate, as last observed
// on `GET /subscribedSkus`. Exists because the Ownership/RACI matrix must attach
// a row to every workload the tenant actually RUNS (Exchange, SharePoint,
// OneDrive, Teams, Security, Identity...) — #1523's settled rule — not to what
// the customer happens to have purchased through this platform
// (`client_services`). A customer with only a Monitoring purchase still runs
// Exchange, and Exchange still needs an accountable owner.
//
// THE ONE CONDITION (settled on #1516, restated on #2008): a service plan whose
// `provisioningStatus` is "Success" is enabled — full stop. No second "and
// someone actually uses it" condition; usage/consumption is a separate
// Licensing-pillar signal (cost-engine.ts / license-waste-source.ts) and is
// deliberately NOT conflated with this table. Only Success rows are ever
// stored — a plan that lapses to Disabled/Pending* simply stops appearing on
// the next sync (a full REPLACE per (msp_id, tenant_id), not an in-place status
// flip — see `syncTenantServicePlans` in `lib/tenant-workloads.ts`), so a reader
// never has to re-learn the provisioning-status vocabulary.
//
// WORKLOAD GROUPING IS NOT STORED HERE. `service_plan_name` is Microsoft's own
// real identifier (e.g. "EXCHANGE_S_ENTERPRISE"), kept verbatim — the same
// discipline `account-security-graph.ts`'s FULL_INTUNE_SERVICE_PLAN constant
// already uses for Intune. Coarse workload buckets (Exchange, SharePoint...)
// are a pure, testable derivation over that real identifier —
// `resolveWorkloadForServicePlan()` in `lib/tenant-workloads.ts` — computed at
// read time, so the mapping can be corrected without a migration.
//
// Keyed by (msp_id, tenant_id) — the same M365-tenant-GUID scope
// `msp_change_requests` / `msp_message_center_items` already use, NOT by
// `tenants.id`: this data is a property of the Graph tenant the platform reads,
// sourced independently of which portal customer row currently points at it.
// Consumers that need `tenants.id` (portal-ownership.ts) resolve it the same
// way they already resolve the other MSP-era tables — via
// `resolveTenantScope()`.
//
// Sourced from the ALREADY-COLLECTED `tenant_monitor_profiles` row for whichever
// active check hits `/subscribedSkus` (same discovery `license-waste-source.ts`
// uses) — no dedicated Graph call of its own. Synced after every monitor
// package run that included one of those checks (`executeMonitoringPackage` in
// monitor-executor.ts), so this table tracks Graph state on the platform's
// existing scan cadence rather than a separate job.
export const tenantServicePlansTable = pgTable("tenant_service_plans", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull(),
  /** The M365 tenant GUID — tenants.tenantId, matching tenant_monitor_profiles.tenantId. */
  tenantId: text("tenant_id").notNull(),
  /** Graph's own service-plan GUID (subscribedSkus[].servicePlans[].servicePlanId). */
  servicePlanId: uuid("service_plan_id").notNull(),
  /** Microsoft's real identifier, e.g. "EXCHANGE_S_ENTERPRISE" — never invented. */
  servicePlanName: text("service_plan_name").notNull(),
  /**
   * Microsoft's own (much more granular) category for the plan
   * (servicePlans[].servicePlanType), stored verbatim for reference. NOT what
   * the ownership matrix groups by — see header.
   */
  servicePlanType: text("service_plan_type"),
  /** The parent SKU this plan came from — subscribedSkus[].skuPartNumber. */
  skuPartNumber: text("sku_part_number").notNull(),
  skuId: uuid("sku_id").notNull(),
  /** Always "Success" by construction (see header) — a real column, not assumed, so a future relaxation of the filter doesn't silently change meaning. */
  provisioningStatus: text("provisioning_status").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tenant_service_plans_msp_tenant_plan_idx").on(t.mspId, t.tenantId, t.servicePlanId),
  index("tenant_service_plans_msp_tenant_idx").on(t.mspId, t.tenantId),
]);

export type TenantServicePlan = typeof tenantServicePlansTable.$inferSelect;

// ── Azure Resource Manager reach (#1871) ───────────────────────────────────────
//
// What Azure the platform can actually SEE in a tenant, as last observed. This
// table exists because Azure RBAC is a different control plane from Microsoft
// Entra: `tenants.consent` records Graph app permissions, and those confer
// exactly nothing on https://management.azure.com. Nothing else in the schema
// could answer "can we read this customer's Azure at all, and if not, why not".
//
// Every column is written from a REAL observed HTTP result of the reach probe in
// azure-rm.ts. There is no inferred or default row: a tenant with no row here has
// simply never been probed, which is its own honest state (`never_probed` at the
// read side), distinct from every state below.
//
// The `subscriptions` snapshot is the raw, unedited ARM listing for the tenant —
// id, displayName, state, tenantId, managedByTenants — so a later run can tell a
// revoked grant (subscription vanished from a listing that used to contain it)
// from a tenant that never had Azure.
export const AZURE_RM_REACH_STATES = [
  // GET /subscriptions returned at least one subscription: real Azure reach.
  "ok",
  // 200 + empty listing, and no tenant-root read to corroborate it. We hold no
  // Azure RBAC in this tenant; we cannot conclude anything about what Azure it has.
  "no_rbac",
  // 200 + empty listing AND a readable management-group scope, which covers every
  // subscription in the tenant. Conclusive: the tenant genuinely has no Azure.
  "no_subscriptions",
  // The ARM token itself could not be acquired for this tenant (no service
  // principal in the directory, invalid/expired platform credential, AAD error).
  // Nothing at all is known about the tenant's Azure from this probe.
  "unreachable",
] as const;
export type AzureRmReachState = typeof AZURE_RM_REACH_STATES[number];

export interface AzureRmSubscriptionRef {
  subscriptionId: string;
  displayName: string | null;
  state: string | null;
  tenantId: string | null;
  /** Non-empty when the subscription is delegated to a managing tenant via Azure Lighthouse. */
  managedByTenantIds: string[];
}

export const tenantAzureReachTable = pgTable("tenant_azure_reach", {
  id: serial("id").primaryKey(),
  /** The Entra tenant GUID, matching tenants.tenant_id (text, same as tenant_monitor_profiles). */
  tenantId: text("tenant_id").notNull().unique(),
  state: text("state", { enum: AZURE_RM_REACH_STATES }).notNull(),
  /** Observed: did the client-credentials call for the ARM audience succeed. */
  tokenAcquired: boolean("token_acquired").notNull(),
  /** Observed: HTTP status of GET /subscriptions. NULL when no token was acquired. */
  subscriptionsHttpStatus: integer("subscriptions_http_status"),
  /**
   * Observed: HTTP status of GET /providers/Microsoft.Management/managementGroups.
   * 200 means we hold a tenant-root/management-group read, which is the ONLY thing
   * that makes an empty subscription listing conclusive. 403 is the normal answer
   * for a principal holding only subscription- or resource-group-scoped roles.
   */
  managementGroupsHttpStatus: integer("management_groups_http_status"),
  /** The real ARM listing, as returned. Empty array is a real observation, not a gap. */
  subscriptions: jsonb("subscriptions").$type<AzureRmSubscriptionRef[]>().notNull().default([]),
  /** The app registration (client id) the probe authenticated as — reach is per-principal, not per-tenant. */
  principalClientId: text("principal_client_id"),
  /** The service principal's object id in the probed tenant, from the ARM token's `oid` claim. */
  principalObjectId: text("principal_object_id"),
  /** Verbatim error text when state = 'unreachable'. NULL otherwise. */
  errorMessage: text("error_message"),
  probedAt: timestamp("probed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tenant_azure_reach_state_idx").on(t.state),
]);

export type TenantAzureReach = typeof tenantAzureReachTable.$inferSelect;
export type InsertTenantAzureReach = typeof tenantAzureReachTable.$inferInsert;

// ── Full per-check item detail ─────────────────────────────────────────────────
//
// One row per check per full-item-detail collection run: the COMPLETE fetched
// item list behind a check's count, kept so a remediation document can list
// every affected item rather than a sample.
//
// WHY THIS IS A SEPARATE TABLE AND NOT rawResponse/extra columns on
// tenant_monitor_profiles (the decision, stated once — it mirrors the same
// reasoning simulator_check_runs already records for the same table):
//   * tenant_monitor_profiles.rawResponse is deliberately only the FIRST page
//     (`if (pageCount === 0) rawResponse = page`), and for a CSV usage report
//     only the first five rows (`value: csvRows.slice(0, 5)`). It is a
//     lightweight debug trace, and widening it would change what every existing
//     reader of the production monitoring record is looking at.
//   * The scoring scan computes the full item list and then discards it on
//     purpose, to keep no extra memory on the hot path. That behaviour is
//     unchanged; this table is populated by a SEPARATE package run, so a scan's
//     profile row and this row are different collections of the same check and
//     must stay independently attributable.
//
// THE TRUNCATION RULE, the same one simulator_check_runs follows: a row holds
// the FULL item list or none of it and says why (`items_omitted`). A truncated
// prefix is never stored — a remediation document built from a silent prefix
// would confidently under-report affected items, which is precisely the failure
// this table exists to prevent.
//
// `status` reuses TENANT_MONITOR_PROFILE_STATUS verbatim: a detail collection
// runs the same real checks through the same executor, so it can land in exactly
// the same states (license_gap, requires_script, consent_revoked, partial), and
// giving those a second vocabulary here would invite the two to drift.
export const tenantCheckItemDetailsTable = pgTable("tenant_check_item_details", {
  id: serial("id").primaryKey(),
  detailId: uuid("detail_id").notNull().unique().defaultRandom(),
  /** Groups every check row produced by ONE detail-collection run. */
  runId: uuid("run_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  /** tenants.id when known. Nullable for the same pre-customer/orphaned case msp_diagnostic_runs allows. */
  customerId: integer("customer_id"),
  checkKey: text("check_key").notNull(),
  checkSchemaVersion: integer("check_schema_version").notNull().default(1),
  /** The detail package this run executed — recorded so a later package edit can't rewrite history. */
  packageKey: text("package_key").notNull(),
  /**
   * The executor triggerId this collection used. Deliberately its OWN value,
   * never the scoring run's: the executor's idempotency key is
   * "{tenantId}:{checkKey}:{triggerId}", so sharing a triggerId with the scoring
   * scan would return that run's cached, item-less result instead of fetching.
   */
  triggerId: text("trigger_id").notNull(),
  /**
   * ALWAYS NULL since #543, and kept only so existing rows stay readable.
   *
   * It used to hold the tenant_monitor_profiles row this same collection wrote.
   * That write was the #543 bug — tenant_monitor_profiles is the unscoped
   * scoring surface, so a detail pass writing to it silently became the score
   * (see item-detail-collector.ts's NON-INTERFERENCE #3). The collection no
   * longer writes one, so there is no profile row to point at. Nothing has ever
   * read this column.
   */
  profileId: uuid("profile_id"),
  status: text("status", { enum: TENANT_MONITOR_PROFILE_STATUS }).notNull().default("ok"),
  itemCount: integer("item_count").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  /** The FULL fetched item list — never a prefix. NULL when omitted (see items_omitted). */
  items: jsonb("items").$type<unknown[]>(),
  itemsOmitted: boolean("items_omitted").notNull().default(false),
  itemsOmittedReason: text("items_omitted_reason"),
  errorMessage: text("error_message"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tenant_check_item_details_run_check_idx").on(t.runId, t.checkKey),
  // The primary read: "the most recent complete item list for this check on this
  // tenant" — what a remediation document or a War Room per-item dialog asks for.
  index("tenant_check_item_details_tenant_check_collected_idx").on(t.tenantId, t.checkKey, t.collectedAt),
  index("tenant_check_item_details_tenant_idx").on(t.tenantId),
  index("tenant_check_item_details_run_idx").on(t.runId),
]);

export type TenantCheckItemDetail = typeof tenantCheckItemDetailsTable.$inferSelect;
export type InsertTenantCheckItemDetail = typeof tenantCheckItemDetailsTable.$inferInsert;

// ── overshared_items (#1275, decisions from #1262) ────────────────────────────
//
// One row per (item x grant) — decided granularity — so a search/filter by
// principal or grant kind is a real indexed predicate, never a jsonb scan.
// Sourced today from `tenant_check_item_details.items` for
// `compliance:eeeu-site-sharing` / `onedrive:overshared-files`
// (SiteSharingSummary[] — see sharepoint-sharing.ts), scope='site' only: no
// per-file/per-link descent, site-visibility capture, or named-identity
// resolution yet (#1262's three deferred collection-side follow-ups). Those
// land as new non-null values in `scope`/`item_path`/`principal_upn` without a
// schema change.
//
// `run_id` is a partition key, not a foreign key with an ON DELETE rule —
// snapshots are retained (decision: keep history for trend / "newly
// overshared since last scan"), never pruned by this table itself. A stable
// `natural_key` (tenant+check+site+grant, independent of run_id) is what lets
// `remediation_state` survive a rescan and is the join key a future trend
// query diffs two runs against.
export const OVERSHARED_ITEM_SCOPES = ["site", "library", "folder", "file"] as const;
export type OversharedItemScope = typeof OVERSHARED_ITEM_SCOPES[number];

export const OVERSHARED_ITEM_GRANT_KINDS = [
  "anonymous_link",
  "everyone",
  "eeeu",
  "organization_link",
  "guest",
  "user",
  "group",
  "app",
] as const;
export type OversharedItemGrantKind = typeof OVERSHARED_ITEM_GRANT_KINDS[number];

export const OVERSHARED_ITEM_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type OversharedItemSeverity = typeof OVERSHARED_ITEM_SEVERITIES[number];

export const OVERSHARED_ITEM_REMEDIATION_STATES = ["open", "risk_accepted", "remediating", "remediated"] as const;
export type OversharedItemRemediationState = typeof OVERSHARED_ITEM_REMEDIATION_STATES[number];

export const oversharedItemsTable = pgTable("overshared_items", {
  id: serial("id").primaryKey(),
  itemId: uuid("item_id").notNull().unique().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  customerId: integer("customer_id"),
  runId: uuid("run_id").notNull(),
  checkKey: text("check_key").notNull(),
  scope: text("scope", { enum: OVERSHARED_ITEM_SCOPES }).notNull().default("site"),
  // location
  siteId: text("site_id").notNull(),
  siteName: text("site_name"),
  siteUrl: text("site_url"),
  /** Public/Private — NOT yet captured (#1262 follow-up #2); null until then. */
  siteVisibility: text("site_visibility"),
  isPersonalSite: boolean("is_personal_site").notNull().default(false),
  driveId: text("drive_id"),
  /** Server-relative path of the file/folder; null for a scope='site' row. */
  itemPath: text("item_path"),
  itemWebUrl: text("item_web_url"),
  itemName: text("item_name"),
  // the grant
  grantKind: text("grant_kind", { enum: OVERSHARED_ITEM_GRANT_KINDS }).notNull(),
  principalLabel: text("principal_label"),
  /** Named identity UPN — NOT yet resolved (#1262 follow-up #3); null until then. */
  principalUpn: text("principal_upn"),
  principalId: text("principal_id"),
  loginName: text("login_name"),
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  linkScope: text("link_scope"),
  inherited: boolean("inherited").notNull().default(false),
  permissionId: text("permission_id"),
  // severity / display
  sharingLevel: text("sharing_level"),
  severity: text("severity", { enum: OVERSHARED_ITEM_SEVERITIES }),
  // remediation state — durable, carried forward across rescans by naturalKey
  remediationState: text("remediation_state", { enum: OVERSHARED_ITEM_REMEDIATION_STATES }).notNull().default("open"),
  /** tenant+check+site+grant, independent of run_id — the rescan continuity key. */
  naturalKey: text("natural_key").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("overshared_items_run_natural_key_uidx").on(t.runId, t.naturalKey),
  index("overshared_items_tenant_check_collected_idx").on(t.tenantId, t.checkKey, t.collectedAt),
  index("overshared_items_tenant_state_idx").on(t.tenantId, t.remediationState),
  index("overshared_items_tenant_grant_kind_idx").on(t.tenantId, t.grantKind),
  index("overshared_items_tenant_run_idx").on(t.tenantId, t.runId),
  index("overshared_items_natural_key_idx").on(t.naturalKey),
]);

export type OversharedItem = typeof oversharedItemsTable.$inferSelect;
export type InsertOversharedItem = typeof oversharedItemsTable.$inferInsert;

// ── license_assignment_snapshots (#1291, licence-change detector for #1278) ───
//
// One row per (user x SKU) — mirrors overshared_items's "one row per item x
// grant" granularity, here "one row per user x assigned SKU". Sourced from
// `license:unused-assigned`'s full item list (already linked to
// `detail:full-item-collection`, includeItems:true — see
// item-detail-collector.ts), one real Graph `/users` page per row:
// `{ id, accountEnabled, assignedLicenses: [{ skuId, disabledPlans }], ... }`.
//
// `run_id` is a partition key, not a foreign key — snapshots are retained
// across scans (same retention decision #1275 made for overshared_items), so
// a run-to-run diff (customer-tenant-alert-engine.ts's evalLicenseChange) can
// answer "what assignment changed since the last scan". A stable
// `natural_key` (tenant+user+sku, independent of run_id) is the diff's join
// key — a user keeping the same SKU across two scans is the same row
// identity, not a remove+add.
//
// A user with no assigned licence contributes no row, matching the table's
// purpose: a register of licence ASSIGNMENTS, not a full user inventory.
export const licenseAssignmentSnapshotsTable = pgTable("license_assignment_snapshots", {
  id: serial("id").primaryKey(),
  snapshotId: uuid("snapshot_id").notNull().unique().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  customerId: integer("customer_id"),
  runId: uuid("run_id").notNull(),
  checkKey: text("check_key").notNull(),
  /** Graph user object id (`/users` `id`). No UPN is selected by this check. */
  userId: text("user_id").notNull(),
  accountEnabled: boolean("account_enabled"),
  /** Graph `assignedLicenses[].skuId` — a SKU GUID, not a skuPartNumber. */
  skuId: text("sku_id").notNull(),
  /** tenant+user+sku, independent of run_id — the rescan diff identity. */
  naturalKey: text("natural_key").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("license_assignment_snapshots_run_natural_key_uidx").on(t.runId, t.naturalKey),
  index("license_assignment_snapshots_tenant_collected_idx").on(t.tenantId, t.collectedAt),
  index("license_assignment_snapshots_customer_run_idx").on(t.customerId, t.runId),
  index("license_assignment_snapshots_natural_key_idx").on(t.naturalKey),
]);

export type LicenseAssignmentSnapshot = typeof licenseAssignmentSnapshotsTable.$inferSelect;
export type InsertLicenseAssignmentSnapshot = typeof licenseAssignmentSnapshotsTable.$inferInsert;

export const monitorCheckAuditLogTable = pgTable("monitor_check_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  checkKey: text("check_key"),
  packageKey: text("package_key"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  adminUserId: integer("admin_user_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("monitor_check_audit_log_check_key_idx").on(t.checkKey),
  index("monitor_check_audit_log_created_at_idx").on(t.createdAt),
]);

export type MonitorCheckAuditLog = typeof monitorCheckAuditLogTable.$inferSelect;

// ── Simulator Studio check runs ────────────────────────────────────────────────
//
// Durable history for the Simulator Studio's "M365 Endpoints" node: one row per
// ad-hoc run an operator started from the Studio, so history, bulk-run batches
// and run-to-run diffs survive an api-server restart.
//
// WHY A SEPARATE TABLE, NOT tenant_monitor_profiles (the decision, stated once):
// tenant_monitor_profiles is the PRODUCTION monitoring record. Every row in it is
// read back by mergeMonitorProfileRows/buildTenantProfile to compute a tenant's
// real signal profile and pillar scores, and it is keyed on an idempotency key
// that exists precisely to stop duplicate collection. Simulator runs deliberately
// pass skipIdempotency and re-run the same check over and over; folding their
// operator-workflow state (progress, statusText, batch grouping, a saved engine
// trace) into that table would put ad-hoc test metadata on the live signal path
// and make "is this row real monitoring data?" unanswerable from the row itself.
// The two also disagree on payload: rawResponse there is deliberately only the
// FIRST page (five rows for a CSV report), whereas a simulator run must keep the
// untruncated item list for its trace. executeMonitorCheck still writes its own
// tenant_monitor_profiles row on every simulator run, so nothing is lost — this
// table is additive, and holds only what the Studio itself needs.

export const SIMULATOR_CHECK_RUN_STATUS = ["pending", "running", "completed", "failed"] as const;
export type SimulatorCheckRunStatus = typeof SIMULATOR_CHECK_RUN_STATUS[number];

export const simulatorCheckRunsTable = pgTable("simulator_check_runs", {
  id: serial("id").primaryKey(),
  /** The runId the API hands back and the UI polls — generated by the route, not the DB. */
  runId: uuid("run_id").notNull().unique(),
  /** Set when the run was started as part of a bulk "run every check in this domain" batch. */
  batchId: uuid("batch_id"),
  checkKey: text("check_key").notNull(),
  checkLabel: text("check_label").notNull(),
  customerId: integer("customer_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  status: text("status", { enum: SIMULATOR_CHECK_RUN_STATUS }).notNull().default("pending"),
  /** The human-readable line shown next to the progress bar. */
  statusText: text("status_text").notNull().default(""),
  progress: integer("progress").notNull().default(0),
  // ── Denormalised from `result` ──
  // The history list and the bulk-run summary aggregate on these, so neither has
  // to load every run's full result payload just to count ok/error/license_gap.
  /** CheckResult.status: ok | error | consent_revoked | requires_script | license_gap. */
  resultStatus: text("result_status"),
  itemCount: integer("item_count"),
  pageCount: integer("page_count"),
  severityMatched: text("severity_matched"),
  licenseFeature: text("license_feature"),
  errorMessage: text("error_message"),
  /**
   * The real resolved request the executor was asked to run (endpoint/method/body),
   * plus — once the run finishes — `capturedRequests`: what ACTUALLY went out on
   * the wire (#393), one entry per real fetch including nextLink pages and the
   * fresh-token retry. The two are deliberately in one column: the asked-for
   * request and the sent request are the same subject, and reading them apart is
   * the whole diagnostic. Untyped here (`unknown[]`) so the capture's shape stays
   * owned by api-server's graph-request-capture.ts rather than the schema.
   */
  request: jsonb("request").$type<{
    endpoint: string;
    method: string;
    requestBody: unknown;
    capturedRequests?: unknown[];
    capturedRequestsNote?: string;
  }>().notNull(),
  /** The real CheckResult from monitor-executor, minus `items` (which has its own column). */
  result: jsonb("result").$type<Record<string, unknown>>(),
  /**
   * The FULL captured item list — never a truncated prefix.
   *
   * This is the Phase 2 lesson carried into storage: tenant_monitor_profiles
   * .rawResponse holds only page 1, so re-applying a mapping to it reports wrong
   * counts on every paginated check. If a response is too large to persist, this
   * column is left NULL and `items_omitted` is set — an EXPLICIT "we don't have
   * the response" the trace/diff routes refuse on, never a silent short list that
   * would produce a confident wrong number.
   */
  items: jsonb("items").$type<unknown[]>(),
  itemsOmitted: boolean("items_omitted").notNull().default(false),
  itemsOmittedReason: text("items_omitted_reason"),
  /** Mapping/properties snapshotted at run time, so a later catalog edit can't rewrite history. */
  mapping: jsonb("mapping").$type<Array<{ sourceField: string; targetField: string; transform?: string }>>().notNull().default([]),
  properties: jsonb("properties").$type<string[]>().notNull().default([]),
  /** The last engine trace run against this run, if any. */
  trace: jsonb("trace").$type<Record<string, unknown>>(),
  tracedAt: timestamp("traced_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("simulator_check_runs_run_id_idx").on(t.runId),
  index("simulator_check_runs_check_key_started_idx").on(t.checkKey, t.startedAt),
  index("simulator_check_runs_batch_id_idx").on(t.batchId),
  index("simulator_check_runs_customer_id_idx").on(t.customerId),
]);

export type SimulatorCheckRun = typeof simulatorCheckRunsTable.$inferSelect;
export type InsertSimulatorCheckRun = typeof simulatorCheckRunsTable.$inferInsert;

// ── M365 Message Center items ──────────────────────────────────────────────────
// One row per Graph serviceAnnouncement message per tenant, populated by the
// message-center-sync job. Distinct from tenant_monitor_profiles (which stores
// per-run aggregates) — this is a per-item table so genuinely-new messages can
// be diffed against previously-seen ones.

export const mspMessageCenterItemsTable = pgTable("msp_message_center_items", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  graphMessageId: text("graph_message_id").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  severity: text("severity"),
  isMajorChange: boolean("is_major_change").notNull().default(false),
  services: jsonb("services").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  bodyContentType: text("body_content_type"),
  bodyContent: text("body_content"),
  // #1531 — the roadmap feature ID(s) this post's own body.content references
  // (e.g. "Roadmap ID 124981", or a microsoft.com/roadmap link carrying the ID),
  // parsed ONCE at sync time by m365-roadmap-mc-link.ts's extractRoadmapFeatureIds
  // rather than re-parsed on every read. This is the cross-source join key back to
  // m365_roadmap_items.feature_id (#1530) — a GIN index for containment queries
  // (roadmap_feature_ids @> '["124981"]') is added in the manual migration, not
  // here, mirroring m365_roadmap_items.cloud_instances' own convention.
  roadmapFeatureIds: jsonb("roadmap_feature_ids").$type<string[]>().notNull().default([]),
  // #1536 — the prose date phrase Microsoft's own "[Rollout Schedule]" section
  // carries (e.g. "Rollout begins in mid-October 2026 and is expected to
  // complete by late November 2026"), parsed ONCE from bodyContent at sync
  // time by m365-message-center-date-quality.ts's extractAdvisoryDateText().
  // This is ADVISORY ONLY: it is rendered verbatim beside the structural dates
  // below, never parsed into a real Date, never used to place a post in a
  // bucket, and never substituted into actionRequiredByDateTime. Nullable —
  // most posts have no such section, and that is a real, honest null, not a
  // sync failure.
  advisoryDateText: text("advisory_date_text"),
  startDateTime: timestamp("start_date_time", { withTimezone: true }),
  endDateTime: timestamp("end_date_time", { withTimezone: true }),
  actionRequiredByDateTime: timestamp("action_required_by_date_time", { withTimezone: true }),
  lastModifiedDateTime: timestamp("last_modified_date_time", { withTimezone: true }).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_message_center_items_tenant_msg_idx").on(t.tenantId, t.graphMessageId),
  index("msp_message_center_items_msp_id_idx").on(t.mspId),
  index("msp_message_center_items_last_modified_idx").on(t.lastModifiedDateTime),
]);

export type MspMessageCenterItem = typeof mspMessageCenterItemsTable.$inferSelect;
export type InsertMspMessageCenterItem = typeof mspMessageCenterItemsTable.$inferInsert;

// ── M365 Service Health Samples ──────────────────────────────────────────────────
// Hourly per-tenant, per-service Graph healthOverviews snapshots. The
// m365:service-health monitor check itself is live-fetch-only (see its
// migration's own comment — no per-tenant items persisted, built only to
// answer "what's the status right now" for the public status page), so this
// is the first table that actually accumulates history for it. Populated by
// the "__system__: M365 Service Health Sampling" seeded workflow; read by
// sla-uptime.ts to compute time-weighted Uptime Percentage against
// Microsoft's 99.9% Monthly Uptime Percentage SLA commitment.

export const m365ServiceHealthSamplesTable = pgTable("m365_service_health_samples", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  service: text("service").notNull(),
  status: text("status").notNull(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("m365_service_health_samples_service_sampled_idx").on(t.service, t.sampledAt),
  index("m365_service_health_samples_tenant_service_sampled_idx").on(t.tenantId, t.service, t.sampledAt),
]);

export type M365ServiceHealthSample = typeof m365ServiceHealthSamplesTable.$inferSelect;
export type InsertM365ServiceHealthSample = typeof m365ServiceHealthSamplesTable.$inferInsert;

// ── M365 Roadmap items (#1530, part of #1494) ────────────────────────────────────
// One row per Microsoft 365 Roadmap feature, populated from the PUBLIC,
// unauthenticated release-communications API — not Graph, no consent, no tenant
// scoping. The roadmap is a GLOBAL feed (what Microsoft *intends*, published
// months ahead), so this table is deliberately not tenant/msp-scoped the way
// msp_message_center_items is. The bridge to a specific tenant's estate (the
// per-tenant "how many objects does this touch" resolution layer) is a separate
// concern joined later on featureId — the roadmap feature ID that Message Center
// posts routinely carry (#1494's stated join key).
//
// cloudInstances is the source of truth for the standing gov/GCC exclusion
// (#1537): every roadmap item carries its cloud instances (e.g. "Worldwide
// (Standard Multi-Tenant)", "GCC", "GCC High", "DoD"). In v1 this arrives as
// tagsContainer.cloudInstances[].tagName; the equivalent v2 OData shape is the
// `availabilities` complex type. Stored as a jsonb string[] (a GIN index for
// containment filtering is added in the manual migration, not here) so exclusion
// is enforced from real data rather than an assumption.

export const m365RoadmapItemsTable = pgTable("m365_roadmap_items", {
  id: serial("id").primaryKey(),
  featureId: text("feature_id").notNull(), // Microsoft roadmap feature ID — the cross-source join key to Message Center posts
  title: text("title").notNull(),
  description: text("description"),
  status: text("status"), // "In development" | "Rolling out" | "Launched" (Microsoft's publicRoadmapStatus text)
  moreInfoLink: text("more_info_link"),
  products: jsonb("products").$type<string[]>().notNull().default([]),
  releasePhases: jsonb("release_phases").$type<string[]>().notNull().default([]),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  cloudInstances: jsonb("cloud_instances").$type<string[]>().notNull().default([]), // #1537 gov/GCC exclusion source of truth
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  publicDisclosureAvailabilityDate: text("public_disclosure_availability_date"), // often a coarse string ("September CY2024"), not a parseable date — kept verbatim
  msCreated: timestamp("ms_created", { withTimezone: true }), // Microsoft's own created timestamp
  msModified: timestamp("ms_modified", { withTimezone: true }), // Microsoft's own modified timestamp — diffs genuinely-changed items
  source: text("source").notNull(), // "v1" | "v2" — which feed last wrote this row
  raw: jsonb("raw"), // full raw item, retained for the later re-interpretation/resolution layer (#1494)
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("m365_roadmap_items_feature_id_idx").on(t.featureId),
  index("m365_roadmap_items_status_idx").on(t.status),
  index("m365_roadmap_items_ms_modified_idx").on(t.msModified),
]);

export type M365RoadmapItem = typeof m365RoadmapItemsTable.$inferSelect;
export type InsertM365RoadmapItem = typeof m365RoadmapItemsTable.$inferInsert;

// ── M365 Roadmap sync state (#1530) ──────────────────────────────────────────────
// One row per source feed ("v1"/"v2"), recording the last attempt/success of the
// roadmap sync. This is the schema backing for the HONEST-DEGRADE requirement:
// Microsoft has already relocated this endpoint once (15 Mar 2025), so the sync
// must never present stale roadmap data as current. On a failed/relocated fetch
// the sync updates lastAttemptAt + lastStatus='error' + lastError but LEAVES the
// items untouched and does NOT advance lastSuccessAt — a reader compares
// lastSuccessAt against now to decide whether to serve the data as fresh, surface
// a staleness banner, or fall back to an honest "roadmap not collected" state
// (never fixture content).

export const m365RoadmapSyncStateTable = pgTable("m365_roadmap_sync_state", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // "v1" | "v2"
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastStatus: text("last_status").notNull().default("never"), // "never" | "ok" | "error"
  lastError: text("last_error"),
  lastItemCount: integer("last_item_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("m365_roadmap_sync_state_source_idx").on(t.source),
]);

export type M365RoadmapSyncState = typeof m365RoadmapSyncStateTable.$inferSelect;
export type InsertM365RoadmapSyncState = typeof m365RoadmapSyncStateTable.$inferInsert;

// ── M365 Change Interpretations (#1532, part of #1494) ───────────────────────────
// The INTERPRETATION layer of the Microsoft Changes module. #1494's split:
// *interpretation is universal, resolution is per-tenant.* A Message Center post
// or roadmap item is prose about a CLASS of change ("EWS retirement means apps and
// mailboxes using EWS must migrate to Graph") — true for every tenant on earth, so
// it is authored ONCE and every tenant's resolution layer reuses it. The per-tenant
// "you have 412 mailboxes with EWS enabled" number is NOT here — that is the
// separate resolution layer joined later on `featureId` / `probe`.
//
// Authoring model (#1532, resolved 2026-08-28): Shane authors, AI proposes. The AI
// reads a roadmap item's description or a Message Center post's bodyContent and
// PROPOSES the structured reading (status 'proposed'); Shane CONFIRMS it (status
// 'confirmed') before it is ever applied to a tenant. No unverified interpretation
// reaches a customer — the named risk being *an LLM confidently inventing an opt-out
// procedure that does not exist.* `status` is the gate the resolution layer reads:
// only a 'confirmed' row may drive a tenant-facing answer.
//
// Structurally PER-MSP even though there is one MSP today (#1532): the library is
// scoped by `mspId` so a second MSP — or the NASA extraction — owns its own
// interpretations rather than inheriting a shared global one. `feature_id` is the
// cross-source join key (the roadmap feature ID that Message Center posts carry,
// #1494); `graph_message_id` links the Message Center source when there is one.

export const M365_CHANGE_CLASSES = [
  "retirement",
  "default_flip",
  "new_feature",
  "breaking_change",
  "licensing",
] as const;
export type M365ChangeClass = (typeof M365_CHANGE_CLASSES)[number];

export const M365_INTERPRETATION_STATUSES = ["proposed", "confirmed", "rejected"] as const;
export type M365InterpretationStatus = (typeof M365_INTERPRETATION_STATUSES)[number];

/** Who has to act for the change to take effect. */
export const M365_ACTORS = ["microsoft", "admin"] as const;
export type M365Actor = (typeof M365_ACTORS)[number];

/** Whether the change can be turned off / opted out of. `unknown` is the honest default. */
export const M365_CONTROLLABILITY = ["yes", "no", "unknown"] as const;
export type M365Controllability = (typeof M365_CONTROLLABILITY)[number];

/**
 * What a change touches — kept as a structured object rather than free prose so the
 * resolution layer can map it onto real estate. Each field is a plain list; any
 * combination may be empty. `services` are M365 service names (Exchange, Purview…),
 * `protocols` low-level protocols (EWS, Basic Auth…), `skus` license SKUs the change
 * bears on (Project Online, E5…), `settings` tenant/admin settings the change flips.
 */
export interface M365Touches {
  services: string[];
  protocols: string[];
  skus: string[];
  settings: string[];
}

/**
 * The probe — #1494's bridge to resolution: *what to count in a tenant to know
 * whether this applies.* `description` is the plain-language count target; the
 * optional structured hints let the resolution layer wire it to real probe
 * infrastructure (`monitor_checks`, or the live PowerShell path for Exchange/Purview
 * where Graph will not answer) without re-reading the prose. Nothing here computes a
 * number — this only *states what to count*; the number is the resolution layer's job.
 */
export interface M365Probe {
  description: string;
  monitorCheckKey?: string | null;
  powershell?: string | null;
  graphEndpoint?: string | null;
}

export const m365ChangeInterpretationsTable = pgTable("m365_change_interpretations", {
  id: serial("id").primaryKey(),
  // Per-MSP scoping (#1532): the interpretation library belongs to one MSP, so a
  // second MSP / the NASA extraction owns its own rather than a shared global one.
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // Cross-source join keys (#1494). featureId ties to m365_roadmap_items.feature_id;
  // graphMessageId ties to msp_message_center_items.graph_message_id. Either, both,
  // or neither (a hand-authored interpretation with no single source) may be set.
  featureId: text("feature_id"),
  graphMessageId: text("graph_message_id"),
  sourceKind: text("source_kind").notNull().default("roadmap"), // "roadmap" | "message_center" | "manual"
  title: text("title").notNull(),
  summary: text("summary"), // plain-language "what is changing", the reframe of Microsoft's prose
  changeClass: text("change_class").$type<M365ChangeClass>().notNull(),
  touches: jsonb("touches").$type<M365Touches>().notNull().default({ services: [], protocols: [], skus: [], settings: [] }),
  whoActs: text("who_acts").$type<M365Actor>().notNull().default("microsoft"),
  controllable: text("controllable").$type<M365Controllability>().notNull().default("unknown"),
  controlMethod: text("control_method"), // HOW to turn it off — only meaningful when controllable = 'yes'
  probe: jsonb("probe").$type<M365Probe>().notNull().default({ description: "" }),
  // The confirmation gate. 'proposed' = AI's unverified reading, never tenant-facing;
  // 'confirmed' = Shane verified it and it may drive resolution; 'rejected' = read and
  // discarded (kept so the same source is not re-proposed blindly).
  status: text("status").$type<M365InterpretationStatus>().notNull().default("proposed"),
  proposedBy: text("proposed_by").notNull().default("ai"), // "ai" | "human"
  aiModel: text("ai_model"), // the model that produced a 'proposed' reading, for provenance
  aiRationale: text("ai_rationale"), // why the AI read it this way — shown to Shane at confirm time
  confirmedBy: text("confirmed_by"), // the admin identity that confirmed it
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("m365_change_interpretations_msp_id_idx").on(t.mspId),
  index("m365_change_interpretations_feature_id_idx").on(t.featureId),
  index("m365_change_interpretations_status_idx").on(t.status),
  // One interpretation per roadmap feature per MSP (partial — hand-authored rows with
  // no featureId are exempt). Declared in the manual migration, not here, because
  // Drizzle cannot express a partial unique index in the table builder.
]);

export type M365ChangeInterpretation = typeof m365ChangeInterpretationsTable.$inferSelect;
export type InsertM365ChangeInterpretation = typeof m365ChangeInterpretationsTable.$inferInsert;

// ── M365 Change Resolutions (#1533, part of #1494) ────────────────────────────
// The RESOLUTION layer — the other half of #1494's split. An interpretation names
// WHAT to count; a resolution row is that count actually run against ONE tenant's
// real estate: "you have 412 mailboxes with EWS enabled". One row per
// (interpretation × customer), overwritten on re-measure rather than appended —
// this is the tenant's CURRENT answer, not a history.
//
// The number is the hinge (#1533): zero affected objects = the post is noise for
// that customer; non-zero with a deadline = the routing trigger. So zero must only
// ever be a MEASURED zero. Where no probe exists or the probe could not run,
// `status` is 'not_measured' and `affected_count` is NULL — never 0 — and the
// portal keeps its honest-empty wording ("your tenant has not been read against
// this notice").
//
// No second probe mechanism: `basis` records which EXISTING infrastructure
// produced the number — a `monitor_checks` run (via tenant_monitor_profiles or a
// live executeMonitorCheck, which itself dispatches Graph / ca-ps-execution
// PowerShell / sharepoint-admin / dns by the check's own executorType), or
// `license_assignment_snapshots` for the SKU cases (Project Online retiring while
// the tenant holds the licence).

export const M365_RESOLUTION_STATUSES = ["measured", "not_measured", "error"] as const;
export type M365ResolutionStatus = (typeof M365_RESOLUTION_STATUSES)[number];

/** Which existing probe infrastructure produced a measured number. */
export const M365_RESOLUTION_BASES = ["monitor_check", "license_snapshot"] as const;
export type M365ResolutionBasis = (typeof M365_RESOLUTION_BASES)[number];

/**
 * Why a resolution is 'not_measured' — stored so the admin surface can say
 * exactly what is missing instead of a vague "no data". `no_probe` is the honest
 * "no probe exists for this interpretation" case #1533 names; the rest are a
 * probe that exists but could not answer for THIS tenant.
 */
export const M365_NOT_MEASURED_REASONS = [
  "no_probe",
  "check_not_found",
  "no_stored_profile",
  "sku_not_mapped",
  "no_sku_data",
  "license_gap",
  "consent_revoked",
  "requires_script",
  /** Git #1847 — the Microsoft service behind the probe does not answer for this tenant. */
  "service_not_configured",
] as const;
export type M365NotMeasuredReason = (typeof M365_NOT_MEASURED_REASONS)[number];

/** Provenance of one resolution — what was counted, from where, when. */
export interface M365ResolutionBasisDetail {
  /** monitor_check basis: the monitor_checks.key that was counted. */
  checkKey?: string;
  /** monitor_check basis: true = a live executeMonitorCheck run; false = the latest stored tenant_monitor_profiles row. */
  live?: boolean;
  /** monitor_check basis: the profile's own status ('ok' | 'partial') — partial means real but incomplete coverage. */
  profileStatus?: string;
  /** monitor_check basis (stored profile) / license_snapshot basis: when the underlying data was collected (ISO). */
  collectedAt?: string;
  /** license_snapshot basis: the touches.skus entries that matched subscribed SKUs, as (skuPartNumber → skuId). */
  matchedSkus?: Record<string, string>;
  /** license_snapshot basis: touches.skus entries that matched NOTHING subscribed (kept for the admin to fix the naming). */
  unmatchedSkus?: string[];
  /** license_snapshot basis: the license_assignment_snapshots run the users were counted in. */
  snapshotRunId?: string;
  /** license_snapshot basis without per-user snapshot rows: the count is the subscribed SKUs' own consumedUnits sum. */
  source?: "assignment_snapshot" | "subscribed_skus_consumed";
  /** not_measured: the structured reason (see M365_NOT_MEASURED_REASONS). */
  reason?: M365NotMeasuredReason;
}

export const m365ChangeResolutionsTable = pgTable("m365_change_resolutions", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // tenants.id — the same id space the portal's JWT customerId claim carries.
  // No FK by design, matching msp_message_center_items.customer_id (Phase 0
  // successor id-space; see that column's comment).
  customerId: integer("customer_id").notNull(),
  /** The M365 tenant GUID the count was run against, for provenance. */
  tenantId: text("tenant_id").notNull(),
  interpretationId: integer("interpretation_id").notNull()
    .references(() => m365ChangeInterpretationsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<M365ResolutionStatus>().notNull(),
  /** The number. NULL unless status = 'measured' — a not-measured answer is never zero. */
  affectedCount: integer("affected_count"),
  basis: text("basis").$type<M365ResolutionBasis>(),
  basisDetail: jsonb("basis_detail").$type<M365ResolutionBasisDetail>().notNull().default({}),
  errorMessage: text("error_message"),
  /** When the number was actually computed. NULL unless status = 'measured'. */
  measuredAt: timestamp("measured_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The upsert identity: one current answer per interpretation per customer.
  unique("m365_change_resolutions_interp_customer_uidx").on(t.interpretationId, t.customerId),
  index("m365_change_resolutions_msp_id_idx").on(t.mspId),
  index("m365_change_resolutions_customer_id_idx").on(t.customerId),
  index("m365_change_resolutions_interpretation_idx").on(t.interpretationId),
]);

export type M365ChangeResolution = typeof m365ChangeResolutionsTable.$inferSelect;
export type InsertM365ChangeResolution = typeof m365ChangeResolutionsTable.$inferInsert;

// ── M365 Change Routings (#1534, part of #1494) ────────────────────────────────
// The ROUTING layer — the third stage after interpretation (#1532, WHAT it is)
// and resolution (#1533, HOW MANY objects it touches here). Routing decides what
// a resolved change BECOMES, and records that decision as a durable ledger so the
// nightly sweep is idempotent and so a "proposed" outcome — which by design does
// NOT create a Change Request — still has somewhere real to live.
//
// One row per (interpretation × customer), upserted on re-run, mirroring the
// resolution table's own identity. Shane's settled rule (#1534, 2026-08-28):
//   • measured, affected_count > 0, AND a real structural date on the tenant's
//     Message Center post  → decision 'auto_created': a CR is created with
//     Microsoft as implementer, and change_request_id points at it.
//   • undated (incl. #1536's "date unclear") OR zero affected objects
//     → decision 'proposed': NO CR is created; this row is the proposal.
//   • a routed CR later declined by the customer → decision 'declined_risk',
//     risk_decision_id points at the accepted-risk record (#1514).
//   • nothing to route yet (not measured / no announcement) → decision 'none'.
// The gate above is the ONLY noise control — there is deliberately no second
// suppression mechanism.

export const M365_ROUTING_DECISIONS = ["auto_created", "proposed", "declined_risk", "none"] as const;
export type M365RoutingDecision = (typeof M365_ROUTING_DECISIONS)[number];

/** Why a resolved change was proposed or skipped rather than auto-created — stated, not guessed. */
export const M365_ROUTING_REASONS = [
  "auto_created",
  "undated",
  "zero_affected",
  "not_measured",
  "no_announcement",
] as const;
export type M365RoutingReason = (typeof M365_ROUTING_REASONS)[number];

export const m365ChangeRoutingsTable = pgTable("m365_change_routings", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // tenants.id — same id space the portal JWT customerId claim carries, matching
  // m365_change_resolutions.customer_id. No FK by design (Phase 0 successor id-space).
  customerId: integer("customer_id").notNull(),
  /** The M365 tenant GUID routed against, for provenance. */
  tenantId: text("tenant_id").notNull(),
  interpretationId: integer("interpretation_id").notNull()
    .references(() => m365ChangeInterpretationsTable.id, { onDelete: "cascade" }),
  /** The resolution (the count) that this routing decision was taken against. NULL when decision = 'none'. */
  resolutionId: integer("resolution_id"),
  /** The tenant's Message Center announcement this change routed from, when one exists. */
  graphMessageId: text("graph_message_id"),
  decision: text("decision").$type<M365RoutingDecision>().notNull(),
  reason: text("reason").$type<M365RoutingReason>().notNull(),
  /** The intake axis computed for this change (#1534). NULL when nothing was routed. */
  intake: text("intake").$type<ChangeRequestIntake>(),
  /** The affected-object count at routing time — a snapshot, for the proposal surface. NULL when not measured. */
  affectedCount: integer("affected_count"),
  /** Whether the announcement carried a real structural date at routing time. */
  hasStructuralDate: boolean("has_structural_date").notNull().default(false),
  /** Set when decision = 'auto_created': the msp_change_requests row created. */
  changeRequestId: integer("change_request_id"),
  /** Set when decision = 'declined_risk': the msp_risk_decisions row the rejection became. */
  riskDecisionId: integer("risk_decision_id"),
  routedAt: timestamp("routed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The upsert identity: one current routing decision per interpretation per customer.
  unique("m365_change_routings_interp_customer_uidx").on(t.interpretationId, t.customerId),
  index("m365_change_routings_msp_id_idx").on(t.mspId),
  index("m365_change_routings_customer_id_idx").on(t.customerId),
  index("m365_change_routings_decision_idx").on(t.decision),
  index("m365_change_routings_change_request_idx").on(t.changeRequestId),
]);

export type M365ChangeRouting = typeof m365ChangeRoutingsTable.$inferSelect;
export type InsertM365ChangeRouting = typeof m365ChangeRoutingsTable.$inferInsert;

// ── Report Definitions ─────────────────────────────────────────────────────────
// MSP-authored templates that describe what to generate, for whom, and how to
// deliver it. One definition can be triggered many times (→ report_runs rows).

export const REPORT_DOC_TYPES = [
  "executive_summary",
  "full_readiness_report",
  "security_posture_report",
  "governance_maturity_report",
  "data_exposure_risk_report",
  "license_optimization_report",
  "license_waste_report",
  // #1512 — the rendered, signable RBD document. Deterministic template render
  // of a `msp_rbd_versions.content` snapshot, never an AI generation — see
  // `rbd-document-render.ts`. Distinct from the report-builder's AI-authored
  // types above, but stored through the same `msp_report_runs` machinery
  // rather than a parallel render path.
  "risk_decision_document",
] as const;
export type ReportDocType = typeof REPORT_DOC_TYPES[number];

export const REPORT_DELIVERY_METHODS = ["in_app", "email", "both"] as const;
export type ReportDeliveryMethod = typeof REPORT_DELIVERY_METHODS[number];

export const mspReportDefinitionsTable = pgTable("msp_report_definitions", {
  id: serial("id").primaryKey(),
  definitionId: uuid("definition_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // Optional scope — null means "across all customers"
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  name: text("name").notNull(),
  description: text("description"),
  docType: text("doc_type", { enum: REPORT_DOC_TYPES }).notNull().default("executive_summary"),
  // Delivery preferences
  deliveryMethod: text("delivery_method", { enum: REPORT_DELIVERY_METHODS }).notNull().default("in_app"),
  // For email delivery — to address (resolved from customer if null)
  deliveryEmail: text("delivery_email"),
  // Optional extra context fed into the AI prompt
  fieldMappings: jsonb("field_mappings").$type<Record<string, unknown>>().notNull().default({}),
  // Workflow schedule/trigger config
  scheduleConfig: jsonb("schedule_config").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_report_defs_msp_id_idx").on(t.mspId),
  index("msp_report_defs_customer_id_idx").on(t.customerId),
]);

export type MspReportDefinition = typeof mspReportDefinitionsTable.$inferSelect;
export type InsertMspReportDefinition = typeof mspReportDefinitionsTable.$inferInsert;

// ── Report Runs ────────────────────────────────────────────────────────────────
// One row per triggered generation. Tracks lifecycle, stores the generated PDF
// as base64 in pdfContent (for in-app download), and records delivery outcome.

export const REPORT_RUN_STATUSES = ["pending", "generating", "generated", "delivering", "delivered", "failed"] as const;
export type ReportRunStatus = typeof REPORT_RUN_STATUSES[number];

export const mspReportRunsTable = pgTable("msp_report_runs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().unique().defaultRandom(),
  definitionId: uuid("definition_id").notNull().references(() => mspReportDefinitionsTable.definitionId, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  title: text("title").notNull(),
  docType: text("doc_type", { enum: REPORT_DOC_TYPES }).notNull(),
  status: text("status", { enum: REPORT_RUN_STATUSES }).notNull().default("pending"),
  // Generated HTML content
  htmlContent: text("html_content"),
  // Generated PDF as base64 (null until generated)
  pdfBase64: text("pdf_base64"),
  pdfSizeBytes: integer("pdf_size_bytes"),
  // Delivery outcome
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveryEmail: text("delivery_email"),
  // Error message if failed
  errorMessage: text("error_message"),
  // Workflow run reference (if generated via workflow)
  workflowRunId: uuid("workflow_run_id"),
  triggeredByUserId: integer("triggered_by_user_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  /** #1512 — set only for `docType = "risk_decision_document"` runs: the
   * `msp_rbd_versions.versionUid` this run rendered. No FK by design, same
   * convention as `customerId` above — a version render must never be blocked
   * by, or block, the version row's own lifecycle. Lets a caller look up "the
   * persisted render for version X" without a parallel storage table. */
  rbdVersionUid: uuid("rbd_version_uid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_report_runs_msp_id_idx").on(t.mspId),
  index("msp_report_runs_def_id_idx").on(t.definitionId),
  index("msp_report_runs_status_idx").on(t.status),
  index("msp_report_runs_rbd_version_uid_idx").on(t.rbdVersionUid),
]);

export type MspReportRun = typeof mspReportRunsTable.$inferSelect;
export type InsertMspReportRun = typeof mspReportRunsTable.$inferInsert;

// ── MSP Custom Domains ─────────────────────────────────────────────────────────
// One verified custom domain per MSP (e.g. portal.acmeit.com).
// Verification uses a TXT record on the apex of the custom domain.
// Status flow: pending → verified (or failed if DNS lookup mismatches).
// A missing/unverified row means the MSP uses the default /portal/{tenantSlug} URL.

export const MSP_CUSTOM_DOMAIN_STATUSES = ["pending", "verified", "failed"] as const;
export type MspCustomDomainStatus = typeof MSP_CUSTOM_DOMAIN_STATUSES[number];

export const mspCustomDomainsTable = pgTable("msp_custom_domains", {
  id: serial("id").primaryKey(),
  // Each MSP can register at most one custom domain (unique on mspId)
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }).unique(),
  // The custom domain the MSP wants to point at the portal (e.g. portal.acmeit.com)
  domain: text("domain").notNull().unique(),
  // Verification token embedded as a TXT record value: _msp-platform-verify=<token>
  verificationToken: text("verification_token").notNull(),
  verificationStatus: text("verification_status", { enum: MSP_CUSTOM_DOMAIN_STATUSES })
    .notNull()
    .default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_custom_domains_msp_id_idx").on(t.mspId),
  index("msp_custom_domains_domain_idx").on(t.domain),
]);

export type MspCustomDomain = typeof mspCustomDomainsTable.$inferSelect;
export type InsertMspCustomDomain = typeof mspCustomDomainsTable.$inferInsert;

// ── MSP Sales Bundles ──────────────────────────────────────────────────────────
// MSP-owned metadata representing a named, priced collection of Monitoring
// Packages that MSPs market and sell to their customers. The MSP never authors
// the underlying Monitor Checks or Monitoring Packages — those stay
// platform-only. The MSP sets their own resale price with unrestricted markup.

export const MSP_SALES_BUNDLE_STATUS = ["draft", "active", "archived"] as const;
export type MspSalesBundleStatus = typeof MSP_SALES_BUNDLE_STATUS[number];

export const mspSalesBundlesTable = pgTable("msp_sales_bundles", {
  id: serial("id").primaryKey(),
  bundleId: uuid("bundle_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Ordered list of monitoring_packages.key values included in this bundle */
  monitoringPackageKeys: jsonb("monitoring_package_keys").$type<string[]>().notNull().default([]),
  /** Platform-computed MSP internal cost in cents (sum of platformCostCents per package) */
  internalCostCents: integer("internal_cost_cents").notNull().default(0),
  /** MSP-set resale price in cents (unrestricted markup) */
  resalePriceCents: integer("resale_price_cents").notNull().default(0),
  status: text("status", { enum: MSP_SALES_BUNDLE_STATUS }).notNull().default("draft"),
  /** Optional trial period in days the MSP offers to customers (null = no trial) */
  trialDays: integer("trial_days"),
  createdByUserId: integer("created_by_user_id"),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sales_bundles_msp_id_idx").on(t.mspId),
  index("msp_sales_bundles_status_idx").on(t.status),
]);

export type MspSalesBundle = typeof mspSalesBundlesTable.$inferSelect;
export type InsertMspSalesBundle = typeof mspSalesBundlesTable.$inferInsert;

// ── MSP Sales Bundle Assignments ───────────────────────────────────────────────
// One row per (bundle, customer) assignment. Activates the underlying monitoring
// packages' execution for the customer's tenantId.

export const MSP_BUNDLE_ASSIGNMENT_STATUS = ["active", "suspended", "revoked"] as const;
export type MspBundleAssignmentStatus = typeof MSP_BUNDLE_ASSIGNMENT_STATUS[number];

export const mspSalesBundleAssignmentsTable = pgTable("msp_sales_bundle_assignments", {
  id: serial("id").primaryKey(),
  assignmentId: uuid("assignment_id").notNull().unique().defaultRandom(),
  bundleId: uuid("bundle_id").notNull().references(() => mspSalesBundlesTable.bundleId, { onDelete: "restrict" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  /** M365 tenant GUID — drives package execution routing */
  tenantId: text("tenant_id"),
  status: text("status", { enum: MSP_BUNDLE_ASSIGNMENT_STATUS }).notNull().default("active"),
  /** When execution of the underlying packages was activated */
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  /** When a trial (if any) expires — null if no trial */
  trialExpiresAt: timestamp("trial_expires_at", { withTimezone: true }),
  assignedByUserId: integer("assigned_by_user_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sales_bundle_assignments_bundle_idx").on(t.bundleId),
  index("msp_sales_bundle_assignments_msp_id_idx").on(t.mspId),
  index("msp_sales_bundle_assignments_customer_id_idx").on(t.customerId),
  index("msp_sales_bundle_assignments_status_idx").on(t.status),
]);

export type MspSalesBundleAssignment = typeof mspSalesBundleAssignmentsTable.$inferSelect;
export type InsertMspSalesBundleAssignment = typeof mspSalesBundleAssignmentsTable.$inferInsert;

// ── Diagnostics Runs ──────────────────────────────────────────────────────────
// One row per triggered diagnostics run for a customer. Wraps one or more
// Monitoring Package executions. Status progresses:
//   pending → running → completed | failed | partial
//
// On failure, a portal_wf_runs stub + portal_wf_operator_tasks row is created
// so MSP operators can see and acknowledge the failure.

export const MSP_DIAGNOSTIC_RUN_STATUS = ["pending", "running", "completed", "failed", "partial"] as const;
export type MspDiagnosticRunStatus = typeof MSP_DIAGNOSTIC_RUN_STATUS[number];

export const mspDiagnosticRunsTable = pgTable("msp_diagnostic_runs", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  tenantId: text("tenant_id"),
  packageKey: text("package_key").notNull().default("core:security-baseline"),
  status: text("status", { enum: MSP_DIAGNOSTIC_RUN_STATUS }).notNull().default("pending"),
  triggeredByUserId: integer("triggered_by_user_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  checksTotal: integer("checks_total").notNull().default(0),
  checksOk: integer("checks_ok").notNull().default(0),
  checksError: integer("checks_error").notNull().default(0),
  checksRequiresScript: integer("checks_requires_script").notNull().default(0),
  // Checks that could not run because the tenant lacks the required M365 SKU/add-on.
  // Tracked separately from checksError so a license-gapped tenant is not penalized
  // as if it had genuine technical failures, and can still reach a "completed" run.
  checksLicenseGap: integer("checks_license_gap").notNull().default(0),
  runStatus: text("run_status"),
  documentId: uuid("document_id"),
  errorMessage: text("error_message"),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  // CIO-Report Narrative — AI-generated architect-voice narrative of this run's
  // real, already-classified findings + real peer-benchmark data, rendered inside
  // the Assessment Wizard's "generating" step as soon as the scan completes (not
  // gated on document generation). "not_started" until diagnostics-runner.ts fires
  // generateCioNarrative() on a completed run; idempotent — never regenerated once
  // past "not_started".
  cioNarrativeStatus: text("cio_narrative_status").notNull().default("not_started"),
  cioNarrativeHtml: text("cio_narrative_html"),
  cioNarrativeGeneratedAt: timestamp("cio_narrative_generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_diagnostic_runs_msp_id_idx").on(t.mspId),
  index("msp_diagnostic_runs_customer_id_idx").on(t.customerId),
  index("msp_diagnostic_runs_tenant_id_idx").on(t.tenantId),
  index("msp_diagnostic_runs_status_idx").on(t.status),
  index("msp_diagnostic_runs_created_at_idx").on(t.createdAt),
]);

export type MspDiagnosticRun = typeof mspDiagnosticRunsTable.$inferSelect;
export type InsertMspDiagnosticRun = typeof mspDiagnosticRunsTable.$inferInsert;

// ── Diagnostic Findings ───────────────────────────────────────────────────────
// Structured findings extracted from a diagnostics run. Each row is one finding
// from a monitor check. The `recommendation` JSONB is consumed by the Sales
// Offer Engine to map findings to priced offers.

export const MSP_DIAGNOSTIC_FINDING_SEVERITY = ["ok", "info", "warning", "critical"] as const;
export type MspDiagnosticFindingSeverity = typeof MSP_DIAGNOSTIC_FINDING_SEVERITY[number];

// #1553: a finding's provenance. Every finding until now derived from a check
// against a Microsoft-defined or best-practice baseline. A policy-sourced
// finding derives from what the customer themselves declared they wanted
// (`standing_policies.target_state`) — there is no Microsoft rule behind it,
// only the customer's own stated policy, and the UI must be able to say so.
export const MSP_DIAGNOSTIC_FINDING_SOURCES = ["baseline", "policy"] as const;
export type MspDiagnosticFindingSource = typeof MSP_DIAGNOSTIC_FINDING_SOURCES[number];

export const mspDiagnosticFindingsTable = pgTable("msp_diagnostic_findings", {
  id: serial("id").primaryKey(),
  findingId: uuid("finding_id").notNull().unique().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => mspDiagnosticRunsTable.runId, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id"),
  checkKey: text("check_key").notNull(),
  checkLabel: text("check_label").notNull(),
  severity: text("severity", { enum: MSP_DIAGNOSTIC_FINDING_SEVERITY }).notNull().default("info"),
  title: text("title").notNull(),
  description: text("description"),
  recommendation: jsonb("recommendation").$type<{
    signalKey?: string;
    action?: string;
    estimatedEffort?: string;
    priority?: number;
    category?: string;
  }>(),
  extractedProperties: jsonb("extracted_properties").$type<Record<string, unknown>>(),
  checkStatus: text("check_status"),
  // #1553: "baseline" for every pre-existing finding (the default — this column
  // is additive and every prior row is a Microsoft-baseline check). "policy"
  // marks a finding raised from standing-policy non-compliance instead.
  findingSource: text("finding_source", { enum: MSP_DIAGNOSTIC_FINDING_SOURCES }).notNull().default("baseline"),
  // #1553: which standing policy this finding was raised from, when findingSource
  // is "policy". Null for every baseline finding — there is no policy behind those.
  standingPolicyId: integer("standing_policy_id").references(() => standingPoliciesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_diagnostic_findings_run_id_idx").on(t.runId),
  index("msp_diagnostic_findings_customer_id_idx").on(t.customerId),
  index("msp_diagnostic_findings_severity_idx").on(t.severity),
  index("msp_diagnostic_findings_standing_policy_id_idx").on(t.standingPolicyId),
]);

export type MspDiagnosticFinding = typeof mspDiagnosticFindingsTable.$inferSelect;
export type InsertMspDiagnosticFinding = typeof mspDiagnosticFindingsTable.$inferInsert;

// ── Activity Subscriptions (Live Monitor Engine — Mode B) ─────────────────────
// Tracks O365 Management Activity API subscriptions per tenant+contentType.
// Also stores the polling watermark so each 5-min cycle knows where to resume.

export const ACTIVITY_SUBSCRIPTION_CONTENT_TYPES = [
  "Audit.AzureActiveDirectory",
  "Audit.Exchange",
  "Audit.SharePoint",
  "Audit.General",
  "DLP.All",
] as const;
export type ActivitySubscriptionContentType = typeof ACTIVITY_SUBSCRIPTION_CONTENT_TYPES[number];

export const ACTIVITY_SUBSCRIPTION_STATUSES = ["active", "disabled", "expired"] as const;
export type ActivitySubscriptionStatus = typeof ACTIVITY_SUBSCRIPTION_STATUSES[number];

export const activitySubscriptionsTable = pgTable("activity_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  contentType: text("content_type").notNull(),
  webhookAuthId: text("webhook_auth_id"),
  status: text("status", { enum: ACTIVITY_SUBSCRIPTION_STATUSES }).notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pollWatermark: timestamp("poll_watermark", { withTimezone: true }),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastPollEventCount: integer("last_poll_event_count").notNull().default(0),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("activity_subscriptions_tenant_content_uidx").on(t.tenantId, t.contentType),
  index("activity_subscriptions_tenant_id_idx").on(t.tenantId),
  index("activity_subscriptions_status_idx").on(t.status),
  index("activity_subscriptions_msp_id_idx").on(t.mspId),
]);

export type ActivitySubscription = typeof activitySubscriptionsTable.$inferSelect;
export type InsertActivitySubscription = typeof activitySubscriptionsTable.$inferInsert;

// ── MSP Project SOWs ───────────────────────────────────────────────────────────
// One row per accepted sales offer where the service's serviceClass = "project".
// Lifecycle: draft → sent → signed → paid | failed | expired
//
// The platform never charges the end-customer directly.
// After signature, the platform charges the MSP's card on file (Stripe payment
// intent against msp_subscriptions.stripeCustomerId).
//
// A signed-but-unpaid SOW auto-expires after 30 days via a scheduled workflow
// transition (not a silent DB timeout).

export const MSP_SOW_STATUSES = ["draft", "sent", "signed", "paid", "failed", "expired"] as const;
export type MspSowStatus = typeof MSP_SOW_STATUSES[number];

export const mspSowsTable = pgTable("msp_sows", {
  id: serial("id").primaryKey(),
  sowId: uuid("sow_id").notNull().unique().defaultRandom(),

  // ── Source offer ──────────────────────────────────────────────────────────
  offerId: integer("offer_id"),

  // ── Parties ───────────────────────────────────────────────────────────────
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  // The end-customer user that signs the SOW (CustomerUser role)
  customerUserId: integer("customer_user_id"),

  // ── Service context ───────────────────────────────────────────────────────
  // Denormalised at SOW creation — snapshot at time of offer acceptance so
  // price changes to the catalog never alter a live SOW.
  serviceId: integer("service_id"),
  title: text("title").notNull(),
  description: text("description"),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),

  // ── Generated document ────────────────────────────────────────────────────
  // HTML body of the SOW document (generated by the Document Pipeline).
  // Served to the customer for review before signing.
  documentHtml: text("document_html"),
  documentGeneratedAt: timestamp("document_generated_at", { withTimezone: true }),

  // ── Public share link ─────────────────────────────────────────────────────
  // Unauthenticated read-only token. Customer opens this URL from email.
  shareToken: text("share_token").unique(),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),

  // ── Signature ─────────────────────────────────────────────────────────────
  signerName: text("signer_name"),
  signatureData: text("signature_data"),     // base64 PNG data-URL
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signedIp: text("signed_ip"),

  // ── MSP charge ────────────────────────────────────────────────────────────
  // Payment intent created against the MSP's card on file after signature.
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  chargeAttemptedAt: timestamp("charge_attempted_at", { withTimezone: true }),
  chargeConfirmedAt: timestamp("charge_confirmed_at", { withTimezone: true }),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: text("status", { enum: MSP_SOW_STATUSES }).notNull().default("draft"),
  // Auto-expiry (30 days after status → signed, if not yet paid)
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  failureReason: text("failure_reason"),

  // ── Optional customer-agreement template ─────────────────────────────────
  // MSP-authored clickwrap text embedded in the SOW document if configured.
  customerAgreementSnapshotText: text("customer_agreement_snapshot_text"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sows_msp_id_idx").on(t.mspId),
  index("msp_sows_customer_id_idx").on(t.customerId),
  index("msp_sows_offer_id_idx").on(t.offerId),
  index("msp_sows_status_idx").on(t.status),
  index("msp_sows_share_token_idx").on(t.shareToken),
  index("msp_sows_expires_at_idx").on(t.expiresAt),
]);

export type MspSow = typeof mspSowsTable.$inferSelect;
export type InsertMspSow = typeof mspSowsTable.$inferInsert;

// ── MSP SOW Audit Events ────────────────────────────────────────────────────────
// Append-only log of every lifecycle transition on an MSP SOW.

export const mspSowEventsTable = pgTable("msp_sow_events", {
  id: serial("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().defaultRandom(),
  sowId: uuid("sow_id").notNull().references(() => mspSowsTable.sowId, { onDelete: "cascade" }),
  eventName: text("event_name").notNull(), // sow.created | sow.sent | sow.signed | sow.charged | sow.paid | sow.failed | sow.expired
  actorUserId: integer("actor_user_id"),
  actorRole: text("actor_role"),           // "MSPAdmin" | "CustomerUser" | "system"
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sow_events_sow_id_idx").on(t.sowId),
  index("msp_sow_events_created_at_idx").on(t.createdAt),
]);

export type MspSowEvent = typeof mspSowEventsTable.$inferSelect;
export type InsertMspSowEvent = typeof mspSowEventsTable.$inferInsert;

// ── MSP Direct Charges ──────────────────────────────────────────────────────────
// Stripe charges billed to an MSP's saved payment method — one per SOW.
// Separate from msp_subscriptions (platform tier billing) and portal billing
// (customer-facing Stripe checkout). This table is the MSP's per-project invoice.

export const MSP_CHARGE_STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;
export type MspChargeStatus = typeof MSP_CHARGE_STATUSES[number];

export const mspChargesTable = pgTable("msp_charges", {
  id: serial("id").primaryKey(),
  chargeId: uuid("charge_id").notNull().unique().defaultRandom(),

  // ── Source ────────────────────────────────────────────────────────────────
  sowId: uuid("sow_id").notNull().references(() => mspSowsTable.sowId, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),

  // ── Amount ────────────────────────────────────────────────────────────────
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),

  // ── Stripe ────────────────────────────────────────────────────────────────
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeChargeId: text("stripe_charge_id"),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: text("status", { enum: MSP_CHARGE_STATUSES }).notNull().default("pending"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  attemptCount: integer("attempt_count").notNull().default(1),

  chargedAt: timestamp("charged_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_charges_sow_id_idx").on(t.sowId),
  index("msp_charges_msp_id_idx").on(t.mspId),
  index("msp_charges_status_idx").on(t.status),
  index("msp_charges_stripe_pi_idx").on(t.stripePaymentIntentId),
]);

export type MspCharge = typeof mspChargesTable.$inferSelect;
export type InsertMspCharge = typeof mspChargesTable.$inferInsert;

// ── MSP Customer Clickwrap Acceptances ─────────────────────────────────────────
// Records when a customer accepted the MSP's optional customer-agreement template
// at onboarding. Only created when the MSP has customerAgreementTemplate set.

export const mspCustomerClickwrapsTable = pgTable("msp_customer_clickwraps", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  customerUserId: integer("customer_user_id").notNull(),
  // Snapshot of the text shown at acceptance time
  agreementTextSnapshot: text("agreement_text_snapshot").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_customer_clickwraps_msp_id_idx").on(t.mspId),
  index("msp_customer_clickwraps_customer_user_id_idx").on(t.customerUserId),
]);

// ── Observability: Alert Rules ─────────────────────────────────────────────────
// Configurable alert rules evaluated by the platform alert engine.
// Each rule defines a condition type, threshold, and delivery preferences.

export const MSP_ALERT_CONDITION_TYPES = [
  "dlq_backlog",       // unresolved DLQ items exceed threshold
  "billing_failure",   // MSP subscriptions in payment_failed_at state
  "sla_breach",        // fulfillment_queue rows overdue past SLA
  "event_bus_backlog", // webhook delivery failures in last N minutes
  "job_failure_rate",  // background jobs failing at above-threshold rate
  "purchase_completed",// discrete sale/checkout event — fired directly via
                       // fireEventRule() (#665), never evaluated by the
                       // polling evaluateRules() loop like the others above
  "risk_review_overdue", // msp_risk_decisions rows whose review clock (#1507)
                       // has lapsed — the ACCEPTANCE stays active/valid; only
                       // the review is overdue (#1513). Count-based, evaluated
                       // by the same polling evaluateRules() loop.
  "policy_clearance_resolved", // policy_decisions rows whose dependency-based
                       // clearance (#1526) was just observed to resolve (a
                       // watched licence SKU appeared in the tenant) — a
                       // decision becoming actionable, not a failure. Neutral
                       // "info" severity, same reasoning as purchase_completed.
                       // Count-based, evaluated by the same polling loop.
  "policy_review_overdue", // policy_decisions (Git #2024) rows whose review
                       // clock has lapsed — same "review is overdue, the
                       // signed decision remains LIVE" contract as
                       // risk_review_overdue, extended to Policy Decisions'
                       // own table per #1527. Count-based, same polling loop.
] as const;
export type MspAlertConditionType = typeof MSP_ALERT_CONDITION_TYPES[number];

// "info" (#665): a completed sale is a neutral, non-alarming event — forcing it
// into "warning"/"critical" would miscategorise it against every other rule.
//
// "review_lapsed" (#1513): a lapsed risk-acceptance review is a DIFFERENT
// failure from a threshold breach — the customer currently believes a risk is
// being actively managed, and nobody has looked. Deliberately not reused as
// "warning"/"critical" so it never sorts in with an ordinary operational
// alert (settled requirement on #1513). This severity is specific to the
// msp_alert_rules/msp_alert_events platform alert engine and is unrelated to
// CUSTOMER_ALERT_SEVERITIES below (#1942 fixes that vocabulary at exactly
// three values for the customer-facing catalogue; this is the internal MSP
// ops alert engine, a different table and a different audience).
export const MSP_ALERT_SEVERITIES = ["warning", "critical", "info", "review_lapsed"] as const;
export type MspAlertSeverity = typeof MSP_ALERT_SEVERITIES[number];

export const mspAlertRulesTable = pgTable("msp_alert_rules", {
  id: serial("id").primaryKey(),
  // Human-readable unique key, e.g. "dlq_backlog_critical"
  ruleKey: text("rule_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  conditionType: text("condition_type", { enum: MSP_ALERT_CONDITION_TYPES }).notNull(),
  // For count-based conditions: fire when count >= threshold
  threshold: integer("threshold").notNull().default(5),
  // Lookback window in minutes for rate-based conditions
  windowMinutes: integer("window_minutes").notNull().default(60),
  severity: text("severity", { enum: MSP_ALERT_SEVERITIES }).notNull().default("warning"),
  enabled: boolean("enabled").notNull().default(true),
  // Delivery channels
  deliveryEmail: boolean("delivery_email").notNull().default(true),
  deliveryPush: boolean("delivery_push").notNull().default(true),
  // Minimum gap between re-alerts for the same rule (de-duplication window)
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  // Admin Panel deep-link shown in alert delivery (e.g. /system/dlq)
  deepLinkPath: text("deep_link_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_alert_rules_condition_type_idx").on(t.conditionType),
  index("msp_alert_rules_enabled_idx").on(t.enabled),
]);

export type MspAlertRule = typeof mspAlertRulesTable.$inferSelect;
export type InsertMspAlertRule = typeof mspAlertRulesTable.$inferInsert;

// ── Observability: Alert Events ────────────────────────────────────────────────
// Records every time an alert rule fires. Used for de-duplication (cooldown)
// and the alert history log in the Admin Panel.

export const mspAlertEventsTable = pgTable("msp_alert_events", {
  id: serial("id").primaryKey(),
  alertEventId: uuid("alert_event_id").notNull().unique().defaultRandom(),
  ruleId: integer("rule_id").notNull().references(() => mspAlertRulesTable.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  severity: text("severity", { enum: MSP_ALERT_SEVERITIES }).notNull(),
  conditionValue: integer("condition_value").notNull(),
  // Human-readable description of what fired (e.g. "DLQ has 12 unresolved items")
  summary: text("summary").notNull(),
  // Deep-link path for the admin panel (e.g. /system/dlq)
  deepLinkPath: text("deep_link_path"),
  // Optional MSP context for MSP-scoped alerts
  mspId: integer("msp_id"),
  // Delivery tracking
  deliveredEmail: boolean("delivered_email").notNull().default(false),
  deliveredPush: boolean("delivered_push").notNull().default(false),
  // Set when an operator acknowledges / resolves the alert
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by"),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_alert_events_rule_id_idx").on(t.ruleId),
  index("msp_alert_events_fired_at_idx").on(t.firedAt),
  index("msp_alert_events_severity_idx").on(t.severity),
]);

// lib/db/src/schema/msp.ts

// [ ... existing imports and tables ... ]

export const savedSqlScripts = pgTable("saved_sql_scripts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // e.g., "QA Asserts", "Maintenance"
  query: text("query").notNull(),
  isDestructive: boolean("is_destructive").default(false),
  // Reset scripts are hoisted to the front of a test-suite run regardless of
  // stored step order (see api-server lib/test-suite-runner.ts).
  isResetScript: boolean("is_reset_script").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Simulator Studio's Run History — one row per command or query actually run
 * from the admin console, with the output it printed and what it changed.
 *
 * Written **server-side**, by the routes that do the running
 * (`admin-deploy-console.ts`'s two POSTs and `admin-engines.ts`'s
 * `/simulator/sql/execute` + `/simulator/migrations/execute`), not by the
 * browser reporting what it saw. That matters for two reasons: a run is kept
 * even if the tab is closed or the response never arrives, and the row cannot
 * disagree with what the server actually did.
 *
 * `effect` is the short consequence list ("read only", "41 rows changed",
 * "stopped at pnpm install"). Every entry is derived from the real result —
 * a SQL statement that came back with `fields` read, one with a `rowCount`
 * and no fields wrote — never guessed from the command text, because a
 * keyword guess calls `insert ... returning` read-only.
 *
 * `actorUserId` deliberately carries **no** foreign key: this is a record of
 * what was done to the server, and it must not be deleted or blocked by
 * anything happening to the user row that did it.
 */
export const simulatorRunHistory = pgTable("simulator_run_history", {
  id: serial("id").primaryKey(),
  /** 'deploy' (a shell command) or 'sql' (a query, or a manual migration file). */
  kind: text("kind").notNull(),
  /** Verbatim: the shell command, the query text, or the migration's repo path. */
  cmd: text("cmd").notNull(),
  /** Derived once at record time — a leading `--`/`#` comment, a ticket, or the first line. */
  title: text("title").notNull(),
  /** `#412` / `GH-388` lifted out of the text, or '' when the text carries none. */
  ticket: text("ticket").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  /** Database execution time for SQL; wall clock for a deploy command. */
  durationMs: integer("duration_ms").notNull().default(0),
  ok: boolean("ok").notNull(),
  /** Array of short strings. See the note above on why these are derived, not declared. */
  effect: jsonb("effect").$type<string[]>().notNull().default([]),
  /** Whatever it printed, truncated with a visible marker rather than silently. */
  output: text("output").notNull().default(""),
  /** Free text the operator writes on the run afterwards. The only field not derived. */
  note: text("note").notNull().default(""),
  /** Set only for a manual migration run — its SQL lives on the server, so `cmd` is the path. */
  migrationFile: text("migration_file"),
  /** Who ran it. Intentionally un-FK'd — see the table doc comment. */
  actorUserId: integer("actor_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("simulator_run_history_started_at_idx").on(t.startedAt),
  index("simulator_run_history_kind_idx").on(t.kind),
  // "Run before: 14 times in all" counts every row sharing this exact command.
  index("simulator_run_history_cmd_idx").on(t.cmd),
]);

export type SimulatorRunHistoryRow = typeof simulatorRunHistory.$inferSelect;
export type InsertSimulatorRunHistoryRow = typeof simulatorRunHistory.$inferInsert;

export const simulationProfiles = pgTable("simulation_profiles", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id), // The testbed target
  name: text("name").notNull(),
  baselineState: jsonb("baseline_state"), // Snapshot of tenant before run
  createdAt: timestamp("created_at").defaultNow(),
});

export const simulationRuns = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => simulationProfiles.id),
  status: text("status").notNull(), // 'running', 'completed', 'failed'
  logs: jsonb("logs"), // Array of stream events
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type SavedSqlScript = typeof savedSqlScripts.$inferSelect;
export type InsertSavedSqlScript = typeof savedSqlScripts.$inferInsert;

export type SimulationProfile = typeof simulationProfiles.$inferSelect;
export type InsertSimulationProfile = typeof simulationProfiles.$inferInsert;

export type SimulationRun = typeof simulationRuns.$inferSelect;
export type InsertSimulationRun = typeof simulationRuns.$inferInsert;

// ── Test Suite Runner ──────────────────────────────────────────────────────────
// Ordered multi-step test suites executed sequentially server-side
// (api-server lib/test-suite-runner.ts). steps is a TestSuiteStep[] — the step
// union is typed api-server-side; the schema stores it as opaque jsonb.

export const testSuitesTable = pgTable("test_suites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  steps: jsonb("steps").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const testSuiteRunsTable = pgTable("test_suite_runs", {
  id: serial("id").primaryKey(),
  suiteId: integer("suite_id").notNull().references(() => testSuitesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"), // "running" | "completed" | "failed"
  stepResults: jsonb("step_results"), // { stepIndex, type, status, output?, error?, durationMs }[]
  testbedCustomerId: integer("testbed_customer_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("test_suite_runs_suite_id_idx").on(t.suiteId),
  index("test_suite_runs_started_at_idx").on(t.startedAt),
]);

export type TestSuite = typeof testSuitesTable.$inferSelect;
export type InsertTestSuite = typeof testSuitesTable.$inferInsert;

export type TestSuiteRun = typeof testSuiteRunsTable.$inferSelect;
export type InsertTestSuiteRun = typeof testSuiteRunsTable.$inferInsert;

// ── Baseline Action Templates ──────────────────────────────────────────────────

export const baselineActionTemplatesTable = pgTable("baseline_action_templates", {
  id: serial("id").primaryKey(),
  templateId: text("template_id").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  endpoint: text("endpoint").notNull(),
  method: text("method", { enum: ["POST", "PATCH", "PUT", "DELETE"] }).notNull(),
  bodyTemplate: jsonb("body_template").$type<Record<string, unknown>>().notNull().default({}),
  requiredVariables: jsonb("required_variables").$type<string[]>().notNull().default([]),
  successCriteria: jsonb("success_criteria").$type<Record<string, unknown>>().notNull().default({}),
  dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
  requiresVerificationGate: boolean("requires_verification_gate").notNull().default(false),
  schemaVersion: integer("schema_version").notNull().default(1),
  // Archived (not hard-deleted) templates are grandfathered into any config pack
  // that already references them — mirrors MONITOR_CHECK_STATUS semantics.
  status: text("status", { enum: MONITOR_CHECK_STATUS }).notNull().default("active"),
  // Launch Control rollback (Reverse-Template Pairing): true only for the 6
  // templates with a real, explicit single-step reverse. reverseTemplateId
  // points at the paired reverse template's own templateId — self-referential
  // for users.disable_enable_signin, which pairs with itself (rollback inverts
  // the captured boolean instead of replaying the same call verbatim).
  reversible: boolean("reversible").notNull().default(false),
  reverseTemplateId: text("reverse_template_id"),
  createdByAdminId: integer("created_by_admin_id"),
  updatedByAdminId: integer("updated_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("baseline_action_templates_template_id_idx").on(t.templateId),
]);

export const insertBaselineActionTemplateSchema = createInsertSchema(baselineActionTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type BaselineActionTemplate = typeof baselineActionTemplatesTable.$inferSelect;
export type InsertBaselineActionTemplate = typeof baselineActionTemplatesTable.$inferInsert;

// ── Baseline Action Template Audit Log ──────────────────────────────────────────

export const baselineActionTemplateAuditLogTable = pgTable("baseline_action_template_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  templateId: text("template_id"),
  adminId: integer("admin_id"),
  beforeSnapshot: jsonb("before_snapshot").$type<Record<string, unknown>>(),
  afterSnapshot: jsonb("after_snapshot").$type<Record<string, unknown>>(),
  // Raw variables/request body passed into runBaselineTemplateAgainstTenant()
  // at execution time (the function's `payload` param) — required for Launch
  // Control rollback, since body-only variables (e.g. accountEnabled, skuId)
  // are otherwise unrecoverable once execution completes (the endpoint string
  // only preserves path-based variables like groupId/memberId).
  requestVariables: jsonb("request_variables").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("baseline_action_template_audit_log_template_id_idx").on(t.templateId),
  index("baseline_action_template_audit_log_created_at_idx").on(t.createdAt),
]);

export const insertBaselineActionTemplateAuditLogSchema = createInsertSchema(baselineActionTemplateAuditLogTable).omit({ id: true, createdAt: true });
export type BaselineActionTemplateAuditLog = typeof baselineActionTemplateAuditLogTable.$inferSelect;
export type InsertBaselineActionTemplateAuditLog = typeof baselineActionTemplateAuditLogTable.$inferInsert;

// ── Write Action Catalog (M365 Launch Control) ──────────────────────────────────
//
// Schema-definition-only mapping of an already-live table (created via manual
// SQL, no migration file in this repo) — catalogs the universe of possible
// M365 write actions, independent of which ones have a runnable
// baseline_action_templates row yet. Live columns not independently
// re-verified against information_schema in this session (no DB access in
// this environment) — verify against the real table before relying on exact
// types/nullability.

export const writeActionCatalogTable = pgTable("write_action_catalog", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  actionName: text("action_name").notNull(),
  surface: text("surface").notNull(),
  requiredPermission: text("required_permission"),
  // Nullable: the 7 `blocked_no_workaround` rows have no safe/gated
  // classification (confirmed via live data — 5 Teams policy actions,
  // 1 SharePoint retention label, 1 legacy MFA toggle).
  safeOrGated: text("safe_or_gated", { enum: ["safe", "gated"] }),
  minBundledTier: text("min_bundled_tier"),
  requiredCapabilityKey: text("required_capability_key"),
  snapshotNotes: text("snapshot_notes"),
  status: text("status"),
  blockedReason: text("blocked_reason"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // NULL = not execution-ready yet (true for all 123 rows as of 2026-07-20).
  // Once set, this is the real key into baseline_action_templates.templateId
  // — replaces the previous broken actionName === templateId assumption.
  // Column not independently re-verified against information_schema in this
  // session (no DB access here, same limitation as the rest of this table).
  templateId: text("template_id"),
}, (t) => [
  index("write_action_catalog_domain_idx").on(t.domain),
]);

export type WriteActionCatalog = typeof writeActionCatalogTable.$inferSelect;
export type InsertWriteActionCatalog = typeof writeActionCatalogTable.$inferInsert;

// ── Config Packs ───────────────────────────────────────────────────────────────

export const configPacksTable = pgTable("config_packs", {
  id: serial("id").primaryKey(),
  packKey: text("pack_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  categories: text("categories").array().notNull().default([]),
  status: text("status", { enum: MONITOR_CHECK_STATUS }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("config_packs_pack_key_idx").on(t.packKey),
]);

export const insertConfigPackSchema = createInsertSchema(configPacksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ConfigPack = typeof configPacksTable.$inferSelect;
export type InsertConfigPack = typeof configPacksTable.$inferInsert;

// ── Config Pack Templates ──────────────────────────────────────────────────────

export const configPackTemplatesTable = pgTable("config_pack_templates", {
  id: serial("id").primaryKey(),
  packId: integer("pack_id").notNull().references(() => configPacksTable.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => baselineActionTemplatesTable.templateId),
  checkKey: text("check_key").references(() => monitorChecksTable.key),
  parameterMapping: jsonb("parameter_mapping").$type<Record<string, string>>(),
  sortOrder: integer("sort_order").notNull(),
  dependsOnOverride: jsonb("depends_on_override").$type<string[]>(),
}, (t) => [
  index("config_pack_templates_pack_id_idx").on(t.packId),
  index("config_pack_templates_template_id_idx").on(t.templateId),
  index("config_pack_templates_check_key_idx").on(t.checkKey),
]);

export const insertConfigPackTemplateSchema = createInsertSchema(configPackTemplatesTable).omit({ id: true });
export type ConfigPackTemplate = typeof configPackTemplatesTable.$inferSelect;
export type InsertConfigPackTemplate = typeof configPackTemplatesTable.$inferInsert;

// ── Break Glass Pending Secrets ─────────────────────────────────────────────────

export const breakGlassPendingSecretsTable = pgTable("break_glass_pending_secrets", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references((): AnyPgColumn => wfRunsTable.id),
  customerId: integer("customer_id").notNull(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  encryptedValue: text("encrypted_value").notNull(),
  // Git #1911 — the Key Vault REFERENCE for this credential (vault url, secret
  // name, immutable version, expiry). The vault is the store; this column is the
  // pointer, and it is safe to persist and to show in an admin surface.
  //
  // The gate's own encrypted copy above is deliberately UNCHANGED: #1911 moves
  // where the plaintext lives, it does not weaken the gate. The reveal path
  // prefers this reference and falls back to `encryptedValue` for rows written
  // before the store existed, and acknowledgement purges BOTH.
  //
  // Nullable: a row predating #1911, or one written while the store was
  // unconfigured, simply has no reference.
  secretRef: jsonb("secret_ref").$type<{
    kind: "azure-key-vault";
    vaultUrl: string;
    secretName: string;
    version: string | null;
    expiresOn: string;
    purpose: string;
    customerId: number;
  }>(),
  // The paused workflow node id, so the /acknowledge path can resume the run via
  // resumeWorkflowRun(runId, gateNodeId, ...). One pause per pending secret.
  gateNodeId: text("gate_node_id"),
  // "superseded_by_reset" = an admin-override reset the credential and issued a new
  // pending secret; nothing was ever delivered from this row.
  status: text("status", { enum: ["pending_delivery", "delivered_purged", "superseded_by_reset"] }).notNull().default("pending_delivery"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveredToEmail: text("delivered_to_email"),
}, (t) => [
  index("break_glass_pending_secrets_run_id_idx").on(t.runId),
  index("break_glass_pending_secrets_customer_id_idx").on(t.customerId),
]);

export const insertBreakGlassPendingSecretSchema = createInsertSchema(breakGlassPendingSecretsTable).omit({ id: true, createdAt: true });
export type BreakGlassPendingSecret = typeof breakGlassPendingSecretsTable.$inferSelect;
export type InsertBreakGlassPendingSecret = typeof breakGlassPendingSecretsTable.$inferInsert;

// ── Break Glass Verification Attempts ──────────────────────────────────────────

export const breakGlassVerificationAttemptsTable = pgTable("break_glass_verification_attempts", {
  id: serial("id").primaryKey(),
  pendingSecretId: integer("pending_secret_id").notNull().references(() => breakGlassPendingSecretsTable.id, { onDelete: "cascade" }),
  initiatedByPortalUserId: integer("initiated_by_portal_user_id").notNull(),
  invitedEmail: text("invited_email").notNull(),
  linkToken: text("link_token").notNull().unique(),
  linkStatus: text("link_status", { enum: ["pending", "consumed", "expired", "superseded"] }).notNull().default("pending"),
  verificationOutcome: text("verification_outcome", { enum: ["success", "role_not_active_pim_eligible", "role_absent", "expired", "superseded"] }),
  entraUserPrincipalName: text("entra_user_principal_name"),
  // Count of failed (role_absent) verification attempts against this link. Once it
  // reaches the max-attempts threshold the link is burned (linkStatus "expired").
  failedAttemptCount: integer("failed_attempt_count").default(0),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("break_glass_verification_attempts_link_token_idx").on(t.linkToken),
  index("break_glass_verification_attempts_pending_secret_id_idx").on(t.pendingSecretId),
]);

export const insertBreakGlassVerificationAttemptSchema = createInsertSchema(breakGlassVerificationAttemptsTable).omit({ id: true, createdAt: true });
export type BreakGlassVerificationAttempt = typeof breakGlassVerificationAttemptsTable.$inferSelect;
export type InsertBreakGlassVerificationAttempt = typeof breakGlassVerificationAttemptsTable.$inferInsert;

// ── Break Glass Override Audit ─────────────────────────────────────────────────
// Structured audit of admin-override credential resets. Its own dedicated table
// (not a generic log) so the repeated-override alert is a single indexed SELECT
// over (customerId, createdAt) with real columns — no free-text parsing.

export const breakGlassOverrideAuditTable = pgTable("break_glass_override_audit", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  adminUserId: integer("admin_user_id").notNull(),
  reason: text("reason").notNull(),
  oldPendingSecretId: integer("old_pending_secret_id").references((): AnyPgColumn => breakGlassPendingSecretsTable.id),
  newPendingSecretId: integer("new_pending_secret_id").notNull().references((): AnyPgColumn => breakGlassPendingSecretsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("break_glass_override_audit_customer_created_idx").on(t.customerId, t.createdAt),
]);

export const insertBreakGlassOverrideAuditSchema = createInsertSchema(breakGlassOverrideAuditTable).omit({ id: true, createdAt: true });
export type BreakGlassOverrideAudit = typeof breakGlassOverrideAuditTable.$inferSelect;
export type InsertBreakGlassOverrideAudit = typeof breakGlassOverrideAuditTable.$inferInsert;

// ── MSP Custom Canvas Reports ────────────────────────────────────────────────

export const mspReportCanvasesTable = pgTable("msp_report_canvases", {
  id: uuid("id").primaryKey().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  canvasLayout: jsonb("canvas_layout").$type<Record<string, unknown>>().notNull().default({}),
  deliveryConfig: jsonb("delivery_config").$type<{ sendAsHtmlEmail: boolean; attachPdf: boolean; recipientType: "msp_admin" | "customer_contacts" }>().notNull().default({ sendAsHtmlEmail: false, attachPdf: true, recipientType: "msp_admin" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_report_canvases_msp_id_idx").on(t.mspId),
]);

export const insertMspReportCanvasSchema = createInsertSchema(mspReportCanvasesTable).omit({ createdAt: true, updatedAt: true });
export type MspReportCanvas = typeof mspReportCanvasesTable.$inferSelect;
export type InsertMspReportCanvas = typeof mspReportCanvasesTable.$inferInsert;

export const mspReportSchedulesTable = pgTable("msp_report_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  canvasId: uuid("canvas_id").notNull().references(() => mspReportCanvasesTable.id, { onDelete: "cascade" }),
  cadence: text("cadence", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  recipientEmails: text("recipient_emails").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_report_schedules_msp_id_idx").on(t.mspId),
  index("msp_report_schedules_canvas_id_idx").on(t.canvasId),
]);

export const insertMspReportScheduleSchema = createInsertSchema(mspReportSchedulesTable).omit({ createdAt: true, updatedAt: true });
export type MspReportSchedule = typeof mspReportSchedulesTable.$inferSelect;
export type InsertMspReportSchedule = typeof mspReportSchedulesTable.$inferInsert;

// ── Dashboard / Web Part System (Phase 0: schema only) ─────────────────────────
//
// Live, drag/resize, customer-configurable dashboards. Distinct from
// msp_report_canvases above (which feeds scheduled email/PDF report generation) —
// dashboard_templates renders live in the app. Both share the same widget shape
// convention: canvasLayout as {i, x, y, w, h, type, properties}[].
//
// Runtime code lands in later phases: Phase 2 (rendering engine) and Phase 7
// (backend resolvers) bind their logger via logger.child({ channel: "engine.dashboard" }).

export const DASHBOARD_TEMPLATE_TYPES = ["assessment", "project", "monitoring_package", "msp_overview", "customer_default"] as const;
export type DashboardTemplateType = typeof DASHBOARD_TEMPLATE_TYPES[number];

export const dashboardTemplatesTable = pgTable("dashboard_templates", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  templateType: text("template_type", { enum: DASHBOARD_TEMPLATE_TYPES }).notNull(),
  // e.g. assessment slug or monitoring package key; null when templateType = "msp_overview"
  targetKey: text("target_key"),
  // Shape matches WidgetInstance in @workspace/dashboard-canvas (metricKey/rendererType,
  // not a generic "type" — this table has no consumers yet, so this annotation is free
  // to describe the real contract rather than an earlier placeholder guess).
  canvasLayout: jsonb("canvas_layout").$type<Array<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    metricKey: string;
    rendererType: string;
    displayMode?: "count" | "percentage";
    properties?: Record<string, unknown>;
  }>>().notNull().default([]),
  allowCustomerEdit: boolean("allow_customer_edit").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dashboard_templates_msp_id_idx").on(t.mspId),
]);

export const insertDashboardTemplateSchema = createInsertSchema(dashboardTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DashboardTemplate = typeof dashboardTemplatesTable.$inferSelect;
export type InsertDashboardTemplate = typeof dashboardTemplatesTable.$inferInsert;

export const DASHBOARD_OVERRIDE_SCOPE_TYPES = ["customer", "msp_user"] as const;
export type DashboardOverrideScopeType = typeof DASHBOARD_OVERRIDE_SCOPE_TYPES[number];

export const dashboardOverridesTable = pgTable("dashboard_overrides", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => dashboardTemplatesTable.id, { onDelete: "cascade" }),
  scopeType: text("scope_type", { enum: DASHBOARD_OVERRIDE_SCOPE_TYPES }).notNull(),
  // References mspCustomers.id when scopeType = "customer", mspUsers.id when
  // scopeType = "msp_user". No FK constraint here — the target table varies
  // by scopeType, and Postgres FKs can't conditionally reference two tables.
  scopeId: integer("scope_id").notNull(),
  // Partial deltas only (visibility/position/size changes) — never a full layout copy.
  overrideLayout: jsonb("override_layout").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dashboard_overrides_template_id_idx").on(t.templateId),
  uniqueIndex("dashboard_overrides_template_scope_unique_idx").on(t.templateId, t.scopeType, t.scopeId),
]);

export const insertDashboardOverrideSchema = createInsertSchema(dashboardOverridesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DashboardOverride = typeof dashboardOverridesTable.$inferSelect;
export type InsertDashboardOverride = typeof dashboardOverridesTable.$inferInsert;

// ── Dashboard AI Executive Summary ──────────────────────────────────────────
//
// One cached AI-generated summary per customer, covering their customer_default
// dashboard's currently-resolved metrics. Mirrors the OMG-card caching pattern
// (insightsGeneratedDocumentsTable.omgCards/omgCardsGeneratedAt in this same
// file) — generated lazily, persisted, and reused until stale rather than
// regenerated on every dashboard load. See dashboard-executive-summary.ts for
// the staleness window and generation logic.

export const dashboardExecutiveSummariesTable = pgTable("dashboard_executive_summaries", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  headline: text("headline").notNull().default(""),
  bullets: jsonb("bullets").$type<Array<{ severity: "red" | "amber" | "green"; text: string }>>().notNull().default([]),
  model: text("model"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dashboard_executive_summaries_msp_id_idx").on(t.mspId),
]);

export const insertDashboardExecutiveSummarySchema = createInsertSchema(dashboardExecutiveSummariesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type DashboardExecutiveSummary = typeof dashboardExecutiveSummariesTable.$inferSelect;
export type InsertDashboardExecutiveSummary = typeof dashboardExecutiveSummariesTable.$inferInsert;

// ── MSP Partner QBR (Quarterly Business Review) ────────────────────────────────
//
// An AI-generated, cross-customer leadership document summarising an MSP's whole
// book for a single quarter — the "Partner QBR" surfaced in MSP Executive Mode.
//
// This is deliberately an MSP-level (whole-book) document, NOT a per-customer
// deliverable — the per-customer, client-facing formal document is the
// consolidated SOW (insights_generated_documents, customerId-scoped). Because a
// QBR spans every customer in the book, it cannot live in
// insights_generated_documents (whose customerId FK is a single users.id with no
// mspId), so it gets its own MSP-scoped table.
//
// Caching / cost discipline: exactly one QBR per (mspId, quarterKey). A QBR is a
// quarterly artifact by nature, and an Opus-4.8 generation is expensive, so we
// never regenerate speculatively — a request within the same quarter returns the
// cached row; a manual "Regenerate" (force) overwrites it in place.
export const mspPartnerQbrsTable = pgTable("msp_partner_qbrs", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // Human/sortable quarter identifier, e.g. "2026-Q3". Unique per MSP.
  quarterKey: text("quarter_key").notNull(),
  status: text("status", { enum: ["generating", "ready", "failed"] }).notNull().default("generating"),
  title: text("title").notNull().default(""),
  // The generated formal document as HTML (same convention as a consolidated SOW).
  htmlContent: text("html_content").notNull().default(""),
  // The real book data the QBR was grounded on, captured at generation time for
  // audit / reproducibility (top risks + top opportunities + book rollup).
  dataSnapshot: jsonb("data_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  model: text("model"),
  errorMessage: text("error_message"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_partner_qbrs_msp_quarter_idx").on(t.mspId, t.quarterKey),
]);

export const insertMspPartnerQbrSchema = createInsertSchema(mspPartnerQbrsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspPartnerQbr = typeof mspPartnerQbrsTable.$inferSelect;
export type InsertMspPartnerQbr = typeof mspPartnerQbrsTable.$inferInsert;

// ── MSP Change Requests (Change Control Log) ──────────────────────────────────
//
// ITIL v4 Change Enablement record representing a scheduled, pending, or applied
// configuration change for an end-customer tenant.

/**
 * The INTAKE axis (#1534, part of #1494) — how a change enters the register, i.e.
 * what the customer can actually do about it. Distinct from `change_class`
 * (standard/normal/emergency, the ITIL ceremony) and from `risk_level`. Shane's
 * settled model (#1534, 2026-08-28): a Microsoft change routed automatically into
 * Change Control carries one of these three, derived from the interpretation's
 * `who_acts` / `controllable` fields (#1532):
 *   • informed  — Microsoft acts, no opt-out. Acknowledgement only; nothing to approve.
 *   • approval  — a control exists; a real decision, both ways (turn on / leave on).
 *   • advisory  — requires work (e.g. Project Online decommission); plan and execute.
 * NULL is the common, honest case: a wizard- or drift-raised CR has no Microsoft
 * intake axis, and the register reads null as "not a routed change".
 */
export const CHANGE_REQUEST_INTAKES = ["informed", "approval", "advisory"] as const;
export type ChangeRequestIntake = (typeof CHANGE_REQUEST_INTAKES)[number];

/**
 * WHO executes the change. For an automatically-routed Microsoft change this
 * records that Microsoft — not the MSP — is the implementer (the headline of
 * #1534: "a Microsoft change the tenant cannot refuse is a CR from the moment it
 * is announced, with Microsoft as the implementer"). `customer` covers the
 * advisory case where the tenant's own admin must do the migration work. NULL /
 * absent means the ordinary internal case — the MSP implements it — which is
 * every CR that predates routing, so nothing is back-filled.
 */
export const CHANGE_REQUEST_IMPLEMENTERS = ["microsoft", "customer", "msp"] as const;
export type ChangeRequestImplementer = (typeof CHANGE_REQUEST_IMPLEMENTERS)[number];

/** What spawned an auto-routed CR. Only `microsoft_change` is written today; NULL = raised directly. */
export const CHANGE_REQUEST_SOURCE_KINDS = ["microsoft_change"] as const;
export type ChangeRequestSourceKind = (typeof CHANGE_REQUEST_SOURCE_KINDS)[number];

export const mspChangeRequestsTable = pgTable("msp_change_requests", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  primaryDomain: text("primary_domain").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  changeClass: text("change_class", { enum: ["standard", "normal", "emergency"] }).notNull().default("normal"),
  riskLevel: text("risk_level", { enum: ["critical", "high", "medium", "low"] }).notNull().default("medium"),
  // Widened from the original five (ConditionalAccess/Exchange/Identity/Intune/
  // Defender) to the eight workloads the customer-facing Change Control page
  // classifies against — see `CC_WORKLOADS` in the design prototype and
  // `api-server/src/lib/portal-change-control.ts`. SharePoint and Purview are
  // not edge cases: the design's own first two example change requests are a
  // SharePoint sharing-link revert and a Purview retention lock, neither of
  // which could previously be stored.
  //
  // NO MIGRATION IS REQUIRED and none was written. Verified live before making
  // this change: the column is plain `text` and `pg_constraint` on
  // msp_change_requests returns only its primary key and the msp_id foreign
  // key — there is no CHECK constraint mirroring this list, so Drizzle's `enum`
  // here is a TypeScript-level type only. Adding a DDL file for this would
  // record a database change that does not exist.
  category: text("category", { enum: ["ConditionalAccess", "Exchange", "Identity", "Intune", "Defender", "SharePoint", "Purview", "Teams"] }).notNull().default("Identity"),
  targetResource: text("target_resource").notNull(),
  psaTicketId: text("psa_ticket_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  /**
   * #1762 — the change's booked execution window as a REAL instant, additive
   * alongside `scheduled_for` above. `scheduled_for` stays exactly as it is: a
   * free-text human label ("Thu 27 Aug · 07:00–09:00 BST", "Awaiting records
   * sign-off — no window booked", "Microsoft rollout — by 15 September"). The
   * label and the instant are different things and BOTH are real — the label is
   * what a human wrote, this pair is what a freeze check, a date-ordering, or an
   * SLA-vs-execution check can actually evaluate.
   *
   * BOTH NULLABLE ON PURPOSE, and NOTHING is back-filled by parsing prose. An
   * existing row's `scheduled_for` may carry no instant at all ("no window
   * booked") or no year ("Thu 27 Aug"), and a guessed timestamp that a freeze
   * check then enforces against is worse than no timestamp. NULL means "no
   * window booked as a real instant"; every consumer treats NULL as unavailable
   * — never as zero, never as now(), never as a default. Populated only where a
   * real instant is genuinely known: the wizard/MSP-console create paths when
   * the caller supplies one, and the Microsoft-routing path from the
   * announcement's own structured date. See
   * `lib/db/migrations/manual/2026-08-29-cr-scheduled-instant-1762.sql`.
   */
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  impactedUsersCount: integer("impacted_users_count").notNull().default(0),
  status: text("status", { enum: ["pending_approval", "scheduled", "in_progress", "completed", "rolled_back", "rejected"] }).notNull().default("pending_approval"),
  backupVerified: boolean("backup_verified").notNull().default(true),
  backupHash: text("backup_hash").notNull(),
  preChangeSnapshot: jsonb("pre_change_snapshot").notNull().default({}),
  proposedPayload: jsonb("proposed_payload").notNull().default({}),
  rollbackScriptSnippet: text("rollback_script_snippet").notNull(),
  executedAt: text("executed_at"),
  approvedBy: text("approved_by"),
  /**
   * #1497 — Change Control as the AUTHORIZATION GATE on the tenant write path.
   *
   * An approved CR *is* the permission to write: the config-pack write path
   * (`runConfigPackForCustomer` → the Workflow Engine) refuses to fire unless an
   * approved, unconsumed CR for the target tenant is claimed here. Claiming
   * atomically moves the CR `pending_approval`/`scheduled` → `in_progress` and
   * stamps the wf_run that executes it into this column; the CR is then closed to
   * `completed` when that run finishes (the reconciliation sweep), which is what
   * finally lets `monitor-executor` attribute the resulting drift to `CR-<id>` and
   * read it as `approved` instead of unauthorized drift.
   *
   * NULL on every CR that has never authorized a write (the overwhelming
   * majority). A SOFT link — no foreign key, the same discipline `tenant_id`
   * follows — so a pruned wf_run never cascades a CR away and the sweep simply
   * tolerates a run row that no longer exists. Additive nullable column; see
   * `lib/db/migrations/manual/2026-08-29-cr-authorization-gate-1497.sql`.
   */
  executorRunId: integer("executor_run_id"),
  /**
   * #1773 — closes the gap #1497 knowingly left open: the write gate authorized
   * on TENANT alone ("an approved CR for this tenant"), never checking that the
   * CR actually describes the change being executed. An approved trivial CR
   * could authorize an unrelated high-impact config-pack/SOP run against the
   * same tenant.
   *
   * When set, this is the `pack:<packKey>` or `sop:<sopId>` this CR was scoped
   * to at raise time, and `claimChangeRequestForWrite` requires an exact match
   * against what the caller is actually about to execute — a scoped CR can
   * never authorize a different target. NULL preserves #1497's original
   * tenant-granularity model exactly (a CR raised for a general, non-catalog
   * change was never meant to be pinned to one pack/SOP), so every pre-existing
   * CR and every general MSP-console-raised CR is unaffected. Populated today
   * by `raisePolicyEnactmentChangeRequest` (#1550, always exactly one SOP) and
   * optionally by the MSP console create route, when an operator deliberately
   * scopes a CR to the specific automated run it is meant to greenlight.
   * Additive nullable column; see
   * `lib/db/migrations/manual/2026-09-02-cr-authorized-target-key-1773.sql`.
   */
  authorizedTargetKey: text("authorized_target_key"),
  /**
   * "Raised from" — the finding this change request came out of, e.g.
   * "Governance · External Sharing Drift" (the design's `linked` field).
   *
   * Added because the customer portal's Change Control page has a cell for it
   * and the table had no column, so the cell could only ever be blank. It is not
   * decoration: the portal's central rule is that every fix routes through a
   * change request, and this is the only thing that makes that traceable in the
   * direction a customer reads it — from the change back to the problem it was
   * raised to solve.
   *
   * Free text rather than a foreign key on purpose. A finding is not one row in
   * one table: it may be a monitor check, a pillar drill-down area, or a hold
   * window, and pinning this to any single one of those would make the other two
   * unrepresentable. NULL means "raised directly", which is a real state — the
   * wizard raises exactly those.
   */
  linkedFinding: text("linked_finding"),
  /**
   * #1541 — the STRUCTURED counterpart to `linkedFinding` above. `linkedFinding`
   * is free text for display ("Governance · External Sharing Drift"); this is
   * the exact `remediation_knowledge_base.checkKey` / `monitor_checks.key` this
   * CR was raised to fix, when it was raised from a remediation item rather than
   * typed by hand. It is the join the CR gate (`remediation-reveal-gate.ts`)
   * queries to answer "is there an approved change request authorizing this
   * customer to see the script for THIS finding" — `linkedFinding`'s prose
   * cannot be queried exactly, and a finding is not always representable as one
   * DB row (see `linkedFinding`'s own comment), which is why this is a second,
   * narrower column rather than a repurposing of that one.
   *
   * No FK on purpose: the check-key space is the UNION of published KB rows and
   * live-pack-mapped checks (`remediation-fix-route.ts`'s `allKeys`), not any
   * single table, so a hard FK to either would reject a real key from the other
   * source. NULL on every CR that predates this column and every CR raised
   * directly (a wizard submission with no `remediationCheckKey` in its body).
   */
  remediationCheckKey: text("remediation_check_key"),

  // ── Automatic routing of Microsoft changes (#1534, part of #1494) ──────────
  //
  // A resolved Microsoft change (a confirmed interpretation whose per-tenant
  // count is > 0 and which carries a real structural date) is routed into this
  // register AUTOMATICALLY, with Microsoft as the implementer. These four columns
  // are what routing needs and the table did not previously carry: the intake
  // axis, who implements it, and the link back to the announcement it came from.
  //
  // ALL NULLABLE ON PURPOSE. Every CR that predates routing — every wizard- or
  // drift-raised one — leaves them null, and null reads as "raised directly, MSP
  // implements". Nothing is back-filled. See m365-change-router.ts for the writer.
  intake: text("intake", { enum: ["informed", "approval", "advisory"] }),
  implementer: text("implementer", { enum: ["microsoft", "customer", "msp"] }),
  sourceKind: text("source_kind", { enum: ["microsoft_change"] }),
  /** The Message Center announcement (graph_message_id) this CR was routed from — the tenant-facing notice. */
  sourceGraphMessageId: text("source_graph_message_id"),
  /** The m365_change_interpretations row that authored the reading behind this CR. */
  sourceInterpretationId: integer("source_interpretation_id"),
  /** The m365_change_resolutions row (the count) that tripped the routing trigger. */
  sourceResolutionId: integer("source_resolution_id"),

  /**
   * #1498 — set only when this CR was raised by executing a pre-approved
   * standard change catalog item, rather than the wizard or Microsoft routing.
   * Forward reference: `changeCatalogItemsTable` is declared later in this
   * file. `set null` on delete rather than `cascade` — a catalog item is never
   * hard-deleted (only revoked), but if it ever were, the CRs it already
   * produced are a real historical record and must not disappear with it.
   */
  catalogItemId: integer("catalog_item_id").references((): AnyPgColumn => changeCatalogItemsTable.id, { onDelete: "set null" }),

  /**
   * #1499 — set only when this CR is the INVERSE ROLLBACK of another CR. A
   * rollback is itself a change: reverting an executed change is not a silent
   * button, it is a new change request that carries its own record and clears
   * its own approval before anything is written back to the tenant. This column
   * is the link from that inverse CR to the original it reverses.
   *
   * NULL on every ordinary CR (the overwhelming majority) — a forward change
   * reverses nothing. Self-reference, `set null` on delete rather than cascade:
   * the inverse CR is a real historical change in its own right and must not
   * vanish if the original it reversed is ever pruned. See
   * `lib/db/migrations/manual/2026-08-29-cr-executions-rollback-writeback-1499.sql`.
   */
  rollbackOfChangeRequestId: integer("rollback_of_change_request_id").references(
    (): AnyPgColumn => mspChangeRequestsTable.id,
    { onDelete: "set null" },
  ),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_change_requests_msp_id_idx").on(t.mspId),
  index("msp_change_requests_tenant_id_idx").on(t.tenantId),
  index("msp_change_requests_catalog_item_id_idx").on(t.catalogItemId),
  index("msp_change_requests_rollback_of_idx").on(t.rollbackOfChangeRequestId),
  // #1497 — the reconciliation sweep joins in-flight CRs to their executor
  // wf_run by this column, so index it for the (small, frequent) settle query.
  index("msp_change_requests_executor_run_id_idx").on(t.executorRunId),
  // #1541 — the CR gate's own lookup: "every CR raised for this (tenant, check)".
  index("msp_change_requests_remediation_check_key_idx").on(t.remediationCheckKey),
  // One auto-routed CR per (interpretation × tenant): the routing sweep's
  // idempotency guard so a nightly re-run never creates a second CR for the
  // same Microsoft change on the same tenant. Partial — only routed rows carry
  // these — and declared in the manual migration (Drizzle cannot express the
  // WHERE clause here).
]);

export const insertMspChangeRequestSchema = createInsertSchema(mspChangeRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspChangeRequest = typeof mspChangeRequestsTable.$inferSelect;
export type InsertMspChangeRequest = typeof mspChangeRequestsTable.$inferInsert;

// ── Change freeze / blackout windows (#1500) ─────────────────────────────────
//
// No freeze-window table existed at all: the retired page's `freezeException`,
// `freezeOpen` and `freezesOv` were client-side stubs hardcoded to false/null —
// the UI already pretended this feature was real. This is that backend.
//
// Scoped `global` (every tenant of this MSP), `tenant` (one M365 tenant — the
// same free-text `tenant_id` shape `msp_change_requests` uses, since this is
// the MSP-era table family, not the portal's `customer_id` one) or `workload`
// (one Change Control workload, e.g. "Exchange / mail" — the same
// `CHANGE_REQUEST_WORKLOADS` vocabulary `api-server/src/lib/portal-change-
// control.ts` already defines), so a quarter-close freeze and a "no Exchange
// changes during migration" freeze are both one row, not two mechanisms.
//
// A window either fires once (`recurrence: 'none'`, the literal [startsAt,
// endsAt) span) or repeats on a fixed cadence anchored at `startsAt` —
// `recurrenceUntil` bounds how far the repeat runs (null = no bound).
// Enforcement (`api-server/src/lib/portal-change-freeze.ts`) walks the cadence
// forward from the anchor rather than storing one row per occurrence, so a
// standing "always frozen the last week of every quarter" rule is one row for
// its entire lifetime.
export const CHANGE_FREEZE_SCOPES = ["global", "tenant", "workload"] as const;
export type ChangeFreezeScope = (typeof CHANGE_FREEZE_SCOPES)[number];

export const CHANGE_FREEZE_RECURRENCES = ["none", "weekly", "monthly", "quarterly", "annually"] as const;
export type ChangeFreezeRecurrence = (typeof CHANGE_FREEZE_RECURRENCES)[number];

export const changeFreezeWindowsTable = pgTable("change_freeze_windows", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: CHANGE_FREEZE_SCOPES }).notNull(),
  /** Required when scope = 'tenant': the free-text M365 tenant identifier. NULL otherwise. */
  tenantId: text("tenant_id"),
  /** Required when scope = 'workload': one of `CHANGE_REQUEST_WORKLOADS`. NULL otherwise. */
  workload: text("workload"),
  name: text("name").notNull(),
  reason: text("reason"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  recurrence: text("recurrence", { enum: CHANGE_FREEZE_RECURRENCES }).notNull().default("none"),
  /** Only meaningful when recurrence <> 'none'. NULL = repeats indefinitely. */
  recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("change_freeze_windows_msp_id_idx").on(t.mspId),
  index("change_freeze_windows_scope_idx").on(t.mspId, t.scope),
  index("change_freeze_windows_active_idx").on(t.active),
]);

export const insertChangeFreezeWindowSchema = createInsertSchema(changeFreezeWindowsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ChangeFreezeWindow = typeof changeFreezeWindowsTable.$inferSelect;
export type InsertChangeFreezeWindow = typeof changeFreezeWindowsTable.$inferInsert;

// ── Change Control approval ledger (#1496) ───────────────────────────────────
//
// `msp_change_requests.approvedBy` is a single free-text string: it can record
// that ONE person (or "Microsoft") approved, and nothing else — no history, no
// rejection reason, no second approver, no stage, no SLA, no delegated
// authority. That is the whole gap #1496 exists to close.
//
// `cr_approvals` is the durable approval RECORD — one row per approver decision
// against a change. Approval attaches to the CHANGE, not the change class: a
// standard or auto-approved change still produces a real CR AND a real approval
// row here (see the `approverRole` note below). `approvedBy` on the CR stays as
// a denormalised display cache of the final decision so the existing
// `displayStatus()` derivation keeps working; this table is the truth behind it.
//
// The (mspId, tenantId) pair is denormalised from the parent CR so this table
// scopes with the exact same predicate pair every other customer-facing Change
// Control read uses — see routes/portal-change-control.ts's header for why
// neither half is sufficient alone.
export const crApprovalsTable = pgTable("cr_approvals", {
  id: serial("id").primaryKey(),
  /** The change this decision is against. Real FK — an approval cannot outlive its CR. */
  changeRequestId: integer("change_request_id")
    .notNull()
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  /** Denormalised from the parent CR so this table scopes on the same (mspId, tenantId) pair. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  /**
   * Which approval stage this row belongs to. A low-risk change needs one stage;
   * a high/critical change needs the requirement's multiple stages, gated in
   * order. Two rows sharing a stage express a QUORUM (both must approve to clear
   * that stage) — the model supports it even where current policy asks for one.
   */
  stage: integer("stage").notNull().default(1),
  /**
   * The decision on this slot. `pending` is a required-but-undecided approval
   * (this is what carries an SLA `dueAt`); `superseded` is a still-pending later
   * stage that a rejection at an earlier stage made moot — a real terminal state,
   * not a decision anyone made.
   */
  decision: text("decision", {
    enum: ["pending", "approved", "rejected", "superseded"],
  }).notNull().default("pending"),
  /**
   * WHO holds this approval authority — never "the system".
   *   • `customer` — a CustomerUser carrying the live `canApproveChanges` flag,
   *     approving a change to their own live tenant. The authority #1496 adds.
   *   • `msp` — an MSP operator/admin approving on the delivery side.
   *   • `catalog_inherited` — an auto-approved standard change inherits the
   *     approval of the HUMAN who approved the catalog item it came from. The
   *     approver is that person, recorded here, not "the system" — because that
   *     is the one answer that does not survive an audit question. (Populated
   *     once the change catalog carries an approver; the column exists now so the
   *     model is complete.)
   *   • `microsoft_forced` — a Microsoft change the tenant cannot refuse is
   *     auto-approved from announcement (#1497/#1534). The approver named is
   *     Microsoft (the forcing party), which is honest — again, not "the system".
   */
  approverRole: text("approver_role", {
    enum: ["customer", "msp", "catalog_inherited", "microsoft_forced"],
  }).notNull(),
  /** The approver's wire person id ("u<userId>", see portal-ownership.personIdForUser). NULL on an unfilled pending slot. */
  approverPersonId: text("approver_person_id"),
  /** Display name of the approver (or "Microsoft (auto-approved …)"). NULL on an unfilled pending slot. */
  approverName: text("approver_name"),
  /**
   * Set when the decision was made under a DELEGATION (reusing
   * portal_ownership_delegations): `approverPersonId` is who actually clicked,
   * `onBehalfOfPersonId` is the person whose authority they were covering. Both
   * are recorded so the audit trail reads "B approved, acting for A".
   */
  onBehalfOfPersonId: text("on_behalf_of_person_id"),
  /** Rejection reason, or an optional approval note. NULL when none given. */
  reason: text("reason"),
  /** When the decision was made. NULL while still pending. */
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /** The approval SLA deadline for a pending slot — breach past this escalates. NULL when no SLA applies (auto-approved). */
  dueAt: timestamp("due_at", { withTimezone: true }),
  /** Stamped once by the breach sweep when a pending slot passes `dueAt`, so it escalates exactly once. */
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  /**
   * Set ONLY on the stage created because a change was submitted inside an
   * active freeze window with a written exception (#1500). Non-null is what
   * MARKS a row as a freeze-exception stage: `recordApproval`/`recordRejection`
   * require the deciding party to hold `approver.role === 'msp'` on this
   * stage — the "higher approval bar" the freeze policy promises, on top of
   * (not instead of) whatever ordinary stages the change already needed. The
   * window stays resolvable from the decision for audit ("which freeze did
   * this override"). ON DELETE SET NULL rather than cascade: the decision
   * record must survive a freeze window being edited away later.
   */
  freezeWindowId: integer("freeze_window_id").references(() => changeFreezeWindowsTable.id, { onDelete: "set null" }),
  /**
   * The mandatory written justification the requester gave for the exception.
   * NULL on every ordinary stage; set once at creation and never touched by
   * the decision itself (which writes its own note into `reason` instead, so
   * the original ask is never overwritten by the approver's remark).
   */
  justification: text("justification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cr_approvals_change_request_id_idx").on(t.changeRequestId),
  index("cr_approvals_msp_tenant_idx").on(t.mspId, t.tenantId),
  // The breach sweep scans pending, dated, not-yet-escalated slots.
  index("cr_approvals_pending_due_idx").on(t.decision, t.dueAt),
  index("cr_approvals_freeze_window_id_idx").on(t.freezeWindowId),
]);

export const insertCrApprovalSchema = createInsertSchema(crApprovalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CrApproval = typeof crApprovalsTable.$inferSelect;
export type InsertCrApproval = typeof crApprovalsTable.$inferInsert;
export type CrApprovalDecision = CrApproval["decision"];
export type CrApproverRole = CrApproval["approverRole"];

// ── Change Control execution record (#1499) ──────────────────────────────────
//
// A CR AUTHORIZES a change; it does not EXECUTE one. Before #1499 the only trace
// of execution was `msp_change_requests.executed_at` — a single timestamp with
// no implementer, no bound executor, no planned-vs-actual, and no rollback
// verification. `cr_executions` is the durable EXECUTION record: one row per time
// an authorized change is actually carried out, binding the CR to WHICHEVER of
// the three executors did the work.
//
//   • `runbook_run` / `write_action` — a Workflow Engine run (the config-pack
//     orchestrator, #1497). `wf_run_id` soft-links `wf_runs.id`, and `pack_key`
//     records which pack executed. This is a change a code path can confirm.
//   • `human_action` — a change only a person can make (a tenant admin toggling a
//     portal setting Graph cannot reach). No code path observes it, so it needs
//     an ATTESTATION — who, when, against which CR — recorded in the `attested_*`
//     columns. Without that, a human change is indistinguishable from
//     unattributed drift.
//
// The `wf_run_id` link is SOFT (no FK) — the same discipline
// `msp_change_requests.executor_run_id` follows — so a pruned wf_run never
// cascades an execution record away; the row keeps its own `pack_key`/`outcome`
// as the standing history. `msp_id`/`tenant_id` are denormalised from the parent
// CR so this table scopes on the exact same predicate pair every other Change
// Control read uses.
export const CR_EXECUTOR_KINDS = ["runbook_run", "write_action", "human_action"] as const;
export type CrExecutorKind = (typeof CR_EXECUTOR_KINDS)[number];

/** How an execution ended. `pending` while in flight; `rolled_back` once an inverse CR has reverted it. */
export const CR_EXECUTION_OUTCOMES = ["pending", "succeeded", "failed", "rolled_back"] as const;
export type CrExecutionOutcome = (typeof CR_EXECUTION_OUTCOMES)[number];

/** The verification state of a rollback execution (only set on an execution of an inverse/rollback CR). */
export const CR_ROLLBACK_OUTCOMES = ["pending", "verified", "failed"] as const;
export type CrRollbackOutcome = (typeof CR_ROLLBACK_OUTCOMES)[number];

export const crExecutionsTable = pgTable("cr_executions", {
  id: serial("id").primaryKey(),
  /** The authorizing change this execution carried out. Real FK — an execution cannot outlive its CR. */
  changeRequestId: integer("change_request_id")
    .notNull()
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  /** Denormalised from the parent CR so this table scopes on the same (mspId, tenantId) pair. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  /** Which of the three executors carried the change out. */
  executorKind: text("executor_kind", { enum: CR_EXECUTOR_KINDS }).notNull(),
  /**
   * The Workflow Engine run that executed this change, when a run did. SOFT link
   * (no FK) — a pruned wf_run must not cascade this record away, so this tolerates
   * a run row that no longer exists, exactly as `executor_run_id` does. NULL for a
   * `human_action` (nothing ran).
   */
  wfRunId: integer("wf_run_id"),
  /** The config pack that executed, for a runbook/write execution. NULL for a human action. */
  packKey: text("pack_key"),
  /** Who actually implemented the change — the same vocabulary the CR's own `implementer` uses. */
  implementer: text("implementer", { enum: CHANGE_REQUEST_IMPLEMENTERS }),
  outcome: text("outcome", { enum: CR_EXECUTION_OUTCOMES }).notNull().default("pending"),

  // ── Planned-vs-actual (#1499) ──────────────────────────────────────────────
  // The `planOnly` preview already exists in the config-pack orchestrator
  // (config-pack-dry-run.ts). Capturing it here at authorization time and
  // diffing it against what actually happened is what turns "we ran something"
  // into "we ran what was approved, and here is where reality differed".
  /** The captured `planOnly` plan — the ConfigPackDryRun the CR was approved against. NULL until captured. */
  plannedPlan: jsonb("planned_plan").$type<unknown>(),
  /** The real per-step outcome captured after the run (wf_run node outputs, normalised). NULL until reconciled. */
  actualOutcome: jsonb("actual_outcome").$type<unknown>(),
  /** The diff verdict: true when every planned step executed as planned. NULL until the diff is computed. */
  planMatched: boolean("plan_matched"),
  /** The structured planned-vs-actual diff. NULL until computed. */
  planDiff: jsonb("plan_diff").$type<unknown>(),

  // ── crRef writeback (#1499) ────────────────────────────────────────────────
  // On completion of the authorized action the authorizing CR reference
  // (`CR-<id>`) is written back here. This is the durable, direct binding drift
  // attribution reads — a change that carries its authorizing reference is
  // `approved` drift, not the unattributed kind.
  /** The authorizing CR reference (`CR-2026-<n>`), written back on completion. NULL until the action completes. */
  crRef: text("cr_ref"),
  /** When the `cr_ref` was written back. NULL while the action is still in flight. */
  writtenBackAt: timestamp("written_back_at", { withTimezone: true }),

  // ── Human-action attestation (#1499) ───────────────────────────────────────
  // A `human_action` has no code path to confirm it. These record who attests
  // they performed it, when, and any note — the only thing that makes a manual
  // change attributable rather than indistinguishable from drift.
  /** Display name / email of the person attesting they performed the human action. NULL until attested. */
  attestedBy: text("attested_by"),
  /** The attester's wire person id ("u<userId>"). NULL until attested. */
  attestedByPersonId: text("attested_by_person_id"),
  /** When the human action was attested. NULL while unattested — a `human_action` is not confirmed until this is set. */
  attestedAt: timestamp("attested_at", { withTimezone: true }),
  /** An optional note the attester left describing what they did. */
  attestationNote: text("attestation_note"),

  // ── Rollback verification (#1499) ──────────────────────────────────────────
  // Set only on the execution of an INVERSE/rollback CR (one whose
  // `msp_change_requests.rollback_of_change_request_id` is non-null). A rollback
  // is a real change, so it executes and is verified like any other — these two
  // columns are its verification result.
  /** When the rollback was verified to have restored the pre-change state. NULL until verified. */
  rollbackVerifiedAt: timestamp("rollback_verified_at", { withTimezone: true }),
  /** The rollback verification outcome. NULL on a forward (non-rollback) execution. */
  rollbackOutcome: text("rollback_outcome", { enum: CR_ROLLBACK_OUTCOMES }),

  /** When the change was actually carried out (run finish, or the attested time for a human action). NULL while pending. */
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cr_executions_change_request_id_idx").on(t.changeRequestId),
  index("cr_executions_msp_tenant_idx").on(t.mspId, t.tenantId),
  index("cr_executions_wf_run_id_idx").on(t.wfRunId),
]);

export const insertCrExecutionSchema = createInsertSchema(crExecutionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CrExecution = typeof crExecutionsTable.$inferSelect;
export type InsertCrExecution = typeof crExecutionsTable.$inferInsert;

// ── Standard Change Catalog (#1498) ──────────────────────────────────────────
//
// Pre-approved templates that skip CAB. A catalog item points at a `packKey` —
// approve once, execute many. This is a GOVERNED OBJECT, not a config file:
// each item's approval is itself a signed, dated, revocable decision, because
// every auto-approved `standard` change request raised from it inherits ITS
// authority. That is exactly what `cr_approvals.approver_role =
// 'catalog_inherited'` above already anticipates ("Populated once the change
// catalog carries an approver; the column exists now so the model is
// complete") — a catalog-raised CR is inserted with `approvedBy` set to this
// row's `approvedByName`, and `materializeApprovalsForChange`'s existing
// "already-approved at creation" branch records that same real name into the
// ledger. No approver is ever "the system".
//
// Two settled decisions this table is built to satisfy exactly, no more:
//   • #1554 — standard vs non-standard is a property of the WHOLE runbook
//     (the config pack a `packKey` resolves to), decided at authoring time.
//     There is no partial/mixed/half-approved state here — `status` covers the
//     whole item, never a subset of its steps.
//   • #1555 — once approved, a catalog item runs unattended INDEFINITELY. No
//     expiry, no periodic re-approval, no review cycle — deliberately no
//     `reviewDueAt` / `expiresAt` column exists. The only way out of `approved`
//     is a human revoking it, and that takes effect immediately: every execute
//     checks live `status`, never a cached/JWT-carried flag.
export const CHANGE_CATALOG_ITEM_STATUS = ["draft", "approved", "revoked"] as const;
export type ChangeCatalogItemStatus = typeof CHANGE_CATALOG_ITEM_STATUS[number];

export const changeCatalogItemsTable = pgTable("change_catalog_items", {
  id: serial("id").primaryKey(),
  /** Owning MSP — each MSP curates and governs its own catalog. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The runbook this item pre-authorises. A real `config_packs.pack_key`. */
  packKey: text("pack_key").notNull().references(() => configPacksTable.packKey),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // Same widened vocabulary as msp_change_requests.category (see that column's
  // own note) — a catalog-raised CR must classify onto the same workload chips
  // as every other CR in the register.
  category: text("category", { enum: ["ConditionalAccess", "Exchange", "Identity", "Intune", "Defender", "SharePoint", "Purview", "Teams"] }).notNull().default("Identity"),
  // The badge a catalog-raised CR carries. requiredStages() is 0 for `standard`
  // regardless of risk (see portal-change-approvals.ts), so this is display
  // only, never a gate — pre-approved routine work defaults to low.
  riskLevel: text("risk_level", { enum: ["critical", "high", "medium", "low"] }).notNull().default("low"),
  status: text("status", { enum: CHANGE_CATALOG_ITEM_STATUS }).notNull().default("draft"),
  // ── The governing decision — WHO, WHEN, never "the system" ──────────────────
  approvedByPersonId: text("approved_by_person_id"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // ── Revocation — the control, and it is immediate (#1555) ───────────────────
  revokedByPersonId: text("revoked_by_person_id"),
  revokedByName: text("revoked_by_name"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  createdByPersonId: text("created_by_person_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("change_catalog_items_msp_id_idx").on(t.mspId),
  index("change_catalog_items_pack_key_idx").on(t.packKey),
  index("change_catalog_items_msp_status_idx").on(t.mspId, t.status),
]);

export const insertChangeCatalogItemSchema = createInsertSchema(changeCatalogItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type ChangeCatalogItem = typeof changeCatalogItemsTable.$inferSelect;
export type InsertChangeCatalogItem = typeof changeCatalogItemsTable.$inferInsert;

// ── Standing Policies (#1547) — the Policy Engine's declarative object ──────────
//
// A standing policy is DECLARATIVE and operationally live: it states a target
// state; it cites no obligation, follows no finding, and requires no signature.
// This is the SECOND object of the Policy Engine, and it is deliberately NOT a
// row on `mspRiskDecisionsTable` (msp_risk_decisions) — that table is the
// register of reactive, obligation-bound, SIGNED deviation decisions
// (#1525-#1529). Both are called "policy"; they are not the same object and
// must not share a table on the strength of the word. #1547 exists to establish
// exactly this separation, because the rest of the Policy Engine (#1548-#1553)
// depends on it existing first.
//
// The target state does two jobs from ONE declaration:
//   forward  — what an SOP drives toward when provisioning (a new exec tagged
//              VIP -> add to these groups). #1548 enacts via an SOP; the engine
//              itself never executes directly.
//   backward — what a check compares against to find a member out of state (a
//              VIP who is NOT in the right groups). #1553 turns that divergence
//              into a finding on msp_diagnostic_findings.
//
// Attachment point is the OU (active_directory_ous): a policy binds to a
// container, and container membership determines what applies. This is exactly
// the object the reserved OU scaffolding at
// active-directory.ts ("reserved for a future version") was placed for.
//
// `catalogItemId` records the #1550 relationship — a policy IS a standard change
// catalog item; a forward enactment raises its auto-approved CR from that
// pre-approved catalog item. Nullable here on purpose: #1547 establishes the
// object and the relationship; #1550 builds the enactment/approval flow that
// makes the binding load-bearing.
//
// `sopId` records the #1548 relationship — the named procedure that enacts the
// target state. `msp_sop_runs.standing_policy_id` (see that table below) is the
// other half: the enactment record a policy-invoked run is traced back through.
// The engine names the procedure and, later, traces its own runs; it never
// executes anything itself — that stays the SOP module's job.
export const STANDING_POLICY_TARGET_KIND = [
  // e.g. "mailbox size 150MB" — a directory/mailbox attribute target.
  "mailbox_attribute",
  // e.g. "VIP -> membership of these groups" — a group-membership target.
  "group_membership",
  // e.g. "VIP -> extra spam filtering" — a service-configuration target.
  "service_policy",
] as const;

export const standingPoliciesTable = pgTable("standing_policies", {
  id: serial("id").primaryKey(),
  /** Owning MSP — each MSP authors and governs its own standing policies. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The container this policy binds to — the attachment point (#1547). */
  ouId: integer("ou_id").notNull().references(() => activeDirectoryOusTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  targetKind: text("target_kind", { enum: STANDING_POLICY_TARGET_KIND }).notNull(),
  /**
   * The declaration itself — the SAME map read forward (provisioning) and
   * backward (compliance comparison). Its shape varies by `targetKind`, so
   * jsonb is the honest representation of "a container -> target-state map".
   * Never money and never a signature; this object carries neither.
   */
  targetState: jsonb("target_state").notNull().default({}),
  /**
   * #1550: the pre-approved `change_catalog_items` row a forward enactment
   * raises its auto-approved CR from. Nullable — the relationship exists at
   * #1547; #1550 makes it load-bearing.
   */
  catalogItemId: integer("catalog_item_id").references(() => changeCatalogItemsTable.id, { onDelete: "set null" }),
  /**
   * #1548: "Policy defines a target state and names the procedure that
   * achieves it." — the `msp_sops.sop_id` (text, the same join key
   * `msp_sop_runs.sop_id` already uses, not the numeric `msp_sops.id`) whose
   * run enacts this policy's target state. The engine itself never executes;
   * this column is only the naming half of that sentence. Nullable for the
   * same reason `catalogItemId` above is: a policy's target state can be
   * declared before the SOP that will enact it exists.
   */
  sopId: text("sop_id"),
  /**
   * Opt-in, default-off (#1549's continuous-evaluation default): a policy can
   * be authored and inspected before it is switched on to drive provisioning
   * or raise findings.
   */
  isActive: boolean("is_active").notNull().default(false),
  createdByPersonId: text("created_by_person_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("standing_policies_msp_id_idx").on(t.mspId),
  index("standing_policies_ou_id_idx").on(t.ouId),
  index("standing_policies_msp_active_idx").on(t.mspId, t.isActive),
  index("standing_policies_sop_id_idx").on(t.sopId),
]);

export const insertStandingPolicySchema = createInsertSchema(standingPoliciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type StandingPolicy = typeof standingPoliciesTable.$inferSelect;
export type InsertStandingPolicy = typeof standingPoliciesTable.$inferInsert;
export type StandingPolicyTargetKind = (typeof STANDING_POLICY_TARGET_KIND)[number];

// ── VIP Classification (#1552) ──────────────────────────────────────────────
//
// #1552's own resolution (2026-08-28, on the issue): "A user becomes VIP by
// one of three routes: Told, group membership, AD attribute" — but the three
// are NOT equal truth-holders. THE PLATFORM IS AUTHORITATIVE, not the tenant.
//
//   told                  — a decision made HERE, in the platform. The only
//                            source that establishes or changes the current
//                            classification once one exists.
//   discovered_group       — a tenant-side group-membership READ HINT, useful
//   discovered_attribute      only for DISCOVERY at onboarding to seed who is
//                            already VIP in an existing estate. Once the
//                            platform holds a classification for a principal,
//                            these are no longer sources of truth — a
//                            tenant-side change becomes DRIFT to correct
//                            (#1553's job), not a value to adopt here.
//
// This is why the table is a CURRENT-STATE object (one row per customer +
// principal, upserted by "told") rather than an append-only event log: only
// one classification is ever live, and only "told" may move it. De-VIP is
// itself an act performed here (a runbook, #1548's enactment path) — never
// something this table infers from a tenant-side removal.
//
// Identified by the Graph user object id (`principal_id`) the same way
// `license_assignment_snapshots.user_id` and `overshared_items.principal_id`
// already do elsewhere in this schema — no local directory-user inventory
// table exists to FK against, and none is needed: the identity IS the Graph
// object id.
export const VIP_CLASSIFICATION_SOURCES = ["told", "discovered_group", "discovered_attribute"] as const;
export type VipClassificationSource = (typeof VIP_CLASSIFICATION_SOURCES)[number];

export const vipClassificationsTable = pgTable("vip_classifications", {
  id: serial("id").primaryKey(),
  /** tenants.id — no FK by design (see Phase 7 audit; same convention as msp_audit_logs.customerId). */
  customerId: integer("customer_id").notNull(),
  /** Graph user object id — the stable identity. */
  principalId: text("principal_id").notNull(),
  /** Display/reference only — never the join key. */
  principalUpn: text("principal_upn").notNull(),
  isVip: boolean("is_vip").notNull(),
  /** Which route produced the CURRENT value. "told" is the only source that can move this once set. */
  source: text("source", { enum: VIP_CLASSIFICATION_SOURCES }).notNull(),
  /**
   * Provenance for a discovery-sourced row (e.g. { groupId, groupName } or
   * { attributeName, attributeValue }). Null for "told" — a platform decision
   * cites no tenant-side evidence.
   */
  discoveryDetail: jsonb("discovery_detail").$type<Record<string, unknown> | null>(),
  /** Who told it. Null for a discovery-seeded row — nothing was "told" yet. */
  classifiedByPersonId: text("classified_by_person_id"),
  classifiedByName: text("classified_by_name"),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("vip_classifications_customer_principal_uniq").on(t.customerId, t.principalId),
  index("vip_classifications_customer_id_idx").on(t.customerId),
  index("vip_classifications_customer_vip_idx").on(t.customerId, t.isVip),
]);

export const insertVipClassificationSchema = createInsertSchema(vipClassificationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type VipClassification = typeof vipClassificationsTable.$inferSelect;
export type InsertVipClassification = typeof vipClassificationsTable.$inferInsert;

// ── Policy Evaluation Runs (#1549) — the continuous-evaluation reconciliation loop ──
//
// #1549 SETTLED: "the policy engine evaluates continuously," on two triggers —
// EVENT (something changed for one tenant right now, e.g. a standing policy
// was just switched on) and DIVERGENCE (a periodic sweep that re-checks every
// active policy so drift introduced by hand is eventually caught, not only
// provisioning-time state). This table is the durable, queryable register that
// loop produces: one row per policy actually considered on a pass. It is the
// visible proof the reconciliation loop ran, and the hand-off point #1548
// (SOP enactment) and #1553 (non-compliance -> finding) attach to next — this
// issue does not execute an SOP and does not write a finding itself.
//
// `outcome` is honest about what could actually be checked at this point in
// the build-out. `not_evaluable` is the real, current answer for every target
// kind today: `standing_policies` has no OU-membership model yet (deliberately
// reserved — see active-directory.ts's own OU comment), so there is no
// "who belongs to this OU" to read live Graph state for and compare against
// `target_state`. Recording that honestly, per-policy, per-pass, is real work
// — it is NOT a fabricated compliant/divergent verdict, which would be worse
// than no answer. `skipped_not_opted_in` is equally honest: the pass reached a
// policy whose OU resolves to a real tenant, but that tenant has not flipped
// the opt-in checkbox, so nothing was read or acted on for it.
export const POLICY_EVALUATION_TRIGGER_KIND = ["event", "schedule"] as const;
export type PolicyEvaluationTriggerKind = (typeof POLICY_EVALUATION_TRIGGER_KIND)[number];

export const POLICY_EVALUATION_OUTCOME = [
  "compliant",
  "divergent",
  "not_evaluable",
  "skipped_not_opted_in",
  "error",
] as const;
export type PolicyEvaluationOutcome = (typeof POLICY_EVALUATION_OUTCOME)[number];

export const policyEvaluationRunsTable = pgTable("policy_evaluation_runs", {
  id: serial("id").primaryKey(),
  standingPolicyId: integer("standing_policy_id").notNull().references(() => standingPoliciesTable.id, { onDelete: "cascade" }),
  /** Denormalized from the policy at evaluation time, for querying without a join. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The tenant this pass resolved via the policy's OU. Null when the OU carries no tenant. */
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  triggerKind: text("trigger_kind", { enum: POLICY_EVALUATION_TRIGGER_KIND }).notNull(),
  /** The canonical event name that fired this pass, e.g. "policy.standing_policy.activated". Null for a scheduled sweep. */
  triggerEventType: text("trigger_event_type"),
  outcome: text("outcome", { enum: POLICY_EVALUATION_OUTCOME }).notNull(),
  /** Structured, honest detail — e.g. { reason: "..." }. Never fabricated data. */
  detail: jsonb("detail").notNull().default({}),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("policy_evaluation_runs_standing_policy_id_idx").on(t.standingPolicyId),
  index("policy_evaluation_runs_msp_evaluated_idx").on(t.mspId, t.evaluatedAt),
  index("policy_evaluation_runs_tenant_evaluated_idx").on(t.tenantId, t.evaluatedAt),
]);

export const insertPolicyEvaluationRunSchema = createInsertSchema(policyEvaluationRunsTable).omit({ id: true, createdAt: true });
export type PolicyEvaluationRun = typeof policyEvaluationRunsTable.$inferSelect;
export type InsertPolicyEvaluationRun = typeof policyEvaluationRunsTable.$inferInsert;

// ── Change Advisory Board — membership, meetings, agenda, ECAB (#1501) ───────
//
// `useChangeControl.ts:22` recorded the gap: no CAB agenda table. This closes
// it with three tables and NO second approval model — a CAB's recorded
// decision on an agenda item IS a `cr_approvals` row (#1496), reached the same
// way any other decision is (`recordApproval` / `recordRejection`), just
// initiated from a meeting instead of the customer register. `cab_agenda_items
// .cr_approval_id` is the join back to that ledger; it is the only place a
// "decision" is durably recorded.
//
// The CAB is scoped by `mspId`, not `(mspId, tenantId)`. An MSP runs ONE
// advisory board across its managed estate — the same board reviews a normal
// change on one customer's tenant and another's in the same meeting — so the
// board itself is MSP-wide. Each individual AGENDA ITEM still carries its own
// `tenantId` (denormalised from the change request it discusses), because the
// change it is about belongs to exactly one tenant, and that is the scope any
// cross-tenant guard has to check.
//
// Standard changes never reach an agenda, structurally rather than by a filter
// that can be forgotten: `requiredStages("standard", …)` is 0, so a standard
// change never has a pending `cr_approvals` row, and agenda eligibility (see
// `eligibleChangesForAgenda` in `portal-cab-store.ts`) is defined as "has a
// pending approval slot" — a standard change has none to have.

export const CAB_MEMBER_ROLES = ["chair", "voting", "advisory", "secretary"] as const;
export type CabMemberRole = (typeof CAB_MEMBER_ROLES)[number];

/** Which side of the engagement a member represents — same split as `cr_approvals.approver_role`'s customer/msp halves. */
export const CAB_MEMBER_SIDES = ["msp", "customer"] as const;
export type CabMemberSide = (typeof CAB_MEMBER_SIDES)[number];

export const cabMembersTable = pgTable("cab_members", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The member's wire person id ("u<userId>", see portal-ownership.personIdForUser) — one vocabulary for every party in the approval model. */
  personId: text("person_id").notNull(),
  /** Denormalised display cache, same reasoning as `cr_approvals.approver_name` — the roster reads without a join back to `users` for a removed account. */
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: CAB_MEMBER_ROLES }).notNull().default("voting"),
  side: text("side", { enum: CAB_MEMBER_SIDES }).notNull(),
  /**
   * Set only for a `customer`-side member: the one tenant they sit on the board
   * for. NULL for an `msp`-side member, who attends board-wide. This is what
   * would let a future read scope a customer member's OWN agenda view to only
   * the tenants they represent — not exercised by this build (no UI to wire),
   * but the column exists so that scoping is possible without a migration.
   */
  tenantId: text("tenant_id"),
  /** Also sits on the smaller emergency board — see `cab_meetings.meeting_type`. */
  isEcab: boolean("is_ecab").notNull().default(false),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cab_members_msp_id_idx").on(t.mspId),
  // One ACTIVE membership per person per board — declared as a partial unique
  // index in the manual migration (Drizzle cannot express the WHERE clause
  // here); a removed member can rejoin under a fresh row.
]);

export const insertCabMemberSchema = createInsertSchema(cabMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CabMember = typeof cabMembersTable.$inferSelect;
export type InsertCabMember = typeof cabMembersTable.$inferInsert;

export const CAB_MEETING_TYPES = ["cab", "ecab"] as const;
export type CabMeetingType = (typeof CAB_MEETING_TYPES)[number];

export const CAB_MEETING_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type CabMeetingStatus = (typeof CAB_MEETING_STATUSES)[number];

export const cabMeetingsTable = pgTable("cab_meetings", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /**
   * `cab` — the standing board, agenda built from pending NORMAL changes.
   * `ecab` — the emergency board convened for an EMERGENCY change that has
   * already executed (or is executing) and needs retroactive approval; agenda
   * items on an `ecab` meeting are always `isRetroactive = true`.
   */
  meetingType: text("meeting_type", { enum: CAB_MEETING_TYPES }).notNull().default("cab"),
  status: text("status", { enum: CAB_MEETING_STATUSES }).notNull().default("scheduled"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  /** Set when the meeting is actually opened (`status` → `in_progress`). NULL before then. */
  heldAt: timestamp("held_at", { withTimezone: true }),
  /** Set when the meeting is closed (`status` → `completed`). NULL before then. */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /** The chairing member's person id. Free text, not a FK to `cab_members` — a chair from a since-removed membership row must not orphan the historical record of who chaired. */
  chairPersonId: text("chair_person_id"),
  chairName: text("chair_name").notNull().default(""),
  /** Where it was held — "Teams call", "Async / email vote", etc. No calendar/video integration exists, so this is free text, same discipline as `msp_change_requests.scheduled_for`. */
  location: text("location").notNull().default(""),
  /** The chair's pre-meeting framing notes. Distinct from `minutes`, which is generated FROM the recorded decisions once the meeting closes. */
  notes: text("notes").notNull().default(""),
  /** Compiled at close time from the agenda's own recommendations/decisions — see `buildMinutes` in `lib/portal-cab.ts`. Empty until closed. */
  minutes: text("minutes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cab_meetings_msp_id_idx").on(t.mspId),
  index("cab_meetings_status_idx").on(t.status),
]);

export const insertCabMeetingSchema = createInsertSchema(cabMeetingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CabMeeting = typeof cabMeetingsTable.$inferSelect;
export type InsertCabMeeting = typeof cabMeetingsTable.$inferInsert;

/** The board's own determination, distinct from the formal `cr_approvals` decision it produces once recorded. `defer` rolls the item to a future meeting rather than deciding it now. */
export const CAB_AGENDA_RECOMMENDATIONS = ["approve", "reject", "defer"] as const;
export type CabAgendaRecommendation = (typeof CAB_AGENDA_RECOMMENDATIONS)[number];

export const cabAgendaItemsTable = pgTable("cab_agenda_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => cabMeetingsTable.id, { onDelete: "cascade" }),
  /** The change under discussion. Real FK — an agenda item cannot outlive its CR. */
  changeRequestId: integer("change_request_id").notNull().references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  /** Denormalised from the CR so this table scopes on the same predicate pair every other Change Control table uses. */
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  /** Presentation order within the meeting. */
  ordinal: integer("ordinal").notNull().default(0),
  presenterName: text("presenter_name").notNull().default(""),
  /** Notes taken live during discussion. */
  discussionNotes: text("discussion_notes").notNull().default(""),
  recommendation: text("recommendation", { enum: CAB_AGENDA_RECOMMENDATIONS }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /**
   * The REAL approval/rejection ledger row this item's decision produced — the
   * join back to `cr_approvals` (#1496). NULL until `approve`/`reject` is
   * recorded; stays NULL forever for a `defer`, which decides nothing.
   */
  crApprovalId: integer("cr_approval_id").references(() => crApprovalsTable.id),
  /** True for every item on an `ecab` meeting — the change already executed and this is the retroactive review. See `cab_meetings.meeting_type`. */
  isRetroactive: boolean("is_retroactive").notNull().default(false),
  /** Set when `recommendation = 'defer'` and the item is carried to a future meeting. */
  deferredToMeetingId: integer("deferred_to_meeting_id").references((): AnyPgColumn => cabMeetingsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cab_agenda_items_meeting_id_idx").on(t.meetingId),
  index("cab_agenda_items_change_request_id_idx").on(t.changeRequestId),
  index("cab_agenda_items_msp_tenant_idx").on(t.mspId, t.tenantId),
  // A change appears on a given meeting's agenda at most once.
  unique("cab_agenda_items_meeting_cr_unique").on(t.meetingId, t.changeRequestId),
]);

export const insertCabAgendaItemSchema = createInsertSchema(cabAgendaItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CabAgendaItem = typeof cabAgendaItemsTable.$inferSelect;
export type InsertCabAgendaItem = typeof cabAgendaItemsTable.$inferInsert;

// ── Change Control timeline: events, comments, attachments (#1503) ──────────
//
// The register had no per-CR history at all. `msp_audit_logs` is platform-wide
// and carries nothing CR-shaped; "Add a comment" was one of five dead buttons
// in the retired prototype (proto 1513-1524, no `onClick`). These three tables
// are the timeline: `cr_events` is the durable, IMMUTABLE record of every state
// transition a change goes through; `cr_comments` and `cr_attachments` are the
// human-authored record layered on top of it.
//
// CONSTRAINT (from the issue): a change request is immutable after close — that
// is what makes the register defensible. The timeline follows the same rule:
// APPEND-ONLY. None of the three tables below has an update or delete path
// anywhere in this codebase, and none should ever get one; a correction is a
// new row, never an edit to an old one.
//
// (mspId, tenantId) is denormalised onto every row from the parent CR, for the
// same reason `cr_approvals` does it — it lets every timeline read scope on the
// exact predicate pair `routes/portal-change-control.ts`'s header requires,
// without a join back through `msp_change_requests` just to enforce tenant
// isolation.

/**
 * The full `cr_events` vocabulary. Deliberately covers BOTH halves of a change's
 * life — the approval-ledger decisions (`approved`/`rejected`/`superseded`,
 * mirroring `cr_approvals.decision`) and the change's own execution lifecycle
 * (`raised`/`scheduled`/`executing`/`completed`/`rolled_back`/`rejected`,
 * mirroring `msp_change_requests.status`) — as ONE ordered timeline, because
 * that is how a customer or an auditor actually reads a change: one story, not
 * two tables to reconcile by hand.
 *
 * This is also the source table for #1506 (change metrics): lead time is
 * `completed.createdAt - raised.createdAt` per change; success rate is
 * `count(completed) / count(completed | rolled_back)`; emergency ratio joins
 * `raised` events back to the CR's `changeClass`; CAB throughput is
 * `approved`/`rejected` events grouped by approver/period. Shaped so #1506 reads
 * this table directly rather than needing a second pass at the data.
 */
export const CR_EVENT_TYPES = [
  "raised",
  "approved",
  "rejected",
  "superseded",
  "scheduled",
  "in_progress",
  "completed",
  "rolled_back",
  /**
   * #1541 — the customer's own PowerShell for a `you_must_run` fix was shown to
   * them. Fired every time it is shown, not once — a re-open is a real, separate
   * fact ("we told them again"), and the count is itself evidence. `toValue`
   * carries the checkKey that was revealed. NOT proof the script was ever run:
   * the platform never observes that for a customer-executed fix (see the CR
   * gate's own header) — this is the record that the reveal happened at all,
   * against an approved CR, rather than "nobody knows".
   */
  "script_revealed",
] as const;
export type CrEventType = (typeof CR_EVENT_TYPES)[number];

/** Who a `cr_events` row's `actorRole` may name. Never "the system" — see `cr_approvals.approverRole` for the same rule. */
export const CR_EVENT_ACTOR_ROLES = ["customer", "msp", "microsoft", "system"] as const;
export type CrEventActorRole = (typeof CR_EVENT_ACTOR_ROLES)[number];

export const crEventsTable = pgTable("cr_events", {
  id: serial("id").primaryKey(),
  /** The change this event happened to. Real FK — an event cannot outlive its CR. */
  changeRequestId: integer("change_request_id")
    .notNull()
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  eventType: text("event_type", { enum: CR_EVENT_TYPES }).notNull(),
  /**
   * The state before/after this transition. For a lifecycle event these mirror
   * `msp_change_requests.status` (e.g. `pending_approval` → `scheduled`). For an
   * approval-ledger event these are NOT that column — `toValue` is a synthetic
   * label such as `approved (stage 1 of 2)` — because the CR's own `status`
   * column often does not change when one stage clears. `fromValue` is null for
   * the first event a change ever gets (`raised`).
   */
  fromValue: text("from_value"),
  toValue: text("to_value").notNull(),
  /** The approval stage this event belongs to, when it is an approval-ledger event. Null for a lifecycle event. */
  stage: integer("stage"),
  actorRole: text("actor_role", { enum: CR_EVENT_ACTOR_ROLES }).notNull(),
  /** The acting person's wire id (`personIdForUser`), null for a `microsoft`/`system` actor. */
  actorPersonId: text("actor_person_id"),
  actorName: text("actor_name"),
  /** Rejection reason, approval note, or a short system-generated explanation. Null when none was given. */
  reason: text("reason"),
  /**
   * When this really happened. Equal to `createdAt` for every event recorded
   * live going forward; distinct only for the one-time migration backfill of
   * pre-existing CRs, where the true transition moment was never recorded and
   * the best available real timestamp (the CR's own `createdAt`/`updatedAt`) is
   * used instead — reconstructed from real data, not invented.
   */
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cr_events_change_request_id_idx").on(t.changeRequestId),
  index("cr_events_msp_tenant_idx").on(t.mspId, t.tenantId),
  // #1506's metrics queries scan by type and time.
  index("cr_events_type_occurred_idx").on(t.eventType, t.occurredAt),
]);

export const insertCrEventSchema = createInsertSchema(crEventsTable).omit({ id: true, createdAt: true });
export type CrEvent = typeof crEventsTable.$inferSelect;
export type InsertCrEvent = typeof crEventsTable.$inferInsert;

/** Who may author a `cr_comments`/`cr_attachments` row. A narrower set than `cr_events.actorRole` — a comment or an upload is always a human action. */
export const CR_TIMELINE_AUTHOR_ROLES = ["customer", "msp"] as const;
export type CrTimelineAuthorRole = (typeof CR_TIMELINE_AUTHOR_ROLES)[number];

export const crCommentsTable = pgTable("cr_comments", {
  id: serial("id").primaryKey(),
  changeRequestId: integer("change_request_id")
    .notNull()
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  authorRole: text("author_role", { enum: CR_TIMELINE_AUTHOR_ROLES }).notNull(),
  authorPersonId: text("author_person_id").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cr_comments_change_request_id_idx").on(t.changeRequestId),
  index("cr_comments_msp_tenant_idx").on(t.mspId, t.tenantId),
]);

export const insertCrCommentSchema = createInsertSchema(crCommentsTable).omit({ id: true, createdAt: true });
export type CrComment = typeof crCommentsTable.$inferSelect;
export type InsertCrComment = typeof crCommentsTable.$inferInsert;

/** What a `cr_attachments` row is evidence OF — the three kinds the issue names, plus a catch-all. */
export const CR_ATTACHMENT_KINDS = ["evidence", "test_result", "approval_email", "other"] as const;
export type CrAttachmentKind = (typeof CR_ATTACHMENT_KINDS)[number];

/**
 * Evidence, test results, approval emails — attached to a change AS A RECORD,
 * not as binary storage this build introduces. `externalUrl` points at where
 * the real artifact already lives (a SharePoint document via the existing
 * `msp_documents`/SharePoint-connector pipeline, an Exchange/Graph message
 * permalink, or any other durable link); nothing here re-implements file
 * upload. A row with no `externalUrl` is still a real, meaningful record — e.g.
 * "Ran the post-change validation script, all 12 checks passed" needs no link.
 */
export const crAttachmentsTable = pgTable("cr_attachments", {
  id: serial("id").primaryKey(),
  changeRequestId: integer("change_request_id")
    .notNull()
    .references(() => mspChangeRequestsTable.id, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  kind: text("kind", { enum: CR_ATTACHMENT_KINDS }).notNull().default("other"),
  label: text("label").notNull(),
  externalUrl: text("external_url"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedByRole: text("uploaded_by_role", { enum: CR_TIMELINE_AUTHOR_ROLES }).notNull(),
  uploadedByPersonId: text("uploaded_by_person_id").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cr_attachments_change_request_id_idx").on(t.changeRequestId),
  index("cr_attachments_msp_tenant_idx").on(t.mspId, t.tenantId),
]);

export const insertCrAttachmentSchema = createInsertSchema(crAttachmentsTable).omit({ id: true, createdAt: true });
export type CrAttachment = typeof crAttachmentsTable.$inferSelect;
export type InsertCrAttachment = typeof crAttachmentsTable.$inferInsert;

// ── MSP SOPs (Standard Operating Procedures) ─────────────────────────────────
//
// ITIL v4 Incident Response and Drift Remediation templates representing standard
// operating procedures for M365 environments.

export const mspSopsTable = pgTable("msp_sops", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  sopId: text("sop_id").notNull(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  version: text("version").notNull(),
  automationType: text("automation_type").notNull(),
  estimatedMinutes: integer("estimated_minutes").notNull().default(0),
  complianceTags: jsonb("compliance_tags").notNull().default([]),
  workloadTags: jsonb("workload_tags").notNull().default([]),
  steps: jsonb("steps").notNull().default([]),
  lastUpdatedBy: text("last_updated_by").notNull(),
  lastUpdatedAt: text("last_updated_at").notNull(),
  versionStatus: text("version_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sops_msp_id_idx").on(t.mspId),
  unique("msp_sops_msp_id_sop_id_uidx").on(t.mspId, t.sopId),
]);

export const insertMspSopSchema = createInsertSchema(mspSopsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspSop = typeof mspSopsTable.$inferSelect;
export type InsertMspSop = typeof mspSopsTable.$inferInsert;

// ── MSP SOP Execution Runs ──────────────────────────────────────────────────
//
// Records of execution runs and state tracking (step index, logs, status) for
// a given SOP on a customer tenant.
//
// UNIFICATION (#1556): this run record is THE run record for a procedure, whatever
// invoked it. A policy-invoked enactment (#1548), an on-demand lifecycle operation
// (#1552), a remediation fix (#1539) and a hand-started run are the same object with
// different provenance — provenance is `origin`, a property of the run, not a
// different table. `portal_runbooks`/`portal_runbook_steps` is a DIFFERENT object
// (the customer's own active runbook checklists) that happens to share the word.

/**
 * What invoked a run. Plain text with an `enum` union for the type, no DB CHECK —
 * the same widen-in-code convention `status` follows, so a new origin can be added
 * without a migration. `manual` is the historical default (a hand-started run).
 */
export const MSP_SOP_RUN_ORIGIN = ["policy", "lifecycle", "remediation", "manual"] as const;
export type MspSopRunOrigin = typeof MSP_SOP_RUN_ORIGIN[number];

export const mspSopRunsTable = pgTable("msp_sop_runs", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  sopId: text("sop_id").notNull(),
  sopTitle: text("sop_title").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  targetEntity: text("target_entity").notNull(),
  operator: text("operator").notNull(),
  /**
   * What invoked this run — see MSP_SOP_RUN_ORIGIN. Defaults to `manual` so every
   * pre-existing row (and any writer that does not yet set it) reads as a
   * hand-started run rather than a null.
   */
  origin: text("origin", { enum: MSP_SOP_RUN_ORIGIN }).notNull().default("manual"),
  /**
   * #1548 — the `standing_policies.id` this run enacts, when `origin` is
   * `"policy"`. This is what makes `msp_sops`/`msp_sop_runs` the actual
   * enactment record for a policy: a policy-invoked run is the same row shape
   * as a hand-started one, but this column is how it is traced back to the
   * specific policy that caused it. Null for every other origin, and for any
   * `"policy"`-origin row a writer inserted before this column existed.
   */
  standingPolicyId: integer("standing_policy_id").references(() => standingPoliciesTable.id, { onDelete: "set null" }),
  /**
   * `msp_sops.version` captured at the moment this run started (#1558). This is
   * the run's own half of the version-ambiguity requirement the per-tenant
   * custom-step overlay below has to satisfy: the base definition's `version`
   * keeps moving forward as the MSP republishes it, so without this a run
   * could never say which version of the procedure it actually followed once
   * that column had since changed. Server-captured at insert, never
   * client-supplied. Defaults to "" for historical rows and any writer not
   * yet updated to set it — read as "not recorded", not a guess.
   */
  sopVersion: text("sop_version").notNull().default(""),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status").notNull(),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  totalSteps: integer("total_steps").notNull().default(0),
  passedStepsCount: integer("passed_steps_count").notNull().default(0),
  psaTicketId: text("psa_ticket_id").notNull(),
  logs: jsonb("logs").notNull().default([]),
  /**
   * The real Workflow Engine run executing this run's automated steps (#1559 —
   * the execution hook). Null for a hand-entered/legacy row that never actually
   * fired anything. Plain nullable integer, no FK — same no-DB-CHECK convention
   * `msp_change_requests.executor_run_id` already follows for the identical
   * "cites a wf_runs.id" relationship.
   */
  wfRunId: integer("wf_run_id"),
  /**
   * The materialized node-id → step-index map for this run's automated steps, in
   * step order, snapshotted at fire time (#1559). The reconciliation sweep reads
   * THIS, not the SOP's live `steps` (which may be edited after the run fires),
   * so progress tracking can never drift onto a step that has since moved or
   * been removed. Empty for a run with no automated steps or one entered by hand.
   */
  automatedStepMap: jsonb("automated_step_map").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_sop_runs_msp_id_idx").on(t.mspId),
  index("msp_sop_runs_tenant_id_idx").on(t.tenantId),
  index("msp_sop_runs_wf_run_id_idx").on(t.wfRunId),
  index("msp_sop_runs_standing_policy_id_idx").on(t.standingPolicyId),
  unique("msp_sop_runs_msp_id_run_id_uidx").on(t.mspId, t.runId),
]);

/** One materialized automated step, as snapshotted onto `msp_sop_runs.automated_step_map`. */
export interface SopRunAutomatedStep {
  /** The `WfNode.id` in the fired run's graph (`sop-step-<stepNumber>`). */
  readonly nodeId: string;
  /** The step's index into the SOP's `steps` array at fire time. */
  readonly stepIndex: number;
}

export const insertMspSopRunSchema = createInsertSchema(mspSopRunsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspSopRun = typeof mspSopRunsTable.$inferSelect;
export type InsertMspSopRun = typeof mspSopRunsTable.$inferInsert;

// ── SOP custom steps — per-tenant overlay on a versioned MSP definition (#1558) ──
//
// `msp_sops` is MSP-authored and versioned (`version`, `version_status`,
// `last_updated_by`) — a customer must never write into its `steps` jsonb
// directly, because that is editing someone else's authored, versioned
// artifact out from under them. `portal_runbook_steps.is_custom` already lets a
// customer graft their own steps onto a DIFFERENT object (their own runbook
// checklist, see that table's own header). This is the same settled pattern
// applied to the SOP library, per the architecture fixed on #1558 and #1493's
// own thread: a tenant's custom steps live in their own table as an OVERLAY
// the read layer appends after the base definition's own steps — never merged
// into `msp_sops.steps`, never replacing it. Direct precedent:
// `portalOwnershipAssignmentsTable` below layers a customer's saved edits over
// a computed base RACI the same way.
//
// This is what keeps both halves of #1558's requirement true structurally:
//   • A definition version bump (editing `msp_sops.version`/`steps` in place)
//     cannot silently discard a tenant's custom steps, because they live in a
//     wholly separate table that write never touches.
//   • `basedOnVersion` records the base procedure's `version` at the moment
//     the tenant added the step, so the overlay itself never becomes
//     ambiguous about which definition it was layered onto — even as that
//     definition's `version` keeps moving forward underneath it. (The other
//     half — which version a given RUN actually followed — is
//     `msp_sop_runs.sop_version`, above.)
//
// Keyed on `customer_id` (= tenants.id, the JWT's customerId) with NO foreign
// key to `msp_sops`, matching every portal-* overlay table (see the Ownership
// matrix write-persistence block below): `sopId` is the same opaque
// `msp_sops.sop_id` string the read routes already join on, not a row id —
// consistent with `msp_sop_runs.sop_id` (#4 in "Cross-surface edges", the
// contract pack), which also survives its base definition being deleted.
export const portalSopCustomStepsTable = pgTable("portal_sop_custom_steps", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The base procedure this overlays — msp_sops.sop_id, not msp_sops.id. */
  sopId: text("sop_id").notNull(),
  /** 1-based render order among this tenant's OWN custom steps for this SOP. */
  position: integer("position").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /**
   * `msp_sops.version` at the moment this step was added — this overlay row's
   * own half of the version-ambiguity requirement (see the section header).
   * Never updated after insert: this is what version the tenant was looking
   * at when they added it, not whatever the base definition's version is now.
   */
  basedOnVersion: text("based_on_version").notNull(),
  /** Who added it — the caller's own email, matching `msp_sops.last_updated_by`'s convention. */
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_sop_custom_steps_customer_sop_idx").on(t.customerId, t.sopId),
  uniqueIndex("portal_sop_custom_steps_customer_sop_position_idx").on(
    t.customerId,
    t.sopId,
    t.position,
  ),
]);

export type PortalSopCustomStep = typeof portalSopCustomStepsTable.$inferSelect;
export type InsertPortalSopCustomStep = typeof portalSopCustomStepsTable.$inferInsert;

// ── MSP Risk-Based Decisions & Liability Acceptances ─────────────────────────
//
// Records of risk-based decisions (RBD) and liability acceptances (RAM)
// by tenants, shifting liability for unmitigated security items.

export interface CompensatingControl {
  type: "technical" | "administrative" | "operational";
  description: string;
}

export interface MspAssessor {
  name: string;
  upn: string;
  timestamp: string;
}

export interface ClientApprover {
  name: string;
  title: string;
  email: string;
  signedAt: string | null;
  ipAddress: string | null;
  signatureHash: string | null;
}

/**
 * The narrative/score fields captured with each `msp_rbd_versions` row
 * (#1510, part of #1487) — the exact set the settled architecture names as
 * able to change WITHOUT a scope change: "a narrative-only revision - hazard
 * text, compensating controls, residual score - with the instance set
 * untouched requires no signature by the letter of the rule." Captured
 * verbatim from `msp_risk_decisions` at version-capture time (server-derived,
 * never client-supplied — see `rbd-versioning.ts`'s `computeRbdScopeDiff`
 * header for why) so `diffNarrativeSnapshot` can compare consecutive
 * versions and produce the audit trail #1510 asks for as the interim answer
 * (no signature requirement added here, on purpose).
 */
export interface RbdNarrativeSnapshot {
  hazardDescription: string;
  compensatingControls: CompensatingControl[];
  residualRiskScore: number;
  residualRiskLevel: string;
}

/**
 * The ACCEPTANCE's own lifecycle — where the liability transfer has got to.
 *
 * `expired` was removed here on #1507. An acceptance is a signed fact and does
 * NOT expire: legally the customer accepted the risk regardless of any date, and
 * a thing that happened does not stop having happened. What lapses is the
 * *review* (a separate operational clock, `reviewState` / `reviewDueAt` below),
 * never the acceptance. A past-due review surfaces as an operational flag on an
 * acceptance that remains `active`; it must not flip the acceptance to a lapsed
 * state. See #1507 (and #1527 for the identical fix on `decisionState`).
 *
 * Enforced at the write path (`msp-rbd.ts`) and by convention, not by a DB CHECK.
 */
export const RISK_ACCEPTANCE_STATUSES = ["pending_signature", "active", "revoked"] as const;
export type RiskAcceptanceStatus = (typeof RISK_ACCEPTANCE_STATUSES)[number];

/**
 * The REVIEW's own state — the second clock #1507 split out of `status`. A missed
 * review invalidates nothing; it means nobody has looked in longer than they said
 * they would. Derived from `reviewDueAt` vs now at review time and set by the
 * MSP's operational acts (mark a review done, or note why it is overdue) — NOT by
 * anyone re-signing on the customer's behalf, which #1507 forbids. NULL when no
 * review has been scheduled yet (served as null, never defaulted).
 */
export const RISK_REVIEW_STATES = ["on_track", "due", "overdue"] as const;
export type RiskReviewState = (typeof RISK_REVIEW_STATES)[number];

/**
 * Policy Decisions' own lane vocabulary. `expired` was removed on #1527 for the
 * same reason as the acceptance `status`: a documented policy decision that has
 * passed its review date is still LIVE, with an overdue *review* flag — it did not
 * lapse. The sound lanes are proposed (awaiting sign-off) / live / due-for-review.
 * Enforced by convention (the portal normaliser maps anything unknown to
 * `proposed`); this table's column is plain text.
 */
export const POLICY_DECISION_STATES = ["proposed", "live", "due"] as const;
export type PolicyDecisionState = (typeof POLICY_DECISION_STATES)[number];

export const mspRiskDecisionsTable = pgTable("msp_risk_decisions", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  rbdId: text("rbd_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  primaryDomain: text("primary_domain").notNull(),
  title: text("title").notNull(),
  controlViolated: text("control_violated").notNull(),
  framework: text("framework").notNull(),
  /**
   * The specific `monitor_checks.key` this decision covers, when it was raised
   * against one automated check rather than authored as a free-standing
   * liability record. NULL is the common case (nothing sets this yet outside
   * a direct API call) — the customer-tenant alert engine (#1279) only
   * suppresses re-firing for a finding when this is populated and the
   * decision is `status = 'active'`; it never guesses a match from the
   * free-text `controlViolated`/`framework`/`title` fields above.
   */
  checkKey: text("check_key"),
  /**
   * Every check key BEYOND `checkKey` above that this same accepted risk should
   * also suppress alert re-firing for (Git #1957, part of #1489). Several
   * `remediation_tracker_steps` map to more than one check
   * (`REMEDIATION_TRACKER_STEP_CHECK_KEYS` in `remediation-tracker-verification.ts`,
   * e.g. s8 -> `identity:ca-policy-count` + `identity:ca-mfa-coverage`) — a
   * customer declining one such step and accepting the whole step's risk must
   * suppress re-firing on ALL of its mapped checks, not just the first. `checkKey`
   * itself is left untouched (existing single-key rows, and `msp-rbd.ts` /
   * `m365-change-router.ts`'s #1514 path, which never populate this column,
   * keep working exactly as before) — this is purely additive. NULL/empty is
   * the common case. The alert engine's `NOT_ACCEPTED_AS_RISK` suppression
   * (customer-tenant-alert-engine.ts, #1279) matches a finding's check key
   * against `checkKey` OR any element of this array.
   */
  additionalCheckKeys: jsonb("additional_check_keys").$type<string[]>(),
  rawRiskLevel: text("raw_risk_level").notNull(),
  residualRiskLevel: text("residual_risk_level").notNull(),
  rawRiskScore: integer("raw_risk_score").notNull(),
  residualRiskScore: integer("residual_risk_score").notNull(),
  liabilityValueUsd: integer("liability_value_usd").notNull(),
  hazardDescription: text("hazard_description").notNull(),
  graphEndpoint: text("graph_endpoint").notNull(),
  compensatingControls: jsonb("compensating_controls").$type<CompensatingControl[]>().notNull().default([]),
  mspAssessor: jsonb("msp_assessor").$type<MspAssessor>().notNull(),
  clientApprover: jsonb("client_approver").$type<ClientApprover>().notNull(),
  expirationDate: text("expiration_date").notNull(),
  status: text("status").notNull(),

  // ── Customer-facing register fields (Risk Register / Policy Decisions) ─────
  //
  // Everything above this line is the MSP-side liability record as `msp-rbd.ts`
  // has always written it. Everything below exists because the customer portal's
  // Risk Register and Policy Decisions pages render facts this table genuinely
  // did not hold — WIRING_PLAN.md called this out in advance ("a heat-map's
  // likelihood/impact matrix almost certainly doesn't exist as structured data
  // today — that's real backend design work, not a type change"), and it was
  // right. Each column below was added because a real field on one of those two
  // pages had no source, NOT to mirror the fixture for its own sake.
  //
  // ALL NULLABLE ON PURPOSE. `msp-rbd.ts` predates every one of these and does
  // not write them; a row it creates must stay valid. The portal route treats
  // null as "not recorded" and says so on screen rather than inventing a value.
  //
  // `riskStatus` vs `status`: two different lifecycles that must never collapse.
  // `status` is the ACCEPTANCE's state (RISK_ACCEPTANCE_STATUSES:
  // pending_signature / active / revoked) — where the liability transfer has got
  // to. `riskStatus` is the RISK's own state (Open / Mitigating / Accepted /
  // Closed / Expired) — what is happening about it. A risk can be Mitigating with
  // no acceptance at all, and an acceptance can be revoked while the risk stays
  // Open. A THIRD clock — the REVIEW (`reviewState` / `reviewDueAt`) — was split
  // out of `status` on #1507 and lives just below `reviewDate`; do not fold it
  // back in. `status` no longer carries `expired` (see RISK_ACCEPTANCE_STATUSES).
  pillar: text("pillar"),
  owner: text("owner"),
  /** RACI person key behind `owner`, for the ownership matrix's chips. */
  ownerId: text("owner_id"),
  riskStatus: text("risk_status"),
  /** Next review date as displayed copy, e.g. "27 Aug 2026". Human-facing string
   * kept for display; the machine date the review clock actually compares against
   * is `reviewDueAt` below (#1507). */
  reviewDate: text("review_date"),
  // ── The review clock (#1507) ───────────────────────────────────────────────
  // Split out of the acceptance `status`. The acceptance is permanent and does
  // not expire; the REVIEW is the operational "when must someone look again"
  // clock, and a past-due review is a flag on a still-`active` acceptance, never
  // a lapsed acceptance. `reviewDueAt` is the machine date (so overdue is
  // computable, not parsed from the `reviewDate` display copy); `reviewState`
  // (RISK_REVIEW_STATES: on_track / due / overdue) is its operational state. Both
  // NULL until a review is scheduled — served as null, never defaulted. The MSP
  // advances these by marking a review done or noting it overdue; nobody
  // re-signs, so there is no renewal path here (#1507).
  reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
  reviewState: text("review_state"),
  /** Scoring weight the register's stat cards sum over. */
  weight: integer("weight"),
  /** 1-5. With `impact`, the coordinates of this risk on the 5x5 heat map. */
  likelihood: integer("likelihood"),
  /** 1-5. */
  impact: integer("impact"),
  /** What happens if it lands — the consequence, not the finding. */
  outcome: text("outcome"),
  /** Where the finding came from: the query, the counts, the pillar. */
  evidence: text("evidence"),
  /** What is being done about it. */
  plan: text("plan"),
  /** The register entry number an acceptance was recorded under, e.g. RR-2026-014. */
  registerRef: text("register_ref"),
  /** Why the decision was taken — the reasoning, shown on both pages. */
  rationale: text("rationale"),
  /** The obligation a policy decision sits against, e.g. "GDPR Art. 5(1)(e)".
   * Free text, predates #1525. Kept for back-compat display when `obligationId`
   * below is null (every row written before #1525, and any writer that still
   * only sends a citation string). */
  obligation: text("obligation"),
  /** The cited authority this decision responds to, as a first-class reference
   * (Git #1525) rather than a free-text guess — `compliance_obligations.id`.
   * Null on every row written before #1525 and on any decision with no catalog
   * match; `obligation` above stays authoritative for display in that case. */
  obligationId: integer("obligation_id").references(() => complianceObligationsTable.id, { onDelete: "set null" }),
  /** The last verification line, e.g. "Compensating control verified on the last scan." */
  verificationNote: text("verification_note"),
  /** Policy Decisions' own lane (POLICY_DECISION_STATES: proposed / live / due).
   * `expired` was removed on #1527 — a decision past its review date is still
   * `live` with an overdue `reviewState`, it did not lapse. Kept in sync with
   * `reviewState` by alert-engine.ts's `advanceRiskReviewClock` (#1527) on
   * rows where it is already set: `due` mirrors a due review, `overdue`
   * collapses back to `live`. */
  decisionState: text("decision_state"),

  // ── The acceptance itself ──────────────────────────────────────────────────
  //
  // The typed name goes in `clientApprover.name` (that jsonb already has the
  // right shape and already has an MSP-side writer in `msp-rbd.ts`, so both
  // writers agree rather than keeping two records of the same signature).
  //
  // `acceptedAt` is a REAL column rather than another jsonb key because it is
  // the one field that must be server-set, queryable, and never rewritten:
  // it is the proof-of-when. `clientApprover.signedAt` is a display string the
  // MSP path already writes; this is the machine timestamp beside it.
  //
  // NEVER EDITABLE AFTER THE FACT is enforced in the route, not by a constraint:
  // `portal-risk-register.ts` rejects any accept on a row that already has
  // `acceptedAt` set, with 409. Postgres has no "write once" column type, so the
  // guarantee is a guarded UPDATE plus this comment telling the next writer why
  // they must not relax it.
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** The exact confirmation sentence the customer ticked, snapshotted at accept
   * time — so a later reword of the copy cannot rewrite what they agreed to. */
  acceptedStatement: text("accepted_statement"),

  // ── Role-based acceptance authority (#1511, part of #1487) ─────────────────
  //
  // `clientApprover` above is EVIDENCE OF WHO SIGNED — a person: name, title,
  // email, signedAt, ipAddress, signatureHash. It cannot also be what GRANTS
  // the right to sign; people leave and change jobs, and the authority to
  // accept risk must survive them. Authority resolves through the
  // Ownership/RACI matrix (#1491): whoever currently holds Accountable (A) on
  // the M365 workload this risk's `checkKey` resolves to (#1523's settled
  // rule — RACI attaches to the service, findings inherit it, risks derive
  // from findings). These four columns record BOTH ends of that resolution —
  // the role/workload that authorised, and the individual who exercised it —
  // alongside (never instead of) the human-signature evidence above.
  //
  // ALL NULLABLE. Null across all four when `checkKey` resolves to no workload
  // (a free-standing liability record authored directly via `msp-rbd.ts`,
  // never raised against an automated check, or raised against a cross-cutting
  // check category — cost:*, appgov:*, governance:* etc — that is not one
  // workload's accountability). That is the honest, unresolved case, not an
  // error: the accept route falls back to its pre-#1511 behaviour (any
  // `CustomerUser` may sign) for exactly this case, rather than inventing an
  // authority this table cannot back up.
  /** The authorising matrix object id, e.g. "wl-icam" — same id space
   * `portal_ownership_assignments.object_id` / `workloadObject()` use. */
  authorizingWorkloadId: text("authorizing_workload_id"),
  /** Display label for the workload above, e.g. "Identity & Access (Entra ID)". */
  authorizingWorkloadLabel: text("authorizing_workload_label"),
  /**
   * Every wire person id (`"u" + users.id`) that held Accountable on the
   * workload above AT THE MOMENT THIS RISK WAS SIGNED — a point-in-time
   * replay of `portal_ownership_events` (#1522), not a re-read of current
   * state, so a later roster change cannot rewrite who actually had authority
   * when this acceptance happened. "A can be multiple, all holding identical
   * authority" (#1515) — this is the full set, not just the signer.
   */
  authorizingHolderPersonIds: jsonb("authorizing_holder_person_ids").$type<string[]>(),
  /** The wire person id of whoever actually authenticated and signed — must be
   * one of `authorizingHolderPersonIds` when that array is non-null. Distinct
   * from `clientApprover.name` (a free-typed display string): this is the
   * structured link back to the real account the accept request carried. */
  signedByPersonId: text("signed_by_person_id"),

  // ── Change-Control ⟷ Risk pointers (#1514, part of #1487) ──────────────────
  //
  // The rejection-to-risk path: when a CUSTOMER rejects a Change Request they are
  // declining a remediation, and the risk becomes theirs — the rejection IS the
  // acceptance (#1514). This records the two ends of that relationship as real,
  // native pointers rather than parsed free text:
  //   • spawnedByChangeRequestId — the CR whose rejection created this risk.
  //   • dischargedByChangeRequestId — the fresh CR that later SUPERSEDES it. The
  //     rejected CR is immutable and never resurrected; the risk persists until a
  //     new CR discharges it (#1514's lifecycle). NULL while the risk stands.
  // Both NULL for every risk decision authored by msp-rbd.ts's own path.
  spawnedByChangeRequestId: integer("spawned_by_change_request_id"),
  dischargedByChangeRequestId: integer("discharged_by_change_request_id"),

  // ── Remediation ⟷ Risk pointer (#1542, part of #1489) ──────────────────────
  //
  // The SAME rejection-to-risk path as #1514, arriving from the Remediation
  // Tracker rather than Change Control: a customer declining to fix a checklist
  // item is accepting the residual risk, and the rejection IS the acceptance.
  // `remediation-tracker-risk-decline.ts` is this side's
  // `createAcceptedRiskFromDecline()` counterpart.
  //   • spawnedByRemediationStepId — the remediation_tracker_steps.id whose
  //     decline created this risk. No FK, matching every other cross-table
  //     reference on that table (see its own header note).
  // Discharge reuses `dischargedByChangeRequestId` above rather than a second
  // column — a remediation-declined risk, like a CR-declined one, is only ever
  // discharged by a fresh CR that supersedes it (#1514's lifecycle applies
  // identically regardless of which side spawned the risk).
  // NULL for every risk decision not spawned by a remediation-item decline.
  spawnedByRemediationStepId: integer("spawned_by_remediation_step_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_risk_decisions_msp_id_idx").on(t.mspId),
  index("msp_risk_decisions_tenant_id_idx").on(t.tenantId),
  unique("msp_risk_decisions_msp_id_rbd_id_uidx").on(t.mspId, t.rbdId),
  index("msp_risk_decisions_tenant_check_status_idx").on(t.tenantId, t.checkKey, t.status),
  index("msp_risk_decisions_spawned_by_remediation_step_idx").on(t.spawnedByRemediationStepId),
  index("msp_risk_decisions_obligation_id_idx").on(t.obligationId),
]);

export const insertMspRiskDecisionSchema = createInsertSchema(mspRiskDecisionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspRiskDecision = typeof mspRiskDecisionsTable.$inferSelect;
export type InsertMspRiskDecision = typeof mspRiskDecisionsTable.$inferInsert;

// ── msp_rbd_versions — the RBD's own supersession chain (#1508, part of #1487) ─
//
// Settled architecture (#1487, #1508): the RBD is a container (one MFA risk with
// twenty-two accounts, not twenty-two risk records — #1509) and it is THIS
// container, as a WHOLE document, that is the signed artifact and that versions.
// Every change produces a new version of the whole document, signed as a whole —
// the model Shane used at NASA. The value is handing someone a single page: this
// is what was agreed, signed here, on this date — not a parent record plus
// separately-signed children they must reassemble. Line items are content WITHIN
// a signed version, not independently signed rows.
//
// `drift_baseline_snapshots` (below) is the explicit precedent this follows:
// `supersededAt IS NULL` marks the current reference version; a prior version is
// never edited or backfilled, it just stops being current the moment a newer one
// is captured. That is the whole supersession mechanism, reused as-is rather than
// inventing a second pattern.
//
// `content` is `jsonb.$type<unknown>()`, exactly like
// `driftBaselineSnapshotsTable.config` — deliberately untyped here. The line-item
// shape (#1509), the signature-required-on-scope-expansion diff (#1510) and the
// role-based authority resolution (#1511) are separate, not-yet-built issues;
// this table is the version/supersession mechanism they all attach to, not a
// place to invent their content contract in advance. A version that re-reads
// live child rows to render itself is not a signed document, it is a query — so
// `content` MUST be a full, self-contained snapshot at capture time, never a
// pointer for the reader to re-resolve.
//
// `rbdId` is the SAME container identifier `msp_risk_decisions.rbdId` already
// uses today (e.g. "RBD-..."), matching the one real identifier this codebase has
// for "one RBD" until #1509 formalizes the container/line-item split. No FK to
// `msp_risk_decisions.id` — that table is one (soon-to-be-legacy) line-item shape
// among what #1509 will make many; the version chain is keyed on the durable
// container id, not on a specific row.
//
// `signedBy` reuses the existing `ClientApprover` shape (name/title/email/
// signedAt/ipAddress/signatureHash) — the same signature record `msp-rbd.ts` and
// `portal-risk-register.ts` already write, so every writer agrees on one
// signature shape rather than keeping a second. `createdBy` reuses `MspAssessor`
// the same way, for who authored the version on the MSP side.
export const mspRbdVersionsTable = pgTable("msp_rbd_versions", {
  id: serial("id").primaryKey(),
  versionUid: uuid("version_uid").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The container identifier — matches `msp_risk_decisions.rbdId` today. */
  rbdId: text("rbd_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  /** 1-based, monotonic per (mspId, rbdId). Version 1 is the first capture. */
  versionNumber: integer("version_number").notNull(),
  /** Full, self-contained content snapshot of the whole document at capture
   * time. Untyped on purpose — see header. Never re-read live rows to fill it. */
  content: jsonb("content").$type<unknown>().notNull(),
  /** Who authored this version on the MSP side. */
  createdBy: jsonb("created_by").$type<MspAssessor>().notNull(),
  /** True once this version itself has been signed as a whole. A version can
   * exist unsigned (a draft capture) before the signing flow (#1512) sets this
   * and the two fields below. */
  signed: boolean("signed").notNull().default(false),
  signedBy: jsonb("signed_by").$type<ClientApprover>(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  /** #1512 — the actual drawn signature, base64 PNG data-URL. Same shape as
   * `msp_sows.signatureData`; `signedBy.signatureHash` (above) is a tamper-
   * evidence hash of the acceptance facts, not the image itself — this is the
   * genuinely missing piece of SOW-flow parity, added here rather than a
   * second signature table. Null until signed. */
  signatureData: text("signature_data"),
  /** #1512 — unauthenticated review/sign link token, same mechanism as
   * `msp_sows.shareToken`. Null until an MSP operator explicitly generates one
   * for this version (`POST .../share`) — a version is reachable by an
   * authenticated CustomerUser without ever needing a token. */
  shareToken: text("share_token").unique(),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
  /** When a newer version replaced this one. NULL = the current version. Never
   * edited or backfilled once superseded — same rule as `drift_baseline_snapshots`. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),

  // ── Signature-required-on-scope-expansion (#1510, part of #1487) ──────────
  //
  // Settled architecture: nobody consents to being safer. Additions present
  // in the instance set => a fresh signature is required; subtractions only
  // (or no change) => the prior version's signature is INHERITED onto this
  // one, and a version row is still recorded. The distinction is DERIVED by
  // `rbd-versioning.ts`'s `computeRbdScopeDiff`, comparing `scopeInstanceIds`
  // against the version being superseded — never a flag a caller sets, so it
  // cannot be gamed. See that module's header for the full mechanism,
  // including why a new instance can never be silently absorbed under an old
  // signature: any addition forces `requiresSignature: true` on the version
  // that would otherwise inherit, so an unsigned addition is never covered by
  // a prior signature no matter how the version was captured.
  /** The full set of `risk_instances.id` this version accepts as in-scope —
   * every currently-`active` line item at capture time. What the addition/
   * subtraction diff runs on. Server-derived from the live table, never
   * client-supplied. */
  scopeInstanceIds: integer("scope_instance_ids").array().notNull().default([]),
  /** `scopeInstanceIds` minus the version being superseded's own — ids newly
   * carried by this version. Non-empty here always forces `requiresSignature`. */
  scopeAddedInstanceIds: integer("scope_added_instance_ids").array().notNull().default([]),
  /** The version being superseded's `scopeInstanceIds` minus this version's —
   * ids no longer carried (remediated or object-removed). Never forces a
   * signature on its own. */
  scopeRemovedInstanceIds: integer("scope_removed_instance_ids").array().notNull().default([]),
  /** The derivation's own output: true when this version's scope contains an
   * addition (or it is the very first version ever captured for the
   * container — nothing yet to inherit from). False for a subtraction-only
   * or unchanged scope, in which case `signed`/`signedBy`/`signedAt`/
   * `signatureData` below are copied forward automatically rather than left
   * for a human to re-sign. */
  requiresSignature: boolean("requires_signature").notNull().default(true),
  /** True when this version's `signed`/`signedBy`/`signedAt`/`signatureData`
   * were copied forward from the version it superseded (subtraction-only /
   * unchanged scope, and that prior version was itself signed) rather than
   * captured fresh at this version. */
  signatureInherited: boolean("signature_inherited").notNull().default(false),
  /** Traceability pointer to the version a copied-forward signature actually
   * came from. No FK — same convention as every other cross-version/
   * cross-table reference in this file that is not the primary container
   * link (e.g. `msp_risk_decisions.spawnedByRemediationStepId`). NULL unless
   * `signatureInherited` is true. */
  signatureInheritedFromVersionUid: uuid("signature_inherited_from_version_uid"),
  /** Verbatim narrative/score snapshot at capture time — see
   * `RbdNarrativeSnapshot`'s own header. Compared against the version being
   * superseded's own snapshot to produce `msp_rbd_narrative_audit` rows,
   * regardless of whether the scope changed. */
  narrativeSnapshot: jsonb("narrative_snapshot").$type<RbdNarrativeSnapshot>().notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_rbd_versions_msp_id_rbd_id_idx").on(t.mspId, t.rbdId),
  index("msp_rbd_versions_rbd_id_superseded_idx").on(t.rbdId, t.supersededAt),
  index("msp_rbd_versions_share_token_idx").on(t.shareToken),
  unique("msp_rbd_versions_msp_id_rbd_id_version_uidx").on(t.mspId, t.rbdId, t.versionNumber),
]);

export const insertMspRbdVersionSchema = createInsertSchema(mspRbdVersionsTable).omit({ id: true, versionUid: true, createdAt: true });
export type MspRbdVersion = typeof mspRbdVersionsTable.$inferSelect;
export type InsertMspRbdVersion = typeof mspRbdVersionsTable.$inferInsert;

// ── msp_rbd_narrative_audit — the #1510 audit trail on narrative/score drift ──
//
// The settled architecture deliberately does NOT require a signature when a
// version's instance scope is untouched but its narrative/score fields moved
// (hazard text, compensating controls, residual score) — "a residual score
// could move under a signature given when it read differently." This table is
// the interim answer the issue asks for: every time `createRbdVersion`
// captures a new version whose `narrativeSnapshot` differs from the version it
// superseded, the changed fields are recorded here, so that drift is catchable
// even though it never blocks capture and never requires re-signature. One row
// per version transition that actually changed something narrative — no row
// when nothing narrative moved (a pure scope change, or truly nothing changed).
export const mspRbdNarrativeAuditTable = pgTable("msp_rbd_narrative_audit", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The container identifier — same convention as `msp_rbd_versions.rbdId`. */
  rbdId: text("rbd_id").notNull(),
  /** The version being superseded, or NULL when this is the very first
   * version captured (nothing to diff against). */
  fromVersionUid: uuid("from_version_uid"),
  /** The version this audit row belongs to. */
  toVersionUid: uuid("to_version_uid").notNull(),
  /** `{ field, previousValue, newValue }[]` — only the fields that actually
   * changed, from `RbdNarrativeSnapshot`'s own keys. */
  changedFields: jsonb("changed_fields").$type<Array<{ field: string; previousValue: unknown; newValue: unknown }>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_rbd_narrative_audit_msp_id_rbd_id_idx").on(t.mspId, t.rbdId),
  index("msp_rbd_narrative_audit_to_version_uid_idx").on(t.toVersionUid),
]);

export const insertMspRbdNarrativeAuditSchema = createInsertSchema(mspRbdNarrativeAuditTable).omit({ id: true, createdAt: true });
export type MspRbdNarrativeAudit = typeof mspRbdNarrativeAuditTable.$inferSelect;
export type InsertMspRbdNarrativeAudit = typeof mspRbdNarrativeAuditTable.$inferInsert;

// ── Security Plan: the assembled view over the eight modules (#1561, part of #1495/#1485) ─
//
// Settled architecture (#1561, #1562): the Security Plan OWNS almost no data. It is
// an assembled view that READS what the other modules produce — Policy Decisions
// (#1490), Risk Register (#1487), Ownership/RACI (#1491), SOPs/Runbooks (#1493),
// Remediation (#1489), Change Control (#1486) and Microsoft Changes (#1494) — and
// then VERSIONS and SEALS that assembly at a point in time. The only data it owns is
// the authored prose (a separate sub-issue) and THESE version records.
//
// #1562 says this is "the RBD pattern one level up." So `msp_security_plan_versions`
// is deliberately `msp_rbd_versions` (above) with the same supersession mechanism —
// `supersededAt IS NULL` marks the current version, a prior version is never edited
// or backfilled — rather than a second sealing/signing stack. `signedBy` reuses
// `ClientApprover` and `createdBy` reuses `MspAssessor`, exactly as the RBD chain
// does, so every writer agrees on one signature shape.
//
// The difference from RBD is what the sealed artifact must carry, which comes from
// two sibling issues:
//   • #1563 — a sealed version may be SCOPED (which parts of the estate it covers),
//     but scope operates only on DIMENSIONS (control family / framework), NEVER on
//     OUTCOME (severity, accepted/open, pass/fail). `scope` records the dimension
//     selection; there is no field here that could express an outcome filter.
//   • #1565 — the artifact carries a FILTER FOOTPRINT stating what was excluded and
//     a count, and that footprint is PART OF THE SEALED SNAPSHOT (`content`), so a
//     reader always knows they are holding a slice. It cannot be suppressed by a UI.
//
// `content` is a full, self-contained snapshot of the assembled document (every
// module's contributed rows AS THEY WERE at seal time) plus the applied scope and
// the computed footprint — never a pointer for the reader to re-resolve against live
// rows, for the same reason `msp_rbd_versions.content` is (a re-reading version is a
// query, not a signed document). Its TypeScript shape is `SecurityPlanContent`.
//
// The container is one Security Plan PER CUSTOMER TENANT, so the version chain is
// keyed on `(mspId, customerId)` where `customerId` is a `tenants.id` — the same id
// space `portal_security_plans` and every portal-owned table use. `tenantId` /
// `tenantName` are carried denormalized for the sealed record, matching the RBD chain.

/** A legitimate scope dimension (#1563). SCOPE narrows which parts of the estate a
 * plan covers; it operates ONLY on these dimensions, never on an OUTCOME (severity,
 * accepted/open, pass/fail). `business_unit` from #1563's examples is intentionally
 * absent: no source table carries a business-unit column, and inventing one to filter
 * on would be fabricated data. Extend this union only when a real backing column exists. */
export const SECURITY_PLAN_SCOPE_DIMENSIONS = ["pillar", "framework"] as const;
export type SecurityPlanScopeDimension = (typeof SECURITY_PLAN_SCOPE_DIMENSIONS)[number];

/** The scope selection applied to an assembled/sealed plan (#1563). A dimension maps
 * to the set of allowed values for it; a row is excluded by a dimension ONLY when it
 * carries a value for that dimension not in the allowed set — a row that cannot be
 * classified by the dimension is retained, never silently dropped. An empty/absent
 * object is the HONEST (unfiltered) view, which is the default, not a separate mode. */
export interface SecurityPlanScope {
  readonly dimensions: Partial<Record<SecurityPlanScopeDimension, readonly string[]>>;
  /** A short human statement of what this scope claims to cover, carried onto the
   * document per #1563 ("every filtered view carries its own scope statement"). */
  readonly statement?: string;
}

/** One module's excluded-by-scope tally, for the filter footprint (#1565). */
export interface SecurityPlanModuleExclusion {
  readonly moduleKey: string;
  readonly excludedCount: number;
}

/** The filter footprint that #1565 requires on every sealed/exported artifact: the
 * filters applied, what was excluded, and a count of excluded items. It is part of
 * the sealed `content` and cannot be suppressed by the filter UI.
 *
 * `scope.statement` is REQUIRED here (unlike the caller-facing `SecurityPlanScope`,
 * where it is an optional hint) — #1564's "Settled" section is that a signed version
 * must record a real, bounded statement of what it covers ("our identity control
 * posture as of this date"), never an unqualified claim ("our security posture"). The
 * assembly layer synthesizes one whenever the caller didn't supply it, so this field
 * can never be empty on anything that reaches a seal. */
export interface SecurityPlanFilterFootprint {
  readonly scope: SecurityPlanScope & { readonly statement: string };
  /** True when no scope was applied — the honest, complete-for-the-estate view. */
  readonly isHonestView: boolean;
  readonly excludedByModule: readonly SecurityPlanModuleExclusion[];
  readonly totalExcluded: number;
  /** ISO timestamp the footprint was computed. */
  readonly computedAt: string;
}

/** One assembled module's contribution to the plan — real rows read from that
 * module's own tables, plus counts. Never fabricated. `items` is that module's
 * in-scope rows in a small, uniform display shape; `excludedCount` is how many the
 * scope removed (mirrored into the footprint). */
export interface SecurityPlanAssembledModule {
  readonly key: string;
  readonly label: string;
  /** The GitHub issue that owns this source module, e.g. "#1487". */
  readonly sourceIssue: string;
  readonly total: number;
  readonly excludedCount: number;
  readonly items: readonly SecurityPlanAssembledItem[];
}

/** A single assembled row in a uniform, honest shape. `pillar`/`framework` carry the
 * dimension values used for scope classification (null when the source row has none). */
export interface SecurityPlanAssembledItem {
  readonly id: string;
  readonly title: string;
  readonly state: string | null;
  readonly detail: string | null;
  readonly pillar: string | null;
  readonly framework: string | null;
}

// ── Authored prose (#1566, formalizing the #1561 stub) ──────────────────────────────
//
// "A real security plan carries scope, methodology, exclusions and an executive
// summary — content no module owns." These four sections are the ONLY data the
// Security Plan itself authors (everything else in `SecurityPlanContent` is read from
// another module). `scope` here is prose describing what the engagement covers in
// plain language, distinct from — but naturally paired with — `SecurityPlanScope`
// (#1563), the machine-readable dimension filter; a scoped seal's `scope.statement`
// is one required sentence, while this `scope` prose section is the fuller narrative.
//
// Authoring sequence (#1566, fixed by the issue, not a re-architecture): freeze the
// assembled state → write/revise prose against that frozen state → seal and sign as
// ONE version. Never write prose over a live view that can move underneath the
// author. `msp_security_plan_drafts` (below) is the frozen-state holding pen between
// "freeze" and "seal"; sealing consumes it and clears it.
//
// Versioning (#1566's other half): scope/methodology/exclusions barely change between
// versions; the executive summary changes every time. "If every version demands a
// full rewrite, nobody will produce versions" — so every section is CARRIED FORWARD
// BY DEFAULT from the plan's last version, and `editedInThisVersion` marks only the
// sections actually touched while authoring the version being sealed now.
export const SECURITY_PLAN_PROSE_SECTIONS = ["scope", "methodology", "exclusions", "executiveSummary"] as const;
export type SecurityPlanProseSection = (typeof SECURITY_PLAN_PROSE_SECTIONS)[number];

/** One prose section's text, plus whether it was edited while authoring the version
 * currently being drafted/sealed (`true`) vs. carried forward verbatim from the plan's
 * last version (`false`). Computed by diffing against the carry-forward baseline
 * captured when the draft was created — never hand-set by the client. */
export interface SecurityPlanProseSectionContent {
  readonly text: string;
  readonly editedInThisVersion: boolean;
}

/** The four authored sections, keyed by `SecurityPlanProseSection`. */
export type SecurityPlanProse = Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;

/** The full assembled Security Plan document — what the live view returns and what a
 * sealed version snapshots into `content`. Self-contained: every value here was read
 * from a real source table at assembly time, except `prose`, which this module itself
 * authors. */
export interface SecurityPlanContent {
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly assembledAt: string;
  readonly modules: readonly SecurityPlanAssembledModule[];
  readonly footprint: SecurityPlanFilterFootprint;
  /** Authored narrative owned by this module (#1561, formalized #1566). Null only for
   * a version sealed before #1566 shipped; every version sealed through the draft flow
   * carries a fully-populated `SecurityPlanProse` (empty text is a valid, authored
   * "nothing to say," distinct from this legacy null). */
  readonly prose: SecurityPlanProse | null;
}

/** One item's state/detail as of a snapshot, for a changed-row drift entry (#1562). */
export interface SecurityPlanDriftItemState {
  readonly state: string | null;
  readonly detail: string | null;
}

/** One item that changed between the last signed snapshot and the live view: present
 * in both, but its `state` and/or `detail` differ (#1562). */
export interface SecurityPlanDriftChangedItem {
  readonly id: string;
  readonly title: string;
  readonly from: SecurityPlanDriftItemState;
  readonly to: SecurityPlanDriftItemState;
}

/** One module's drift between the last signed snapshot and the live view (#1562).
 * `added`/`removed` are keyed by item id presence; `changed` is same-id, different
 * state/detail. A module with none of the three is unchanged since the last signature. */
export interface SecurityPlanModuleDrift {
  readonly moduleKey: string;
  readonly label: string;
  readonly added: readonly SecurityPlanAssembledItem[];
  readonly removed: readonly SecurityPlanAssembledItem[];
  readonly changed: readonly SecurityPlanDriftChangedItem[];
}

/** The tension #1562 settles: "cumulative" (a signed version, frozen) and "live" (true
 * today) both matter, so the live view carries its drift from the last signed version
 * alongside it, rather than the two being irreconcilable. `hasLastSignedVersion` is
 * false when nothing has ever been signed for this plan — there is nothing to drift
 * from yet, which is distinct from "signed and no drift since". */
export interface SecurityPlanDrift {
  readonly hasLastSignedVersion: boolean;
  readonly lastSignedVersionUid: string | null;
  readonly lastSignedVersionNumber: number | null;
  readonly lastSignedAt: string | null;
  readonly modules: readonly SecurityPlanModuleDrift[];
  readonly totalAdded: number;
  readonly totalRemoved: number;
  readonly totalChanged: number;
}

export const mspSecurityPlanVersionsTable = pgTable("msp_security_plan_versions", {
  id: serial("id").primaryKey(),
  versionUid: uuid("version_uid").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The container: one Security Plan per customer tenant. A `tenants.id`, no FK — the
   * same convention `portal_security_plans.customer_id` follows. */
  customerId: integer("customer_id").notNull(),
  /** Denormalized M365 tenant identifier + display name, sealed into the record. */
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  /** 1-based, monotonic per (mspId, customerId). Version 1 is the first seal. */
  versionNumber: integer("version_number").notNull(),
  /** Full, self-contained assembled-document snapshot (`SecurityPlanContent`),
   * including the #1565 filter footprint. Never re-read live rows to fill it. */
  content: jsonb("content").$type<SecurityPlanContent>().notNull(),
  /** Who sealed this version on the MSP side. */
  createdBy: jsonb("created_by").$type<MspAssessor>().notNull(),
  signed: boolean("signed").notNull().default(false),
  signedBy: jsonb("signed_by").$type<ClientApprover>(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  /** When a newer version replaced this one. NULL = the current version. Never
   * edited or backfilled once superseded — same rule as `msp_rbd_versions`. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_security_plan_versions_msp_id_customer_id_idx").on(t.mspId, t.customerId),
  index("msp_security_plan_versions_customer_superseded_idx").on(t.customerId, t.supersededAt),
  unique("msp_security_plan_versions_msp_customer_version_uidx").on(t.mspId, t.customerId, t.versionNumber),
]);

export const insertMspSecurityPlanVersionSchema = createInsertSchema(mspSecurityPlanVersionsTable).omit({ id: true, versionUid: true, createdAt: true });
export type MspSecurityPlanVersion = typeof mspSecurityPlanVersionsTable.$inferSelect;
export type InsertMspSecurityPlanVersion = typeof mspSecurityPlanVersionsTable.$inferInsert;

// ── msp_security_plan_drafts — the frozen-state holding pen (#1566) ─────────────────
//
// The authoring sequence #1566 fixes: freeze assembled state → write/revise prose
// against that frozen state → seal and sign as one version. One draft row per Security
// Plan `(mspId, customerId)` — a plan being authored has exactly one draft in
// progress, never a stack of them. `frozenContent` is captured once per "freeze" call
// (re-freezing REPLACES it, but never touches `prose`, so refreshing the frozen
// assembly can never lose in-progress authoring). `baselineProse` is captured ONCE,
// the moment the draft row is first created — the carry-forward snapshot of the
// plan's last version's prose — and is never mutated again; it is what `prose` edits
// are diffed against to compute `editedInThisVersion`. Sealing (`createSecurityPlanVersion`
// via the route) consumes this row — copies `frozenContent.*` + `prose` into the new
// `msp_security_plan_versions` row — then DELETES it, so the next authoring cycle
// starts with a fresh freeze and a fresh carry-forward baseline from the version that
// was just sealed.
export const mspSecurityPlanDraftsTable = pgTable("msp_security_plan_drafts", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** Same container key as `msp_security_plan_versions.customerId` — a `tenants.id`. */
  customerId: integer("customer_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  /** The assembled document as it was at the moment of freeze (or the last re-freeze) —
   * modules/footprint/scope, exactly `SecurityPlanContent`'s shape. Its own `.prose` is
   * always null; prose lives in the `prose` column below so a re-freeze never clobbers it. */
  frozenContent: jsonb("frozen_content").$type<SecurityPlanContent>().notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
  /** The carry-forward baseline captured once, when this draft row was first created —
   * the last version's prose, every section's `editedInThisVersion` forced false. Never
   * mutated after creation; edits are diffed against THIS, not against `prose`'s own
   * previous value, so toggling a section back to its baseline text correctly clears
   * `editedInThisVersion` again. */
  baselineProse: jsonb("baseline_prose").$type<SecurityPlanProse>().notNull(),
  /** The prose actually being authored. Starts equal to `baselineProse` and is updated
   * section-by-section as the author edits. */
  prose: jsonb("prose").$type<SecurityPlanProse>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("msp_security_plan_drafts_msp_customer_uidx").on(t.mspId, t.customerId),
]);

export const insertMspSecurityPlanDraftSchema = createInsertSchema(mspSecurityPlanDraftsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspSecurityPlanDraft = typeof mspSecurityPlanDraftsTable.$inferSelect;
export type InsertMspSecurityPlanDraft = typeof mspSecurityPlanDraftsTable.$inferInsert;

// ── risk_instances — the RBD's line items (#1509, part of #1487) ──────────────
//
// Settled architecture (#1487, #1509): the RBD is a container, not a single risk
// — one MFA risk with twenty-two accounts, not twenty-two risk records. Nobody
// wants to manage twenty-two risk decisions for MFA. `msp_risk_decisions` is the
// container row (one per `rbdId`, unchanged by this build); this table is the
// many-rows-per-container line items it was always missing a home for.
//
// `riskDecisionId` is a real FK to the container row — unlike `msp_rbd_versions`
// (#1508), which deliberately keys on the durable `rbdId` text because it is a
// document-version chain that must survive a container row someday not being the
// only shape. A line item has no such requirement: it belongs to exactly one
// container row for its whole life, so a normal FK is the right, simpler tool
// here. `rbdId`/`mspId` are denormalized alongside it anyway, matching every
// other cross-table pointer on `msp_risk_decisions` (see `spawnedByRemediationStepId`
// etc. above) — so a caller holding only the container identifier (the shape
// `msp_rbd_versions` and the future diff logic in #1510 both use) can query
// instances without a join.
//
// EACH LINE OWNS ITS OWN CLOCK. `foundAt` and `acceptedAt` are per-instance,
// because each account/mailbox/object was found and accepted at a different
// moment — the whole point of #1509. `acceptedAt` follows the exact
// "never editable after the fact" contract `msp_risk_decisions.acceptedAt`
// already established: set once, guarded at the route with a 409 on a second
// attempt, never rewritten. Whether setting it requires a whole-document
// signature is #1510's "signature required on scope expansion" mechanism —
// a separate, not-yet-built issue this table does not anticipate; here it is
// simply the per-line proof-of-when, exactly as #1509 asked for.
//
// THIS BUILD DOES NOT TOUCH `msp_risk_decisions.acceptedAt`'s COLUMN OR ROUTE
// BEHAVIOR. #1509's own text is explicit that the container's single
// `acceptedAt` "has no single meaning" once a container carries many lines
// accepted at different times — but changing or repurposing that existing,
// already-signed column is a destructive/behavior-changing edit to a table two
// other routes (`msp-rbd.ts`, `portal-risk-register.ts`) already read and write,
// which is out of scope for an additive build. The per-line truth now lives
// here; the container's legacy single date is left exactly as-is for any risk
// that predates this table (still a single instance, functionally).
//
// WHY A LINE LEFT — REMEDIATED VS. THE OBJECT CEASING TO EXIST. "We fixed nine"
// and "thirteen users quit" are different histories the register must be able
// to tell apart, per #1509's own text. Modeled as ONE flat `status` enum rather
// than a separate boolean-plus-reason pair, for the identical reason
// `remediation_tracker_steps.status` (above) is one flat enum: from the
// register's side, "still open" and "left, and why" are the same shape of fact
// — the current state of one line — and splitting that across parallel columns
// is exactly what that table's own header warns against. Neither exit reason
// requires a signature (#1509's own text) — `resolvedAt` is a plain operational
// timestamp set by whoever recorded the exit, not a legal artifact.
/** The two reasons a line leaves — see header. Not `"active"`: that is a state
 * a line is in, never a reason it left. */
export const RISK_INSTANCE_EXIT_REASONS = ["remediated", "object_removed"] as const;
export type RiskInstanceExitReason = (typeof RISK_INSTANCE_EXIT_REASONS)[number];

export const RISK_INSTANCE_STATUS = ["active", ...RISK_INSTANCE_EXIT_REASONS] as const;
export type RiskInstanceStatus = (typeof RISK_INSTANCE_STATUS)[number];

export const riskInstancesTable = pgTable("risk_instances", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The container row — see header for why this is a real FK, unlike `msp_rbd_versions.rbdId`. */
  riskDecisionId: integer("risk_decision_id").notNull().references(() => mspRiskDecisionsTable.id, { onDelete: "cascade" }),
  /** Denormalized container identifier, matching `msp_risk_decisions.rbdId`'s
   * existing convention — lets a caller holding only the container id (as
   * `msp_rbd_versions` and #1510's future diff logic do) query instances
   * without a join. */
  rbdId: text("rbd_id").notNull(),
  /** What this line item covers, e.g. "jsmith@contoso.com" or "Conference Room A
   * mailbox" — the identifying text shown per line. */
  label: text("label").notNull(),
  /** The underlying Graph/system identifier when one is known (object id, UPN).
   * Free text, no FK — these are external Microsoft 365 objects, not rows in
   * this database, matching every other external-identifier column in this
   * table family (e.g. `msp_risk_decisions.checkKey`, `.graphEndpoint`). */
  objectId: text("object_id"),
  /** When this specific object was found to be covered by the risk. Required —
   * every line has one, per #1509's own text. */
  foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
  /** When this specific line was accepted. NULL until accepted. NEVER EDITABLE
   * AFTER THE FACT once set — enforced at the route with a 409 on a repeat
   * attempt, same contract as `msp_risk_decisions.acceptedAt`. */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** RISK_INSTANCE_STATUS. `active` = still carried under the risk. `remediated`
   * / `object_removed` = why it left — see header. */
  status: text("status", { enum: RISK_INSTANCE_STATUS }).notNull().default("active"),
  /** When `status` left `active`. NULL while active. Operational, not a
   * signature — neither exit reason requires one (#1509). */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Free text on how/why it left, e.g. "Fixed via Conditional Access policy
   * CA-114" or "Mailbox decommissioned 2026-08-30". NULL while active. */
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("risk_instances_msp_id_risk_decision_id_idx").on(t.mspId, t.riskDecisionId),
  index("risk_instances_rbd_id_status_idx").on(t.rbdId, t.status),
  index("risk_instances_risk_decision_id_idx").on(t.riskDecisionId),
]);

export const insertRiskInstanceSchema = createInsertSchema(riskInstancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type RiskInstance = typeof riskInstancesTable.$inferSelect;
export type InsertRiskInstance = typeof riskInstancesTable.$inferInsert;

// ── AI Dev Response Cache (#185, parent #183) ──────────────────────────────────
// Dev-only cache of Anthropic call responses, keyed on a stable hash of that
// call's real inputs, so iterating on a prompt in development doesn't re-spend
// real API cost on an unchanged request. `feature` is plain text (NOT a
// Postgres enum) so a new AI call site never needs a schema migration just to
// start caching — and `requestContext`/`response` are JSONB precisely because
// different call sites' inputs/outputs share no common shape (persona-gen's
// inputs look nothing like a report narrative's). This table is written and
// read ONLY from lib/ai-dev-response-cache.ts, which hard-gates every access
// to non-production — nothing here enforces that at the schema level, the
// gate is entirely in that module, on purpose (a schema-level gate cannot be
// unit-tested the way a code-level fail-closed check can).
export const aiDevResponseCacheTable = pgTable("ai_dev_response_cache", {
  id: serial("id").primaryKey(),
  // sha256 of `feature` + a stable (sorted-key) serialization of requestContext.
  hash: text("hash").notNull().unique(),
  // Free-form label identifying the AI call site, e.g. "persona_generation",
  // "use_case_generation", "final_report_narrative". Deliberately plain text.
  feature: text("feature").notNull(),
  // The real inputs (prompt/context) that produced `response` — whatever shape
  // that call site's request takes.
  requestContext: jsonb("request_context").$type<Record<string, unknown>>().notNull(),
  // The cached Anthropic response, verbatim.
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Null = no expiry (cleared only via the module's manual-clear helper).
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [
  index("ai_dev_response_cache_feature_idx").on(t.feature),
  index("ai_dev_response_cache_expires_at_idx").on(t.expiresAt),
]);

export type AiDevResponseCacheRow = typeof aiDevResponseCacheTable.$inferSelect;
export type InsertAiDevResponseCacheRow = typeof aiDevResponseCacheTable.$inferInsert;

// ── Remediation Knowledge Base (#493) ─────────────────────────────────────────
//
// One row per `monitor_checks.key`: HUMAN-VERIFIED remediation content for a
// finding that check produces, researched against real, current Microsoft
// documentation and signed off by a named person on a named date.
//
// WHY IT EXISTS: the Remediation Plan deliverable is a document paying
// customers run PowerShell out of. Until this table, every command in it came
// from an LLM (`remediation-detail-generator.ts`) with no verification step
// against real cmdlet syntax. This table is the DEFAULT source of truth for
// that document; the AI generator remains as an explicitly-labelled fallback
// for checks not yet covered here. The two are never blended — a customer can
// always tell which they are reading (see `remediation-knowledge-base.ts`'s
// renderers).
//
// NEVER AI-POPULATED. Rows are written by hand (or by Claude in chat, having
// actually read current Microsoft documentation) — auto-generating them would
// defeat the entire point of the table. Nothing in the codebase writes to it.
//
// SHAPE NOTE — why commands live on `remediation_steps[].code` rather than in
// their own "verified cmdlets" column: the AI fallback's validated output shape
// is `{ detail, steps: [{ text, code? }] }` (RemediationResultSchema in
// remediation-detail-generator.ts), and BOTH branches render through one
// renderer. Giving the KB a second, differently-shaped home for commands would
// mean two renderers that can drift on layout — and the whole credibility
// argument rests on the verified branch and the AI branch being visually
// comparable, differing only in their provenance banner. `summary` is the
// verified counterpart of the AI shape's `detail`, for the same reason.
export const REMEDIATION_KB_STATUS = ["draft", "published"] as const;
export type RemediationKbStatus = typeof REMEDIATION_KB_STATUS[number];

// ── Fix route — the first-class item shape (#1539) ────────────────────────────
//
// The Remediation Tracker turns findings into a worked list, and the single
// dimension that decides how every other part of an item behaves is HOW the fix
// actually gets made — its "fix route". #1539 makes that a first-class value:
// nothing else in the module (the affordance the row shows, whether a Change
// Control is armed with a runnable pack, what evidence closing it produces) can
// be modelled until an item knows which of exactly three shapes it is.
//
//   we_can_run       — a Graph write pack / PowerShell fix exists AND this
//                      tenant has granted write-back, so the platform executes
//                      it on the customer's behalf (through a Change Control →
//                      orchestrator). The button DOES it.
//   you_must_run     — a script exists but there is no delegated path to run it
//                      here — either no write pack automates the check, or the
//                      tenant has NOT granted write-back. The customer runs the
//                      PowerShell themselves; the button COPIES it.
//   admin_center_only — no script exists at all; the change is only reachable
//                      through a Microsoft admin-centre screen. The row LINKS
//                      out with instructions.
//
// ORDERING IS LOAD-BEARING. The shapes form a rank from most-automated (2) to
// least (0), because resolution is a `min()` over two independent inputs — what
// the finding supports and what the tenant permits (see
// `remediation-fix-route.ts`). A write-denied tenant is a first-class posture,
// not a degraded one: a fully-automatable finding legitimately renders as
// `you_must_run` for a tenant that follows step-by-step instructions instead of
// granting write (the resolved architecture on #1539 — the "NASA" posture).
export const REMEDIATION_FIX_ROUTE = ["we_can_run", "you_must_run", "admin_center_only"] as const;
export type RemediationFixRoute = (typeof REMEDIATION_FIX_ROUTE)[number];

/** One ordered remediation step. Shape-identical to `RemediationStep` in remediation-detail-generator.ts, deliberately — see the table comment. */
export interface RemediationKbStep {
  text: string;
  /** A real, verified PowerShell/Graph command. Tenant-specific values use angle-bracket placeholders (`<SiteUrl>`), never a fabricated real value. */
  code?: string;
  /** Fenced-block language hint for the renderer, e.g. "powershell", "http", "kusto". Defaults to "powershell" when absent. */
  codeLanguage?: string;
}

export const remediationKnowledgeBaseTable = pgTable("remediation_knowledge_base", {
  id: serial("id").primaryKey(),
  // One row per check. `restrict` (not cascade) matches monitoring_package_checks'
  // existing FK to the same column, and is the right direction here for a second
  // reason: verified, hand-written content must never disappear silently because
  // someone deleted a check row.
  checkKey: text("check_key").notNull().unique().references(() => monitorChecksTable.key, { onDelete: "restrict" }),
  /** Section heading override. NULL = the renderer uses `monitor_checks.label`. */
  title: text("title"),
  /** Plain-English "what this finding means and why it matters" — the verified counterpart of the AI shape's `detail`. */
  summary: text("summary").notNull(),
  /** What must already be true/installed before step 1: roles, licences, PowerShell modules. */
  prerequisites: jsonb("prerequisites").$type<string[]>().notNull().default([]),
  /** Admin Center UI navigation path, e.g. "Microsoft 365 admin center → Settings → Org settings → Security & privacy". */
  adminCenterPath: text("admin_center_path"),
  /** Deep link for the path above, when a stable one exists. */
  adminCenterUrl: text("admin_center_url"),
  remediationSteps: jsonb("remediation_steps").$type<RemediationKbStep[]>().notNull().default([]),
  /** What the tenant looks like once the steps are done. */
  expectedOutcome: text("expected_outcome").notNull(),
  /** How to prove it worked — the check to run after, in words. */
  validationStep: text("validation_step").notNull(),
  /** The command form of `validationStep`, when one exists. */
  validationCommand: text("validation_command"),
  /** Microsoft documentation URLs this row was verified against. These are what makes "verified" a checkable claim rather than an assertion. */
  sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),
  /** Free text naming what it was verified against, e.g. "Exchange Online PowerShell V3 3.4.0, Microsoft Learn 2026-08". */
  verifiedAgainst: text("verified_against"),
  /** When a human last confirmed this row against current Microsoft documentation. Rendered to the customer. */
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull(),
  /** Who did that. Rendered to the customer — the row is only as good as the name on it. */
  verifiedBy: text("verified_by").notNull(),
  /**
   * ONLY `published` rows are treated as verified content. A half-written
   * `draft` row falls through to the AI fallback (labelled as such) rather than
   * being rendered under a green "verified" banner it hasn't earned.
   */
  status: text("status", { enum: REMEDIATION_KB_STATUS }).notNull().default("draft"),
  /**
   * The finding-side fix-route CEILING for this check (#1539) — the best shape
   * this check's authored content could ever reach, before the tenant's own
   * write-back consent is applied on top of it.
   *
   *   admin_center_only (default) — no script authored; only `adminCenterPath`/
   *     `adminCenterUrl` reach the fix. A tenant's write consent cannot lift
   *     this: there is nothing to run.
   *   you_must_run — a PowerShell/Graph fix exists in `remediation_steps[].code`
   *     but no config pack automates it, so the customer runs it themselves.
   *   we_can_run — the fix is scriptable AND wired to a runnable path (a config
   *     pack maps this check), so a write-consenting tenant can have it executed.
   *
   * Deliberately authored, not inferred, so "what kind of item is this" is a
   * queryable first-class fact rather than a guess from whether someone happened
   * to paste code into a step. The read-time resolver (`remediation-fix-route.ts`)
   * still RAISES this to `we_can_run` when a live config pack maps the check even
   * if the column lags, so the column is a floor, never a false cap.
   */
  fixRouteCapability: text("fix_route_capability", { enum: REMEDIATION_FIX_ROUTE }).notNull().default("admin_center_only"),
  /** Internal notes — never rendered into a customer document. */
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("remediation_knowledge_base_status_idx").on(t.status),
]);

export type RemediationKnowledgeBaseRow = typeof remediationKnowledgeBaseTable.$inferSelect;
export type InsertRemediationKnowledgeBaseRow = typeof remediationKnowledgeBaseTable.$inferInsert;

// ── Remediation Tracker — persistent per-step state (#730, epic #647) ─────────
//
// One row per (customer, remediation-guide step). This is the table the Full
// Remediation Guide's tick boxes actually write to: before #730 the ticks were
// React state that died with the tab, and `RemediationGuideBody.tsx` said so in
// its own header comment and in the document's standfirst.
//
// WHAT A ROW MEANS, AND WHAT IT DOES NOT
// --------------------------------------
// A row is the CUSTOMER'S OWN CLAIM about a step, and nothing more. It is not
// evidence that the change landed in their tenant, and no scoring, gate or
// score anywhere reads it. The platform's own answer to "did this really
// happen" stays what it has always been: a re-scan. That distinction is why
// `status` is deliberately not called `verified`, and why the verification
// state Phase C (#732) will add is a SEPARATE field rather than another value
// of this one — a re-verified step and a step somebody ticked are different
// facts and must never collapse into each other.
//
// SCOPED TO THE CUSTOMER, NOT THE USER. Remediation is a shared engagement
// record: the customer's second admin, and Shane looking at the same account,
// must see one tracker rather than a private copy each. `updated_by_user_id`
// keeps the "who last touched this" trail that per-user rows would otherwise
// have carried.
//
// STEP IDS ARE THE GUIDE'S OWN. "s1" … "s30", the ids in
// `previewRemediationGuide.ts` / `remediationLiveGuide.ts`, which the guide's
// own tests already freeze. They are stored as opaque text rather than as a
// foreign key because the step catalogue is a tested `.ts` module, not a table
// (see remediationLiveGuide.ts's own note on why the mapping does not live in
// `config_pack_templates`).
//
// A MISSING ROW IS THE DEFAULT, NOT A GAP. Nothing pre-seeds thirty rows per
// customer; a step with no row is `not_started`, which is what an untouched
// tracker is. The API resolves the absence, so a customer who has never opened
// the guide costs nothing.
//
// THE VOCABULARY (#731, Phase B). Phase A shipped only `not_started` /
// `completed` and said this column would widen in code with no second
// migration — it does, here, to the design's own real per-step action set
// (Design/Remediation Tracker.dc.html's `REASONS` array plus its "Have Shane
// do this one" button, the four things a reader can decide about a step
// besides doing it themselves):
//
//   already_handled — "Already handled another way"
//   not_applicable  — "Not applicable to this tenant"
//   deferred        — "Deferring to a later phase"
//   shane_handles   — "Have Shane do this one"
//
// `completed` KEEPS ITS NAME rather than being renamed to a literal
// "self_resolve": Phase A's own contract for it — "a tick is the customer's
// own claim that they did it themselves" — already IS self-resolve, and
// renaming a value already live in a customer's row for a naming preference
// would be exactly the kind of unforced migration this column was built to
// avoid. `not_started` also stays: none of the four new values means "I
// haven't decided", and collapsing "haven't looked at this" into one of them
// would misrepresent every existing untouched row the moment it renders.
//
// WHAT THE DESIGN'S OWN STATE MACHINE FLATTENS AWAY. The design tracks
// `status` (open/complete/skipped), a separate `reasons` map, a separate
// `blocked` flag for "Not safe yet — needs a decision" (raised, then
// optionally handed to Shane's team) and a separate `by` (you/team) — four
// pieces of state for one decision. This column is deliberately ONE flat
// enum: from the reader's side, "I'm handing this to Shane" and "this is
// already handled another way" are the same shape of fact — a decision made
// about the step — and splitting them across parallel boolean/reason fields
// bolted onto `completed_at`'s neighbours is exactly what Phase A's own
// comment on this column warned against.
// `accepted_risk` (#1542) — the customer explicitly declined this remediation
// item and it has EXITED the checklist to the register. This is deliberately
// its OWN value rather than folded into `deferred`/`not_applicable`: those two
// are claims with no formal record behind them, while `accepted_risk` is ONLY
// ever set by `remediation-tracker-risk-decline.ts` in the same transaction
// that creates a SIGNED `msp_risk_decisions` row (the same rejection-to-risk
// path as #1514, arriving from this side rather than Change Control) — a
// verifiable fact, not a claim awaiting proof, so it is never reset back to
// `unverified`-eligible re-verification the way the other five are (see
// `remediation-tracker-verification.ts`'s explicit allow-list, which this
// value is deliberately left out of).
export const REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started",
  "completed",
  "already_handled",
  "not_applicable",
  "deferred",
  "shane_handles",
  "accepted_risk",
] as const;
export type RemediationTrackerStepStatus = (typeof REMEDIATION_TRACKER_STEP_STATUS)[number];

// VERIFICATION (#732, Phase C). `status` above is the customer's CLAIM —
// "I did this", "already handled another way", and so on. This is a
// completely separate fact: whether a real re-scan has actually checked that
// claim against the tenant, exactly the split Phase A's and Phase B's own
// comments on `status` both already promised ("Phase C's verification state
// will add is a SEPARATE field rather than another value of this one").
//
//   unverified — the default, and what every fresh claim starts as. Matches
//     the design's own "Awaiting re-scan" / "Nothing verified yet" language:
//     a tick is not evidence, only a re-scan is.
//   verified   — the most recent re-scan that covered this step's mapped
//     check(s) found no adverse finding on ALL of them. A real, positive
//     result, not an absence of information.
//   drift      — the most recent re-scan that covered this step's mapped
//     check(s) found a real critical/warning finding on at least one of them,
//     despite the customer's claim. The design's own label for this is
//     "Drifted — verification withdrawn", and that is exactly the right frame:
//     verification is WITHDRAWN, not merely "not yet granted" the way
//     `unverified` is.
//
// A step whose mapped check(s) never ran in a given scan (wrong package,
// execution error, no check exists at all — Steps 18/28's platform-wide gaps,
// the four process-only steps) leaves this column exactly where it was: no
// real evidence means no real verdict, the same "absence carries no
// information" rule `stepEvidence()` already enforces for the guide itself.
export const REMEDIATION_TRACKER_VERIFICATION_STATE = ["unverified", "verified", "drift"] as const;
export type RemediationTrackerVerificationState = (typeof REMEDIATION_TRACKER_VERIFICATION_STATE)[number];

export const remediationTrackerStepsTable = pgTable("remediation_tracker_steps", {
  id: serial("id").primaryKey(),
  /**
   * tenants.id — the JWT's `customerId` claim, the same id space
   * `msp_diagnostic_runs.customer_id` uses. No FK, matching that table's own
   * deliberate choice (see the Phase 7 audit note there).
   */
  customerId: integer("customer_id").notNull(),
  /** "s1" … "s30" — the remediation guide's own step ids. */
  stepId: text("step_id").notNull(),
  /**
   * See `REMEDIATION_TRACKER_STEP_STATUS` above for the real vocabulary.
   * Deliberately a plain text column with no CHECK, the same convention
   * `content_posts.status` follows — Phase B (#731) already widened this once
   * in code alone, no migration, and Phase C's verification/drift state stays
   * its OWN column rather than growing this enum further.
   */
  status: text("status", { enum: REMEDIATION_TRACKER_STEP_STATUS }).notNull().default("not_started"),
  /**
   * When this step last became `completed` — literal self-resolve, not any of
   * the other four actioned states. NULL whenever the status is anything else,
   * including the other four: none of them is evidence of a completed change,
   * only of a decision made about the step.
   */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** users.id of whoever last changed this row. Nullable for rows written by anything but a person. */
  updatedByUserId: integer("updated_by_user_id"),
  /**
   * See `REMEDIATION_TRACKER_VERIFICATION_STATE` above. Reset to `unverified`
   * (with `verifiedAt`/`verifiedByRunId` cleared) on EVERY write to `status` —
   * a changed claim invalidates whatever a previous scan confirmed or flagged
   * about the old one. Only `reverifyRemediationTrackerSteps()`
   * (`api-server/src/lib/remediation-tracker-verification.ts`), fired from
   * inside `runDiagnostics()` once a real scan's findings exist, ever moves
   * this to `verified` or `drift`.
   */
  verificationState: text("verification_state", { enum: REMEDIATION_TRACKER_VERIFICATION_STATE })
    .notNull()
    .default("unverified"),
  /** When this row last became `verified` or `drift`. NULL while `unverified`. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  /**
   * `msp_diagnostic_runs.run_id` of the scan that produced the current
   * verification state — no FK, matching every other cross-table reference on
   * this table and on `msp_diagnostic_runs` itself. What Phase D's evidence
   * pack will cite as "verified by this scan".
   */
  verifiedByRunId: uuid("verified_by_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The tracker's only real read ("this customer's whole tracker") and its only
  // real write ("upsert this one step") both go through this pair.
  uniqueIndex("remediation_tracker_steps_customer_step_idx").on(t.customerId, t.stepId),
]);

export type RemediationTrackerStep = typeof remediationTrackerStepsTable.$inferSelect;
export type InsertRemediationTrackerStep = typeof remediationTrackerStepsTable.$inferInsert;

// ── Portal v2: Active Runbooks and Hold Windows ───────────────────────────────
//
// The Customer Portal's Operate section. Both systems are GREENFIELD — BUILD_PLAN
// §3.3 records that a repo-wide grep for "hold window" / HOLD_DEFS /
// "hold_window" hit only the design files, and runbook progress was equally
// unmodelled: the prototype keeps step ticks and customer-added steps in
// component state (runbookCustomSteps, per-runbook *Checked arrays), which means
// they die with the tab. That is the same defect Git #730 fixed for the
// Remediation Tracker, and these tables are shaped after that fix.
//
// WHAT A HOLD WINDOW IS: a runbook step that gates the steps after it and waits
// on ELAPSED TIME rather than on work — "enable CA01 in report-only, wait 7
// days, then decide". The tenant is scanned while the window runs, so the window
// can close early when the evidence says waiting adds nothing. See
// api-server/src/lib/portal-hold-windows.ts for the derivation, which fixes four
// real defects in the prototype's own state machine rather than porting them.
//
// SCOPING follows remediation_tracker_steps: customer_id is a tenants.id (the
// JWT's customerId claim) carried WITHOUT a foreign key, matching the deliberate
// choice msp_diagnostic_runs documents. Enum-ish columns are plain text with no
// CHECK, the same convention remediation_tracker_steps.status and
// msp_change_requests.status follow, so a vocabulary can be widened in code
// without a migration.

/** A runbook (schedule) or a single cycle's lifecycle. Plain text, no CHECK — see the section note. */
export const PORTAL_RUNBOOK_STATUS = ["active", "complete", "abandoned"] as const;
export type PortalRunbookStatus = typeof PORTAL_RUNBOOK_STATUS[number];

/**
 * A runbook is the SCHEDULE, not a cycle (#1557). It used to also carry
 * `started_on` + `cycle_days` as if there were exactly one run, which meant
 * resetting a recurring procedure for its next cycle silently wiped the last
 * cycle's completion — there was nowhere else for it to live. Recurrence is now
 * a property of the schedule (`recurring`); each cycle is its own row in
 * `portal_runbook_runs`, so a reset never destroys history, and "did we do the
 * guest access review last quarter, and who signed it off" is a query, not a
 * gap.
 */
export const portalRunbooksTable = pgTable("portal_runbooks", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching remediation_tracker_steps. */
  customerId: integer("customer_id").notNull(),
  /** Stable key from the runbook catalogue, e.g. "gov-manage-guests" (prototype 16844-16850). */
  runbookKey: text("runbook_key").notNull(),
  title: text("title").notNull(),
  /** The prototype's context line, e.g. "Governance · Vendor Onboarding Packet". */
  context: text("context").notNull(),
  /** One of journeyTokens' six PILLAR_KEYS. Text, not an enum, for the reason above. */
  pillar: text("pillar").notNull(),
  /**
   * The day this schedule was first put into service. A DATE, not a timestamp,
   * matching `portal_runbook_runs.started_on` below. NOT the current cycle's
   * start any more — that moved to the run — kept here only as "when this
   * procedure began" bookkeeping for the schedule itself.
   */
  startedOn: date("started_on").notNull(),
  /** One cycle's expected duration in days — the "of 14" in "Day 7 of 14". */
  cycleDays: integer("cycle_days").notNull(),
  /**
   * Whether finishing a cycle spawns the next one automatically. false for a
   * one-shot procedure (e.g. the Overshared SharePoint site-fix runbooks —
   * `portal-oversharing-sites.ts` — which never recur); true for a genuinely
   * recurring review (e.g. a quarterly guest access review).
   */
  recurring: boolean("recurring").notNull().default(false),
  /** The SCHEDULE's own lifecycle — retired ("abandoned") stops future cycles even if recurring. */
  status: text("status", { enum: PORTAL_RUNBOOK_STATUS }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_runbooks_customer_id_idx").on(t.customerId),
  uniqueIndex("portal_runbooks_customer_key_idx").on(t.customerId, t.runbookKey),
]);

export type PortalRunbook = typeof portalRunbooksTable.$inferSelect;
export type InsertPortalRunbook = typeof portalRunbooksTable.$inferInsert;

/**
 * One row per CYCLE of a runbook schedule (#1557). `cycleNumber` is 1-based and
 * sequential per runbook. Completing a cycle (or being marked abandoned) never
 * mutates or deletes this row — the next cycle, if the schedule is `recurring`,
 * is a NEW row with `cycleNumber + 1`. That is what makes run history, "who
 * completed which cycle and when", and a missed cycle all readable later
 * instead of silently overwritten.
 */
export const portalRunbookRunsTable = pgTable("portal_runbook_runs", {
  id: serial("id").primaryKey(),
  runbookId: integer("runbook_id").notNull().references(() => portalRunbooksTable.id, { onDelete: "cascade" }),
  /** tenants.id — denormalised for direct customer-scoped queries, matching portal_hold_windows. */
  customerId: integer("customer_id").notNull(),
  /** 1-based, sequential per runbook. Cycle 1 is created alongside the runbook itself. */
  cycleNumber: integer("cycle_number").notNull(),
  /** The day THIS cycle started. Was `portal_runbooks.started_on` before #1557. */
  startedOn: date("started_on").notNull(),
  /** This cycle's own lifecycle — independent of the schedule's `status` above. */
  status: text("status", { enum: PORTAL_RUNBOOK_STATUS }).notNull().default("active"),
  /** Set once every step in this cycle is checked, or the cycle is otherwise closed out. NULL while open. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** users.id of whoever completed the cycle — the last step-check that finished it. Nullable: not always a person. */
  completedByUserId: integer("completed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_runbook_runs_customer_id_idx").on(t.customerId),
  index("portal_runbook_runs_runbook_id_idx").on(t.runbookId),
  uniqueIndex("portal_runbook_runs_runbook_cycle_idx").on(t.runbookId, t.cycleNumber),
]);

export type PortalRunbookRun = typeof portalRunbookRunsTable.$inferSelect;
export type InsertPortalRunbookRun = typeof portalRunbookRunsTable.$inferInsert;

export const portalRunbookStepsTable = pgTable("portal_runbook_steps", {
  id: serial("id").primaryKey(),
  /** The cycle this step's check-off state belongs to (#1557) — see runId below. */
  runId: integer("run_id").notNull().references(() => portalRunbookRunsTable.id, { onDelete: "cascade" }),
  /**
   * DEPRECATED — pre-#1557, this was the (required) parent. Steps are now owned
   * by a cycle (`runId`), not the schedule directly, so a reset never wipes the
   * last cycle's completion. Left in place and NULLable rather than dropped
   * (dropping a column is a destructive migration and none of this is needed
   * for correctness); no code writes or reads it any more.
   */
  runbookId: integer("runbook_id").references(() => portalRunbooksTable.id, { onDelete: "cascade" }),
  /** 1-based render order. Unique per cycle so a step cannot silently duplicate a slot. */
  position: integer("position").notNull(),
  text: text("text").notNull(),
  checked: boolean("checked").notNull().default(false),
  /**
   * True for a step the CUSTOMER added through the page's "Add a step or
   * sub-step…" field, false for one that came with the runbook. Kept distinct
   * because the two are not the same claim: a catalogue step is part of an
   * agreed procedure, a custom one is the customer's own note, and the prototype
   * already renders them with different tick colours.
   */
  isCustom: boolean("is_custom").notNull().default(false),
  /** When checked last became true. NULL whenever it is false — un-ticking clears it. */
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  /** users.id of whoever last toggled it. Nullable for rows written by anything but a person. */
  checkedByUserId: integer("checked_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_runbook_steps_run_id_idx").on(t.runId),
  uniqueIndex("portal_runbook_steps_run_position_idx").on(t.runId, t.position),
]);

export type PortalRunbookStep = typeof portalRunbookStepsTable.$inferSelect;
export type InsertPortalRunbookStep = typeof portalRunbookStepsTable.$inferInsert;

/**
 * What the tenant scan found while the window has been running. This is the
 * interesting part of the whole system and the thing the customer asked for:
 *   • clear   — nothing would break; the window can close early.
 *   • signals — enforcing today breaks something NAMED; do not release.
 *   • watch   — something worth a look before close.
 */
export const PORTAL_HOLD_SCAN_VERDICT = ["clear", "signals", "watch"] as const;
export type PortalHoldScanVerdict = typeof PORTAL_HOLD_SCAN_VERDICT[number];

export const portalHoldWindowsTable = pgTable("portal_hold_windows", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The runbook this window gates. Cascades: a deleted runbook's windows are meaningless. */
  runbookId: integer("runbook_id").references(() => portalRunbooksTable.id, { onDelete: "cascade" }),
  /**
   * The CYCLE this window gates (#1940). `portal_runbook_runs`/`portal_runbook_steps`
   * (#1557) restart `position` at 1 per cycle, so `gatesStepPosition` alone is
   * ambiguous once a recurring runbook has spawned a second cycle — "step 4"
   * could mean cycle 1's step 4 or cycle 2's. Nullable additively: a window
   * raised before #1557 (or before this column existed) has no cycle to point
   * at and is matched to a runbook's CURRENT cycle by fallback, same as before.
   * Cascades: a deleted cycle's own windows are meaningless.
   */
  runId: integer("run_id").references(() => portalRunbookRunsTable.id, { onDelete: "cascade" }),
  /** Stable key from the design, e.g. "hold-ca01". */
  holdKey: text("hold_key").notNull(),
  title: text("title").notNull(),
  /** The prose the card shows, e.g. "Gates step 4 — enforce CA01 and block legacy authentication". */
  gates: text("gates").notNull(),
  /**
   * The step this window actually gates, as a real reference into
   * portal_runbook_steps.position rather than only the prose above. The
   * prototype has only the sentence, so "which step is blocked" was not
   * machine-readable and releasing a window could not unblock anything.
   */
  gatesStepPosition: integer("gates_step_position"),
  pillar: text("pillar").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  /** The originally agreed wait. Extensions do NOT mutate this — see extendedDays. */
  waitDays: integer("wait_days").notNull(),
  /**
   * Total days added by extensions, kept SEPARATE from waitDays so that "this
   * window was agreed at 7 days and has since been extended twice" stays
   * visible. The design is explicit about why: "Extending is recorded with a
   * reason, so a window that keeps moving is visible rather than quietly
   * permanent." The individual extensions are rows in
   * portal_hold_window_events; this is their running total, denormalised so the
   * close date is one column read.
   */
  extendedDays: integer("extended_days").notNull().default(0),
  scanVerdict: text("scan_verdict", { enum: PORTAL_HOLD_SCAN_VERDICT }).notNull().default("watch"),
  /** The evidence sentence, naming what was found — e.g. "2 sign-ins would have been blocked…". */
  scanLine: text("scan_line").notNull(),
  /**
   * The three parts of the design's provenance line, stored separately and
   * composed for display rather than stored as the finished prose: "{source},
   * scanned {cadence}, last {HH:MM}". Storing the sentence would mean a
   * timestamp that never updates itself.
   */
  scanSource: text("scan_source").notNull(),
  scanCadence: text("scan_cadence").notNull().default("hourly"),
  scanAt: timestamp("scan_at", { withTimezone: true }),
  /** Why the wait exists at all, in the design's own voice. */
  why: text("why").notNull(),
  /** Set when the window is released or closed early. NULL while it is still open. */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
  /**
   * The README's alerting contract: a window must notify at T-24, at T-0, and
   * again the moment a scan turns the verdict to clear before the window ends —
   * the third being a FINDING ("you don't need to wait the remaining 9 days"),
   * not a reminder. These three stamps are what makes that contract
   * implementable without re-firing: the derivation reports which notifications
   * are DUE, and whatever transport sends them stamps the column.
   *
   * The transport itself is explicitly out of round one (BUILD_PLAN §7). These
   * columns exist so it is a wiring job later rather than another schema change.
   */
  notifiedT24At: timestamp("notified_t24_at", { withTimezone: true }),
  notifiedT0At: timestamp("notified_t0_at", { withTimezone: true }),
  notifiedEarlyClearAt: timestamp("notified_early_clear_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_hold_windows_customer_id_idx").on(t.customerId),
  index("portal_hold_windows_runbook_id_idx").on(t.runbookId),
  index("portal_hold_windows_run_id_idx").on(t.runId),
  uniqueIndex("portal_hold_windows_customer_key_idx").on(t.customerId, t.holdKey),
]);

export type PortalHoldWindow = typeof portalHoldWindowsTable.$inferSelect;
export type InsertPortalHoldWindow = typeof portalHoldWindowsTable.$inferInsert;

/**
 * Every decision taken on a hold window. This is the audit trail the design's
 * copy promises ("Extending is recorded with a reason"), and it is also where a
 * hold-window action is joined to the change request it raised — the concrete
 * form of the portal's central rule that nothing changes in the tenant without a
 * CR.
 */
export const PORTAL_HOLD_EVENT_KIND = [
  "extended",
  "closed_early",
  "released",
  "cr_prepared",
] as const;
export type PortalHoldEventKind = typeof PORTAL_HOLD_EVENT_KIND[number];

export const portalHoldWindowEventsTable = pgTable("portal_hold_window_events", {
  id: serial("id").primaryKey(),
  holdWindowId: integer("hold_window_id").notNull().references(() => portalHoldWindowsTable.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: PORTAL_HOLD_EVENT_KIND }).notNull(),
  /** Days added, for "extended". NULL for every other kind. */
  daysDelta: integer("days_delta"),
  /** The stated reason. The design requires one for an extension. */
  reason: text("reason"),
  /** users.id of whoever took the decision. */
  actorUserId: integer("actor_user_id"),
  /**
   * msp_change_requests.id of the change request this decision raised, when it
   * raised one. No FK, matching the cross-table convention above. This is the
   * link that makes "every early close routes through a CR" checkable rather
   * than merely asserted.
   */
  changeRequestId: integer("change_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_hold_window_events_hold_window_id_idx").on(t.holdWindowId),
]);

export type PortalHoldWindowEvent = typeof portalHoldWindowEventsTable.$inferSelect;
export type InsertPortalHoldWindowEvent = typeof portalHoldWindowEventsTable.$inferInsert;

// ── Security Plan (plan-of-record) ────────────────────────────────────────────
// The customer's authoritative Security Plan — "the authoritative record of how
// this tenant must be configured, monitored, governed and changed". Backs
// `/portal-v2/security-plan`, which was 100% fixture (securityPlanData.ts) before
// this: no route, no table. The four tables below are a direct, un-redesigned
// transcription of the existing fixture shapes (SecurityPlan / SecPlanSection /
// SecPlanRow / SecPlanVersion in
// artifacts/msp-portal/src/components/portal-v2/securityPlanData.ts) — the header
// fields on the plan, its ordered numbered sections, each section's ordered
// requirement rows, and the plan's version history.
//
// ADMIN-AUTHORED, deliberately read-only. A security plan is the plan of record
// the MSP (Shane's team) writes and signs FOR a tenant; the customer reads it,
// they do not edit it. So `GET /api/portal/security-plan` serves it and there is
// no customer write path — the same read-only stance portal_ownership took, for
// the same product reason rather than a security one. Content is authored/seeded
// via the manual migration, not through the portal.
//
// Conventions match the neighbouring portal tables (portal_runbooks etc.):
//   • customer_id is a tenants.id (the JWT's customerId claim), no FK — matching
//     remediation_tracker_steps / portal_runbooks.
//   • the met/partial/gap state is plain text, NO CHECK constraint, the same
//     convention every other enum-ish portal column follows so the vocabulary can
//     widen in code without another migration.
//   • timestamptz (UTC) timestamps, per the schema header rule.

/** Whether a requirement is met, partly met, or not met. Mirrors SecPlanState. */
export const PORTAL_SECURITY_PLAN_ROW_STATE = ["met", "partial", "gap"] as const;
export type PortalSecurityPlanRowState = typeof PORTAL_SECURITY_PLAN_ROW_STATE[number];

export const portalSecurityPlansTable = pgTable("portal_security_plans", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching remediation_tracker_steps. */
  customerId: integer("customer_id").notNull(),
  /** SecurityPlan.tenant — the tenant name the plan header shows, as authored. */
  tenant: text("tenant").notNull(),
  /** SecurityPlan.env, e.g. "Production". */
  env: text("env").notNull(),
  /** SecurityPlan.tier, e.g. "Enhanced". */
  tier: text("tier").notNull(),
  /** SecurityPlan.version, e.g. "v4.2". */
  version: text("version").notNull(),
  /**
   * SecurityPlan.updated — the human display string the header renders verbatim,
   * e.g. "19 August 2026". A display label, not a timestamp: it is the date the
   * plan was signed as the plan reads it, so it is stored exactly as authored
   * rather than reformatted from a Date at render time.
   */
  updatedLabel: text("updated_label").notNull(),
  /** SecurityPlan.approver — the signing owner's name + title. */
  approver: text("approver").notNull(),
  /** SECURITY_PLAN_OWNER.initials — the header chip's initials, e.g. "DW". */
  ownerInitials: text("owner_initials").notNull(),
  /** SECURITY_PLAN_OWNER.tone — the header chip's colour, e.g. "#fbbf24". */
  ownerTone: text("owner_tone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One plan of record per customer.
  uniqueIndex("portal_security_plans_customer_id_idx").on(t.customerId),
]);

export type PortalSecurityPlan = typeof portalSecurityPlansTable.$inferSelect;
export type InsertPortalSecurityPlan = typeof portalSecurityPlansTable.$inferInsert;

export const portalSecurityPlanSectionsTable = pgTable("portal_security_plan_sections", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => portalSecurityPlansTable.id, { onDelete: "cascade" }),
  /** SecPlanSection.k — the stable key used for selection and the URL, e.g. "governance". */
  sectionKey: text("section_key").notNull(),
  /** SecPlanSection.n — the two-digit section number the design shows, e.g. "02". A label, not an int. */
  number: text("number").notNull(),
  /** 1-based render order. Unique per plan so a section cannot silently duplicate a slot. */
  position: integer("position").notNull(),
  label: text("label").notNull(),
  lead: text("lead").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_security_plan_sections_plan_id_idx").on(t.planId),
  uniqueIndex("portal_security_plan_sections_plan_key_idx").on(t.planId, t.sectionKey),
  uniqueIndex("portal_security_plan_sections_plan_position_idx").on(t.planId, t.position),
]);

export type PortalSecurityPlanSection = typeof portalSecurityPlanSectionsTable.$inferSelect;
export type InsertPortalSecurityPlanSection = typeof portalSecurityPlanSectionsTable.$inferInsert;

export const portalSecurityPlanRowsTable = pgTable("portal_security_plan_rows", {
  id: serial("id").primaryKey(),
  sectionId: integer("section_id").notNull().references(() => portalSecurityPlanSectionsTable.id, { onDelete: "cascade" }),
  /** 1-based render order within the section. Unique per section. */
  position: integer("position").notNull(),
  /** SecPlanRow.req — the requirement text. */
  req: text("req").notNull(),
  /** SecPlanRow.state — met | partial | gap. Text, no CHECK, per the convention above. */
  state: text("state", { enum: PORTAL_SECURITY_PLAN_ROW_STATE }).notNull(),
  /** SecPlanRow.detail — the detail line under the requirement. */
  detail: text("detail").notNull(),
  /**
   * SecPlanRow.to — the portal-v2 route this requirement's proof lives in, e.g.
   * "/portal-v2/ownership". Stored verbatim; the page keeps its own LIVE_ROUTES
   * gate deciding which of these are navigable today, so a route that is not live
   * yet is stored here but rendered inert rather than 404-ing.
   */
  toRoute: text("to_route").notNull(),
  /** SecPlanRow.toLabel — the proof link's label, e.g. "Ownership". */
  toLabel: text("to_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_security_plan_rows_section_id_idx").on(t.sectionId),
  uniqueIndex("portal_security_plan_rows_section_position_idx").on(t.sectionId, t.position),
]);

export type PortalSecurityPlanRow = typeof portalSecurityPlanRowsTable.$inferSelect;
export type InsertPortalSecurityPlanRow = typeof portalSecurityPlanRowsTable.$inferInsert;

export const portalSecurityPlanVersionsTable = pgTable("portal_security_plan_versions", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => portalSecurityPlansTable.id, { onDelete: "cascade" }),
  /** 1-based render order — the history is shown newest-first, as authored. Unique per plan. */
  position: integer("position").notNull(),
  /** SecPlanVersion.v — the version string, e.g. "v4.2". */
  version: text("version").notNull(),
  /** SecPlanVersion.when — the display date, e.g. "19 Aug 2026". A label, not a timestamp. */
  whenLabel: text("when_label").notNull(),
  /** SecPlanVersion.who — who made the change. */
  who: text("who").notNull(),
  /** SecPlanVersion.what — what changed. */
  what: text("what").notNull(),
  /** SecPlanVersion.cr — the change request code that made it, e.g. "CR-0131". */
  cr: text("cr").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_security_plan_versions_plan_id_idx").on(t.planId),
  uniqueIndex("portal_security_plan_versions_plan_position_idx").on(t.planId, t.position),
]);

export type PortalSecurityPlanVersion = typeof portalSecurityPlanVersionsTable.$inferSelect;
export type InsertPortalSecurityPlanVersion = typeof portalSecurityPlanVersionsTable.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * Portal v2 — Ownership matrix WRITE persistence
 *
 * `GET /api/portal/ownership` reads real rows and real people, but until these
 * three tables existed every mutation the matrix offers — assign a name to a
 * cell, mark it accepted, hand a person's work over, add a row — lived only in
 * React state and was lost on reload (the route's own header called itself
 * "Read-only, deliberately", because there was nowhere to write). These are
 * that write side: a per-customer OVERLAY on top of the objects the read
 * assembles, keyed by the same opaque wire identifiers the page already uses.
 *
 * All three are keyed on `customer_id` (= tenants.id, the JWT's customerId) with
 * NO foreign keys, matching every portal-* table above: the object ids
 * ("svc-12", "CR-2026-0148", a Graph message id, a hold key, a hand-added
 * "own-…") and person ids ("u39") are UI identifiers assembled by
 * `lib/portal-ownership.ts`, not rows in a table this could reference.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * One assigned (or explicitly cleared) matrix cell — the heart of the overlay.
 *
 * A row exists for every (object, role) a customer has touched. `owner_person_id`
 * of "" is a REAL value meaning "cleared to a gap", exactly as the client's
 * `ownerOf` treats an override of "" (an absent row falls back to what the read
 * computed — a change request's requester/approver, or a gap). Acceptance and
 * the three provenance fields carry the assign slide-over's own state so a
 * reload shows the same "not accepted yet · set by … on …" it showed live.
 */
export const portalOwnershipAssignmentsTable = pgTable("portal_ownership_assignments", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The matrix object's opaque wire id, as assembled by the read layer. */
  objectId: text("object_id").notNull(),
  /** One of r | a | c | i. */
  roleKey: text("role_key").notNull(),
  /** The wire person id this cell names (e.g. "u39"), or "" for an explicit gap. */
  ownerPersonId: text("owner_person_id").notNull().default(""),
  /**
   * "" | "pending" | "accepted" | "declined". Only r/a ever carry acceptance;
   * c/i never do. No DB CHECK — "declined" (#1518) is an application-layer
   * value, matching the msp_alert-enums-are-text convention.
   */
  acceptance: text("acceptance").notNull().default(""),
  /** Provenance the ASSIGN flow records — who named this holder, when, and why. */
  setBy: text("set_by").notNull().default(""),
  setAt: text("set_at").notNull().default(""),
  setWhy: text("set_why").notNull().default(""),
  /**
   * The assigner's own wire person id (#1519), same "u{id}" scheme as
   * `ownerPersonId` — not a duplicate of `setBy`. `setBy` is display-name/
   * email text for showing a human "who set this"; it is not reliably
   * resolvable back to a real recipient (two people can share a display
   * name). A customer-side decline needs a stable identity to escalate the
   * notification to (see `notifyOwnershipDeclined`), so the assigner's real
   * user id is captured here at assign time, the same way `ownerPersonId`
   * captures the holder's. "" for any row assigned before this column
   * existed — those simply do not get an escalation notification, exactly
   * like every other best-effort notification path in this module.
   */
  setByPersonId: text("set_by_person_id").notNull().default(""),
  /**
   * Provenance the RESPOND flow records (#1518) — who actually accepted or
   * declined this cell, and when. Deliberately separate from `setBy`/`setAt`:
   * those record who ASSIGNED the holder, which may be a different person
   * (the whole point of the gate is that the two are not assumed to agree
   * until the named holder says so themselves).
   */
  respondedBy: text("responded_by").notNull().default(""),
  respondedAt: text("responded_at").notNull().default(""),
  /** Free text, set only on a decline. Empty for every other acceptance value. */
  declineReason: text("decline_reason").notNull().default(""),
  /**
   * Precedence within one (object, role) cell — primary/second/third, etc.
   * (#1517). PRECEDENCE ONLY: every holder in a cell has identical authority: the
   * primary handing work to the third in line ("Rodney, go sign that RBD") is
   * normal, not an exception. There is no succession/activation/timeout logic
   * anywhere that reads this column — it exists solely so the UI can render a
   * stable "who's first" order and so a customer can reorder it explicitly
   * (`POST /portal/ownership/reorder`) without losing a row's acceptance/
   * provenance, which a delete-and-reinsert would. Assigning a NEW holder to a
   * cell appends at the end (max + 1 for that cell); re-asserting an existing
   * holder leaves their rank untouched. Not unique — a reorder writes ranks
   * transactionally but two ranks briefly existing is not a correctness bug here.
   */
  orderRank: integer("order_rank").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_ownership_assignments_customer_id_idx").on(t.customerId),
  // A RACI cell holds MANY holders, not one (#1515). The textbook singular-A rule
  // does not survive practice — NASA runs three A's on M365 — so R, A, C and I are
  // all potentially many. The unique key therefore carries `ownerPersonId`: it still
  // forbids the SAME holder appearing twice in one cell, but permits distinct holders
  // to co-exist. Precedence within a cell is `orderRank` (#1517), not insertion order.
  // The `""` gap value is itself a valid distinct holder under this key.
  uniqueIndex("portal_ownership_assignments_customer_object_role_owner_idx").on(
    t.customerId,
    t.objectId,
    t.roleKey,
    t.ownerPersonId,
  ),
]);

export type PortalOwnershipAssignment = typeof portalOwnershipAssignmentsTable.$inferSelect;
export type InsertPortalOwnershipAssignment = typeof portalOwnershipAssignmentsTable.$inferInsert;

/** The five things that can happen to one cell holder — nothing else is recorded. */
export const OWN_EVENT_TYPES = ["assigned", "accepted", "declined", "cleared", "reassigned"] as const;
export type OwnershipEventType = typeof OWN_EVENT_TYPES[number];

/**
 * The append-only history behind one matrix cell holder (#1522).
 *
 * `portal_ownership_assignments` is CURRENT STATE — one row per
 * (customer, object, role, owner), overwritten on every re-assert. This table is
 * the record that survives the overwrite: every assign / accept / decline / clear
 * / reassign is inserted here and NEVER updated or deleted, so "who held A when
 * this RBD was signed" is a replay of this log as of a date, not a question the
 * current-state table can answer once a later event has overwritten it.
 *
 * Rows are never mutated after insert — there is deliberately no `updatedAt` and
 * no route that touches an existing row. `ownerPersonId` of "" is a real value,
 * same as the assignments table: an event clearing a cell to a gap is itself a
 * holder-less event, not the absence of one.
 */
export const portalOwnershipEventsTable = pgTable("portal_ownership_events", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The matrix object's opaque wire id, as assembled by the read layer. */
  objectId: text("object_id").notNull(),
  /** One of r | a | c | i. */
  roleKey: text("role_key").notNull(),
  /** The wire person id this event is about (e.g. "u39"), or "" for a gap. */
  ownerPersonId: text("owner_person_id").notNull().default(""),
  eventType: text("event_type", { enum: OWN_EVENT_TYPES }).notNull(),
  /** Who performed the action — display name or email, same provenance as `setBy`. */
  actor: text("actor").notNull().default(""),
  /** Free-text reason, where one applies (e.g. a decline reason). "" when none. */
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_ownership_events_customer_id_idx").on(t.customerId),
  // The cell-history lookup: every event for one (object, role, owner) holder, in
  // order. `createdAt` is the replay axis; `id` only tiebreaks same-timestamp inserts.
  index("portal_ownership_events_cell_idx").on(
    t.customerId,
    t.objectId,
    t.roleKey,
    t.ownerPersonId,
  ),
]);

export type PortalOwnershipEvent = typeof portalOwnershipEventsTable.$inferSelect;
export type InsertPortalOwnershipEvent = typeof portalOwnershipEventsTable.$inferInsert;

/**
 * A dated handover of one person's work to another. It annotates the matrix, it
 * does not reassign it (the design: "It ends by itself, and the matrix goes back
 * to what it says today") — so `done` and the free-text `until` are the whole
 * lifecycle, and ending a handover flips `done` rather than deleting the row.
 */
export const portalOwnershipDelegationsTable = pgTable("portal_ownership_delegations", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** Wire person ids. `from` is whoever was handed over; `to` covers them. */
  fromPersonId: text("from_person_id").notNull(),
  toPersonId: text("to_person_id").notNull(),
  /** The end date exactly as the design keeps it — free text, e.g. "22 September". */
  until: text("until").notNull(),
  /** "all" or an object-type key — how much of their work the cover extends to. */
  scope: text("scope").notNull().default("all"),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_ownership_delegations_customer_id_idx").on(t.customerId),
]);

export type PortalOwnershipDelegation = typeof portalOwnershipDelegationsTable.$inferSelect;
export type InsertPortalOwnershipDelegation = typeof portalOwnershipDelegationsTable.$inferInsert;

/**
 * A row the customer added to the matrix by hand. `source` distinguishes the two
 * ways the page grows the matrix: "custom" is the add-a-row slide-over (a thing
 * that can go wrong and needs a name against it), "coverage" is "Give it a row"
 * in the not-in-the-matrix panel (a known-missing object promoted to a real
 * row). Either way it arrives with four gaps, which is the point.
 */
export const portalOwnershipRowsTable = pgTable("portal_ownership_rows", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The row's wire id — a hand-added "own-…" id, or a promoted coverage id. */
  rowId: text("row_id").notNull(),
  /** "custom" (add-a-row) or "coverage" (give-it-a-row). */
  source: text("source").notNull(),
  /** Object type key. NULL for a coverage row, whose type comes from its fixture. */
  objType: text("obj_type"),
  /** NULL for a coverage row, whose name/sub come from its fixture entry. */
  name: text("name"),
  sub: text("sub"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_ownership_rows_customer_id_idx").on(t.customerId),
  uniqueIndex("portal_ownership_rows_customer_row_idx").on(t.customerId, t.rowId),
]);

export type PortalOwnershipRow = typeof portalOwnershipRowsTable.$inferSelect;

// ── Settings: Change control policy + Departments persistence (#1592) ────────
//
// `portal-v2-settings.tsx`'s Change control policy and Departments sections were
// 100% client-only React state — every toggle, approver chip and notification
// rule edit reacted on screen, nothing survived a reload, and no persistence
// endpoint existed at all (honestly flagged by #1463's `pv2-set-cc-nodata` /
// `pv2-set-dept-nodata` badges). These four tables are the backend this issue
// builds. Scoped by `customerId` (`tenants.id`, straight off the JWT) with no FK,
// matching `portal_ownership_*` above and for the same reason.
//
// ── This is a DIFFERENT object from #1496's approval model, on purpose ───────
// #1496 ("Change Control: Approval model + `canApproveChanges` capability flag")
// is still open and unbuilt: it is the per-CHANGE approval decision trail that
// will attach to an individual `msp_change_requests` row — `cr_approvals` with
// `stage`, `decision`, `reason`, `decidedAt`. `portalChangeControlPolicyTable`
// below is the tenant-wide POLICY consulted when a change request is evaluated —
// what gets gated, how many signatures are required, and who is eligible to sign
// at all. It records no decision of its own.
//
// ── #1759 made the policy authoritative and dropped the approver table ───────
// #1496 and #1592 landed the same day and neither read the other: the policy
// had no consumer on the approval path. #1759 wired `required_signatures` and
// `require_separate_approver` into `portal-change-approvals-store` so the
// approve/reject/materialise path acts on them. It also DROPPED the former
// `portal_change_control_approvers` table (and its `normal`/`emergency` bands):
// that was a SECOND eligibility store the approval path never read. Approver
// eligibility now derives live from `users.can_approve_changes` — the same
// capability the approve/reject routes enforce — so there is nothing to drift.
// This resolved #1757 (cross-validating the two stores) by deletion, not patch.

/** The design's fixed "what is gated" catalogue (CC_GATES) — a real, closed
 *  vocabulary carried forward from the settings fixture, not invented here. */
export const CC_GATE_KEYS = ["fix", "sop", "remediation", "copilot", "graph"] as const;
export type CcGateKey = (typeof CC_GATE_KEYS)[number];

export const portalChangeControlPolicyTable = pgTable("portal_change_control_policy", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  /** The master switch. Switching it off does not switch off the record — the
   *  design's own words: actions still land in the register, marked as run
   *  without approval. That marking is a write-path concern, not this table's. */
  enabled: boolean("enabled").notNull().default(true),
  /** Keyed by `CC_GATE_KEYS`. Anything true here cannot run until its change
   *  request is approved. */
  gated: jsonb("gated").notNull().default({}),
  /** "Signatures required" — 1, 2 or 3 in the design; not constrained tighter
   *  than a positive integer here since the design offered no reason it must
   *  stop at 3. */
  requiredSignatures: integer("required_signatures").notNull().default(1),
  /** "The person who raises it cannot be the one who approves it." */
  requireSeparateApprover: boolean("require_separate_approver").notNull().default(true),
  /** "Nothing may be scheduled inside a freeze without a written exception." */
  enforceFreezeCalendar: boolean("enforce_freeze_calendar").notNull().default(false),
  /** "Run first, approve retrospectively within 24 hours." */
  allowEmergencyPath: boolean("allow_emergency_path").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("portal_change_control_policy_customer_id_idx").on(t.customerId),
]);

export type PortalChangeControlPolicy = typeof portalChangeControlPolicyTable.$inferSelect;
export type InsertPortalChangeControlPolicy = typeof portalChangeControlPolicyTable.$inferInsert;

/** The two enforcement levels for the RACI acceptance gate (#2162, redo of
 *  #1518). "strict" is #1518's original behaviour — every A/R cell must be
 *  accepted before it counts. "loose" (the default) is the pre-gate de facto
 *  behaviour — an assignment is effective immediately, no acceptance step. */
export const OWNERSHIP_GATE_MODES = ["strict", "loose"] as const;
export type OwnershipGateMode = (typeof OWNERSHIP_GATE_MODES)[number];

/**
 * Per-customer enforcement level for the Ownership/RACI acceptance gate
 * (#2162). No row for a customer means "loose" — the default is computed at
 * read time, not backfilled, so this table starts empty for every existing
 * customer and changes nothing about their current behaviour until they
 * opt in to strict.
 */
export const portalOwnershipPolicyTable = pgTable("portal_ownership_policy", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the tables above. */
  customerId: integer("customer_id").notNull(),
  gateMode: text("gate_mode", { enum: OWNERSHIP_GATE_MODES }).notNull().default("loose"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("portal_ownership_policy_customer_id_idx").on(t.customerId),
]);

export type PortalOwnershipPolicy = typeof portalOwnershipPolicyTable.$inferSelect;
export type InsertPortalOwnershipPolicy = typeof portalOwnershipPolicyTable.$inferInsert;

/**
 * Per-workload RACI-MEMBERSHIP toggle (#1933, correcting the issue body's
 * original "tracking scope" framing per Shane's 2026-08-30 comment).
 *
 * What this is NOT: a scan/finding/alert suppressor. Untracking a workload
 * here does not stop monitoring, does not stop findings, does not stop
 * alerting — that would recreate exactly the #1563 findings-suppression
 * hazard Shane's correction explicitly ruled out. What it DOES do: remove
 * the workload from the RACI accountability matrix (`GET /portal/ownership`
 * omits it, so nobody is asked to be its A/R/C/I). A workload's `key` is one
 * of `tenant-workloads.ts`'s coarse buckets ("exchange", "sharepoint", ...),
 * not an FK — workloads are derived at read time from `tenant_service_plans`,
 * never stored as their own row (see that module's header).
 *
 * `tracked = true` (the default, no row) means "in the RACI" — the behaviour
 * every customer already has today. A customer must take a deliberate action
 * to flip a workload to `tracked = false`; that action is itself a finding
 * (an enabled, disowned workload is real attack surface — see
 * ownership-workload-membership.ts), never a silent opt-out.
 *
 * Untracking is not deletion: toggling back to `tracked = true` is a plain
 * update to the same row (upsert on the unique `(customer_id, workload_key)`
 * pair), so ownership assignment history on `portal_ownership_assignments`
 * for this workload's object id is untouched either way.
 *
 * Same shape/convention as `portalOwnershipPolicyTable` immediately above —
 * no FK (matching every portal-own* table), customer id straight off the JWT.
 */
export const portalOwnershipWorkloadMembershipTable = pgTable("portal_ownership_workload_membership", {
  id: serial("id").primaryKey(),
  /** tenants.id — the JWT's customerId claim. No FK, matching the table above. */
  customerId: integer("customer_id").notNull(),
  /** One of tenant-workloads.ts's WORKLOAD_BY_SERVICE_PLAN_NAME bucket keys. */
  workloadKey: text("workload_key").notNull(),
  tracked: boolean("tracked").notNull().default(true),
  /** users.id of whoever last changed this row, or null (system/unknown). */
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("portal_ownership_workload_membership_customer_workload_idx").on(t.customerId, t.workloadKey),
]);

export type PortalOwnershipWorkloadMembership = typeof portalOwnershipWorkloadMembershipTable.$inferSelect;
export type InsertPortalOwnershipWorkloadMembership = typeof portalOwnershipWorkloadMembershipTable.$inferInsert;

// #1759 removed `portal_change_control_approvers` (the `CC_APPROVER_BANDS`
// `normal`/`emergency` stored approver set). Approver eligibility now derives
// live from `users.can_approve_changes`; see the block comment above and
// `routes/portal-settings-change-control.ts`.

/** The notification-rules event catalogue (CC_NOTIF_SEED's seven rows, keyed) —
 *  a fixed, real vocabulary of what the platform can actually notify on. */
export const CC_NOTIF_EVENT_KEYS = [
  "ms_enforcement_approaching",
  "message_center_impact",
  "cr_raised",
  "cr_awaiting_signature",
  "cr_window_opening",
  "cr_deployed_or_rolled_back",
  "freeze_declared_or_lifted",
] as const;
export type CcNotifEventKey = (typeof CC_NOTIF_EVENT_KEYS)[number];

export const portalChangeControlNotificationsTable = pgTable("portal_change_control_notifications", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  eventKey: text("event_key", { enum: CC_NOTIF_EVENT_KEYS }).notNull(),
  /** Free text, e.g. "Email · Teams" — the design edits this as plain text, not
   *  a fixed channel enum. */
  channel: text("channel").notNull(),
  /** Free text recipient description, e.g. "The named approver". Not a person
   *  id: a notification rule names a role/audience, not a single approver. */
  recipientText: text("recipient_text").notNull(),
  /** Free text lead time, e.g. "30 days ahead, then 7, then 1". */
  leadTime: text("lead_time").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_change_control_notifications_customer_id_idx").on(t.customerId),
  uniqueIndex("portal_change_control_notifications_customer_event_idx").on(
    t.customerId,
    t.eventKey,
  ),
]);

export type PortalChangeControlNotification = typeof portalChangeControlNotificationsTable.$inferSelect;
export type InsertPortalChangeControlNotification = typeof portalChangeControlNotificationsTable.$inferInsert;

// ── Departments ────────────────────────────────────────────────────────────
//
// The department LIST and its headcounts are not stored here — they are real,
// computed live from `users.department` (already a column, `lib/db/schema/
// index.ts:117`) for this tenant's active users. This table is only the
// customer's MAPPING OVERLAY on top of that: whether a given department name
// should read from the Entra attribute (the default) or from a named security
// group, per the design's "Point a department at a security group and the
// numbers stop being indicative."

export const PORTAL_DEPARTMENT_SOURCES = ["attribute", "group"] as const;
export type PortalDepartmentSource = (typeof PORTAL_DEPARTMENT_SOURCES)[number];

/** What happens to people in neither the attribute nor the group, once a
 *  department is mapped by group — the design's own two-option choice. */
export const PORTAL_DEPARTMENT_UNMAPPED_FALLBACKS = ["unmapped", "attribute_fallback"] as const;
export type PortalDepartmentUnmappedFallback = (typeof PORTAL_DEPARTMENT_UNMAPPED_FALLBACKS)[number];

export const portalDepartmentMappingsTable = pgTable("portal_department_mappings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  /** The value exactly as it appears on `users.department` for this tenant. */
  departmentName: text("department_name").notNull(),
  source: text("source", { enum: PORTAL_DEPARTMENT_SOURCES }).notNull().default("attribute"),
  /** Set only when source = "group". The Entra object id and display name of
   *  the security group this department reads membership from. */
  securityGroupId: text("security_group_id"),
  securityGroupName: text("security_group_name"),
  unmappedFallback: text("unmapped_fallback", { enum: PORTAL_DEPARTMENT_UNMAPPED_FALLBACKS })
    .notNull()
    .default("attribute_fallback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("portal_department_mappings_customer_id_idx").on(t.customerId),
  uniqueIndex("portal_department_mappings_customer_department_idx").on(
    t.customerId,
    t.departmentName,
  ),
]);

export type PortalDepartmentMapping = typeof portalDepartmentMappingsTable.$inferSelect;
export type InsertPortalDepartmentMapping = typeof portalDepartmentMappingsTable.$inferInsert;

// ── Configuration Drift engine (#1270) ─────────────────────────────────────────
//
// The itemized backing store for the platform's `drift.*` dashboard metrics
// (declared `shape: "timeline"` in @workspace/dashboard-registry) and the
// Health page's per-setting config-drift table. Prior to this, those surfaces
// were declared/built expecting a real per-event drift history that had never
// existed anywhere in the backend — the `drift:*` metric sourceKeys pointed at
// no `monitor_checks` row and resolved to `unknown_check_key`, and the Health
// table was a hardcoded 12-row fixture (#1261, #1265, AssessmentGeneratingScreen).
//
// Two tables, one collector (artifacts/api-server/src/lib/drift-collector.ts):
//   * drift_baseline_snapshots — the last-known / signed configuration snapshot
//     per (tenant, domain). Drift is a diff of a fresh scan against the CURRENT
//     (supersededAt IS NULL) baseline. A baseline stays the reference until it
//     is explicitly re-captured (re-signed), so the drift table shows deviation
//     from an approved state rather than from the previous scan.
//   * drift_events — one row per per-setting change the collector detected
//     (what changed, old→new value, who, when, verdict, linked CR). This is the
//     itemized "what changed" history the timeline/table UIs consume.
//
// domainKey is the bare slug of a `drift:*` metric sourceKey (e.g. the metric
// drift.caPolicyDriftCount / sourceKey "drift:ca-policy" has domainKey
// "ca-policy"). Conditional Access ("ca-policy") is the first collected domain.

/**
 * Verdict for a single detected drift event, driven by attribution:
 *   - approved              — a linked change request (crRef) covers the change
 *   - attributed_unapproved — an actor is known (changedBy) but no CR covers it
 *   - unattributed          — neither actor nor CR is known (the riskiest state)
 *   - informational         — a non-security-relevant/benign change
 */
export const DRIFT_EVENT_VERDICTS = [
  "approved",
  "attributed_unapproved",
  "unattributed",
  "informational",
] as const;
export type DriftEventVerdict = (typeof DRIFT_EVENT_VERDICTS)[number];

/**
 * Lifecycle status of a drift event, driven by whether the setting currently
 * deviates from its baseline (#1290, the `drift.regression` detector):
 *   - open      — the setting is currently drifted from baseline (initial state).
 *   - resolved  — a later scan found the setting back at its baseline value; the
 *                 collector closed it (resolvedAt set).
 *   - reopened  — a previously-resolved setting drifted from baseline AGAIN. This
 *                 is the "a previously-resolved finding reappeared" regression the
 *                 idempotency key (tenant|domain|baseline|op|setting) otherwise
 *                 makes unrepresentable. reopenedAt is set, reopenCount bumped.
 */
export const DRIFT_EVENT_STATUSES = ["open", "resolved", "reopened"] as const;
export type DriftEventStatus = (typeof DRIFT_EVENT_STATUSES)[number];

export const driftBaselineSnapshotsTable = pgTable("drift_baseline_snapshots", {
  id: serial("id").primaryKey(),
  snapshotId: uuid("snapshot_id").notNull().unique().defaultRandom(),
  /** TEXT M365 tenant id (same keying as tenant_monitor_profiles). */
  tenantId: text("tenant_id").notNull(),
  /** Bare drift domain slug, e.g. "ca-policy" (metric sourceKey minus "drift:"). */
  domainKey: text("domain_key").notNull(),
  /** The captured configuration snapshot the collector diffs a fresh scan against. */
  config: jsonb("config").$type<unknown>().notNull(),
  /** True once this baseline has been explicitly approved/signed as the reference. */
  signed: boolean("signed").notNull().default(false),
  /** Who/what captured this baseline ("system" for an automated scan, or a user id). */
  capturedBy: text("captured_by"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  /** When a newer baseline replaced this one. NULL = the current reference baseline. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("drift_baseline_snapshots_tenant_domain_idx").on(t.tenantId, t.domainKey),
  index("drift_baseline_snapshots_superseded_idx").on(t.supersededAt),
]);

export type DriftBaselineSnapshot = typeof driftBaselineSnapshotsTable.$inferSelect;
export type InsertDriftBaselineSnapshot = typeof driftBaselineSnapshotsTable.$inferInsert;

export const driftEventsTable = pgTable("drift_events", {
  id: serial("id").primaryKey(),
  eventId: uuid("event_id").notNull().unique().defaultRandom(),
  tenantId: text("tenant_id").notNull(),
  domainKey: text("domain_key").notNull(),
  /**
   * Deterministic per-(baseline comparison, setting) key, so re-running the same
   * scan against the same baseline never double-inserts the same change. Format:
   * `${tenantId}|${domainKey}|${baselineSnapshotId}|${op}|${setting}`.
   */
  idempotencyKey: text("idempotency_key").notNull().unique(),
  /** The setting/path that changed, e.g. "/policies/0/state". */
  setting: text("setting").notNull(),
  /** JSON-patch style op: 'add' | 'remove' | 'replace'. */
  op: text("op").notNull(),
  oldValue: jsonb("old_value").$type<unknown>(),
  newValue: jsonb("new_value").$type<unknown>(),
  /** Attribution actor (from the tenant audit log), when known. NULL = unattributed. */
  changedBy: text("changed_by"),
  verdict: text("verdict", { enum: DRIFT_EVENT_VERDICTS }).notNull().default("unattributed"),
  /** Linked change-request reference covering this change, when one exists. */
  crRef: text("cr_ref"),
  /** The baseline snapshot this change was diffed against. */
  baselineSnapshotId: integer("baseline_snapshot_id"),
  /**
   * Lifecycle status (#1290). 'open' the moment drift is first detected; the
   * collector flips it to 'resolved' when a later scan finds the setting back at
   * baseline, and to 'reopened' if it then drifts from baseline yet again — the
   * regression the `drift.regression` detector fires on.
   */
  status: text("status", { enum: DRIFT_EVENT_STATUSES }).notNull().default("open"),
  /** When the collector last observed this setting back at its baseline value. NULL while open/reopened. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** When a previously-resolved setting drifted from baseline again (last reopen). NULL if never reopened. */
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  /** How many times this event has been reopened after resolution. */
  reopenCount: integer("reopen_count").notNull().default(0),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("drift_events_tenant_domain_idx").on(t.tenantId, t.domainKey),
  index("drift_events_tenant_detected_idx").on(t.tenantId, t.detectedAt),
  index("drift_events_tenant_status_reopened_idx").on(t.tenantId, t.status, t.reopenedAt),
]);

export type DriftEvent = typeof driftEventsTable.$inferSelect;
export type InsertDriftEvent = typeof driftEventsTable.$inferInsert;
export type InsertPortalOwnershipRow = typeof portalOwnershipRowsTable.$inferInsert;

// ── drift_collection_status (Git #1287) ──────────────────────────────────────
//
// Per (tenant, domain) record of the MOST RECENT drift-collection attempt, so a
// domain that was scanned but could not be diffed does not read as "never
// scanned". The drift engine (#1270/#1283) originally only distinguished three
// outcomes via the resolver (no baseline / clean / events); extending drift to
// every executor type (#1287) introduced a fourth, honest outcome — a scan ran
// but a stable before/after comparison genuinely could not be made this run
// (e.g. a fan-out site scan that hit its coverage cap, so the un-scanned sites
// would falsely read as removed shares). That MUST surface as a specific reason,
// not a silent gap and not a fabricated "no drift detected" — this table is
// where that reason lives, upserted on every collection attempt.
//
// status:
//   - tracked            — drift was diffed against a baseline this run (events may be 0).
//   - baseline_captured  — first scan of this domain; the baseline was captured, no events yet.
//   - not_comparable     — a scan ran but no stable diff could be made (see `reason`).
//   - error              — the collection attempt itself failed (see `reason`).
export const DRIFT_COLLECTION_STATUSES = [
  "tracked",
  "baseline_captured",
  "not_comparable",
  "error",
] as const;
export type DriftCollectionStatus = (typeof DRIFT_COLLECTION_STATUSES)[number];

export const driftCollectionStatusTable = pgTable("drift_collection_status", {
  id: serial("id").primaryKey(),
  /** TEXT M365 tenant id (same keying as drift_events / tenant_monitor_profiles). */
  tenantId: text("tenant_id").notNull(),
  /** Bare drift domain slug, e.g. "eeeu-site-sharing" (metric sourceKey minus "drift:"). */
  domainKey: text("domain_key").notNull(),
  /** The monitor_checks.key whose scan drives this domain's drift, for provenance. */
  checkKey: text("check_key"),
  status: text("status", { enum: DRIFT_COLLECTION_STATUSES }).notNull(),
  /**
   * Honest, specific human reason when status is not_comparable/error — e.g.
   * "site scan truncated at the fan-out cap (500/812 eligible sites scanned)".
   * NULL for tracked / baseline_captured (nothing to explain).
   */
  reason: text("reason"),
  /** Optional coverage/diagnostic detail (scanned/total/truncated/run status). */
  coverage: jsonb("coverage").$type<Record<string, unknown>>(),
  /** How many new drift events this run inserted (0 for clean/not_comparable). */
  eventsInserted: integer("events_inserted").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("drift_collection_status_tenant_domain_uniq").on(t.tenantId, t.domainKey),
]);

export type DriftCollectionStatusRow = typeof driftCollectionStatusTable.$inferSelect;
export type InsertDriftCollectionStatusRow = typeof driftCollectionStatusTable.$inferInsert;

// ============================================================================
// Customer-Tenant Alert Rules (Git #1278)
// ============================================================================
// The MSP-internal platform-ops alert engine (`msp_alert_rules` /
// `msp_alert_events`, evaluated by alert-engine.ts) fires on platform
// conditions — DLQ backlog, billing failure, SLA breach. It has never had any
// concept of "a condition on a CUSTOMER's monitored M365 tenant that should
// raise a customer-facing alert". This is that catalog.
//
// `customer_tenant_alert_rules` is a GLOBAL catalog — one row per alertable
// tenant condition (sign-off decision #1: one standard rule catalog, each
// customer customises their own delivery preferences on top via #1276). It is
// evaluated PER monitored tenant by customer-tenant-alert-engine.ts, which
// writes one `customer_tenant_alert_events` row per (rule × tenant) firing.
//
// Dual delivery (sign-off decision #2): a firing goes to admin (Exchange Online
// email + admin web-push, reusing the platform engine's senders) AND — once
// #1276 lands the customer Alert Preferences persistence — to the customer's own
// recipients through their chosen thresholds/digest/quiet-hours. Until #1276
// exists, each event is recorded with `customer_delivery_status = 'pending_prefs'`;
// customer-alert-delivery.ts holds the explicit seam #1276 plugs into (NOT a
// bare TODO — a real function with a fixed contract).
//
// `alert_category` is the bridge to the customer-facing 7-category taxonomy
// (alertPrefsData.ts ALERT_CATS: findings/drift/progress/reviews/remediation/
// billing/support). The customer's per-category preference (#1276) filters
// delivery; this catalog is what those categories fire FROM.
//
// `detector_status` is an honesty flag: 'live' rules read a real source today;
// 'pending_detector' rules are seeded (so the catalog ships complete, not
// partial — sign-off decision #4) but their upstream source subsystem does not
// exist yet and is tracked by its own sub-issue under #1278. The engine has a
// wired evaluator hook for every rule; a 'pending_detector' one returns 0 until
// its sub-issue lands, at which point it lights up with no engine change.

export const CUSTOMER_ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type CustomerAlertSeverity = typeof CUSTOMER_ALERT_SEVERITIES[number];

// The 7 customer-facing categories from alertPrefsData.ts (ALERT_CATS).
export const CUSTOMER_ALERT_CATEGORIES = [
  "findings",
  "drift",
  "progress",
  "reviews",
  "remediation",
  "billing",
  "support",
] as const;
export type CustomerAlertCategory = typeof CUSTOMER_ALERT_CATEGORIES[number];

// Every alertable customer-tenant condition. Plain-TEXT column with the Drizzle
// enum as TS-level narrowing only (same convention as msp_alert_rules.condition_type
// — no PG enum / CHECK, so adding a member needs no migration DDL, only a seed row).
export const CUSTOMER_ALERT_CONDITION_TYPES = [
  // findings
  "finding.new_critical",
  "finding.new_high",
  "finding.oversharing",
  "finding.mfa_gap",           // live — identity:privileged-mfa-gap monitor check (#1288)
  "finding.global_admin_added", // pending_detector — needs a GA add-event / run-delta source
  "finding.ownerless_group",
  "finding.standing_priv_role",
  // drift
  "drift.unapproved",
  "drift.ca_policy_change",
  "drift.regression",          // pending_detector — drift_events has no resolved→reopened lifecycle (#1270 follow-up)
  // progress
  "progress.fix_verified",
  "progress.pillar_score_move",
  // reviews
  "review.risk_acceptance_due",
  "review.policy_review_due",
  // remediation
  "remediation.scan_complete",
  "remediation.phase_gate_verified",
  "remediation.task_awaiting_customer",
  // billing
  "billing.sow_signed",
  "billing.invoice_issued",
  "billing.license_change",    // pending_detector — no licence-assignment table/event exists yet
  "billing.renewal_approaching",
  "billing.payment_failed",
  // support
  "support.ticket_updated",
] as const;
export type CustomerAlertConditionType = typeof CUSTOMER_ALERT_CONDITION_TYPES[number];

export const CUSTOMER_ALERT_DETECTOR_STATUS = ["live", "pending_detector"] as const;
export type CustomerAlertDetectorStatus = typeof CUSTOMER_ALERT_DETECTOR_STATUS[number];

export const customerTenantAlertRulesTable = pgTable("customer_tenant_alert_rules", {
  id: serial("id").primaryKey(),
  // Stable unique key; equals the condition type for the seeded catalog rows.
  ruleKey: text("rule_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  conditionType: text("condition_type", { enum: CUSTOMER_ALERT_CONDITION_TYPES }).notNull(),
  // Bridge to the customer-facing 7-category taxonomy (#1276).
  alertCategory: text("alert_category", { enum: CUSTOMER_ALERT_CATEGORIES }).notNull(),
  // Count-based fire test: fire when the evaluated value >= threshold.
  threshold: integer("threshold").notNull().default(1),
  // Poll lookback window in minutes for "recent" detection.
  windowMinutes: integer("window_minutes").notNull().default(1440),
  severity: text("severity", { enum: CUSTOMER_ALERT_SEVERITIES }).notNull().default("warning"),
  enabled: boolean("enabled").notNull().default(true),
  // Admin (dual-delivery) channels — reuse the platform engine's senders.
  deliveryAdminEmail: boolean("delivery_admin_email").notNull().default(true),
  deliveryAdminPush: boolean("delivery_admin_push").notNull().default(true),
  // Whether a firing should ALSO be delivered to the customer via #1276's
  // preference layer (the seam). Almost always true; false for admin-only ops.
  notifyCustomer: boolean("notify_customer").notNull().default(true),
  // Per (rule × tenant) minimum gap between re-alerts (dedup window).
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  // Customer portal deep-link (e.g. /portal/<slug>/health). Interpolated per tenant.
  deepLinkPath: text("deep_link_path"),
  // Admin Panel deep-link for the admin copy of the alert.
  adminDeepLinkPath: text("admin_deep_link_path"),
  // 'live' = reads a real source today; 'pending_detector' = catalog row present
  // but its source subsystem is tracked by a sub-issue and not wired yet.
  detectorStatus: text("detector_status", { enum: CUSTOMER_ALERT_DETECTOR_STATUS }).notNull().default("live"),
  // Free-text provenance note (which table/metric supplies this condition).
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("customer_tenant_alert_rules_condition_type_idx").on(t.conditionType),
  index("customer_tenant_alert_rules_category_idx").on(t.alertCategory),
  index("customer_tenant_alert_rules_enabled_idx").on(t.enabled),
]);

export type CustomerTenantAlertRule = typeof customerTenantAlertRulesTable.$inferSelect;
export type InsertCustomerTenantAlertRule = typeof customerTenantAlertRulesTable.$inferInsert;

export const customerTenantAlertEventsTable = pgTable("customer_tenant_alert_events", {
  id: serial("id").primaryKey(),
  alertEventId: uuid("alert_event_id").notNull().unique().defaultRandom(),
  ruleId: integer("rule_id").notNull().references(() => customerTenantAlertRulesTable.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  alertCategory: text("alert_category", { enum: CUSTOMER_ALERT_CATEGORIES }).notNull(),
  severity: text("severity", { enum: CUSTOMER_ALERT_SEVERITIES }).notNull(),
  // Tenant scoping — a firing is always about ONE monitored tenant.
  customerId: integer("customer_id").notNull(), // tenants.id (JWT customerId)
  mspId: integer("msp_id"),
  tenantId: text("tenant_id"),                  // M365 tenant GUID
  conditionValue: integer("condition_value").notNull(),
  summary: text("summary").notNull(),
  deepLinkPath: text("deep_link_path"),
  adminDeepLinkPath: text("admin_deep_link_path"),
  // Admin dual-delivery tracking.
  deliveredAdminEmail: boolean("delivered_admin_email").notNull().default(false),
  deliveredAdminPush: boolean("delivered_admin_push").notNull().default(false),
  // Customer-delivery seam (#1276). 'pending_prefs' until the customer Alert
  // Preferences persistence exists to route/filter it; 'delivered' / 'suppressed'
  // (by the customer's own threshold/quiet-hours) / 'skipped' (notifyCustomer=false)
  // once #1276's delivery worker consumes it.
  customerDeliveryStatus: text("customer_delivery_status").notNull().default("pending_prefs"),
  customerDeliveredAt: timestamp("customer_delivered_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by"),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("customer_tenant_alert_events_rule_id_idx").on(t.ruleId),
  index("customer_tenant_alert_events_customer_fired_idx").on(t.customerId, t.firedAt),
  index("customer_tenant_alert_events_tenant_idx").on(t.tenantId),
  index("customer_tenant_alert_events_fired_at_idx").on(t.firedAt),
  index("customer_tenant_alert_events_delivery_idx").on(t.customerDeliveryStatus),
]);

export type CustomerTenantAlertEvent = typeof customerTenantAlertEventsTable.$inferSelect;
export type InsertCustomerTenantAlertEvent = typeof customerTenantAlertEventsTable.$inferInsert;

// ============================================================================
// Customer Portal Alert Preferences (Git #1276)
// ============================================================================
// Real storage for the customer portal's Alert Preferences page
// (portal-v2-alert-preferences.tsx / alertPrefsData.ts). Confirmed decision (a)
// from the original #1236 finding: a NEW taxonomy, not folded into the existing
// 15-technical-category `customer_notification_preferences` (that table stays
// exactly as-is for the Notification Center bell — genuinely non-overlapping).
//
// Scoped by `customerId` (tenants.id, the JWT customerId) — not by individual
// portal user — because alerts are about ONE monitored tenant and any portal
// user for that tenant edits the same shared profile, matching
// CustomerAlertPreferenceProfile in customer-alert-delivery.ts (the #1278 seam
// this schema now backs). The primary recipient ("you") is never a stored row —
// it is always the requesting user's own account; `customer_alert_recipients`
// holds only the additional ones the design's "Add recipient" adds.
//
// `threshold` is a category-specific sensitivity key (e.g. "critical" for
// findings, "worse" for drift, "mine" for support) — plain TEXT, not a shared
// enum, because the valid set differs per category (see alertPrefsData.ts
// ALERT_CATS[].thresholds). Validated app-side, same convention as
// customer_tenant_alert_rules.condition_type (no CHECK — widening needs no DDL).

export const CUSTOMER_ALERT_DIGEST_MODES = ["immediate", "daily", "weekly"] as const;
export type CustomerAlertDigestMode = typeof CUSTOMER_ALERT_DIGEST_MODES[number];

export const CUSTOMER_ALERT_PRESETS = ["close", "balanced", "quiet", "custom"] as const;
export type CustomerAlertPreset = typeof CUSTOMER_ALERT_PRESETS[number];

// One row per (customer, category) — mirrors the page's per-category AlertPref
// (on/email/mode/threshold). Absence of a row for a category means the page's
// own Balanced-preset default, same "unset = default" convention as
// customer_notification_preferences.
export const customerAlertPreferencesTable = pgTable("customer_alert_preferences", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  category: text("category", { enum: CUSTOMER_ALERT_CATEGORIES }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  mode: text("mode", { enum: CUSTOMER_ALERT_DIGEST_MODES }).notNull().default("immediate"),
  threshold: text("threshold").notNull().default("any"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("customer_alert_prefs_customer_category_uidx").on(t.customerId, t.category),
]);

export type CustomerAlertPreference = typeof customerAlertPreferencesTable.$inferSelect;
export type InsertCustomerAlertPreference = typeof customerAlertPreferencesTable.$inferInsert;

// One row per customer — page-level quiet hours + which posture preset is active.
export const customerAlertSettingsTable = pgTable("customer_alert_settings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  activePreset: text("active_preset", { enum: CUSTOMER_ALERT_PRESETS }).notNull().default("balanced"),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(true),
  quietHoursFrom: text("quiet_hours_from").notNull().default("19:00"),
  quietHoursTo: text("quiet_hours_to").notNull().default("07:30"),
  quietBreakForCritical: boolean("quiet_break_for_critical").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id),
});

export type CustomerAlertSettings = typeof customerAlertSettingsTable.$inferSelect;
export type InsertCustomerAlertSettings = typeof customerAlertSettingsTable.$inferInsert;

// Additional recipients beyond the logged-in user (design's "Who else gets
// these" list). `scopeCategories = NULL` means "all categories" — the design's
// primary recipient row; a non-primary recipient can be scoped to a subset.
export const customerAlertRecipientsTable = pgTable("customer_alert_recipients", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  scopeCategories: text("scope_categories").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("customer_alert_recipients_customer_email_uidx").on(t.customerId, t.email),
]);

export type CustomerAlertRecipientRow = typeof customerAlertRecipientsTable.$inferSelect;
export type InsertCustomerAlertRecipientRow = typeof customerAlertRecipientsTable.$inferInsert;

// Digest batching (mode = daily/weekly) AND the quiet-hours hold ("Anything
// raised during quiet hours is sent in one email when the window closes") share
// this one queue, discriminated by `holdReason`. Drained by
// customer-alert-digest.ts on the same 5-minute pass evaluateCustomerTenantRules
// rides (Git #1278's alert_evaluate_rules workflow node).
export const CUSTOMER_ALERT_HOLD_REASONS = ["daily", "weekly", "quiet_hours"] as const;
export type CustomerAlertHoldReason = typeof CUSTOMER_ALERT_HOLD_REASONS[number];

export const customerAlertDigestQueueTable = pgTable("customer_alert_digest_queue", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => customerTenantAlertEventsTable.id, { onDelete: "cascade" }),
  alertCategory: text("alert_category", { enum: CUSTOMER_ALERT_CATEGORIES }).notNull(),
  severity: text("severity", { enum: CUSTOMER_ALERT_SEVERITIES }).notNull(),
  summary: text("summary").notNull(),
  deepLinkPath: text("deep_link_path"),
  holdReason: text("hold_reason", { enum: CUSTOMER_ALERT_HOLD_REASONS }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  digestBatchId: uuid("digest_batch_id"),
}, (t) => [
  index("customer_alert_digest_queue_due_idx").on(t.dueAt),
  index("customer_alert_digest_queue_customer_pending_idx").on(t.customerId, t.sentAt),
]);

export type CustomerAlertDigestQueueRow = typeof customerAlertDigestQueueTable.$inferSelect;
export type InsertCustomerAlertDigestQueueRow = typeof customerAlertDigestQueueTable.$inferInsert;

// ── Retainer Hours (AdminV2 "My Architect" ledger) ────────────────────────────
//
// The real source for the customer-facing Retainer page (Git #1285). The
// customer page (msp-portal `retainerData.ts`) shipped as a FIXTURE only —
// no retainer-hours ledger existed anywhere in the repo. These two tables are
// that greenfield ledger, keyed the same way every other customer-scoped table
// here is: `customer_id` is a `tenants.id` (the JWT `customerId` claim),
// carried WITHOUT a foreign key to match `remediation_tracker_steps` /
// `msp_diagnostic_runs`. `msp_id` is carried alongside so an MSP-console read
// can scope by MSP without a second lookup, and mirrors the `mspChangeRequests`
// scoping pair.
//
// WHY HOURS ARE STORED AS INTEGER MINUTES: retainer time is logged per work
// item as a running total in half-hour-ish granularity ("running total rather
// than per-minute tracking" — RET_TERMS), never as a currency-precision
// decimal. Integer minutes (0.5h = 30) keeps the arithmetic exact and sidesteps
// the drizzle `numeric` → JS-string read-back gotcha every `numeric` consumer in
// this repo has to coerce around. The API layer divides by 60 for display.

// One row per customer — the retainer's monthly hour allotment + rate. Retained
// hours default to 8.0 (480 min) at $300/hr, matching the design's own headline
// terms, but are per-customer so a different band can be sold without code.
export const retainerSettingsTable = pgTable("retainer_settings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The retainer's monthly allotment, in minutes. 480 = 8.0 hours. */
  retainedMinutesPerMonth: integer("retained_minutes_per_month").notNull().default(480),
  /** Equivalent hourly rate, in cents. 30000 = $300/hr. */
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(30000),
  /** Named architect on the retainer, e.g. "Priya Raman · M365 Architect". */
  architectName: text("architect_name"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("retainer_settings_customer_uidx").on(t.customerId),
  index("retainer_settings_msp_id_idx").on(t.mspId),
]);

export type RetainerSettingsRow = typeof retainerSettingsTable.$inferSelect;
export type InsertRetainerSettingsRow = typeof retainerSettingsTable.$inferInsert;

// The work-log ledger — RET_WORK. Every hour Shane logs against a customer's
// retainer, from either entry path:
//   • source = 'change_control' | 'remediation_tracker' — logged automatically
//     as a BYPRODUCT when Shane closes/resolves a tracked item. `sourceRefId`
//     is that item's id (a msp_change_requests.id, or a
//     remediation_tracker_steps.id). The (source, sourceRefId) unique index
//     makes the byproduct write idempotent: closing the same CR twice never
//     double-logs.
//   • source = 'unscoped' — the lightweight "log ad-hoc hours" path for work
//     NOT tied to a tracked item (building a workflow, misc assistance).
//     `sourceRefId` is NULL, and Postgres treats NULLs as distinct in a unique
//     index, so any number of unscoped rows coexist.
export const RETAINER_WORK_SOURCES = ["change_control", "remediation_tracker", "unscoped"] as const;
export type RetainerWorkSource = typeof RETAINER_WORK_SOURCES[number];

// Stored lowercase; the customer page's display vocabulary is
// "In progress" | "Closed" | "In review" | "Scheduled" (RetWorkState). Plain
// text with no CHECK, the same convention every other enum-ish column here
// follows, so the vocabulary can widen in code without a migration.
export const RETAINER_WORK_STATES = ["in_progress", "closed", "in_review", "scheduled"] as const;
export type RetainerWorkState = typeof RETAINER_WORK_STATES[number];

export const retainerWorkLogTable = pgTable("retainer_work_log", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  /** The month bucket this entry counts against, "YYYY-MM" (e.g. "2026-08"). */
  periodMonth: text("period_month").notNull(),
  /** ISO week label, "W34". Defaults from `occurredAt` but is editable. */
  weekLabel: text("week_label"),
  /** What was done — the work-item description. */
  item: text("item").notNull(),
  /** Time spent, in minutes. 30 = 0.5h. */
  minutes: integer("minutes").notNull().default(0),
  /** Health / Compliance / Governance / Security / Adoption — free text. */
  pillar: text("pillar"),
  /** The finding this closed, e.g. "HLT-02". NULL for work not tied to one. */
  finding: text("finding"),
  /** The outcome / result text shown on the customer's weekly report. */
  outcome: text("outcome"),
  state: text("state", { enum: RETAINER_WORK_STATES }).notNull().default("in_progress"),
  source: text("source", { enum: RETAINER_WORK_SOURCES }).notNull(),
  /** msp_change_requests.id or remediation_tracker_steps.id; NULL when unscoped. */
  sourceRefId: integer("source_ref_id"),
  /** users.id of whoever logged it. NULL for rows written by automation. */
  loggedByUserId: integer("logged_by_user_id"),
  /** When the work actually happened (drives period/week defaults). */
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("retainer_work_log_customer_period_idx").on(t.customerId, t.periodMonth),
  index("retainer_work_log_msp_id_idx").on(t.mspId),
  // Idempotency for the byproduct hooks. NULL sourceRefId (unscoped) rows are
  // distinct under a Postgres unique index, so this constrains only the two
  // tracker-derived sources to one row per closed item.
  uniqueIndex("retainer_work_log_source_ref_uidx").on(t.source, t.sourceRefId),
]);

export type RetainerWorkLogRow = typeof retainerWorkLogTable.$inferSelect;
export type InsertRetainerWorkLogRow = typeof retainerWorkLogTable.$inferInsert;

/**
 * #1793 — the app-only PowerShell capability survey.
 *
 * The platform has always known which cmdlets it CHOSE to wire into
 * `monitor_checks`. It has never known which of the several hundred cmdlets
 * `ExchangeOnlineManagement` / `MicrosoftTeams` actually export survive
 * app-only certificate authentication through `ca-ps-execution`. Microsoft's
 * own documentation describes delegated behaviour, and app-only support
 * differs cmdlet by cmdlet, so that question is only answerable by running
 * them — which is what these two tables record.
 *
 * These are a MEASUREMENT of the execution surface, deliberately NOT a
 * decision about it: #1793's explicit non-goal is that no `monitor_checks` row
 * is derived from a survey. Cataloguing what works and choosing what to check
 * are separate decisions, and the second waits for the resource model (#1795),
 * which reads `property_names` off these rows.
 */
export const PS_CAPABILITY_SURVEY_SESSION_TYPES = ["exchange", "compliance", "teams"] as const;

/**
 * The per-cmdlet outcome vocabulary. The first seven values are #1793's own
 * list, used literally. `cmdlet_unavailable` is an eighth, added because the
 * container ALREADY distinguishes it as a first-class failure kind (#250,
 * `PsExecutionError.kind`): a real `CommandNotFoundException` means the cmdlet
 * was never registered into this tenant's session at all — a licensing or
 * role-provisioning gap — which is a materially different finding from a
 * cmdlet that ran and was refused (`access_denied`) or that threw (`error`).
 * Collapsing it into `error` would delete a distinction the container went to
 * real trouble to establish.
 */
export const PS_CAPABILITY_SURVEY_STATUSES = [
  "ok",
  "auth_failed",
  "access_denied",
  "not_supported_app_only",
  "throttled",
  "error",
  "not_attempted",
  "cmdlet_unavailable",
] as const;

export const PS_CAPABILITY_SURVEY_RUN_STATUSES = ["running", "completed", "failed"] as const;

/**
 * Git #1853 — the epistemic label for a shape that did NOT come from this survey's
 * own live execution. Deliberately one member: `property_names` non-null already
 * means "observed live" without needing a value to say so, so the only state this
 * column ever needs to distinguish is "derived, not observed" — never collapsed
 * into the live column, per Shane's decision on #1853 (option 2, DSC-derived,
 * distinctly labelled). Mirrors `SNAPSHOT_SHAPE_PROVENANCE` in config-snapshots.ts.
 */
export const PS_SURVEY_SHAPE_DERIVATION = ["derived_from_dsc"] as const;
export type PsSurveyShapeDerivation = typeof PS_SURVEY_SHAPE_DERIVATION[number];

/** One execution of the survey against one tenant, through one container revision. */
export const psCapabilitySurveyRunsTable = pgTable("ps_capability_survey_runs", {
  id: serial("id").primaryKey(),
  /** tenants.id of the surveyed tenant — always a testbed tenant (the route's #965 gate). */
  customerId: integer("customer_id").notNull(),
  /** The org actually handed to Connect-*, as the SERVER resolved it (never a caller value). */
  organization: text("organization").notNull(),
  /**
   * The ps-execution container revision that served the run, read from its own
   * /healthz. Load-bearing: a survey result is only meaningful against the code
   * that produced it, and #1434's failure mode was verifying against a stale
   * revision.
   */
  containerRevision: text("container_revision"),
  containerImage: text("container_image"),
  status: text("status", { enum: PS_CAPABILITY_SURVEY_RUN_STATUSES }).notNull().default("running"),
  /** Honest free text: what was skipped, what blocked, what is a known unknown. */
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("ps_capability_survey_runs_customer_idx").on(t.customerId),
  index("ps_capability_survey_runs_started_idx").on(t.startedAt),
]);

/** One cmdlet, one session type, one run. */
export const psCapabilitySurveyResultsTable = pgTable("ps_capability_survey_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => psCapabilitySurveyRunsTable.id, { onDelete: "cascade" }),
  /** Which Connect-* session the cmdlet was reached through — the thing being measured. */
  sessionType: text("session_type", { enum: PS_CAPABILITY_SURVEY_SESSION_TYPES }).notNull(),
  /** The real module the command was enumerated from, e.g. a `tmpEXO_*` session module. */
  moduleName: text("module_name"),
  cmdletName: text("cmdlet_name").notNull(),
  verb: text("verb"),
  noun: text("noun"),
  commandType: text("command_type"),
  status: text("status", { enum: PS_CAPABILITY_SURVEY_STATUSES }).notNull(),
  /** Why a `not_attempted` cmdlet was never run — the literal read-safety gate that rejected it. */
  reason: text("reason"),
  /** The VERBATIM exception message on a failure. Never paraphrased. */
  errorMessage: text("error_message"),
  itemCount: integer("item_count"),
  elapsedMs: integer("elapsed_ms"),
  /** Exactly how the survey invoked it, e.g. "-ResultSize 5" or "(no parameters)". */
  invokedWith: text("invoked_with"),
  /** .NET type name of the first returned object. */
  outputTypeName: text("output_type_name"),
  /**
   * The real output SHAPE — property NAMES only, never values (the surveyed
   * tenant is a real production tenant). This is the column #1795's resource
   * model reads; an `ok` row with a null here has not actually been surveyed.
   */
  propertyNames: jsonb("property_names").$type<string[]>(),
  supportsShouldProcess: boolean("supports_should_process"),
  minMandatoryParamCount: integer("min_mandatory_param_count"),
  mandatoryParamNames: jsonb("mandatory_param_names").$type<string[]>(),
  parameterCount: integer("parameter_count"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),

  /**
   * Git #1853 — a property set for an `ok` cmdlet whose `property_names` is null
   * (the tenant genuinely has zero instances, so nothing was there to read a shape
   * off). Sourced from Microsoft365DSC's own resource definitions (matched via
   * `config_resources.read_cmdlets`, Shane's recorded decision on #1853), never
   * inferred from a similarly-named cmdlet. NULL means either `property_names` is
   * already populated (nothing to derive) or no DSC match was found — see
   * `derivation_gap_reason` for the latter. `derive-ps-shapes-from-dsc.mjs` is the
   * only writer; it never touches `property_names` itself.
   */
  derivedPropertyNames: jsonb("derived_property_names").$type<string[]>(),
  /** Which `config_resources.resource_key`(s) the derived property set came from. */
  derivedFromM365dscResources: jsonb("derived_from_m365dsc_resources").$type<string[]>(),
  /** Always `derived_from_dsc` when `derived_property_names` is set — see the type comment. */
  shapeDerivation: text("shape_derivation", { enum: PS_SURVEY_SHAPE_DERIVATION }),
  /**
   * Why an `ok`, still-shapeless cmdlet has no derived shape either: no
   * Microsoft365DSC resource declares it as a read cmdlet, or the resource(s) that
   * do declare it publish zero non-connection properties. A recorded gap, not a
   * silent omission — Shane's #1853 instruction.
   */
  derivationGapReason: text("derivation_gap_reason"),
  shapeDerivedAt: timestamp("shape_derived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("ps_capability_survey_results_run_session_cmdlet_uidx").on(t.runId, t.sessionType, t.cmdletName),
  index("ps_capability_survey_results_status_idx").on(t.status),
  index("ps_capability_survey_results_cmdlet_idx").on(t.cmdletName),
]);

export type PsCapabilitySurveyRun = typeof psCapabilitySurveyRunsTable.$inferSelect;
export type InsertPsCapabilitySurveyRun = typeof psCapabilitySurveyRunsTable.$inferInsert;
export type PsCapabilitySurveyResult = typeof psCapabilitySurveyResultsTable.$inferSelect;
export type InsertPsCapabilitySurveyResult = typeof psCapabilitySurveyResultsTable.$inferInsert;

/**
 * policy_decisions (Git #2024) — Policy Decisions' OWN table, own primary key,
 * own lifecycle. Decided on #1528 (2026-08-31): a policy decision and a risk
 * decision looked like the same shape, but #1528 settled that they are two
 * objects that will grow divergent fields — split now rather than unwind a
 * shared table later. Do NOT fold this back into `mspRiskDecisionsTable` as a
 * `decisionState` discriminator; that was the option #1528 explicitly rejected.
 *
 * This table's own create path can start from "we've decided X" with no risk
 * or finding required first (#1528) — unlike `msp_risk_decisions`, which only
 * ever gets a row from a raised liability. There is deliberately no unsigned
 * intermediate state: a row here IS a signed decision from the moment it
 * exists, created by the one combined create/sign-off endpoint
 * (`portal-policy-decisions.ts`) — matching the "Sign it off" form's own
 * fields (owner / review cadence / compensating control) plus the signature
 * fields the Risk Register's accept flow already established (typed name,
 * server-set timestamp, statement, IP + hash for the same audit rigor).
 *
 * `decisionState`/`reviewState` reuse the exact vocabularies `msp_risk_decisions`
 * already defined for this same concept (POLICY_DECISION_STATES /
 * RISK_REVIEW_STATES below) — these are genuinely the same operational
 * lanes, not a coincidence to preserve, so there is no reason to mint new enum
 * values that mean the same thing.
 *
 * ── A THIRD clock: dependency-based clearance (#1526) ──────────────────────
 * `reviewCadence` / `reviewState` / `reviewDueAt` are the DATE clock — due on a
 * schedule, and #1513's alert fires when it lapses. Some decisions clear on a
 * **dependency resolving**, not a date arriving (example from #1526: "Guest
 * access reviews deferred until the Entra P2 licences land"). That has no
 * meaningful lapse — it is correct until the dependency resolves, however long
 * that takes — so it must not be forced into the date clock by manufacturing an
 * arbitrary review date, and it is NOT the acceptance/review split either
 * (#1507): it is a genuinely third, independent condition.
 *
 * `clearanceCondition` (below) is what makes a row dependency-based rather than
 * date-based; the two clocks are mutually exclusive on one row (enforced by the
 * `policy_decisions_review_xor_clearance_chk` CHECK added in
 * `2026-08-31-policy-decision-dependency-clearance-1526.sql`) — `reviewCadence`
 * is therefore nullable, not required, unlike every other column authored at
 * create time.
 */
export const CLEARANCE_TRIGGER_TYPES = ["license_sku", "manual"] as const;
export type PolicyClearanceTriggerType = (typeof CLEARANCE_TRIGGER_TYPES)[number];

/** #2518 — Shane decided Option A: `reviewCadence` is a fixed enum, not free
 * text (carried forward from #2092, which left this genuinely open — see the
 * column's own comment below for the "no fixed vocabulary" state that decided
 * against). Anything outside this set is rejected at create time (400), never
 * silently accepted with a null `reviewDueAt`. */
export const REVIEW_CADENCES = ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Biennial"] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

export const policyDecisionsTable = pgTable("policy_decisions", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),

  title: text("title").notNull(),
  /** The cited authority this decision is a documented deviation from, e.g.
   * "GDPR Art. 5(1)(e)". Free text at the citation level — the create form's
   * own field — kept even once `obligationId` below is set, since the form
   * still captures the citation as typed. */
  obligation: text("obligation").notNull(),
  /** The cited authority as a first-class reference (Git #1525) —
   * `compliance_obligations.id` — rather than only the free-text citation
   * above. Null when the decision cites an authority with no catalog match. */
  obligationId: integer("obligation_id").references(() => complianceObligationsTable.id, { onDelete: "set null" }),
  pillar: text("pillar"),

  owner: text("owner").notNull(),
  /** RACI person key behind `owner`, matching the Risk Register's ownership chips. */
  ownerId: text("owner_id"),
  /** The "Sign it off" form's own `review` field — a cadence, not a date.
   * REVIEW_CADENCES (#2518, Shane decided Option A — fixed enum, superseding
   * the earlier free-text state #2092 left open). NULL for a dependency-based
   * decision (#1526) — see `clearanceCondition` below; a decision carries
   * exactly one of the two clocks, never both. */
  reviewCadence: text("review_cadence", { enum: REVIEW_CADENCES }),
  /** The "Sign it off" form's own `control` field. */
  compensatingControl: text("compensating_control").notNull(),

  /** POLICY_DECISION_STATES. Starts `live` — a signed decision is live the
   * moment it's created; there is no unsigned `proposed` row on this table.
   * Kept in sync with `reviewState` by alert-engine.ts's
   * `advancePolicyReviewClock` (#1527): `due` mirrors a due review, `overdue`
   * collapses back to `live` — the decision never itself shows as lapsed. */
  decisionState: text("decision_state").notNull().default("live"),
  /** RISK_REVIEW_STATES. Starts `on_track` for a date-based decision.
   * `reviewDueAt` is computed at create time (#2518) from `reviewCadence` +
   * `createdAt` as the anchor — Monthly=+1mo, Quarterly=+3mo, Semi-Annual=
   * +6mo, Annual=+12mo, Biennial=+24mo (`portal-policy-decisions.ts`'s create
   * route). Once set, advanced by alert-engine.ts's `advancePolicyReviewClock`
   * (#1527), which also feeds the `policy_review_overdue` alert to the MSP.
   * NULL — not `on_track`, and never defaulted — for a dependency-based
   * decision (#1526): a dependency has no "on track/due/overdue" reading, so
   * forcing this vocabulary onto it would manufacture a false operational
   * state, and `advancePolicyReviewClock` never touches a row with
   * `review_due_at IS NULL` (every dependency-based row), so the two clocks
   * stay genuinely independent on one table. */
  reviewState: text("review_state"),
  reviewDueAt: timestamp("review_due_at", { withTimezone: true }),

  // ── Dependency-based clearance — the third clock (#1526) ──────────────────
  /** The dependency in plain language, e.g. "Entra P2 licences land". Non-null
   * is what makes this row dependency-based rather than date-based; NULL for
   * every ordinary date-cycled decision. */
  clearanceCondition: text("clearance_condition"),
  /** CLEARANCE_TRIGGER_TYPES. `license_sku` — the platform can observe this
   * itself (a licence appearing in the tenant, via the already-collected
   * `/subscribedSkus` data — see `advancePolicyClearances()` in
   * `alert-engine.ts`). `manual` — nothing observable exists; only a human
   * mark-resolved (`PATCH .../clearance/resolve`) can clear it. NULL unless
   * `clearanceCondition` is set. */
  clearanceTriggerType: text("clearance_trigger_type", { enum: CLEARANCE_TRIGGER_TYPES }),
  /** The `skuPartNumber` to watch for when `clearanceTriggerType = 'license_sku'`
   * (e.g. "AAD_PREMIUM_P2"). NULL otherwise. */
  clearanceTriggerSkuPartNumber: text("clearance_trigger_sku_part_number"),
  /** When the dependency actually resolved — set by `advancePolicyClearances()`
   * for an observed trigger, or by the manual mark-resolved endpoint. NULL
   * while still pending. Non-null is what makes the decision "actionable
   * immediately" per #1526, rather than waiting on the next scheduled review
   * (there is no scheduled review on this clock to wait for). */
  clearanceResolvedAt: timestamp("clearance_resolved_at", { withTimezone: true }),
  /** How it resolved — the auto-detection message ("Auto-detected: AAD_PREMIUM_P2
   * present in tenant, collected <date>.") or the human's own note on a manual
   * mark-resolved. NULL while unresolved. */
  clearanceResolvedNote: text("clearance_resolved_note"),

  /** The name the customer TYPED at sign-off — same rigor as
   * `msp_risk_decisions.clientApprover.name` / the accept flow's `fullName`. */
  signedBy: text("signed_by").notNull(),
  /** Server clock, never the client's — same guarantee as `acceptedAt`. */
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  /** The exact confirmation sentence typed at sign-off, snapshotted so a later
   * reword of the copy cannot rewrite what was agreed to. */
  statement: text("statement").notNull(),
  /** Same known limitation as `msp_risk_decisions.clientApprover.ipAddress`:
   * behind Replit's proxy with no `trust proxy` configured, this is the
   * proxy's loopback hop, not the customer's real address, until that app-wide
   * setting is made. Recorded anyway — absent would be worse — but nothing
   * should be inferred from it today. */
  ipAddress: text("ip_address"),
  signatureHash: text("signature_hash").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("policy_decisions_msp_id_idx").on(t.mspId),
  index("policy_decisions_tenant_id_idx").on(t.tenantId),
  index("policy_decisions_msp_tenant_idx").on(t.mspId, t.tenantId),
  index("policy_decisions_obligation_id_idx").on(t.obligationId),
]);

export type PolicyDecision = typeof policyDecisionsTable.$inferSelect;
export type InsertPolicyDecision = typeof policyDecisionsTable.$inferInsert;

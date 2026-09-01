import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb, bigint, uniqueIndex, uuid, primaryKey, index, date, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { mspsTable, tenantsTable } from "./msp";

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  priceAdjustment: number;
}

export interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

// ── MSP User Role Hierarchy ────────────────────────────────────────────────────
//
// PlatformAdmin  — full platform access, cross-MSP
// MSPAdmin       — full access within their MSP
// MSPOperator    — operational access within their MSP (no billing/settings)
// CustomerUser   — access to their own customer portal
// ServiceAccount — API key / machine identity
// Free           — gates to free-assessment results only; upgrade flips to CustomerUser
// Assessment     — assessment-experience customer (free OR paid tier). Same
//                  privilege floor as Free (below CustomerUser): may view their
//                  own assessment results/SOW, but never tenant-wide dashboards,
//                  engines, signals, workflows, or monitoring. New assessment
//                  signups use this role; existing Free rows are left as-is and
//                  treated identically everywhere Free is checked.
//
// Defined here (not in ./msp) because usersTable's enum use below is eager and
// the msp.ts ↔ index.ts circular import would TDZ-crash on a cross-module read.

export const MSP_ROLES = ["PlatformAdmin", "MSPAdmin", "MSPOperator", "CustomerUser", "ServiceAccount", "Free", "Assessment"] as const;
export type MspRole = typeof MSP_ROLES[number];

// The SINGLE users table (Tenant/User Refactor Phase 0, #92/#93): auth identity
// plus everything the retired msp_users 1:1 extension row used to carry.
// Scope invariant is enforced by the users_role_scope_check CHECK below —
// tenant-scoped roles need tenantId, MSP-scoped roles need mspId,
// PlatformAdmin needs neither.
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "client"] }).notNull().default("client"),
  name: text("name"),
  company: text("company"),
  phone: text("phone"),
  address: text("address"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  sharepointSiteUrl: text("sharepoint_site_url"),
  sharepointSiteId: text("sharepoint_site_id"),
  onboardingWizardCompletedAt: timestamp("onboarding_wizard_completed_at"),
  quickWinCompletedAt: timestamp("quick_win_completed_at"),
  linkedLeadId: integer("linked_lead_id"),
  // Zoho CRM Contact id (#83) — bare pointer, deliberately the same shape as
  // linkedLeadId above: no FK, since the referenced record lives in Zoho, not
  // in this database. Zoho record ids are 18-19 digit numeric strings, so this
  // is text despite linkedLeadId being an integer.
  //
  // Once this is set, the contact/company columns above (name, company, phone,
  // address*) are a Zoho-fed read cache: new writes to them arrive via the
  // zoho_webhook receiver, not local forms. They are NOT removed here —
  // removal is #84's job, gated on a real usage audit.
  zohoContactId: text("zoho_contact_id"),
  // Zoho Books Contact id (#87) — deliberately separate from zohoContactId
  // above: CRM and Books are different Zoho products with different record
  // spaces, so a CRM Contact id is not a valid Books Contact id (or vice
  // versa). Nullable, populated on first zoho_books_upsert_contact sync.
  zohoBooksContactId: text("zoho_books_contact_id"),
  // Zoho Desk Contact id (#89) — deliberately separate from zohoContactId
  // (CRM) and zohoBooksContactId (Books) above: Desk is a distinct Zoho
  // product with its own record space. Nullable, populated on first
  // zoho_desk_upsert_contact sync (support-chat escalation or a manual node).
  zohoDeskContactId: text("zoho_desk_contact_id"),
  pinnedNavItems: jsonb("pinned_nav_items").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── absorbed from msp_users (Phase 0) ──────────────────────────────────────
  mspRole: text("msp_role", { enum: MSP_ROLES }).notNull().default("Free"),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "restrict" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  // Grants a non-MSPAdmin team member permission to approve/reject pending
  // purchase-charge approvals for their MSP. MSPAdmin can always approve
  // regardless of this flag. Checked live (not cached in the JWT).
  canApprovePurchases: boolean("can_approve_purchases").notNull().default(false),
  // Grants a customer-tier team member (CustomerUser) permission to manage
  // their own company's team roster via /portal/team — invite/suspend
  // teammates, force password/MFA resets, unlock accounts, issue emergency
  // MFA bypass codes. There is deliberately no "CustomerAdmin" role in
  // MSP_ROLES (all customer employees share CustomerUser), so this per-user
  // capability flag is the elevated-customer distinction, mirroring
  // canApprovePurchases above. MSPAdmin/MSPOperator/PlatformAdmin acting on a
  // customer's team bypass this — they gate on role, not this flag. Checked
  // live in the route handler, NOT cached in the JWT (Git #1142).
  canManageTeam: boolean("can_manage_team").notNull().default(false),
  // Grants a customer-tier team member (CustomerUser) permission to APPROVE or
  // REJECT a Change Request against their own live tenant — the authority the
  // Change Control approval model (Git #1496) is built on. Deliberately NOT
  // canApprovePurchases (spend) or canManageTeam (roster): approving a
  // configuration change to a live tenant is a distinct authority, and
  // overloading either of those would grant it to people nobody granted it to
  // (see routes/portal-change-control.ts's header). Same shape as the two flags
  // above: per-user, customer-tier only, MSP staff/PlatformAdmin gate on role
  // instead. Checked LIVE in the route handler, never cached in the JWT, so a
  // revoke takes effect immediately.
  canApproveChanges: boolean("can_approve_changes").notNull().default(false),
  // Requires an active MFA enrollment to log in. False by default so existing
  // users are never silently locked out; opted in explicitly via the
  // team-management toggle. Checked live at login, not cached in the JWT.
  mfaEnforced: boolean("mfa_enforced").notNull().default(false),
  // Account-lockout tracking (customer-team.tsx's lockout UI/unlock button):
  // failedLoginAttempts counts consecutive bad passwords (reset on success or
  // admin unlock); lockedUntil gates /auth/login until it passes. Checked live.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lastFailedLoginAt: timestamp("last_failed_login_at", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  // Account-level theme preference. Null = no preference set yet — the client
  // falls back to OS prefers-color-scheme.
  themePreference: text("theme_preference", { enum: ["light", "dark"] }),
  // Free-text organizational metadata for customer-side team members.
  department: text("department"),
  jobTitle: text("job_title"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("users_msp_id_idx").on(t.mspId),
  index("users_tenant_id_idx").on(t.tenantId),
  check("users_role_scope_check", sql`
    (${t.mspRole} IN ('CustomerUser', 'Free', 'Assessment') AND ${t.tenantId} IS NOT NULL)
    OR
    (${t.mspRole} IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND ${t.mspId} IS NOT NULL)
    OR
    (${t.mspRole} = 'PlatformAdmin')
  `),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  companySize: text("company_size"),
  serviceArea: text("service_area"),
  message: text("message"),
  source: text("source", { enum: ["contact_form", "lead_magnet", "ai_recommended", "ai_suggested", "purchase", "quiz", "portal_login", "assessment"] }).notNull().default("contact_form"),
  status: text("status", { enum: ["new", "contacted", "qualified", "converted", "archived"] }).notNull().default("new"),
  howFound: text("how_found"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Qualification Engine — scoring fields
  score: integer("score").notNull().default(0),
  previousScore: integer("previous_score").notNull().default(0),
  stage: text("stage", { enum: ["Junk", "Cold", "Warm", "Hot"] }).notNull().default("Cold"),
  lastQualifiedAt: timestamp("last_qualified_at"),
  // Qualification Engine — profile fields
  industry: text("industry"),
  employeeCount: integer("employee_count"),
  licenseTier: text("license_tier"),
  tenantAge: integer("tenant_age"),
  itTeamSize: integer("it_team_size"),
  painPoints: jsonb("pain_points").$type<string[]>().notNull().default([]),
  maturityIndicators: jsonb("maturity_indicators").$type<string[]>().notNull().default([]),
  engagementSignals: jsonb("engagement_signals").$type<string[]>().notNull().default([]),
  urgencySignals: jsonb("urgency_signals").$type<string[]>().notNull().default([]),
  // Extended fields for Marketing Command Center
  role: text("role"),
  phone: text("phone"),
  location: text("location"),
  notes: text("notes"),
  // Soft-delete: when set, this lead is hidden from all stats and list queries
  deletedAt: timestamp("deleted_at"),
  // CRM scoring engine — see `crm-engine.ts`. Pure sums over fired `crm:*`
  // signal contribution fields. These were written by the `write_crm_scores`
  // workflow node, which #135 (Decommission Legacy CRM Phase A) removed — as of
  // that phase these two columns have no writer and are read-only history.
  priorityScore: integer("priority_score").notNull().default(0),
  pricingInfluenceScore: integer("pricing_influence_score").notNull().default(0),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = typeof leadsTable.$inferInsert;
export type Lead = typeof leadsTable.$inferSelect;

// ── Lead Staging (Zoho CRM, #83) ─────────────────────────────────────────────
// The single pre-Zoho staging table that unifies `leads` and `quiz_leads`.
// Zoho CRM is the system of record for a lead once `zohoLeadId` is set; this
// table is where a lead lives *before* it has been pushed, plus the local
// scoring/engine columns Zoho has no home for.
//
// Column set is the union of the real `leads` and `quiz_leads` shapes as they
// exist today (audited against both, not the earlier architecture sketch) —
// `leads`' qualification/profile/marketing columns and `quiz_leads`' quiz
// result columns, with the two `createdAt`s collapsed into one.
//
// `quick_win_quiz_results` is deliberately NOT merged in: those rows carry no
// identity at all (no name, no email — see that table's real shape), so they
// cannot become lead rows. They stay where they are and gain a nullable
// `leadStagingId` that identity capture sets when a result is promoted here.
//
// `legacyLeadId` / `legacyQuizLeadId` keep the pre-cutover row ids addressable
// so the not-yet-migrated readers (28 files still on `leadsTable`, decommissioned
// in #84) and this table can be reconciled during the overlap.
export const leadStagingTable = pgTable("lead_staging", {
  id: serial("id").primaryKey(),

  // ── identity ──
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  phone: text("phone"),
  role: text("role"),
  location: text("location"),

  // ── provenance (union of both tables' source enums) ──
  source: text("source", { enum: ["contact_form", "lead_magnet", "ai_recommended", "ai_suggested", "purchase", "quiz", "portal_login", "assessment", "quick_win_quiz"] }).notNull().default("contact_form"),
  status: text("status", { enum: ["new", "contacted", "qualified", "converted", "archived"] }).notNull().default("new"),
  howFound: text("how_found"),
  serviceArea: text("service_area"),
  message: text("message"),
  companySize: text("company_size"),
  notes: text("notes"),

  // ── attribution (#116) ──
  // GA4's client_id, carried in from whichever public capture point (quiz
  // identify, contact form, assessment-funnel checkout-session) first saw the
  // visitor. Set once at capture time and never overwritten by a later
  // find-or-create — first-touch attribution, not last-touch.
  ga4ClientId: text("ga4_client_id"),

  // ── Zoho linkage ──
  // Zoho record ids are 18-19 digit numeric strings — text, never integer.
  zohoLeadId: text("zoho_lead_id"),
  // Set once zoho_convert_lead has run: the lead no longer lives in Zoho's
  // Leads module and further writes must target Contacts/Deals instead.
  zohoConvertedAt: timestamp("zoho_converted_at", { withTimezone: true }),
  // Last queued/attempted push state, so the Admin Panel can show "syncing"
  // rather than implying an instant write (the drain runs every 5 minutes).
  zohoSyncState: text("zoho_sync_state", { enum: ["local", "queued", "synced", "error"] }).notNull().default("local"),
  zohoSyncError: text("zoho_sync_error"),
  zohoSyncedAt: timestamp("zoho_synced_at", { withTimezone: true }),

  // ── Qualification / Scoring Engine (from `leads`) ──
  score: integer("score").notNull().default(0),
  previousScore: integer("previous_score").notNull().default(0),
  stage: text("stage", { enum: ["Junk", "Cold", "Warm", "Hot"] }).notNull().default("Cold"),
  lastQualifiedAt: timestamp("last_qualified_at"),
  industry: text("industry"),
  employeeCount: integer("employee_count"),
  licenseTier: text("license_tier"),
  tenantAge: integer("tenant_age"),
  itTeamSize: integer("it_team_size"),
  painPoints: jsonb("pain_points").$type<string[]>().notNull().default([]),
  maturityIndicators: jsonb("maturity_indicators").$type<string[]>().notNull().default([]),
  engagementSignals: jsonb("engagement_signals").$type<string[]>().notNull().default([]),
  urgencySignals: jsonb("urgency_signals").$type<string[]>().notNull().default([]),
  priorityScore: integer("priority_score").notNull().default(0),
  pricingInfluenceScore: integer("pricing_influence_score").notNull().default(0),

  // ── Quiz result columns (from `quiz_leads`) ──
  quizType: text("quiz_type"),
  totalScore: integer("total_score").notNull().default(0),
  tier: text("tier"),
  recommendedService: text("recommended_service"),
  categoryScores: jsonb("category_scores").$type<Record<string, number>>().notNull().default({}),
  analysisText: jsonb("analysis_text").$type<QuizAnalysisText>().default({ whatThisMeans: "", whyThisFits: "", roiProjection: "" }),
  leadOfferResult: jsonb("lead_offer_result").$type<Record<string, unknown> | null>().default(null),
  conversation: jsonb("conversation").$type<QuizConversationEntry[]>().notNull().default([]),
  detectedSeats: integer("detected_seats"),
  contactedAt: timestamp("contacted_at"),

  // ── pre-cutover row pointers (dropped in #84) ──
  legacyLeadId: integer("legacy_lead_id"),
  legacyQuizLeadId: integer("legacy_quiz_lead_id"),

  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("lead_staging_email_idx").on(t.email),
  index("lead_staging_zoho_lead_id_idx").on(t.zohoLeadId),
  index("lead_staging_sync_state_idx").on(t.zohoSyncState),
]);

export type InsertLeadStaging = typeof leadStagingTable.$inferInsert;
export type LeadStaging = typeof leadStagingTable.$inferSelect;

// ── Fulfillment Types ──────────────────────────────────────────────────────────
// Admin-extensible registry of fulfillment lifecycle kinds.
// Each type maps to an event trigger on a Workflow Definition — what *actually*
// happens for a given type is a visible workflow, not opaque code.

export const fulfillmentTypesTable = pgTable("fulfillment_types", {
  // Human-readable key used as the event suffix: fulfillment.<key>
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  // Surfaces that may use this type: "purchase" | "signal" | "manual"
  firedWhen: jsonb("fired_when").$type<string[]>().notNull().default([]),
  // true → Stripe subscription billing; false → one-time charge
  recurring: boolean("recurring").notNull().default(false),
  // Soft-toggle without deleting the record
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertFulfillmentType = typeof fulfillmentTypesTable.$inferInsert;
export type FulfillmentType = typeof fulfillmentTypesTable.$inferSelect;

// ── Document Types ────────────────────────────────────────────────────────────
// Admin-extensible registry backing Insights document generation
// (document-generator.ts / admin-insights.ts). Replaces the hardcoded
// REPORT_DOC_TYPE_LABELS / CONSULTING_TYPE_LABELS / CONSULTING_SECTION_HINTS
// object literals that used to be duplicated in both files. The AI prompt
// CONTENT for each type remains a separate, already-DB-driven system
// (ai_prompts, keyed "insights-<category>-<key>") — this table is only the
// type registry (key, label, category, section hints).

export const documentTypesTable = pgTable("document_types", {
  id: serial("id").primaryKey(),
  // The existing docType string stored on insights_generated_documents.doc_type
  // (e.g. "security_posture_report", "sow", "task_execution_guide").
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  category: text("category", { enum: ["report", "consulting"] }).notNull(),
  // Structure instructions substituted into the consulting prompt's
  // {{sectionHints}} token. Null for report types (fixed prompt structure).
  sectionHints: text("section_hints"),
  sections: jsonb("sections").$type<{ id: string; heading: string; guidance: string }[]>().notNull().default([]),
  // Mirrors task_execution_guide's special case: prompt is built from a real
  // SOW document's HTML rather than the standard findings/scores block.
  requiresSowHtml: boolean("requires_sow_html").notNull().default(false),
  serviceId: integer("service_id").references((): AnyPgColumn => servicesTable.id, { onDelete: "set null" }),
  includedProfileKeyPatterns: jsonb("included_profile_key_patterns").$type<string[]>().notNull().default([]),
  // Column/field name kept as-is (Git #481, deliberate, minimize blast radius)
  // even though its SEMANTICS changed: values are now `SIGNAL_PILLARS` members
  // (`signal_derivation_rules.pillar`), not the old `SIGNAL_CATEGORY_PREFIXES`
  // signal_key domain-segment values #479 parsed. `scopeFindingsBySignalCategory`
  // (document-engine.ts) is vocabulary-agnostic set-membership, so no code
  // changed shape — but any row saved under the old scheme now scopes against
  // the wrong vocabulary until an admin re-saves it via DocumentScopingEditor.
  // No real document type had this configured as of #481 (out-of-scope follow-up
  // with Shane), so there was nothing live to migrate.
  includedSignalCategories: jsonb("included_signal_categories").$type<string[]>().notNull().default([]),
  pipelineCategory: text("pipeline_category", { enum: ["standalone", "pipeline_output"] }).notNull().default("standalone"),
  /**
   * Whether this document type gets the per-finding Remediation Detail appendix
   * (#493): for each finding in the document's scope, either the human-verified
   * `remediation_knowledge_base` row for its check (rendered directly, no AI
   * call) or, when there is none, the AI fallback under an unmissable
   * "AI-GENERATED GUIDANCE — VERIFY BEFORE RUNNING" banner.
   *
   * A column rather than a `docTypeKey === "remediation_plan"` literal in
   * document-engine.ts because everything else that engine branches on
   * (sections, prompt, finding scoping, pipeline category) already comes from
   * this registry — and because the appendix is just as correct for
   * security_hardening_plan or a future type, which should be a row edit, not a
   * deploy. Seeded true for `remediation_plan` only.
   */
  remediationDetailAppendix: boolean("remediation_detail_appendix").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  // Soft-toggle without deleting the record (and its generated documents).
  isActive: boolean("is_active").notNull().default(true),
  // Soft pointer to the matching ai_prompts row, so the admin UI's
  // "Edit Prompt" action can deep-link straight to /prompt-center/:id.
  aiPromptId: integer("ai_prompt_id").references((): AnyPgColumn => aiPromptsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertDocumentType = typeof documentTypesTable.$inferInsert;
export type DocumentType = typeof documentTypesTable.$inferSelect;

// ── Results Template Registry ──────────────────────────────────────────────────
// Admin-extensible registry backing the Assessment Results page redesign
// (#162, parent #161). Modeled directly on document_types above: one row per
// registry entry, one entry per assessment product (services row), admin
// CRUD via admin-results-templates.ts, in-process cache via
// results-templates.ts. Registry infra only — this table defines WHICH of the
// 4 fixed template families each product renders as and holds family-specific
// jsonb config; the actual results-page rendering is a separate phase (#163)
// and is not built here.

export const RESULTS_TEMPLATE_FAMILIES = [
  // Pillar/module scores against the platform's health-pillar taxonomy
  // (HEALTH_PILLARS in health-engine.ts) — closest to the current shared
  // results shape, e.g. Tenant Health Audit, Security Posture.
  "pillar_scored",
  // Control-by-control gap list matching a named compliance framework's own
  // structure (SOC 2 / NIST CSF / ISO 27001 / CMMC) rather than pillar scores.
  "framework_gap_list",
  // Decision-relevant data shown directly, not pillar-scored (mailbox sizes,
  // CA policy tiers, license SKU waste) — Migration Readiness, Conditional
  // Access, License & Cost Optimization.
  "readiness_logistics",
  // Copilot-specific shape: oversharing exposure + licensing/adoption fit.
  "copilot",
] as const;
export type ResultsTemplateFamily = typeof RESULTS_TEMPLATE_FAMILIES[number];

export const resultsTemplatesTable = pgTable("results_templates", {
  id: serial("id").primaryKey(),
  // Stable identifier independent of the mapped service's slug/name changing.
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  family: text("family", { enum: RESULTS_TEMPLATE_FAMILIES }).notNull(),
  // One results template maps to exactly one assessment product row.
  serviceId: integer("service_id").notNull().unique().references((): AnyPgColumn => servicesTable.id, { onDelete: "cascade" }),
  // Family-specific structure: pillar subset override (pillar_scored),
  // framework control list (framework_gap_list), decision-field list
  // (readiness_logistics), exposure/licensing config (copilot). Shape is
  // validated in application code per `family`, not by a DB constraint —
  // mirrors document_types.sections' admin-authorable-jsonb approach.
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  // Product-tailored narrative copy overrides, keyed by module/section id,
  // meant to replace the raw signal .finding/.message/.label text pulled
  // verbatim today (portal-customer-engines.ts) with product-specific
  // wording. Consumed by the rendering phase (#163), not written here.
  narrativeCopyHints: jsonb("narrative_copy_hints").$type<Record<string, string>>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  // Soft-toggle without deleting the record (mirrors document_types).
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertResultsTemplate = typeof resultsTemplatesTable.$inferInsert;
export type ResultsTemplate = typeof resultsTemplatesTable.$inferSelect;

// ── Fulfillment Idempotency Store ──────────────────────────────────────────────
// Deduplicates resolve_fulfillment calls by (Stripe session ID | signal-fire event ID).
// A row present means the event has already been emitted; callers skip silently.

export const fulfillmentIdempotencyTable = pgTable("fulfillment_idempotency", {
  // Caller-supplied dedup key (Stripe session ID, signal-fire UUID, etc.)
  idempotencyKey: text("idempotency_key").primaryKey(),
  fulfillmentTypeKey: text("fulfillment_type_key").notNull(),
  // Full payload that was emitted (for auditing / replay)
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertFulfillmentIdempotency = typeof fulfillmentIdempotencyTable.$inferInsert;
export type FulfillmentIdempotency = typeof fulfillmentIdempotencyTable.$inferSelect;

// Services / Micro-Offers (templates)
export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  slug: text("slug").unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  deliverables: jsonb("deliverables").$type<string[]>(),
  price: numeric("price", { precision: 10, scale: 2 }),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  maxPrice: numeric("max_price", { precision: 10, scale: 2 }),
  internalCostCents: integer("internal_cost_cents"),
  priceCents: integer("price_cents"),
  // Yearly price for MSP platform tiers (fulfillmentType = "msp_monthly_subscription"),
  // in integer cents. Set to monthly × 10 (2 months free) by default at creation,
  // but stored explicitly so the multiplier can be overridden per tier.
  annualPriceCents: integer("annual_price_cents"),
  orderWorkflow: jsonb("order_workflow").$type<WizardStep[]>(),
  durationDays: integer("duration_days"),
  turnaround: text("turnaround"),
  billingType: text("billing_type", { enum: ["one_time", "recurring_monthly"] }).notNull().default("one_time"),
  isPublic: boolean("is_public").notNull().default(true),
  visibility: text("visibility", { enum: ["public", "private", "landing_page_only"] }).notNull().default("public"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Marketing content fields
  serviceType: text("service_type"),
  tagline: text("tagline"),
  targetAudience: text("target_audience"),
  inclusions: jsonb("inclusions").$type<string[]>(),
  features: jsonb("features").$type<string[]>(),
  badge: text("badge"),
  highlighted: boolean("highlighted").notNull().default(false),
  hoursPerMonth: text("hours_per_month"),
  iconName: text("icon_name"),
  pageHref: text("page_href"),
  pageSlug: text("page_slug"),
  sortOrder: integer("sort_order").notNull().default(0),
  tier: text("tier"),
  // Direct link to workflow template (replaces the project_templates join table).
  // FK to workflow_templates(id) ON DELETE SET NULL is enforced at the DB level only
  // (via migrate-prod.ts) to avoid a circular TypeScript inference loop — both tables
  // already reference each other.
  workflowTemplateId: integer("workflow_template_id"),
  // Pre-generated service overview PDF (stored on disk under data/uploads/service-pdfs/)
  overviewPdfKey: text("overview_pdf_key"),
  overviewPdfGeneratedAt: timestamp("overview_pdf_generated_at"),
  // Marketing / discovery fields
  bestFor: text("best_for"),
  triggers: jsonb("triggers").$type<string[]>(),
  // App Registration permissions required from the client before automation can run.
  // Shown in the contract agreement as a numbered section the client must acknowledge.
  requiredAppPermissions: jsonb("required_app_permissions").$type<{ scope: string; reason: string }[]>(),
  // ── MSP Platform Subscription discriminator ───────────────────────────────
  // Products with fulfillmentType = "msp_monthly_subscription" are MSP platform
  // tiers. Tier-specific data (tenantAllowance, tierCapabilities, etc.) lives
  // in typeAttributes jsonb.
  fulfillmentType: text("fulfillment_type", {
    enum: ["standard", "msp_monthly_subscription"],
  }).notNull().default("standard"),
  // ── Fulfillment Engine ─────────────────────────────────────────────────────
  // FK into fulfillment_types.key — what lifecycle type this service triggers.
  // Resolved by resolve_fulfillment at checkout / signal fire.
  fulfillmentTypeKey: text("fulfillment_type_key"),
  // Signal keys (from tenant-signals) that auto-trigger this service's fulfillment.
  // A fired signal matching any key here feeds resolve_fulfillment identically to
  // a purchase — the same mechanism, zero duplicated branching.
  triggeringSignalKeys: jsonb("triggering_signal_keys").$type<string[]>(),

  // ── MSP Billing / Checkout Classification ─────────────────────────────────
  // serviceClass: controls the checkout + billing flow for MSP portal offers.
  //   project      — accepted offer → SOW → customer signature → charge MSP card
  //   add_on       — accepted offer → Stripe checkout → confirmation (no signature)
  //   subscription — accepted offer → Stripe subscription checkout → confirmation
  // Null / missing row = treated as "add_on" (direct checkout, no SOW).
  serviceClass: text("service_class", {
    enum: ["project", "add_on", "subscription"],
  }),

  // deliveryType: what gets fulfilled once billing is confirmed.
  //   assessment           — one-time diagnostic / health check
  //   bundle_subscription  — recurring monitoring package bundle
  //   retainer             — ongoing hourly/weekly engagement
  //   document_generation  — automated report or document
  //   none                 — platform-only (no external deliverable)
  // Orthogonal to serviceClass — a project can be any deliveryType.
  deliveryType: text("delivery_type", {
    enum: ["assessment", "bundle_subscription", "retainer", "document_generation", "none"],
  }),

  // When true, a $0 purchase skips Stripe entirely (free assessments, Free tier).
  // When false, $0 purchases still create a Stripe invoice for record-keeping.
  allowFreeCheckout: boolean("allow_free_checkout").notNull().default(true),

  // Optional: Stripe trial period in days. Applied when the offer carries trial terms.
  // Non-null here sets the default; individual offers may override.
  trialPeriodDays: integer("trial_period_days"),

  // ── IDE Product Catalog fields ─────────────────────────────────────────────
  // Slash-delimited category hierarchy e.g. "Consulting/M365". Used to build
  // the left-pane category tree in the admin Product Catalog view.
  categoryPath: text("category_path"),
  // Free-form tags for search and filtering.
  tags: jsonb("tags").$type<string[]>(),
  // Per-service customer-facing agreement text rendered on the client portal.
  customerAgreementTemplate: text("customer_agreement_template"),
  // When true, the service is offered at $0 — skips Stripe checkout entirely.
  isFreeOffering: boolean("is_free_offering").notNull().default(false),

  // ── Type-specific attributes ───────────────────────────────────────────────
  // All product-type-specific fields (monitoring tier seat ranges, platform
  // subscription tier capabilities, document product tiers, etc.) live here.
  // Shape is validated by productTypeConfig.ts at import/export time.
  typeAttributes: jsonb("type_attributes").$type<Record<string, unknown>>(),

  // ── Associated documents ───────────────────────────────────────────────────
  // Structured mapping of which engagement documents this service's automated
  // document-generation workflow should produce. Distinct from the marketing
  // `deliverables` string[] above — this drives real generation. Each entry:
  //   - docType: matches the document-generation docType taxonomy
  //     (see REPORT_DOC_TYPE_LABELS / CONSULTING_TYPE_LABELS in document-generator.ts)
  //   - category: "report" | "consulting" — selects the generator path
  //   - title:   human title for the generated doc + presentation deliverable row
  //   - customerVisible: when false, the doc is generated internal-only (it grounds
  //     the SOW's accuracy) and is EXCLUDED from the customer-facing presentation.
  // The consolidated_sow is always generated separately (after these) and is always
  // customer-visible — it need not be listed here.
  associatedDocuments: jsonb("associated_documents").$type<ServiceAssociatedDocument[]>(),
});

/** One entry in servicesTable.associatedDocuments — see column comment. */
export interface ServiceAssociatedDocument {
  docType: string;
  category: "report" | "consulting";
  title: string;
  customerVisible: boolean;
}

export type InsertService = typeof servicesTable.$inferInsert;
export type Service = typeof servicesTable.$inferSelect;

// Projects
export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "on_hold", "completed"] }).notNull().default("active"),
  phase: text("phase"),
  progress: integer("progress").notNull().default(0),
  clientUserId: integer("client_user_id").references(() => usersTable.id),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  projectType: text("project_type", { enum: ["project", "retainer", "quick_win"] }).notNull().default("project"),
  sharepointFolderUrl: text("sharepoint_folder_url"),
  generatedArtifacts: jsonb("generated_artifacts").$type<Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }>>(),
  signedOffAt: timestamp("signed_off_at"),
  signedOffBy: integer("signed_off_by").references(() => usersTable.id),
  quickWinElapsedSeconds: integer("quick_win_elapsed_seconds"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertProject = typeof projectsTable.$inferInsert;
export type Project = typeof projectsTable.$inferSelect;

// Billing interval of a direct-customer recurring service ('month' or 'year').
// Mirrors MSP_BILLING_INTERVALS in msp.ts, but defined here to keep the
// direct-customer channel independent of the MSP schema module.
export const CLIENT_BILLING_INTERVALS = ["month", "year"] as const;
export type ClientBillingInterval = typeof CLIENT_BILLING_INTERVALS[number];

// Client-assigned services
export const clientServicesTable = pgTable("client_services", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  status: text("status", { enum: ["active", "completed", "paused"] }).notNull().default("active"),
  progress: integer("progress").notNull().default(0),
  startDate: timestamp("start_date"),
  nextMilestone: text("next_milestone"),
  nextMilestoneDate: timestamp("next_milestone_date"),
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Billing interval of the currently ACTIVE Stripe price for this retainer.
  billingInterval: text("billing_interval", { enum: CLIENT_BILLING_INTERVALS }).notNull().default("month"),
  // Self-service interval switch (portal-retainer-billing.ts): set while a
  // monthly⟷yearly switch is scheduled via a Stripe Subscription Schedule to
  // take effect at the next period start. Cleared when the schedule completes
  // or is canceled.
  stripeScheduleId: text("stripe_schedule_id"),
  pendingBillingInterval: text("pending_billing_interval", { enum: CLIENT_BILLING_INTERVALS }),
});

export type InsertClientService = typeof clientServicesTable.$inferInsert;
export type ClientService = typeof clientServicesTable.$inferSelect;

// Workflow steps (attached to projects or client_services)
export const workflowStepsTable = pgTable("workflow_steps", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id),
  clientServiceId: integer("client_service_id").references(() => clientServicesTable.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["pending", "in_progress", "completed", "blocked"] }).notNull().default("pending"),
  order: integer("order").notNull().default(0),
  notes: text("notes"),
  completedAt: timestamp("completed_at"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  workflowTemplateStepId: integer("workflow_template_step_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  sowPhaseId: text("sow_phase_id"),
});

export type InsertWorkflowStep = typeof workflowStepsTable.$inferInsert;
export type WorkflowStep = typeof workflowStepsTable.$inferSelect;

// Kanban tasks (within projects)
export const kanbanTasksTable = pgTable("kanban_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  column: text("column", { enum: ["backlog", "in_progress", "waiting_on_customer", "review", "completed"] }).notNull().default("backlog"),
  order: integer("order").notNull().default(0),
  assignedTo: text("assigned_to"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  workflowStepId: integer("workflow_step_id"),
  groupName: text("group_name"),
  waitingReason: text("waiting_reason"),
  completionStatus: text("completion_status"),
  completionNotes: text("completion_notes"),
  priority: text("priority").notNull().default("medium"),
  sourceEmailId: integer("source_email_id"),
  statusReportId: integer("status_report_id"),
  taskType: text("task_type"),
  taskMetadata: jsonb("task_metadata"),
  publicNotes: text("public_notes"),
  internalNotes: text("internal_notes"),
});

export type InsertKanbanTask = typeof kanbanTasksTable.$inferInsert;
export type KanbanTask = typeof kanbanTasksTable.$inferSelect;

// Documents (attached to projects)
export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  name: text("name").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertDocument = typeof documentsTable.$inferInsert;
export type Document = typeof documentsTable.$inferSelect;

// Reports (per client)
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  title: text("title").notNull(),
  period: text("period", { enum: ["weekly", "monthly", "executive_summary", "other"] }).notNull().default("monthly"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  reportDate: timestamp("report_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertReport = typeof reportsTable.$inferInsert;
export type Report = typeof reportsTable.$inferSelect;

// Invoices
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  description: text("description"),
  // Integer cents (Git #1610). Migrated from numeric(10,2) decimal dollars to
  // uphold the platform rule that money is integer cents internally, always.
  // The retired decimal column survives one release as `amount_old_numeric`
  // (nullable) for verification/rollback and is dropped in a later migration.
  // Convert to display dollars at render only (Math.round(amount) / 100).
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status", { enum: ["draft", "due", "paid", "overdue"] }).notNull().default("due"),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  pdfFilename: text("pdf_filename"),
  stripeSessionId: text("stripe_session_id"),
  sharepointFileUrl: text("sharepoint_file_url"),
  couponCode: text("coupon_code"),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }),
  invoiceType: text("invoice_type", { enum: ["instant", "retainer"] }).notNull().default("instant"),
  stripeInvoiceId: text("stripe_invoice_id"),
  billingCycleStart: timestamp("billing_cycle_start"),
  billingCycleEnd: timestamp("billing_cycle_end"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Zoho Books Invoice id (#87) — nullable, populated once
  // zoho_books_create_invoice has synced this invoice (idempotency tracking
  // only, not display — Zoho Books has no in-platform UI).
  zohoBooksInvoiceId: text("zoho_books_invoice_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertInvoice = typeof invoicesTable.$inferInsert;
export type Invoice = typeof invoicesTable.$inferSelect;

// Device tokens for push notifications (admin mobile app)
export const deviceTokensTable = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull().default("ios"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertDeviceToken = typeof deviceTokensTable.$inferInsert;
export type DeviceToken = typeof deviceTokensTable.$inferSelect;

// Messages (client ↔ admin threaded)
export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id),
  senderUserId: integer("sender_user_id").notNull().references(() => usersTable.id),
  body: text("body").notNull(),
  readByAdmin: boolean("read_by_admin").notNull().default(false),
  readByClient: boolean("read_by_client").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertMessage = typeof messagesTable.$inferInsert;
export type Message = typeof messagesTable.$inferSelect;

// Notifications
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  title: text("title").notNull(),
  body: text("body"),
  type: text("type", { enum: ["project_update", "message", "invoice", "document", "general", "lead_created", "quiz_lead_created", "purchase_created"] }).notNull().default("general"),
  read: boolean("read").notNull().default(false),
  linkPath: text("link_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Notification Center v2 fields
  feedType: text("feed_type", { enum: ["personal", "all_activity"] }).notNull().default("personal"),
  category: text("category"),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  mspId: integer("msp_id"),
  mspUserId: integer("msp_user_id"),
  recipientType: text("recipient_type", { enum: ["platform_admin", "msp_user", "customer_user"] }).notNull().default("platform_admin"),
});

export type InsertNotification = typeof notificationsTable.$inferInsert;
export type Notification = typeof notificationsTable.$inferSelect;

// Customer-configurable notification preferences — one row per (user, category).
// Absence of a row means the default: in-app delivery on, email delivery off.
// Only governs what reaches the customer (delivery channel/opt-out); it never
// overrides MSP-configured policy_rules severity/cooldown/escalation.
export const customerNotificationPreferencesTable = pgTable("customer_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("customer_notif_prefs_user_category_uidx").on(t.userId, t.category),
]);

export type InsertCustomerNotificationPreference = typeof customerNotificationPreferencesTable.$inferInsert;
export type CustomerNotificationPreference = typeof customerNotificationPreferencesTable.$inferSelect;

// Project updates / communication log
export const projectUpdatesTable = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  content: text("content").notNull(),
  authorUserId: integer("author_user_id").references(() => usersTable.id),
  type: text("type", { enum: ["update", "milestone", "message", "file"] }).notNull().default("update"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertProjectUpdate = typeof projectUpdatesTable.$inferInsert;
export type ProjectUpdate = typeof projectUpdatesTable.$inferSelect;

// Signed contracts
export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  guestEmail: text("guest_email"),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  signatureData: text("signature_data"),
  signerName: text("signer_name"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  contractVersion: text("contract_version").notNull().default("v1"),
  stripeSessionId: text("stripe_session_id"),
  projectId: integer("project_id").references(() => projectsTable.id),
  pdfFilename: text("pdf_filename"),
  finalPrice: numeric("final_price"),
  wizardSelections: jsonb("wizard_selections"),
  agreementBody: text("agreement_body"),
  sharepointFileUrl: text("sharepoint_file_url"),
  sharepointFileId: text("sharepoint_file_id"),
  localFilePath: text("local_file_path"),
  appRegPermissionsAgreed: boolean("app_reg_permissions_agreed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertContract = typeof contractsTable.$inferInsert;
export type Contract = typeof contractsTable.$inferSelect;

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertPasswordResetToken = typeof passwordResetTokensTable.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;

export const impersonationTokensTable = pgTable("impersonation_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id),
  adminUserId: integer("admin_user_id").notNull().references(() => usersTable.id),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertImpersonationToken = typeof impersonationTokensTable.$inferInsert;
export type ImpersonationToken = typeof impersonationTokensTable.$inferSelect;

export const accountSetupTokensTable = pgTable("account_setup_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertAccountSetupToken = typeof accountSetupTokensTable.$inferInsert;
export type AccountSetupToken = typeof accountSetupTokensTable.$inferSelect;

// Git #415. Same shape as impersonationTokensTable/accountSetupTokensTable —
// a short-lived, single-use bearer token headless Chromium exchanges (via
// POST /auth/print-exchange) for a real short-lived JWT for the SAME user who
// requested the PDF, so it can navigate the live, authenticated Document
// Viewer route with no interactive session of its own. Scoped to exactly one
// document per token (documentId, not nullable) — a batch "download all"
// mints one token per document rather than one wide-scoped token, so a leaked
// token can never reach further than the single PDF it was minted for.
export const printTokensTable = pgTable("print_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  documentId: integer("document_id").notNull().references(() => insightsGeneratedDocumentsTable.id),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertPrintToken = typeof printTokensTable.$inferInsert;
export type PrintToken = typeof printTokensTable.$inferSelect;

// Git #1043 (Epic #660, Phase 1). printTokensTable's sibling for the
// Copilot Readiness journey's live-rendered documents (JOURNEY_LIVE_DOCUMENTS
// in artifacts/msp-portal/src/components/copilot-journey/journeyTokens.ts) —
// these documents have `id: null` by design (journeyModel.ts's
// buildGeneration()/withLiveDocuments(), no row ever backs them), so
// printTokensTable's NOT NULL documentId FK into insightsGeneratedDocumentsTable
// structurally cannot scope a token to one of them. Keyed by docType instead —
// no documentId column, nothing to reference. Same consumable-secret shape
// (expiresAt = short-lived, usedAt = single-use) as printTokensTable.
export const documentPrintTokensTable = pgTable("document_print_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  docType: text("doc_type").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertDocumentPrintToken = typeof documentPrintTokensTable.$inferInsert;
export type DocumentPrintToken = typeof documentPrintTokensTable.$inferSelect;

// Git #636 — printTokensTable/documentPrintTokensTable's sibling for the
// public assessment-flow "auto-login after set-password" exchange: mints a
// single-use, short-lived token the moment a buyer sets their real password
// (POST /public/flow/set-password), appended to the returned portalUrl as
// ?signupToken=..., which the msp-portal boot effect then exchanges (POST
// /auth/signup-exchange) for a REAL ordinary session via issueSessionForUser
// — not a scoped/short-lived JWT the way print-exchange issues. Same
// consumable-secret shape (expiresAt/usedAt) and same 2-minute TTL as
// print_tokens/document_print_tokens (comfortably longer than the redirect
// from set-password to the portal landing tab, far shorter than any real
// session).
export const signupExchangeTokensTable = pgTable("signup_exchange_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  // withTimezone matches the REAL column type (timestamptz — confirmed against
  // the live DB, Git #1317). Declared naive, drizzle's read appended "+0000"
  // to the driver's "…-04"-suffixed string and V8 honours the LAST offset, so
  // on any non-UTC machine every 2-minute token parsed hours into the past and
  // /auth/signup-exchange 401'd unconditionally. UTC servers (Replit) masked
  // the bug because the two offsets coincide.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertSignupExchangeToken = typeof signupExchangeTokensTable.$inferInsert;
export type SignupExchangeToken = typeof signupExchangeTokensTable.$inferSelect;

// Git #1044 (Epic #660, Phase 2). A "share a link" token for the same
// live-rendered document set documentPrintTokensTable prints — but shaped
// for the opposite use case: not a single-use, minutes-lived secret that
// authenticates a headless print tab as the real logged-in user, but a
// long-lived, multi-view, revocable link the customer hands to someone who
// has no portal login at all (their internal reviewer or purchasing team).
// quick_win_result_shares (the platform's older share-link table) is
// DEPRECATED for this feature and is not touched or reused here — see
// live-document-shares.ts's own header for why.
//
// `customerId` here is a `users.id` FK (NOT a `tenants.id`, despite the
// "customerId" name every other portal route uses for tenants — see
// requireAuth.ts's AuthUser.customerId comment for that frozen, unrelated
// naming). It is the logged-in CustomerUser who clicked "Send for review" /
// "Send to purchasing" on their OWN document set — the same identity
// documentPrintTokensTable.userId and printTokensTable.userId already key
// on, just named per this issue's own schema spec.
//
// No `expiresAt`: a share link is handed to someone specifically so they can
// come back to it (a purchasing approval can take weeks), and `revokedAt` is
// the real, deliberate control a customer has over it — an invisible clock
// running out underneath them would silently break a link they still think
// is good. Revocation is a manual/future action; nothing in this build sets
// it automatically.
export const liveDocumentSharesTable = pgTable("live_document_shares", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  variant: text("variant", { enum: ["review", "purchasing"] }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

export type InsertLiveDocumentShare = typeof liveDocumentSharesTable.$inferInsert;
export type LiveDocumentShare = typeof liveDocumentSharesTable.$inferSelect;

// Engagement Project Types (shown on Pricing page Track 02, used for SOW generation)
export const engagementProjectsTable = pgTable("engagement_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  priceRange: text("price_range").notNull(),
  description: text("description"),
  meaning: text("meaning"),
  triggeredBy: jsonb("triggered_by").$type<string[]>().notNull().default([]),
  sowItems: jsonb("sow_items").$type<string[]>().notNull().default([]),
  pages: jsonb("pages").$type<string[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEngagementProjectSchema = createInsertSchema(engagementProjectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngagementProject = typeof engagementProjectsTable.$inferInsert;
export type EngagementProject = typeof engagementProjectsTable.$inferSelect;

// ── Signal Rule Engine ────────────────────────────────────────────────────────
//
// Signal intelligence field taxonomy (`category` picklist)
// ----------------------------------------------------------------------------
// Every signal rule group / rule can be tagged with a `category` describing
// which downstream engine consumes it. This is a fixed prefix taxonomy —
// enforced as a picklist in the admin UI (free-text `pillar` is fine for
// finer-grained labeling within a category). Categories:
//   pricing:*      — feeds the pricing engine (pricingImpact, pricingValueContribution)
//   priority:*     — feeds the priority scoring engine (priorityScoreContribution)
//   governance:*   — governance drift / health scoring (governanceImpact)
//   security:*     — security health scoring (securityImpact)
//   compliance:*   — compliance health scoring (complianceImpact)
//   adoption:*     — adoption health scoring (adoptionImpact)
//   copilot:*      — Copilot readiness/health scoring (copilotImpact)
//   architecture:* — architecture health engine (architectureImpact)
//   drift:*        — governance drift engine (trendValue, trendDirection, decayRate)
//   forecasting:*  — forecasting engine (trendValue, trendDirection, ttlDays, decayRate)
//   crm:*          — CRM scoring engine (crmFitContribution, crmPainContribution,
//                    crmMaturityContribution, crmIntentContribution, crmUrgencyContribution)
//   msp:*          — general MSP-facing signals not covered by the above
//   workflow:*     — signals consumed by workflow automation nodes
//
// This task only adds the data fields described above — no engine reads them
// yet. All new columns are additive, nullable-safe, and default to inert
// values (0 / "") so `computeTenantSignals` scoring is completely unchanged.

const SIGNAL_INTELLIGENCE_FIELDS = {
  priority: integer("priority").notNull().default(0),
  weight: integer("weight").notNull().default(0),
  pricingImpact: integer("pricing_impact").notNull().default(0),
  priorityScoreContribution: integer("priority_score_contribution").notNull().default(0),
  pricingValueContribution: integer("pricing_value_contribution").notNull().default(0),
  governanceImpact: integer("governance_impact").notNull().default(0),
  securityImpact: integer("security_impact").notNull().default(0),
  complianceImpact: integer("compliance_impact").notNull().default(0),
  adoptionImpact: integer("adoption_impact").notNull().default(0),
  copilotImpact: integer("copilot_impact").notNull().default(0),
  architectureImpact: integer("architecture_impact").notNull().default(0),
  licensingImpact: integer("licensing_impact").notNull().default(0),
  trendValue: integer("trend_value").notNull().default(0),
  trendDirection: text("trend_direction", { enum: ["up", "down", "flat"] }).notNull().default("flat"),
  decayRate: numeric("decay_rate", { precision: 4, scale: 3 }).notNull().default("0"),
  ttlDays: integer("ttl_days").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  severity: text("severity", { enum: ["informational", "low", "medium", "high", "critical"] }).notNull().default("low"),
  category: text("category").notNull().default(""),
  pillar: text("pillar").notNull().default(""),
  crmFitContribution: integer("crm_fit_contribution").notNull().default(0),
  crmPainContribution: integer("crm_pain_contribution").notNull().default(0),
  crmMaturityContribution: integer("crm_maturity_contribution").notNull().default(0),
  crmIntentContribution: integer("crm_intent_contribution").notNull().default(0),
  crmUrgencyContribution: integer("crm_urgency_contribution").notNull().default(0),
} as const;

/** Allowed `category` prefixes for signal rule groups/rules — see taxonomy comment above. */
export const SIGNAL_CATEGORY_PREFIXES = [
  "pricing", "priority", "governance", "security", "compliance", "adoption",
  "copilot", "architecture", "drift", "forecasting", "crm", "msp", "workflow",
] as const;
export type SignalCategoryPrefix = typeof SIGNAL_CATEGORY_PREFIXES[number];

/**
 * Canonical values of `signalDerivationRulesTable.pillar` (a DIFFERENT axis
 * from `category` above — see the `pillar` column itself). Git #469 made
 * `pillar` the enforced single source of truth for "what pillar does this
 * signal belong to"; Git #481 switched `document_types.included_signal_categories`
 * document scoping onto it directly instead of parsing a `signal_key` domain
 * segment against `SIGNAL_CATEGORY_PREFIXES`.
 *
 * Equal to `HEALTH_PILLARS` (`artifacts/api-server/src/lib/health-engine.ts`)
 * plus `security` and `cost`, which score outside `HEALTH_PILLARS`. Duplicated
 * here as a static literal rather than imported — `health-engine.ts` lives in
 * api-server, and this package (`@workspace/db`) is a lower-level dependency of
 * BOTH api-server and admin-panel, so it cannot import from either without
 * inverting the dependency graph. If `HEALTH_PILLARS` changes, update this by
 * hand.
 */
export const SIGNAL_PILLARS = [
  "governance", "security", "compliance", "adoption", "copilot", "architecture", "licensing", "cost",
] as const;
export type SignalPillar = typeof SIGNAL_PILLARS[number];

export const SIGNAL_TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export type SignalTrendDirection = typeof SIGNAL_TREND_DIRECTIONS[number];

export const SIGNAL_SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const signalRuleGroupsTable = pgTable("signal_rule_groups", {
  id: serial("id").primaryKey(),
  signalKey: text("signal_key").notNull(),
  logic: text("logic", { enum: ["AND", "OR"] }).notNull().default("OR"),
  label: text("label"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** null = platform-owned (default); non-null = MSP override row scoped to that mspId */
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  ...SIGNAL_INTELLIGENCE_FIELDS,
});

export type SignalRuleGroup = typeof signalRuleGroupsTable.$inferSelect;
export type InsertSignalRuleGroup = typeof signalRuleGroupsTable.$inferInsert;

export const signalDerivationRulesTable = pgTable("signal_derivation_rules", {
  id: serial("id").primaryKey(),
  signalKey: text("signal_key").notNull(),
  groupId: integer("group_id").references(() => signalRuleGroupsTable.id, { onDelete: "set null" }),
  ruleType: text("rule_type").notNull(),
  sourceKey: text("source_key").notNull(),
  compareValue: text("compare_value"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** null = platform-owned (default); non-null = MSP override row scoped to that mspId */
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  ...SIGNAL_INTELLIGENCE_FIELDS,
});

export type SignalDerivationRule = typeof signalDerivationRulesTable.$inferSelect;
export type InsertSignalDerivationRule = typeof signalDerivationRulesTable.$inferInsert;

export const tenantSignalHistoryTable = pgTable("tenant_signal_history", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  signalKey: text("signal_key").notNull(),
  category: text("category"),
  firedAt: timestamp("fired_at"),
  resolvedAt: timestamp("resolved_at"),
  ruleVersion: integer("rule_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  customerSignalFiredIdx: index("tenant_signal_history_customer_signal_fired_idx")
    .on(table.customerId, table.signalKey, table.firedAt),
}));

export type TenantSignalHistory = typeof tenantSignalHistoryTable.$inferSelect;
export type InsertTenantSignalHistory = typeof tenantSignalHistoryTable.$inferInsert;

export const signalRuleAuditLogTable = pgTable("signal_rule_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  signalKey: text("signal_key"),
  ruleId: integer("rule_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  adminUserId: integer("admin_user_id"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SignalRuleAuditLog = typeof signalRuleAuditLogTable.$inferSelect;

export const signalRuleVersionsTable = pgTable("signal_rule_versions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  ruleCount: integer("rule_count").notNull(),
  createdByAdminId: integer("created_by_admin_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SignalRuleVersion = typeof signalRuleVersionsTable.$inferSelect;

export const signalSimulationProfilesTable = pgTable("signal_simulation_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  profileUpdates: jsonb("profile_updates").$type<Record<string, unknown>>().notNull().default({}),
  parsedFindings: jsonb("parsed_findings").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  lastRunAt: timestamp("last_run_at"),
  lastRunResult: jsonb("last_run_result"),
  lastRunProjectDiff: jsonb("last_run_project_diff"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SignalSimulationProfile = typeof signalSimulationProfilesTable.$inferSelect;

export const signalEnabledStateTable = pgTable("signal_enabled_state", {
  signalKey: text("signal_key").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SignalEnabledState = typeof signalEnabledStateTable.$inferSelect;
export type InsertSignalSimulationProfile = typeof signalSimulationProfilesTable.$inferInsert;

export const shareEventsTable = pgTable("share_events", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  platform: text("platform", { enum: ["linkedin", "x"] }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertShareEvent = typeof shareEventsTable.$inferInsert;
export type ShareEvent = typeof shareEventsTable.$inferSelect;

export const checklistDownloadsTable = pgTable("checklist_downloads", {
  id: serial("id").primaryKey(),
  asset: text("asset").notNull().default("copilot-readiness"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertChecklistDownload = typeof checklistDownloadsTable.$inferInsert;
export type ChecklistDownload = typeof checklistDownloadsTable.$inferSelect;

// Workflow Templates
export const workflowTemplatesTable = pgTable("workflow_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  serviceId: integer("service_id").references(() => servicesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertWorkflowTemplate = typeof workflowTemplatesTable.$inferInsert;
export type WorkflowTemplate = typeof workflowTemplatesTable.$inferSelect;

export const workflowTemplateStepsTable = pgTable("workflow_template_steps", {
  id: serial("id").primaryKey(),
  workflowTemplateId: integer("workflow_template_id").notNull().references(() => workflowTemplatesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertWorkflowTemplateStep = typeof workflowTemplateStepsTable.$inferInsert;
export type WorkflowTemplateStep = typeof workflowTemplateStepsTable.$inferSelect;

// Workflow Template Step Tasks (sub-tasks belonging to a workflow template step)
export const workflowTemplateStepTasksTable = pgTable("workflow_template_step_tasks", {
  id: serial("id").primaryKey(),
  workflowTemplateStepId: integer("workflow_template_step_id").notNull().references(() => workflowTemplateStepsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  groupName: text("group_name"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  instructions: jsonb("instructions").$type<string[]>(),
  checklist: jsonb("checklist").$type<Array<{ id: string; label: string }>>(),
  artifactsProduced: jsonb("artifacts_produced").$type<string[]>(),
  clientDeliverables: jsonb("client_deliverables").$type<string[]>(),
  instructionSetId: integer("instruction_set_id").references(() => instructionSetsTable.id, { onDelete: "set null" }),
  checklistId: integer("checklist_id").references(() => checklistsTable.id, { onDelete: "set null" }),
  artifactsId: integer("artifacts_id").references(() => artifactSetsTable.id, { onDelete: "set null" }),
  deliverablesId: integer("deliverables_id").references(() => deliverableSetsTable.id, { onDelete: "set null" }),
  taskType: text("task_type"),
  taskMetadata: jsonb("task_metadata").$type<Record<string, unknown>>(),
  requiresManualRun: boolean("requires_manual_run").default(false),
  isCustomerTask: boolean("is_customer_task").default(false),
  runbookId: uuid("runbook_id"),
  customerDownloadScriptId: uuid("customer_download_script_id"),
  triggersHealthScore: boolean("triggers_health_score").notNull().default(false),
});

export type InsertWorkflowTemplateStepTask = typeof workflowTemplateStepTasksTable.$inferInsert;
export type WorkflowTemplateStepTask = typeof workflowTemplateStepTasksTable.$inferSelect;

// Contract Templates
export const contractTemplatesTable = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().unique().references(() => servicesTable.id),
  body: text("body").notNull().default(""),
  version: text("version").notNull().default("v1"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertContractTemplate = typeof contractTemplatesTable.$inferInsert;
export type ContractTemplate = typeof contractTemplatesTable.$inferSelect;

// Status Reports (structured, admin-authored client-facing reports)
export const statusReportsTable = pgTable("status_reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id),
  clientUserId: integer("client_user_id").references(() => usersTable.id),
  title: text("title").notNull(),
  period: text("period", { enum: ["weekly", "monthly", "executive_summary", "other"] }).notNull().default("monthly"),
  reportStatus: text("report_status", { enum: ["draft", "sent"] }).notNull().default("draft"),
  executiveSummary: text("executive_summary"),
  completedActivities: jsonb("completed_activities").$type<Array<{ title: string; description: string }>>().notNull().default([]),
  keyOutcomes: text("key_outcomes"),
  nextSteps: jsonb("next_steps").$type<Array<{ label: string; title: string; description: string; kanbanTaskId?: number | null }>>().notNull().default([]),
  reportDate: timestamp("report_date"),
  sentAt: timestamp("sent_at"),
  clientStatus: text("client_status", { enum: ["pending", "accepted", "has_questions"] }).notNull().default("pending"),
  clientQuestion: text("client_question"),
  adminReply: text("admin_reply"),
  replyThread: jsonb("reply_thread").$type<Array<{ sender: "client" | "admin"; content: string; timestamp: string }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertStatusReport = typeof statusReportsTable.$inferInsert;
export type StatusReport = typeof statusReportsTable.$inferSelect;

// Ingested emails (from Microsoft Graph / Exchange)
export const emailsTable = pgTable("emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  subject: text("subject"),
  senderAddress: text("sender_address").notNull(),
  senderDomain: text("sender_domain").notNull(),
  bodyPreview: text("body_preview"),
  receivedAt: timestamp("received_at").notNull(),
  rawFrom: text("raw_from"),
  linkedUserId: integer("linked_user_id").references(() => usersTable.id),
  linkedProjectId: integer("linked_project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  linkedLeadId: integer("linked_lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  ingestedAt: timestamp("ingested_at").notNull().defaultNow(),
});

export type InsertEmail = typeof emailsTable.$inferInsert;
export type Email = typeof emailsTable.$inferSelect;

// Domain → client mapping rules for email auto-assignment
export const emailDomainRulesTable = pgTable("email_domain_rules", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  linkedUserId: integer("linked_user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertEmailDomainRule = typeof emailDomainRulesTable.$inferInsert;
export type EmailDomainRule = typeof emailDomainRulesTable.$inferSelect;

// Project Closures — sign-off & testimonial capture
export const projectClosuresTable = pgTable("project_closures", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique().references(() => projectsTable.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  feedback: text("feedback"),
  permissionGranted: boolean("permission_granted").notNull().default(false),
  signatureDataUrl: text("signature_data_url"),
  signedAt: timestamp("signed_at"),
  signerUserId: integer("signer_user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

export type InsertProjectClosure = typeof projectClosuresTable.$inferInsert;
export type ProjectClosure = typeof projectClosuresTable.$inferSelect;

// Audit Log — persistent chronological record of all admin and client actions
export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role", { enum: ["admin", "client"] }).notNull(),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  entityLabel: text("entity_label"),
  clientId: integer("client_id").references(() => usersTable.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
export type AuditLog = typeof auditLogsTable.$inferSelect;

// Asset Library — reusable workflow building blocks

export const assetLibraryCategoriesTable = pgTable("asset_library_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertAssetLibraryCategory = typeof assetLibraryCategoriesTable.$inferInsert;
export type AssetLibraryCategory = typeof assetLibraryCategoriesTable.$inferSelect;

export const instructionSetsTable = pgTable("instruction_sets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  instructions: jsonb("instructions").$type<string[]>().notNull().default([]),
  category: text("category").notNull().default("Generic"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertInstructionSet = typeof instructionSetsTable.$inferInsert;
export type InstructionSet = typeof instructionSetsTable.$inferSelect;

export const checklistsTable = pgTable("checklists", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  items: jsonb("items").$type<Array<{ id: string; label: string }>>().notNull().default([]),
  category: text("category").notNull().default("Generic"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertChecklist = typeof checklistsTable.$inferInsert;
export type Checklist = typeof checklistsTable.$inferSelect;

export const artifactSetsTable = pgTable("artifact_sets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  artifacts: jsonb("artifacts").$type<string[]>().notNull().default([]),
  category: text("category").notNull().default("Generic"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertArtifactSet = typeof artifactSetsTable.$inferInsert;
export type ArtifactSet = typeof artifactSetsTable.$inferSelect;

export const deliverableSetsTable = pgTable("deliverable_sets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  category: text("category").notNull().default("Generic"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertDeliverableSet = typeof deliverableSetsTable.$inferInsert;
export type DeliverableSet = typeof deliverableSetsTable.$inferSelect;

// Microsoft Graph webhook subscription tracking
export const graphSubscriptionsTable = pgTable("graph_subscriptions", {
  id: serial("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().unique(),
  resource: text("resource").notNull(),
  expirationDateTime: timestamp("expiration_date_time").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertGraphSubscription = typeof graphSubscriptionsTable.$inferInsert;
export type GraphSubscription = typeof graphSubscriptionsTable.$inferSelect;

// Key/value settings store
export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Microsoft 365 Environment Profile — one row per client, persisted as a JSONB blob
export const clientM365ProfilesTable = pgTable("client_m365_profiles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export interface QuizCategoryScores {
  infrastructure: number;
  data: number;
  aiLiteracy: number;
  changeManagement: number;
  businessProcess: number;
}

export interface QuizConversationEntry {
  role: "assistant" | "user";
  content: string;
}

// Quiz Leads — captures visitor lead info and AI-scored Copilot readiness quiz results
export interface QuizAnalysisText {
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
}

export const quizLeadsTable = pgTable("quiz_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  totalScore: integer("total_score").notNull().default(0),
  tier: text("tier").notNull().default("Beginner"),
  recommendedService: text("recommended_service"),
  categoryScores: jsonb("category_scores").$type<Record<string, number>>().notNull().default({ infrastructure: 0, data: 0, aiLiteracy: 0, changeManagement: 0, businessProcess: 0 }),
  analysisText: jsonb("analysis_text").$type<QuizAnalysisText>().default({ whatThisMeans: "", whyThisFits: "", roiProjection: "" }),
  leadOfferResult: jsonb("lead_offer_result").$type<{
    inferredSignals: { signalKey: string; confidence: number }[];
    candidates: {
      serviceId: number;
      serviceName: string;
      slug: string | null;
      title: string;
      rationale: string;
      basePriceCents: number;
      adjustedPriceCents: number;
      aiPricingReasoning: string | null;
      score: number;
      expirationDays: number;
    }[];
    generatedAt: string;
  } | null>().default(null),
  conversation: jsonb("conversation").$type<QuizConversationEntry[]>().notNull().default([]),
  quizType: text("quiz_type").notNull().default("copilot"),
  detectedSeats: integer("detected_seats"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  contactedAt: timestamp("contacted_at"),
});

export type InsertQuizLead = typeof quizLeadsTable.$inferInsert;
export type QuizLead = typeof quizLeadsTable.$inferSelect;

export type InsertClientM365Profile = typeof clientM365ProfilesTable.$inferInsert;
export type ClientM365Profile = typeof clientM365ProfilesTable.$inferSelect;

// Quiz Analytics Events — click-tracking for upsell CTA conversions
export const quizAnalyticsEventsTable = pgTable("quiz_analytics_events", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull(),
  properties: jsonb("properties").$type<Record<string, string | number | boolean>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Visitor identity bridge — resolves the durable smc_sid cookie session id to an
// email once a visitor identifies themselves (quiz submit, lead capture). Kept
// deliberately separate from the retired site-analytics tables below (issue #123)
// — this is the personalization layer's (public-personalization.ts) sole path
// from an anonymous cookie session to a known lead, not a traffic-analytics
// artifact, so it survives the homegrown tracker's retirement.
export const visitorIdentitiesTable = pgTable("visitor_identities", {
  sessionId: text("session_id").primaryKey(),
  email: text("email").notNull(),
  identifiedAt: timestamp("identified_at").notNull().defaultNow(),
});

export type InsertVisitorIdentity = typeof visitorIdentitiesTable.$inferInsert;
export type VisitorIdentity = typeof visitorIdentitiesTable.$inferSelect;

// ── Site Analytics ─────────────────────────────────────────────────────────────
// RETIRED (issue #123) — analytics_sessions/pageviews/site_events are no longer
// written to (routes/analytics.ts was deleted); the Drizzle definitions and
// tables themselves are left in place undropped because admin-marketing.ts's
// dashboard metrics still read them and repointing that is out of this issue's
// scope — see PLATFORM_BUILD.md's #123 entry for the full audit trail.
export const analyticsSessionsTable = pgTable("analytics_sessions", {
  sessionId: text("session_id").primaryKey(),
  entryPage: text("entry_page").notNull().default("/"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  deviceType: text("device_type"),
  browser: text("browser"),
  country: text("country"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  totalSeconds: integer("total_seconds").notNull().default(0),
  isBounce: boolean("is_bounce").notNull().default(true),
  identifiedEmail: text("identified_email"),
});

export const analyticsPageviewsTable = pgTable("analytics_pageviews", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  page: text("page").notNull(),
  title: text("title"),
  enteredAt: timestamp("entered_at").notNull().defaultNow(),
  exitedAt: timestamp("exited_at"),
  durationSeconds: integer("duration_seconds"),
  maxScrollPct: integer("max_scroll_pct").notNull().default(0),
});

export const analyticsSiteEventsTable = pgTable("analytics_site_events", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  page: text("page").notNull(),
  eventType: text("event_type").notNull(),
  elementLabel: text("element_label"),
  elementHref: text("element_href"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Email Templates — editable email copy stored in the database
export const emailTemplatesTable = pgTable("email_templates", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  variables: jsonb("variables").$type<Array<{ name: string; description: string }>>().notNull().default([]),
  recipientType: text("recipient_type", { enum: ["client", "admin"] }).notNull().default("client"),
  isCustomized: boolean("is_customized").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertEmailTemplate = typeof emailTemplatesTable.$inferInsert;
export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;

// Coupons / Promo Codes
export const couponsTable = pgTable("coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountType: text("discount_type", { enum: ["fixed", "percentage"] }).notNull(),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
  maxUses: integer("max_uses"),
  usesCount: integer("uses_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  requiresTestimonial: boolean("requires_testimonial").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Coupon = typeof couponsTable.$inferSelect;
export type InsertCoupon = typeof couponsTable.$inferInsert;

// Coupon Redemption History — one row per unique checkout session that used a coupon
export const couponRedemptionsTable = pgTable("coupon_redemptions", {
  id: serial("id").primaryKey(),
  couponCode: text("coupon_code").notNull(),
  checkoutSessionId: text("checkout_session_id").notNull().unique(),
  couponId: integer("coupon_id"),
  userId: integer("user_id"),
  purchaseAmount: numeric("purchase_amount", { precision: 10, scale: 2 }),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
});

export type CouponRedemption = typeof couponRedemptionsTable.$inferSelect;
export type InsertCouponRedemption = typeof couponRedemptionsTable.$inferInsert;

// Quick Win Quiz Results — persisted quiz submissions for shareable results pages
export const quickWinQuizResultsTable = pgTable("quick_win_quiz_results", {
  id: serial("id").primaryKey(),
  answers: jsonb("answers").$type<Record<string, number>>().notNull(),
  scores: jsonb("scores").$type<Record<string, number>>().notNull(),
  rankedSlugs: jsonb("ranked_slugs").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when identity capture promotes this anonymous result into a real
  // staged lead (#83). Null is the normal steady state — these rows carry no
  // name or email, so an unpromoted result has no identity to sync to Zoho.
  leadStagingId: integer("lead_staging_id").references(() => leadStagingTable.id, { onDelete: "set null" }),
});

export type InsertQuickWinQuizResult = typeof quickWinQuizResultsTable.$inferInsert;
export type QuickWinQuizResult = typeof quickWinQuizResultsTable.$inferSelect;

// Azure Tenant Credentials — per-customer Azure app registrations for script runner
export const azureTenantCredentialsTable = pgTable("azure_tenant_credentials", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  credentialType: text("credential_type", { enum: ["secret", "certificate"] }).notNull().default("secret"),
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertAzureTenantCredential = typeof azureTenantCredentialsTable.$inferInsert;
export type AzureTenantCredential = typeof azureTenantCredentialsTable.$inferSelect;

// Runbook job history — persistent audit trail for every Azure Automation job Shane runs
export const runbookJobHistoryTable = pgTable("runbook_job_history", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  runbookName: text("runbook_name").notNull(),
  credentialId: integer("credential_id").references(() => azureTenantCredentialsTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  status: text("status").notNull().default("New"),
  output: text("output"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertRunbookJobHistory = typeof runbookJobHistoryTable.$inferInsert;
export type RunbookJobHistory = typeof runbookJobHistoryTable.$inferSelect;

// Client App Registrations — Azure App Registration credentials submitted by clients for Script Runner
export interface PermissionCheckResult {
  granted: string[];
  missing: string[];
  unverifiable: string[];
  checkedAt: string;
}

export const clientAppRegistrationsTable = pgTable("client_app_registrations", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  azureClientId: text("azure_client_id").notNull(),
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  status: text("status", { enum: ["pending", "submitted", "verified"] }).notNull().default("pending"),
  submittedAt: timestamp("submitted_at"),
  verifiedAt: timestamp("verified_at"),
  connectionTestedAt: timestamp("connection_tested_at"),
  permissionCheck: jsonb("permission_check").$type<PermissionCheckResult>(),
  recheckLockedUntil: timestamp("recheck_locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertClientAppRegistration = typeof clientAppRegistrationsTable.$inferInsert;
export type ClientAppRegistration = typeof clientAppRegistrationsTable.$inferSelect;

// ── MFA (Multi-Factor Authentication) ─────────────────────────────────────────

export const mfaEnrollmentsTable = pgTable("mfa_enrollments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  method: text("method", { enum: ["totp", "sms", "passkey"] }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  encryptedSecret: text("encrypted_secret"),
  phone: text("phone"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertMfaEnrollment = typeof mfaEnrollmentsTable.$inferInsert;
export type MfaEnrollment = typeof mfaEnrollmentsTable.$inferSelect;

export const mfaChallengesTable = pgTable("mfa_challenges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  method: text("method", { enum: ["totp", "sms", "passkey"] }).notNull(),
  codeHash: text("code_hash"),
  phone: text("phone"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertMfaChallenge = typeof mfaChallengesTable.$inferInsert;
export type MfaChallenge = typeof mfaChallengesTable.$inferSelect;

// Emergency MFA bypass codes — a transient, single-use credential an MSP admin
// issues from customer-team.tsx when a user is locked out of MFA (lost device,
// no authenticator). Deliberately its OWN table, not a column on usersTable:
// this is a short-lived, consumable secret (hashed, expiring, single-use), not a
// persistent account attribute. At most one active row per user is enforced at
// generation time (delete-then-insert), matching the "one at a time" emergency
// escape-hatch nature of the feature. The plaintext code is shown to the admin
// exactly once; only the bcrypt hash is stored.
export const mfaBypassCodesTable = pgTable("mfa_bypass_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  // The admin (client-side team manager) who generated the code.
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Tenant scope captured at generation, for audit/reporting alongside the audit log.
  customerId: integer("customer_id"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedIp: text("used_ip"),
  usedUserAgent: text("used_user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertMfaBypassCode = typeof mfaBypassCodesTable.$inferInsert;
export type MfaBypassCode = typeof mfaBypassCodesTable.$inferSelect;

export const webauthnCredentialsTable = pgTable("webauthn_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: jsonb("transports").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertWebauthnCredential = typeof webauthnCredentialsTable.$inferInsert;
export type WebauthnCredential = typeof webauthnCredentialsTable.$inferSelect;

export const webauthnChallengesTable = pgTable("webauthn_challenges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  purpose: text("purpose", { enum: ["registration", "authentication"] }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertWebauthnChallenge = typeof webauthnChallengesTable.$inferInsert;
export type WebauthnChallenge = typeof webauthnChallengesTable.$inferSelect;

// ── Lead Qualification Engine ───────────────────────────────────────────────

export const opportunitiesTable = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  // Nullable as of #136 (Decommission Legacy CRM Phase B). `lead_staging` is now
  // the content source of truth, and a lead captured after that cutover has no
  // `leads` row at all — so an opportunity scored from it can only carry
  // `leadStagingId`. Rows created before the cutover keep their legacy pointer,
  // which is what the not-yet-re-pointed readers (opportunities.ts, inbox.ts,
  // admin-marketing.ts, ai-next-best-actions.ts) still join on.
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
  scoreSnapshot: integer("score_snapshot").notNull().default(0),
  scoreFit: integer("score_fit").notNull().default(0),
  scorePain: integer("score_pain").notNull().default(0),
  scoreMaturity: integer("score_maturity").notNull().default(0),
  scoreIntent: integer("score_intent").notNull().default(0),
  scoreUrgency: integer("score_urgency").notNull().default(0),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  recommendedNextStep: text("recommended_next_step"),
  workflowType: text("workflow_type"),
  state: text("state", { enum: ["new", "contacted", "qualified", "converted", "archived", "deleted"] }).notNull().default("new"),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── Zoho CRM (#83) ──
  // This row is now scoring EVIDENCE for a Zoho Deal, not the deal itself:
  // Zoho owns the opportunity once zoho_convert_lead / zoho_create_deal fires
  // and stamps the resulting Deal id here. The scoring columns above are
  // unchanged — no scoring logic moves to Zoho.
  zohoDealId: text("zoho_deal_id"),
  // Staged lead this evidence was scored from. Nullable and additive: the
  // existing leadId FK to `leads` stays live until #84 decommissions it.
  leadStagingId: integer("lead_staging_id").references(() => leadStagingTable.id, { onDelete: "set null" }),
});

export type InsertOpportunity = typeof opportunitiesTable.$inferInsert;
export type Opportunity = typeof opportunitiesTable.$inferSelect;

export const opportunityTasksTable = pgTable("opportunity_tasks", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunitiesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  assignedTo: text("assigned_to").notNull().default("Shane"),
  status: text("status", { enum: ["todo", "in_progress", "done"] }).notNull().default("todo"),
  kanbanTaskId: integer("kanban_task_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertOpportunityTask = typeof opportunityTasksTable.$inferInsert;
export type OpportunityTask = typeof opportunityTasksTable.$inferSelect;

export const leadQualificationsTable = pgTable("lead_qualifications", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  newScore: integer("new_score").notNull(),
  previousScore: integer("previous_score").notNull().default(0),
  stage: text("stage", { enum: ["Warm", "Hot"] }).notNull(),
  recommendedNextStep: text("recommended_next_step"),
  workflowType: text("workflow_type"),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  scoreFit: integer("score_fit").notNull().default(0),
  scorePain: integer("score_pain").notNull().default(0),
  scoreMaturity: integer("score_maturity").notNull().default(0),
  scoreIntent: integer("score_intent").notNull().default(0),
  scoreUrgency: integer("score_urgency").notNull().default(0),
  status: text("status", { enum: ["pending", "approved", "rejected", "snoozed"] }).notNull().default("pending"),
  snoozedUntil: timestamp("snoozed_until"),
  opportunityId: integer("opportunity_id").references(() => opportunitiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── Zoho CRM (#83) ──
  // Scoring-evidence side-record: engine output is unchanged, it just gains a
  // pointer to the Zoho Deal the qualification ultimately produced.
  zohoDealId: text("zoho_deal_id"),
  leadStagingId: integer("lead_staging_id").references(() => leadStagingTable.id, { onDelete: "set null" }),
});

export type InsertLeadQualification = typeof leadQualificationsTable.$inferInsert;
export type LeadQualification = typeof leadQualificationsTable.$inferSelect;

// Inbox Message Links — links a Graph message ID to CRM entities and tasks
export const inboxMessageLinksTable = pgTable("inbox_message_links", {
  id: serial("id").primaryKey(),
  graphMessageId: text("graph_message_id").notNull().unique(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  opportunityId: integer("opportunity_id").references(() => opportunitiesTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  taskId: integer("task_id").references(() => kanbanTasksTable.id, { onDelete: "set null" }),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull().default("inbound"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertInboxMessageLink = typeof inboxMessageLinksTable.$inferInsert;
export type InboxMessageLink = typeof inboxMessageLinksTable.$inferSelect;

// ── Intelligence Layer ──────────────────────────────────────────────────────────

// Next Best Actions — AI-generated action recommendations for Shane
export const nextBestActionsTable = pgTable("next_best_actions", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type", { enum: ["client", "project", "lead", "opportunity", "general"] }).notNull().default("general"),
  entityId: integer("entity_id"),
  entityName: text("entity_name"),
  action: text("action").notNull(),
  rationale: text("rationale"),
  confidence: integer("confidence").notNull().default(50),
  linkPath: text("link_path"),
  resolvedAt: timestamp("resolved_at"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertNextBestAction = typeof nextBestActionsTable.$inferInsert;
export type NextBestAction = typeof nextBestActionsTable.$inferSelect;

// Revenue Forecasts — AI-generated monthly revenue predictions
export const revenueForecastsTable = pgTable("revenue_forecasts", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  forecast: numeric("forecast", { precision: 12, scale: 2 }).notNull(),
  lowerBound: numeric("lower_bound", { precision: 12, scale: 2 }).notNull(),
  upperBound: numeric("upper_bound", { precision: 12, scale: 2 }).notNull(),
  narrative: text("narrative"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertRevenueForecast = typeof revenueForecastsTable.$inferInsert;
export type RevenueForecast = typeof revenueForecastsTable.$inferSelect;

// Client Health History — daily snapshots of M365 health scores per client per category
export const clientHealthHistoryTable = pgTable("client_health_history", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  category: text("category", {
    enum: ["governance", "security", "compliance", "copilot", "identity", "collaboration", "productivity", "data"],
  }).notNull(),
  score: integer("score").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  sourceKanbanTaskId: integer("source_kanban_task_id").references(() => kanbanTasksTable.id, { onDelete: "set null" }),
});

export type InsertClientHealthHistory = typeof clientHealthHistoryTable.$inferInsert;
export type ClientHealthHistory = typeof clientHealthHistoryTable.$inferSelect;

// Quiz Pain Signal Config — single-row admin-editable config for quiz→pain mappings
// ── Marketing Command Center ────────────────────────────────────────────────

export const recommendedLeadsTable = pgTable("recommended_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  role: text("role"),
  email: text("email"),
  phone: text("phone"),
  industry: text("industry"),
  companySize: text("company_size"),
  location: text("location"),
  painPoints: jsonb("pain_points").$type<string[]>().notNull().default([]),
  whyFit: text("why_fit"),
  recommendedService: text("recommended_service"),
  confidence: integer("confidence").notNull().default(0),
  status: text("status", { enum: ["pending", "converted", "dismissed"] }).notNull().default("pending"),
  // ── Zoho CRM (#83) ──
  // Was `convertedLeadId` (FK → leads.id). A converted recommendation now
  // becomes a staged lead immediately (convertedLeadStagingId) and a Zoho Lead
  // asynchronously (convertedZohoLeadId, stamped by the sync handler once the
  // 5-minute drain has actually pushed it) — the local pointer is kept because
  // at conversion time no Zoho id exists yet.
  convertedZohoLeadId: text("converted_zoho_lead_id"),
  convertedLeadStagingId: integer("converted_lead_staging_id").references(() => leadStagingTable.id, { onDelete: "set null" }),
  lastOutreachDraft: text("last_outreach_draft"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertRecommendedLead = typeof recommendedLeadsTable.$inferInsert;
export type RecommendedLead = typeof recommendedLeadsTable.$inferSelect;

export const outreachTemplatesTable = pgTable("outreach_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  templateType: text("template_type", { enum: ["cold_email", "linkedin", "followup", "cold_call"] }).notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertOutreachTemplate = typeof outreachTemplatesTable.$inferInsert;
export type OutreachTemplate = typeof outreachTemplatesTable.$inferSelect;

export const heroHeadlinesTable = pgTable("hero_headlines", {
  id: serial("id").primaryKey(),
  leadText: text("lead_text").notNull(),
  gradientText: text("gradient_text").notNull(),
  active: boolean("active").notNull().default(true),
  seasonalLabel: text("seasonal_label"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertHeroHeadline = typeof heroHeadlinesTable.$inferInsert;
export type HeroHeadline = typeof heroHeadlinesTable.$inferSelect;

export const marketingTasksTable = pgTable("marketing_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["ideas", "in_progress", "scheduled", "published", "completed", "money_task"] }).notNull().default("ideas"),
  order: integer("order").notNull().default(0),
  dueDate: timestamp("due_date"),
  relatedLeadId: integer("related_lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  relatedCampaignId: integer("related_campaign_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertMarketingTask = typeof marketingTasksTable.$inferInsert;
export type MarketingTask = typeof marketingTasksTable.$inferSelect;

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  audience: text("audience").notNull(),
  offer: text("offer").notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "completed"] }).notNull().default("draft"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  // Linked offer (optional — FK enforced at DB level, see migration 0070)
  offerId: integer("offer_id"),
  // Performance metrics — manually updated by Shane
  leadsGenerated: integer("leads_generated").notNull().default(0),
  emailsSent: integer("emails_sent").notNull().default(0),
  revenueAttributed: numeric("revenue_attributed", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertCampaign = typeof campaignsTable.$inferInsert;
export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignAssetsTable = pgTable("campaign_assets", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }),
  assetType: text("asset_type", { enum: ["landing_copy", "email_sequence", "social_post", "follow_up_task", "blog_post", "linkedin_post", "newsletter", "seo_keywords", "lead_magnet", "ad_google", "ad_linkedin", "ad_retargeting", "ad_creative", "landing_page"] }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  generatedWithOfferIds: jsonb("generated_with_offer_ids").$type<number[] | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertCampaignAsset = typeof campaignAssetsTable.$inferInsert;
export type CampaignAsset = typeof campaignAssetsTable.$inferSelect;

// Content Studio — LinkedIn post scheduling (Phase F, Git #686, epic #601).
// Backs contentStudioStore.ts's admin-panel store: status/body/scheduledFor
// map straight onto the `post` peek's fields, and the id round-trips as a
// string on the client side the same way campaign ids do. engagementSnapshot
// stays null until Community Management API access exists — nothing in this
// phase writes it.
export const contentPostsTable = pgTable("content_posts", {
  id: serial("id").primaryKey(),
  body: text("body").notNull().default(""),
  mediaRefs: jsonb("media_refs").$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["draft", "scheduled", "posted", "failed"] }).notNull().default("draft"),
  scheduledFor: timestamp("scheduled_for"),
  platform: text("platform").notNull().default("linkedin"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  engagementSnapshot: jsonb("engagement_snapshot").$type<Record<string, unknown> | null>().default(null),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertContentPost = typeof contentPostsTable.$inferInsert;
export type ContentPost = typeof contentPostsTable.$inferSelect;

export const quizPainSignalConfigTable = pgTable("quiz_pain_signal_config", {
  id: serial("id").primaryKey(),
  quizTypePainMap: jsonb("quiz_type_pain_map").$type<Record<string, string[]>>().notNull().default({}),
  categoryPainMap: jsonb("category_pain_map").$type<[string, string][]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuizPainSignalConfig = typeof quizPainSignalConfigTable.$inferSelect;

// Client Documents — files / records attached to a client (not project-scoped)
export const clientDocumentsTable = pgTable("client_documents", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category", { enum: ["contracts", "reports", "proposals", "deliverables", "assessments", "misc"] }).notNull().default("misc"),
  description: text("description"),
  fileUrl: text("file_url"),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertClientDocument = typeof clientDocumentsTable.$inferInsert;
export type ClientDocument = typeof clientDocumentsTable.$inferSelect;

// ── Email Events ─────────────────────────────────────────────────────────────

export const emailEventsTable = pgTable("email_events", {
  id: serial("id").primaryKey(),
  emailId: text("email_id").notNull(),
  eventType: text("event_type", { enum: ["sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed"] }).notNull(),
  recipient: text("recipient"),
  subject: text("subject"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
});

export type InsertEmailEvent = typeof emailEventsTable.$inferInsert;
export type EmailEvent = typeof emailEventsTable.$inferSelect;

// ── SEO Rankings ─────────────────────────────────────────────────────────────

export const seoRankingsTable = pgTable("seo_rankings", {
  id: serial("id").primaryKey(),
  keyword: text("keyword").notNull(),
  position: integer("position").notNull(),
  previousPosition: integer("previous_position"),
  url: text("url"),
  searchVolume: integer("search_volume"),
  notes: text("notes"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertSeoRanking = typeof seoRankingsTable.$inferInsert;
export type SeoRanking = typeof seoRankingsTable.$inferSelect;

// ── Lead Intent Events (hot-score signal stream) ─────────────────────────────

export const leadIntentEventsTable = pgTable("lead_intent_events", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["email_open", "link_click", "cta_click", "site_visit", "form_submit", "reply"] }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

export type InsertLeadIntentEvent = typeof leadIntentEventsTable.$inferInsert;
export type LeadIntentEvent = typeof leadIntentEventsTable.$inferSelect;

// ── Follow-Up Events ──────────────────────────────────────────────────────────

export const followUpEventsTable = pgTable("follow_up_events", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  completedAt: timestamp("completed_at"),
  channel: text("channel", { enum: ["email", "linkedin", "phone", "other"] }).notNull().default("email"),
  subject: text("subject"),
  aiDraftContent: text("ai_draft_content"),
  status: text("status", { enum: ["pending", "completed", "overdue", "skipped"] }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertFollowUpEvent = typeof followUpEventsTable.$inferInsert;
export type FollowUpEvent = typeof followUpEventsTable.$inferSelect;

// ── Offers ────────────────────────────────────────────────────────────────────

export const offersTable = pgTable("offers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  audience: text("audience").notNull(),
  pricing: text("pricing"),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  outcomes: jsonb("outcomes").$type<string[]>().notNull().default([]),
  cta: text("cta"),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertOffer = typeof offersTable.$inferInsert;
export type Offer = typeof offersTable.$inferSelect;

// ── Landing Pages ─────────────────────────────────────────────────────────────

export const landingPagesTable = pgTable("landing_pages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  headline: text("headline"),
  subheadline: text("subheadline"),
  valuePropBlocks: jsonb("value_prop_blocks").$type<Array<{ icon?: string; heading: string; body: string }>>().notNull().default([]),
  socialProof: jsonb("social_proof").$type<Array<{ quote: string; author: string; role?: string }>>().notNull().default([]),
  cta: jsonb("cta").$type<{ buttonText: string; href: string; subtext?: string }>().default({ buttonText: "Get Started", href: "/contact" }),
  layoutBlocks: jsonb("layout_blocks").$type<Array<{ blockType: string; content: unknown }>>().notNull().default([]),
  linkedServiceId: integer("linked_service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertLandingPage = typeof landingPagesTable.$inferInsert;
export type LandingPage = typeof landingPagesTable.$inferSelect;

// ── M365 Command Center ───────────────────────────────────────────────────────

// Script Run Results — persisted results for every script execution
export const scriptRunResultsTable = pgTable("script_run_results", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  scriptId: integer("script_id"),
  libraryScriptId: uuid("library_script_id").references(() => powershellScriptsTable.id, { onDelete: "set null" }),
  packageId: integer("package_id").references(() => servicesTable.id, { onDelete: "set null" }),
  jobId: text("job_id"),
  rawOutput: jsonb("raw_output").$type<Record<string, unknown>>().notNull().default({}),
  parsedFindings: jsonb("parsed_findings").$type<string[]>().notNull().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().notNull().default([]),
  scoreImpact: jsonb("score_impact").$type<Record<string, number>>().notNull().default({}),
  profileUpdates: jsonb("profile_updates").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["running", "completed", "failed", "awaiting_upload"] }).notNull().default("running"),
  executionSource: text("execution_source", { enum: ["automated", "manual", "customer_upload"] }).notNull().default("automated"),
  kanbanTaskId: integer("kanban_task_id").references(() => kanbanTasksTable.id, { onDelete: "set null" }),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  scriptName: text("script_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertScriptRunResult = typeof scriptRunResultsTable.$inferInsert;
export type ScriptRunResult = typeof scriptRunResultsTable.$inferSelect;

// Client Callback Tokens — embedded in downloaded .ps1 scripts so results auto-POST back
export const clientCallbackTokensTable = pgTable("client_callback_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull().default(""),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  scriptRunResultId: integer("script_run_result_id").references(() => scriptRunResultsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
}, (t) => [index("client_callback_tokens_project_id_idx").on(t.projectId)]);

export type InsertClientCallbackToken = typeof clientCallbackTokensTable.$inferInsert;
export type ClientCallbackToken = typeof clientCallbackTokensTable.$inferSelect;

// Client Scores — upsert table tracking M365 health scores per client
export const clientScoresTable = pgTable("client_scores", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  identity: integer("identity").notNull().default(0),
  security: integer("security").notNull().default(0),
  collaboration: integer("collaboration").notNull().default(0),
  compliance: integer("compliance").notNull().default(0),
  copilotReadiness: integer("copilot_readiness").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertClientScore = typeof clientScoresTable.$inferInsert;
export type ClientScore = typeof clientScoresTable.$inferSelect;

// PowerShell Script Library — AI-generated scripts stored by Shane
export interface PsScriptPermissions {
  appPermissions: { scope: string; reason: string }[];
  delegatedPermissions: string[];
  notes: string;
  /** AI-analyzed detail for Application permissions — optional, set by analyze-permissions endpoint */
  appPermissionDetails?: { name: string; description: string }[];
  /** AI-analyzed detail for Delegated permissions — optional, set by analyze-permissions endpoint */
  delegatedPermissionDetails?: { name: string; description: string }[];
}

export const powershellScriptsTable = pgTable("powershell_scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull().default("other"),
  scriptBody: text("script_body").notNull(),
  permissions: jsonb("permissions").$type<PsScriptPermissions>().notNull().default({ appPermissions: [], delegatedPermissions: [], notes: "" }),
  tags: text("tags").array().notNull().default([]),
  azureSyncedAt: timestamp("azure_synced_at", { withTimezone: true }),
  platformPublished: boolean("platform_published").notNull().default(false),
  scriptType: text("script_type"),
  schemaVersion: text("schema_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertPowershellScript = typeof powershellScriptsTable.$inferInsert;
export type PowershellScript = typeof powershellScriptsTable.$inferSelect;

// Script Download Tokens — single-use, scoped tokens injected into downloaded script bodies
// for token-authenticated results ingestion (no session required).
export const scriptDownloadTokensTable = pgTable("script_download_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  scriptId: uuid("script_id").notNull().references(() => powershellScriptsTable.id, { onDelete: "cascade" }),
  mspId: integer("msp_id"),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  clientUserId: integer("client_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  runResultId: integer("run_result_id").references(() => scriptRunResultsTable.id, { onDelete: "set null" }),
  label: text("label").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertScriptDownloadToken = typeof scriptDownloadTokensTable.$inferInsert;
export type ScriptDownloadToken = typeof scriptDownloadTokensTable.$inferSelect;

export const scriptPackagesTable = pgTable("script_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  category: text("category").notNull().default("other"),
  permissions: jsonb("permissions").$type<PsScriptPermissions>().notNull().default({ appPermissions: [], delegatedPermissions: [], notes: "" }),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertScriptPackage = typeof scriptPackagesTable.$inferInsert;
export type ScriptPackage = typeof scriptPackagesTable.$inferSelect;

export const scriptModulesTable = pgTable("script_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id").notNull().references(() => scriptPackagesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  sourceScriptId: uuid("source_script_id"),
  sourceTaskIds: integer("source_task_ids").array(),
  azureSyncedAt: timestamp("azure_synced_at", { withTimezone: true }),
  permissions: jsonb("permissions").$type<PsScriptPermissions>().default({ appPermissions: [], delegatedPermissions: [], notes: "" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertScriptModule = typeof scriptModulesTable.$inferInsert;
export type ScriptModule = typeof scriptModulesTable.$inferSelect;


// ─── Client Automation Runs — tracks sequential script package execution ──────
export const clientAutomationRunsTable = pgTable("client_automation_runs", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  status: text("status", { enum: ["pending", "running", "completed", "failed"] }).notNull().default("pending"),
  currentPackageId: uuid("current_package_id"),
  currentModuleId: uuid("current_module_id"),
  modulesCompleted: integer("modules_completed").notNull().default(0),
  modulesTotal: integer("modules_total").notNull().default(0),
  lastLogSnippet: text("last_log_snippet"),
  errorMessage: text("error_message"),
  finishedAt: timestamp("finished_at"),
});

export type InsertClientAutomationRun = typeof clientAutomationRunsTable.$inferInsert;
export type ClientAutomationRun = typeof clientAutomationRunsTable.$inferSelect;

// ── Insights & Outputs — generated documents (reports + consulting deliverables)
export const insightsGeneratedDocumentsTable = pgTable("insights_generated_documents", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  /**
   * The owning TENANT (`msp_customers.id`) — the real scoping key for a
   * generated document.
   *
   * `customerId` above is a `users.id`: one arbitrary login out of however many
   * a tenant has, which made every customer-scoped read go through the
   * `msp_users` bridge (`inArray(customerId, resolveCustomerUserIds(...))`) and
   * made a document unfindable if that particular login was ever unlinked.
   * This column owns the document by tenant directly. `customerId` is retained
   * as the document OWNER (which login generated/receives it), not as the scope.
   *
   * NOT NULL as of manual migration File B
   * (`2026-07-28-igd-msp-customer-id-B-not-null-and-index.sql`), which Shane ran
   * after File A's straggler count came back zero. The TS definition was
   * deliberately left nullable during the window between the two files — real
   * rows could hold NULL then, so `.notNull()` would have made every read lie —
   * and is brought back into line with the DB column here.
   *
   * Every writer already populated it unconditionally and refused to insert
   * without it, so this changes no runtime behavior; it only stops selects from
   * typing a column that can no longer be NULL as `number | null`.
   */
  mspCustomerId: integer("msp_customer_id").notNull(), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  category: text("category", { enum: ["report", "consulting"] }).notNull().default("report"),
  docType: text("doc_type").notNull().default("other"),
  title: text("title").notNull(),
  htmlContent: text("html_content").notNull().default(""),
  pdfUrl: text("pdf_url"),
  status: text("status", { enum: ["draft", "approved", "delivered", "archived", "generating", "failed"] }).notNull().default("draft"),
  approvedAt: timestamp("approved_at"),
  deliveredAt: timestamp("delivered_at"),
  // Parsed pricing extracted from SOW/Consolidated SOW — used to populate the
  // presentation Scope step and Overview total.
  // Schema evolution: add new optional fields here; old rows deserialise with
  // the field `undefined`, which is safe for all optional properties.
  // The canonical runtime type is `SowPricingLine` from @workspace/api-server
  // lib/sow-pricing.ts (validated by SowPricingLineSchema).
  sowPricingLines: jsonb("sow_pricing_lines").$type<Array<{
    title: string;
    scope: string;
    priceUsd: number;
    notes: string;
    /** "workstream" = customer-toggleable phase; "adjustment" = mandatory price modifier. */
    line_type?: "workstream" | "adjustment";
    /** Estimated duration in weeks for this workstream phase. */
    weeks?: number;
    /**
     * ISO-8601 date (YYYY-MM-DD) computed at generation time as
     * nextBusinessMonday + cumulative weeks. Stored so regenerated SOWs
     * reproduce the same schedule rather than drifting with the clock.
     */
    deliveryDate?: string;
  }>>(),
  sowTotalPrice: numeric("sow_total_price", { precision: 12, scale: 2 }),
  errorMessage: text("error_message"),
  /**
   * "OMG cards" — AI-extracted, attention-grabbing findings for the customer-facing
   * Assessment Results Viewer. Each card is one alarming/notable finding from this
   * document, with a color-coded severity and a large headline number (a dollar
   * estimate, risk count, etc.). Extracted lazily on first customer view of the
   * document (see omg-card-extractor.ts) and persisted here so subsequent views —
   * and every re-render — read the stored cards rather than re-running the AI call.
   * NULL = not yet extracted; [] = extraction ran and found nothing card-worthy.
   */
  omgCards: jsonb("omg_cards").$type<Array<{
    /** Traffic-light severity driving the card's color treatment. */
    severity: "red" | "amber" | "green";
    /** The big, attention-grabbing figure, pre-formatted for display (e.g. "$18,000", "0", "23"). */
    metric: string;
    /** Short qualifier rendered beneath the metric (e.g. "per year wasted", "MFA-exempt admins"). */
    metricLabel: string;
    /** Punchy, human headline for the finding (e.g. "Your admins can sign in without MFA"). */
    headline: string;
    /** One-sentence plain-language explanation of why this matters. */
    detail: string;
  }>>(),
  /** When omgCards was populated — set alongside omgCards, cleared implicitly when a regenerated document overwrites the row. */
  omgCardsGeneratedAt: timestamp("omg_cards_generated_at"),
  // The real, structured, scoped data actually used to generate this document —
  // scoped profile entries, scoped findings, and (for pipeline_output documents
  // like SOW) the real Sales Offer Engine candidates used. Populated at
  // generation time going forward; null for documents generated before this
  // existed (no retroactive backfill). This is what lets downstream generation
  // (SOW reading prior documents, OMG card generation) read real structured
  // truth directly instead of re-parsing rendered HTML content.
  generationInput: jsonb("generation_input").$type<{
    scopedProfile: Record<string, unknown>;
    scopedFindings: string[];
    salesOfferCandidates?: {
      serviceId: number;
      serviceName: string;
      rationale: string;
      adjustedPriceCents: number;
      firedSignalKeys: string[];
    }[];
  }>(),
  /**
   * Populated at SOW generation time by the signal conflict detector.
   * Indicates whether signal filtering ran cleanly or had conflicting rules
   * that may have caused an incorrect project list.
   * Shape: { clean: boolean; conflictCount: number; conflicts?: Array<{ ruleIds: number[]; description: string }> }
   */
  signalFilterMeta: jsonb("signal_filter_meta").$type<{
    clean: boolean;
    conflictCount: number;
    conflicts?: Array<{ ruleIds: number[]; description: string }>;
  }>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Partial unique indexes for scoped SOW upsert — two are needed because NULL != NULL
  // in a standard unique constraint, so project_id IS NULL requires its own index.
  uniqueIndex("igd_scoped_sow_with_project_uidx")
    .on(t.customerId, t.projectId, t.docType)
    .where(sql`doc_type = 'scoped_sow' AND project_id IS NOT NULL`),
  uniqueIndex("igd_scoped_sow_no_project_uidx")
    .on(t.customerId, t.docType)
    .where(sql`doc_type = 'scoped_sow' AND project_id IS NULL`),
  // Serves the tenant-scoped document reads: "this tenant's documents of this
  // type, newest first". Created by manual migration File B, NOT File A.
  index("igd_msp_customer_doc_type_created_idx").on(t.mspCustomerId, t.docType, t.createdAt),
]);

export type InsertInsightsGeneratedDocument = typeof insightsGeneratedDocumentsTable.$inferInsert;
export type InsightsGeneratedDocument = typeof insightsGeneratedDocumentsTable.$inferSelect;

// ── Assessment SOW agreements — signature + payment for the Assessment wizard ──
//
// One row per time an Assessment customer signs a consolidated_sow scope and
// chooses a payment plan (the Assessment "payment plan" step). This is the
// signature + payment record that insights_generated_documents itself has no
// columns for — the SOW document row holds scope/pricing, this row holds the
// legally-binding acceptance (drawn signature tied to the exact scope + price the
// customer saw), the chosen plan, and the checkout/payment lifecycle.
//
// Deliberately its own table rather than columns on insights_generated_documents:
// that table is generic across report/consulting/SOW doc types and re-scoping
// archives+replaces the active SOW row, so signature/payment state must not live
// on a row that gets superseded. docId pins the exact signed version.
//
// docId / checkoutSessionId (Git #603, Epic #597 stage 5):
// Exactly one of the two names what was signed. The ORIGINAL customer-sow.tsx
// flow always has a stored `insights_generated_documents` row (docId). The
// live-scope cart flow (#598-#602) reads the Sales Offer Engine directly —
// `journeyScopeFromOffers()` always returns `docId: null`, there being no
// stored document to point at — and instead names the `checkout_sessions` row
// (#598) that snapshotted the signed scope + price. docId went nullable, and
// checkoutSessionId was added, rather than forcing the live flow to fabricate
// a document row, so this table can record either kind of signature honestly.
//
// paymentPlan:
//   "full"   — pay-in-full; charged immediately (real coupon discount, either
//              via Assessment-scoped Stripe Checkout for the docId flow, or
//              inline via the checkout-session PaymentIntent for the
//              checkoutSessionId flow). status flows pending_payment → paid.
//   "phased" — milestone billing. On the docId flow, the platform's per-phase
//              auto-invoicing (create_phased_invoices / edit_stripe_invoice) is
//              bound to the CRM quick_win_presentations + projects entity space
//              and cannot resolve an Assessment consolidated_sow, so phased is
//              captured as a signed agreement handed to the provider (status
//              awaiting_provider_setup), NOT a self-serve Stripe charge. See
//              portal-assessment.ts Task-5 section for the full blocker
//              write-up. The checkoutSessionId flow's own self-serve phased
//              billing is a separate, not-yet-built stage (split out of #603).
export const assessmentSowAgreementsTable = pgTable("assessment_sow_agreements", {
  id: serial("id").primaryKey(),
  // The exact signed consolidated_sow version (insights_generated_documents.id).
  // Nullable — see the docId / checkoutSessionId note above.
  docId: integer("doc_id").references(() => insightsGeneratedDocumentsTable.id, { onDelete: "cascade" }),
  // The exact signed checkout_sessions row (#598), for the live-scope cart
  // flow. Nullable — see the docId / checkoutSessionId note above.
  checkoutSessionId: uuid("checkout_session_id").references(() => checkoutSessionsTable.id, { onDelete: "cascade" }),
  // The Assessment customer (users.id — same id space as insights_generated_documents.customer_id).
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // msp_customers.id + msp.id for tenant scoping / telemetry (nullable — resolved from JWT claims).
  customerId: integer("customer_id"),
  mspId: integer("msp_id"),
  // Scope snapshot at signing — the workstream titles the customer accepted, plus a
  // normalized key for integrity checks against the document's current scope.
  selectedWorkstreamTitles: jsonb("selected_workstream_titles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  scopeKey: text("scope_key").notNull().default(""),
  // Pricing captured at signing, in cents (matches what Stripe is charged).
  agreedTotalCents: integer("agreed_total_cents").notNull(),
  discountedTotalCents: integer("discounted_total_cents"),
  couponCode: text("coupon_code"),
  windowStateAtSigning: text("window_state_at_signing", { enum: ["discount", "standard", "expired"] }),
  paymentPlan: text("payment_plan", { enum: ["full", "phased"] }).notNull(),
  // Drawn-signature PNG data URL + typed legal name (same contract as customer-sow.tsx).
  signatureData: text("signature_data").notNull(),
  signerName: text("signer_name").notNull(),
  signatureIp: text("signature_ip"),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
  // Checkout / payment lifecycle.
  status: text("status", {
    enum: ["pending_payment", "paid", "awaiting_provider_setup", "free_activated"],
  }).notNull().default("pending_payment"),
  // Hosted Stripe Checkout Session id — the docId flow's own charge (`cs_…`).
  stripeSessionId: text("stripe_session_id"),
  // Embedded Stripe PaymentIntent id — the checkoutSessionId flow's own charge
  // (`pi_…`), a different Stripe object than stripeSessionId above.
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("asa_doc_idx").on(t.docId),
  index("asa_client_user_idx").on(t.clientUserId),
  uniqueIndex("asa_stripe_session_uidx").on(t.stripeSessionId).where(sql`stripe_session_id IS NOT NULL`),
  uniqueIndex("asa_stripe_payment_intent_uidx").on(t.stripePaymentIntentId).where(sql`stripe_payment_intent_id IS NOT NULL`),
  // One agreement per checkout session — guards the same "don't record it
  // twice" doctrine the docId flow enforces in application code.
  uniqueIndex("asa_checkout_session_uidx").on(t.checkoutSessionId).where(sql`checkout_session_id IS NOT NULL`),
  check("asa_doc_or_session_check", sql`${t.docId} IS NOT NULL OR ${t.checkoutSessionId} IS NOT NULL`),
]);

export type InsertAssessmentSowAgreement = typeof assessmentSowAgreementsTable.$inferInsert;
export type AssessmentSowAgreement = typeof assessmentSowAgreementsTable.$inferSelect;

// ── Insights & Outputs — recurring automation schedules ───────────────────────
export const insightsAutomationsTable = pgTable("insights_automations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  automationType: text("automation_type", {
    enum: ["monthly_tenant_health_report", "quarterly_governance_review", "weekly_security_drift_alerts", "license_waste_monitoring", "conditional_access_drift_detection"],
  }).notNull().default("monthly_tenant_health_report"),
  cronExpression: text("cron_expression").notNull().default("0 9 1 * *"),
  enabled: boolean("enabled").notNull().default(true),
  linkedRunbookScriptId: text("linked_runbook_script_id"),
  generateDocument: boolean("generate_document").notNull().default(true),
  lastRunAt:  timestamp("last_run_at"),
  nextRunAt:  timestamp("next_run_at"),
  runningAt:  timestamp("running_at"),
  lastRunLog: jsonb("last_run_log").$type<{ ts: string; level: "info" | "warn" | "error"; message: string }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertInsightsAutomation = typeof insightsAutomationsTable.$inferInsert;
export type InsightsAutomation = typeof insightsAutomationsTable.$inferSelect;

// ─── Blog Articles (formerly Markdown files on disk) ──────────────────────────
export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull().default(""),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  date: text("date").notNull(),
  content: text("content").notNull().default(""),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertArticle = typeof articlesTable.$inferInsert;
export type Article = typeof articlesTable.$inferSelect;

// ─── AI Prompts — centralised, DB-backed prompt management ────────────────────
export const aiPromptsTable = pgTable("ai_prompts", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category", { enum: ["scripting", "marketing", "advisory", "inbox", "classification", "artifacts", "insights"] }).notNull(),
  featureArea: text("feature_area").notNull().default(""),
  featureRoute: text("feature_route").notNull().default(""),
  model: text("model"),
  // Published body — this is what getPrompt()/runtime generation flows read.
  promptBody: text("prompt_body").notNull(),
  defaultBody: text("default_body").notNull(),
  // Unpublished draft body. Null when there is no pending draft (i.e. the
  // published body is the latest saved content). Never read by runtime
  // generation flows — only surfaced in the admin editor and the Test Draft flow.
  draftBody: text("draft_body"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiPrompt = typeof aiPromptsTable.$inferSelect;
export type InsertAiPrompt = typeof aiPromptsTable.$inferInsert;

// ── AI Prompt version history ──────────────────────────────────────────────
// Every save (draft save, publish, or reset) creates one row here so admins
// can review and revert to any prior version of a prompt.
export const aiPromptVersionsTable = pgTable("ai_prompt_versions", {
  id: serial("id").primaryKey(),
  promptId: integer("prompt_id").notNull().references(() => aiPromptsTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  body: text("body").notNull(),
  action: text("action", { enum: ["draft", "publish", "reset"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiPromptVersion = typeof aiPromptVersionsTable.$inferSelect;
export type InsertAiPromptVersion = typeof aiPromptVersionsTable.$inferInsert;

// Web push subscriptions (browser-level push notifications for admin)
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("push_subscriptions_user_endpoint_uidx").on(t.userId, t.endpoint)]);

export type InsertPushSubscription = typeof pushSubscriptionsTable.$inferInsert;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;

// ── Quick Win Presentation sessions ───────────────────────────────────────────
export const quickWinPresentationsTable = pgTable("quick_win_presentations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  clientUserId: integer("client_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  shareToken: text("share_token").unique(),
  documentsIncluded: jsonb("documents_included").$type<number[]>(),
  sowPhases: jsonb("sow_phases").$type<Array<{
    id: string;
    title: string;
    description: string;
    price: number;
    selected: boolean;
  }>>(),
  selectedPhaseIds: jsonb("selected_phase_ids").$type<string[]>(),
  totalPrice: numeric("total_price"),
  signatureData: text("signature_data"),
  signedAt: timestamp("signed_at"),
  signerName: text("signer_name"),
  paymentPlan: text("payment_plan", { enum: ["full", "phased"] }),
  stripeSessionId: text("stripe_session_id"),
  paymentSchedule: jsonb("payment_schedule"),
  status: text("status", { enum: ["draft", "signed", "paid"] }).notNull().default("draft"),
  scopedSowHtml: text("scoped_sow_html"),
  scopedTotalPrice: integer("scoped_total_price"),
  scopedPhaseIds: jsonb("scoped_phase_ids").$type<string[]>(),
  scopedSowVersion: text("scoped_sow_version"),
  firstVisitedAt: timestamp("first_visited_at"),
  phaseGenRequestedAt: timestamp("phase_gen_requested_at"),
  payTodayDiscountApplied: boolean("pay_today_discount_applied").default(false),
  discountedTotalCents: integer("discounted_total_cents"),
  projectTitle: text("project_title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertQuickWinPresentation = typeof quickWinPresentationsTable.$inferInsert;
export type QuickWinPresentation = typeof quickWinPresentationsTable.$inferSelect;

// ── Presentation document dwell-time analytics ────────────────────────────────
export const presentationDocViewsTable = pgTable("presentation_doc_views", {
  id: serial("id").primaryKey(),
  // Nullable: a view/dwell event for a document opened outside a presentation
  // (e.g. shared directly from the customer document hub) has no presentation.
  // documentId is required in that case — see the /portal/documents/:id/share
  // and /api/public/documents/:shareToken routes in portal.ts.
  presentationId: integer("presentation_id").references(() => quickWinPresentationsTable.id, { onDelete: "cascade" }),
  documentId: integer("document_id").references(() => insightsGeneratedDocumentsTable.id, { onDelete: "set null" }),
  documentTitle: text("document_title"),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
  dwellSeconds: integer("dwell_seconds"),
  eventType: text("event_type").default("dwell"),
  cardName: text("card_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertPresentationDocView = typeof presentationDocViewsTable.$inferInsert;
export type PresentationDocView = typeof presentationDocViewsTable.$inferSelect;

// ── Quick Win Result Shares ────────────────────────────────────────────────────
export const quickWinResultSharesTable = pgTable("quick_win_result_shares", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  shareToken: text("share_token").notNull().unique(),
  // "quick_win_scores" (original use: scoresSnapshot required) vs "document"
  // (general document share: documentId required, scoresSnapshot null).
  shareKind: text("share_kind", { enum: ["quick_win_scores", "document"] }).notNull().default("quick_win_scores"),
  documentId: integer("document_id").references(() => insightsGeneratedDocumentsTable.id, { onDelete: "cascade" }),
  scoresSnapshot: jsonb("scores_snapshot").$type<Partial<Record<string, number>>>(),
  latestDate: timestamp("latest_date"),
  expiresAt: timestamp("expires_at").notNull(),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertQuickWinResultShare = typeof quickWinResultSharesTable.$inferInsert;
export type QuickWinResultShare = typeof quickWinResultSharesTable.$inferSelect;

// ── Workflow Engine ────────────────────────────────────────────────────────────

export interface WfNodeData {
  label?: string;
  description?: string;
  actionType?: string;
  params?: Record<string, unknown>;
  expression?: string;
  mode?: string;
  duration?: number;
  interval?: number;
  timeout?: number;
  [key: string]: unknown;
}

export interface WfNode {
  id: string;
  type:
    | "start" | "end" | "action" | "condition" | "delay" | "error"
    // CRM — the legacy local-CRM node types (`score_lead`,
    // `assign_pipeline_stage`, `create_opportunity`, `write_crm_scores`) and the
    // quiz/diagnostics ones (`parse_quiz_results`, `generate_readiness_score`,
    // `attach_quiz_insights`) were removed in #135 (Decommission Legacy CRM
    // Phase A). Zoho CRM's `zoho_*` nodes (#83) are the supported path.
    // M365 Health
    | "validate_m365_permissions" | "update_intelligence_tables"
    | "generate_diff_report" | "notify_major_changes"
    // Marketing Actions
    | "send_campaign_email" | "create_marketing_campaign" | "publish_landing_page" | "generate_landing_page"
    | "define_campaign_goal" | "define_target_audience" | "create_campaign_offer"
    | "ask_ai"
    // Social Media
    | "post_linkedin" | "post_twitter" | "post_facebook"
    // Project Actions
    | "create_kanban_task"
    | "get_project_tasks"
    | "update_project_task"
    | "update_milestone"
    | "get_phases"
    | "create_phase"
    | "save_presentation_phases"
    // Content
    | "generate_article" | "publish_article" | "topic_picker" | "generate_image"
    | "fetch_news_headlines"
    // Data
    | "find_object"
    | "compose"
    // System (internal / seeded workflows)
    | "msp_dunning_advance"
    | "msp_overage_meter"
    | "alert_evaluate_rules"
    | "policy_evaluate_due"
    // Notifications & Alerts
    | "send_browser_notification"
    | "send_mobile_push"
    | "create_notification"
    | "play_sound"
    // Input
    | "ask_for_input"
    // Logic
    | "switch_case"
    // Control Flow
    | "foreach"
    | "for"
    | "parallel"
    | "join"
    | "retry"
    | "approval_gate"
    | "break_glass_verification_gate"
    | "report_progress"
    // Generated-credential hygiene (#1911) — a visible engine node, not a
    // background scheduler, so every purge is a run with an audit trail.
    | "purge_orphaned_generated_secrets"
    // Calendar (Exchange Online via Microsoft Graph)
    | "check_exchange_calendar_availability"
    | "create_exchange_calendar_event"
    // SharePoint (Microsoft Graph drive endpoints)
    | "save_to_sharepoint"
    | "get_from_sharepoint"
    // Documents / PDF
    | "generate_pdf"
    | "build_presentation"
    // Payments (Stripe)
    | "generate_invoice_stripe_payment"
    | "generate_stripe_payment_link"
    | "create_phased_invoices"
    | "generate_phased_invoice"
    | "charge_stripe_invoice"
    | "edit_stripe_invoice"
    // Scripts
    | "generate_script"
    | "check_script_output"
    // Variables
    | "set_variable"
    | "update_variable"
    // Signals
    | "get_tenant_signals" | "evaluate_signal_policies"
    // Engagement Offer Engine
    | "evaluate_engagement_offers" | "dispatch_engagement_followups" | "cancel_conflicting_engagement_followup"
    // Intelligence Engines
    | "calculate_priority" | "calculate_pricing_engine" | "calculate_health"
    | "calculate_drift" | "calculate_forecast" | "calculate_crm" | "calculate_msp"
    // SLA Engine
    | "sla_start_timer" | "sla_stop_timer" | "sla_warning"
    | "sla_breach" | "sla_escalate" | "sla_resolve"
    // Scope Creep Engine
    | "scope_creep_detect" | "scope_creep_score" | "scope_creep_violation"
    | "scope_creep_escalate" | "scope_creep_resolve" | "scope_creep_compliance_update"
    // Array / transform
    | "group_by"
    // Monitor Package Engine
    | "monitor_get_package" | "monitor_execute_package"
    // Live Monitor Engine (Mode B — O365 Management Activity API)
    | "monitor_subscription_ensure" | "monitor_poll_activity"
    // Tenant configuration snapshot collector (#1796). Every automated process is
    // a visible node — this is the ONLY way a snapshot is produced, so there is no
    // bare scheduler behind it. Manual trigger for now; cadence is a later decision.
    | "config_snapshot_collect"
    // Tenant configuration snapshot DIFFER (#1797). One engine serving drift,
    // baseline assessment, tenant compare and Dev->Test->Prod promotion; the mode
    // labels the pair rather than branching the comparison. Computes differences
    // only — there is deliberately no apply path.
    | "config_snapshot_diff"
    // Sales Offer Engine
    | "sales_offer_generate" | "sales_offer_score" | "sales_offer_violation"
    | "sales_offer_escalate" | "sales_offer_resolve"
    // MSP Score Snapshot
    | "msp_score_snapshot"
    // M365 Third-Party SLA Tracking
    | "m365_health_sample"
    // M365 Roadmap ingestion (#1530)
    | "m365_roadmap_sync"
    // M365 Changes Routing (#1534) — was missing from this union even though
    // the node type is real and seeded (workflow-executor.ts's executeNode
    // switch, seed-system-workflows.ts, node-type-registry.ts); the case's own
    // `node.type` comparison failed to typecheck against WfNode until this.
    | "m365_route_changes"
    // Telemetry Retention
    | "platform_log_stream_prune"
    // Zoho Integration — queue drain (Foundation, #82)
    | "zoho_batch_drain"
    // Zoho CRM (#83) — 26 nodes. Reads (get_/find_/search_) execute inline
    // against Zoho; writes enqueue onto msp_job_queue and are applied by the
    // 5-minute zoho_batch_drain. There are deliberately no delete nodes:
    // Zoho is the system of record and deletion stays a manual Zoho-side act.
    | "zoho_create_lead" | "zoho_update_lead" | "zoho_upsert_lead"
    | "zoho_find_lead_by_email" | "zoho_get_lead" | "zoho_add_lead_note"
    | "zoho_attach_file_to_lead" | "zoho_convert_lead"
    | "zoho_create_deal" | "zoho_update_deal" | "zoho_update_deal_stage"
    | "zoho_update_deal_amount" | "zoho_get_deal" | "zoho_add_deal_note"
    | "zoho_attach_file_to_deal" | "zoho_find_open_deal_for_contact"
    | "zoho_create_contact" | "zoho_update_contact" | "zoho_upsert_contact"
    | "zoho_find_contact_by_email" | "zoho_get_contact"
    | "zoho_create_account" | "zoho_search_accounts" | "zoho_get_account"
    | "zoho_update_account" | "zoho_attach_file_to_account"
    // Zoho Projects (#85) — 14 nodes, same read/write split as Zoho CRM above,
    // draining on the same zoho_batch_drain. No delete nodes.
    | "zoho_create_project" | "zoho_update_project" | "zoho_get_project" | "zoho_list_projects"
    | "zoho_create_tasklist" | "zoho_get_tasklist"
    | "zoho_create_task" | "zoho_update_task" | "zoho_get_task" | "zoho_list_tasks"
    | "zoho_create_milestone" | "zoho_update_milestone" | "zoho_get_milestone" | "zoho_list_milestones"
    // Zoho Books (#87) — 4 write-only nodes, draining on the same
    // zoho_batch_drain. No read/list nodes (no UI to serve), no delete.
    | "zoho_books_upsert_contact" | "zoho_books_create_invoice"
    | "zoho_books_record_payment" | "zoho_books_create_expense"
    | "zoho_books_daily_ai_rollup"
    // Zoho Desk (#89) — 4 nodes, draining on the same zoho_batch_drain. No
    // delete node. Connects the AI Support Chat's human-escalation path
    // (escalateToAdmin() in support-chat.ts) to a real ticket.
    | "zoho_desk_create_ticket" | "zoho_desk_upsert_contact"
    | "zoho_desk_add_comment" | "zoho_desk_get_ticket"
    // EngageBay Integration — queue drain (#105)
    | "engagebay_batch_drain"
    // EngageBay nodes (#105) — 4 write (queued) + 4 read (inline). No delete
    // nodes: EngageBay is the system of record and deletion stays manual.
    | "engagebay_create_contact" | "engagebay_update_contact"
    | "engagebay_add_tag" | "engagebay_start_sequence"
    | "engagebay_get_contact" | "engagebay_get_contact_by_email"
    | "engagebay_search_contacts" | "engagebay_list_tags"
    // MSP Baseline Actions
    | "graph_write_operation" | "execute_baseline_template" | "execute_monitor_check"
    // Remediation Tracker — on-demand pointed verification (#1540)
    | "remediation_pointed_verify"
    // Utilities
    | "comment";
  position: { x: number; y: number };
  data: WfNodeData;
}

export interface WfEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

export interface WfGraph {
  nodes: WfNode[];
  edges: WfEdge[];
}

export const wfDefinitionsTable = pgTable("wf_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  concurrencyLimit: integer("concurrency_limit").notNull().default(5),
  maxRunDepth: integer("max_run_depth").notNull().default(5),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertWfDefinition = typeof wfDefinitionsTable.$inferInsert;
export type WfDefinition = typeof wfDefinitionsTable.$inferSelect;

export const wfVersionsTable = pgTable("wf_versions", {
  id: serial("id").primaryKey(),
  definitionId: integer("definition_id").notNull().references(() => wfDefinitionsTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull().default(1),
  label: text("label"),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  graph: jsonb("graph").$type<WfGraph>().notNull().default({ nodes: [], edges: [] }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Structural guarantee: Postgres will reject any INSERT/UPDATE that would
  // create a second "published" row for the same definition, regardless of
  // which code path attempts it.
  uniqueIndex("wf_versions_one_published_per_def")
    .on(t.definitionId)
    .where(sql`status = 'published'`),
]);

export type InsertWfVersion = typeof wfVersionsTable.$inferInsert;
export type WfVersion = typeof wfVersionsTable.$inferSelect;

export const wfRunsTable = pgTable("wf_runs", {
  id: serial("id").primaryKey(),
  versionId: integer("version_id").notNull().references(() => wfVersionsTable.id, { onDelete: "cascade" }),
  definitionId: integer("definition_id").notNull().references(() => wfDefinitionsTable.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type", { enum: ["manual", "schedule", "webhook", "event"] }).notNull().default("manual"),
  triggerRef: text("trigger_ref"),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "cancelled", "awaiting_approval"] }).notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  branchPath: jsonb("branch_path").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
  retriggeredFromRunId: integer("retriggered_from_run_id").references((): AnyPgColumn => wfRunsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertWfRun = typeof wfRunsTable.$inferInsert;
export type WfRun = typeof wfRunsTable.$inferSelect;

export const wfRunNodeLogsTable = pgTable("wf_run_node_logs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => wfRunsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  level: text("level", { enum: ["info", "warn", "error", "progress"] }).notNull().default("info"),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export type InsertWfRunNodeLog = typeof wfRunNodeLogsTable.$inferInsert;
export type WfRunNodeLog = typeof wfRunNodeLogsTable.$inferSelect;

export const wfRunNodeOutputsTable = pgTable("wf_run_node_outputs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => wfRunsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  durationMs: integer("duration_ms"),
  status: text("status", { enum: ["ok", "error", "skipped"] }).notNull().default("ok"),
  errorMessage: text("error_message"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export type InsertWfRunNodeOutput = typeof wfRunNodeOutputsTable.$inferInsert;
export type WfRunNodeOutput = typeof wfRunNodeOutputsTable.$inferSelect;

export const wfTriggersTable = pgTable("wf_triggers", {
  id: serial("id").primaryKey(),
  definitionId: integer("definition_id").notNull().references(() => wfDefinitionsTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["manual", "schedule", "webhook", "event", "startup"] }).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  webhookToken: text("webhook_token").unique(),
  nextRunAt: timestamp("next_run_at"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertWfTrigger = typeof wfTriggersTable.$inferInsert;
export type WfTrigger = typeof wfTriggersTable.$inferSelect;

export const wfTriggerEventsTable = pgTable("wf_trigger_events", {
  id: serial("id").primaryKey(),
  triggerId: integer("trigger_id").notNull().references(() => wfTriggersTable.id, { onDelete: "cascade" }),
  runId: integer("run_id").references(() => wfRunsTable.id, { onDelete: "set null" }),
  firedAt: timestamp("fired_at").notNull().defaultNow(),
  status: text("status", { enum: ["fired", "skipped", "error"] }).notNull().default("fired"),
  durationMs: integer("duration_ms"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
});

export type InsertWfTriggerEvent = typeof wfTriggerEventsTable.$inferInsert;
export type WfTriggerEvent = typeof wfTriggerEventsTable.$inferSelect;

export const pendingApprovalsTable = pgTable("pending_approvals", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => wfRunsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  approverRole: text("approver_role").notNull().default("admin"),
  // Null for platform-internal approvals (e.g. publish_article). Set for
  // MSP-scoped approvals (e.g. msp_approver role) so the MSP Portal's
  // pending-approvals endpoint can filter to the requesting MSP only.
  mspId: integer("msp_id"),
  timeoutSeconds: integer("timeout_seconds").notNull().default(3600),
  status: text("status", { enum: ["pending", "approved", "rejected", "timed_out"] }).notNull().default("pending"),
  decidedBy: text("decided_by"),
  decisionNote: text("decision_note"),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
  expiresAt: timestamp("expires_at"),
});

export type InsertPendingApproval = typeof pendingApprovalsTable.$inferInsert;
export type PendingApproval = typeof pendingApprovalsTable.$inferSelect;

// ── Workflow Node Output Samples ──────────────────────────────────────────────
// One row per (definition, node). Captured after every successful execution
// (real run or dry-run Test Run). Used by the Config Panel variable-picker so
// it can show real sample keys instead of inferring them from AI guesses.
// Deliberately separate from wf_versions.graph so a captured sample never
// touches a potentially-published version.

export const wfNodeOutputSamplesTable = pgTable("wf_node_output_samples", {
  definitionId: integer("definition_id").notNull().references(() => wfDefinitionsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull().default("unknown"),
  sample: jsonb("sample").$type<Record<string, unknown>>().notNull().default({}),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  sourceRunId: integer("source_run_id").references(() => wfRunsTable.id, { onDelete: "set null" }),
}, (t) => [
  primaryKey({ columns: [t.definitionId, t.nodeId] }),
]);

export type InsertWfNodeOutputSample = typeof wfNodeOutputSamplesTable.$inferInsert;
export type WfNodeOutputSample = typeof wfNodeOutputSamplesTable.$inferSelect;

// ── Client Proposal Presentations (generated by build_presentation workflow node) ──
export const clientPresentationsTable = pgTable("client_presentations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientEmail: text("client_email").notNull(),
  projectTitle: text("project_title").notNull(),
  html: text("html").notNull(),
  checkoutUrl: text("checkout_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export type InsertClientPresentation = typeof clientPresentationsTable.$inferInsert;
export type ClientPresentation = typeof clientPresentationsTable.$inferSelect;

// ── Sales Offer Engine ──────────────────────────────────────────────────────────
//
// Lifecycle: draft → sent → accepted | rejected | expired
// Diagnostics findings converted into candidate offers by engine rules.
// Pricing always reads from the Product Catalog (servicesTable), never a
// separate hardcoded price table.

export const SALES_OFFER_STATES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export type SalesOfferState = typeof SALES_OFFER_STATES[number];

export const SALES_OFFER_RULE_TYPES = [
  "eligibility",   // determines whether an offer candidate is eligible for a tenant
  "bundling",      // groups offers together based on fired signals
  "pricing",       // adjusts base catalog price up or down
  "scoring",       // determines the offer's relevance score
  "expiration",    // how long the offer is valid after being sent
] as const;
export type SalesOfferRuleType = typeof SALES_OFFER_RULE_TYPES[number];

/** One generated offer — scoped to a tenant/MSP pair, backed by a catalog product. */
export const salesOffersTable = pgTable("sales_offers", {
  id: serial("id").primaryKey(),
  /** The MSP customer (user) this offer is addressed to. Despite the historical column name, this is NOT the M365 tenant GUID — it's a numeric FK to usersTable.id. */
  customerId: integer("customer_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** FK to servicesTable — the product this offer is for. Pricing reads from there. */
  serviceId: integer("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  /** Which MSP generated this offer (null = platform admin). */
  mspId: integer("msp_id"),
  /** Human-readable offer title (can differ from product name). */
  title: text("title").notNull(),
  /** Short pitch explaining why this offer is relevant for this tenant. */
  rationale: text("rationale"),
  /** Fired signal keys that triggered this offer's eligibility. */
  firedSignalKeys: jsonb("fired_signal_keys").$type<string[]>().notNull().default([]),
  /** Other offer IDs bundled into this one (empty = standalone). */
  bundledOfferIds: jsonb("bundled_offer_ids").$type<number[]>().notNull().default([]),
  /** Base price from the catalog in USD cents. */
  basePriceCents: integer("base_price_cents").notNull().default(0),
  /** Engine-adjusted price in USD cents (after pricing rules). */
  adjustedPriceCents: integer("adjusted_price_cents").notNull().default(0),
  internalCostCents: integer("internal_cost_cents"),
  priceCents: integer("price_cents"),
  /** Score [0–100] from the scoring rule group — higher = more relevant. */
  score: integer("score").notNull().default(0),
  /** Lifecycle state. */
  state: text("state", { enum: SALES_OFFER_STATES }).notNull().default("draft"),
  /** ISO-8601 date after which the offer auto-expires (set at send time). */
  expiresAt: timestamp("expires_at"),
  /** When the offer was sent to the client. */
  sentAt: timestamp("sent_at"),
  /** When the offer was accepted. */
  acceptedAt: timestamp("accepted_at"),
  /** When the offer was rejected or expired. */
  closedAt: timestamp("closed_at"),
  /** Free-text reason supplied on rejection. */
  rejectionReason: text("rejection_reason"),
  /** Idempotency key — prevents duplicate offers for same (customerId, serviceId, signalSet). */
  idempotencyKey: text("idempotency_key").unique(),
  /** Full engine output snapshot at generation time (for audit). */
  engineSnapshot: jsonb("engine_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  /**
   * Offer-level trial period override (days).
   * Takes precedence over the product-level trialPeriodDays on servicesTable.
   * The same product can have different trial terms on different campaigns/offers.
   * Applied to Stripe subscription_data.trial_period_days at checkout.
   */
  trialPeriodDays: integer("trial_period_days"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertSalesOffer = typeof salesOffersTable.$inferInsert;
export type SalesOffer = typeof salesOffersTable.$inferSelect;

// ── Free-Checkout Rate-Limit Attempts ─────────────────────────────────────────
// Records every $0 portal checkout attempt for rate-limit enforcement.
// Limits:
//   1 per customer email per rolling 90-day window.
//   3 per IP address per rolling 24-hour window.
//   Per-MSP daily aggregate triggers a soft PlatformAdmin alert (not a hard block).

export const freeCheckoutAttemptsTable = pgTable("free_checkout_attempts", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  ipAddress: text("ip_address"),
  mspId: integer("msp_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertFreeCheckoutAttempt = typeof freeCheckoutAttemptsTable.$inferInsert;
export type FreeCheckoutAttempt = typeof freeCheckoutAttemptsTable.$inferSelect;

/** Audit trail for every lifecycle transition on a sales offer. */
export const salesOfferEventsTable = pgTable("sales_offer_events", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => salesOffersTable.id, { onDelete: "cascade" }),
  /** Canonical event name: offer.generated | offer.scored | offer.sent | offer.accepted | offer.rejected | offer.expired */
  eventName: text("event_name").notNull(),
  /** Full event envelope stored for replay / downstream consumption. */
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertSalesOfferEvent = typeof salesOfferEventsTable.$inferInsert;
export type SalesOfferEvent = typeof salesOfferEventsTable.$inferSelect;

/**
 * Engine-level configuration — one row per MSP (or mspId = null for platform defaults).
 * Scoring weights, bundling thresholds, expiration defaults. All values are in
 * integer units so they stay DB-native without float serialization issues.
 */
export const salesOfferConfigTable = pgTable("sales_offer_config", {
  id: serial("id").primaryKey(),
  /** Null = platform-wide defaults; non-null = MSP-level override. */
  mspId: integer("msp_id").unique(),
  /**
   * Scoring weight overrides for each rule type [0–100].
   * { eligibility, bundling, pricing, scoring, expiration }
   */
  scoringWeights: jsonb("scoring_weights").$type<Record<string, number>>().notNull().default({}),
  /** Minimum score [0–100] for an offer to be included in a generated set. */
  minScore: integer("min_score").notNull().default(40),
  /** Maximum number of offers to include in a single generate call (0 = unlimited). */
  maxOffersPerGenerate: integer("max_offers_per_generate").notNull().default(5),
  /** Default TTL in days before a sent offer auto-expires (0 = no expiry). */
  defaultExpirationDays: integer("default_expiration_days").notNull().default(30),
  /** Minimum number of signals that must fire to trigger bundling (0 = no bundling). */
  bundlingThreshold: integer("bundling_threshold").notNull().default(2),
  /** JSON config blob for any additional engine parameters admins want to add. */
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertSalesOfferConfig = typeof salesOfferConfigTable.$inferInsert;
export type SalesOfferConfig = typeof salesOfferConfigTable.$inferSelect;

/**
 * Configurable rule groups for the Sales Offer Engine.
 * Each rule group defines eligibility / bundling / pricing / scoring / expiration
 * conditions for a particular offer candidate (keyed by serviceId or a logical key).
 */
export const salesOfferRuleGroupsTable = pgTable("sales_offer_rule_groups", {
  id: serial("id").primaryKey(),
  /** Human-readable key, e.g. "governance-remediation-offer" */
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  ruleType: text("rule_type", { enum: SALES_OFFER_RULE_TYPES }).notNull().default("eligibility"),
  /** FK to the service this rule group targets (null = applies to all). */
  serviceId: integer("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  /**
   * Signal keys that must be fired for this rule group to activate.
   * Logic: OR (any signal triggers) or AND (all must fire) — see `logic`.
   */
  requiredSignalKeys: jsonb("required_signal_keys").$type<string[]>().notNull().default([]),
  logic: text("logic", { enum: ["AND", "OR"] }).notNull().default("OR"),
  /** For pricing rules: adjustment in percentage points (-50 = 50% discount, 20 = 20% premium). */
  pricingAdjustmentPct: integer("pricing_adjustment_pct").notNull().default(0),
  /** For scoring rules: base score contribution [0–100]. */
  scoreContribution: integer("score_contribution").notNull().default(0),
  /** For expiration rules: TTL in days (overrides config default when > 0). */
  expirationDays: integer("expiration_days").notNull().default(0),
  /** For bundling rules: service IDs to bundle with this offer. */
  bundleWithServiceIds: jsonb("bundle_with_service_ids").$type<number[]>().notNull().default([]),
  /** Whether this rule group is active. */
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertSalesOfferRuleGroup = typeof salesOfferRuleGroupsTable.$inferInsert;
export type SalesOfferRuleGroup = typeof salesOfferRuleGroupsTable.$inferSelect;

// ── Checkout Sessions ──────────────────────────────────────────────────────────
// Server-side session survives cross-origin redirects (e.g. Microsoft admin-consent).
// Only the sessionId is kept client-side; PII lives here.

export const checkoutSessionsTable = pgTable("checkout_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  productSlug: text("product_slug").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  // Company/industry (#142): the buyer's ORGANIZATION, not the individual —
  // sourced into tenants.customerName/industry so the tenant identity is the
  // company, not the person filling out the form. Nullable/additive; existing
  // rows predate this capture.
  company: text("company"),
  industry: text("industry"),
  seats: integer("seats").notNull().default(1),
  status: text("status", { enum: ["pending", "consented", "paid", "expired"] }).notNull().default("pending"),
  tenantId: text("tenant_id"),

  // ── Recurring rescan add-on (#490) ──────────────────────────────────────────
  // The buyer's answer to the opt-in step that sits between the #432 Compliance
  // decision and Payment. Deliberately TRI-STATE: null means "not asked yet",
  // which is what lets a resumed session land back on the add-on step rather
  // than silently treating an unanswered question as a decline.
  rescanAddonOptIn: boolean("rescan_addon_opt_in"),
  // The catalog row the offer was quoted from, and the monthly price in integer
  // cents AS QUOTED at decision time. The price is snapshotted rather than
  // re-resolved at charge time because the buyer agreed to a specific number:
  // if the catalog row is edited between the decision and the payment landing,
  // the subscription is created at the price that was on screen, and the
  // divergence is logged rather than silently charged.
  rescanAddonServiceId: integer("rescan_addon_service_id"),
  rescanAddonPriceCents: integer("rescan_addon_price_cents"),
  // The Stripe Subscription created once the one-time payment succeeded. Also
  // the idempotency record: a replayed /payment-confirmed with this already set
  // creates nothing.
  rescanSubscriptionId: text("rescan_subscription_id"),

  // ── Multi-item SOW cart snapshot (#598, Epic #597 stage 1) ────────────────
  // Purely additive extension so a checkout_sessions row can hold a real SOW
  // cart instead of the single `productSlug` this table was built for. The
  // marketing site's assessment-purchase path (`public-assessment-payment.ts`)
  // never reads or writes these — it stays on `productSlug` alone.
  //
  // Shape decision: jsonb over native Postgres array columns, matching this
  // codebase's dominant convention for a stored list of ids/selections
  // (`sales_offer_rule_groups.required_signal_keys`, `engagement_projects.
  // triggeredBy`/`sowItems`, `users.pinnedNavItems`) rather than the two-off
  // `text().array()` usage elsewhere in this file. jsonb also lets both new
  // fields share one representation — `sowAddonSelections` needs structured
  // objects a native array can't hold, and splitting the two into different
  // column kinds for no reason would be its own inconsistency.
  //
  // `sowSelectedPhaseServiceIds` holds real `services.id` values (the FK the
  // Sales Offer Engine's own wire already carries as `serviceId` — see
  // `WireRecommendedOffer` in sowLiveScope.ts) for each remediation phase kept
  // in scope, NOT the client-side display slug `JourneyPhase.id` uses for
  // toggle/navigation identity.
  //
  // `sowAddonSelections` mirrors `JourneySelection`'s addon/tier shape
  // (journeyPricing.ts): one entry per addon the customer turned on, carrying
  // the same string `addonId`/`tierId` keys the wire and client selection
  // state already use (e.g. `"tenant-monitoring"`/`"enhanced"`) — these are
  // stable catalog keys, not FKs, since the real priced row behind a tier is
  // resolved server-side from the tenant's seat count at read time
  // (`sow-monitoring-addon.ts`), not a fixed row id.
  //
  // `sowCartTotalCents` is the server-computed total at snapshot time, nullable
  // like `rescanAddonPriceCents` above until that step runs — never a client-
  // submitted number, per the epic's explicit "never trust a client-computed
  // total for the charge" direction.
  sowSelectedPhaseServiceIds: jsonb("sow_selected_phase_service_ids").$type<number[]>().notNull().default([]),
  sowAddonSelections: jsonb("sow_addon_selections")
    .$type<Array<{ addonId: string; tierId: string }>>()
    .notNull()
    .default([]),
  // The amount actually charged — post pay-in-full coupon, applied
  // unconditionally by the checkout-session route (see that route's own
  // comment: a session expires in 24h, always inside the 72h pay-today
  // window a stored-SOW signature would otherwise gate on, so there is no
  // separate window state to compute here the way payment-options does).
  sowCartTotalCents: integer("sow_cart_total_cents"),

  // ── Live-scope signature + agreement snapshot (Git #603, Epic #597 stage 5) ─
  // Captured at `sign()` time (POST .../sow/checkout-session) — same drawn-PNG
  // + typed-name wire contract every signing endpoint on this platform takes
  // (JourneySignaturePanel). Nullable/additive: rows predating #603 and the
  // marketing site's single-product path never set these.
  sowSignatureData: text("sow_signature_data"),
  sowSignerName: text("sow_signer_name"),
  sowSignatureIp: text("sow_signature_ip"),
  // The phases' own titles at snapshot time — `services.name` can change
  // later, so the agreement's `selectedWorkstreamTitles` reads this rather
  // than re-resolving titles from `sowSelectedPhaseServiceIds` after the fact.
  sowSelectedPhaseTitles: jsonb("sow_selected_phase_titles").$type<string[]>().notNull().default([]),
  // Pre-coupon total, kept only so the agreement record can show what the
  // PAY-TODAY coupon waived. `sowCartTotalCents` above is what was charged.
  sowCartOriginalTotalCents: integer("sow_cart_original_total_cents"),

  // ── Pay-by-Phase billing (Git #613, v1.1 split from #611) ──────────────────
  // Nullable/additive: rows predating #613 never set these and are always the
  // "full" plan by omission — pay-in-full is the only plan this table's
  // existing sowCartTotalCents/sowCartOriginalTotalCents columns ever priced.
  //
  // `sowPaymentPlan` names which plan #599's checkout-session route snapshotted
  // at signing. "phased" gates the PAY-TODAY coupon OFF (that discount is a
  // pay-in-full-only incentive) and turns on the deposit math below instead.
  //
  // `sowPhaseBreakdown` is the per-phase price/duration snapshot phased billing
  // needs that the aggregate `sowSelectedPhaseTitles`/`sowCartTotalCents`
  // columns cannot supply — same "never re-resolve after signing" doctrine
  // `sowSelectedPhaseTitles`' own comment states, extended to price and
  // duration: a `services` row's price or `type_attributes.durationWeeks` can
  // change between signing and whenever the phased-invoicing node actually
  // runs, so both are captured here at sign time. Order matters — this array
  // is stored in the same Foundation -> Parallel-eligible -> unstaged ->
  // Closeout sequence `StatementOfWorkBody.tsx`'s `buildGanttLayout` uses, so
  // index 0 is "Phase 1" (charged at signing, never separately invoiced) and
  // the phased-invoicing node numbers phases 2..N directly off array order —
  // no re-derivation of stage-bucket order at invoicing time.
  //
  // `sowDepositCents` is the 30%-of-contract deposit amount, computed ONCE at
  // signing from the live `PHASE_DEPOSIT_COUPON_CODE` coupon and never
  // recomputed: the phased-invoicing node's final-phase square-up must credit
  // the EXACT deposit that was actually collected at signing, not whatever
  // the coupon happens to say by the time the node runs (Shane can retune the
  // coupon's percentage for future signings without corrupting an
  // already-signed agreement's math).
  //
  // `sowPhaseInvoicesCreatedAt` is the phased-invoicing node's own idempotency
  // guard: set the instant it successfully creates the phases-2..N draft
  // invoices, so an accidental second manual fire (Git #613's trigger is
  // manual, not event-driven) refuses rather than doubling every invoice.
  sowPaymentPlan: text("sow_payment_plan", { enum: ["full", "phased"] }),
  sowDepositCents: integer("sow_deposit_cents"),
  sowPhaseBreakdown: jsonb("sow_phase_breakdown")
    .$type<Array<{
      serviceId: number;
      title: string;
      priceCents: number;
      stage: string | null;
      durationWeeks: number | null;
    }>>()
    .notNull()
    .default([]),
  sowPhaseInvoicesCreatedAt: timestamp("sow_phase_invoices_created_at", { withTimezone: true }),

  // ── Read-consent skip (Git #1311, Epic #1309 Phase 2) ──────────────────────
  // Set when the buyer explicitly declined the OPTIONAL read-only tenant
  // connection (a Retainer purchase's "Skip — buy without a scan"). A real
  // recorded decision, distinct from "never reached the consent step":
  // downstream fulfillment branches on it, and the consent callback clears it
  // if the buyer later connects after all. Products whose read consent is
  // required (monitoring_tier, config_pack, …) can never set it — the skip
  // route refuses (see lib/read-consent-flow.ts's fail-closed mapping).
  consentSkippedAt: timestamp("consent_skipped_at", { withTimezone: true }),

  // ── Account completed through this session (Git #1313, Epic #1309 Phase 4) ─
  // The users.id whose password was attached THROUGH this session's own
  // account-creation flow (set by attachPasswordToAccount's `ok` outcome only —
  // never for `already_set`). This is the durable fact the portal-handoff
  // endpoint gates on: /auth/signup-exchange trades a signup token for a FULL
  // session with no MFA challenge, so a token may only ever be minted for the
  // account this very session created — a pre-existing account (whose MFA/
  // password predate this purchase) must sign in through the portal's own
  // door. Null = this session never completed account creation (or the row
  // predates the column).
  accountUserId: integer("account_user_id").references(() => usersTable.id),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("checkout_sessions_email_idx").on(t.email),
  index("checkout_sessions_expires_at_idx").on(t.expiresAt),
]);

export type InsertCheckoutSession = typeof checkoutSessionsTable.$inferInsert;
export type CheckoutSession = typeof checkoutSessionsTable.$inferSelect;

// ── Checkout email verification codes (#437) ───────────────────────────────────
// The six-digit code the Home-page assessment flow emails the buyer after
// payment, so the inline account-creation steps (verify → set password) can
// prove the buyer controls the address the order was placed under before a
// password is ever attached to it.
//
// Its OWN table rather than columns on checkout_sessions, matching the shape
// every other consumable secret in this schema already uses
// (password_reset_tokens, account_setup_tokens, mfa_challenges): short-lived,
// single-use, hashed, and re-issuable — a resend must be able to supersede the
// previous code without destroying the order row it belongs to.
//
// Only the bcrypt hash of the code is stored — never the six digits themselves.
// `attempts` is the brute-force budget: six digits is a 1-in-a-million guess,
// which is only safe with a hard cap on tries per issued code.
export const checkoutEmailVerificationsTable = pgTable("checkout_email_verifications", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => checkoutSessionsTable.id, { onDelete: "cascade" }),
  // Captured at issue time. The code is only ever accepted for the address it
  // was sent to, so a later edit of the session's email cannot be verified by
  // a code that was mailed somewhere else.
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("checkout_email_verifications_session_id_idx").on(t.sessionId),
  index("checkout_email_verifications_expires_at_idx").on(t.expiresAt),
]);

export type InsertCheckoutEmailVerification = typeof checkoutEmailVerificationsTable.$inferInsert;
export type CheckoutEmailVerification = typeof checkoutEmailVerificationsTable.$inferSelect;

// ── Failed Notifications ───────────────────────────────────────────────────────
// Records email send failures after the retry exhausts, so admins can identify
// customers who never received their account-setup (or other transactional) email.

export const failedNotificationsTable = pgTable("failed_notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientEmail: text("recipient_email").notNull(),
  templateName: text("template_name").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
}, (t) => [
  index("failed_notifications_recipient_idx").on(t.recipientEmail),
  index("failed_notifications_resolved_idx").on(t.resolved),
]);

export type InsertFailedNotification = typeof failedNotificationsTable.$inferInsert;
export type FailedNotification = typeof failedNotificationsTable.$inferSelect;

// ── Industry Benchmark Reference ───────────────────────────────────────────────
// One row per health pillar. Populated once via migration seed; used by the
// GET /api/portal/health-benchmark endpoint to annotate per-pillar display
// scores with published industry average and Microsoft Excellence targets.
// null values mean "not enough data" for that pillar/benchmark.

export const industryBenchmarkReferenceTable = pgTable("industry_benchmark_reference", {
  pillar: text("pillar").primaryKey(),
  industryAvgPct: integer("industry_avg_pct"),
  msExcellencePct: integer("ms_excellence_pct"),
  source: text("source"),
  asOfDate: date("as_of_date"),
});

// ── SKU Price Reference ─────────────────────────────────────────────────────────
// One row per Microsoft SKU part number. List price only (no per-MSP/region
// override yet — msp_id column can be added later without a redesign). Populated
// once via migration seed; consumed by cost-engine.ts to turn real seat counts
// (from monitor_checks groupByCount output) into real dollar figures.
// null monthlyPriceCents means "no published price on file" — never guessed.

export const skuPriceReferenceTable = pgTable("sku_price_reference", {
  skuPartNumber: text("sku_part_number").primaryKey(),
  displayName: text("display_name"),
  monthlyPriceCents: integer("monthly_price_cents"),
  source: text("source"),
  asOfDate: date("as_of_date"),
});

export type SkuPriceReference = typeof skuPriceReferenceTable.$inferSelect;

export const mspScoreHistoryTable = pgTable("msp_score_history", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(0),
  breakdown: jsonb("breakdown").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  mspIdCreatedAtIdx: index("msp_score_history_msp_id_created_at_idx")
    .on(table.mspId, table.createdAt),
}));

export type InsertMspScoreHistory = typeof mspScoreHistoryTable.$inferInsert;
export type MspScoreHistory = typeof mspScoreHistoryTable.$inferSelect;


// Tenant Engine Snapshots — point-in-time score history per engine per tenant
export const tenantEngineSnapshotsTable = pgTable("tenant_engine_snapshots", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  engineKey: text("engine_key").notNull(),
  score: integer("score").notNull().default(0),
  previousScore: integer("previous_score"),
  delta: integer("delta"),
  trendDirection: text("trend_direction"),
  breakdown: jsonb("breakdown").$type<Record<string, unknown>[]>().notNull().default([]),
  rawSignals: jsonb("raw_signals").$type<string[]>().notNull().default([]),
  runId: text("run_id"),
  ruleVersion: integer("rule_version"),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (table) => ({
  customerEngineCapturedIdx: index("tenant_engine_snapshots_customer_engine_captured_idx")
    .on(table.customerId, table.engineKey, table.capturedAt),
}));

export type InsertTenantEngineSnapshot = typeof tenantEngineSnapshotsTable.$inferInsert;
export type TenantEngineSnapshot = typeof tenantEngineSnapshotsTable.$inferSelect;

// Tenant Pillar Snapshots (Git #1106) — point-in-time history of the
// CUSTOMER-FACING 0-100 pillar DISPLAY scores (getPillarCoverage() /
// evaluatePillarDisplay()), one row per pillar per real scan. Deliberately a
// SEPARATE table from tenant_engine_snapshots above: that one holds raw,
// unbounded per-engine "Security Risk Points" (#1101) on a different scale with
// existing raw-score consumers. This one holds the normalized 0-100 pillar
// numbers the PillarGrid / HeroHealthScore / radar actually show a customer, so
// their real first-scan-to-today trend can be charted. Written only when a scan
// completes with sufficient coverage (coverageSufficient) — never on a
// dark/partial run — so history never contains fabricated points.
export const tenantPillarSnapshotsTable = pgTable("tenant_pillar_snapshots", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id"), // tenants.id — same id-space + no-FK convention as tenant_engine_snapshots above
  pillarKey: text("pillar_key").notNull(),
  score: integer("score").notNull().default(0), // 0-100 display score
  previousScore: integer("previous_score"),
  delta: integer("delta"),
  trendDirection: text("trend_direction"),
  packageKey: text("package_key"),
  runId: text("run_id"),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
}, (table) => ({
  customerPillarCapturedIdx: index("tenant_pillar_snapshots_customer_pillar_captured_idx")
    .on(table.customerId, table.pillarKey, table.capturedAt),
}));

export type InsertTenantPillarSnapshot = typeof tenantPillarSnapshotsTable.$inferInsert;
export type TenantPillarSnapshot = typeof tenantPillarSnapshotsTable.$inferSelect;

export const engineScoreSignalDeltasTable = pgTable("engine_score_signal_deltas", {
  id: serial("id").primaryKey(),
  historyId: integer("history_id").notNull().references(() => tenantEngineSnapshotsTable.id, { onDelete: "cascade" }),
  signalKey: text("signal_key").notNull(),
  direction: text("direction").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  historyIdx: index("engine_score_signal_deltas_history_idx").on(table.historyId),
}));

export type InsertEngineScoreSignalDelta = typeof engineScoreSignalDeltasTable.$inferInsert;
export type EngineScoreSignalDelta = typeof engineScoreSignalDeltasTable.$inferSelect;

export const engineScoreDailyRollupTable = pgTable("engine_score_daily_rollup", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  engineKey: text("engine_key").notNull(),
  day: date("day").notNull(),
  score: integer("score").notNull(),
  changedSignalKeys: jsonb("changed_signal_keys").$type<{ signalKey: string; direction: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueRollupIdx: uniqueIndex("engine_score_daily_rollup_unique_idx").on(table.customerId, table.engineKey, table.day),
}));

export type InsertEngineScoreDailyRollup = typeof engineScoreDailyRollupTable.$inferInsert;
export type EngineScoreDailyRollup = typeof engineScoreDailyRollupTable.$inferSelect;

export const policyRulesTable = pgTable("policy_rules", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  conditionType: text("condition_type", { enum: ["signal", "score_threshold"] }).notNull(),
  signalKeyPrefix: text("signal_key_prefix"),
  engineKey: text("engine_key"),
  scoreOperator: text("score_operator", { enum: ["lt", "gt"] }),
  scoreThreshold: integer("score_threshold"),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  eventName: text("event_name").notNull(),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  escalationRules: jsonb("escalation_rules").$type<{ level: number; afterMinutes: number; eventName: string }[]>(),
  resolvedEventName: text("resolved_event_name"),
  isActive: boolean("is_active").notNull().default(true),
  ruleVersion: integer("rule_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  activeLookupIdx: index("policy_rules_active_lookup_idx").on(table.mspId, table.conditionType, table.isActive),
}));

export type InsertPolicyRule = typeof policyRulesTable.$inferInsert;
export type PolicyRule = typeof policyRulesTable.$inferSelect;

export const policyRuleAuditLogTable = pgTable("policy_rule_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  ruleId: integer("rule_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  adminUserId: integer("admin_user_id"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PolicyRuleAuditLog = typeof policyRuleAuditLogTable.$inferSelect;

export const policyRuleFiringsTable = pgTable("policy_rule_firings", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => policyRulesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  firedAt: timestamp("fired_at").notNull().defaultNow(),
}, (table) => ({
  ruleCustomerFiredIdx: index("policy_rule_firings_rule_customer_fired_idx").on(table.ruleId, table.customerId, table.firedAt),
}));

export type InsertPolicyRuleFiring = typeof policyRuleFiringsTable.$inferInsert;
export type PolicyRuleFiring = typeof policyRuleFiringsTable.$inferSelect;

export const policyRuleIncidentsTable = pgTable("policy_rule_incidents", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => policyRulesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  currentLevel: integer("current_level").notNull().default(1),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  lastEscalatedAt: timestamp("last_escalated_at"),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ({
  ruleCustomerStatusIdx: index("policy_rule_incidents_rule_customer_status_idx").on(table.ruleId, table.customerId, table.status),
}));

export type InsertPolicyRuleIncident = typeof policyRuleIncidentsTable.$inferInsert;
export type PolicyRuleIncident = typeof policyRuleIncidentsTable.$inferSelect;

export const policyRuleSuppressionsTable = pgTable("policy_rule_suppressions", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => policyRulesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  suppressedByUserId: integer("suppressed_by_user_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  ruleCustomerMspIdx: index("policy_rule_suppressions_rule_customer_msp_idx").on(table.ruleId, table.customerId, table.mspId),
}));

export type InsertPolicyRuleSuppression = typeof policyRuleSuppressionsTable.$inferInsert;
export type PolicyRuleSuppression = typeof policyRuleSuppressionsTable.$inferSelect;

export const leadOfferInferenceRulesTable = pgTable("lead_offer_inference_rules", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  quizCategorySlug: text("quiz_category_slug").notNull(),
  scoreOperator: text("score_operator", { enum: ["lt", "gt"] }).notNull(),
  scoreThreshold: numeric("score_threshold", { precision: 6, scale: 2 }).notNull(),
  inferredSignalKey: text("inferred_signal_key").notNull(),
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  categoryActiveIdx: index("lead_offer_inference_rules_category_active_idx").on(table.quizCategorySlug, table.isActive),
}));

export type InsertLeadOfferInferenceRule = typeof leadOfferInferenceRulesTable.$inferInsert;
export type LeadOfferInferenceRule = typeof leadOfferInferenceRulesTable.$inferSelect;

export const leadOfferRuleGroupsTable = pgTable("lead_offer_rule_groups", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  ruleType: text("rule_type", { enum: ["eligibility", "bundling", "pricing", "scoring", "expiration"] }).notNull().default("eligibility"),
  serviceId: integer("service_id").references(() => servicesTable.id, { onDelete: "set null" }),
  requiredSignalKeys: jsonb("required_signal_keys").$type<string[]>().notNull().default([]),
  logic: text("logic", { enum: ["AND", "OR"] }).notNull().default("OR"),
  minConfidence: numeric("min_confidence", { precision: 3, scale: 2 }).notNull().default("0.50"),
  pricingAdjustmentPct: integer("pricing_adjustment_pct").notNull().default(0),
  scoreContribution: integer("score_contribution").notNull().default(0),
  expirationDays: integer("expiration_days").notNull().default(0),
  bundleWithServiceIds: jsonb("bundle_with_service_ids").$type<number[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertLeadOfferRuleGroup = typeof leadOfferRuleGroupsTable.$inferInsert;
export type LeadOfferRuleGroup = typeof leadOfferRuleGroupsTable.$inferSelect;

export const leadOfferPricingConfigTable = pgTable("lead_offer_pricing_config", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  maxDiscountPct: integer("max_discount_pct").notNull().default(20),
  model: text("model").notNull().default("claude-haiku-4-5"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertLeadOfferPricingConfig = typeof leadOfferPricingConfigTable.$inferInsert;
export type LeadOfferPricingConfig = typeof leadOfferPricingConfigTable.$inferSelect;

export const engagementOfferRulesTable = pgTable("engagement_offer_rules", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  minDistinctPagesViewed: integer("min_distinct_pages_viewed").notNull().default(3),
  minIntentScore: integer("min_intent_score").notNull().default(15),
  windowMinutes: integer("window_minutes").notNull().default(30),
  eligibleServiceIds: jsonb("eligible_service_ids").$type<number[]>().notNull().default([]),
  discountPct: integer("discount_pct").notNull().default(10),
  eventName: text("event_name").notNull(),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  mspActiveIdx: index("engagement_offer_rules_msp_active_idx").on(table.mspId, table.isActive),
}));

export type InsertEngagementOfferRule = typeof engagementOfferRulesTable.$inferInsert;
export type EngagementOfferRule = typeof engagementOfferRulesTable.$inferSelect;

export const engagementOfferFiringsTable = pgTable("engagement_offer_firings", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => engagementOfferRulesTable.id, { onDelete: "cascade" }),
  leadId: integer("lead_id"),
  firedAt: timestamp("fired_at").notNull().defaultNow(),
  /** Set once the Delayed Follow-Up workflow run has been spawned for this firing — dispatch is idempotent on this being NULL. */
  followUpDispatchedAt: timestamp("follow_up_dispatched_at"),
  /** wf_runs.id of the spawned Delayed Follow-Up run, so the Purchase Cancellation Guard can cancel the exact run. */
  followUpRunId: integer("follow_up_run_id").references(() => wfRunsTable.id, { onDelete: "set null" }),
}, (table) => ({
  ruleLeadFiredIdx: index("engagement_offer_firings_rule_lead_fired_idx").on(table.ruleId, table.leadId, table.firedAt),
}));

export type InsertEngagementOfferFiring = typeof engagementOfferFiringsTable.$inferInsert;
export type EngagementOfferFiring = typeof engagementOfferFiringsTable.$inferSelect;

export const leadScoringRulesTable = pgTable("lead_scoring_rules", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  ruleType: text("rule_type", { enum: ["intent_event", "pain_point_bonus", "engagement_signal_bonus", "urgency_signal_bonus", "stage_bonus"] }).notNull(),
  key: text("key").notNull(),
  points: integer("points").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  typeKeyActiveIdx: index("lead_scoring_rules_type_key_active_idx").on(table.ruleType, table.key, table.isActive),
}));

export type InsertLeadScoringRule = typeof leadScoringRulesTable.$inferInsert;
export type LeadScoringRule = typeof leadScoringRulesTable.$inferSelect;

export const leadScoringTrackedPagesTable = pgTable("lead_scoring_tracked_pages", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pathIdx: index("lead_scoring_tracked_pages_path_idx").on(table.path),
}));

export type InsertLeadScoringTrackedPage = typeof leadScoringTrackedPagesTable.$inferInsert;
export type LeadScoringTrackedPage = typeof leadScoringTrackedPagesTable.$inferSelect;

export const leadScoringConfigTable = pgTable("lead_scoring_config", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  lookbackDays: integer("lookback_days").notNull().default(14),
  maxScore: integer("max_score").notNull().default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertLeadScoringConfig = typeof leadScoringConfigTable.$inferInsert;
export type LeadScoringConfig = typeof leadScoringConfigTable.$inferSelect;

export const engineBaselineHistoryTable = pgTable("engine_baseline_history", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id"), // tenants.id — successor id-space after Phase 0 absorbed msp_customers; no FK by design (see Phase 7 audit)
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "set null" }),
  engineKey: text("engine_key").notNull(),
  baselineScore: integer("baseline_score").notNull(),
  resetTriggerType: text("reset_trigger_type"),
  resetTriggerRef: text("reset_trigger_ref"),
  ruleVersion: integer("rule_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  customerEngineCreatedIdx: index("engine_baseline_history_customer_engine_created_idx")
    .on(table.customerId, table.engineKey, table.createdAt),
}));

export type InsertEngineBaselineHistory = typeof engineBaselineHistoryTable.$inferInsert;
export type EngineBaselineHistory = typeof engineBaselineHistoryTable.$inferSelect;

export type IndustryBenchmarkReference = typeof industryBenchmarkReferenceTable.$inferSelect;

// ── Platform Log Stream ─────────────────────────────────────────────────────
// DB mirror of pino log output (Phase 1a). Every `logger.*()` call is queued by
// lib/log-stream-writer.ts and batch-inserted here, so operators can query
// structured logs (by channel / correlationId / mspId / time) without shipping
// to an external log sink. `message`/`level`/`time` are broken out into columns;
// `meta` holds the remaining log object (bindings + merged object).
export const platformLogStreamTable = pgTable("platform_log_stream", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  correlationId: uuid("correlation_id"),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("platform_log_stream_channel_idx").on(t.channel),
  index("platform_log_stream_correlation_id_idx").on(t.correlationId),
  index("platform_log_stream_msp_id_idx").on(t.mspId),
  index("platform_log_stream_occurred_at_idx").on(t.occurredAt),
]);

export type InsertPlatformLogStream = typeof platformLogStreamTable.$inferInsert;
export type PlatformLogStream = typeof platformLogStreamTable.$inferSelect;

// ── Exception Tracking ──────────────────────────────────────────────────────
// Groups (one row per unique file:line:normalized-message fingerprint) and
// occurrences (one row per actual instance). Fed by lib/exception-tracker.ts,
// which the logger's logMethod hook invokes on every `logger.error({ err })`
// call plus the process-level uncaught/unhandledRejection handlers. Persists
// until manually resolved/suppressed — NOT subject to the log-stream's prune.

export const exceptionGroupsTable = pgTable("exception_groups", {
  fingerprint: text("fingerprint").primaryKey(),
  errorName: text("error_name").notNull(),
  errorMessage: text("error_message").notNull(),
  file: text("file"),
  line: integer("line"),
  functionName: text("function_name"),
  codeFrame: text("code_frame"),
  stackSample: text("stack_sample"),
  channel: text("channel").notNull(),
  source: text("source").notNull(), // "caught" | "uncaught"
  status: text("status").notNull().default("open"), // "open" | "suppressed" | "resolved"
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by"),
  resolutionNote: text("resolution_note"),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  suppressedBy: integer("suppressed_by"),
  suppressionReason: text("suppression_reason"),
  /** Set once this group has been auto-filed as a GitHub issue (production only) — see lib/exception-github-sync.ts. Null until then. */
  githubIssueNumber: integer("github_issue_number"),
  githubIssueUrl: text("github_issue_url"),
  /** Last time a "this happened again" comment was posted — throttles re-notification so a hot-looping error doesn't spam the issue. */
  githubLastNotifiedAt: timestamp("github_last_notified_at", { withTimezone: true }),
}, (t) => [
  index("exception_groups_status_idx").on(t.status),
  index("exception_groups_last_seen_idx").on(t.lastSeenAt),
]);

export const exceptionOccurrencesTable = pgTable("exception_occurrences", {
  id: serial("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  correlationId: uuid("correlation_id"),
  channel: text("channel").notNull(),
  mspId: integer("msp_id"),
  customerId: integer("customer_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("exception_occurrences_fingerprint_idx").on(t.fingerprint),
  index("exception_occurrences_correlation_id_idx").on(t.correlationId),
]);

export type ExceptionGroup = typeof exceptionGroupsTable.$inferSelect;
export type ExceptionOccurrence = typeof exceptionOccurrencesTable.$inferSelect;

// ── Public Status Page — platform incident history (PlatformAdmin-authored) ──

export const platformIncidentsTable = pgTable("platform_incidents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity", { enum: ["minor", "major", "critical"] }).notNull(),
  status: text("status", { enum: ["investigating", "identified", "monitoring", "resolved"] }).notNull().default("investigating"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("platform_incidents_started_at_idx").on(t.startedAt),
  index("platform_incidents_status_idx").on(t.status),
]);

export type InsertPlatformIncident = typeof platformIncidentsTable.$inferInsert;
export type PlatformIncident = typeof platformIncidentsTable.$inferSelect;

// ── Deployed Version Stamp (Git #666) ───────────────────────────────────────────
// One row per real production deploy, written by POST /api/admin/version-stamp.
// GET /api/version's computeVersionInfo() reads the most recent row here as its
// fallback when the running process has no .git directory (every real production
// deploy — the git rev-parse/git log shellout only ever succeeds in this dev
// workspace). Exists so production shows the real deployed commit instead of the
// generic {version:"1.0.0", hash:"unknown"} placeholder.
export const deployedVersionStampTable = pgTable("deployed_version_stamp", {
  id: serial("id").primaryKey(),
  commitHash: text("commit_hash").notNull(),
  commitMessage: text("commit_message").notNull(),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertDeployedVersionStamp = typeof deployedVersionStampTable.$inferInsert;
export type DeployedVersionStamp = typeof deployedVersionStampTable.$inferSelect;

// ── Public AI Chat ─────────────────────────────────────────────────────────────
// Every public-site chat conversation, stored in full regardless of outcome — one
// row per browser session, the whole transcript re-upserted each turn (the client
// re-sends the full messages array, mirroring contact-chat's stateless shape).
//
// Escalation here is PULL-BASED ONLY, by deliberate design (a personal-safety
// requirement): `needsReview` lands the row in an admin queue Shane reviews on his
// own schedule. Nothing in this table's write path pushes — no email, no
// notification row, no web-push, no SSE. That is the whole point; do not add one.
//
// `declinedPersonalTopic` is audit-only: it records that the guardrail fired on a
// question about Shane personally (NASA/career/media/speaking/"pick your brain"/
// direct contact). It MUST NEVER cause `needsReview` to be set — a personal-topic
// request is declined and recorded, never routed to Shane by any path.
export const publicChatMessageRole = ["user", "assistant"] as const;

// ── ShaneBot structured content blocks (#361) ─────────────────────────────────
// The wire + storage shape shared by BOTH ShaneBot surfaces (public-chat.ts and
// support-chat.ts). A message's content is an ARRAY of blocks rather than a
// string, so the renderer — not the storage shape — is what changes when a new
// block type is introduced.
//
//   text             — plain prose. Every reply has at least one.
//   suggested_replies — tappable follow-up chips (#361). Emitted by the model as
//                      a bracketed control token, parsed + stripped server-side.
//   card             — structured/interactive data card (#366, shanebot_paid
//                      only). cardType is one of "invoice" | "subscription" |
//                      "score" | "data-answer"; data is always resolved
//                      server-side from real DB records scoped to the
//                      requesting customer, never taken from the model.
export type ChatTextBlock = { type: "text"; text: string };
export type ChatSuggestedRepliesBlock = { type: "suggested_replies"; options: string[] };
export type ChatCardBlock = { type: "card"; cardType: string; data: Record<string, unknown> };

export type ChatContentBlock = ChatTextBlock | ChatSuggestedRepliesBlock | ChatCardBlock;

/**
 * What a stored/transported message's `content` may be.
 *
 * `string` is the LEGACY shape: every row written before #361 holds a bare
 * string, and no backfill is performed (the column is already jsonb, so the
 * interior shape change needs no DDL). Every read path must normalize through
 * `toContentBlocks()` rather than assuming an array.
 */
export type ChatMessageContent = string | ChatContentBlock[];

export interface PublicChatStoredMessage {
  role: (typeof publicChatMessageRole)[number];
  /** Blocks for rows written from #361 onward; a bare string for legacy rows. */
  content: ChatMessageContent;
  at: string;
}

export const publicChatConversationsTable = pgTable("public_chat_conversations", {
  id: serial("id").primaryKey(),
  // Client-generated stable id (crypto.randomUUID) so multi-turn upserts land on
  // one row. Text, not the pg uuid type, to tolerate any client value safely.
  sessionId: text("session_id").notNull().unique(),
  messages: jsonb("messages").$type<PublicChatStoredMessage[]>().notNull().default([]),
  messageCount: integer("message_count").notNull().default(0),
  // Pull-based review flag + why the assistant raised it. Never set for a
  // personal-topic decline.
  needsReview: boolean("needs_review").notNull().default(false),
  reviewReason: text("review_reason", {
    enum: ["purchase_intent", "needs_shane", "explicit_request"],
  }),
  reviewStatus: text("review_status", {
    enum: ["new", "reviewed", "resolved", "archived"],
  }).notNull().default("new"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  // Audit-only: the guardrail declined a question about Shane personally. Never
  // escalates.
  declinedPersonalTopic: boolean("declined_personal_topic").notNull().default(false),
  // Structured request captured on genuine purchase / service intent — stored on
  // the row (not sent anywhere) so it surfaces in the pull-based queue only.
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactCompany: text("contact_company"),
  serviceInterest: text("service_interest"),
  requestSummary: text("request_summary"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("public_chat_conversations_needs_review_idx").on(t.needsReview, t.reviewStatus),
  index("public_chat_conversations_updated_at_idx").on(t.updatedAt),
]);

export const insertPublicChatConversationSchema = createInsertSchema(publicChatConversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPublicChatConversation = typeof publicChatConversationsTable.$inferInsert;
export type PublicChatConversation = typeof publicChatConversationsTable.$inferSelect;

// ── ShaneBot Engine Core — bot_instances + bot_conversations (#1097, epic #360) ──
// The two foundational tables the shared ShaneBot engine (api-server
// src/lib/shanebot-engine.ts) is built on. Deliberately sized for EXACTLY the two
// permanent instances that will ever exist — shanebot_public and shanebot_paid —
// NOT a generic bot-builder. The generic-engine scope lives in #365's history if a
// real 3rd bot need ever materializes; it is not built speculatively here.
//
// The behavioral CONFIG of each instance (persona surface, grounding source,
// allowed actions, cost owner) is code-canonical — it lives in shanebot-engine.ts
// and is seeded into these rows to match. The engine reads the code definition, so
// a chat route never hard-depends on a row being seeded. These rows exist for FK
// integrity (bot_conversations.instanceId) and future admin visibility.

/** How an instance authenticates its callers. */
export const botAuthMode = ["public", "portal_authenticated"] as const;
export type BotAuthMode = (typeof botAuthMode)[number];

/**
 * The grounding shape an instance uses. NOT a pluggable node-type registry — only
 * these two hand-written builder functions will ever exist:
 *   live_catalog          — the public site's live services catalog (shanebot_public)
 *   customer_entitlements — the authenticated customer's own tenant data (shanebot_paid)
 * Each maps to one builder in shanebot-engine.ts. Adding a value here without a
 * matching builder is a deliberate no-op, not a config-driven extension point.
 */
export const botGroundingSource = ["live_catalog", "customer_entitlements"] as const;
export type BotGroundingSource = (typeof botGroundingSource)[number];

/** Who pays for an instance's model spend. */
export const botCostOwner = ["platform", "msp"] as const;
export type BotCostOwner = (typeof botCostOwner)[number];

/**
 * An action the model may request via a control token, gated PER-INSTANCE by
 * allowedActions. The action_router in shanebot-engine.ts re-checks the emitting
 * instance's allowedActions before anything fires — public ([]) can fire none.
 */
export const botAction = ["regenerate_document", "rerun_scan"] as const;
export type BotAction = (typeof botAction)[number];

export const botInstancesTable = pgTable("bot_instances", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  authMode: text("auth_mode", { enum: botAuthMode }).notNull(),
  groundingSource: text("grounding_source", { enum: botGroundingSource }).notNull(),
  // [] for public, ["regenerate_document","rerun_scan"] for paid. Every entry is a
  // botAction value; the action_router re-validates membership at fire time.
  allowedActions: jsonb("allowed_actions").$type<BotAction[]>().notNull().default([]),
  costOwner: text("cost_owner", { enum: botCostOwner }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotInstanceSchema = createInsertSchema(botInstancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBotInstance = typeof botInstancesTable.$inferInsert;
export type BotInstance = typeof botInstancesTable.$inferSelect;

/**
 * One stored transcript turn. Content is an array of structured ChatContentBlock
 * (the SAME shape both ShaneBot surfaces already use via chat-content-blocks.ts) —
 * so the reserved `card` block type needs no future DDL to introduce.
 */
export interface BotConversationMessage {
  role: (typeof publicChatMessageRole)[number];
  content: ChatContentBlock[];
  at: string;
}

// One row per chat session/thread. instanceId FKs bot_instances. The whole
// transcript is re-upserted each turn (same pattern as public_chat_conversations).
export const botConversationsTable = pgTable("bot_conversations", {
  id: serial("id").primaryKey(),
  instanceId: integer("instance_id")
    .notNull()
    .references(() => botInstancesTable.id),
  // Client-generated stable id so multi-turn upserts land on one row. Text (not the
  // pg uuid type) to tolerate any client value, same as public_chat_conversations.
  sessionId: text("session_id").notNull().unique(),
  transcript: jsonb("transcript").$type<BotConversationMessage[]>().notNull().default([]),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("bot_conversations_instance_idx").on(t.instanceId),
  index("bot_conversations_updated_at_idx").on(t.updatedAt),
]);

export const insertBotConversationSchema = createInsertSchema(botConversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBotConversation = typeof botConversationsTable.$inferInsert;
export type BotConversation = typeof botConversationsTable.$inferSelect;

// ── Active Directory — Organizational Units (Phase 5, placeholder objects) ────
// A real, creatable/browsable OU container node in the Active Directory tree.
// Shane's original note: "OUs undefined right now, but put a placeholder for
// later policies... this might be where we lock the MSP in the next version."
// That later version is #1547: the OU is now the attachment point for a
// standing policy (`standingPoliciesTable`, schema/msp.ts, `ou_id` FK). The
// directive still holds HERE — deliberately no policy columns and no
// object-to-OU membership model on THIS table; the policy object is a separate
// table that references this one, not columns bolted onto the container.
// #1952 adds the membership model itself as its own sibling table
// (`activeDirectoryOuAssignmentsTable`, below) — same shape: it references
// this container, it doesn't become columns on it.

export const activeDirectoryOusTable = pgTable("active_directory_ous", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Which real customer tenant this OU node governs (#1549). Nullable and
   * additive — an OU created before this column, or one representing a
   * platform/MSP-level grouping node in the admin tree rather than a single
   * customer, legitimately has no tenant. A standing policy attached to a
   * tenant-less OU has nothing for the continuous-evaluation loop to check
   * against, and evaluates as `not_evaluable`, not a guess. Still no policy
   * columns and no object-to-OU membership model here — see the note above:
   * this is the attachment point's OWN missing link (which tenant), not the
   * membership question that note deliberately still defers.
   */
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("active_directory_ous_tenant_id_idx").on(t.tenantId),
]);

export type InsertActiveDirectoryOu = typeof activeDirectoryOusTable.$inferInsert;
export type ActiveDirectoryOu = typeof activeDirectoryOusTable.$inferSelect;

// ── Active Directory — OU manual membership assignment (Git #1952) ──────────
// Shane's final decision on #1952 (2026-09-01): keep the Graph `department`-field
// match (policy-compliance-graph.ts) as the primary/automatic OU-membership
// resolution, but add a real manual override for the case that decision itself
// flagged and Shane later confirmed from real usage — most tenants don't
// populate `department` at all, and where it is set it's often stale. A row
// here for (customerId, objectId) is an explicit assignment that WINS over the
// department-match guess for that object, exactly like `portal_ownership_assignments`:
// an explicit row overrides a derived/computed value, current-state only (no
// history table — this is a small admin override, not a RACI audit trail).
//
// One row per real Graph object (a tenant's AAD user, resolved and verified via
// Graph at assignment time, never trusted from client input alone) per customer.
// An object can only be manually placed in ONE OU at a time — mirrors real AD
// semantics (one object, one OU) — so re-assigning an already-assigned object
// updates its existing row rather than adding a second one.
export const activeDirectoryOuAssignmentsTable = pgTable("active_directory_ou_assignments", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  ouId: integer("ou_id").notNull().references(() => activeDirectoryOusTable.id, { onDelete: "cascade" }),
  /** tenants.id — the customer whose real directory this object lives in. No FK,
   * matching msp_diagnostic_runs' customerId convention. */
  customerId: integer("customer_id").notNull(),
  /** The real Graph tenant id (tenants.tenant_id), denormalized so the
   * Graph-facing resolver in policy-compliance-graph.ts never needs a join back
   * to tenants just to know which tenant to query. */
  tenantId: text("tenant_id").notNull(),
  /** The real Graph object id (AAD user guid), resolved via Graph at assign time. */
  objectId: text("object_id").notNull(),
  /** The real Graph userPrincipalName, captured at assign time — this is what
   * resolveOuMembers matches mailbox-usage rows against. */
  objectUpn: text("object_upn").notNull(),
  /** Display label captured at assign time for the admin UI. Convenience only,
   * never re-derived or trusted as authoritative. */
  objectDisplayName: text("object_display_name"),
  assignedByUserId: integer("assigned_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("active_directory_ou_assignments_ou_id_idx").on(t.ouId),
  index("active_directory_ou_assignments_customer_id_idx").on(t.customerId),
  uniqueIndex("active_directory_ou_assignments_customer_object_idx").on(t.customerId, t.objectId),
]);

export type InsertActiveDirectoryOuAssignment = typeof activeDirectoryOuAssignmentsTable.$inferInsert;
export type ActiveDirectoryOuAssignment = typeof activeDirectoryOuAssignmentsTable.$inferSelect;

// ── User Entitlement Overrides (Active Directory Phase 7) ───────────────────
//
// Phase 2's deriveEntitlements() derives entitlements purely from the linked
// MSP's subscription tier (servicesTable.typeAttributes.tierCapabilities) —
// there is no per-user override concept anywhere else in the schema. Issue
// #67 requires PlatformAdmin to grant/revoke INDIVIDUAL entitlements on one
// account, so this is the smallest table that can express that: one row per
// (user, capability key) whose inherited tier value is overridden. Only the
// boolean tierCapabilities map is overridable here — numeric allowances
// (tenantAllowance/aiCreditAllowance/overageRateCents) stay purely
// tier-inherited, since Issue #67 talks about discrete "individual
// entitlements", not numeric quota overrides.

export const userEntitlementOverridesTable = pgTable("user_entitlement_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  capabilityKey: text("capability_key").notNull(),
  enabled: boolean("enabled").notNull(),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_entitlement_overrides_user_capability_uniq").on(t.userId, t.capabilityKey),
  index("user_entitlement_overrides_user_id_idx").on(t.userId),
]);

export type InsertUserEntitlementOverride = typeof userEntitlementOverridesTable.$inferInsert;
export type UserEntitlementOverride = typeof userEntitlementOverridesTable.$inferSelect;

// ── Build Tracker ─────────────────────────────────────────────────────────────
//
// Three tables that let the admin organise Claude AI chat links against GitHub
// Epics / Issues (or free-form categories like "Marketing", "Planning").
// See lib/db/migrations/manual/2026-08-09-build-tracker.sql for the DDL.

export const btEpicsTable = pgTable("bt_epics", {
  id:            serial("id").primaryKey(),
  title:         text("title").notNull(),
  description:   text("description"),
  /** open | in_progress | closed */
  status:        text("status").notNull().default("open"),
  /** Non-null when the epic was imported from GitHub. Unique (nulls excepted)
   * so GitHub sync can upsert by this column instead of delete-then-reinsert
   * — the delete was destroying bt_chats.epic_id links via their own
   * onDelete: "set null" foreign key on every sync (Git #693). */
  githubNumber:  integer("github_number").unique(),
  milestoneId:   integer("milestone_id"),
  /** Non-null when this epic is itself a sub-issue of another tracked epic
   * (GitHub sub-issues can nest — an issue with its own sub-issues gets
   * promoted into this table same as a top-level epic, see sync's
   * getParentNumber() usage). Without this, a nested one showed up as an
   * unrelated top-level epic with no visible tie back to its real parent —
   * easy to lose track of, and if it got closed while its own children were
   * still open, the whole thing vanished (Git #699). */
  parentEpicId:  integer("parent_epic_id").references((): AnyPgColumn => btEpicsTable.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertBtEpic = typeof btEpicsTable.$inferInsert;
export type BtEpic       = typeof btEpicsTable.$inferSelect;

export const btIssuesTable = pgTable("bt_issues", {
  id:            serial("id").primaryKey(),
  epicId:        integer("epic_id").references(() => btEpicsTable.id, { onDelete: "set null" }),
  milestoneId:   integer("milestone_id"),
  title:         text("title").notNull(),
  description:   text("description"),
  /** backlog | in_progress | done | closed */
  status:        text("status").notNull().default("backlog"),
  /** Unique (nulls excepted) — same reason as bt_epics.github_number above. */
  githubNumber:  integer("github_number").unique(),
  githubUrl:     text("github_url"),
  labels:        text("labels").array().notNull().default(sql`'{}'::text[]`),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertBtIssue = typeof btIssuesTable.$inferInsert;
export type BtIssue       = typeof btIssuesTable.$inferSelect;

export const btChatsTable = pgTable("bt_chats", {
  id:              serial("id").primaryKey(),
  /** UUID from claude.ai; full URL = https://claude.ai/chat/<conversationId> */
  conversationId:  text("conversation_id").notNull().unique(),
  /** Human label — defaults to conversationId on ingest, editable after. */
  title:           text("title").notNull(),
  issueId:         integer("issue_id").references(() => btIssuesTable.id, { onDelete: "set null" }),
  epicId:          integer("epic_id").references(() => btEpicsTable.id,   { onDelete: "set null" }),
  /** Free-form category for chats not tied to an epic/issue (e.g. "Marketing"). */
  category:        text("category"),
  notes:           text("notes"),
  /** Soft-hide from the default Chats panel view — the real row + all associations (bt_chat_issues, epic/issue links) stay intact; reversible via unarchive. */
  archived:        boolean("archived").notNull().default(false),
  archivedAt:      timestamp("archived_at", { withTimezone: true }),
  /** Git #1480 — "primary" | "secondary", the BuildConsole title-bar account toggle's value at
   * the moment this chat was created. Stamped once at creation, never reassigned on re-link.
   * NOT NULL DEFAULT 'primary' so every chat that predates this column backfills as Primary. */
  account:         text("account").notNull().default("primary"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertBtChat = typeof btChatsTable.$inferInsert;
export type BtChat       = typeof btChatsTable.$inferSelect;

/**
 * Many-to-many join table between Claude chats (bt_chats) and GitHub issues/epics/milestones.
 * Allows a single chat to be associated with multiple issues over its lifetime.
 */
export const btChatIssuesTable = pgTable("bt_chat_issues", {
  id:              serial("id").primaryKey(),
  chatId:          integer("chat_id").references(() => btChatsTable.id, { onDelete: "cascade" }).notNull(),
  /** GitHub issue/epic/milestone number */
  issueNumber:     integer("issue_number").notNull(),
  associatedAt:    timestamp("associated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chatIssueUnique: uniqueIndex("bt_chat_issues_chat_issue_unique").on(table.chatId, table.issueNumber),
  chatIdIdx:       index("bt_chat_issues_chat_id_idx").on(table.chatId),
  issueNumberIdx:  index("bt_chat_issues_issue_number_idx").on(table.issueNumber),
}));

export type InsertBtChatIssue = typeof btChatIssuesTable.$inferInsert;
export type BtChatIssue       = typeof btChatIssuesTable.$inferSelect;

/**
 * Git #2066 — the noisy, auto-detected signal: every `#NNN` a chat's own text has ever
 * contained, scraped client-side by IssueMentionInjector.cs (Git #1253) and reported here
 * on every debounced DOM scan. Deliberately NOT the same table as bt_chat_issues above —
 * that one is a deliberate/authoritative association (explicit Link/Unlink actions,
 * epic_id resolution fallback); this one is many, changing, and never authoritative.
 * Keyed on the chat's own URL text (not a bt_chats FK) so a mention can be recorded even
 * for a chat that has never been explicitly linked to anything. Auto-pruned by MainWindow
 * off the same `GitBoardOpenIssuesRefreshed` open-issue-set event the rest of the app
 * already uses to react to an issue closing.
 */
export const btChatMentionedIssuesTable = pgTable("bt_chat_mentioned_issues", {
  id:              serial("id").primaryKey(),
  /** Full https://claude.ai/chat/<uuid> — matches BoardChat.ClaudeUrl. */
  chatUrl:         text("chat_url").notNull(),
  issueNumber:     integer("issue_number").notNull(),
  firstSeenAt:     timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt:      timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chatIssueUnique: uniqueIndex("bt_chat_mentioned_issues_chat_issue_unique").on(table.chatUrl, table.issueNumber),
  chatUrlIdx:      index("bt_chat_mentioned_issues_chat_url_idx").on(table.chatUrl),
  issueNumberIdx:  index("bt_chat_mentioned_issues_issue_number_idx").on(table.issueNumber),
}));

export type InsertBtChatMentionedIssue = typeof btChatMentionedIssuesTable.$inferInsert;
export type BtChatMentionedIssue       = typeof btChatMentionedIssuesTable.$inferSelect;

/**
 * Git #790 — Shane: "if we could really build me a true queued up build...
 * that would speed up my development time like mad." A build he's not
 * ready to launch yet (or is deliberately queuing behind another one) sits
 * here until `scripts/build-queue-watcher.ps1` (a persistent local watcher
 * he runs on his own machine) claims it and launches a real Claude Code
 * session via the same mechanism `run-claude.ps1` uses for mybuilder://.
 */
export const btBuildQueueTable = pgTable("bt_build_queue", {
  id:              serial("id").primaryKey(),
  title:           text("title").notNull(),
  prompt:          text("prompt").notNull(),
  model:           text("model"),
  effort:          text("effort"),
  /** Build Sets — an optional named group (the `--buildSet <name>` build-prompt header flag) shared by a stack of related builds. When set, the scripts/dev-server coordinator DEFERS the dev-server restart until every member of the set has merged, then fires exactly ONE restart+rebuild of all services + one combined test pass — instead of tearing down and rebuilding all four services once per build. Ungrouped builds (null) keep the existing per-build coalescing. */
  buildSet:        text("build_set"),
  cwd:             text("cwd"),
  /** GitHub issue number this build is itself FOR, if any — lets the panel reuse the same epic/issue linking the rest of this file already does. */
  githubNumber:    integer("github_number"),
  /** GitHub issue number this build can't start until closed/complete — null means ready to run as soon as a slot frees up. Superseded by blockedByNumbers for anything queued after Git #813 (Shane tried "--blocked-by 807,808,809" — a real multi-blocker need this single column can't express); kept for old rows and as a single-value fallback. */
  blockedByNumber: integer("blocked_by_number"),
  /** Git #813 — real multi-blocker support: null/empty means no extra blockers beyond blockedByNumber (if set). ALL of these must clear before the item is claimable. */
  blockedByNumbers: integer("blocked_by_numbers").array(),
  /** queued | running | done | failed | canceled | verifying | superseded */
  status:          text("status").notNull().default("queued"),
  /** Set by the watcher the moment it claims this row — the source of truth for "is this actually running right now," since a watcher can be killed/restarted without the DB ever finding out otherwise. */
  claimedAt:       timestamp("claimed_at", { withTimezone: true }),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  exitCode:        integer("exit_code"),
  /** Git #826 — Shane: "how do I respond when Code has a question... I need to be able to answer." claude.exe --print is one-shot; by the time Shane reads a question in the finished log, that process has already exited. Captured from the stream-json "system" init event's own session_id the moment a launch's output reveals it (persistence is on by default, --print sessions ARE resumable) so a later Reply can continue the EXACT same conversation via --resume, not start a stateless new one. */
  sessionId:       text("session_id"),
  /** Git #826 — set at queue time by a Reply action: tells the watcher to launch this item with `--resume <resumeSessionId>` instead of a fresh session, with `prompt` as the reply text continuing that conversation. */
  resumeSessionId: text("resume_session_id"),
  /** Git #2119 — set on the ORIGINAL row when a Reply/resume spawns a fresh `Reply → <title>` row to continue its session: points at that replacement row's id, and the original's status flips to `superseded`. Without this the original card sat in the queue forever showing stale active status while the real resumed work happened under a disconnected new entry. FK → bt_build_queue(id) ON DELETE SET NULL. */
  supersededById:  integer("superseded_by_id"),
  /** Originating Claude conversation UUID (from bt_chats.conversation_id) when queued from a chat */
  originatingChatId: text("originating_chat_id"),
  /** Full Claude chat URL when queued from a chat */
  chatUrl:         text("chat_url"),
  cli:             text("cli"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertBtBuildQueueItem = typeof btBuildQueueTable.$inferInsert;
export type BtBuildQueueItem       = typeof btBuildQueueTable.$inferSelect;

/** Git #2103 — one row per REAL build dispatch (a fresh claude.exe launch for a queued issue — never a Reply/--resume continuation, which picks back up the same session instead). Written by QueueWatcherService.LaunchItem right before the process spawns, so a pre-launch re-dispatch count (against the issue's real GitHub project-board status-change history) is never off-by-one. */
export const buildDispatchLogTable = pgTable("build_dispatch_log", {
  id:           serial("id").primaryKey(),
  issueNumber:  integer("issue_number").notNull(),
  /** FK -> bt_build_queue(id) — the exact queue row this dispatch came from, so MarkCompleteAsync can write session_id/outcome back onto this same row without a fragile in-memory correlation map. */
  queueItemId:  integer("queue_item_id"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
  sessionId:    text("session_id"),
  /** Filled in at completion — mirrors bt_build_queue.status's terminal values (done | verifying | failed). Null while the dispatch is still running. */
  outcome:      text("outcome"),
});

export type InsertBuildDispatchLogRow = typeof buildDispatchLogTable.$inferInsert;
export type BuildDispatchLogRow       = typeof buildDispatchLogTable.$inferSelect;

export * from "./msp";

export * from "./config-state";

export * from "./config-snapshots";

export * from "./config-diffs";

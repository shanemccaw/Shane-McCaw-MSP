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
  integer,
  boolean,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMspSchema = createInsertSchema(mspsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Msp = typeof mspsTable.$inferSelect;
export type InsertMsp = typeof mspsTable.$inferInsert;

// ── Customers (end-customer organisations belonging to an MSP) ─────────────────

export const mspCustomersTable = pgTable("msp_customers", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  tenantId: text("tenant_id"),
  status: text("status", { enum: ["active", "inactive", "onboarding", "archived"] }).notNull().default("onboarding"),
  ownerType: text("owner_type", { enum: ["customer", "msp", "platform"] }).notNull().default("customer"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_customers_msp_id_idx").on(t.mspId),
]);

export const insertMspCustomerSchema = createInsertSchema(mspCustomersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspCustomer = typeof mspCustomersTable.$inferSelect;
export type InsertMspCustomer = typeof mspCustomersTable.$inferInsert;

// ── MSP User Role Hierarchy ────────────────────────────────────────────────────
//
// PlatformAdmin  — full platform access, cross-MSP
// MSPAdmin       — full access within their MSP
// MSPOperator    — operational access within their MSP (no billing/settings)
// CustomerUser   — access to their own customer portal
// ServiceAccount — API key / machine identity
// Free           — gates to free-assessment results only; upgrade flips to CustomerUser

export const MSP_ROLES = ["PlatformAdmin", "MSPAdmin", "MSPOperator", "CustomerUser", "ServiceAccount", "Free"] as const;
export type MspRole = typeof MSP_ROLES[number];

// ── MSP Users (extended profile rows — one per user who has an MSP role) ───────
// The core identity still lives in the existing users table.
// This table links a users.id to its MSP-scoped role + tenant scope.

export const mspUsersTable = pgTable("msp_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "restrict" }),
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "restrict" }),
  mspRole: text("msp_role", { enum: MSP_ROLES }).notNull().default("Free"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_users_msp_id_idx").on(t.mspId),
  index("msp_users_customer_id_idx").on(t.customerId),
]);

export const insertMspUserSchema = createInsertSchema(mspUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type MspUser = typeof mspUsersTable.$inferSelect;
export type InsertMspUser = typeof mspUsersTable.$inferInsert;

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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
// One row per customer Azure AD tenant. Created/updated by the admin-consent
// OAuth callback. The platform's multi-tenant app registration is the identity;
// no per-customer credential is ever stored.

export const tenantConsentTable = pgTable("tenant_consent", {
  tenantId: text("tenant_id").primaryKey(),
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
  clientUserId: integer("client_user_id"),
  consentStatus: text("consent_status", {
    enum: ["pending", "granted", "declined", "revoked"],
  }).notNull().default("pending"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  adminEmail: text("admin_email"),
  adminDisplayName: text("admin_display_name"),
  scopesGranted: jsonb("scopes_granted").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tenant_consent_customer_id_idx").on(t.customerId),
  index("tenant_consent_status_idx").on(t.consentStatus),
]);

export type TenantConsent = typeof tenantConsentTable.$inferSelect;
export type InsertTenantConsent = typeof tenantConsentTable.$inferInsert;

// ── Consent Invite Tokens ──────────────────────────────────────────────────────
// Single-use expiring tokens that wrap the admin-consent redirect URL.
// One token is created per onboarding invite; it is burned on first use or on expiry.

export const consentInviteTokensTable = pgTable("consent_invite_tokens", {
  token: text("token").primaryKey(),
  tenantId: text("tenant_id"),
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "cascade" }),
  clientUserId: integer("client_user_id"),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "cascade" }),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_usage_events_msp_id_idx").on(t.mspId),
  index("ai_usage_events_occurred_at_idx").on(t.occurredAt),
  index("ai_usage_events_cost_owner_idx").on(t.costOwner),
  index("ai_usage_events_run_id_idx").on(t.runId),
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
  properties: jsonb("properties").$type<string[]>().notNull().default([]),
  mapping: jsonb("mapping").$type<Array<{ sourceField: string; targetField: string; transform?: string }>>().notNull().default([]),
  severityRules: jsonb("severity_rules").$type<Array<{ expression: string; severity: string; label?: string }>>().notNull().default([]),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  engines: jsonb("engines").$type<string[]>().notNull().default([]),
  frequency: text("frequency", { enum: MONITOR_CHECK_FREQUENCY }).notNull().default("daily"),
  requiresCustomerScript: boolean("requires_customer_script").notNull().default(false),
  schemaVersion: integer("schema_version").notNull().default(1),
  status: text("status", { enum: MONITOR_CHECK_STATUS }).notNull().default("active"),
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

export const TENANT_MONITOR_PROFILE_STATUS = ["ok", "error", "consent_revoked", "requires_script"] as const;
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
] as const;
export type ReportDocType = typeof REPORT_DOC_TYPES[number];

export const REPORT_DELIVERY_METHODS = ["in_app", "email", "both"] as const;
export type ReportDeliveryMethod = typeof REPORT_DELIVERY_METHODS[number];

export const mspReportDefinitionsTable = pgTable("msp_report_definitions", {
  id: serial("id").primaryKey(),
  definitionId: uuid("definition_id").notNull().unique().defaultRandom(),
  mspId: integer("msp_id").notNull().references(() => mspsTable.id, { onDelete: "cascade" }),
  // Optional scope — null means "across all customers"
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_report_runs_msp_id_idx").on(t.mspId),
  index("msp_report_runs_def_id_idx").on(t.definitionId),
  index("msp_report_runs_status_idx").on(t.status),
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
  customerId: integer("customer_id").notNull().references(() => mspCustomersTable.id, { onDelete: "restrict" }),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
  tenantId: text("tenant_id"),
  packageKey: text("package_key").notNull().default("default"),
  status: text("status", { enum: MSP_DIAGNOSTIC_RUN_STATUS }).notNull().default("pending"),
  triggeredByUserId: integer("triggered_by_user_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  checksTotal: integer("checks_total").notNull().default(0),
  checksOk: integer("checks_ok").notNull().default(0),
  checksError: integer("checks_error").notNull().default(0),
  checksRequiresScript: integer("checks_requires_script").notNull().default(0),
  runStatus: text("run_status"),
  documentId: uuid("document_id"),
  errorMessage: text("error_message"),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_diagnostic_findings_run_id_idx").on(t.runId),
  index("msp_diagnostic_findings_customer_id_idx").on(t.customerId),
  index("msp_diagnostic_findings_severity_idx").on(t.severity),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
  customerId: integer("customer_id").references(() => mspCustomersTable.id, { onDelete: "set null" }),
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
] as const;
export type MspAlertConditionType = typeof MSP_ALERT_CONDITION_TYPES[number];

export const MSP_ALERT_SEVERITIES = ["warning", "critical"] as const;
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

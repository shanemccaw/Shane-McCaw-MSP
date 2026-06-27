import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  source: text("source", { enum: ["contact_form", "lead_magnet", "ai_recommended", "ai_suggested"] }).notNull().default("contact_form"),
  status: text("status", { enum: ["new", "contacted", "qualified", "converted", "archived"] }).notNull().default("new"),
  howFound: text("how_found"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Qualification Engine — scoring fields
  score: integer("score").notNull().default(0),
  previousScore: integer("previous_score").notNull().default(0),
  stage: text("stage", { enum: ["Lead", "AQL", "SQL"] }).notNull().default("Lead"),
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
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLead = typeof leadsTable.$inferInsert;
export type Lead = typeof leadsTable.$inferSelect;

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
  orderWorkflow: jsonb("order_workflow").$type<WizardStep[]>(),
  durationDays: integer("duration_days"),
  turnaround: text("turnaround"),
  billingType: text("billing_type", { enum: ["one_time", "recurring_monthly"] }).notNull().default("one_time"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
});

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
  projectType: text("project_type", { enum: ["project", "retainer"] }).notNull().default("project"),
  sharepointFolderUrl: text("sharepoint_folder_url"),
  generatedArtifacts: jsonb("generated_artifacts").$type<Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertProject = typeof projectsTable.$inferInsert;
export type Project = typeof projectsTable.$inferSelect;

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
});

export type InsertWorkflowStep = typeof workflowStepsTable.$inferInsert;
export type WorkflowStep = typeof workflowStepsTable.$inferSelect;

// Kanban tasks (within projects)
export const kanbanTasksTable = pgTable("kanban_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  column: text("column", { enum: ["backlog", "in_progress", "waiting_on_customer", "completed"] }).notNull().default("backlog"),
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
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
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
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  body: text("body"),
  type: text("type", { enum: ["project_update", "message", "invoice", "document", "general"] }).notNull().default("general"),
  read: boolean("read").notNull().default(false),
  linkPath: text("link_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertNotification = typeof notificationsTable.$inferInsert;
export type Notification = typeof notificationsTable.$inferSelect;

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

// Engagement Project Types (shown on Pricing page Track 02, used for SOW generation)
export const engagementProjectsTable = pgTable("engagement_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  priceRange: text("price_range").notNull(),
  description: text("description"),
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
  conversation: jsonb("conversation").$type<QuizConversationEntry[]>().notNull().default([]),
  quizType: text("quiz_type").notNull().default("copilot"),
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

// ── Site Analytics ─────────────────────────────────────────────────────────────
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
export const clientAppRegistrationsTable = pgTable("client_app_registrations", {
  id: serial("id").primaryKey(),
  clientUserId: integer("client_user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  azureClientId: text("azure_client_id").notNull(),
  keyVaultSecretName: text("key_vault_secret_name").notNull(),
  status: text("status", { enum: ["pending", "submitted", "verified"] }).notNull().default("pending"),
  submittedAt: timestamp("submitted_at"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertClientAppRegistration = typeof clientAppRegistrationsTable.$inferInsert;
export type ClientAppRegistration = typeof clientAppRegistrationsTable.$inferSelect;

// Service page trigger key mappings — which engagement project trigger keys each service page shows
export const servicePageTriggerKeysTable = pgTable("service_page_trigger_keys", {
  id: serial("id").primaryKey(),
  pageSlug: text("page_slug").notNull().unique(),
  triggerKeys: jsonb("trigger_keys").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ServicePageTriggerKey = typeof servicePageTriggerKeysTable.$inferSelect;
export type InsertServicePageTriggerKey = typeof servicePageTriggerKeysTable.$inferInsert;

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
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  scoreSnapshot: integer("score_snapshot").notNull().default(0),
  scoreFit: integer("score_fit").notNull().default(0),
  scorePain: integer("score_pain").notNull().default(0),
  scoreMaturity: integer("score_maturity").notNull().default(0),
  scoreIntent: integer("score_intent").notNull().default(0),
  scoreUrgency: integer("score_urgency").notNull().default(0),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  recommendedNextStep: text("recommended_next_step"),
  workflowType: text("workflow_type"),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  stage: text("stage", { enum: ["AQL", "SQL"] }).notNull(),
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
  convertedLeadId: integer("converted_lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type InsertCampaignAsset = typeof campaignAssetsTable.$inferInsert;
export type CampaignAsset = typeof campaignAssetsTable.$inferSelect;

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

// ── Email Events (Resend webhook tracking) ───────────────────────────────────

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
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertLandingPage = typeof landingPagesTable.$inferInsert;
export type LandingPage = typeof landingPagesTable.$inferSelect;

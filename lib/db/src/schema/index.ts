import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb } from "drizzle-orm/pg-core";
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
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "client"] }).notNull().default("client"),
  name: text("name"),
  company: text("company"),
  phone: text("phone"),
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
  source: text("source", { enum: ["contact_form", "lead_magnet"] }).notNull().default("contact_form"),
  status: text("status", { enum: ["new", "contacted", "qualified", "converted", "archived"] }).notNull().default("new"),
  howFound: text("how_found"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  deliverables: text("deliverables"),
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
  sortOrder: integer("sort_order").notNull().default(0),
  // Direct link to workflow template (replaces the project_templates join table).
  // FK to workflow_templates(id) ON DELETE SET NULL is enforced at the DB level only
  // (via migrate-prod.ts) to avoid a circular TypeScript inference loop — both tables
  // already reference each other.
  workflowTemplateId: integer("workflow_template_id"),
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
  priority: text("priority"),
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
  userId: integer("user_id").notNull().references(() => usersTable.id),
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

// Engagement Project Types (shown on Pricing page Track 02, used for SOW generation)
export const engagementProjectsTable = pgTable("engagement_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  priceRange: text("price_range").notNull(),
  description: text("description"),
  triggeredBy: jsonb("triggered_by").$type<string[]>().notNull().default([]),
  sowItems: jsonb("sow_items").$type<string[]>().notNull().default([]),
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
  nextSteps: jsonb("next_steps").$type<Array<{ label: string; title: string; description: string }>>().notNull().default([]),
  reportDate: timestamp("report_date"),
  sentAt: timestamp("sent_at"),
  clientStatus: text("client_status", { enum: ["pending", "accepted", "has_questions"] }).notNull().default("pending"),
  clientQuestion: text("client_question"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertStatusReport = typeof statusReportsTable.$inferInsert;
export type StatusReport = typeof statusReportsTable.$inferSelect;

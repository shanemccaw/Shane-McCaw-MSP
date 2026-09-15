import { pgTable, serial, text, timestamp, integer, boolean, jsonb, uuid, primaryKey } from "drizzle-orm/pg-core";
import { servicesTable, powershellScriptsTable, scriptPackagesTable, workflowTemplatesTable } from "./index.ts";

// #4277 — reverse-engineered from the live `shanemccawmsp` database's
// `information_schema` (these tables had no pgTable definition anywhere in
// lib/db/src/schema/). Column types, defaults, constraints and FKs below match
// live reality, not the assumed shape. Grouped here because each is a small,
// standalone table with no natural home among the existing feature files.

export const customSignalsTable = pgTable("custom_signals", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  expectedImpact: text("expected_impact").notNull().default(""),
  isAdjustment: boolean("is_adjustment").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  recommendedRules: jsonb("recommended_rules").notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  exampleProfileKey: text("example_profile_key"),
  exampleFindingKeyword: text("example_finding_keyword"),
});

export type CustomSignal = typeof customSignalsTable.$inferSelect;
export type InsertCustomSignal = typeof customSignalsTable.$inferInsert;

export const projectTemplatesTable = pgTable("project_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  workflowTemplateId: integer("workflow_template_id").references(() => workflowTemplatesTable.id),
  serviceId: integer("service_id").references(() => servicesTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ProjectTemplate = typeof projectTemplatesTable.$inferSelect;
export type InsertProjectTemplate = typeof projectTemplatesTable.$inferInsert;

export const projectTemplateTasksTable = pgTable("project_template_tasks", {
  id: serial("id").primaryKey(),
  projectTemplateId: integer("project_template_id").notNull().references(() => projectTemplatesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  workflowTemplateStepId: integer("workflow_template_step_id"),
  groupName: text("group_name"),
});

export type ProjectTemplateTask = typeof projectTemplateTasksTable.$inferSelect;
export type InsertProjectTemplateTask = typeof projectTemplateTasksTable.$inferInsert;

export const quizPainMappingsTable = pgTable("quiz_pain_mappings", {
  id: serial("id").primaryKey(),
  quizTypePainMap: jsonb("quiz_type_pain_map").notNull().default({}),
  categoryPainMap: jsonb("category_pain_map").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type QuizPainMapping = typeof quizPainMappingsTable.$inferSelect;
export type InsertQuizPainMapping = typeof quizPainMappingsTable.$inferInsert;

export const servicePageTriggerKeysTable = pgTable("service_page_trigger_keys", {
  id: serial("id").primaryKey(),
  pageSlug: text("page_slug").notNull().unique(),
  triggerKeys: jsonb("trigger_keys").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ServicePageTriggerKey = typeof servicePageTriggerKeysTable.$inferSelect;
export type InsertServicePageTriggerKey = typeof servicePageTriggerKeysTable.$inferInsert;

export const serviceRequiredScriptsTable = pgTable("service_required_scripts", {
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  scriptId: uuid("script_id").notNull().references(() => powershellScriptsTable.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.serviceId, t.scriptId] }),
]);

export type ServiceRequiredScript = typeof serviceRequiredScriptsTable.$inferSelect;
export type InsertServiceRequiredScript = typeof serviceRequiredScriptsTable.$inferInsert;

export const serviceScriptSetsTable = pgTable("service_script_sets", {
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  scriptPackageId: uuid("script_package_id").notNull().references(() => scriptPackagesTable.id, { onDelete: "cascade" }),
  displayOrder: integer("display_order").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.serviceId, t.scriptPackageId] }),
]);

export type ServiceScriptSet = typeof serviceScriptSetsTable.$inferSelect;
export type InsertServiceScriptSet = typeof serviceScriptSetsTable.$inferInsert;

export const shanebuilderFeatureFlagsTable = pgTable("shanebuilder_feature_flags", {
  featureNumber: integer("feature_number").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedBy: text("paused_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShanebuilderFeatureFlag = typeof shanebuilderFeatureFlagsTable.$inferSelect;
export type InsertShanebuilderFeatureFlag = typeof shanebuilderFeatureFlagsTable.$inferInsert;

export const warRoomInteractionEventsTable = pgTable("war_room_interaction_events", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  sessionId: text("session_id"),
  eventName: text("event_name").notNull(),
  properties: jsonb("properties").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WarRoomInteractionEvent = typeof warRoomInteractionEventsTable.$inferSelect;
export type InsertWarRoomInteractionEvent = typeof warRoomInteractionEventsTable.$inferInsert;

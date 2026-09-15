import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb, uuid, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientServicesTable } from "./index.ts";

// #4277 — reverse-engineered from the live `shanemccawmsp` database's
// `information_schema` (these tables had no pgTable definition anywhere in
// lib/db/src/schema/). Column types, defaults, constraints and FKs below match
// live reality, not the assumed shape.

export const SCOPE_CREEP_FULFILLMENT_TYPES = ["assessment", "monitoring", "project", "retainer"] as const;
export type ScopeCreepFulfillmentType = (typeof SCOPE_CREEP_FULFILLMENT_TYPES)[number];

export const scopeCreepPoliciesTable = pgTable("scope_creep_policies", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id"),
  name: text("name").notNull(),
  description: text("description"),
  driftThresholdPct: numeric("drift_threshold_pct").notNull().default("20"),
  expansionThresholdPct: numeric("expansion_threshold_pct").notNull().default("15"),
  timelineSlipDays: numeric("timeline_slip_days").notNull().default("7"),
  driftWeight: numeric("drift_weight").notNull().default("33"),
  expansionWeight: numeric("expansion_weight").notNull().default("33"),
  timelineSlipWeight: numeric("timeline_slip_weight").notNull().default("34"),
  violationScoreThreshold: numeric("violation_score_threshold").notNull().default("60"),
  escalationRules: jsonb("escalation_rules").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  fulfillmentType: text("fulfillment_type", { enum: SCOPE_CREEP_FULFILLMENT_TYPES }),
}, (t) => [
  check("scope_creep_policies_fulfillment_type_check", sql`${t.fulfillmentType} = ANY (ARRAY['assessment'::text, 'monitoring'::text, 'project'::text, 'retainer'::text])`),
]);

export type ScopeCreepPolicy = typeof scopeCreepPoliciesTable.$inferSelect;
export type InsertScopeCreepPolicy = typeof scopeCreepPoliciesTable.$inferInsert;

export const scopeCreepAssignmentsTable = pgTable("scope_creep_assignments", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  policyId: integer("policy_id").notNull().references(() => scopeCreepPoliciesTable.id, { onDelete: "restrict" }),
  assignedByUserId: integer("assigned_by_user_id"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  clientServiceId: integer("client_service_id").references(() => clientServicesTable.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("scope_creep_assignments_msp_customer_service_key").on(t.mspId, t.customerId, t.clientServiceId),
]);

export type ScopeCreepAssignment = typeof scopeCreepAssignmentsTable.$inferSelect;
export type InsertScopeCreepAssignment = typeof scopeCreepAssignmentsTable.$inferInsert;

export const scopeCreepComplianceTable = pgTable("scope_creep_compliance", {
  id: serial("id").primaryKey(),
  recordId: uuid("record_id").notNull().defaultRandom().unique(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  policyId: integer("policy_id").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  totalDetections: integer("total_detections").notNull().default(0),
  violationCount: integer("violation_count").notNull().default(0),
  compliancePct: numeric("compliance_pct").notNull().default("100"),
  avgCompositeScore: numeric("avg_composite_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScopeCreepCompliance = typeof scopeCreepComplianceTable.$inferSelect;
export type InsertScopeCreepCompliance = typeof scopeCreepComplianceTable.$inferInsert;

export const SCOPE_CREEP_DETECTION_TYPES = ["drift", "expansion", "timeline_slip"] as const;
export type ScopeCreepDetectionType = (typeof SCOPE_CREEP_DETECTION_TYPES)[number];
export const SCOPE_CREEP_DETECTION_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type ScopeCreepDetectionStatus = (typeof SCOPE_CREEP_DETECTION_STATUSES)[number];

export const scopeCreepDetectionsTable = pgTable("scope_creep_detections", {
  id: serial("id").primaryKey(),
  detectionId: uuid("detection_id").notNull().defaultRandom().unique(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  policyId: integer("policy_id").notNull(),
  detectionType: text("detection_type", { enum: SCOPE_CREEP_DETECTION_TYPES }).notNull(),
  ref: text("ref"),
  baselineValue: numeric("baseline_value").notNull().default("0"),
  currentValue: numeric("current_value").notNull().default("0"),
  changePct: numeric("change_pct").notNull().default("0"),
  status: text("status", { enum: SCOPE_CREEP_DETECTION_STATUSES }).notNull().default("open"),
  idempotencyKey: text("idempotency_key").unique(),
  traceId: text("trace_id"),
  metadata: jsonb("metadata").notNull().default({}),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type ScopeCreepDetection = typeof scopeCreepDetectionsTable.$inferSelect;
export type InsertScopeCreepDetection = typeof scopeCreepDetectionsTable.$inferInsert;

export const SCOPE_CREEP_ESCALATION_TYPES = ["operator_task", "email", "sms", "webhook"] as const;
export type ScopeCreepEscalationType = (typeof SCOPE_CREEP_ESCALATION_TYPES)[number];
export const SCOPE_CREEP_ESCALATION_STATUSES = ["pending", "in_progress", "resolved"] as const;
export type ScopeCreepEscalationStatus = (typeof SCOPE_CREEP_ESCALATION_STATUSES)[number];

export const scopeCreepEscalationsTable = pgTable("scope_creep_escalations", {
  id: serial("id").primaryKey(),
  escalationId: uuid("escalation_id").notNull().defaultRandom().unique(),
  violationId: uuid("violation_id").notNull(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  level: integer("level").notNull().default(1),
  escalationType: text("escalation_type", { enum: SCOPE_CREEP_ESCALATION_TYPES }).notNull().default("operator_task"),
  status: text("status", { enum: SCOPE_CREEP_ESCALATION_STATUSES }).notNull().default("pending"),
  flagSowAmendment: boolean("flag_sow_amendment").notNull().default(false),
  flagPricingReview: boolean("flag_pricing_review").notNull().default(false),
  assignedTo: text("assigned_to"),
  target: text("target"),
  idempotencyKey: text("idempotency_key").unique(),
  traceId: text("trace_id"),
  metadata: jsonb("metadata").notNull().default({}),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScopeCreepEscalation = typeof scopeCreepEscalationsTable.$inferSelect;
export type InsertScopeCreepEscalation = typeof scopeCreepEscalationsTable.$inferInsert;

export const scopeCreepScoresTable = pgTable("scope_creep_scores", {
  id: serial("id").primaryKey(),
  scoreId: uuid("score_id").notNull().defaultRandom().unique(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  policyId: integer("policy_id").notNull(),
  driftScore: numeric("drift_score").notNull().default("0"),
  expansionScore: numeric("expansion_score").notNull().default("0"),
  timelineSlipScore: numeric("timeline_slip_score").notNull().default("0"),
  compositeScore: numeric("composite_score").notNull().default("0"),
  openDetections: integer("open_detections").notNull().default(0),
  idempotencyKey: text("idempotency_key").unique(),
  traceId: text("trace_id"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScopeCreepScore = typeof scopeCreepScoresTable.$inferSelect;
export type InsertScopeCreepScore = typeof scopeCreepScoresTable.$inferInsert;

export const SCOPE_CREEP_VIOLATION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type ScopeCreepViolationSeverity = (typeof SCOPE_CREEP_VIOLATION_SEVERITIES)[number];

export const scopeCreepViolationsTable = pgTable("scope_creep_violations", {
  id: serial("id").primaryKey(),
  violationId: uuid("violation_id").notNull().defaultRandom().unique(),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id").notNull(),
  policyId: integer("policy_id").notNull(),
  detectionId: uuid("detection_id"),
  severity: text("severity", { enum: SCOPE_CREEP_VIOLATION_SEVERITIES }).notNull().default("medium"),
  compositeScore: numeric("composite_score").notNull().default("0"),
  threshold: numeric("threshold").notNull().default("60"),
  operatorTaskId: integer("operator_task_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  idempotencyKey: text("idempotency_key").unique(),
  traceId: text("trace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScopeCreepViolation = typeof scopeCreepViolationsTable.$inferSelect;
export type InsertScopeCreepViolation = typeof scopeCreepViolationsTable.$inferInsert;

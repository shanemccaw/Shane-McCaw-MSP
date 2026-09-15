import { pgTable, serial, text, timestamp, integer, boolean, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mspsTable } from "./msp.ts";

// #4277 — reverse-engineered from the live `shanemccawmsp` database's
// `information_schema` (these tables had no pgTable definition anywhere in
// lib/db/src/schema/). Column types, defaults, constraints and FKs below match
// live reality, not the assumed shape.

export const slaPoliciesTable = pgTable("sla_policies", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  responseTimeMinutes: integer("response_time_minutes").notNull().default(60),
  warningThresholdPct: numeric("warning_threshold_pct", { precision: 5, scale: 2 }).notNull().default("80"),
  resolutionTimeMinutes: integer("resolution_time_minutes").notNull().default(480),
  resolutionWarningThresholdPct: numeric("resolution_warning_threshold_pct", { precision: 5, scale: 2 }).notNull().default("80"),
  escalationRules: jsonb("escalation_rules").notNull().default([]),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_policies_msp_id_idx").on(t.mspId),
]);

export type SlaPolicy = typeof slaPoliciesTable.$inferSelect;
export type InsertSlaPolicy = typeof slaPoliciesTable.$inferInsert;

export const mspSlaWeightsTable = pgTable("msp_sla_weights", {
  id: serial("id").primaryKey(),
  mspId: integer("msp_id").notNull().unique().references(() => mspsTable.id, { onDelete: "cascade" }),
  wSignal: numeric("w_signal", { precision: 5, scale: 2 }).notNull().default("50"),
  wTimer: numeric("w_timer", { precision: 5, scale: 2 }).notNull().default("50"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MspSlaWeight = typeof mspSlaWeightsTable.$inferSelect;
export type InsertMspSlaWeight = typeof mspSlaWeightsTable.$inferInsert;

export const slaTimersTable = pgTable("sla_timers", {
  id: serial("id").primaryKey(),
  timerId: text("timer_id").notNull().unique().default(sql`gen_random_uuid()::text`),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id"),
  policyId: integer("policy_id").references(() => slaPoliciesTable.id, { onDelete: "set null" }),
  ticketRef: text("ticket_ref"),
  ticketType: text("ticket_type"),
  status: text("status").notNull().default("running"),
  phase: text("phase").notNull().default("response"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  warningFiredAt: timestamp("warning_fired_at", { withTimezone: true }),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  traceId: text("trace_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_timers_msp_id_idx").on(t.mspId),
  index("sla_timers_status_idx").on(t.status),
]);

export type SlaTimer = typeof slaTimersTable.$inferSelect;
export type InsertSlaTimer = typeof slaTimersTable.$inferInsert;

export const slaBreachesTable = pgTable("sla_breaches", {
  id: serial("id").primaryKey(),
  breachId: text("breach_id").notNull().unique().default(sql`gen_random_uuid()::text`),
  timerId: text("timer_id").references(() => slaTimersTable.timerId, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id"),
  policyId: integer("policy_id").references(() => slaPoliciesTable.id, { onDelete: "set null" }),
  ticketRef: text("ticket_ref"),
  phase: text("phase").notNull().default("response"),
  breachType: text("breach_type").notNull().default("breach"),
  elapsedMinutes: numeric("elapsed_minutes", { precision: 10, scale: 2 }).notNull().default("0"),
  thresholdMinutes: integer("threshold_minutes").notNull().default(0),
  operatorTaskId: text("operator_task_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_breaches_msp_id_idx").on(t.mspId),
  index("sla_breaches_resolved_at_idx").on(t.resolvedAt),
]);

export type SlaBreach = typeof slaBreachesTable.$inferSelect;
export type InsertSlaBreach = typeof slaBreachesTable.$inferInsert;

export const slaComplianceRecordsTable = pgTable("sla_compliance_records", {
  id: serial("id").primaryKey(),
  recordId: text("record_id").notNull().unique().default(sql`gen_random_uuid()::text`),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id"),
  policyId: integer("policy_id").references(() => slaPoliciesTable.id, { onDelete: "set null" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  totalTickets: integer("total_tickets").notNull().default(0),
  breachedTickets: integer("breached_tickets").notNull().default(0),
  compliancePct: numeric("compliance_pct", { precision: 5, scale: 2 }).notNull().default("100"),
  avgResponseMinutes: numeric("avg_response_minutes", { precision: 10, scale: 2 }),
  avgResolutionMinutes: numeric("avg_resolution_minutes", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_compliance_msp_id_idx").on(t.mspId),
  index("sla_compliance_period_start_idx").on(t.periodStart),
]);

export type SlaComplianceRecord = typeof slaComplianceRecordsTable.$inferSelect;
export type InsertSlaComplianceRecord = typeof slaComplianceRecordsTable.$inferInsert;

export const slaEscalationsTable = pgTable("sla_escalations", {
  id: serial("id").primaryKey(),
  escalationId: text("escalation_id").notNull().unique().default(sql`gen_random_uuid()::text`),
  breachId: text("breach_id").references(() => slaBreachesTable.breachId, { onDelete: "cascade" }),
  mspId: integer("msp_id").notNull(),
  customerId: integer("customer_id"),
  level: integer("level").notNull().default(1),
  escalationType: text("escalation_type").notNull().default("operator_task"),
  status: text("status").notNull().default("pending"),
  assignedTo: text("assigned_to"),
  target: text("target"),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_escalations_msp_id_idx").on(t.mspId),
  index("sla_escalations_status_idx").on(t.status),
]);

export type SlaEscalation = typeof slaEscalationsTable.$inferSelect;
export type InsertSlaEscalation = typeof slaEscalationsTable.$inferInsert;

export const slaSignalPolicyMapTable = pgTable("sla_signal_policy_map", {
  id: serial("id").primaryKey(),
  signalKey: text("signal_key").notNull(),
  policyId: integer("policy_id").notNull().references(() => slaPoliciesTable.id, { onDelete: "cascade" }),
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sla_signal_policy_map_msp_id_idx").on(t.mspId),
  index("sla_signal_policy_map_signal_key_idx").on(t.signalKey),
]);

export type SlaSignalPolicyMap = typeof slaSignalPolicyMapTable.$inferSelect;
export type InsertSlaSignalPolicyMap = typeof slaSignalPolicyMapTable.$inferInsert;

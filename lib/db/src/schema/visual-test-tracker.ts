import { pgTable, serial, text, timestamp, integer, boolean, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// #4277 — reverse-engineered from the live `shanemccawmsp` database's
// `information_schema` (these tables had no pgTable definition anywhere in
// lib/db/src/schema/). Column types, defaults, constraints and FKs below match
// live reality, not the assumed shape.

export const visualTestTrackerPagesTable = pgTable("visual_test_tracker_pages", {
  id: serial("id").primaryKey(),
  baseUrl: text("base_url").notNull(),
  pagePath: text("page_path").notNull(),
  isGood: boolean("is_good").notNull().default(false),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("visual_test_tracker_pages_base_url_page_path_key").on(t.baseUrl, t.pagePath),
]);

export type VisualTestTrackerPage = typeof visualTestTrackerPagesTable.$inferSelect;
export type InsertVisualTestTrackerPage = typeof visualTestTrackerPagesTable.$inferInsert;

export const VISUAL_TEST_TRACKER_STATUSES = ["Open", "Verifying", "Closed"] as const;
export type VisualTestTrackerStatus = (typeof VISUAL_TEST_TRACKER_STATUSES)[number];
export const VISUAL_TEST_TRACKER_RESOLUTIONS = ["Fixed", "NotABug"] as const;
export type VisualTestTrackerResolution = (typeof VISUAL_TEST_TRACKER_RESOLUTIONS)[number];

export const visualTestTrackerEntriesTable = pgTable("visual_test_tracker_entries", {
  id: serial("id").primaryKey(),
  entryUuid: text("entry_uuid").notNull().unique(),
  pageId: integer("page_id").references(() => visualTestTrackerPagesTable.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull().default(""),
  pagePath: text("page_path").notNull().default(""),
  title: text("title").notNull().default(""),
  notes: text("notes").notNull().default(""),
  stepsToReproduce: text("steps_to_reproduce").notNull().default(""),
  expectedBehavior: text("expected_behavior").notNull().default(""),
  actualBehavior: text("actual_behavior").notNull().default(""),
  severity: text("severity").notNull().default("Bug"),
  status: text("status", { enum: VISUAL_TEST_TRACKER_STATUSES }).notNull().default("Open"),
  tags: text("tags").array().notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  telemetry: jsonb("telemetry").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  bugNumber: integer("bug_number").unique(),
  gitIssueNumber: integer("git_issue_number"),
  siteName: text("site_name").notNull().default(""),
  epicName: text("epic_name").notNull().default(""),
  closingBuildId: text("closing_build_id"),
  resolution: text("resolution", { enum: VISUAL_TEST_TRACKER_RESOLUTIONS }),
  resolutionReason: text("resolution_reason"),
  selector: text("selector"),
  isDesign: boolean("is_design").notNull().default(false),
}, (t) => [
  index("idx_visual_test_tracker_entries_git_issue").on(t.gitIssueNumber),
  index("idx_visual_test_tracker_entries_page_id").on(t.pageId, t.createdAt),
  index("idx_visual_test_tracker_entries_site_epic").on(t.siteName, t.epicName, t.bugNumber),
  check("chk_vtt_resolution", sql`${t.resolution} IS NULL OR (${t.resolution} = ANY (ARRAY['Fixed'::text, 'NotABug'::text]))`),
  check("chk_vtt_resolution_reason", sql`${t.resolution} IS DISTINCT FROM 'NotABug'::text OR ${t.resolutionReason} IS NOT NULL`),
  check("chk_vtt_status", sql`${t.status} = ANY (ARRAY['Open'::text, 'Verifying'::text, 'Closed'::text])`),
]);

export type VisualTestTrackerEntry = typeof visualTestTrackerEntriesTable.$inferSelect;
export type InsertVisualTestTrackerEntry = typeof visualTestTrackerEntriesTable.$inferInsert;

export const visualTestTrackerDomMutationsTable = pgTable("visual_test_tracker_dom_mutations", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").references(() => visualTestTrackerPagesTable.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull().default(""),
  pagePath: text("page_path").notNull().default(""),
  baselineMutations: jsonb("baseline_mutations").notNull().default([]),
  domSnapshot: jsonb("dom_snapshot").notNull().default({}),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("visual_test_tracker_dom_mutations_base_url_page_path_key").on(t.baseUrl, t.pagePath),
]);

export type VisualTestTrackerDomMutation = typeof visualTestTrackerDomMutationsTable.$inferSelect;
export type InsertVisualTestTrackerDomMutation = typeof visualTestTrackerDomMutationsTable.$inferInsert;

export const VISUAL_TEST_TRACKER_CAPTURE_TYPES = ["full", "region"] as const;
export type VisualTestTrackerCaptureType = (typeof VISUAL_TEST_TRACKER_CAPTURE_TYPES)[number];

export const visualTestTrackerScreenshotsTable = pgTable("visual_test_tracker_screenshots", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").notNull().references(() => visualTestTrackerPagesTable.id, { onDelete: "cascade" }),
  captureType: text("capture_type", { enum: VISUAL_TEST_TRACKER_CAPTURE_TYPES }).notNull(),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  entryId: integer("entry_id").references(() => visualTestTrackerEntriesTable.id, { onDelete: "set null" }),
}, (t) => [
  index("idx_visual_test_tracker_screenshots_page_id").on(t.pageId, t.createdAt),
]);

export type VisualTestTrackerScreenshot = typeof visualTestTrackerScreenshotsTable.$inferSelect;
export type InsertVisualTestTrackerScreenshot = typeof visualTestTrackerScreenshotsTable.$inferInsert;

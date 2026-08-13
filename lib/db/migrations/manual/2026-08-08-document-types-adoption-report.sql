-- Document type for the seventh live-rendered pillar report: the Copilot
-- Adoption & Usage Report.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force).
--
-- ── WHY THIS ROW DOES NOT ALREADY EXIST ──────────────────────────────────────
-- `2026-07-20-document-types.sql` seeds six report types and
-- `2026-08-06-document-types-live-reports-292.sql` adds two more
-- (compliance_alignment_report at sort_order 70, operational_health_report at
-- 80). None of them is an adoption report: the catalogue has never had one.
-- `2026-08-06-document-generation-ai-prompts.sql` already anticipated this — its
-- ROW 8 seeds an `insights-report-adoption_report` prompt and carries an
-- explicit note that the row will never be read until a `document_types` row
-- exists with key 'adoption_report' AND category 'report'. This migration is
-- that row.
--
-- ── NOTHING BREAKS IF THIS IS NOT RUN ────────────────────────────────────────
-- `liveDocumentFor` (msp-portal's journeyTokens.ts) matches a document on its
-- `docType` OR on the design's exact title, so the report resolves and renders
-- today from the title "Copilot Adoption & Workflow Readiness Report" alone.
-- What the seeded key buys is durability: `associated_documents[].title` is
-- admin-editable free text, so a rename would silently stop the title match
-- working, and the docType is what keeps it resolving afterwards. Same
-- reasoning as `buildGeneration` joining its expected set to its rows on
-- docType and not title.
--
-- ── CATEGORY, LABEL AND SORT ORDER ───────────────────────────────────────────
-- 'report', matching the other seven pillar/readiness deliverables. sort_order
-- 90 continues the report block (executive_summary 10 ... compliance_alignment_
-- report 70, operational_health_report 80) without renumbering anything already
-- seeded.
--
-- The LABEL is the catalogue's own name for the deliverable and is deliberately
-- NOT the design's title. The design calls it "Copilot Adoption & Workflow
-- Readiness Report", and this platform measures no workflow at all — the one
-- `workflow:*` signal in the catalog is an example row seeded for the rule
-- builder, with confidence 0 and every impact 0. Promising "Workflow Readiness"
-- in the catalogue label would put a claim in the admin UI and in every document
-- set that the report itself refuses to make. The design's title still resolves,
-- because the registry accepts it as an exact-match second key.
--
-- section_hints is NULL, matching every other row of category='report': report
-- docs have no section hints because the report prompt fallback has a fixed
-- structure. It is doubly moot here — this document is rendered live in the
-- browser from the tenant's own scan data and its prose comes from its own
-- narrative route (`GET /api/portal/assessment/adoption-narrative`), so the
-- generic document-generation prompt path never runs for it at all. The row
-- exists to give the registry a stable key and the admin UI a label.

INSERT INTO "document_types" ("key", "label", "category", "section_hints", "requires_sow_html", "sort_order")
VALUES
  ('adoption_report', 'Copilot Adoption & Usage Report', 'report', NULL, false, 90)
ON CONFLICT ("key") DO NOTHING;

-- Backfill ai_prompt_id against the already-seeded `insights-report-adoption_report`
-- row, if one exists. No-op (leaves ai_prompt_id NULL) otherwise — the admin
-- UI's "Edit Prompt" action falls back gracefully, and this document's real
-- prose prompts are the three `assessment-adoption-*` keys in
-- artifacts/api-server/src/lib/adoption-prompts.ts, not the generic
-- insights-report-<key> one.
UPDATE "document_types" dt
SET "ai_prompt_id" = ap."id"
FROM "ai_prompts" ap
WHERE dt."ai_prompt_id" IS NULL
  AND dt."key" = 'adoption_report'
  AND ap."key" = 'insights-report-' || dt."key";

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-document-types-adoption-report.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- Document types for the two live-rendered pillar reports the catalogue has no
-- key for (#292).
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force).
--
-- ── WHY ONLY TWO ROWS FOR FOUR REPORTS ───────────────────────────────────────
-- #292 ports four documents onto the live-rendered pattern #409 established and
-- #343 generalised (`JOURNEY_LIVE_DOCUMENTS` in msp-portal's journeyTokens.ts).
-- Each registry entry names a `document_types.key`, and two of the four already
-- have one from 2026-07-20-document-types.sql:
--
--   Microsoft 365 Governance Posture Report      -> governance_maturity_report
--                                                   (label "Governance Maturity
--                                                    Report", sort_order 40)
--   Copilot Licensing Alignment Report           -> license_optimization_report
--                                                   (label "License Optimization
--                                                    Report", sort_order 60)
--
-- Those are the same deliverable under the catalogue's own names, so they are
-- reused rather than duplicated — exactly as #343 reused `security_posture_report`
-- rather than minting a second key beside it.
--
-- The catalogue has NO compliance and NO operational-health report type. This
-- migration adds them.
--
-- ── NOTHING BREAKS IF THIS IS NOT RUN ────────────────────────────────────────
-- `liveDocumentFor` matches a document on its `docType` OR on the design's exact
-- title, so both reports resolve and render today from the title alone. What the
-- seeded key buys is durability: `associated_documents[].title` is admin-editable
-- free text, so a rename would silently stop the title match working, and the
-- docType is what keeps it resolving afterwards. Same reasoning as
-- `buildGeneration` joining its expected set to its rows on docType and not title.
--
-- ── CATEGORY AND SORT ORDER ──────────────────────────────────────────────────
-- 'report', matching the other five pillar/readiness deliverables. Sort orders
-- 70 and 80 continue the report block (executive_summary 10 ... license_
-- optimization_report 60) without renumbering anything already seeded.
--
-- section_hints is NULL for both, matching every other row of category='report':
-- report docs have no section hints because the report prompt fallback has a
-- fixed structure. It is doubly moot here — these two documents are rendered
-- live in the browser from the tenant's own scan data and their prose comes from
-- their own narrative routes, so the generic document-generation prompt path
-- never runs for them at all. The rows exist to give the registry a stable key
-- and the admin UI a label.

INSERT INTO "document_types" ("key", "label", "category", "section_hints", "requires_sow_html", "sort_order")
VALUES
  ('compliance_alignment_report', 'Compliance & Regulatory Alignment Report', 'report', NULL, false, 70),
  ('operational_health_report',   'Operational Health & Service Integrity Report', 'report', NULL, false, 80)
ON CONFLICT ("key") DO NOTHING;

-- Backfill ai_prompt_id against an already-seeded ai_prompts row, if one exists.
-- No-op (leaves ai_prompt_id NULL) otherwise — the admin UI's "Edit Prompt"
-- action falls back gracefully, and these two documents' real prose prompts are
-- the six `assessment-compliance-alignment-*` / `assessment-operational-health-*`
-- keys seeded by prompt-loader.ts, not the generic insights-report-<key> one.
UPDATE "document_types" dt
SET "ai_prompt_id" = ap."id"
FROM "ai_prompts" ap
WHERE dt."ai_prompt_id" IS NULL
  AND dt."key" IN ('compliance_alignment_report', 'operational_health_report')
  AND ap."key" = 'insights-report-' || dt."key";

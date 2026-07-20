-- Database-Driven Document Types — registry backing Insights document
-- generation (artifacts/api-server/src/lib/document-generator.ts and
-- artifacts/api-server/src/routes/admin-insights.ts). Replaces the
-- hardcoded REPORT_DOC_TYPE_LABELS / CONSULTING_TYPE_LABELS /
-- CONSULTING_SECTION_HINTS object literals that previously lived duplicated
-- in both files. Adding a new document type is now an admin CRUD action
-- (POST /api/admin/document-types) instead of a code change + deploy.
--
-- This does NOT touch the ai_prompts/ai_prompt_versions system — the AI
-- prompt CONTENT for each type was already DB-driven and admin-editable via
-- getPrompt() with keys "insights-report-<key>" / "insights-consulting-<key>".
-- This table is the TYPE REGISTRY (key, label, category, section hints)
-- only. document_types.ai_prompt_id is a soft pointer to the matching
-- ai_prompts row so the admin UI can deep-link "Edit Prompt" straight to it.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

CREATE TABLE IF NOT EXISTS "document_types" (
  "id" serial PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "category" text NOT NULL CHECK ("category" IN ('report', 'consulting')),
  "section_hints" text,
  "requires_sow_html" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "ai_prompt_id" integer REFERENCES "ai_prompts"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ── Seed: the 6 report types, verbatim from document-generator.ts's
-- REPORT_DOC_TYPE_LABELS (report docs have no section hints — the report
-- prompt fallback has a fixed structure, unlike consulting deliverables).
INSERT INTO "document_types" ("key", "label", "category", "section_hints", "requires_sow_html", "sort_order")
VALUES
  ('executive_summary',           'Executive Summary',            'report', NULL, false, 10),
  ('full_readiness_report',       'Full Readiness Report',        'report', NULL, false, 20),
  ('security_posture_report',     'Security Posture Report',      'report', NULL, false, 30),
  ('governance_maturity_report',  'Governance Maturity Report',   'report', NULL, false, 40),
  ('data_exposure_risk_report',   'Data Exposure Risk Report',    'report', NULL, false, 50),
  ('license_optimization_report', 'License Optimization Report',  'report', NULL, false, 60)
ON CONFLICT ("key") DO NOTHING;

-- ── Seed: the 8 consulting types, verbatim from document-generator.ts's
-- CONSULTING_TYPE_LABELS / CONSULTING_SECTION_HINTS. task_execution_guide is
-- the only type with requires_sow_html = true (its prompt is built from a
-- real SOW document's HTML rather than the standard findings/scores block).
INSERT INTO "document_types" ("key", "label", "category", "section_hints", "requires_sow_html", "sort_order")
VALUES
  ('sow', 'Statement of Work', 'consulting',
    $hint$Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (see Tier 02 formula below), Acceptance Criteria (each criterion on its own line as <div style='margin:6px 0'>&#9744; criterion</div>), Terms & Conditions$hint$,
    false, 100),
  ('task_execution_guide', 'SOW Task Execution Guide', 'consulting',
    $hint$Use the project task list below as your source. For EACH task produce: Task name (h3), Purpose (one sentence), Prerequisites, Step-by-step instructions (numbered, technically specific for Microsoft 365), Expected outcome, Validation check, Common pitfalls. Group tasks by their workflow phase/group. Add an intro section and a completion checklist at the end.$hint$,
    true, 110),
  ('remediation_plan', 'Remediation Plan', 'consulting',
    $hint$Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation$hint$,
    false, 120),
  ('deployment_plan', 'Deployment Plan', 'consulting',
    $hint$Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support$hint$,
    false, 130),
  ('governance_framework', 'Governance Framework', 'consulting',
    $hint$Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process$hint$,
    false, 140),
  ('security_hardening_plan', 'Security Hardening Plan', 'consulting',
    $hint$Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response$hint$,
    false, 150),
  ('copilot_enablement_plan', 'Copilot Enablement Plan', 'consulting',
    $hint$Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy$hint$,
    false, 160),
  ('identity_modernization_plan', 'Identity Modernization Plan', 'consulting',
    $hint$Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission$hint$,
    false, 170)
ON CONFLICT ("key") DO NOTHING;

-- ── Seed: copilot_readiness — NOT one of the "exact 14" from
-- document-generator.ts, but a 9th consulting type that already lives (and
-- is actively served by) admin-insights.ts's own CONSULTING_TYPE_LABELS /
-- sectionHintsConsulting objects (used by the live
-- POST /admin/insights/consulting/payload-preview endpoint). Since this
-- migration's companion code change deletes those hardcoded objects
-- entirely, copilot_readiness is seeded here too so that endpoint does not
-- regress to a raw-key label / generic section hint. Verbatim text from
-- admin-insights.ts.
INSERT INTO "document_types" ("key", "label", "category", "section_hints", "requires_sow_html", "sort_order")
VALUES
  ('copilot_readiness', 'Copilot Readiness Assessment', 'consulting',
    $hint$Include: Executive Readiness Summary, Identity & MFA Posture, Licensing & Entitlement Gaps, Data Governance Readiness (sensitivity labels, DLP, sharing policies), Security Score vs Copilot Minimum Bar, Blockers & Remediation Recommendations, Overall Readiness Rating (Red / Amber / Green)$hint$,
    false, 180)
ON CONFLICT ("key") DO NOTHING;

-- ── Backfill ai_prompt_id for the seeded rows against the already-existing,
-- already-seeded ai_prompts rows (insights-report-<key> / insights-consulting-<key>).
-- No-op (leaves ai_prompt_id NULL) for any key whose ai_prompts row hasn't been
-- seeded yet — the admin UI's "Edit Prompt" action falls back gracefully.
UPDATE "document_types" dt
SET "ai_prompt_id" = ap."id"
FROM "ai_prompts" ap
WHERE dt."ai_prompt_id" IS NULL
  AND ap."key" = CASE dt."category"
    WHEN 'report'     THEN 'insights-report-' || dt."key"
    WHEN 'consulting' THEN 'insights-consulting-' || dt."key"
  END;

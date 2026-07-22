-- 2026-07-22 — Empty-data honesty instructions for AI document-generation prompts
--
-- Part of "Graded Document-Generation Gate + Real Empty-Data Audit to Prevent AI
-- Hallucination". The code-side data blocks (document-generator.ts /
-- consolidated-sow-generator.ts) are the always-in-effect anti-fabrication
-- guardrail and take effect on deploy with no SQL. This script is the OPTIONAL,
-- edit-preserving companion that also lands the tunable per-prompt instruction in
-- the DB-editable ai_prompts rows for environments whose rows were already seeded
-- (seedAiPrompts() uses INSERT ... ON CONFLICT DO NOTHING, so it never updates an
-- existing row). Fresh installs get this text from the seeds automatically.
--
-- SAFE + IDEMPOTENT: appends only; never replaces Shane's own prompt edits; the
-- `NOT LIKE '%EMPTY-DATA HONESTY%'` guard makes re-running a no-op.
--
-- Run manually via the SQL console (no drizzle-kit push — per CLAUDE.md).

BEGIN;

-- Every scan-derived AI document prompt that consumes findings / scores /
-- telemetry. Reports + consulting deliverables + both SOW families.
UPDATE ai_prompts
SET prompt_body = prompt_body ||
  E'\n- EMPTY-DATA HONESTY — NEVER FABRICATE: If any data block above states that data is absent (e.g. "No findings were recorded", "No M365 health score data", "No configuration telemetry", "None recorded for this client"), you MUST NOT invent, estimate, or infer values to fill it. Omit that section, or state plainly and positively that it is not yet available. A shorter, honest document is always correct over a padded one. This overrides any instruction above to include a findings/scores table or to "reference actual findings".',
    updated_at = now()
WHERE key IN (
  'insights-report-executive_summary',
  'insights-report-full_readiness_report',
  'insights-report-security_posture_report',
  'insights-report-governance_maturity_report',
  'insights-report-data_exposure_risk_report',
  'insights-report-license_optimization_report',
  'insights-consulting-consolidated_sow',
  'insights-consulting-sow',
  'insights-consulting-remediation_plan',
  'insights-consulting-deployment_plan',
  'insights-consulting-governance_framework',
  'insights-consulting-security_hardening_plan',
  'insights-consulting-copilot_enablement_plan',
  'insights-consulting-identity_modernization_plan'
)
AND prompt_body NOT LIKE '%EMPTY-DATA HONESTY%';

-- Keep default_body (the "reset to default" baseline) in sync so a later reset
-- does not silently drop the guardrail. Same guard, same append.
UPDATE ai_prompts
SET default_body = default_body ||
  E'\n- EMPTY-DATA HONESTY — NEVER FABRICATE: If any data block above states that data is absent (e.g. "No findings were recorded", "No M365 health score data", "No configuration telemetry", "None recorded for this client"), you MUST NOT invent, estimate, or infer values to fill it. Omit that section, or state plainly and positively that it is not yet available. A shorter, honest document is always correct over a padded one. This overrides any instruction above to include a findings/scores table or to "reference actual findings".',
    updated_at = now()
WHERE key IN (
  'insights-report-executive_summary',
  'insights-report-full_readiness_report',
  'insights-report-security_posture_report',
  'insights-report-governance_maturity_report',
  'insights-report-data_exposure_risk_report',
  'insights-report-license_optimization_report',
  'insights-consulting-consolidated_sow',
  'insights-consulting-sow',
  'insights-consulting-remediation_plan',
  'insights-consulting-deployment_plan',
  'insights-consulting-governance_framework',
  'insights-consulting-security_hardening_plan',
  'insights-consulting-copilot_enablement_plan',
  'insights-consulting-identity_modernization_plan'
)
AND default_body IS NOT NULL
AND default_body NOT LIKE '%EMPTY-DATA HONESTY%';

COMMIT;

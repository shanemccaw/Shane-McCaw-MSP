-- Fix inverted "No Copilot license" security-risk logic (#1112, part of epic #1045).
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- The monitor_checks row for key='copilot:readiness-prerequisite' (id 97)
-- assigned severity "critical" to the condition copilotSkuCount == 0 ("no
-- Copilot license found in this tenant"). TopSecurityRisks.tsx renders the
-- top 5 msp_diagnostic_findings by severity rank across ALL check engines
-- (no security-category filter), so this critical-severity finding was
-- surfacing under "Top Security Risks" even though the check's own
-- `engines` tag is ["copilot"], not security.
--
-- The underlying logic was backwards: a tenant simply not having purchased
-- Copilot licenses is not a security exposure — if anything it REDUCES
-- exposure (no Copilot grounding surface at all). This is a Copilot
-- rollout-eligibility/adoption signal, not a risk, so it should never have
-- ranked as a top-severity finding. Downgrading to "info" keeps the
-- readiness-prerequisite fact visible (still useful for sales/adoption
-- conversations) without it displacing real security findings.
--
-- 1) Correct the check definition so future diagnostics runs stop minting
--    critical-severity findings for this condition.
UPDATE monitor_checks
SET severity_rules = '[{"label": "No Microsoft 365 Copilot license found in this tenant", "severity": "info", "expression": "copilotSkuCount == 0"}]'::jsonb,
    updated_at = now()
WHERE key = 'copilot:readiness-prerequisite';

-- 2) Backfill already-recorded findings from prior runs so they stop
--    showing as critical in the live feed before the next scan re-derives
--    them.
UPDATE msp_diagnostic_findings
SET severity = 'info'
WHERE check_key = 'copilot:readiness-prerequisite'
  AND severity = 'critical';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-copilot-readiness-severity-fix-1112.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- #1553 — Policy Engine: policy non-compliance as a finding source.
--
-- Additive and reversible. Adds provenance to msp_diagnostic_findings so a
-- policy-sourced finding can be told apart from every other finding in the
-- platform (which derives from a check against a Microsoft-defined or
-- best-practice baseline). Nothing existing is altered: every pre-existing
-- row defaults to finding_source = 'baseline', which is exactly what it is.
--
-- standing_policy_id is nullable and only ever set on a 'policy' row — there
-- is no policy behind a baseline finding.

BEGIN;

ALTER TABLE msp_diagnostic_findings
  ADD COLUMN IF NOT EXISTS finding_source text NOT NULL DEFAULT 'baseline';

ALTER TABLE msp_diagnostic_findings
  ADD COLUMN IF NOT EXISTS standing_policy_id integer
    REFERENCES standing_policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_diagnostic_findings_standing_policy_id_idx
  ON msp_diagnostic_findings (standing_policy_id);

COMMENT ON COLUMN msp_diagnostic_findings.finding_source IS
  '#1553: baseline (Microsoft-defined/best-practice check, the default — every '
  'pre-existing row) | policy (raised from standing-policy non-compliance, no '
  'Microsoft baseline behind it, only the customer''s own stated policy).';
COMMENT ON COLUMN msp_diagnostic_findings.standing_policy_id IS
  '#1553: the standing_policies row this finding was raised from, when '
  'finding_source = ''policy''. Null for every baseline finding.';

-- Verify the columns landed.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_diagnostic_findings'
   AND column_name IN ('finding_source', 'standing_policy_id')
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-policy-compliance-findings-1553.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

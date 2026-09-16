-- 2026-09-15-free-scan-sow-phase-attributes-1374.sql
--
-- Git #1374 (Phase of Feature #1352, Free Scan).
--
-- The Free Scan SOW's Phase Breakdown prints, per phase, the artifacts that
-- phase hands over and whether it needs a change window booked. Both are
-- product definition — fixed structure, identical for every tenant — so they
-- belong in the Products Catalog beside the phase's own name, description,
-- fixed fee and duration, NOT hardcoded in the page that renders them
-- (CLAUDE.md's no-hardcoding rule) and not in the API-server code that reads
-- them.
--
-- Additive: merges two new keys into `type_attributes` on the six existing
-- `category = 'project'` phase rows. Nothing is dropped, no existing key is
-- overwritten except these two, and re-running is a no-op.
--
-- The change-window flags are the real operational fact the phase carries:
-- Identity & Access Hardening retires legacy authentication and enforces
-- device compliance (both need a booked window and user notice); Drift
-- Baseline & Handover freezes configuration to capture the signed baseline.
-- The four middle phases apply policy in report-only/review mode first and
-- need no window.

BEGIN;

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Conditional Access policy set',
    'MFA registration evidence pack',
    'Guest and standing-admin removal log'
  ),
  'requiresChangeWindow', true
) WHERE slug = 'identity-access-hardening';

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Sharing revocation report',
    'Site lifecycle policy',
    'Site owner attestations'
  ),
  'requiresChangeWindow', false
) WHERE slug = 'sharing-exposure-remediation';

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Sensitivity label taxonomy',
    'DLP policy set',
    'Auto-labelling rules'
  ),
  'requiresChangeWindow', false
) WHERE slug = 'data-protection-baseline';

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Seat reclaim report',
    'Licence uplift model',
    'Renewal calendar'
  ),
  'requiresChangeWindow', false
) WHERE slug = 'licence-rationalisation';

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Enablement plan',
    'Pilot cohort results',
    'Prompt library'
  ),
  'requiresChangeWindow', false
) WHERE slug = 'adoption-enablement';

UPDATE services SET type_attributes = type_attributes || jsonb_build_object(
  'deliverables', jsonb_build_array(
    'Signed configuration baseline',
    'Change-review runbook',
    'Handover pack'
  ),
  'requiresChangeWindow', true
) WHERE slug = 'drift-baseline-handover';

-- Self-marking run record, per CLAUDE.md's manual-migration rule.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-free-scan-sow-phase-attributes-1374.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

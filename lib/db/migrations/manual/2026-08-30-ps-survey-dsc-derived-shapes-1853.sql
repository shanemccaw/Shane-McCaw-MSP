-- 2026-08-30-ps-survey-dsc-derived-shapes-1853.sql
--
-- Git #1853 — 130 of 337 working cmdlets from #1793's survey returned `ok` with
-- `item_count = 0`, so no output shape was observed (the testbed simply has no
-- instances of that resource). Shane's recorded decision (option 2): take the
-- property set for those 130 from Microsoft365DSC's own resource definitions,
-- labelled as DERIVED, never presented as live evidence, and never overwriting an
-- observed shape.
--
-- Additive only: five new nullable columns on the existing ps_capability_survey_results
-- table. property_names itself is untouched by this migration and by every script
-- that writes these new columns — derive-ps-shapes-from-dsc.mjs only ever writes
-- WHERE property_names IS NULL.
--
-- Matching Drizzle definition: lib/db/src/schema/msp.ts (psCapabilitySurveyResultsTable).

BEGIN;

ALTER TABLE ps_capability_survey_results
  ADD COLUMN IF NOT EXISTS derived_property_names JSONB,
  ADD COLUMN IF NOT EXISTS derived_from_m365dsc_resources JSONB,
  ADD COLUMN IF NOT EXISTS shape_derivation TEXT,
  ADD COLUMN IF NOT EXISTS derivation_gap_reason TEXT,
  ADD COLUMN IF NOT EXISTS shape_derived_at TIMESTAMPTZ;

COMMENT ON COLUMN ps_capability_survey_results.derived_property_names IS
  'Git #1853: property set derived from Microsoft365DSC for an ok cmdlet whose property_names is null. Never live evidence.';
COMMENT ON COLUMN ps_capability_survey_results.derived_from_m365dsc_resources IS
  'Git #1853: config_resources.resource_key(s) the derived property set came from.';
COMMENT ON COLUMN ps_capability_survey_results.shape_derivation IS
  'Git #1853: derived_from_dsc when derived_property_names is set; NULL otherwise.';
COMMENT ON COLUMN ps_capability_survey_results.derivation_gap_reason IS
  'Git #1853: why no DSC-derived shape exists either, for an ok cmdlet with no observed shape.';

-- Self-marking run record so Simulator Studio's Migrations tree (#497) reflects DB
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-ps-survey-dsc-derived-shapes-1853.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

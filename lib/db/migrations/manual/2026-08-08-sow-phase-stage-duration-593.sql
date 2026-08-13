-- Git #593 — SOW Gantt chart: stage + duration_weeks for the 6 real phase
-- services, stage='continuous' for the White-Glove Copilot Adoption tiers
-- and the Tenant Monitoring tier rows.
--
-- Per Shane's 2026-08-08 planning comment on #593: fixed week-estimates set
-- manually per phase (same pattern as pricing), and a 4-stage dependency
-- model keyed on phase TYPE, not position number, since which phases appear
-- varies by tenant:
--   Foundation        -- always first
--   Parallel-eligible -- any order/overlap among themselves
--   Closeout          -- always last
--   Continuous        -- runs throughout the engagement, no bounded duration
--
-- WHERE THE DATA LIVES: `services.type_attributes` (jsonb), not new real
-- columns. Confirmed against the schema's own convention comment
-- (lib/db/src/schema/index.ts:545-548 — "All product-type-specific fields...
-- live here") and the two closest precedents already on these same rows:
-- White-Glove's `{seatMin,seatMax,tierLabel}` (#589) and Tenant Monitoring's
-- `{tenantTierLabel,seatMin,seatMax,pricePerUserMonth}` (pre-#589). `stage`
-- and `durationWeeks` are the same class of type-specific, non-pricing
-- metadata, so they join the same object rather than becoming new columns.
-- (`duration_days`/`turnaround`, added by #586, are left untouched — those
-- are the marketing-catalog duration fields; `durationWeeks` here is the
-- Gantt's own dedicated source, deliberately not re-derived from either.)
--
-- Every UPDATE below is a non-destructive jsonb merge (`||`), so re-running
-- this file is idempotent and cannot drop `seatMin`/`seatMax`/`tierLabel`/
-- `tenantTierLabel`/`pricePerUserMonth` already on these rows.
--
-- Part 1 targets the 6 slugs #586 inserted
-- (2026-08-08-project-catalog-copilot-phases-586.sql:94-145). Part 2 targets
-- the 4 White-Glove slugs #589 inserted
-- (2026-08-08-white-glove-copilot-adoption-tiered-service-589.sql:99-165).
-- Part 3 targets Tenant Monitoring by `service_type = 'monitoring_tier'`
-- (the same selector `sow-monitoring-addon.ts`'s `resolveTenantMonitoringAddon`
-- already queries by — no migration file inserted those 12 rows under a
-- tracked name, so a literal slug list can't be written here; this selector
-- is the real, already-relied-upon identifier for the whole set).
--
-- Verify the real prior state with a live SELECT before trusting any
-- assumption here, same discipline as every other manual migration in this
-- directory.

BEGIN;

-- ─── Part 1: the 6 real phase services — stage + durationWeeks ─────────────

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"foundation","durationWeeks":2}'::jsonb
WHERE slug = 'identity-access-hardening';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"parallel-eligible","durationWeeks":3}'::jsonb
WHERE slug = 'sharing-exposure-remediation';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"parallel-eligible","durationWeeks":3}'::jsonb
WHERE slug = 'data-protection-baseline';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"parallel-eligible","durationWeeks":1}'::jsonb
WHERE slug = 'licence-rationalisation';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"parallel-eligible","durationWeeks":2}'::jsonb
WHERE slug = 'adoption-enablement';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"closeout","durationWeeks":1}'::jsonb
WHERE slug = 'drift-baseline-handover';

-- ─── Part 2: White-Glove Copilot Adoption (all 4 seat-band tiers) ──────────
-- Continuous — no durationWeeks value, per Shane's explicit instruction.

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"continuous"}'::jsonb
WHERE slug IN (
  'white-glove-copilot-adoption-micro',
  'white-glove-copilot-adoption-smb',
  'white-glove-copilot-adoption-mid-market',
  'white-glove-copilot-adoption-enterprise'
);

-- ─── Part 3: Tenant Monitoring (all quality-tier x seat-band rows) ─────────
-- Continuous — same as White-Glove, per Shane's follow-up comment on #593.

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"stage":"continuous"}'::jsonb
WHERE service_type = 'monitoring_tier';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-sow-phase-stage-duration-593.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ─── Verification (run after COMMIT) ───────────────────────────────────────
-- Expect 6 rows (Part 1), 4 rows (Part 2), 12 rows (Part 3, Shane confirmed
-- 3 quality tiers x 4 seat bands). Any count that disagrees means the real
-- slug/service_type set has drifted from what this migration assumed.

-- SELECT slug, type_attributes->>'stage' AS stage, type_attributes->>'durationWeeks' AS duration_weeks
-- FROM services
-- WHERE slug IN (
--   'identity-access-hardening','sharing-exposure-remediation','data-protection-baseline',
--   'licence-rationalisation','adoption-enablement','drift-baseline-handover'
-- )
-- ORDER BY sort_order;

-- SELECT slug, type_attributes->>'stage' AS stage
-- FROM services
-- WHERE slug LIKE 'white-glove-copilot-adoption-%'
-- ORDER BY slug;

-- SELECT count(*), type_attributes->>'stage' AS stage
-- FROM services
-- WHERE service_type = 'monitoring_tier'
-- GROUP BY type_attributes->>'stage';

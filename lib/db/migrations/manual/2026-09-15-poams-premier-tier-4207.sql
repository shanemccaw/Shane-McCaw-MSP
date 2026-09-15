-- #4207: bundle "poams" into the Premier monitoring_tier only.
--
-- Shane's decision (2026-09-15, #4207): poams bundles at Premier only — not
-- Foundation, not Growth. #3104 added the "poams" module key and the real
-- gate (evaluateAccess()/PORTAL_TIER_MODULE_KEYS.poams) but deliberately left
-- it unassigned in 2026-09-05-portal-tier-included-features-1168.sql pending
-- this product decision (see access.test.ts's pinned "poams is the one #3104
-- left unassigned" test, which this migration now un-pins).
--
-- Same additive jsonb `||` merge pattern as #1168's migration: existing
-- includedFeatures entries are preserved, not overwritten. Idempotent:
-- re-running only ever produces the same de-duplicated union. Foundation and
-- Growth rows are untouched.

UPDATE services
SET type_attributes = jsonb_set(
  COALESCE(type_attributes, '{}'::jsonb),
  '{includedFeatures}',
  (
    SELECT jsonb_agg(DISTINCT feature)
    FROM jsonb_array_elements_text(
      COALESCE(type_attributes->'includedFeatures', '[]'::jsonb)
      || '["poams"]'::jsonb
    ) AS feature
  )
)
WHERE service_type = 'monitoring_tier' AND tier = 'premier';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-poams-premier-tier-4207.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

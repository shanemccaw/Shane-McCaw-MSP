-- Git #1317 (Phase 8 of Epic #1309) — catalog data fix flagged by #1311's
-- Phase-8 note: `architect-advisory-retainer` is sold through /buy (Buy.tsx's
-- "Advisory" retainer tier) but carries a NULL service_type, so the
-- fail-closed read-consent mapping (lib/read-consent-flow.ts: only
-- serviceType 'retainer' is optional) treats it consent-REQUIRED — which
-- breaks the lawful "Skip — buy without a scan" branch and the payment gate
-- for the default retainer tier. The other five retainer rows already carry
-- service_type = 'retainer'; this aligns the one holdout.
--
-- Data-only UPDATE, no DDL. Reversible with:
--   UPDATE services SET service_type = NULL WHERE slug = 'architect-advisory-retainer';

BEGIN;

UPDATE services
SET service_type = 'retainer'
WHERE slug = 'architect-advisory-retainer'
  AND category = 'retainer'
  AND service_type IS NULL;

-- Self-mark this migration as run (Git #497) so Simulator Studio's Migrations
-- tree reflects DB reality regardless of which console ran the file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-advisory-retainer-service-type-1317.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

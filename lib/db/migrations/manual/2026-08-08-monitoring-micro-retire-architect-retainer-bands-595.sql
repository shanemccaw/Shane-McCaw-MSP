-- Git #595 — SOW Retainer addon: retire Monitoring's Micro tier, add real
-- seat bands to the 3 Architect Retainer services.
--
-- Per Shane's 2026-08-08 pinned scope comment: Monitoring drops its Micro
-- tier entirely (3 bands only: SMB/Mid-Market/Enterprise), and the 3
-- Architect retainer tiers map 1:1 onto those same 3 bands
-- (Essentials=SMB, Growth=Mid-Market, Enterprise=Enterprise).
--
-- Real cutoffs used below (SMB 26-100 / Mid-Market 101-500 / Enterprise
-- 501+) are the live-confirmed anchor values documented in
-- artifacts/api-server/src/lib/__tests__/catalog-pricing.test.ts's permanent
-- monitoring pricing matrix ("floors 15/26/101/500"), NOT re-derived or
-- guessed here.
--
-- Part 1 sets `visibility = 'private'` on the 3 Micro-tier Monitoring rows
-- (services has no is_active column — confirmed by reading the schema, same
-- finding #586 already made). This is a NO-OP on its own until
-- sow-monitoring-addon.ts's row query also filters `visibility = 'public'`
-- (fixed in the same commit as this migration) — see this file's own
-- verification query at the bottom.
--
-- Part 2 adds `seatMin`/`seatMax` to the 3 Architect retainer rows'
-- type_attributes via a non-destructive jsonb merge (`||`), so re-running
-- this file is idempotent and cannot drop any pre-existing `whiteLabel` (or
-- other) keys already on those rows.
--
-- Verify the real prior state with a live SELECT before trusting any
-- assumption here, same discipline as every other manual migration in this
-- directory.

BEGIN;

-- ─── Part 1: retire the 3 Micro-tier Monitoring rows ───────────────────────

UPDATE services
SET visibility = 'private'
WHERE slug IN (
  'monitoring-basic-micro',
  'monitoring-enhanced-micro',
  'monitoring-premium-micro'
);

-- ─── Part 2: real seat bands on the 3 Architect Retainer services ──────────

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"seatMin":26,"seatMax":100}'::jsonb
WHERE slug = 'architect-essentials-retainer';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"seatMin":101,"seatMax":500}'::jsonb
WHERE slug = 'architect-growth-retainer';

UPDATE services SET type_attributes = COALESCE(type_attributes, '{}'::jsonb)
  || '{"seatMin":501,"seatMax":null}'::jsonb
WHERE slug = 'architect-enterprise-retainer';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-monitoring-micro-retire-architect-retainer-bands-595.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ─── Verification (run after COMMIT) ───────────────────────────────────────

-- Expect all 3 rows visibility='private', and no other monitoring_tier rows
-- touched.
-- SELECT slug, visibility FROM services
-- WHERE slug IN ('monitoring-basic-micro','monitoring-enhanced-micro','monitoring-premium-micro');

-- Expect 9 remaining public monitoring_tier rows (3 quality tiers x 3 bands,
-- Micro removed from 12).
-- SELECT count(*) FROM services WHERE service_type = 'monitoring_tier' AND visibility = 'public';

-- Expect real seatMin/seatMax on all 3 Architect rows, matching Monitoring's
-- own SMB/Mid-Market/Enterprise cutoffs exactly.
-- SELECT slug, type_attributes->>'seatMin' AS seat_min, type_attributes->>'seatMax' AS seat_max
-- FROM services
-- WHERE slug IN ('architect-essentials-retainer','architect-growth-retainer','architect-enterprise-retainer')
-- ORDER BY slug;

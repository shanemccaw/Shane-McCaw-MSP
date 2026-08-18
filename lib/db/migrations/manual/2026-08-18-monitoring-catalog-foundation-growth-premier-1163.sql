-- 2026-08-18-monitoring-catalog-foundation-growth-premier-1163.sql
--
-- Git #1163 (part of #1045, follow-up to #1127) — Item 1: reconcile the stale
-- services monitoring catalog with the REAL Foundation/Growth/Premier packages
-- that #1134 built in monitoring_packages, replacing the thrown-together-for-
-- testing Basic/Enhanced/Premium tier names + wiring.
--
-- Decisions locked with Shane (see PLATFORM_BUILD.md #1163 row):
--   * Option A — reuse the EXACT current live per-seat prices; this migration
--     is a pure rename + package-repoint, it changes NO pricing whatsoever
--     (pricePerUserMonth / flatMonthlySurcharge / seat bands / seatCountFloor
--     are all left untouched).
--   * Tier mapping (3 real quality tiers -> 3 real packages built by #1134):
--       Basic    (core:security-baseline)   -> Foundation (core:foundation, 30 checks)
--       Enhanced (core:enhanced-monitoring)  -> Growth     (core:growth,    129 checks)
--       Premium  (core:enhanced-monitoring)  -> Premier    (core:premier,   133 checks)
--     Repointing Premium->core:premier resolves #1127 Q-B by construction:
--     Premium and Enhanced no longer share the single core:enhanced-monitoring
--     package — each tier now provisions its real, distinct check set.
--   * Premier keeps its +$160/mo flatMonthlySurcharge (unchanged).
--   * type_attributes.whiteLabel (wholesalePct) and minMspPlanTier are LEFT IN
--     PLACE, just unused — MSP resell is a next-version channel (Q-A), not
--     removed now.
--   * The Micro seat-band rows (ids 1/5/9, visibility='private' since #595)
--     stay hidden (Q-C) — they are renamed here only to stay internally
--     consistent, not un-hidden.
--
-- No schema change — this only UPDATEs data in the existing services rows.
-- Idempotent: re-running matches nothing on the WHERE (tiers already renamed),
-- and the trailing self-marking INSERT is an upsert.

BEGIN;

-- ── Foundation (was Basic) → core:foundation ────────────────────────────────
UPDATE services SET
  name        = replace(name, 'Basic Monitoring', 'Foundation Monitoring'),
  slug        = replace(slug, 'monitoring-basic-', 'monitoring-foundation-'),
  tier        = 'foundation',
  type_attributes = jsonb_set(type_attributes, '{packageKey}', '"core:foundation"'),
  description = 'Foundation monitoring — entry-tier, cross-pillar posture snapshot (30 checks). Priced per licensed user / month; the nested base of Growth and Premier.'
WHERE service_type = 'monitoring_tier' AND tier = 'basic';

-- ── Growth (was Enhanced) → core:growth ─────────────────────────────────────
UPDATE services SET
  name        = replace(name, 'Enhanced Monitoring', 'Growth Monitoring'),
  slug        = replace(slug, 'monitoring-enhanced-', 'monitoring-growth-'),
  tier        = 'growth',
  type_attributes = jsonb_set(type_attributes, '{packageKey}', '"core:growth"'),
  description = 'Growth monitoring — recurring managed-service tier, a superset of Foundation that runs daily (129 checks). Priced per licensed user / month.'
WHERE service_type = 'monitoring_tier' AND tier = 'enhanced';

-- ── Premier (was Premium) → core:premier ────────────────────────────────────
UPDATE services SET
  name        = replace(name, 'Premium Monitoring', 'Premier Monitoring'),
  slug        = replace(slug, 'monitoring-premium-', 'monitoring-premier-'),
  tier        = 'premier',
  type_attributes = jsonb_set(type_attributes, '{packageKey}', '"core:premier"'),
  description = 'Premier monitoring — compliance & evidence tier, a superset of Growth plus compliance-grade checks (133 checks). Priced per licensed user / month.'
WHERE service_type = 'monitoring_tier' AND tier = 'premium';

-- ── Self-marking run record (Simulator Studio Migrations tree, Git #497) ─────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-monitoring-catalog-foundation-growth-premier-1163.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- 0182_licensing_pillar_benchmark
--
-- Adds the licensing health pillar to the signal intelligence field set and
-- introduces the industry_benchmark_reference reference table used by the
-- customer-facing benchmarking widget.
--
-- Changes:
--   1. ALTER signal_derivation_rules / signal_rule_groups — add licensing_impact column (INT NOT NULL DEFAULT 0)
--   2. Seed licensingImpact values on the four canonical licensing signals (if rows exist)
--   3. CREATE industry_benchmark_reference — one row per pillar with published benchmark values
--   4. Seed seven pillar rows (governance, security, compliance, adoption, copilot, architecture, licensing)

-- ── 1. Add licensing_impact column ────────────────────────────────────────────
ALTER TABLE signal_derivation_rules ADD COLUMN IF NOT EXISTS licensing_impact INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signal_rule_groups ADD COLUMN IF NOT EXISTS licensing_impact INTEGER NOT NULL DEFAULT 0;

-- ── 2. Seed licensingImpact on the four licensing signals ─────────────────────
-- Values are in the same order-of-magnitude as existing architectureImpact/
-- securityImpact values. Safe to run repeatedly (idempotent UPDATE).

UPDATE signal_derivation_rules SET licensing_impact = 20 WHERE signal_key = 'licensing:sku-utilization';
UPDATE signal_derivation_rules SET licensing_impact = 25 WHERE signal_key = 'licensing:duplicate-assignments';
UPDATE signal_derivation_rules SET licensing_impact = 20 WHERE signal_key = 'licensing:inactive-user-licenses';
UPDATE signal_derivation_rules SET licensing_impact = 15 WHERE signal_key = 'cost:license-waste-estimate';

UPDATE signal_rule_groups SET licensing_impact = 20 WHERE signal_key = 'licensing:sku-utilization';
UPDATE signal_rule_groups SET licensing_impact = 25 WHERE signal_key = 'licensing:duplicate-assignments';
UPDATE signal_rule_groups SET licensing_impact = 20 WHERE signal_key = 'licensing:inactive-user-licenses';
UPDATE signal_rule_groups SET licensing_impact = 15 WHERE signal_key = 'cost:license-waste-estimate';

-- ── 3. Create industry_benchmark_reference ────────────────────────────────────
CREATE TABLE IF NOT EXISTS industry_benchmark_reference (
  pillar          TEXT PRIMARY KEY,
  industry_avg_pct INTEGER,
  ms_excellence_pct INTEGER,
  source          TEXT,
  as_of_date      DATE
);

-- ── 4. Seed benchmark reference rows ──────────────────────────────────────────
-- Only pillars with a published, citable source receive numeric benchmark values.
-- Security and Compliance have published Microsoft Secure Score baselines.
-- All other pillars are seeded with NULL percentages until an authoritative
-- citation is confirmed — the UI renders "Not enough data yet" for null rows.

INSERT INTO industry_benchmark_reference (pillar, industry_avg_pct, ms_excellence_pct, source, as_of_date)
VALUES
  ('governance',   NULL, NULL, NULL,                                                     NULL),
  ('security',     62,   90,   'Microsoft Secure Score public reporting',                '2024-01-01'),
  ('compliance',   54,   85,   'Microsoft Secure Score public reporting',                '2024-01-01'),
  ('adoption',     NULL, NULL, NULL,                                                     NULL),
  ('copilot',      NULL, NULL, NULL,                                                     NULL),
  ('architecture', NULL, NULL, NULL,                                                     NULL),
  ('licensing',    NULL, NULL, NULL,                                                     NULL)
ON CONFLICT (pillar) DO NOTHING;

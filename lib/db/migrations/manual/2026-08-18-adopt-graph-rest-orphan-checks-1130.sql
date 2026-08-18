-- #1130 Track A — adopt the 5 Graph-REST orphaned checks (#1129) into the
-- Foundation / Growth / Premier tiers created by
-- 2026-08-17-foundation-growth-premier-tiers-1134.sql.
--
-- Background: #1129 found 7 active checks assigned to NO package (so they never
-- run under any tier). #1134 built the 3 tiers but DELIBERATELY excluded all 7
-- orphans, deferring their adoption to #1130 (see that file's header + its
-- orphan(k) exclusion CTEs). Of the 7, exactly 5 are Graph-REST checks
-- (executor_type = 'graph', reachable with the app scopes the read app has +
-- #1130 Track A's new Organization.Read.All / Domain.Read.All):
--
--   cost:unused-unassigned-licenses     -> /subscribedSkus   (Foundation+)
--   cost:license-count-by-sku           -> /subscribedSkus   (Growth+)
--   cost:utilization-by-sku             -> /subscribedSkus   (Growth+)
--   onedrive:external-sharing-settings  -> /sites            (Growth+)
--   platform:tenant-password-expiration -> /domains          (Growth+)
--
-- The other 2 orphans (exchange:auto-forwarding-rules,
-- compliance:audit-log-retention) are PowerShell (Exchange/Purview admin), NOT
-- Graph REST, and are NOT adopted here — they need admin access Shane has so far
-- declined, a separate problem from #1130's Graph read elevation.
--
-- Tier placement follows the proposal (docs/monitoring-3-tier-package-proposal-1129.md
-- section 4) and #1134's own tier design. Tiers are strict supersets, so a
-- Foundation check is also inserted into Growth and Premier, and a Growth check
-- also into Premier.
--
-- sort_order is computed as (current max in that package) + a stable per-package
-- rank, so adopted checks append after each tier's existing members without
-- disturbing their order. Idempotent via ON CONFLICT (package_key, check_key)
-- DO NOTHING — safe to re-run. Depends on #1134's tier migration having run
-- first (the FK to monitoring_packages.key); all keys were verified present +
-- active in the live DB before this file was written.

WITH additions(package_key, check_key, ord) AS (
  VALUES
    ('core:foundation', 'cost:unused-unassigned-licenses',      1),

    ('core:growth',     'cost:unused-unassigned-licenses',      1),
    ('core:growth',     'cost:license-count-by-sku',            2),
    ('core:growth',     'cost:utilization-by-sku',              3),
    ('core:growth',     'onedrive:external-sharing-settings',   4),
    ('core:growth',     'platform:tenant-password-expiration',  5),

    ('core:premier',    'cost:unused-unassigned-licenses',      1),
    ('core:premier',    'cost:license-count-by-sku',            2),
    ('core:premier',    'cost:utilization-by-sku',              3),
    ('core:premier',    'onedrive:external-sharing-settings',   4),
    ('core:premier',    'platform:tenant-password-expiration',  5)
),
ranked AS (
  SELECT
    a.package_key,
    a.check_key,
    (SELECT COALESCE(MAX(m.sort_order), 0)
       FROM monitoring_package_checks m
      WHERE m.package_key = a.package_key)
      + ROW_NUMBER() OVER (PARTITION BY a.package_key ORDER BY a.ord) AS sort_order
  FROM additions a
)
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT package_key, check_key, sort_order FROM ranked
ON CONFLICT (package_key, check_key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-adopt-graph-rest-orphan-checks-1130.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

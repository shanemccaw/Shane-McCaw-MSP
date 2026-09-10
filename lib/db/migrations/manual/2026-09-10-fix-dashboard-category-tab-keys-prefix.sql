-- Fix unprefixed dashboard-category-tab keys (Git #3389)
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- WHAT THIS DOES
-- 2026-07-19-customer-dashboard-category-tabs.sql's `_dash_cat` temp table defines all
-- 10 category keys WITH the `cat-` prefix (e.g. 'cat-executive'), and its Parts A
-- (monitoring_packages insert), B (dashboard_templates insert) and C (msp_sales_bundles
-- insert) all read from that same _dash_cat.key column in one transaction — so a single
-- execution of that file as it exists today cannot produce prefixed monitoring_packages
-- rows alongside unprefixed dashboard_templates/msp_sales_bundles rows.
--
-- Live data shows exactly that inconsistent split (confirmed via direct psql query against
-- local PostgreSQL, shanemccawmsp, 2026-09-10):
--   monitoring_packages.key            = 'cat-executive', 'cat-identity-access', ... (10 rows, prefixed)
--   dashboard_templates.target_key     = 'executive', 'identity-access', ...        (10 rows, UNPREFIXED)
--   msp_sales_bundles.monitoring_package_keys (bundle_id 2d9dc63f-1c05-4e21-a7af-32a7defedc44,
--                                        msp_id 1, "Customer Dashboard Category Tabs")
--                                       = ["executive","identity-access",...]        (UNPREFIXED)
--
-- Zero of the unprefixed values match any live monitoring_packages.key row, so:
--   - msp-sales-bundles.ts's GET /:bundleId package-enrichment join
--     (inArray(monitoringPackagesTable.key, bundle.monitoringPackageKeys)) returns
--     packages: [] for this bundle today.
--   - If ever assigned to a customer, dashboard-overrides.ts's resolved-list gating
--     (bundle's monitoringPackageKeys ∩ dashboard_templates.target_key for
--     templateType='monitoring_package') cannot resolve any of the 10 tabs — the
--     mechanism this migration exists to deliver cannot activate as currently seeded.
--
-- THE FIX — realign the already-run rows with the migration file's current, correct
-- (prefixed) source, per #3389's own suggested fix direction. Straight 1:1 rename map,
-- no schema change, no new rows.

BEGIN;

-- Part 1: dashboard_templates.target_key (10 rows, template_type = 'monitoring_package')
UPDATE dashboard_templates
SET target_key = 'cat-' || target_key
WHERE template_type = 'monitoring_package'
  AND target_key IN (
    'executive', 'identity-access', 'security-posture', 'compliance-governance',
    'collaboration-sharing', 'licensing-cost', 'configuration-drift', 'intune-devices',
    'usage-adoption', 'operational-maturity'
  );

-- Part 2: msp_sales_bundles.monitoring_package_keys (the one live "Customer Dashboard
-- Category Tabs" bundle row, bundle_id 2d9dc63f-1c05-4e21-a7af-32a7defedc44)
UPDATE msp_sales_bundles
SET monitoring_package_keys = (
  SELECT jsonb_agg(
    CASE
      WHEN elem::text IN (
        '"executive"', '"identity-access"', '"security-posture"', '"compliance-governance"',
        '"collaboration-sharing"', '"licensing-cost"', '"configuration-drift"',
        '"intune-devices"', '"usage-adoption"', '"operational-maturity"'
      )
      THEN to_jsonb('cat-' || (elem #>> '{}'))
      ELSE elem
    END
  )
  FROM jsonb_array_elements(monitoring_package_keys) AS elem
)
WHERE bundle_id = '2d9dc63f-1c05-4e21-a7af-32a7defedc44';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-fix-dashboard-category-tab-keys-prefix.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

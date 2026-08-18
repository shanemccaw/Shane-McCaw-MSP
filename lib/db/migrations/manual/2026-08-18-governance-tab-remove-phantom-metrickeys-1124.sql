-- Git #1124: Compliance & Governance dashboard tab still references 2 phantom
-- metricKeys that #1118 removed from the registry.
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- WHAT THIS DOES
-- The seeded "Compliance & Governance" monitoring_package dashboard_templates
-- row (from 2026-07-19-customer-dashboard-category-tabs.sql) has two widget
-- cells pointing at registry keys #1118 removed as phantom sourceKeys (no
-- matching monitor_checks catalog entry):
--   cmp-orphanpkg       -> governance.orphanedAccessPackageCount
--   cmp-entitlementdrift -> governance.entitlementPolicyDriftCount
--
-- Fix:
--   * cmp-orphanpkg is REPLACED in place with a real, wired registry metric,
--     governance.ownerlessGroupCount (status "available", shape scalar,
--     sourceKey governance:ownerless-groups — see lib/dashboard-registry/src/
--     metrics.ts), keeping the same grid cell/renderer shape (Smart).
--   * cmp-entitlementdrift is REMOVED outright (no equivalent real timeline
--     metric exists to replace it with).
--
-- IDEMPOTENT: guarded by jsonb containment checks so it only touches rows
-- that still carry the old cells; safe to re-run.

BEGIN;

UPDATE dashboard_templates t
SET canvas_layout = (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'i' = 'cmp-orphanpkg'
            THEN elem || '{"metricKey":"governance.ownerlessGroupCount"}'::jsonb
          ELSE elem
        END
      )
      FROM jsonb_array_elements(t.canvas_layout) elem
      WHERE elem->>'i' <> 'cmp-entitlementdrift'
    ),
    updated_at = now()
WHERE t.template_type = 'monitoring_package'
  AND t.target_key = 'cat-compliance-governance'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.canvas_layout) e
    WHERE e->>'i' IN ('cmp-orphanpkg', 'cmp-entitlementdrift')
  );

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-governance-tab-remove-phantom-metrickeys-1124.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

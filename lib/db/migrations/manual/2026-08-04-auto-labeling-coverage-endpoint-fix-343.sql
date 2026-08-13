-- ============================================================================
-- governance:auto-labeling-coverage — dead Graph endpoint fix (#343)
-- Manual — run by hand, not drizzle-kit. No DATABASE_URL in this environment.
-- ============================================================================
--
-- SYMPTOM: this check's stored endpoint,
-- /security/informationProtection/policy/labels, is a deprecated Graph API
-- that stopped returning data on 2023-01-01. Confirmed against Microsoft's
-- current v1.0 docs: the replacement is
-- /security/dataSecurityAndGovernance/sensitivityLabels.
--
-- The required Application permission, SensitivityLabels.Read.All, has
-- already been added to the MT_APP_CLIENT_ID App Registration and to
-- REQUIRED_MT_SCOPES (artifacts/api-server/src/lib/graph.ts) in this same
-- change — that half does not need SQL.
--
-- The stored mapping (transform: exists, sourceField: id,
-- targetField: autoLabelingPolicyExists) is left untouched. Both the old and
-- new endpoints return a collection of label-shaped objects each carrying an
-- `id` field, so "does any returned item have a non-null id" still means the
-- same thing against the replacement endpoint.

UPDATE monitor_checks
SET endpoint = '/security/dataSecurityAndGovernance/sensitivityLabels',
    updated_at = now()
WHERE key = 'governance:auto-labeling-coverage';

-- Verify: expect the new endpoint, mapping unchanged, and status still active.
SELECT key, label, status, method, endpoint, mapping
FROM monitor_checks
WHERE key = 'governance:auto-labeling-coverage';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-04-auto-labeling-coverage-endpoint-fix-343.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

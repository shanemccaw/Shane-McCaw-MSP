-- #4481 — 7 core:premier checks had never returned a non-error result on any run.
-- Every change below is an UPDATE to an existing monitor_checks row; no DDL.
--
-- 1. Five Graph checks: beta-only resources called on v1.0.
--    graphFetchPaginated (artifacts/api-server/src/lib/monitor-executor.ts)
--    prefixes https://graph.microsoft.com/v1.0 onto any relative endpoint, and
--    passes an absolute https://graph.microsoft.com/... URL through verbatim
--    (graphFetchForTenant, #1796). All five resources are beta-only on Microsoft
--    Learn (checked 2026-09-17; each page carries only the graph-rest-beta
--    moniker): cloudlicensing-admincloudlicensing-list-allotments / -assignments /
--    -assignmenterrors, connectorgroup-list, externalidentitiespolicy-get. The
--    #2760/#2761/#2763 migrations that created them recorded the config_resources
--    match as graph:beta:... but stored the endpoint relative, so every run hit v1.0.
--    Live, app-only (MT app), testbed tenant c4c814d4-3afe-441e-9145-62461d0a4fd3:
--      v1.0 → 400 "Resource not found for the segment '<x>'" (the exact scan error)
--      beta → 200 on all five: allotments 4 items, assignments 6, assignmentErrors 0,
--             connectorGroups 0 (applicationProxy.isEnabled=false on this tenant),
--             externalIdentitiesPolicy singleton with both mapped fields present.
--    map-monitor-checks.mjs strips the absolute prefix before matching (#2929), so
--    config_resource_check_coverage is unaffected.
--
-- 2. exchange:mailbox-quota-utilization mapped sourceField "TotalItemSize", which
--    the get-mailbox-quota-utilization Script never emits (it emits
--    TotalItemSizeBytes). The count transform skips null values, so even with the
--    container fix this check could only ever report 0. It also had no
--    severity_rules at all, so a mailbox at quota could never surface. The
--    container's PostFilter already narrows the result to mailboxes at >= 90% of
--    ProhibitSendQuota, so every returned row is a near-quota mailbox.
--    schema_version bumps because the extracted property now means something.
--
-- The container half of #4481 (mailbox ToBytes on deserialized objects, DLP rule
-- package OOM) is in services/ps-execution, not here.

UPDATE monitor_checks SET endpoint = 'https://graph.microsoft.com/beta/admin/cloudLicensing/allotments', updated_at = now()
 WHERE key = 'directory:cloud-licensing-allotment-exhausted' AND endpoint = '/admin/cloudLicensing/allotments';

UPDATE monitor_checks SET endpoint = 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignments', updated_at = now()
 WHERE key = 'directory:cloud-licensing-assignment-disabled-plans' AND endpoint = '/admin/cloudLicensing/assignments';

UPDATE monitor_checks SET endpoint = 'https://graph.microsoft.com/beta/admin/cloudLicensing/assignmentErrors', updated_at = now()
 WHERE key = 'directory:cloud-licensing-assignment-errors' AND endpoint = '/admin/cloudLicensing/assignmentErrors';

UPDATE monitor_checks SET endpoint = 'https://graph.microsoft.com/beta/onPremisesPublishingProfiles/applicationProxy/connectorGroups', updated_at = now()
 WHERE key = 'identity:app-proxy-connector-groups' AND endpoint = '/onPremisesPublishingProfiles/applicationProxy/connectorGroups';

UPDATE monitor_checks SET endpoint = 'https://graph.microsoft.com/beta/policies/externalIdentitiesPolicy', updated_at = now()
 WHERE key = 'policy:external-identities-policy' AND endpoint = '/policies/externalIdentitiesPolicy';

UPDATE monitor_checks SET
  properties = '["DisplayName", "TotalItemSizeBytes", "UtilizationPercent"]'::jsonb,
  mapping = '[{"transform": "count", "sourceField": "TotalItemSizeBytes", "targetField": "mailboxesNearQuotaCount"}]'::jsonb,
  severity_rules = '[{"severity": "warning", "expression": "{{mailboxesNearQuotaCount}} > 0", "label": "One or more mailboxes are at or above 90% of their send quota (ProhibitSendQuota) — once full, the mailbox can no longer send mail"}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
 WHERE key = 'exchange:mailbox-quota-utilization'
   AND mapping = '[{"transform": "count", "sourceField": "TotalItemSize", "targetField": "mailboxesNearQuotaCount"}]'::jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4481-premier-never-succeeded-checks.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

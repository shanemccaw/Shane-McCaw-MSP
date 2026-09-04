-- 2026-09-04-azure-rm-lighthouse-scope-unavailable-1917.sql
--
-- Git #1917 — 7 of the 22 `azure-rm` resources sit above ANY scope Azure
-- Lighthouse can delegate. #1871's ARM executor and #1849's coverage
-- classifier only knew about "does an executor exist for this transport",
-- so once the azure-rm executor shipped, these 7 read as an ordinary
-- `uncovered` gap a check author could close — false. Per Microsoft's own
-- published Lighthouse docs, delegation onboards a SUBSCRIPTION or one or
-- more RESOURCE GROUPS within a subscription; a management group cannot be
-- delegated, and neither can a billing account or the tenant root.
--
-- Confirmed live 2026-08-30 against the testbed tenant, same principal that
-- holds three real subscription-scoped Azure RBAC roles there:
--   - 5 billing-account-scope resources: GET
--     /providers/Microsoft.Billing/billingAccounts returned 200 {"value":[]}
--     — readable endpoint, zero billing accounts in reach. Billing RBAC
--     (Billing Reader et al) is a separate role system from Azure RBAC,
--     assigned on the billing account, not delegable via Lighthouse.
--   - 2 tenant-root microsoft.aadiam-scope resources: GET
--     /providers/microsoft.aadiam/diagnosticsettings returned 403
--     AuthorizationFailed for the same principal.
--
-- These 7 rows already carried availability = 'unavailable' from an earlier,
-- generic pass ("source declares a delegated read path only — no app-only
-- read permission"), which is true but not the real, family-specific reason
-- #1917 confirmed. This migration replaces the reason text only — the
-- availability value itself is unchanged.
--
-- Paired code change (same commit): coverageStateFor() (lib/db/src/schema/
-- config-state.ts) now takes the resource's own `availability` and returns a
-- new 'unavailable' coverage state ahead of covered/uncovered, so these 7 stop
-- reading as an ordinary closeable gap in the admin config-resources API.
--
-- Per the issue: no second consent flow (Billing Reader / tenant-root grant)
-- is built here — that stays a separate, explicit product decision. This
-- migration is the classification fix only.
--
-- ADDITIVE-ONLY re-label of 7 existing rows' availability_reason. No schema
-- change — availability_reason is a plain TEXT column with no CHECK constraint.

BEGIN;

UPDATE config_resources
   SET availability_reason = 'billing-account scope, not delegable via Azure Lighthouse',
       updated_at = now()
 WHERE resource_key IN (
   'm365dsc:AzureBillingAccountPolicy',
   'm365dsc:AzureBillingAccountsAssociatedTenant',
   'm365dsc:AzureBillingAccountScheduledAction',
   'm365dsc:AzureBillingaccountsRoleAssignment',
   'm365dsc:AzureSubscription'
 )
   AND read_transport = 'azure-rm'
   AND availability = 'unavailable';

UPDATE config_resources
   SET availability_reason = 'tenant-root microsoft.aadiam scope, not delegable via Azure Lighthouse',
       updated_at = now()
 WHERE resource_key IN (
   'm365dsc:AzureDiagnosticSettings',
   'm365dsc:IntuneDiagnosticSettings'
 )
   AND read_transport = 'azure-rm'
   AND availability = 'unavailable';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-azure-rm-lighthouse-scope-unavailable-1917.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

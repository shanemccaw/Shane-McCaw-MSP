-- Fix dead password-expiration monitor checks (#3799).
-- Manual migration — run by hand against local Postgres (do NOT run drizzle-kit push/push --force).
--
-- Real, live-confirmed against local Postgres (shanemccawmsp): both
-- 'identity:password-expiration-policy' and 'platform:tenant-password-expiration'
-- had severity_rules = '[]', so neither could EVER produce a finding despite
-- both actively collecting via GET /domains -> passwordValidityPeriodInDays
-- (mapped to passwordExpirationDays / tenantPasswordExpirationDays respectively).
--
-- Decision on keep-vs-consolidate (per #3799's own ask, checked against real
-- usage before deciding):
--   - monitoring_package_checks: identity:password-expiration-policy is wired
--     into core:enhanced-monitoring, core:growth, detail:full-item-collection,
--     core:premier, core:free-scan-full (5 packages). platform:tenant-
--     password-expiration is wired into core:growth, core:premier,
--     core:free-scan-full only (3 packages) — a strict subset.
--   - Both already have their own PUBLISHED, independently-authored
--     remediation_knowledge_base rows (different titles/summaries, both
--     you_must_run, both already correctly pointed at "align with Microsoft/
--     NIST guidance: never expire + MFA" rather than authoring a weaker-
--     posture remediation).
--   - Both have real historical collection rows in tenant_monitor_profiles
--     (11 each, live tenant data) and a real msp_diagnostic_findings row each
--     (both severity='ok'/"Check passed" — pre-existing, not a severity-rule
--     match, so no backfill is needed here; this tenant's real value is
--     already 2147483647 = "never expire", i.e. compliant either way).
--   Consolidating would mean hard-deleting one monitor_checks row and its
--   real historical rows across 5+ referencing tables for zero net package
--   coverage change (identity: already covers every package platform: does).
--   That's a real, deliberate call for the catalog owner (which key survives,
--   whether historical findings get remapped or dropped), not something to
--   fold into a same-session data fix — so this migration KEEPS BOTH checks
--   active and gives each its own real severity_rules so neither is dead,
--   rather than deleting real data to resolve the duplication.
--
-- Threshold: Microsoft Graph's own "never expire" sentinel for
-- passwordValidityPeriodInDays is 2147483647 (int32 max) — confirmed live in
-- this tenant's own extracted_properties (passwordValidityPeriodInDays_values
-- all 2147483647 for every verified domain). Anything less is a real, finite
-- expiration window, which is what current Microsoft/NIST guidance says to
-- move away from (see the checks' own already-published remediation_knowledge_base
-- rows). Guarded against null (failed/missing collection) so a null field never
-- falsely fires.

UPDATE monitor_checks
SET severity_rules = '[{"label": "Domain password validity period is set to {{passwordExpirationDays}} days instead of never expiring — Microsoft and NIST guidance recommends passwords never expire when paired with MFA, since forced periodic rotation drives predictable, weaker password choices", "severity": "warning", "expression": "passwordExpirationDays != null && passwordExpirationDays < 2147483647"}]'::jsonb,
    updated_at = now()
WHERE key = 'identity:password-expiration-policy';

UPDATE monitor_checks
SET severity_rules = '[{"label": "Tenant password validity period is set to {{tenantPasswordExpirationDays}} days instead of never expiring — Microsoft and NIST guidance recommends passwords never expire when paired with MFA, since forced periodic rotation drives predictable, weaker password choices", "severity": "warning", "expression": "tenantPasswordExpirationDays != null && tenantPasswordExpirationDays < 2147483647"}]'::jsonb,
    updated_at = now()
WHERE key = 'platform:tenant-password-expiration';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-password-expiration-severity-rules-3799.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

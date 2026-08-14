-- ============================================================================
-- #551 -- POST-FIX LIVE VERIFICATION (PART C, consolidated across all 4 checks)
-- ============================================================================
-- READ-ONLY. Pure SELECT. No DDL, no DML, no transaction, and deliberately NO
-- trailing simulator_migration_runs INSERT -- diagnostics files are exempt
-- from the run-tracking convention (CLAUDE.md) and this one changes nothing.
--
-- WHY THIS FILE EXISTS
--   #551 is labeled "complete" on GitHub, but "complete" per CLAUDE.md means
--   "the code is done and confirmed [by the session that wrote it]" -- not
--   "Shane has reviewed and signed off", and none of the four fixes have a
--   live PART C confirmed run yet:
--     * identity:global-admin-count      (05dd885e, 2026-08-07) -- migration's
--       own PART C flagged the single-quote roleTemplateId URL and the
--       resolvePathInData @odata.type fix as the two genuinely unproven things.
--     * appgov:cert-secret-expiration    (#541, 2026-08-07) -- mapping/severity
--       fix confirmed live in the Phase 1 addendum comment BEFORE #551's own
--       investigation even started; re-checked here for completeness, not
--       because it was ever in doubt.
--     * appgov:unreviewed-consents /
--       appgov:risky-permission-grants   (085798fc, Phase 3, 2026-08-08) --
--       migration's own PART D expects 13 / 24, was never confirmed to have
--       actually run against the live monitor_checks rows.
--     * appgov:stale-app-registrations   (6ad4db44, 2026-08-12) -- migration's
--       own PART C expects both age counts strictly less than item_count on a
--       tenant with a recent registration; also never confirmed run.
--
--   Each of those four migrations already carries its own PART C/D live
--   smoke-test query (reproduced individually below, PART C1-C4) -- this file
--   does not replace them, it runs all four together in one place so a single
--   pass answers "is #551 actually done" instead of requiring four separate
--   files to be found and run in sequence.
--
--   PART C5 adds what none of the four originals do: the #357 EEEU
--   cross-check discipline the issue title itself invokes. #357's standard
--   was never "trust the aggregate field" -- it was "recompute the aggregate
--   by hand from the raw per-item rows in tenant_check_item_details and
--   confirm the two numbers match" (Phase 1 comment: "1 real EEEU site out of
--   93 total sites scanned, matching the stored eeeuSiteCount aggregate").
--   PART C1-C4 each include that same hand-recompute, cross-checked against
--   tenant_check_item_details using the IDENTICAL predicate each check's own
--   `mapping` now uses (confirmed from the four migrations' PART B, not
--   guessed) -- and PART C5 re-runs the ORIGINAL #357 EEEU query itself as a
--   known-good control, so a failure in C1-C4 can be distinguished from "the
--   cross-check methodology itself is wrong" rather than assumed to be a real
--   regression.
--
-- HOW TO READ THE RESULTS
--   Every block below states its own PASS/FAIL condition inline. General
--   shape: the tenant_monitor_profiles aggregate (what the product shows)
--   must equal the independently-recomputed count from tenant_check_item_details
--   raw items (what is actually true of the data) using the check's own
--   predicate. A mismatch means either the mapping fix didn't actually reach
--   this database, or the two numbers are drifting for a reason worth a new
--   issue -- not something to wave through.
--
--   All queries key off "most recent run per check" (collected_at DESC LIMIT).
--   If a check has not been scanned since its fix landed, its rows here will
--   still reflect the PRE-fix shape -- run a fresh scan first (Simulator
--   Studio, or any path that executes these checks) if any block below still
--   shows old numbers.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C1 -- identity:global-admin-count (05dd885e)
-- ══════════════════════════════════════════════════════════════════════════════
-- PASS: item_count and globalAdminCount both a small real number (NOT 14 --
-- that was activated-directory-role count, the pre-fix defect). members_count
-- key ABSENT from extracted_properties (dropped from `properties` by the fix).
-- globalAdminsByPrincipalType a real non-empty object, e.g.
-- {"#microsoft.graph.user": 3} -- an empty {} while names are populated below
-- means the resolvePathInData literal-key fix for dotted field names
-- (@odata.type) is not deployed even though the endpoint/mapping change is.

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'globalAdminCount'                 AS global_admin_count,
       p.extracted_properties -> 'globalAdminUserCount'             AS human_admins,
       p.extracted_properties -> 'globalAdminServicePrincipalCount' AS app_admins,
       p.extracted_properties -> 'globalAdminsByPrincipalType'      AS by_type,
       p.extracted_properties -> 'displayName_values'               AS admin_names,
       p.extracted_properties -> 'userPrincipalName_values'         AS admin_upns,
       p.extracted_properties ? 'members_count'                     AS still_has_stale_members_key
FROM tenant_monitor_profiles p
WHERE p.check_key = 'identity:global-admin-count'
ORDER BY p.collected_at DESC
LIMIT 5;

-- Cross-check: recompute globalAdminCount by hand from the raw stored items
-- (endpoint members list) and confirm it matches the aggregate above, and that
-- the items are genuinely member objects now (userPrincipalName present on at
-- least one row) rather than the old directoryRole shape (id + description +
-- roleTemplateId, no userPrincipalName at all).

SELECT d.collected_at, d.item_count,
       count(*)                                                   AS recomputed_member_count,
       count(*) FILTER (WHERE a ? 'userPrincipalName')             AS rows_with_upn_field,
       count(*) FILTER (WHERE a ? 'roleTemplateId')                AS rows_still_shaped_like_directoryrole
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
WHERE d.check_key = 'identity:global-admin-count'
  AND d.collected_at = (SELECT max(collected_at) FROM tenant_check_item_details
                          WHERE check_key = 'identity:global-admin-count')
GROUP BY d.collected_at, d.item_count;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C2 -- appgov:cert-secret-expiration (#541, confirmed live 2026-08-07,
-- re-checked here for completeness as part of #551's full scope)
-- ══════════════════════════════════════════════════════════════════════════════
-- PASS: expiredPasswordCredentialCount + expiredKeyCredentialCount both
-- strictly less than passwordCredentialCount + keyCredentialCount respectively
-- on a tenant with at least one non-expired credential (proves the
-- olderThanDays predicate is discriminating, not just echoing the total).

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'passwordCredentialCount'        AS password_creds,
       p.extracted_properties -> 'expiredPasswordCredentialCount' AS expired_password_creds,
       p.extracted_properties -> 'keyCredentialCount'             AS key_creds,
       p.extracted_properties -> 'expiredKeyCredentialCount'      AS expired_key_creds
FROM tenant_monitor_profiles p
WHERE p.check_key = 'appgov:cert-secret-expiration'
ORDER BY p.collected_at DESC
LIMIT 5;

-- Cross-check: recompute both expired counts directly from the raw
-- /applications items' passwordCredentials/keyCredentials arrays, using the
-- IDENTICAL endDateTime-in-the-past predicate the mapping's
-- countWhere('{{endDateTime}} olderThanDays 0') applies.

SELECT d.collected_at, d.item_count,
       sum(jsonb_array_length(COALESCE(a -> 'passwordCredentials', '[]'::jsonb))) AS total_password_creds,
       sum((
         SELECT count(*) FROM jsonb_array_elements(COALESCE(a -> 'passwordCredentials', '[]'::jsonb)) pc
         WHERE (pc ->> 'endDateTime')::timestamptz < now()
       )) AS recomputed_expired_password_creds,
       sum(jsonb_array_length(COALESCE(a -> 'keyCredentials', '[]'::jsonb)))      AS total_key_creds,
       sum((
         SELECT count(*) FROM jsonb_array_elements(COALESCE(a -> 'keyCredentials', '[]'::jsonb)) kc
         WHERE (kc ->> 'endDateTime')::timestamptz < now()
       )) AS recomputed_expired_key_creds
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
WHERE d.check_key = 'appgov:cert-secret-expiration'
  AND d.collected_at = (SELECT max(collected_at) FROM tenant_check_item_details
                          WHERE check_key = 'appgov:cert-secret-expiration')
GROUP BY d.collected_at, d.item_count;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C3 -- appgov:stale-app-registrations / "Aging App Registrations" (6ad4db44)
-- ══════════════════════════════════════════════════════════════════════════════
-- PASS: appRegistrationsOver180dCount and appRegistrationsOver365dCount BOTH
-- strictly less than item_count on a tenant with at least one recently-created
-- app registration -- the pre-fix defect was reading item_count exactly
-- (11/11) unconditionally regardless of the 180 argument. A count still equal
-- to item_count on every run means the predicate is not discriminating.
-- severity_matched should read 'critical'/'warning' only when the
-- corresponding count is nonzero, 'ok'/null when both are zero.

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'appRegistrationsOver180dCount' AS over_180d,
       p.extracted_properties -> 'appRegistrationsOver365dCount' AS over_365d
FROM tenant_monitor_profiles p
WHERE p.check_key = 'appgov:stale-app-registrations'
ORDER BY p.collected_at DESC
LIMIT 5;

-- Cross-check: recompute both age-band counts from the raw /applications
-- items' createdDateTime, using the identical olderThanDays 180 / 365
-- predicate the mapping now uses.

SELECT d.collected_at, d.item_count,
       count(*)                                                                      AS recomputed_total,
       count(*) FILTER (WHERE (a ->> 'createdDateTime')::timestamptz < now() - interval '180 days') AS recomputed_over_180d,
       count(*) FILTER (WHERE (a ->> 'createdDateTime')::timestamptz < now() - interval '365 days') AS recomputed_over_365d
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
WHERE d.check_key = 'appgov:stale-app-registrations'
  AND d.collected_at = (SELECT max(collected_at) FROM tenant_check_item_details
                          WHERE check_key = 'appgov:stale-app-registrations')
GROUP BY d.collected_at, d.item_count;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C4 -- appgov:unreviewed-consents + appgov:risky-permission-grants (085798fc)
-- ══════════════════════════════════════════════════════════════════════════════
-- PASS on the live test tenant (c4c814d4, per the migration's own PART D):
--   totalConsentGrantCount     37  (both checks, same tenant, same endpoint)
--   unreviewedConsentCount     13  (was 37 pre-fix -- consentType = 'Principal')
--   riskyPermissionGrantCount  24  (was 37 pre-fix -- consentType = 'AllPrincipals')
-- On any other tenant: unreviewedConsentCount + riskyPermissionGrantCount
-- should equal totalConsentGrantCount (the split is exhaustive over the two
-- known consentType values). If either count still equals
-- totalConsentGrantCount, that row's fix did not take.

SELECT p.check_key, p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'totalConsentGrantCount'    AS total_grants,
       p.extracted_properties -> 'unreviewedConsentCount'    AS unreviewed_count,
       p.extracted_properties -> 'riskyPermissionGrantCount' AS risky_count
FROM tenant_monitor_profiles p
WHERE p.check_key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
ORDER BY p.check_key, p.collected_at DESC
LIMIT 10;

-- Cross-check: recompute the consentType split directly from the raw
-- /oauth2PermissionGrants items stored for EITHER check (same endpoint, same
-- item shape -- #551 Phase 1 addendum's "2 finding: same defect, same
-- endpoint, twice"). Confirms unreviewedConsentCount == count(Principal) and
-- riskyPermissionGrantCount == count(AllPrincipals) independent of which
-- check's detail rows are read.

SELECT d.check_key, d.collected_at, d.item_count,
       count(*) FILTER (WHERE a ->> 'consentType' = 'Principal')     AS recomputed_unreviewed,
       count(*) FILTER (WHERE a ->> 'consentType' = 'AllPrincipals') AS recomputed_risky,
       count(*)                                                      AS recomputed_total,
       count(*) FILTER (WHERE a ->> 'consentType' NOT IN ('Principal', 'AllPrincipals')) AS unrecognized_consent_type_rows
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
WHERE d.check_key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
  AND d.collected_at = (SELECT max(collected_at) FROM tenant_check_item_details
                          WHERE check_key = d.check_key)
GROUP BY d.check_key, d.collected_at, d.item_count
ORDER BY d.check_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C5 -- THE #357 EEEU CONTROL (known-good reference, re-run verbatim)
-- ══════════════════════════════════════════════════════════════════════════════
-- The point of this block is NOT to re-audit EEEU -- Phase 1 already confirmed
-- it correct (1 real EEEU site out of 93 total, matching the stored
-- eeeuSiteCount aggregate). It is here so a mismatch anywhere in C1-C4 can be
-- read correctly: if this control ALSO mismatches, the cross-check
-- methodology itself (predicate, item shape assumption, join) is what's wrong,
-- not the #551 fixes. If this control matches and a C1-C4 block does not, the
-- #551 fix in that block is the real problem.

SELECT p.status, p.severity_matched, p.collected_at,
       p.extracted_properties -> 'sitesScanned'  AS sites_scanned,
       p.extracted_properties -> 'eeeuSiteCount' AS eeeu_sites
FROM tenant_monitor_profiles p
WHERE p.check_key = 'compliance:eeeu-site-sharing'
ORDER BY p.collected_at DESC
LIMIT 5;

SELECT d.collected_at, d.item_count,
       count(*) FILTER (WHERE (a ->> 'hasEeeu')::boolean IS TRUE) AS recomputed_eeeu_sites
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
WHERE d.check_key = 'compliance:eeeu-site-sharing'
  AND d.collected_at = (SELECT max(collected_at) FROM tenant_check_item_details
                          WHERE check_key = 'compliance:eeeu-site-sharing')
GROUP BY d.collected_at, d.item_count;

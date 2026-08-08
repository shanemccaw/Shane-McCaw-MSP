-- ============================================================================
-- #551 PHASE 1 -- Per-item enumeration audit: CONFIRMATION QUERIES ONLY
-- ============================================================================
-- READ-ONLY. Pure SELECT. No DDL, no DML, no transaction, and deliberately NO
-- trailing simulator_migration_runs INSERT -- diagnostics files are exempt from
-- the run-tracking convention (CLAUDE.md) and this one changes nothing.
--
-- WHY THIS FILE EXISTS
--   Three of the four checks #551 asks about carry their real semantics in
--   DB-resident columns (monitor_checks.mapping / .properties / .severity_rules)
--   that the Claude Code environment cannot read -- there is no DATABASE_URL
--   here. The endpoint side was confirmed from the live docs/endpoints.json dump
--   and from Microsoft Graph v1.0 reference documentation; the mapping side is
--   the remaining unknown, and every "what does the current number actually
--   mean" question reduces to it.
--
--   So rather than guess a mapping and present the guess as a finding (the exact
--   failure the 2026-08-02 war-room-pillar-stats audit refused to commit for
--   this same check), this file is the one-shot query that settles it. Run it,
--   paste the output into #551, and the remaining UNKNOWNs in the Phase 1
--   findings comment close.
--
-- WHAT IS ALREADY CONFIRMED WITHOUT THIS FILE (do not re-derive):
--   * identity:global-admin-count  endpoint = /directoryRoles
--   * appgov:unreviewed-consents   endpoint = /oauth2PermissionGrants
--   * appgov:cert-secret-expiration endpoint = /applications
--   * appgov:stale-app-registrations endpoint = /applications
--     -- all four from docs/endpoints.json, a live monitor_checks dump.
--   * GET /directoryRoles returns ACTIVATED ROLE OBJECTS, never members
--     (learn.microsoft.com/en-us/graph/api/directoryrole-list -- "List the
--     directory roles that are activated in the tenant").
--   * oAuth2PermissionGrant has SIX properties total (clientId, consentType, id,
--     principalId, resourceId, scope) and NO reviewed/approved/status property
--     of any kind (learn.microsoft.com/en-us/graph/api/resources/
--     oauth2permissiongrant).
--   * The application resource has NO signInActivity property
--     (learn.microsoft.com/en-us/graph/api/resources/application).
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- Q1 -- THE FOUR CHECK CONFIGS, WHOLE
-- ══════════════════════════════════════════════════════════════════════════════
-- This is the single most load-bearing query in the file. Read `mapping`
-- alongside `endpoint`: the mapping is what turns a Graph response into the
-- number a card renders, and for three of these four checks nobody has ever
-- read it and the endpoint on record.
--
-- WHAT TO LOOK FOR, PER ROW:
--
--   identity:global-admin-count
--     EXPECT (per #551's own report): a rule counting `id` off /directoryRoles.
--     If so, its targetField (globalAdminCount) is the number of ACTIVATED
--     DIRECTORY ROLES in the tenant -- not administrators. 14 activated roles is
--     an entirely ordinary tenant. CONFIRM the targetField name too: the metric
--     registry resolves this via pickMappedValueField, and if the mapping
--     declares no field the executor implements, the resolver silently falls
--     back to _itemCount, which is the same 14 by a different route.
--
--   appgov:unreviewed-consents
--     EXPECT a bare {"transform":"count"} with no filter. There is no property
--     on oAuth2PermissionGrant it COULD filter on for "reviewed" -- the resource
--     has none. If the mapping has any predicate at all, say so in #551, because
--     that changes the finding.
--
--   appgov:stale-app-registrations
--     THE ONE TO READ CLOSELY. If `transform` is countIfLastSignInOlderThan(N),
--     the count is badly wrong in the OVER-reporting direction: that transform
--     is hardcoded to read `signInActivity.lastSignInDateTime` off each item
--     (monitor-executor.ts), the application resource has no such property, and
--     its `if (lastSignIn == null) return true` branch scores "never signed in
--     counts as stale". Every app registration in the tenant would be counted
--     stale. If instead it reads createdDateTime, the count is measuring app AGE,
--     not staleness -- a five-year-old app in daily use is flagged.
--
--   appgov:cert-secret-expiration
--     Should already show #541's four countWhere rules. If it still shows the
--     old {"transform":"count","sourceField":"passwordCredentials"}, then
--     2026-08-07-cert-secret-expiration-mapping-severity-541.sql has not been
--     run on this database, and #541 is not actually closed.

SELECT
  key,
  label,
  status,
  method,
  endpoint,
  select_params,
  filter_params,
  fan_out_source,
  fan_out_item_id_field,
  fan_out_item_filter,
  fan_out_item_normalizer,
  properties,
  mapping,
  severity_rules,
  engines,
  schema_version
FROM monitor_checks
WHERE key IN (
  'identity:global-admin-count',
  'appgov:unreviewed-consents',
  'appgov:cert-secret-expiration',
  'appgov:stale-app-registrations'
)
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- Q2 -- WHAT THE LAST REAL RUNS ACTUALLY STORED
-- ══════════════════════════════════════════════════════════════════════════════
-- The other half of the answer. If extracted_properties carries no numeric field
-- of its own, then whatever number the card shows is item_count -- literally
-- items.length, i.e. the raw row count of the endpoint's response -- and Q1's
-- endpoint column is the entire explanation.
--
-- For identity:global-admin-count specifically: item_count here IS the number of
-- objects /directoryRoles returned. If that reads 14, then "14 Global
-- Administrators" is 14 activated directory roles, confirmed end to end.

SELECT
  p.check_key,
  p.status,
  p.severity_matched,
  p.collected_at,
  p.item_count,
  p.error_message,
  p.extracted_properties
FROM tenant_monitor_profiles p
WHERE p.check_key IN (
  'identity:global-admin-count',
  'appgov:unreviewed-consents',
  'appgov:cert-secret-expiration',
  'appgov:stale-app-registrations'
)
ORDER BY p.check_key, p.collected_at DESC
LIMIT 40;


-- ══════════════════════════════════════════════════════════════════════════════
-- Q3 -- IS ANYTHING ENUMERATED TODAY? (expect: nothing)
-- ══════════════════════════════════════════════════════════════════════════════
-- #551's premise is that fan_out_source is null on all four and no per-item rows
-- exist. This confirms the second half. compliance:eeeu-site-sharing is included
-- as the KNOWN-GOOD control: it should be the only key here with real rows, and
-- its shape is the target shape for all four.

SELECT
  d.check_key,
  count(*)                                       AS detail_rows,
  max(d.collected_at)                            AS newest,
  sum(d.item_count)                              AS total_items,
  count(*) FILTER (WHERE d.items IS NULL)        AS rows_with_items_omitted,
  min(d.items_omitted_reason)                    AS a_sample_omission_reason
FROM tenant_check_item_details d
WHERE d.check_key IN (
  'identity:global-admin-count',
  'appgov:unreviewed-consents',
  'appgov:cert-secret-expiration',
  'appgov:stale-app-registrations',
  'compliance:eeeu-site-sharing'
)
GROUP BY d.check_key
ORDER BY d.check_key;


-- ══════════════════════════════════════════════════════════════════════════════
-- Q4 -- PACKAGE WIRING
-- ══════════════════════════════════════════════════════════════════════════════
-- #551 item 5: a real customer scan has to produce this data, not just the
-- diagnostic package. detail:full-item-collection alone is NOT enough for the
-- scoring path; core:security-baseline (or whichever package the customer tier
-- actually runs) is what a paying tenant executes.
--
-- Note the direction of the gate: item-detail-collector.ts scopes itself to
-- checks the SCORING package ran (scopeToPackageKey, #543), so a check present
-- in detail:full-item-collection but ABSENT from the scoring package produces no
-- item detail at all on a real customer scan.

SELECT
  c.key,
  c.status AS check_status,
  bool_or(pc.package_key = 'detail:full-item-collection') AS in_detail_package,
  bool_or(pc.package_key = 'core:security-baseline')      AS in_security_baseline,
  bool_or(pc.package_key = 'assess:copilot-readiness')     AS in_copilot_readiness,
  array_agg(DISTINCT pc.package_key) FILTER (WHERE pc.package_key IS NOT NULL) AS all_packages
FROM monitor_checks c
LEFT JOIN monitoring_package_checks pc ON pc.check_key = c.key
WHERE c.key IN (
  'identity:global-admin-count',
  'appgov:unreviewed-consents',
  'appgov:cert-secret-expiration',
  'appgov:stale-app-registrations',
  'compliance:eeeu-site-sharing'
)
GROUP BY c.key, c.status
ORDER BY c.key;


-- ══════════════════════════════════════════════════════════════════════════════
-- Q5 -- BLAST RADIUS OF CORRECTING globalAdminCount
-- ══════════════════════════════════════════════════════════════════════════════
-- Before the number changes, know who reads it. If the fix lands, every one of
-- these consumers starts reporting a different (correct, and almost certainly
-- much smaller) figure in the same deploy.
--
-- Known from the repo already, so treat this as the check for anything MISSED:
--   * lib/dashboard-registry/src/metrics.ts  -> sourceKey identity:global-admin-count
--   * war_room_pillar_stat_specs             -> security card, "global administrators"
--   * signal_simulation_profiles             -> the #413 spectrum profile hardcodes
--                                               "globalAdminCount": 14 AND the string
--                                               "14 Global Administrators" in
--                                               parsed_findings. That seed is
--                                               DERIVED FROM THE BUG and will need
--                                               re-basing, not just the live check.

SELECT 'signal_rules'            AS surface, source_key AS ref, signal_key AS detail
FROM signal_rules
WHERE source_key ILIKE '%global-admin%' OR source_key ILIKE '%globalAdminCount%'
UNION ALL
SELECT 'war_room_pillar_stat_specs', check_key, label
FROM war_room_pillar_stat_specs
WHERE check_key = 'identity:global-admin-count'
UNION ALL
SELECT 'signal_simulation_profiles', name, profile_updates::text
FROM signal_simulation_profiles
WHERE profile_updates ? 'globalAdminCount'
   OR parsed_findings::text ILIKE '%global-admin-count%'
ORDER BY surface, ref;


-- ══════════════════════════════════════════════════════════════════════════════
-- Q6 -- THE OTHER /oauth2PermissionGrants CHECK
-- ══════════════════════════════════════════════════════════════════════════════
-- appgov:risky-permission-grants hits the SAME endpoint. If #551 reshapes
-- unreviewed-consents into a consentType-filtered check, these two must not end
-- up as two names for one number. Read both mappings together before deciding.

SELECT key, label, endpoint, properties, mapping, severity_rules, status
FROM monitor_checks
WHERE endpoint LIKE '%oauth2PermissionGrants%'
ORDER BY key;

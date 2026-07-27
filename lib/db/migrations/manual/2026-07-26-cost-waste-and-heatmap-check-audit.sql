-- ============================================================================
-- Cost Engine waste + Risk Heat Map — check-catalog audit
-- READ-ONLY (Parts A–D). Part E is an OPTIONAL correction, commented out.
-- Manual migration — review and run by hand (do not run drizzle-kit push).
-- ============================================================================
--
-- CONTEXT — what was fixed in code, and what is left that only SQL can answer.
--
-- ⚠️ PART A HAS BEEN RUN. Its live results (2026-07-26) changed the diagnosis
-- and are recorded here; re-run it only to re-confirm. Parts B–D are still open.
--
-- CONFIRMED FROM LIVE DATA — the Cost Engine had TWO problems, not one:
--
--   1. `cost:license-waste-estimate` DOES NOT EXIST in monitor_checks. It is the
--      only cost check key referenced anywhere in the repo, and every consumer
--      (portal-assessment.ts's status.stats, the licensing.wasteEstimateBreakdown
--      metric, the CIO narrative) hardcoded it — so the dollar figure could never
--      be anything but null. The seven checks that DO exist are:
--        cost:duplicate-assignments            /users           countDuplicates(skuId)
--        cost:entra-license-tier-distribution  /subscribedSkus  groupByCount(skuPartNumber)
--        cost:group-based-licensing-adoption   /groups          count(assignedLicenses)
--        cost:license-count-by-sku             /subscribedSkus  groupByCount(skuPartNumber)
--        cost:underutilized-premium            /users           count(assignedLicenses)
--        cost:unused-unassigned-licenses       /subscribedSkus  count(consumedUnits)
--        cost:utilization-by-sku               /subscribedSkus  groupByCount(skuPartNumber)
--
--   2. NONE of them produces a per-SKU wasted-SEAT count, and two of them are
--      active traps for anything that tries to infer one:
--        * `cost:unused-unassigned-licenses` is MISNAMED relative to its mapping.
--          `count` over `consumedUnits` counts SKU ROWS that have a consumedUnits
--          value — so the observed `unusedLicenseCount: 4` means "this tenant
--          subscribes to 4 SKUs", NOT "4 seats are wasted". See PART F.
--        * Every `groupByCount(skuPartNumber)` over /subscribedSkus returns ONE
--          ROW PER SKU — which is why the observed breakdown read
--          `ENTERPRISEPACK: 1`. That is not one wasted seat. Those maps are
--          SKU-keyed and numeric, so a resolver that priced "the SKU-keyed count
--          map" would have reported 1 x $23.00 = $23/month of waste that does
--          not exist.
--
--   FIX: license-waste-source.ts no longer infers waste from ANY
--   extractedProperties count map. It computes the real figure from the stored
--   /subscribedSkus Graph response, where each SKU carries prepaidUnits.enabled
--   (bought) and consumedUnits (assigned): unused = enabled - consumed, floored
--   at 0. Candidate checks are selected by ENDPOINT, not key name, because the
--   key names in this catalog have already proven unreliable. A truncated page
--   (@odata.nextLink present) or a SKU missing either field is refused rather
--   than half-counted, and "every seat assigned" returns no_data rather than $0.
--
-- The Risk Heat Map is sparse for a different reason in each dark cell, and the
-- API used to report all of them identically as "no_data". The resolver now
-- distinguishes `unknown_check_key` (the registry names a check the catalog does
-- not have — a wiring bug) from `no_data` (real check, tenant hasn't collected
-- it — usually because it is not in their scan package). Parts B and C say which
-- of the 26 heatmap metrics are in which bucket, from live data.
--
-- Part D is the "stale accounts shows a wrong number" question. The resolver
-- previously took the FIRST numeric mapping targetField and, failing that,
-- `_itemCount` (the raw count of Graph items the endpoint returned). For a
-- check whose endpoint fetches a broad user list, `_itemCount` is the whole
-- directory, not the stale subset. The code fix makes field selection
-- metric-aware (it now prefers the targetField whose name matches the metric),
-- but if `identity:stale-accounts` has NO numeric mapping field at all — e.g.
-- its transform is a name the executor does not implement, which falls through
-- to a raw array — then the number on screen is still `_itemCount` and only a
-- mapping/endpoint correction here can fix it. Part D shows exactly which.

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — ALREADY RUN (findings recorded above). Re-run to re-confirm.
-- ════════════════════════════════════════════════════════════════════════════

SELECT key, label, status, endpoint, mapping
FROM monitor_checks
WHERE key LIKE 'cost:%'
ORDER BY key;

-- A2 — the ACTUAL seat arithmetic the Cost Engine now uses, straight from the
-- stored Graph page. This is the number that should appear in the UI: sum of
-- (prepaidUnits.enabled - consumedUnits) per SKU, priced against
-- sku_price_reference. Run it to know the expected dollar figure BEFORE looking
-- at the page, so the two can be compared rather than merely believed.
-- Latest row only, and only /subscribedSkus checks.
WITH latest AS (
  SELECT DISTINCT ON (p.check_key)
         p.check_key, p.raw_response, p.collected_at
  FROM tenant_monitor_profiles p
  JOIN msp_customers c ON c.tenant_id = p.tenant_id
  JOIN monitor_checks mc ON mc.key = p.check_key
  WHERE c.id = 4
    AND mc.status = 'active'
    AND lower(mc.endpoint) LIKE '%subscribedskus%'
  ORDER BY p.check_key, p.collected_at DESC
)
SELECT l.check_key,
       l.collected_at,
       (l.raw_response ? '@odata.nextLink')            AS page_truncated,
       s->>'skuPartNumber'                             AS sku_part_number,
       (s->'prepaidUnits'->>'enabled')::int            AS seats_bought,
       (s->>'consumedUnits')::int                      AS seats_assigned,
       GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int) AS seats_unused,
       spr.monthly_price_cents,
       GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int)
         * COALESCE(spr.monthly_price_cents, 0)        AS monthly_waste_cents
FROM latest l,
     jsonb_array_elements(l.raw_response->'value') AS s
LEFT JOIN sku_price_reference spr ON spr.sku_part_number = s->>'skuPartNumber'
ORDER BY l.check_key, monthly_waste_cents DESC;

-- A3 — the single expected headline figure (one /subscribedSkus check only, to
-- avoid double-counting the same estate across the four checks that share it).
WITH latest AS (
  SELECT p.raw_response
  FROM tenant_monitor_profiles p
  JOIN msp_customers c ON c.tenant_id = p.tenant_id
  JOIN monitor_checks mc ON mc.key = p.check_key
  WHERE c.id = 4
    AND mc.status = 'active'
    AND lower(mc.endpoint) LIKE '%subscribedskus%'
  ORDER BY p.collected_at DESC
  LIMIT 1
)
SELECT SUM(GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int)) AS total_unused_seats,
       SUM(GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int)
           * COALESCE(spr.monthly_price_cents, 0)) / 100.0 AS expected_monthly_waste_dollars,
       SUM(GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int)
           * COALESCE(spr.monthly_price_cents, 0)) * 12 / 100.0 AS expected_annual_waste_dollars,
       COUNT(*) FILTER (WHERE spr.sku_part_number IS NULL
                          AND (s->'prepaidUnits'->>'enabled')::int > (s->>'consumedUnits')::int)
         AS wasted_skus_with_no_price_on_file
FROM latest l, jsonb_array_elements(l.raw_response->'value') AS s
LEFT JOIN sku_price_reference spr ON spr.sku_part_number = s->>'skuPartNumber';

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — Which Risk Heat Map sourceKeys are PHANTOM (no catalog row)?
-- Any key returned here is a registry wiring bug: the metric can never resolve
-- for any tenant. The API now reports these as reason='unknown_check_key'.
-- (`identity:high-risk-signins` was one; the registry now points that metric at
--  `identity:risky-signins`, the key curated into core:security-baseline.)
-- ════════════════════════════════════════════════════════════════════════════

WITH heatmap_source_keys(metric_key, source_key) AS (VALUES
  -- IDENTITY row
  ('identity.riskyUserCount',              'identity:risky-users'),
  ('identity.highRiskSigninCount',         'identity:risky-signins'),
  ('identity.legacyAuthCount',             'identity:legacy-auth-usage'),
  ('identity.staleAccountCount',           'identity:stale-accounts'),
  ('identity.impossibleTravelCount',       'identity:impossible-travel'),
  ('identity.privilegedRoleChangeCount',   'audit:directory-role-changes'),
  -- POLICIES row
  ('identity.caFailureCount',              'security:conditional-access-failures'),
  ('compliance.weakDlpPolicyCount',        'compliance:weak-dlp-policies'),
  ('compliance.labelPolicyDriftCount',     'compliance:label-policy-drift'),
  ('compliance.retentionDriftCount',       'compliance:retention-drift'),
  ('governance.overdueAccessReviewCount',  'governance:overdue-access-reviews'),
  ('security.lowScoreControlCount',        'security:low-score-controls'),
  -- DRIFT row (all 14)
  ('drift.caPolicyDriftCount',             'drift:ca-policy'),
  ('drift.directorySettingsDriftCount',    'drift:directory-settings'),
  ('drift.licenseAssignmentDriftCount',    'drift:license-assignment'),
  ('drift.mailboxConfigDriftCount',        'drift:mailbox-config'),
  ('drift.roleAssignmentDriftCount',       'drift:role-assignment'),
  ('drift.securityDefaultsDriftCount',     'drift:security-defaults'),
  ('drift.sharePointAdminDriftCount',      'drift:sharepoint-admin'),
  ('drift.teamsPolicyDriftCount',          'drift:teams-policy'),
  ('drift.appConfigDriftCount',            'drift:app-config'),
  ('drift.redirectUriDriftCount',          'drift:redirect-uri'),
  ('drift.secretDriftCount',               'drift:secret'),
  ('drift.certificateDriftCount',          'drift:certificate'),
  ('drift.permissionDriftCount',           'drift:permission'),
  ('drift.tenantConfigDriftCount',         'drift:tenant-config')
)
SELECT h.metric_key,
       h.source_key,
       CASE WHEN c.key IS NULL THEN 'PHANTOM — no monitor_checks row'
            WHEN c.status <> 'active' THEN 'inactive: ' || c.status
            ELSE 'ok' END AS catalog_state
FROM heatmap_source_keys h
LEFT JOIN monitor_checks c ON c.key = h.source_key
ORDER BY (c.key IS NULL) DESC, h.metric_key;

-- NB: the source_key column above mirrors lib/dashboard-registry/src/metrics.ts
-- as of this commit. If a registry sourceKey changes, update this list too.

-- ════════════════════════════════════════════════════════════════════════════
-- PART C — Of the REAL heatmap checks, which are in the tenant's scan package,
-- and which have actually collected a row? This is the honest explanation for
-- every remaining dark cell.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.status                                  AS check_status,
       (pc.check_key IS NOT NULL)                AS in_security_baseline_package,
       p.status                                  AS last_run_status,
       p.collected_at                            AS last_collected_at,
       p.extracted_properties
FROM monitor_checks c
LEFT JOIN monitoring_package_checks pc
       ON pc.check_key = c.key AND pc.package_key = 'core:security-baseline'
LEFT JOIN LATERAL (
  SELECT tp.status, tp.collected_at, tp.extracted_properties
  FROM tenant_monitor_profiles tp
  JOIN msp_customers mc ON mc.tenant_id = tp.tenant_id
  WHERE mc.id = 4 AND tp.check_key = c.key
  ORDER BY tp.collected_at DESC
  LIMIT 1
) p ON TRUE
WHERE c.key IN (
  'identity:risky-users', 'identity:risky-signins', 'identity:legacy-auth-usage',
  'identity:stale-accounts', 'identity:impossible-travel', 'audit:directory-role-changes',
  'security:conditional-access-failures', 'compliance:weak-dlp-policies',
  'compliance:label-policy-drift', 'compliance:retention-drift',
  'governance:overdue-access-reviews', 'security:low-score-controls'
)
ORDER BY in_security_baseline_package DESC, c.key;

-- ════════════════════════════════════════════════════════════════════════════
-- PART D — The "stale accounts is wrong" question, answered from real data.
--
-- Read the three outputs together:
--   * mapping        — does it declare a numeric target field at all, and is the
--                      transform one the executor actually implements?
--                      Implemented: count, exists, first, join, countTruthy,
--                      countFalse, countEquals('x'), countIfLastSignInOlderThan(N),
--                      groupByCount, countDuplicates. ANYTHING ELSE silently
--                      falls through to a raw array — which is not a number, so
--                      the resolver drops to _itemCount.
--   * endpoint       — does it filter to stale users server-side, or return the
--                      whole directory? If the latter, _itemCount is the whole
--                      directory and is NOT a stale-account count.
--   * extracted_properties — what the last real run actually wrote.
-- ════════════════════════════════════════════════════════════════════════════

SELECT key, label, status, method, endpoint, select_params, filter_params,
       properties, mapping, severity_rules
FROM monitor_checks
WHERE key = 'identity:stale-accounts';

SELECT p.status, p.collected_at, p.item_count, p.error_message, p.extracted_properties
FROM tenant_monitor_profiles p
JOIN msp_customers c ON c.tenant_id = p.tenant_id
WHERE c.id = 4 AND p.check_key = 'identity:stale-accounts'
ORDER BY p.collected_at DESC
LIMIT 5;

-- Catalog-wide version of the same trap: every check whose mapping names a
-- transform the executor does NOT implement. Each of these silently reports
-- _itemCount under a label that means something narrower.
SELECT c.key,
       m->>'sourceField'  AS source_field,
       m->>'targetField'  AS target_field,
       m->>'transform'    AS transform
FROM monitor_checks c, jsonb_array_elements(c.mapping) AS m
WHERE c.status = 'active'
  AND COALESCE(m->>'transform', 'none') NOT IN (
    'none', 'count', 'exists', 'first', 'join', 'countTruthy', 'countFalse',
    'groupByCount', 'countDuplicates'
  )
  AND m->>'transform' !~ '^countEquals\(.*\)$'
  AND m->>'transform' !~ '^countIfLastSignInOlderThan\(\s*\d+\s*\)$'
ORDER BY c.key;

-- ════════════════════════════════════════════════════════════════════════════
-- PART E — OPTIONAL correction, COMMENTED OUT. Only run after reading Part D.
--
-- If Part D shows `identity:stale-accounts` has no numeric mapping field (so the
-- UI is showing _itemCount = the whole user list), this gives it a real one. The
-- executor implements `countIfLastSignInOlderThan(N)`: it counts LICENSED users
-- (sourceField must be the assigned-licence array, which it tests for
-- non-emptiness) whose signInActivity.lastSignInDateTime is older than N days,
-- treating never-signed-in as stale. It REQUIRES signInActivity to be selected on
-- the endpoint — without it the executor logs a warning and every user counts as
-- stale, which would be a new wrong number rather than a fix.
--
-- 90 days is the stale threshold assumed below. Change it if Shane's definition
-- differs — it is a policy choice, not something derivable from the data.
--
-- Do NOT run blind: confirm from Part D's `endpoint` output whether
-- $select already includes signInActivity, and adjust the endpoint statement
-- accordingly (Graph requires the AAD Premium licence for signInActivity, so if
-- the tenant lacks it this check will license-gap rather than return numbers).
--
-- BEGIN;
--
-- UPDATE monitor_checks
-- SET endpoint = '/users?$select=id,userPrincipalName,assignedLicenses,signInActivity&$top=999'
-- WHERE key = 'identity:stale-accounts';
--
-- UPDATE monitor_checks
-- SET mapping = '[{"sourceField":"assignedLicenses","targetField":"staleAccountCount","transform":"countIfLastSignInOlderThan(90)"}]'::jsonb
-- WHERE key = 'identity:stale-accounts';
--
-- -- Receipt before COMMIT:
-- SELECT key, endpoint, mapping FROM monitor_checks WHERE key = 'identity:stale-accounts';
--
-- COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
-- PART F — `cost:unused-unassigned-licenses` is misnamed. READ THIS.
--
-- Label:    "Unused/Unassigned License Count"
-- Endpoint: /subscribedSkus
-- Mapping:  count(consumedUnits) -> unusedLicenseCount
--
-- `count` counts ITEMS WHERE THE FIELD IS NON-NULL. Every subscribed SKU has a
-- consumedUnits value, so `unusedLicenseCount` is simply the number of SKUs the
-- tenant subscribes to — the observed 4. It has never been a count of unused
-- licences, and it goes UP when the tenant buys a new product, which is the
-- opposite of the direction the name implies.
--
-- The Cost Engine no longer reads this field (it computes seats from the raw
-- page instead), so the dashboard is now correct regardless. But the field is
-- still wrong wherever else it is consumed. Run this to find out where:
-- ════════════════════════════════════════════════════════════════════════════

-- Severity rules on the check itself (would fire on "number of SKUs").
SELECT key, severity_rules
FROM monitor_checks
WHERE key = 'cost:unused-unassigned-licenses';

-- Signal rules reading the field or the check (platform + per-MSP).
SELECT id, msp_id, signal_key, rule_type, source_key, operator, compare_value
FROM signal_derivation_rules
WHERE source_key ILIKE '%unusedLicense%'
   OR source_key ILIKE '%unused-unassigned%'
ORDER BY msp_id NULLS FIRST, signal_key;

-- NO CORRECTION IS PROPOSED HERE, deliberately. The right value —
-- SUM(prepaidUnits.enabled - consumedUnits) — is not expressible with any
-- transform monitor-executor.ts implements today (count / exists / first / join
-- / countTruthy / countFalse / countEquals / countIfLastSignInOlderThan /
-- groupByCount / countDuplicates). Making this check honest needs a new executor
-- transform, which is a code change to scope separately — not a SQL edit that
-- would swap one wrong number for another. Options, for that separate task:
--   (a) add a `sumDifference(a,b)` / `sumUnusedSeats` transform, then remap; or
--   (b) rename the check + field to what it really measures
--       (subscribedSkuCount), and let the Cost Engine remain the sole source of
--       the real waste figure.

-- ============================================================================
-- POST-RUN VERIFICATION
--   1. Re-run the scan:  POST /api/msp/customers/4/diagnostics/run
--   2. Cost: GET /api/portal/assessment/status → stats.licenseWaste should be
--      non-null, with `sourceCheckKey` naming the check it was priced from, and
--      its monthlyCents must MATCH Part A3's expected_monthly_waste_dollars. If
--      A3 returns 0 unused seats, a null figure is the CORRECT result and the
--      panel should read as "no waste identified", not as a broken chain.
--   3. Heatmap: POST /api/dashboard/resolve with the 26 heatmap metric keys —
--      every dark cell now carries a reason ('unknown_check_key' vs 'no_data'),
--      and every populated cell carries meta.valueSource naming the exact
--      extractedProperties field the number came from.
-- ============================================================================

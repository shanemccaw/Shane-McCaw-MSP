-- ============================================================================
-- War Room Welcome-screen pillar stats — audit (#333, epic #302)
-- READ-ONLY. No corrections proposed. Manual — run by hand, not drizzle-kit.
-- ============================================================================
--
-- Shane's screenshot showed two real-looking but wrong numbers on the seven
-- completed-scan pillar cards, plus uncertainty about the seven scores. One of
-- the three has been diagnosed and FIXED IN CODE; the other two live entirely in
-- database-resident configuration and could not be read from the Claude Code
-- session (no DATABASE_URL there, per CLAUDE.md). This file is those two,
-- written out rather than guessed at.
--
-- Replace 4 with the real customer id (tenants.id) if the tenant under test
-- changes. 4 is the id the 2026-07-26 cost-waste audit used.
--
--
-- ── 1. LICENSING — DIAGNOSED AND FIXED IN CODE, receipt below ───────────────
--
-- Reported: "1,020,000 seats provisioned" / "1,019,995 paid, unassigned".
--
-- ROOT CAUSE (reproduced by executing the real, unchanged
-- `unusedSeatsFromSubscribedSkus` over a real-shaped Graph page — see
-- license-waste-paid-seats.test.ts, first test): `totalEnabledSeats` summed
-- `prepaidUnits.enabled` across EVERY subscribed SKU. Microsoft returns free /
-- viral / self-service SKUs through the same `/subscribedSkus` shape as
-- purchased ones, with `prepaidUnits.enabled` carrying a sentinel CAPACITY
-- rather than a bought quantity — 1,000,000 for POWER_BI_STANDARD, 10,000 for
-- FLOW_FREE and the viral trial SKUs. Three such SKUs with five real users
-- total exactly 1,020,000 provisioned and 1,019,995 unassigned.
--
-- The corroborating tell was already on the card: ANNUAL WASTE RENDERED BLANK
-- next to a million unassigned seats, because the dollar figure has always been
-- priced-estate-only and those SKUs have no `sku_price_reference` row. Two of
-- the three licensing stats were describing an estate the third refused to
-- price.
--
-- FIX: `resolvePaidSeatFigures` (license-waste-source.ts) restricts both counts
-- to SKUs with a known, NON-ZERO monthly price — the same authority the dollar
-- figure already uses, rather than a capacity heuristic. A zero-priced row is
-- excluded too, or a free SKU with a $0 row would walk straight back in.
--
-- A1 — the receipt. Run BEFORE looking at the page so the two can be compared
-- rather than believed. `paid_*` are what the card should now show; `all_*` are
-- what it showed before. Latest /subscribedSkus page only.
WITH latest AS (
  SELECT p.raw_response
  FROM tenant_monitor_profiles p
  JOIN tenants c        ON c.tenant_id = p.tenant_id
  JOIN monitor_checks mc ON mc.key = p.check_key
  WHERE c.id = 4
    AND mc.status = 'active'
    AND lower(mc.endpoint) LIKE '%subscribedskus%'
  ORDER BY p.collected_at DESC
  LIMIT 1
), skus AS (
  SELECT s->>'skuPartNumber'                          AS sku_part_number,
         (s->'prepaidUnits'->>'enabled')::int         AS seats_bought,
         (s->>'consumedUnits')::int                   AS seats_assigned,
         GREATEST(0, (s->'prepaidUnits'->>'enabled')::int - (s->>'consumedUnits')::int) AS seats_unused,
         spr.monthly_price_cents
  FROM latest l, jsonb_array_elements(l.raw_response->'value') AS s
  LEFT JOIN sku_price_reference spr ON spr.sku_part_number = s->>'skuPartNumber'
)
SELECT SUM(seats_bought)                                                  AS all_provisioned_before_fix,
       SUM(seats_unused)                                                  AS all_unassigned_before_fix,
       SUM(seats_bought)  FILTER (WHERE COALESCE(monthly_price_cents,0) > 0) AS paid_provisioned_after_fix,
       SUM(seats_unused)  FILTER (WHERE COALESCE(monthly_price_cents,0) > 0) AS paid_unassigned_after_fix,
       COUNT(*)           FILTER (WHERE COALESCE(monthly_price_cents,0) = 0) AS skus_excluded_as_unpaid
FROM skus;

-- A2 — the per-SKU split, so the exclusions are named rather than trusted.
-- Every row marked EXCLUDED should be a genuinely free/viral SKU. If a REAL
-- purchased SKU appears here, its sku_price_reference row is missing and that
-- is the thing to fix — the fix would otherwise under-report the paid estate.
WITH latest AS (
  SELECT p.raw_response
  FROM tenant_monitor_profiles p
  JOIN tenants c        ON c.tenant_id = p.tenant_id
  JOIN monitor_checks mc ON mc.key = p.check_key
  WHERE c.id = 4
    AND mc.status = 'active'
    AND lower(mc.endpoint) LIKE '%subscribedskus%'
  ORDER BY p.collected_at DESC
  LIMIT 1
)
SELECT s->>'skuPartNumber'                     AS sku_part_number,
       (s->'prepaidUnits'->>'enabled')::int    AS seats_bought,
       (s->>'consumedUnits')::int              AS seats_assigned,
       spr.monthly_price_cents,
       CASE WHEN COALESCE(spr.monthly_price_cents, 0) > 0
            THEN 'COUNTED (paid)'
            ELSE 'EXCLUDED (no price on file, or priced 0)' END AS after_fix
FROM latest l, jsonb_array_elements(l.raw_response->'value') AS s
LEFT JOIN sku_price_reference spr ON spr.sku_part_number = s->>'skuPartNumber'
ORDER BY (s->'prepaidUnits'->>'enabled')::int DESC;


-- ── 2. SECURITY — "14 global administrators". NOT diagnosed. Read this. ─────
--
-- The card's number is `identity.globalAdminCount` -> sourceKey
-- `identity:global-admin-count`, resolved by dashboard-resolvers.ts's
-- `monitorScalarForTenant`, which takes, in order:
--     1. the mapping targetField whose NAME best matches the metric
--        (pickMappedValueField), else
--     2. `_itemCount` — literally `items.length`, the number of rows the
--        check's endpoint returned (monitor-executor.ts).
--
-- Both of those are DATABASE-RESIDENT (monitor_checks.endpoint / .mapping), so
-- what "14" counts cannot be determined from the repo. NO FIX WAS APPLIED, and
-- no guess is recorded here as if it were a finding.
--
-- This is the identical trap Part D of the 2026-07-26 audit documented for
-- `identity:stale-accounts`: when a check's endpoint returns a BROAD list rather
-- than the filtered subset its key names, `_itemCount` is the broad list, and it
-- is then rendered under the narrow caption. A leading hypothesis worth
-- disproving first: if the endpoint is `/directoryRoles` (the tenant's ACTIVATED
-- directory roles) rather than the Global Administrator role's members, then 14
-- is a very ordinary activated-role count and nothing to do with admins.
--
-- B1 — what the check really is. Read `endpoint` and `mapping` together.
-- Implemented transforms (monitor-executor.ts): count, exists, first, join,
-- countTruthy, countFalse, countEquals('x'), countIfLastSignInOlderThan(N),
-- groupByCount, countDuplicates. ANYTHING ELSE falls through to a raw array,
-- which is not a number, so the resolver drops to _itemCount.
SELECT key, label, status, method, endpoint, select_params, filter_params,
       properties, mapping, severity_rules
FROM monitor_checks
WHERE key = 'identity:global-admin-count';

-- B2 — what the last runs actually stored. If `extracted_properties` has NO
-- numeric field of its own, the 14 on screen is `item_count` and B1's endpoint
-- is the whole answer.
SELECT p.status, p.collected_at, p.item_count, p.error_message, p.extracted_properties
FROM tenant_monitor_profiles p
JOIN tenants c ON c.tenant_id = p.tenant_id
WHERE c.id = 4 AND p.check_key = 'identity:global-admin-count'
ORDER BY p.collected_at DESC
LIMIT 5;

-- B3 — why the security card showed ONLY this stat. The other three should each
-- report a real reason (no row at all / not in the scan package / license gap),
-- not silence. All four metrics the card asks for, in render order.
SELECT c.key,
       c.status                       AS check_status,
       c.endpoint,
       (pc.check_key IS NOT NULL)     AS in_security_baseline_package,
       p.status                       AS last_run_status,
       p.collected_at,
       p.item_count,
       p.extracted_properties
FROM monitor_checks c
LEFT JOIN monitoring_package_checks pc
       ON pc.check_key = c.key AND pc.package_key = 'core:security-baseline'
LEFT JOIN LATERAL (
  SELECT tp.status, tp.collected_at, tp.item_count, tp.extracted_properties
  FROM tenant_monitor_profiles tp
  JOIN tenants mc ON mc.tenant_id = tp.tenant_id
  WHERE mc.id = 4 AND tp.check_key = c.key
  ORDER BY tp.collected_at DESC
  LIMIT 1
) p ON TRUE
WHERE c.key IN (
  'identity:mfa-registration',      -- security.mfaRegistered
  'identity:global-admin-count',    -- security.globalAdmins      <- the 14
  'identity:legacy-auth-usage',     -- security.legacyAuth
  'copilot:overshare-exposure'      -- security.blastRadius
)
ORDER BY c.key;

-- B4 — catalog-wide version of the same trap, so the answer is not re-derived
-- one check at a time next time. Every ACTIVE check that can only ever report
-- `_itemCount`, because its mapping declares no field the executor implements.
-- Any War Room / dashboard stat sourced from one of these is showing a raw row
-- count under whatever caption the registry gave it.
SELECT c.key, c.endpoint, c.mapping
FROM monitor_checks c
WHERE c.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(c.mapping) = 'array' THEN c.mapping ELSE '[]'::jsonb END
         ) AS m
    WHERE COALESCE(m->>'transform', 'none') IN (
            'none', 'count', 'exists', 'first', 'join', 'countTruthy',
            'countFalse', 'groupByCount', 'countDuplicates'
          )
       OR m->>'transform' ~ '^countEquals\(.*\)$'
       OR m->>'transform' ~ '^countIfLastSignInOlderThan\(\s*\d+\s*\)$'
  )
ORDER BY c.key;


-- ── 3. THE SEVEN SCORES — are 19/24/31/28/41/22/24 right? ───────────────────
--
-- The formula was read and is structurally sound; it is NOT a War Room formula.
-- computePillarDisplayScore (health-display.ts) is:
--
--     display = 100 - (pillar_raw_risk / theoretical_max) * 100
--
-- where theoretical_max sums each EVALUABLE signal's impact on that pillar (a
-- rule no check can feed is excluded from the denominator, so it cannot dilute
-- the score), and pillar_raw_risk sums the same field over the signals that
-- actually FIRED. Checked while investigating, and all clean:
--   * a missing profile key does NOT fire a rule — profile_key_gt/lt coerce an
--     absent key to NaN and bail, profile_key_falsy guards `in` explicitly, and
--     `threshold` reads an absent itemCount as 0. So sparse scan data does not
--     silently inflate risk.
--   * numerator and denominator are drawn from the same impacts map, so there is
--     no fired-but-undenominated asymmetry.
--
-- So a score of 19 is not arithmetically broken — it is the honest statement
-- that ~81% of the pillar's evaluable risk weight fired. WHETHER THAT IS TRUE
-- of this tenant is a data question, and this is it: C1 lists what actually
-- fired, C2 recomputes each pillar's fraction from the same two sums the engine
-- uses, so the seven numbers can be checked against their own inputs.
--
-- C1 — the signals that fired on the latest health snapshot, with their weights.
SELECT s.captured_at,
       s.score        AS raw_engine_score,
       sig            AS fired_signal_key,
       r.governance_impact, r.security_impact, r.compliance_impact,
       r.adoption_impact, r.copilot_impact, r.architecture_impact, r.licensing_impact
FROM (
  SELECT * FROM tenant_engine_snapshots
  WHERE customer_id = 4 AND engine_key = 'health'
  ORDER BY captured_at DESC LIMIT 1
) s
CROSS JOIN LATERAL jsonb_array_elements_text(s.raw_signals) AS sig
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (signal_key)
         signal_key, governance_impact, security_impact, compliance_impact,
         adoption_impact, copilot_impact, architecture_impact, licensing_impact
  FROM signal_derivation_rules
  WHERE signal_key = sig AND msp_id IS NULL
) r ON TRUE
ORDER BY sig;

-- C2 — each pillar's raw risk straight out of the snapshot breakdown, next to
-- the pillar score the card rendered. `share_of_max` is the fraction the display
-- score is 100 minus; if a pillar's raw risk looks right but the score does not,
-- the denominator (theoretical_max) is where to look next, and it is a function
-- of which rules are currently EVALUABLE — i.e. of the check catalog, not of the
-- tenant. NB: the War Room's "health" card is the engine's `architecture`
-- pillar; every other key maps 1:1.
SELECT b->>'pillar'                          AS engine_pillar,
       (b->>'score')::numeric                AS pillar_raw_risk,
       s.captured_at
FROM (
  SELECT breakdown, captured_at FROM tenant_engine_snapshots
  WHERE customer_id = 4 AND engine_key = 'health'
  ORDER BY captured_at DESC LIMIT 1
) s, jsonb_array_elements(s.breakdown) AS b
ORDER BY (b->>'score')::numeric DESC;

-- C3 — the denominator's inputs: every platform rule, whether a real check can
-- feed it, and its per-pillar weight. A rule that is fed but whose weight is
-- wildly out of proportion is the usual reason one pillar reads far worse than
-- an operator expects.
SELECT r.signal_key, r.rule_type, r.source_key,
       (mc.key IS NOT NULL) AS source_key_is_a_real_check_key,
       r.governance_impact, r.security_impact, r.compliance_impact,
       r.adoption_impact, r.copilot_impact, r.architecture_impact, r.licensing_impact
FROM signal_derivation_rules r
LEFT JOIN monitor_checks mc ON mc.key = r.source_key
WHERE r.msp_id IS NULL
ORDER BY r.signal_key, r.source_key;

-- ============================================================================
-- POST-RUN
--   1. Licensing: reload /war-room after a scan. The two counts must equal A1's
--      paid_* columns. If annual waste is still blank while paid_unassigned > 0,
--      that is a sku_price_reference gap (A2 names the SKUs), not this fix.
--   2. Security: B1+B2 decide it. If `_itemCount` is the value and B1's endpoint
--      is not the Global Administrator role's members, the correction is to the
--      CHECK (endpoint and/or mapping), not to the War Room — and it needs a
--      separate issue, since changing a check changes every consumer of it.
--   3. Scores: C1-C3 together answer "is 19 right" from the tenant's own data.
-- ============================================================================

-- Git #555 — per-finding point-impact reconciliation for one tenant.
--
-- DIAGNOSTIC ONLY. Pure SELECT, no DDL/DML, therefore deliberately NOT
-- self-marking in simulator_migration_runs (CLAUDE.md's tracked-set exemption).
--
-- WHY THIS FILE EXISTS. #555 asks for live verification against tenant
-- c4c814d4-3afe-441e-9145-62461d0a4fd3 (score 53, Gate 82, 29 points needed).
-- There is no DATABASE_URL and no Graph credential in the environment this was
-- written in, so it was NOT run here and no number below is claimed as observed.
-- This is the query to run to check the platform's arithmetic against live data.
--
-- WHAT THE CODE COMPUTES, so you can see what these queries are checking:
--
--   points(finding) = impact(its signal) / theoreticalMax(copilot) * 100
--   theoreticalMax  = SUM over the tenant's EVALUABLE signals of
--                     MAX(copilot_impact) across that signal's rules and groups
--   rawScore        = the same sum over the signals that actually FIRED
--   displayScore    = round(100 - rawScore / theoreticalMax * 100)   <- the Gate score
--
-- Two identities must hold, and they are what to check:
--   (A) SUM of every per-finding point value  ==  100 - displayScore
--   (B) the fixes needed to clear the Gate must sum to at least
--       (82 - displayScore) = 29 points for this tenant.
--
-- ── LIMITS OF SQL HERE, STATED RATHER THAN GLOSSED ───────────────────────────
-- Two inputs genuinely do not exist in the database and cannot be recovered by
-- any query, so Q2/Q3 below reproduce the DENOMINATOR only:
--   • WHICH SIGNALS FIRED is computed in TypeScript (computeTenantSignals
--     evaluates every rule against the merged profile, with AND/OR group logic
--     and the disabled-signal filter). It is not a stored column.
--   • Evaluability additionally includes the runtime license-gap profile flags
--     (hasAADP1orP2 / hasDefender, stamped by executeMonitorCheck, never by any
--     mapping) and the bridged legacy keys — neither is derivable from
--     monitor_checks alone.
-- So the authoritative live check is Q4: regenerate the document and read the
-- engine's own log line, which prints every figure the code actually used.
--
-- Set the tenant once:
--   \set tenant_id '''c4c814d4-3afe-441e-9145-62461d0a4fd3'''


-- ── Q1. The tenant, and the packages its scans have named ────────────────────
-- fetchScannedCheckKeys unions msp_diagnostic_runs.package_key across ALL runs
-- (deliberately, #413) — this is the scope the denominator is measured over.

SELECT
  t.id                              AS customer_id,
  t.tenant_id,
  count(DISTINCT r.package_key)     AS distinct_packages,
  string_agg(DISTINCT r.package_key, ', ' ORDER BY r.package_key) AS package_keys,
  count(r.id)                       AS total_runs
FROM tenants t
LEFT JOIN msp_diagnostic_runs r ON r.customer_id = t.id
WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
GROUP BY t.id, t.tenant_id;


-- ── Q2. The Copilot denominator (theoreticalMax) this tenant is scored against ──
-- Mirrors ruleIsFedByPackage's real per-ruleType resolution:
--   threshold        -> source_key IS a check key
--   profile_key_*    -> source_key is a mapping targetField, a raw-property
--                       extraction (<prop>_count/_first/_values), the synthetic
--                       <checkKey>__itemCount, or the bare check key
--   findings_keyword -> the keyword appears inside a covered check key
-- Per-signal value is the MAX across its rules (getSignalHealthImpacts's rule),
-- so a signal with five rules repeating the same weight counts once.

WITH scanned_checks AS (
  SELECT DISTINCT mpc.check_key
  FROM tenants t
  JOIN msp_diagnostic_runs r          ON r.customer_id = t.id
  JOIN monitoring_package_checks mpc  ON mpc.package_key = r.package_key
  WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
),
check_defs AS (
  SELECT mc.key, mc.mapping, mc.properties
  FROM monitor_checks mc
  JOIN scanned_checks sc ON sc.check_key = mc.key
),
producible AS (
  SELECT key AS produced_by, key AS profile_key FROM check_defs
  UNION
  SELECT key, key || '__itemCount' FROM check_defs
  UNION
  SELECT cd.key, m ->> 'targetField'
  FROM check_defs cd, jsonb_array_elements(COALESCE(cd.mapping, '[]'::jsonb)) m
  WHERE m ->> 'targetField' IS NOT NULL
  UNION
  SELECT cd.key, p || sfx
  FROM check_defs cd,
       unnest(COALESCE(cd.properties, ARRAY[]::text[])) p,
       unnest(ARRAY['_count', '_first', '_values']) sfx
),
fed_rules AS (
  SELECT sdr.signal_key, sdr.copilot_impact
  FROM signal_derivation_rules sdr
  WHERE (sdr.rule_type = 'threshold'      AND sdr.source_key IN (SELECT check_key FROM scanned_checks))
     OR (sdr.rule_type = 'findings_keyword' AND EXISTS (
           SELECT 1 FROM scanned_checks sc WHERE lower(sc.check_key) LIKE '%' || lower(sdr.source_key) || '%'))
     OR (sdr.rule_type NOT IN ('threshold', 'findings_keyword')
           AND sdr.source_key IN (SELECT profile_key FROM producible))
),
per_signal AS (
  SELECT signal_key, max(copilot_impact) AS impact
  FROM fed_rules
  GROUP BY signal_key
)
SELECT
  count(*)                                          AS evaluable_copilot_signals_all,
  count(*) FILTER (WHERE impact > 0)                AS evaluable_copilot_signals_positive,
  sum(impact)                                       AS theoretical_max_copilot,
  -- What the score would be for a given rawScore. Substitute the raw score the
  -- engine reports (Q4) to confirm it produces the 53 the Gate shows.
  round(100 - (121.0 / NULLIF(sum(impact), 0)) * 100) AS score_if_rawscore_121
FROM per_signal;


-- ── Q3. Per-check point value, the number the document will cite ─────────────
-- points = impact / theoreticalMax * 100, one row per check that owns at least
-- one Copilot-impacting signal. A check here is worth these points ONLY IF its
-- signal is currently firing; a non-firing signal is a real, measured 0.0 in the
-- document (Q4 is what tells you which is which).
--
-- Note this join is the SIMPLE one (source_key = check key, or a mapping
-- targetField) — the same two shapes the code's resolver uses for the vast
-- majority of rules, but not its full ruleType-aware form. Treat mismatches
-- against Q4 as SQL under-attribution, not as a code defect, and check the
-- code's own log line before concluding anything.

WITH scanned_checks AS (
  SELECT DISTINCT mpc.check_key
  FROM tenants t
  JOIN msp_diagnostic_runs r          ON r.customer_id = t.id
  JOIN monitoring_package_checks mpc  ON mpc.package_key = r.package_key
  WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
),
check_defs AS (
  SELECT mc.key, mc.mapping FROM monitor_checks mc JOIN scanned_checks sc ON sc.check_key = mc.key
),
owner AS (
  SELECT key AS check_key, key AS profile_key FROM check_defs
  UNION
  SELECT cd.key, m ->> 'targetField'
  FROM check_defs cd, jsonb_array_elements(COALESCE(cd.mapping, '[]'::jsonb)) m
  WHERE m ->> 'targetField' IS NOT NULL
),
per_signal AS (
  SELECT sdr.signal_key, o.check_key, max(sdr.copilot_impact) AS impact
  FROM signal_derivation_rules sdr
  JOIN owner o ON o.profile_key = sdr.source_key
  GROUP BY sdr.signal_key, o.check_key
),
denom AS (SELECT sum(impact) AS theoretical_max FROM (SELECT signal_key, max(impact) AS impact FROM per_signal GROUP BY signal_key) s)
SELECT
  ps.check_key,
  ps.signal_key,
  ps.impact                                                        AS raw_copilot_impact,
  round((ps.impact::numeric / NULLIF(d.theoretical_max, 0)) * 100, 1)       AS points_if_fixed,
  d.theoretical_max
FROM per_signal ps CROSS JOIN denom d
WHERE ps.impact > 0
ORDER BY points_if_fixed DESC, ps.check_key;


-- ── Q4. THE AUTHORITATIVE LIVE CHECK ─────────────────────────────────────────
-- Regenerate `copilot_readiness` (and `remediation_plan`) for this tenant from
-- the Document Generator IDE with "Force regenerate (skip reuse)" ticked (#548),
-- then read the engine's own structured log line. It prints every figure the
-- code actually used — no SQL approximation involved:
--
--   message = "finding-point-impact: resolved real per-finding point values (Git #555)"
--   meta: { customerId, score, theoreticalMax, totalRecoverablePoints,
--           findingsPriced, findingsUnattributed, pointsShown }
--
-- PASS CRITERIA:
--   score                  == the score the Gate shows (53)
--   totalRecoverablePoints == 100 - score  (47.0)
--   pointsShown            <= totalRecoverablePoints, and >= 29 if the document
--                             is to be able to lay out a real path to the Gate
--   findingsPriced         >  0            (0 means everything came back
--                                           NOT ATTRIBUTABLE — a resolution bug)
--
-- And in the generated document itself: every finding cites a specific value,
-- and the phrase "did not supply individual point values" — the #555 regression
-- — appears nowhere.

SELECT
  l.occurred_at,
  l.channel,
  l.level,
  l.message,
  l.meta
FROM platform_log_stream l
WHERE l.channel = 'engine.document-generator'
  AND l.message LIKE 'finding-point-impact:%'
ORDER BY l.occurred_at DESC
LIMIT 20;


-- ── Q5. The generated documents, newest first, to read the prose against ─────

SELECT
  d.id,
  d.doc_type,
  d.status,
  d.created_at,
  (d.html_content LIKE '%did not supply individual point values%') AS still_disclaims_555,
  length(d.html_content)                                           AS html_len
FROM insights_generated_documents d
JOIN tenants t ON t.id = d.msp_customer_id
WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  AND d.doc_type IN ('copilot_readiness', 'remediation_plan')
ORDER BY d.created_at DESC
LIMIT 10;

-- =============================================================================
-- Git #414 CORRECTION (2026-08-06) — per-pillar finding rank weight. READ-ONLY.
--
-- No DDL, no DML. Every statement below is a SELECT.
--
-- Companion to docs/2026-08-05-finding-rank-weights-414.sql, which is left
-- untouched as the record of what the original fix was verified against. That
-- file's Query 1 is what found the defect this one re-verifies the fix for:
-- `copilot_impact` is flat at 0 for every pillar except `copilot` itself, so
-- ranking all seven cards by that one column was a no-op for six of them —
-- Security included, the pillar the reported bug came from.
--
-- Ranking is now per-pillar: a finding is weighed in the impact column of the
-- card it is filed under (health-engine's PILLAR_FIELD, the same map
-- computePillarDisplayScore uses for the score printed beside it).
--
--     War Room card   engine pillar    ranking column
--     governance      governance       governance_impact
--     licensing       licensing        licensing_impact
--     adoption        adoption         adoption_impact
--     compliance      compliance       compliance_impact
--     health          architecture     architecture_impact
--     security        security         security_impact
--     copilot         copilot          copilot_impact
--
-- Test tenant: c4c814d4-3afe-441e-9145-62461d0a4fd3.
-- Substitute the real `tenants.id` for :customer_id in queries 3 and 4.
--
-- SAME CAVEAT as the original file's queries 3/4, restated because it still
-- applies: these join a finding's `check_key` to a rule's `source_key`
-- directly. That is exact for `threshold` rules but NOT for `profile_key_*`
-- rules, whose `source_key` is a merged-profile key that only a check's
-- `mapping` produces (#441). The application does that hop properly via
-- `resolveOwningCheckKey`. Read a NULL weight below as "this SQL could not
-- resolve it", never as "the app ranks it 0".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. THE DEFECT, AND THAT THE NEW COLUMN DOES NOT SHARE IT.
--
-- Re-runs the original Query 1's shape but puts each pillar's OWN column beside
-- copilot_impact, which is the comparison that decided the correction.
--
-- Expected: `distinct_copilot` = 1 for every pillar except copilot, while
-- `distinct_own_field` is comfortably > 1 for each. Any pillar where
-- `distinct_own_field` = 1 is a pillar this fix still cannot rank — it will
-- degrade to the check_key tiebreak, which is honest but is NOT the reported
-- bug being fixed for that pillar. Read this before trusting any headline.
-- -----------------------------------------------------------------------------
WITH per_pillar AS (
  SELECT
    COALESCE(NULLIF(r.pillar, ''), '(unset)') AS pillar_label,
    count(*)                                  AS rules,
    count(DISTINCT r.copilot_impact)          AS distinct_copilot,
    max(r.copilot_impact)                     AS max_copilot,
    count(DISTINCT CASE COALESCE(NULLIF(r.pillar, ''), '')
      WHEN 'security'     THEN r.security_impact
      WHEN 'governance'   THEN r.governance_impact
      WHEN 'compliance'   THEN r.compliance_impact
      WHEN 'adoption'     THEN r.adoption_impact
      WHEN 'copilot'      THEN r.copilot_impact
      WHEN 'architecture' THEN r.architecture_impact
      -- the live table labels this pillar `cost`; the engine calls it licensing
      WHEN 'cost'         THEN r.licensing_impact
      WHEN 'licensing'    THEN r.licensing_impact
    END)                                      AS distinct_own_field
  FROM signal_derivation_rules r
  GROUP BY 1
)
SELECT
  pillar_label,
  rules,
  distinct_copilot,
  max_copilot,
  distinct_own_field,
  CASE
    WHEN distinct_own_field > 1 THEN 'RANKS'
    ELSE 'CANNOT RANK - degrades to check_key order'
  END AS verdict
FROM per_pillar
ORDER BY rules DESC;


-- -----------------------------------------------------------------------------
-- 2. THE ISSUE'S OWN EXAMPLE, UNDER THE NEW RULE.
--
-- The two findings the bug was reported against, both real criticals on the
-- test tenant. Expected: ca-mfa-coverage's `security_impact` is strictly
-- GREATER than break-glass-health's, so Security's headline becomes the CA
-- finding. The `copilot_impact` column is shown alongside to make the reason
-- the original fix failed visible in the same result set - both should read 0.
--
-- `effective_*` mirrors getSignalHealthImpacts: the MAX across every rule AND
-- every group carrying that signal key. Reading the rule row alone would miss a
-- group-level weight and disagree with the score.
-- -----------------------------------------------------------------------------
SELECT
  r.signal_key,
  r.rule_type,
  r.source_key,
  GREATEST(
    COALESCE(max(r.security_impact) OVER (PARTITION BY r.signal_key), 0),
    COALESCE(max(g.security_impact) OVER (PARTITION BY r.signal_key), 0)
  ) AS effective_security_impact,
  GREATEST(
    COALESCE(max(r.copilot_impact) OVER (PARTITION BY r.signal_key), 0),
    COALESCE(max(g.copilot_impact) OVER (PARTITION BY r.signal_key), 0)
  ) AS effective_copilot_impact
FROM signal_derivation_rules r
LEFT JOIN signal_rule_groups g ON g.id = r.group_id
WHERE r.source_key IN (
        'identity:ca-mfa-coverage',
        'identity:break-glass-health',
        'identity:ca-policy-count'
      )
   OR r.source_key IN ('caPolicyCount', 'caMfaPolicyExists', 'breakGlassAccountsHealthy')
ORDER BY effective_security_impact DESC, r.signal_key;


-- -----------------------------------------------------------------------------
-- 3. THE REAL HEADLINE PER PILLAR — mirrors the original file's Query 3, but
--    weighs each finding in ITS OWN pillar's column instead of one global one.
--
-- `old_rank`      = shipped-before-#414 (severity, then check_key alphabetical)
-- `copilot_rank`  = what commit 6c648df4 actually produced (the no-op)
-- `new_rank`      = the corrected per-pillar ranking
--
-- A row where new_rank = 1 is that pillar's headline. The specific thing to
-- confirm: for the `security` pillar, the row at new_rank = 1 is a Conditional
-- Access finding, NOT `identity:break-glass-health` — and note that
-- copilot_rank = 1 should still be break-glass, which is the defect.
--
-- Pillar attribution here mirrors WAR_ROOM_PILLAR_CHECK_DOMAINS by check-key
-- domain. It covers the domains the reported bug involves; a check whose domain
-- is not listed falls to `(unclaimed)` and is reported rather than hidden.
-- -----------------------------------------------------------------------------
WITH latest_run AS (
  SELECT run_id
  FROM msp_diagnostic_findings
  WHERE customer_id = :customer_id
  ORDER BY created_at DESC
  LIMIT 1
),
signal_weight AS (
  SELECT
    r.source_key,
    max(GREATEST(COALESCE(r.security_impact, 0),     COALESCE(g.security_impact, 0)))     AS security_w,
    max(GREATEST(COALESCE(r.governance_impact, 0),   COALESCE(g.governance_impact, 0)))   AS governance_w,
    max(GREATEST(COALESCE(r.compliance_impact, 0),   COALESCE(g.compliance_impact, 0)))   AS compliance_w,
    max(GREATEST(COALESCE(r.adoption_impact, 0),     COALESCE(g.adoption_impact, 0)))     AS adoption_w,
    max(GREATEST(COALESCE(r.copilot_impact, 0),      COALESCE(g.copilot_impact, 0)))      AS copilot_w,
    max(GREATEST(COALESCE(r.architecture_impact, 0), COALESCE(g.architecture_impact, 0))) AS architecture_w,
    max(GREATEST(COALESCE(r.licensing_impact, 0),    COALESCE(g.licensing_impact, 0)))    AS licensing_w
  FROM signal_derivation_rules r
  LEFT JOIN signal_rule_groups g ON g.id = r.group_id
  GROUP BY r.source_key
),
findings AS (
  SELECT
    f.severity,
    f.check_key,
    f.title,
    CASE split_part(f.check_key, ':', 1)
      WHEN 'identity'   THEN 'security'
      WHEN 'security'   THEN 'security'
      WHEN 'appgov'     THEN 'security'
      WHEN 'purview'    THEN 'compliance'
      WHEN 'compliance' THEN 'compliance'
      WHEN 'sharepoint' THEN 'governance'
      WHEN 'onedrive'   THEN 'governance'
      WHEN 'teams'      THEN 'governance'
      WHEN 'cost'       THEN 'licensing'
      WHEN 'license'    THEN 'licensing'
      WHEN 'adoption'   THEN 'adoption'
      WHEN 'copilot'    THEN 'copilot'
      WHEN 'intune'     THEN 'architecture'
      WHEN 'devices'    THEN 'architecture'
      WHEN 'drift'      THEN 'architecture'
      ELSE '(unclaimed)'
    END AS pillar,
    w.*
  FROM msp_diagnostic_findings f
  JOIN latest_run lr ON lr.run_id = f.run_id
  LEFT JOIN signal_weight w ON w.source_key = f.check_key
  WHERE f.severity IN ('critical', 'warning')
)
SELECT
  pillar,
  severity,
  check_key,
  title,
  CASE pillar
    WHEN 'security'     THEN security_w
    WHEN 'governance'   THEN governance_w
    WHEN 'compliance'   THEN compliance_w
    WHEN 'adoption'     THEN adoption_w
    WHEN 'copilot'      THEN copilot_w
    WHEN 'architecture' THEN architecture_w
    WHEN 'licensing'    THEN licensing_w
  END AS own_pillar_weight,
  copilot_w AS copilot_weight,
  row_number() OVER (
    PARTITION BY pillar
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, check_key
  ) AS old_rank,
  row_number() OVER (
    PARTITION BY pillar
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
             COALESCE(copilot_w, 0) DESC,
             check_key
  ) AS copilot_rank,
  row_number() OVER (
    PARTITION BY pillar
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
             COALESCE(CASE pillar
               WHEN 'security'     THEN security_w
               WHEN 'governance'   THEN governance_w
               WHEN 'compliance'   THEN compliance_w
               WHEN 'adoption'     THEN adoption_w
               WHEN 'copilot'      THEN copilot_w
               WHEN 'architecture' THEN architecture_w
               WHEN 'licensing'    THEN licensing_w
             END, 0) DESC,
             check_key
  ) AS new_rank
FROM findings
ORDER BY pillar, new_rank;


-- -----------------------------------------------------------------------------
-- 4. COVERAGE OF THE JOIN — mirrors the original file's Query 4.
--
-- A finding whose check feeds no rule ranks 0 and sorts last within its tier.
-- That is honest, but a large `unranked` count means the ranking is doing less
-- work than it appears to. `own_field_zero` is the NEW thing worth watching:
-- findings that DID resolve to a rule but whose own pillar column is 0 anyway —
-- those tie with the unranked ones and are the population that would make this
-- correction as ineffective as the thing it corrects.
--
-- Same source_key caveat as query 3: this undercounts `profile_key_*` rules.
-- -----------------------------------------------------------------------------
WITH latest_run AS (
  SELECT run_id
  FROM msp_diagnostic_findings
  WHERE customer_id = :customer_id
  ORDER BY created_at DESC
  LIMIT 1
),
signal_weight AS (
  SELECT
    source_key,
    max(security_impact)     AS security_w,
    max(governance_impact)   AS governance_w,
    max(compliance_impact)   AS compliance_w,
    max(adoption_impact)     AS adoption_w,
    max(copilot_impact)      AS copilot_w,
    max(architecture_impact) AS architecture_w,
    max(licensing_impact)    AS licensing_w
  FROM signal_derivation_rules
  GROUP BY source_key
)
SELECT
  split_part(f.check_key, ':', 1)                    AS check_domain,
  count(*)                                           AS findings,
  count(*) FILTER (WHERE w.source_key IS NOT NULL)   AS rank_resolved,
  count(*) FILTER (WHERE w.source_key IS NULL)       AS unranked,
  count(*) FILTER (
    WHERE w.source_key IS NOT NULL
      AND COALESCE(
        CASE split_part(f.check_key, ':', 1)
          WHEN 'identity'   THEN w.security_w
          WHEN 'security'   THEN w.security_w
          WHEN 'appgov'     THEN w.security_w
          WHEN 'purview'    THEN w.compliance_w
          WHEN 'compliance' THEN w.compliance_w
          WHEN 'sharepoint' THEN w.governance_w
          WHEN 'onedrive'   THEN w.governance_w
          WHEN 'teams'      THEN w.governance_w
          WHEN 'cost'       THEN w.licensing_w
          WHEN 'license'    THEN w.licensing_w
          WHEN 'adoption'   THEN w.adoption_w
          WHEN 'copilot'    THEN w.copilot_w
          WHEN 'intune'     THEN w.architecture_w
          WHEN 'devices'    THEN w.architecture_w
          WHEN 'drift'      THEN w.architecture_w
        END, 0) = 0
  )                                                  AS own_field_zero
FROM msp_diagnostic_findings f
JOIN latest_run lr ON lr.run_id = f.run_id
LEFT JOIN signal_weight w ON w.source_key = f.check_key
WHERE f.severity IN ('critical', 'warning')
GROUP BY 1
ORDER BY 1;

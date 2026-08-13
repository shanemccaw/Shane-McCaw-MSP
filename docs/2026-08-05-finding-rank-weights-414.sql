-- =============================================================================
-- Git #414 — verification queries for finding rank weights. READ-ONLY.
--
-- No DDL, no DML. Every statement below is a SELECT. Nothing here needs to run
-- for #414's code to work; these exist because the one thing the code cannot
-- prove about itself is a fact about database CONTENTS, and this environment
-- has no database access.
--
-- The question they settle: does `copilot_impact` genuinely VARY across the
-- rules feeding a pillar? The ranking added in #414 orders findings within a
-- severity tier by that column. If it is flat, every finding ties, the sort
-- falls through to the pre-existing check-key tiebreak, and the headline does
-- not change — the fix would be a silent no-op. The repo's own snapshot of the
-- rule table (docs/signals.json, exported 2026-08-05 14:02) has copilot_impact
-- at 0 or 1 for 193 of 198 rows, which is exactly that flat case; Shane
-- re-authored the weights directly in the database after that export, so the
-- snapshot is expected to be stale. Query 1 confirms it either way.
--
-- Test tenant: c4c814d4-3afe-441e-9145-62461d0a4fd3 (the tenant #413 used).
-- Substitute the real `tenants.id` for :customer_id in queries 3 and 4.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. THE DECIDING QUERY — does copilot_impact discriminate at all?
--
-- `distinct_weights` is the number that matters. If it is 1 for a pillar, that
-- pillar's findings all tie and #414 changes nothing there. Compare against
-- each pillar's own impact column beside it, which was the rejected
-- alternative, so the comparison is visible rather than argued.
-- -----------------------------------------------------------------------------
SELECT
  COALESCE(NULLIF(r.pillar, ''), '(unset)')              AS pillar,
  count(*)                                               AS rules,
  count(DISTINCT r.copilot_impact)                       AS distinct_copilot_weights,
  min(r.copilot_impact)                                  AS min_copilot,
  max(r.copilot_impact)                                  AS max_copilot,
  count(DISTINCT r.security_impact)                      AS distinct_security_weights,
  count(DISTINCT r.governance_impact)                    AS distinct_governance_weights,
  count(DISTINCT r.compliance_impact)                    AS distinct_compliance_weights,
  count(DISTINCT r.licensing_impact)                     AS distinct_licensing_weights,
  count(DISTINCT r.adoption_impact)                      AS distinct_adoption_weights,
  count(DISTINCT r.architecture_impact)                  AS distinct_architecture_weights
FROM signal_derivation_rules r
GROUP BY 1
ORDER BY 1;


-- -----------------------------------------------------------------------------
-- 2. THE ISSUE'S OWN EXAMPLE — the two findings that motivated #414.
--
-- Expected after the weight-research pass: ca-mfa-coverage's effective weight
-- is strictly GREATER than break-glass-health's. If they are equal, Security's
-- headline stays on break-glass (the check-key tiebreak) and the reported bug
-- is not fixed.
--
-- `effective_weight` mirrors `getSignalHealthImpacts` exactly: the MAX across
-- every rule AND every group carrying that signal key. Reading the rule row
-- alone would miss a group-level weight and disagree with the score.
-- -----------------------------------------------------------------------------
SELECT
  r.signal_key,
  r.rule_type,
  r.source_key,
  r.copilot_impact                                       AS rule_copilot_impact,
  g.copilot_impact                                       AS group_copilot_impact,
  GREATEST(
    COALESCE(max(r.copilot_impact) OVER (PARTITION BY r.signal_key), 0),
    COALESCE(max(g.copilot_impact) OVER (PARTITION BY r.signal_key), 0)
  )                                                      AS effective_weight,
  r.security_impact                                      AS rule_security_impact
FROM signal_derivation_rules r
LEFT JOIN signal_rule_groups g ON g.id = r.group_id
WHERE r.source_key IN (
        'identity:ca-mfa-coverage',
        'identity:break-glass-health',
        'identity:ca-policy-count'
      )
   OR r.source_key IN ('caPolicyCount', 'caMfaPolicyExists', 'breakGlassAccountsHealthy')
ORDER BY effective_weight DESC, r.signal_key;


-- -----------------------------------------------------------------------------
-- 3. THE REAL HEADLINE, BEFORE AND AFTER — run against the test tenant.
--
-- Reproduces what `fetchPillarFindings` + `compareRankedFindings` now do, for
-- the identity/security domain only (the pillar the issue names). `old_rank`
-- is the shipped-before behaviour (severity, then check key alphabetically);
-- `new_rank` is #414's. A row where old_rank = 1 and new_rank <> 1 is the
-- headline that changed.
--
-- NOTE this query approximates ONE hop that the application resolves properly:
-- it joins a finding's check_key to a rule's source_key directly, which is
-- exact for `threshold` rules but not for `profile_key_*` rules, whose
-- source_key is a merged-profile key that only a check's `mapping` produces
-- (#441). `resolveOwningCheckKey` does that hop in code. Treat a NULL weight
-- here as "this SQL could not resolve it", not as "the app ranks it 0".
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
    max(GREATEST(COALESCE(r.copilot_impact, 0), COALESCE(g.copilot_impact, 0))) AS weight
  FROM signal_derivation_rules r
  LEFT JOIN signal_rule_groups g ON g.id = r.group_id
  GROUP BY r.source_key
)
SELECT
  f.severity,
  f.check_key,
  f.title,
  w.weight,
  row_number() OVER (
    ORDER BY CASE f.severity WHEN 'critical' THEN 0 ELSE 1 END, f.check_key
  ) AS old_rank,
  row_number() OVER (
    ORDER BY CASE f.severity WHEN 'critical' THEN 0 ELSE 1 END,
             COALESCE(w.weight, 0) DESC,
             f.check_key
  ) AS new_rank
FROM msp_diagnostic_findings f
JOIN latest_run lr ON lr.run_id = f.run_id
LEFT JOIN signal_weight w ON w.source_key = f.check_key
WHERE f.severity IN ('critical', 'warning')
  AND split_part(f.check_key, ':', 1) IN ('identity', 'security', 'appgov')
ORDER BY new_rank;


-- -----------------------------------------------------------------------------
-- 4. COVERAGE OF THE JOIN — how many of this tenant's real findings rank at all.
--
-- A finding whose check feeds no rule gets weight 0 and sorts last within its
-- tier. That is honest (the platform genuinely has no weight for it) but if the
-- unranked count is large, the ranking is doing less work than it appears to
-- and is worth knowing about before trusting the headline.
--
-- Same source_key caveat as query 3: this undercounts `profile_key_*` rules.
-- -----------------------------------------------------------------------------
WITH latest_run AS (
  SELECT run_id
  FROM msp_diagnostic_findings
  WHERE customer_id = :customer_id
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  split_part(f.check_key, ':', 1)                                    AS check_domain,
  count(*)                                                           AS findings,
  count(*) FILTER (WHERE r.source_key IS NOT NULL)                   AS rank_resolved,
  count(*) FILTER (WHERE r.source_key IS NULL)                       AS unranked
FROM msp_diagnostic_findings f
JOIN latest_run lr ON lr.run_id = f.run_id
LEFT JOIN (SELECT DISTINCT source_key FROM signal_derivation_rules) r
       ON r.source_key = f.check_key
WHERE f.severity IN ('critical', 'warning')
GROUP BY 1
ORDER BY 1;

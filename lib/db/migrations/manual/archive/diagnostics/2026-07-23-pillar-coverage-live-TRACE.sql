-- ============================================================================
-- READ-ONLY DIAGNOSTIC — getPillarCoverage('core:enhanced-monitoring', 4)
-- exact live stage-by-stage trace. NOTHING here writes.
-- ============================================================================
-- WHY: radar.pillars is still [] live for customerId=4 (67 passing checks,
-- 46 real profile_key_* signal_derivation_rules) even after the verified
-- 744e2e0b linkage fix. This script replicates getPillarCoverage()'s pipeline
-- (pillar-coverage.ts) in SQL against the LIVE data, one stage per query, so a
-- single run of this file pinpoints exactly which stage kills the result:
--
--   Stage 1  package check keys        (monitoring_package_checks)
--   Stage 2  rules visible to the code (msp_id IS NULL filter!)  ← common trap
--   Stage 3  producible profile keys   (mapping targetFields + property keys +
--                                       __itemCount + bridged + license-gap flags)
--   Stage 4  rule↔package intersection (which rules are genuinely fed, and HOW)
--   Stage 5  per-pillar impacts on fed signals (all-zero impacts = no pillar)
--   Stage 6  theoreticalMax per pillar (display-layer null gate)
--   Stage 7  customer-4 run/tenant sanity (id spaces, license-gap rows)
--
-- INTERPRETATION (which of the two honest scenarios is real):
--   • Q4 returns ZERO fed rules            → genuine CURATION GAP: none of the
--     46 rules' source_keys match anything this package's checks produce. Q4b
--     lists every rule's source_key next to its nearest-miss producible keys so
--     the gap is concrete and fixable in the admin rules editor.
--   • Q4 returns fed rules but Q5 shows ALL-ZERO impacts on those signals
--     → also a CURATION GAP, of a second kind: the linkage works, but the
--     admin impact fields (governance_impact … licensing_impact) were never
--     set on those rules/groups, so no pillar can light up. Fix: set impacts
--     in the admin rules editor (the 2026-07-22 seeded migrations inserted
--     their rules with all impacts at the column default 0 — see Q5).
--   • Q4 has fed rules AND Q5 has nonzero impacts AND Q6 theoreticalMax > 0
--     for the same pillar → a REMAINING CODE BUG: SQL finds coverage the code
--     doesn't. Send me Q1–Q6's outputs and I'll trace the code divergence.
--   • Q2 shows the 46 rules carry msp_id values (not NULL) → CODE-VISIBLE-DATA
--     GAP: getPillarCoverage calls fetchSignalRulesAndGroups() with no mspId,
--     which selects ONLY msp_id IS NULL rows — MSP-scoped rules are invisible
--     to it. That's a real finding to bring back for a code decision.
--   • Also check api-server logs for
--       "GET /portal/assessment/status: pillar coverage computation failed"
--     — the endpoint .catch()es a thrown getPillarCoverage into [] (portal-
--     assessment.ts), so a live throw looks identical to honest-empty.
-- ============================================================================

-- ─── Q1. Package check keys (Stage 1) ────────────────────────────────────────
-- getPillarCoverage returns [] immediately if this is empty.
SELECT count(*) AS package_check_count
FROM monitoring_package_checks
WHERE package_key = 'core:enhanced-monitoring';

-- ─── Q2. The 46 rules as the CODE sees them (Stage 2) ────────────────────────
-- fetchSignalRulesAndGroups() (priority-engine.ts) with no mspId selects ONLY
-- msp_id IS NULL. If your earlier "46 rules" count had no msp_id filter and
-- this platform_visible count is much lower, that's the answer right here.
SELECT
  count(*)                                   AS total_rules,
  count(*) FILTER (WHERE msp_id IS NULL)     AS platform_visible_rules,
  count(*) FILTER (WHERE msp_id IS NOT NULL) AS msp_scoped_rules_invisible_to_coverage,
  count(*) FILTER (WHERE rule_type LIKE 'profile_key%' AND msp_id IS NULL) AS profile_key_rules_visible
FROM signal_derivation_rules;

-- ─── Q3. Producible profile keys, live (Stage 3) ─────────────────────────────
-- Mirrors buildProducibleProfileKeys() exactly: for every check in the package,
--   • the bare check key
--   • <checkKey>__itemCount
--   • every mapping[].targetField                 (monitor_checks.mapping jsonb)
--   • <prop>_count / _first / _values             (monitor_checks.properties)
--   • bridged legacy keys, gated on their producer check being in the package
--   • runtime license-gap flags hasAADP1orP2/hasDefender, gated on ≥1 Graph
--     (requires_customer_script = false) check   (added in this session's fix)
WITH pkg AS (
  SELECT mpc.check_key
  FROM monitoring_package_checks mpc
  WHERE mpc.package_key = 'core:enhanced-monitoring'
),
defs AS (
  SELECT c.key, c.mapping, c.properties, c.requires_customer_script
  FROM monitor_checks c
  JOIN pkg ON pkg.check_key = c.key
),
producible AS (
  SELECT check_key AS profile_key, 'bare check key' AS produced_via FROM pkg
  UNION
  SELECT check_key || '__itemCount', 'synthetic __itemCount' FROM pkg
  UNION
  SELECT m.elem->>'targetField', 'mapping targetField (' || d.key || ')'
  FROM defs d, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.mapping) = 'array' THEN d.mapping ELSE '[]'::jsonb END) AS m(elem)
  WHERE m.elem->>'targetField' IS NOT NULL
  UNION
  SELECT p.prop || suffix.s, 'property extraction (' || d.key || ')'
  FROM defs d,
       LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.properties) = 'array' THEN d.properties ELSE '[]'::jsonb END) AS p(prop),
       LATERAL (VALUES ('_count'), ('_first'), ('_values')) AS suffix(s)
  UNION
  SELECT b.k, 'bridged legacy key'
  FROM (VALUES
    ('conditionalAccessPolicyCount',   'identity:ca-policy-count'),
    ('conditionalAccessPoliciesCount', 'identity:ca-policy-count'),
    ('securityScore',                  'security:secure-score')
  ) AS b(k, producer)
  WHERE EXISTS (SELECT 1 FROM pkg WHERE pkg.check_key = b.producer)
  UNION
  SELECT f.k, 'runtime license-gap flag'
  FROM (VALUES ('hasAADP1orP2'), ('hasDefender')) AS f(k)
  WHERE EXISTS (SELECT 1 FROM defs WHERE requires_customer_script = false)
)
SELECT count(DISTINCT profile_key) AS producible_key_count FROM producible;

-- ─── Q4. THE intersection: which visible rules are genuinely fed (Stage 4) ───
-- Re-declares the same CTEs (each query in this file is standalone-runnable).
WITH pkg AS (
  SELECT mpc.check_key
  FROM monitoring_package_checks mpc
  WHERE mpc.package_key = 'core:enhanced-monitoring'
),
defs AS (
  SELECT c.key, c.mapping, c.properties, c.requires_customer_script
  FROM monitor_checks c
  JOIN pkg ON pkg.check_key = c.key
),
producible AS (
  SELECT check_key AS profile_key FROM pkg
  UNION SELECT check_key || '__itemCount' FROM pkg
  UNION SELECT m.elem->>'targetField'
        FROM defs d, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.mapping) = 'array' THEN d.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT p.prop || suffix.s
        FROM defs d,
             LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.properties) = 'array' THEN d.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'), ('_first'), ('_values')) AS suffix(s)
  UNION SELECT b.k
        FROM (VALUES
          ('conditionalAccessPolicyCount',   'identity:ca-policy-count'),
          ('conditionalAccessPoliciesCount', 'identity:ca-policy-count'),
          ('securityScore',                  'security:secure-score')
        ) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM pkg WHERE pkg.check_key = b.producer)
  UNION SELECT f.k
        FROM (VALUES ('hasAADP1orP2'), ('hasDefender')) AS f(k)
        WHERE EXISTS (SELECT 1 FROM defs WHERE requires_customer_script = false)
)
SELECT
  r.id, r.signal_key, r.rule_type, r.source_key,
  CASE
    WHEN r.rule_type = 'threshold'
      THEN CASE WHEN EXISTS (SELECT 1 FROM pkg WHERE check_key = r.source_key)
                THEN 'FED (check key in package)' ELSE 'not fed' END
    WHEN r.rule_type = 'findings_keyword'
      THEN CASE WHEN r.source_key <> '' AND EXISTS (
                  SELECT 1 FROM pkg WHERE check_key ILIKE '%' || r.source_key || '%')
                THEN 'FED (keyword in a check key)' ELSE 'not fed' END
    ELSE CASE WHEN EXISTS (SELECT 1 FROM producible WHERE profile_key = r.source_key)
              THEN 'FED (producible profile key)' ELSE 'not fed' END
  END AS fed
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
ORDER BY fed, r.signal_key, r.sort_order;

-- ─── Q4b. For every NOT-fed profile_key rule: nearest producible keys ────────
-- Concrete curation view: each unmatched source_key next to the closest real
-- producible keys (simple containment match), so adding coverage in the admin
-- rules editor is a lookup, not a guess. (Standalone; re-declares the CTEs.)
WITH pkg AS (
  SELECT mpc.check_key FROM monitoring_package_checks mpc
  WHERE mpc.package_key = 'core:enhanced-monitoring'
),
defs AS (
  SELECT c.key, c.mapping, c.properties, c.requires_customer_script
  FROM monitor_checks c JOIN pkg ON pkg.check_key = c.key
),
producible AS (
  SELECT check_key AS profile_key FROM pkg
  UNION SELECT check_key || '__itemCount' FROM pkg
  UNION SELECT m.elem->>'targetField'
        FROM defs d, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.mapping) = 'array' THEN d.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT p.prop || suffix.s
        FROM defs d,
             LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.properties) = 'array' THEN d.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'), ('_first'), ('_values')) AS suffix(s)
  UNION SELECT b.k
        FROM (VALUES
          ('conditionalAccessPolicyCount',   'identity:ca-policy-count'),
          ('conditionalAccessPoliciesCount', 'identity:ca-policy-count'),
          ('securityScore',                  'security:secure-score')
        ) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM pkg WHERE pkg.check_key = b.producer)
  UNION SELECT f.k
        FROM (VALUES ('hasAADP1orP2'), ('hasDefender')) AS f(k)
        WHERE EXISTS (SELECT 1 FROM defs WHERE requires_customer_script = false)
)
SELECT
  r.signal_key, r.rule_type, r.source_key,
  (SELECT string_agg(p.profile_key, ', ' ORDER BY p.profile_key)
   FROM producible p
   WHERE p.profile_key ILIKE '%' || r.source_key || '%'
      OR r.source_key ILIKE '%' || p.profile_key || '%') AS near_miss_producible_keys
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
  AND r.rule_type LIKE 'profile_key%'
  AND NOT EXISTS (SELECT 1 FROM producible p WHERE p.profile_key = r.source_key)
ORDER BY r.signal_key;

-- ─── Q5. Impacts on FED signals (Stage 5) ────────────────────────────────────
-- getSignalHealthImpacts takes the MAX per pillar across a signal's rules AND
-- groups. A fed signal with all-zero impacts contributes NO pillar — the
-- 2026-07-22 seeded migrations inserted rules with every *_impact at the
-- column default 0, so this is a live suspect. (Standalone; Q4's fed logic.)
WITH pkg AS (
  SELECT mpc.check_key FROM monitoring_package_checks mpc
  WHERE mpc.package_key = 'core:enhanced-monitoring'
),
defs AS (
  SELECT c.key, c.mapping, c.properties, c.requires_customer_script
  FROM monitor_checks c JOIN pkg ON pkg.check_key = c.key
),
producible AS (
  SELECT check_key AS profile_key FROM pkg
  UNION SELECT check_key || '__itemCount' FROM pkg
  UNION SELECT m.elem->>'targetField'
        FROM defs d, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.mapping) = 'array' THEN d.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT p.prop || suffix.s
        FROM defs d,
             LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.properties) = 'array' THEN d.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'), ('_first'), ('_values')) AS suffix(s)
  UNION SELECT b.k
        FROM (VALUES
          ('conditionalAccessPolicyCount',   'identity:ca-policy-count'),
          ('conditionalAccessPoliciesCount', 'identity:ca-policy-count'),
          ('securityScore',                  'security:secure-score')
        ) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM pkg WHERE pkg.check_key = b.producer)
  UNION SELECT f.k
        FROM (VALUES ('hasAADP1orP2'), ('hasDefender')) AS f(k)
        WHERE EXISTS (SELECT 1 FROM defs WHERE requires_customer_script = false)
),
fed_signals AS (
  SELECT DISTINCT r.signal_key
  FROM signal_derivation_rules r
  WHERE r.msp_id IS NULL
    AND (
      (r.rule_type = 'threshold' AND EXISTS (SELECT 1 FROM pkg WHERE check_key = r.source_key))
      OR (r.rule_type = 'findings_keyword' AND r.source_key <> ''
          AND EXISTS (SELECT 1 FROM pkg WHERE check_key ILIKE '%' || r.source_key || '%'))
      OR (r.rule_type NOT IN ('threshold','findings_keyword')
          AND EXISTS (SELECT 1 FROM producible p WHERE p.profile_key = r.source_key))
    )
)
SELECT
  fs.signal_key,
  GREATEST(COALESCE(max(r.governance_impact),0),  COALESCE(max(g.governance_impact),0))  AS governance,
  GREATEST(COALESCE(max(r.security_impact),0),    COALESCE(max(g.security_impact),0))    AS security,
  GREATEST(COALESCE(max(r.compliance_impact),0),  COALESCE(max(g.compliance_impact),0))  AS compliance,
  GREATEST(COALESCE(max(r.adoption_impact),0),    COALESCE(max(g.adoption_impact),0))    AS adoption,
  GREATEST(COALESCE(max(r.copilot_impact),0),     COALESCE(max(g.copilot_impact),0))     AS copilot,
  GREATEST(COALESCE(max(r.architecture_impact),0),COALESCE(max(g.architecture_impact),0)) AS architecture,
  GREATEST(COALESCE(max(r.licensing_impact),0),   COALESCE(max(g.licensing_impact),0))   AS licensing
FROM fed_signals fs
LEFT JOIN signal_derivation_rules r ON r.signal_key = fs.signal_key AND r.msp_id IS NULL
LEFT JOIN signal_rule_groups     g ON g.signal_key = fs.signal_key AND g.msp_id IS NULL
GROUP BY fs.signal_key
ORDER BY fs.signal_key;

-- ─── Q6. theoreticalMax per pillar, ALL signals (Stage 6) ────────────────────
-- computePillarDisplayScore returns null (pillar dropped) when the sum over
-- ALL signals' max impacts is 0 for that pillar — even a covered pillar.
WITH all_sources AS (
  SELECT signal_key, governance_impact, security_impact, compliance_impact, adoption_impact,
         copilot_impact, architecture_impact, licensing_impact
  FROM signal_derivation_rules WHERE msp_id IS NULL
  UNION ALL
  SELECT signal_key, governance_impact, security_impact, compliance_impact, adoption_impact,
         copilot_impact, architecture_impact, licensing_impact
  FROM signal_rule_groups WHERE msp_id IS NULL
),
per_signal AS (
  -- Mirrors getSignalHealthImpacts: MAX per pillar across a signal's rules+groups.
  SELECT signal_key,
         max(governance_impact)   AS governance,
         max(security_impact)     AS security,
         max(compliance_impact)   AS compliance,
         max(adoption_impact)     AS adoption,
         max(copilot_impact)      AS copilot,
         max(architecture_impact) AS architecture,
         max(licensing_impact)    AS licensing
  FROM all_sources
  GROUP BY signal_key
)
SELECT
  sum(governance)   AS governance_theoretical_max,
  sum(security)     AS security_theoretical_max,
  sum(compliance)   AS compliance_theoretical_max,
  sum(adoption)     AS adoption_theoretical_max,
  sum(copilot)      AS copilot_theoretical_max,
  sum(architecture) AS architecture_theoretical_max,
  sum(licensing)    AS licensing_theoretical_max
FROM per_signal;

-- ─── Q7. Customer-4 run/tenant sanity (Stage 7) ──────────────────────────────
-- Confirms the run the endpoint gates on really is this package + the doc-gate
-- coverage numbers clear 50% (portal-assessment.ts computes pillarCoverage ONLY
-- for a run whose graded coverage passes), and whether any license-gap rows
-- exist for the tenant (the runtime hasAADP1orP2/hasDefender producer).
SELECT run_id, package_key, status, checks_total, checks_ok, checks_error,
       checks_license_gap,
       round(100.0 * (checks_ok + checks_license_gap) / NULLIF(checks_total, 0)) AS coverage_pct
FROM msp_diagnostic_runs
WHERE customer_id = 4 AND status IN ('completed','partial')
ORDER BY created_at DESC
LIMIT 3;

SELECT tmp.check_key, tmp.status, tmp.extracted_properties
FROM tenant_monitor_profiles tmp
JOIN msp_customers mc ON mc.tenant_id = tmp.tenant_id
WHERE mc.id = 4 AND tmp.status = 'license_gap'
ORDER BY tmp.collected_at DESC
LIMIT 10;

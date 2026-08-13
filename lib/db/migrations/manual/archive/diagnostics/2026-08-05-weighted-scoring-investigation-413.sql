-- ============================================================================
-- Git #413 — WHY WEIGHTED SCORING PRODUCES ARTIFICIALLY FAVOURABLE RESULTS
-- READ-ONLY. Every statement below is a SELECT. NOTHING here writes.
-- ============================================================================
--
-- Investigation only — no fix is proposed or applied by this file.
--
-- WHAT THE REPO ALREADY PROVES (reconstructed this session by driving the REAL
-- exported functions — computeHealthEngine, computeSecurityEngine,
-- computePillarDisplayScore, computeOverallDisplayScore, buildProducibleProfileKeys,
-- ruleIsFedByPackage — over a corpus built with this repo's OWN weighting scheme
-- from 2026-07-23-close-signal-coverage-gaps.sql:478-516):
--
--   The customer-facing score is
--       displayScore = 100 − (rawScore / theoreticalMax) × 100
--   where
--       rawScore       = Σ pillar impact over the signals that FIRED for this tenant
--       theoreticalMax = Σ pillar impact over every EVALUABLE signal
--
--   and `evaluable` is resolved by fetchEvaluableSignalKeys (pillar-coverage.ts:290)
--   across the **ENTIRE monitor_checks catalog** — not the package this tenant was
--   actually scanned with. A tenant scanned with core:security-baseline (29 checks)
--   or assess:copilot-readiness (7 checks) is therefore scored against a denominator
--   built from ~122 checks' worth of signals. The reconstruction measured the
--   consequence:
--
--     • 0 Conditional Access policies + 14 Global Administrators, alone
--         → OVERALL 99 / 100  (security pillar 96)
--     • EVERY one of the 29 scanned checks broken
--         → OVERALL 76 — a hard FLOOR. The live path cannot report worse.
--     • EVERY one of the 7 copilot-readiness checks broken
--         → OVERALL 95 — the floor for that package.
--     • Same tenant, same findings, only the rule AUTHORING moved (3x weight on
--       unscanned vs scanned checks) → security pillar swings 84 ↔ 65.
--
--   With uniform weights the formula degenerates exactly to the count ratio:
--   100 − 29/122 × 100 = 76, matching the measured floor to the point.
--
--   NOTE getPillarCoverage (pillar-coverage.ts:414) passes the PACKAGE-scoped
--   `coveredSignalKeys` as the denominator instead, and bottoms out at 0 as it
--   should. Two callers of one formula, two different denominators.
--
-- WHAT THIS FILE IS FOR
--   The reconstruction had to MODEL two things it cannot read from the repo:
--   (a) the real impact values now in signal_derivation_rules / signal_rule_groups,
--   (b) which of the test tenant's checks actually fired.
--   These queries capture both from live data, so the reconstruction can be
--   re-run on real inputs and the conclusions confirmed or corrected.
--
--   Confirmed going in, per Shane, and NOT re-litigated here: every current
--   impact value is untrustworthy — ~92 real rows were manually flattened to 1
--   and one outlier hand-set to 300, both purely as symptom relief. Q1–Q3 record
--   that state as the BEFORE picture; they are not a claim that it is correct.
--
-- SHORTCUT: the denominator half of this is already on screen. The Simulator
-- Studio Pillar Matrix (GET /api/admin/signal-rules/pillar-matrix, backed by
-- pillar-matrix.ts) computes theoreticalMax with the IDENTICAL formula
-- computePillarDisplayScore uses, per pillar, with a `signalEvaluable` flag per
-- row. Q6 below reproduces it in SQL only so the numbers can be diffed.
--
-- Test tenant: c4c814d4-3afe-441e-9145-62461d0a4fd3
-- ============================================================================

-- ─── Q1. The corpus as it stands: impact census ──────────────────────────────
-- Confirms the flattening and locates the outlier. `platform_visible` is the
-- only slice the engine ever sees: fetchSignalRulesAndGroups (priority-engine.ts:117)
-- selects WHERE msp_id IS NULL when called with no mspId, which is how every
-- scoring caller calls it.
SELECT
  'signal_derivation_rules' AS source,
  count(*)                                   AS total_rows,
  count(*) FILTER (WHERE msp_id IS NULL)     AS platform_visible,
  count(*) FILTER (WHERE msp_id IS NOT NULL) AS msp_scoped_invisible_to_scoring,
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) = 0) AS all_impacts_zero,
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) = 1) AS max_impact_exactly_one,
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) > 1) AS max_impact_above_one
FROM signal_derivation_rules
UNION ALL
SELECT
  'signal_rule_groups',
  count(*),
  count(*) FILTER (WHERE msp_id IS NULL),
  count(*) FILTER (WHERE msp_id IS NOT NULL),
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) = 0),
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) = 1),
  count(*) FILTER (WHERE msp_id IS NULL AND GREATEST(governance_impact, security_impact,
      compliance_impact, adoption_impact, copilot_impact, architecture_impact,
      licensing_impact) > 1)
FROM signal_rule_groups;

-- ─── Q2. Every row whose max impact is not 1 — the outlier, named ────────────
-- Expect this to surface the hand-set 300. `description LIKE 'Auto-generated…'`
-- identifies rows written by PART B of 2026-07-23-close-signal-coverage-gaps.sql,
-- whose original scheme was dominant 60/45/30/20 by the check's worst severity
-- rule + 1-2 spillover — i.e. the "genuinely varied weights" this platform
-- already had, and the most likely provenance of the ~92 flattened rows.
SELECT
  'rule' AS kind, r.id, r.signal_key, r.rule_type, r.source_key, r.compare_value,
  r.pillar, r.severity,
  r.governance_impact, r.security_impact, r.compliance_impact, r.adoption_impact,
  r.copilot_impact, r.architecture_impact, r.licensing_impact,
  (r.description LIKE 'Auto-generated to close a signal-coverage gap:%') AS from_coverage_gap_generator,
  r.updated_at,
  GREATEST(r.governance_impact, r.security_impact, r.compliance_impact,
           r.adoption_impact, r.copilot_impact, r.architecture_impact,
           r.licensing_impact) AS max_impact
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
  AND GREATEST(r.governance_impact, r.security_impact, r.compliance_impact,
               r.adoption_impact, r.copilot_impact, r.architecture_impact,
               r.licensing_impact) <> 1
UNION ALL
SELECT
  'group', g.id, g.signal_key, g.logic, NULL::text, NULL::text, g.pillar, g.severity,
  g.governance_impact, g.security_impact, g.compliance_impact, g.adoption_impact,
  g.copilot_impact, g.architecture_impact, g.licensing_impact,
  FALSE, g.created_at,
  GREATEST(g.governance_impact, g.security_impact, g.compliance_impact,
           g.adoption_impact, g.copilot_impact, g.architecture_impact,
           g.licensing_impact)
FROM signal_rule_groups g
WHERE g.msp_id IS NULL
  AND GREATEST(g.governance_impact, g.security_impact, g.compliance_impact,
               g.adoption_impact, g.copilot_impact, g.architecture_impact,
               g.licensing_impact) <> 1
ORDER BY max_impact DESC, id;

-- ─── Q3. How much of the corpus the coverage-gap generator wrote ─────────────
-- If most platform-visible rules carry that description, then the "~92 rows
-- flattened to 1" were the 60/45/30/20 scheme, and restoring genuinely varied
-- weights means restoring THAT — not inventing a new one.
SELECT
  count(*) FILTER (WHERE description LIKE 'Auto-generated to close a signal-coverage gap:%') AS generator_written,
  count(*) FILTER (WHERE description IS NULL OR description NOT LIKE 'Auto-generated to close a signal-coverage gap:%') AS hand_authored,
  count(*) AS platform_visible_total
FROM signal_derivation_rules
WHERE msp_id IS NULL;

-- ─── Q4. The denominator's basis vs the numerator's basis ────────────────────
-- THE CORE ASYMMETRY, in one result. `catalog_active_checks` is what
-- fetchEvaluableSignalKeys builds theoreticalMax from; each package row is what
-- a tenant scanned with it can possibly contribute to rawScore.
SELECT 'catalog_active_checks' AS scope, NULL::text AS package_key,
       count(*) AS check_count
FROM monitor_checks WHERE status = 'active'
UNION ALL
SELECT 'package', package_key, count(*)
FROM monitoring_package_checks
GROUP BY package_key
ORDER BY 3 DESC;

-- ─── Q5. This tenant: identity, runs, and what it was actually scanned with ──
SELECT t.id AS customer_id, t.tenant_id, t.customer_name, t.msp_id, t.is_testbed
FROM tenants t WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';

SELECT r.run_id, r.package_key, r.status, r.run_status,
       r.checks_total, r.checks_ok, r.checks_error, r.created_at
FROM msp_diagnostic_runs r
JOIN tenants t ON t.id = r.customer_id
WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
ORDER BY r.created_at DESC
LIMIT 20;

-- ─── Q6. theoreticalMax per pillar — the LIVE denominator, reproduced ────────
-- Mirrors computePillarDisplayScore's denominator exactly: per signal, the MAX
-- impact across its rules AND groups (getSignalHealthImpacts), summed over the
-- signals that are EVALUABLE. Evaluability here is approximated by the
-- catalog-wide producible-key join the code performs; diff against the Pillar
-- Matrix route's own numbers, which are authoritative.
WITH active AS (
  SELECT c.key, c.mapping, c.properties, c.requires_customer_script
  FROM monitor_checks c WHERE c.status = 'active'
),
producible AS (
  SELECT a.key AS profile_key FROM active a
  UNION SELECT a.key || '__itemCount' FROM active a
  UNION SELECT m.elem->>'targetField'
        FROM active a, LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT p.prop || suffix.s
        FROM active a, LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  -- runtime license-gap flags: producible by any package holding >=1 Graph check
  UNION SELECT v.k FROM (VALUES ('hasAADP1orP2'),('hasDefender')) AS v(k)
        WHERE EXISTS (SELECT 1 FROM active WHERE requires_customer_script IS NOT TRUE)
  -- bridged legacy keys, gated on their real producer check being active
  UNION SELECT b.k FROM (VALUES
          ('conditionalAccessPolicyCount','identity:ca-policy-count'),
          ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
          ('securityScore','security:secure-score')) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM active a WHERE a.key = b.producer)
),
fed_rules AS (
  SELECT r.signal_key
  FROM signal_derivation_rules r
  WHERE r.msp_id IS NULL
    AND CASE r.rule_type
          WHEN 'threshold'        THEN EXISTS (SELECT 1 FROM active a WHERE a.key = r.source_key)
          WHEN 'findings_keyword' THEN EXISTS (SELECT 1 FROM active a WHERE lower(a.key) LIKE '%'||lower(r.source_key)||'%')
          ELSE EXISTS (SELECT 1 FROM producible p WHERE p.profile_key = r.source_key)
        END
),
evaluable AS (SELECT DISTINCT signal_key FROM fed_rules),
per_signal AS (
  SELECT s.signal_key,
         GREATEST(COALESCE(max(r.governance_impact),0),   COALESCE(max(g.governance_impact),0))   AS governance,
         GREATEST(COALESCE(max(r.security_impact),0),     COALESCE(max(g.security_impact),0))     AS security,
         GREATEST(COALESCE(max(r.compliance_impact),0),   COALESCE(max(g.compliance_impact),0))   AS compliance,
         GREATEST(COALESCE(max(r.adoption_impact),0),     COALESCE(max(g.adoption_impact),0))     AS adoption,
         GREATEST(COALESCE(max(r.copilot_impact),0),      COALESCE(max(g.copilot_impact),0))      AS copilot,
         GREATEST(COALESCE(max(r.architecture_impact),0), COALESCE(max(g.architecture_impact),0)) AS architecture,
         GREATEST(COALESCE(max(r.licensing_impact),0),    COALESCE(max(g.licensing_impact),0))    AS licensing
  FROM evaluable s
  LEFT JOIN signal_derivation_rules r ON r.signal_key = s.signal_key AND r.msp_id IS NULL
  LEFT JOIN signal_rule_groups     g ON g.signal_key = s.signal_key AND g.msp_id IS NULL
  GROUP BY s.signal_key
)
SELECT count(*) AS evaluable_signals,
       sum(governance) AS max_governance, sum(security) AS max_security,
       sum(compliance) AS max_compliance, sum(adoption) AS max_adoption,
       sum(copilot) AS max_copilot, sum(architecture) AS max_architecture,
       sum(licensing) AS max_licensing,
       sum(governance+security+compliance+adoption+copilot+architecture+licensing) AS max_overall
FROM per_signal;

-- ─── Q7. The numerator's ceiling for THIS tenant ─────────────────────────────
-- Every signal whose owning check actually produced a tenant_monitor_profiles
-- row for this tenant — i.e. the ONLY signals that can ever contribute to
-- rawScore. Summing their impacts gives the maximum rawScore physically
-- reachable, which divided by Q6's theoreticalMax is the tenant's score FLOOR.
-- Compare that floor against the reconstruction's 76 (29-check) / 95 (7-check).
WITH tenant_checks AS (
  SELECT DISTINCT p.check_key
  FROM tenant_monitor_profiles p
  WHERE p.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
),
tenant_producible AS (
  SELECT c.key AS profile_key FROM monitor_checks c JOIN tenant_checks tc ON tc.check_key = c.key
  UNION SELECT c.key || '__itemCount' FROM monitor_checks c JOIN tenant_checks tc ON tc.check_key = c.key
  UNION SELECT m.elem->>'targetField'
        FROM monitor_checks c JOIN tenant_checks tc ON tc.check_key = c.key,
             LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT p.prop || suffix.s
        FROM monitor_checks c JOIN tenant_checks tc ON tc.check_key = c.key,
             LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  UNION SELECT b.k FROM (VALUES
          ('conditionalAccessPolicyCount','identity:ca-policy-count'),
          ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
          ('securityScore','security:secure-score')) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM tenant_checks tc WHERE tc.check_key = b.producer)
),
reachable AS (
  SELECT DISTINCT r.signal_key
  FROM signal_derivation_rules r
  WHERE r.msp_id IS NULL
    AND CASE r.rule_type
          WHEN 'threshold'        THEN EXISTS (SELECT 1 FROM tenant_checks tc WHERE tc.check_key = r.source_key)
          WHEN 'findings_keyword' THEN EXISTS (SELECT 1 FROM tenant_checks tc WHERE lower(tc.check_key) LIKE '%'||lower(r.source_key)||'%')
          ELSE EXISTS (SELECT 1 FROM tenant_producible p WHERE p.profile_key = r.source_key)
        END
),
per_signal AS (
  SELECT s.signal_key,
         GREATEST(COALESCE(max(r.governance_impact),0),   COALESCE(max(g.governance_impact),0))   AS governance,
         GREATEST(COALESCE(max(r.security_impact),0),     COALESCE(max(g.security_impact),0))     AS security,
         GREATEST(COALESCE(max(r.compliance_impact),0),   COALESCE(max(g.compliance_impact),0))   AS compliance,
         GREATEST(COALESCE(max(r.adoption_impact),0),     COALESCE(max(g.adoption_impact),0))     AS adoption,
         GREATEST(COALESCE(max(r.copilot_impact),0),      COALESCE(max(g.copilot_impact),0))      AS copilot,
         GREATEST(COALESCE(max(r.architecture_impact),0), COALESCE(max(g.architecture_impact),0)) AS architecture,
         GREATEST(COALESCE(max(r.licensing_impact),0),    COALESCE(max(g.licensing_impact),0))    AS licensing
  FROM reachable s
  LEFT JOIN signal_derivation_rules r ON r.signal_key = s.signal_key AND r.msp_id IS NULL
  LEFT JOIN signal_rule_groups     g ON g.signal_key = s.signal_key AND g.msp_id IS NULL
  GROUP BY s.signal_key
)
SELECT (SELECT count(*) FROM tenant_checks)  AS checks_with_a_real_row,
       count(*)                              AS signals_reachable_for_this_tenant,
       sum(governance) AS reach_governance, sum(security) AS reach_security,
       sum(compliance) AS reach_compliance, sum(adoption) AS reach_adoption,
       sum(copilot) AS reach_copilot, sum(architecture) AS reach_architecture,
       sum(licensing) AS reach_licensing,
       sum(governance+security+compliance+adoption+copilot+architecture+licensing) AS reach_overall
FROM per_signal;

-- ─── Q8. The two confirmed findings, as the platform actually stored them ────
-- Proves what the reconstruction assumed: 0 Conditional Access policies and
-- 14 Global Administrators are really in this tenant's collected data, and
-- shows the severity band each check's own rules matched.
SELECT p.check_key, p.status, p.item_count, p.severity_matched,
       p.extracted_properties, p.collected_at
FROM tenant_monitor_profiles p
WHERE p.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  AND p.check_key IN ('identity:ca-policy-count', 'identity:global-admin-count')
ORDER BY p.check_key, p.collected_at DESC;

-- ─── Q9. Which rules could even READ those two findings ─────────────────────
-- If this returns no rows for conditionalAccessPolicyCount, the platform's two
-- worst confirmed findings contribute NOTHING to the score at all — a different
-- and even simpler failure than dilution. Worth knowing before any reweighting.
SELECT r.id, r.signal_key, r.rule_type, r.source_key, r.compare_value, r.pillar,
       r.governance_impact, r.security_impact, r.compliance_impact, r.adoption_impact,
       r.copilot_impact, r.architecture_impact, r.licensing_impact
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
  AND (
    r.source_key IN ('conditionalAccessPolicyCount', 'conditionalAccessPoliciesCount',
                     'identity:ca-policy-count', 'identity:global-admin-count',
                     'globalAdminCount')
    OR (r.rule_type = 'findings_keyword' AND (
          lower('identity:ca-policy-count')     LIKE '%'||lower(r.source_key)||'%'
       OR lower('identity:global-admin-count')  LIKE '%'||lower(r.source_key)||'%'))
  )
ORDER BY r.signal_key, r.id;

-- ============================================================================
-- HOW TO READ THE RESULTS
--
--   Q4 vs Q7  — the headline. `catalog_active_checks` is the denominator's
--               basis; `checks_with_a_real_row` is the numerator's. The ratio
--               between them is the artificial favourability, before any weight
--               is considered.
--   Q6 vs Q7  — the same thing in weight units. reach_overall / max_overall is
--               this tenant's worst physically-possible rawScore share; the
--               score can never fall below 100 − that × 100.
--   Q1/Q2/Q3  — the BEFORE picture of the corpus, and whether restoring varied
--               weights means restoring the 60/45/30/20 scheme this platform
--               already authored, or writing a new one.
--   Q8/Q9     — whether the two confirmed findings are wired into scoring at
--               all. Q9 returning nothing would mean the dilution analysis is
--               beside the point for these two specific findings.
-- ============================================================================

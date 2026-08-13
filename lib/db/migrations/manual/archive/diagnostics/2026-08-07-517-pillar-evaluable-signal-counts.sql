-- 2026-08-07-517-pillar-evaluable-signal-counts.sql
--
-- DIAGNOSTIC ONLY. Pure SELECTs — no DDL, no DML, no self-marking INSERT (see
-- CLAUDE.md: diagnostic files are deliberately outside the tracked migration set).
--
-- ── What this is for ──────────────────────────────────────────────────────────
-- #517 added a real-coverage floor to the scoring layer: a pillar backed by
-- fewer than `MIN_EVALUABLE_SIGNALS_PER_PILLAR` genuinely evaluable signals now
-- returns NO score and an explicit "insufficient_data" status, instead of the
-- clean-looking 100 that "zero bad things found out of one thing checked"
-- produces. The constant lives in
-- `artifacts/api-server/src/lib/health-display.ts` and is currently 2.
--
-- That 2 was chosen from code, not from live data — this environment has no
-- database access, so no per-pillar count could be measured before shipping.
-- Two is the smallest floor that rules out the mathematically degenerate case
-- (one signal gives a two-valued "percentage"), and deliberately no higher,
-- because the Copilot pillar is genuinely narrow today (#414 measured
-- copilot_impact flat at 0 outside the Copilot pillar; #516 is the in-flight
-- work that widens it) and a floor chosen on aesthetics would null the headline
-- score for every real tenant.
--
-- Run this to replace that reasoning with measurement, and raise the constant
-- if the real numbers support it.
--
-- ── An important caveat about Query 2 ─────────────────────────────────────────
-- "Evaluable for a tenant" is resolved in TypeScript, not in SQL:
-- `pillar-coverage.ts`'s `buildProducibleProfileKeys` + `ruleIsFedByPackage`
-- walk `monitor_checks.mapping` targetFields, raw-property extraction keys
-- (`<prop>_count` / `_first` / `_values`), synthetic `<checkKey>__itemCount`
-- keys, bridged legacy keys and the runtime licence-gap flags. Query 2 below
-- reproduces only the parts expressible in SQL and is therefore a LOWER BOUND
-- on the real per-package count — treat a low number as "look closer", not as a
-- verdict. Query 1 (catalog-wide, per pillar) needs no such resolution and is
-- exact.

-- ── Query 1: catalog-wide, per pillar ────────────────────────────────────────
-- How many DISTINCT signal keys carry a nonzero impact for each pillar, across
-- rules and groups together (matching `getSignalHealthImpacts`, which takes the
-- MAX across a signal's rules and groups — so a signal counts once).
--
-- Read this as the ceiling: no tenant's per-pillar count can exceed it. A
-- pillar whose ceiling is at or barely above the floor is one where the floor
-- must NOT be raised.
WITH weighted AS (
  SELECT signal_key, governance_impact, security_impact, compliance_impact,
         adoption_impact, copilot_impact, architecture_impact, licensing_impact
  FROM signal_derivation_rules
  UNION ALL
  SELECT signal_key, governance_impact, security_impact, compliance_impact,
         adoption_impact, copilot_impact, architecture_impact, licensing_impact
  FROM signal_rule_groups
)
SELECT
  COUNT(DISTINCT signal_key) FILTER (WHERE governance_impact   > 0) AS governance_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE security_impact     > 0) AS security_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE compliance_impact   > 0) AS compliance_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE adoption_impact     > 0) AS adoption_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE copilot_impact      > 0) AS copilot_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE architecture_impact > 0) AS architecture_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE licensing_impact    > 0) AS licensing_signals
FROM weighted;

-- ── Query 2: per monitoring package, per pillar (LOWER BOUND — see caveat) ───
-- The same counts restricted to signals a package's own curated checks can
-- plausibly feed. Covers the two linkage shapes SQL can express honestly:
--   • threshold rules      — source_key IS a check key
--   • findings_keyword     — the keyword appears inside a covered check key
--   • profile_key_* rules  — only where source_key equals a covered check key
--                            or its `<checkKey>__itemCount` form; the mapping /
--                            raw-property / bridged / licence-gap producers are
--                            NOT reproduced here, which is why this undercounts.
--
-- The package that matters most is `assess:copilot-readiness` — it is what the
-- headline Copilot Gate verdict is computed over.
WITH pkg_checks AS (
  SELECT mpc.package_key, mpc.check_key
  FROM monitoring_package_checks mpc
),
weighted AS (
  SELECT signal_key, rule_type, source_key,
         governance_impact, security_impact, compliance_impact,
         adoption_impact, copilot_impact, architecture_impact, licensing_impact
  FROM signal_derivation_rules
),
fed AS (
  SELECT DISTINCT p.package_key, w.signal_key,
         w.governance_impact, w.security_impact, w.compliance_impact,
         w.adoption_impact, w.copilot_impact, w.architecture_impact, w.licensing_impact
  FROM weighted w
  JOIN pkg_checks p
    ON (w.rule_type = 'threshold'        AND w.source_key = p.check_key)
    OR (w.rule_type = 'findings_keyword' AND w.source_key <> ''
        AND position(lower(w.source_key) IN lower(p.check_key)) > 0)
    OR (w.rule_type LIKE 'profile\_key\_%'
        AND (w.source_key = p.check_key OR w.source_key = p.check_key || '__itemCount'))
)
SELECT
  package_key,
  COUNT(DISTINCT signal_key) FILTER (WHERE governance_impact   > 0) AS governance_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE security_impact     > 0) AS security_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE compliance_impact   > 0) AS compliance_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE adoption_impact     > 0) AS adoption_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE copilot_impact      > 0) AS copilot_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE architecture_impact > 0) AS architecture_signals,
  COUNT(DISTINCT signal_key) FILTER (WHERE licensing_impact    > 0) AS licensing_signals
FROM fed
GROUP BY package_key
ORDER BY package_key;

-- ── Query 3: which signals carry the Copilot pillar at all ───────────────────
-- The names behind `copilot_signals` above. #516's whole subject: if this list
-- is four rows that all restate "this tenant has no Copilot licences", the
-- Copilot Gate is one fact wearing four hats, and the floor is not the only
-- thing that needs raising.
SELECT signal_key, MAX(copilot_impact) AS copilot_impact, COUNT(*) AS rule_count
FROM signal_derivation_rules
WHERE copilot_impact > 0
GROUP BY signal_key
ORDER BY MAX(copilot_impact) DESC, signal_key;

-- ============================================================================
-- DIAGNOSTIC ONLY — READ-ONLY. Run this first; it mutates nothing.
-- ============================================================================
-- Purpose: gather the real data needed to correctly repopulate the empty
--          monitoring_package_checks junction table (see companion file
--          2026-07-21-repopulate-monitoring-package-checks.sql).
--
-- Confirmed live: monitoring_package_checks is empty across every package, so
-- executeMonitoringPackage() returns runStatus "no_checks" / checks:[] and
-- diagnostics-runner reports checks_total = 0 for every scan on every package.
--
-- The mapping is NOT mechanically derivable from existing data with confidence
-- (see the session report). These queries expose the real package list, the
-- real engine tags on both sides, and a PREVIEW of what an engine-overlap
-- mapping WOULD produce, so a human (Shane) can decide the correct curation.
--
-- Run each block, paste the output back, and the precise curated migration can
-- then be authored. Nothing here writes to the database.
-- ============================================================================

-- Q1 ── Full active package list (answers "which packages need checks?").
--       The 10 cat-* dashboard category-tab containers are INTENTIONALLY
--       check-less (see 2026-07-19-customer-dashboard-category-tabs.sql) and
--       should stay empty. Everything else that is a real functional package
--       (core:security-baseline and any siblings) needs checks.
SELECT
  key,
  label,
  status,
  engines,                                   -- "which engines to recompute", NOT a check selector
  required_plan_feature,
  platform_cost_cents,
  (SELECT count(*) FROM monitoring_package_checks mpc WHERE mpc.package_key = mp.key) AS current_check_count
FROM monitoring_packages mp
ORDER BY (mp.key LIKE 'cat-%'), mp.key;      -- functional packages first, cat-* containers last

-- Q2 ── The real Monitor Check catalog: key naming convention + engine tags.
--       Reveals whether check.key has a namespace prefix (e.g. "sec:", "id:")
--       and how selectively checks are tagged to engines — the two candidate
--       (but unproven) derivation signals.
SELECT
  key,
  label,
  status,
  engines,
  requires_customer_script,
  frequency
FROM monitor_checks
WHERE status = 'active'
ORDER BY key;

-- Q3 ── Count of active checks per distinct engine tag. If, say, only ~15 of
--       118 checks carry "security", then an engines-overlap mapping for a
--       ["security"] package would be selective (plausibly a real "security
--       baseline"). If nearly all 118 carry health/security/drift, overlap is
--       too broad to be a meaningful entry-tier baseline.
SELECT
  engine_tag,
  count(*) AS active_checks_with_this_engine
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements_text(c.engines) AS engine_tag
WHERE c.status = 'active'
GROUP BY engine_tag
ORDER BY active_checks_with_this_engine DESC;

-- Q4 ── PREVIEW: how many checks each functional package WOULD receive if we
--       mapped "check belongs to package when their engines overlap". This is
--       the number to sanity-check before ever running the mechanical option.
--       (A package whose engines is [] gets 0 here — which would leave it just
--       as broken as today, another reason the mechanical path is not safe to
--       apply blind.)
SELECT
  mp.key AS package_key,
  mp.engines AS package_engines,
  count(c.key) AS checks_overlap_would_attach
FROM monitoring_packages mp
LEFT JOIN monitor_checks c
  ON c.status = 'active'
 AND mp.engines ?| ARRAY(SELECT jsonb_array_elements_text(c.engines))
WHERE mp.status = 'active'
  AND mp.key NOT LIKE 'cat-%'                 -- exclude the deliberate dashboard containers
GROUP BY mp.key, mp.engines
ORDER BY mp.key;

-- Q5 ── The exact preview list of check keys engine-overlap would attach to
--       core:security-baseline specifically. Eyeball this: does it read like a
--       curated entry-tier security baseline, or like "the whole catalog"?
SELECT c.key, c.label, c.engines
FROM monitor_checks c
JOIN monitoring_packages mp ON mp.key = 'core:security-baseline'
WHERE c.status = 'active'
  AND mp.engines ?| ARRAY(SELECT jsonb_array_elements_text(c.engines))
ORDER BY c.key;

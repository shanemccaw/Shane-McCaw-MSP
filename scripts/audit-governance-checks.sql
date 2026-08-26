-- Real audit: every monitor check, its real endpoint config, and which
-- package(s) it's assigned to. Run this to see the actual current state —
-- migration files alone couldn't give a complete picture (some checks were
-- created directly via Simulator Studio with no migration trace).

SELECT
  mc.key                                  AS check_key,
  mc.label,
  mc.status,
  mc.endpoint,
  mc.method,
  mc.select_params,
  mc.filter_params,
  mc.executor_type,
  mc.frequency,
  mc.fan_out_source,
  string_agg(DISTINCT mpc.package_key, ', ' ORDER BY mpc.package_key) AS packages,
  COUNT(DISTINCT mpc.package_key)         AS package_count
FROM monitor_checks mc
LEFT JOIN monitoring_package_checks mpc ON mpc.check_key = mc.key
GROUP BY mc.id, mc.key, mc.label, mc.status, mc.endpoint, mc.method,
         mc.select_params, mc.filter_params, mc.executor_type,
         mc.frequency, mc.fan_out_source
ORDER BY mc.key;

-- Narrower version: just Governance-relevant checks, to directly answer
-- tonight's question (which of these are real + which package are they in)
SELECT
  mc.key                                  AS check_key,
  mc.label,
  mc.status,
  mc.endpoint,
  string_agg(DISTINCT mpc.package_key, ', ' ORDER BY mpc.package_key) AS packages
FROM monitor_checks mc
LEFT JOIN monitoring_package_checks mpc ON mpc.check_key = mc.key
WHERE mc.key ILIKE 'governance:%'
   OR mc.key ILIKE 'appgov:%'
   OR mc.key ILIKE 'identity:pim%'
   OR mc.key ILIKE '%team%'
   OR mc.key ILIKE '%owner%'
   OR mc.key ILIKE '%share%'
   OR mc.key ILIKE '%oversh%'
   OR mc.key ILIKE '%orphan%'
GROUP BY mc.id, mc.key, mc.label, mc.status, mc.endpoint
ORDER BY mc.key;

-- Sanity check: exactly what's in core:premier right now, live (not from a
-- migration file's snapshot-in-time query, the actual current table state)
SELECT mc.key, mc.label, mc.status, mc.endpoint
FROM monitoring_package_checks mpc
JOIN monitor_checks mc ON mc.key = mpc.check_key
WHERE mpc.package_key = 'core:premier'
ORDER BY mc.key;

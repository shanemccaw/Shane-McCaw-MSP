-- Real audit: Compliance (CMP_AREA_LINKS, 13 areas) and Security
-- (SEC_AREA_LINKS, 5 areas) fixture cards against the real check catalog.
-- Same pattern as scripts/audit-governance-checks.sql, which reversed 3 of
-- 4 "no genuine backing" conclusions once checked against live data —
-- don't trust file-search-based gap claims for these two pillars either
-- until this comes back.

SELECT
  mc.key                                  AS check_key,
  mc.label,
  mc.status,
  mc.endpoint,
  string_agg(DISTINCT mpc.package_key, ', ' ORDER BY mpc.package_key) AS packages
FROM monitor_checks mc
LEFT JOIN monitoring_package_checks mpc ON mpc.check_key = mc.key
WHERE mc.key ILIKE 'compliance:%'
   OR mc.key ILIKE 'governance:retention%'
   OR mc.key ILIKE 'governance:%label%'
   OR mc.key ILIKE 'governance:%audit%'
   OR mc.key ILIKE 'exchange:litigation%'
   OR mc.key ILIKE 'exchange:audit%'
   OR mc.key ILIKE '%disposition%'
   OR mc.key ILIKE '%preservation%'
   OR mc.key ILIKE '%records%'
   OR mc.key ILIKE '%subject-request%'
   OR mc.key ILIKE '%dsr%'
   OR mc.key ILIKE 'identity:ca-%'
   OR mc.key ILIKE 'identity:legacy-auth%'
   OR mc.key ILIKE 'identity:mfa%'
   OR mc.key ILIKE 'identity:privileged-mfa%'
   OR mc.key ILIKE 'appgov:%consent%'
   OR mc.key ILIKE 'appgov:%oauth%'
   OR mc.key ILIKE 'exchange:dkim%'
   OR mc.key ILIKE 'exchange:antispam%'
   OR mc.key ILIKE 'exchange:antiphishing%'
   OR mc.key ILIKE 'security:antiphishing%'
   OR mc.key ILIKE 'security:safe-%'
GROUP BY mc.id, mc.key, mc.label, mc.status, mc.endpoint
ORDER BY mc.key;

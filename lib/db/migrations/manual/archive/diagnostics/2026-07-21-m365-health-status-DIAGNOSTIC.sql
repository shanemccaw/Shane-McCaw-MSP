-- DIAGNOSTIC ONLY — read-only, nothing to apply. For Shane to run by hand to
-- confirm which of the 5 real `computeM365Health()` failure reasons
-- (public-status.ts) is actually live, and to confirm the isTestbed fix in
-- this task's commit resolves it.

-- 1. "not_configured" — does an active m365:service-health monitor_checks
--    row exist? (Seeded by 2026-07-20-m365-service-health.sql, marked
--    "Needs manual SQL" in PLATFORM_BUILD.md — never confirmed run.)
SELECT key, status, endpoint, method
FROM monitor_checks
WHERE key = 'm365:service-health';
-- If this returns 0 rows (or a row with status != 'active'), that migration
-- was never applied — run it, this is the real "not_configured" cause.

-- 2. "no_tenant" — this task's fix changed resolveOwnTenantId() to require
--    isTestbed = TRUE (previously required FALSE) under the isDirectBusiness
--    MSP with granted consent. Confirm a row now matches:
SELECT tc.tenant_id, tc.consent_status, mc.id AS customer_id, mc.is_testbed, mc.name, msp.is_direct_business
FROM tenant_consent tc
JOIN msp_customers mc ON mc.id = tc.customer_id
JOIN msps msp ON msp.id = mc.msp_id
WHERE msp.is_direct_business = TRUE
  AND mc.is_testbed = TRUE
  AND tc.consent_status = 'granted';
-- Expect exactly 1 row (Shane's own connected tenant). 0 rows means the fix
-- didn't find it either — check whether Shane's real tenant's msp_customers
-- row is actually flagged is_testbed, or whether consent_status is something
-- other than 'granted' (e.g. still 'pending' or 'revoked').

-- 3. For comparison — what the OLD (pre-fix) query would have matched, to
--    confirm it really was empty (proving no_tenant was the live cause, not
--    a false alarm):
SELECT tc.tenant_id, mc.id AS customer_id, mc.name
FROM tenant_consent tc
JOIN msp_customers mc ON mc.id = tc.customer_id
JOIN msps msp ON msp.id = mc.msp_id
WHERE msp.is_direct_business = TRUE
  AND mc.is_testbed = FALSE
  AND tc.consent_status = 'granted';

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC ONLY — no writes. Identify exactly WHICH check misfired the
-- consent auto-revoke ~5 minutes after each real grant (2026-07-23,
-- consented_at 07:05:26 → revoked_at 07:10:40).
--
-- Root cause (fixed in code, graph.ts): graphFetchForTenant treated ANY Graph
-- 401 as a consent revocation ("unchanged legacy behavior" branch), and
-- isConsentErrorBody counted "InvalidAuthenticationToken" (a token-lifecycle /
-- wrong-audience error) as a consent signature. The consent.granted →
-- "Run Assessment" workflow executes the tenant's full monitoring package
-- sequentially; ~5 minutes in, the run reached a check whose endpoint 401s for
-- a NON-consent reason (missing app scope — Intune/Reports-class endpoints
-- return 401 not 403 — or a full-URL/beta endpoint fetched with the
-- v1.0-audience token) and the whole tenant flipped to revoked.
--
-- These queries name the exact check from the real run's own records.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. The auto-revoke audit event(s) tonight — confirms machine-source revoke
--    and gives the precise revoke timestamps to correlate against.
SELECT created_at, entity_id AS tenant_id, metadata
FROM audit_logs
WHERE action_type = 'tenant_consent_revoked'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 2. THE ANSWER: for the affected tenant, the last run's per-check rows in
--    execution order. The FIRST row with status = 'consent_revoked' whose
--    error_message is NOT the short-circuit text
--    ('Skipped: consent was revoked on a prior check in this run')
--    is the check that misfired — every consent_revoked row after it is just
--    the short-circuit. Replace :tenant_id with the real tenant GUID from #1.
SELECT profile_id, check_key, status, error_message, created_at, trigger_id
FROM tenant_monitor_profiles
WHERE tenant_id = :tenant_id
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at ASC;

-- 3. That check's definition — endpoint + method. Expect either an endpoint
--    needing a scope the MT app lacks (compare against REQUIRED_MT_SCOPES in
--    graph.ts), a beta endpoint, or a full non-Graph URL.
--    Replace :check_key with the key found in #2.
SELECT key, label, endpoint, method, frequency, requires_customer_script
FROM monitor_checks
WHERE key = :check_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FIX LIVE VERIFICATION (after deploying the graph.ts fix + api-server
-- restart):
--   a. Re-grant consent on the affected tenant.
--   b. Wait ≥ 10 minutes (one full package run + one */5 Live Activity cycle).
--   c. Run:
SELECT tenant_id, consent_status, consented_at, revoked_at, updated_at
FROM tenant_consent
ORDER BY updated_at DESC
LIMIT 5;
--      consent_status must still be 'granted' and revoked_at unchanged/NULL.
--   d. The misfiring check should now record status = 'error' (its real,
--      honest classification) instead of nuking the tenant:
--      re-run query #2 and confirm no new consent_revoked rows.
-- ─────────────────────────────────────────────────────────────────────────────

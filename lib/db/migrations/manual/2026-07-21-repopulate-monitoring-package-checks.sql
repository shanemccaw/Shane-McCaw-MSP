-- ============================================================================
-- Create core:security-baseline package + populate monitoring_package_checks
-- ============================================================================
-- WHAT THE DIAGNOSTIC REVEALED (2026-07-21-monitoring-package-checks-DIAGNOSTIC.sql)
--   The problem is bigger than an empty junction table:
--     * monitoring_packages contains ONLY the 10 cat-* dashboard category-tab
--       containers (all engines:[], deliberately check-less).
--     * The functional package "core:security-baseline" — the universal
--       fallback that diagnostics-runner, consent.ts, portal-assessment.ts,
--       productTypeConfig.ts, and the msp_diagnostic_runs.package_key DEFAULT
--       all resolve to — DOES NOT EXIST as a row. That is why every scan
--       returns checks_total = 0: executeMonitoringPackage() can't even load
--       the package (returns runStatus "no_checks" immediately).
--   The 118 monitor_checks themselves are correct (namespaced keys + engine
--   tags, all requires_customer_script=false). Only the package + linkage are
--   missing. This migration does NOT touch monitor_checks.
--
-- WHAT THIS MIGRATION DOES
--   1. Creates the core:security-baseline monitoring package (idempotent).
--   2. Links a CURATED entry-tier security-baseline check set to it.
--
-- CURATION RATIONALE (entry-tier "security baseline", NOT the full catalog)
--   core:security-baseline is the free/assessment first-look scan. It is
--   curated to the highest-signal security-posture checks across the primary
--   attack surfaces — identity, threat protection, email security, endpoint
--   compliance, and data-exposure/sharing — NOT the full 118-check catalog and
--   NOT cost/adoption/copilot/governance-hygiene checks (those belong in a
--   higher/comprehensive tier if/when one is defined).
--   58 checks carry the "security" engine tag; taking all of them would make
--   the entry-tier baseline mean "half the catalog", which is wrong for a
--   first-look product. The 29 below are the curated subset. Every key was
--   verified present + active in the live catalog (DIAGNOSTIC Q2).
--
--   >>> SHANE: eyeball the 29 keys below before running. Add/remove to taste;
--       the file is idempotent and re-runnable. <<<
--
-- NOT touched: the 10 cat-* dashboard containers stay check-less by design.
-- Idempotent: ON CONFLICT DO NOTHING on both inserts; safe to re-run.
-- ============================================================================

-- ── 1. Create the package ───────────────────────────────────────────────────
-- engines = "which engine scores to recompute after a run" (informational on
-- the diagnostics path — it is recorded in the run summary, not used to gate
-- checks). security + health are the intelligence engines a security baseline
-- naturally feeds. Adjust if a different recompute set is intended.
INSERT INTO monitoring_packages (key, label, description, engines, status, platform_cost_cents)
VALUES (
  'core:security-baseline',
  'Security Baseline',
  'Entry-tier M365 security posture baseline — identity, threat protection, email security, device compliance and data-exposure checks. The canonical scan run on assessment consent and the platform-wide fallback package.',
  '["security","health"]'::jsonb,
  'active',
  0
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Link the curated check set ───────────────────────────────────────────
-- sort_order = the listed order (the order checks run + render in the report).
-- INSERT..SELECT guarded by an existence check so a missing/renamed check key
-- is silently skipped rather than aborting the whole migration on the FK.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:security-baseline', v.check_key, v.sort_order
FROM (VALUES
  -- Identity & Access (primary attack surface)
  ('identity:mfa-registration',            0),   -- MFA registration coverage
  ('identity:ca-mfa-coverage',             1),   -- CA MFA requirement coverage
  ('identity:ca-policy-count',             2),   -- Conditional Access policies exist
  ('identity:ca-legacy-auth-block',        3),   -- legacy auth blocked by CA
  ('identity:legacy-auth-usage',           4),   -- legacy auth actually in use
  ('identity:global-admin-count',          5),   -- Global Admin sprawl
  ('identity:pim-permanent-roles',         6),   -- standing (permanent) privileged roles
  ('identity:break-glass-health',          7),   -- break-glass account health
  ('identity:risky-users',                 8),   -- Identity Protection risky users
  ('identity:risky-signins',               9),   -- risky sign-ins
  ('identity:stale-accounts',             10),   -- stale / inactive accounts
  ('identity:sspr-config',                11),   -- self-service password reset configured
  -- Threat protection / Defender
  ('security:secure-score',               12),   -- Microsoft Secure Score (headline metric)
  ('security:open-incidents',             13),   -- open security incidents
  ('security:alert-count-by-severity',    14),   -- alerts by severity
  ('security:safe-links-coverage',        15),   -- Safe Links coverage
  ('security:safe-attachments-coverage',  16),   -- Safe Attachments coverage
  ('security:antiphishing-coverage',      17),   -- anti-phishing policy coverage
  ('security:dlp-violations',             18),   -- DLP violations
  -- Email security
  ('exchange:dkim-spf-dmarc-status',      19),   -- email authentication (DKIM/SPF/DMARC)
  ('exchange:auto-forwarding-rules',      20),   -- external auto-forwarding (exfiltration)
  -- Endpoint / device compliance
  ('devices:compliant-vs-noncompliant',   21),   -- device compliance state
  ('devices:encryption-status',           22),   -- device encryption
  ('devices:os-patch-compliance',         23),   -- OS patch compliance
  ('devices:bitlocker-key-escrow',        24),   -- BitLocker recovery key escrow
  -- Data exposure / external sharing
  ('sharepoint:anonymous-links',          25),   -- anonymous sharing links
  ('sharepoint:tenant-sharing-capability',26),   -- tenant sharing capability setting
  ('onedrive:external-sharing-settings',  27),   -- OneDrive external sharing
  -- App / OAuth attack surface
  ('appgov:risky-permission-grants',      28)    -- risky OAuth permission grants
) AS v(check_key, sort_order)
WHERE EXISTS (
  SELECT 1 FROM monitor_checks c
  WHERE c.key = v.check_key AND c.status = 'active'
)
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ── 3. Sanity check (optional; run after the two inserts) ───────────────────
-- Expect: 1 package row, 29 check links (or fewer only if a key was inactive).
--   SELECT count(*) AS pkg   FROM monitoring_packages     WHERE key = 'core:security-baseline';
--   SELECT count(*) AS links FROM monitoring_package_checks WHERE package_key = 'core:security-baseline';

-- ============================================================================
-- POST-RUN VERIFICATION (Deliverable 4)
-- ============================================================================
-- 1. Trigger the same testbed scan used to find the bug:
--      POST /api/msp/customers/4/diagnostics/run   body: {"packageKey":"core:security-baseline"}
-- 2. Confirm checks_total > 0 on the run row:
--      SELECT run_id, package_key, status, run_status, checks_total, checks_ok, checks_error, checks_requires_script
--      FROM msp_diagnostic_runs ORDER BY created_at DESC LIMIT 1;
--    Expect checks_total = 29 (or your adjusted count).
-- 3. Confirm checks actually EXECUTED against Graph (real results, not just a
--    nonzero count of failures) — per-check rows land in tenant_monitor_profiles:
--      SELECT check_key, status, item_count, severity_matched, error_message
--      FROM tenant_monitor_profiles
--      WHERE trigger_id = 'diag-run-<runId from step 2>'
--      ORDER BY check_key;
--    Expect a spread of status='ok' with real item_count values. (Some checks
--    may legitimately error if the tenant lacks a given workload/SKU or the
--    app registration is missing a scope — that is real data, not the bug.)
-- ============================================================================

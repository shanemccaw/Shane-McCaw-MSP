-- ============================================================================
-- Git #1134 — Build the Foundation / Growth / Premier 3-tier monitoring
-- package structure (schema already exists; this is data: 3 new packages +
-- their nested check-to-tier membership).
-- ============================================================================
-- Applies #1129's proposal (docs/monitoring-3-tier-package-proposal-1129.md)
-- for real, using the CONFIRMED tier NAMES Shane settled in #1129 comment
-- 5323106586:
--     proposal "Assessment"          -> Foundation   (key core:foundation)
--     proposal "Managed Monitoring"  -> Growth        (key core:growth)
--     proposal "Enhanced/Compliance" -> Premier       (key core:premier)
-- (The proposal doc's own words "Assessment/Managed/Enhanced" were never
-- shipped as live UI strings — grep confirms they exist only in that doc — so
-- there is nothing to "rename"; these three brand-new packages simply carry
-- the confirmed Foundation/Growth/Premier labels from birth.)
--
-- NESTING MODEL. The schema (monitoring_packages / monitoring_package_checks)
-- has NO tier/hierarchy column — a "nested" ladder is expressed purely by
-- physical membership: each higher tier links a strict SUPERSET of the tier
-- below. So Foundation's checks ⊂ Growth's checks ⊂ Premier's checks. Each
-- package is therefore self-contained: assigning a customer "Growth" runs the
-- full Growth set without also having to assign Foundation. This matches the
-- proposal's "each tier ⊇ the one below" and how the scoring denominator
-- already unions run packages.
--
-- CHECK COUNTS (live-verified via shaneapp://executeSql on 2026-08-17 against
-- the dev catalog, NOT inferred from the doc):
--     Foundation  30   (the proposal's Tier-1 lineup of 32, minus 2 orphans)
--     Growth     129   (all active, non-internal, non-orphan, minus the 5 T3-only)
--     Premier    133   (all active, non-internal, non-orphan)
--   Active checks total 142 = 133 tiered + 7 orphaned + 2 internal/diagnostic.
--
-- ORPHANS DELIBERATELY EXCLUDED (#1134 scope point 2, blocked on #1130). The
-- 7 checks below are active but assigned to NO package today; #1129 Q3's answer
-- was to adopt them into tiers ONLY once #1130 (elevate the read app to Global
-- Reader) lands, because several can't actually read their data without it.
-- Until #1130 is done they stay orphaned — they are NOT wired into any tier
-- here, even though 2 of them (cost:unused-unassigned-licenses,
-- exchange:auto-forwarding-rules) are named in the proposal's Tier-1 lineup and
-- 1 (compliance:audit-log-retention) in Tier-3. The confirmed Tier-1 DESIGN is
-- unchanged; only the physical wiring of the orphaned members is deferred.
--   compliance:audit-log-retention, cost:license-count-by-sku,
--   cost:unused-unassigned-licenses, cost:utilization-by-sku,
--   exchange:auto-forwarding-rules, onedrive:external-sharing-settings,
--   platform:tenant-password-expiration
--
-- INTERNAL / DIAGNOSTIC (never in any customer tier):
--   diagnostics:ps-execution-test, appgov:enterprise-app-registration-list
--
-- >>> SHANE — the OLD package boundaries are LEFT INTACT ON PURPOSE. #1134
-- scope point 3 said to retire core:security-baseline / core:enhanced-monitoring
-- / detail:full-item-collection "rather than actively breaking anything
-- currently referencing them (checked live before removing)". Checked live:
-- core:security-baseline is LOAD-BEARING — it is the hard-coded fallback in the
-- Drizzle schema DEFAULT (msp.ts:2329 msp_diagnostic_runs.package_key) and in
-- ~15 code sites (consent.ts, msp-diagnostics.ts, portal-assessment.ts,
-- diagnostics-runner.ts default param, productTypeConfig.ts, seed-system-
-- workflows.ts, several admin-panel screens). detail:full-item-collection is
-- referenced by item-detail-collector.ts (ITEM_DETAIL_PACKAGE_KEY) +
-- consent.ts. Archiving or deleting either would break scans, because
-- executeMonitoringPackage() only loads packages WHERE status='active'. So this
-- migration does NOT touch the old rows. To ACTUALLY retire them later you must
-- first repoint every fallback above to core:foundation (the natural successor
-- to the security-baseline entry scan). That repoint is a code change with real
-- blast radius and is left as your call — see the Shane To-Do on #1134.
--
-- COORDINATION WITH #1131 (retire the 3 thin assess:* SKUs as report facets):
-- no conflict. This migration derives tier membership from monitor_checks
-- DIRECTLY (by check status), never by moving checks OUT of the assess:*
-- packages — so a check that lives in assess:teams-governance today still lands
-- in Growth/Premier here regardless of whether #1131 has retired that package
-- yet. Reassignment happens once, in one place (here), not twice.
--
-- Idempotent: ON CONFLICT DO NOTHING on every insert; safe to re-run.
-- ============================================================================

-- ── 1. Create the three tier packages (idempotent) ──────────────────────────
INSERT INTO monitoring_packages (key, label, description, engines, status, platform_cost_cents)
VALUES
  (
    'core:foundation',
    'Foundation',
    'Entry tier — an opinionated, cross-pillar posture snapshot: the highest-severity, most-explainable, most-universal findings across all seven pillars. The "get in the door" scan behind the Copilot-readiness / security-posture sales motion. Nested base of Growth and Premier.',
    '["adoption","compliance","copilot","governance","health","priority","security"]'::jsonb,
    'active',
    0
  ),
  (
    'core:growth',
    'Growth',
    'Recurring managed-service tier — the whole operational surface: full Intune/device posture, Exchange mail hygiene, governance sprawl, adoption trends, license optimisation, all CA/identity detail. Superset of Foundation; runs daily.',
    '["adoption","architecture","compliance","copilot","cost","governance","health","licensing","priority","security"]'::jsonb,
    'active',
    0
  ),
  (
    'core:premier',
    'Premier',
    'Compliance & evidence tier — Growth plus the compliance-grade checks (audit-log retention, litigation hold, DLP/label integrity, insider-risk) for regulated / audit-driven clients. Superset of Growth. (Full per-item EVIDENCE collection, the old detail:full-item-collection behaviour, is a collection-mode concern layered on top and is intentionally not modelled as package membership here.)',
    '["adoption","architecture","compliance","copilot","cost","governance","health","licensing","priority","security"]'::jsonb,
    'active',
    0
  )
ON CONFLICT (key) DO NOTHING;

-- ── 2. Foundation membership — 30 checks (Tier-1 lineup, orphans excluded) ───
-- FK-safety: only links checks that really exist and are active (WHERE via the
-- source set); sort_order is stable alphabetical.
WITH t1(k) AS (VALUES
  ('adoption:overall-active-rate'),('appgov:risky-permission-grants'),
  ('compliance:eeeu-site-sharing'),('compliance:missing-labels'),
  ('copilot:data-exposure-risk'),('copilot:readiness-prerequisite'),
  ('cost:unused-unassigned-licenses'),('devices:bitlocker-key-escrow'),
  ('devices:compliance-policy-coverage'),('exchange:auto-forwarding-rules'),
  ('exchange:dkim-spf-dmarc-status'),('governance:guest-count'),
  ('governance:ownerless-groups'),('governance:retention-policy-coverage'),
  ('identity:break-glass-health'),('identity:ca-legacy-auth-block'),
  ('identity:ca-mfa-coverage'),('identity:ca-policy-count'),
  ('identity:global-admin-count'),('identity:legacy-auth-usage'),
  ('identity:mfa-registration'),('identity:pim-permanent-roles'),
  ('identity:risky-users'),('identity:sspr-config'),
  ('license:unused-assigned'),('m365:service-health'),
  ('security:antiphishing-coverage'),('security:open-incidents'),
  ('security:safe-attachments-coverage'),('security:safe-links-coverage'),
  ('security:secure-score'),('sharepoint:tenant-sharing-capability')
),
orphan(k) AS (VALUES
  ('compliance:audit-log-retention'),('cost:license-count-by-sku'),
  ('cost:unused-unassigned-licenses'),('cost:utilization-by-sku'),
  ('exchange:auto-forwarding-rules'),('onedrive:external-sharing-settings'),
  ('platform:tenant-password-expiration')
),
members AS (
  SELECT c.key
  FROM monitor_checks c
  WHERE c.status = 'active'
    AND c.key IN (SELECT k FROM t1)
    AND c.key NOT IN (SELECT k FROM orphan)
)
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:foundation', m.key, row_number() OVER (ORDER BY m.key) - 1
FROM members m
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ── 3. Growth membership — 129 checks ───────────────────────────────────────
-- = every active check EXCEPT the 2 internal/diagnostic, the 7 orphans, and the
-- 5 Premier-only compliance checks. (Foundation ⊂ Growth holds automatically.)
WITH t3only(k) AS (VALUES
  ('compliance:audit-log-retention'),('compliance:dlp-incidents'),
  ('compliance:label-errors'),('exchange:litigation-hold-coverage'),
  ('security:insider-risk-alerts')
),
internal(k) AS (VALUES
  ('diagnostics:ps-execution-test'),('appgov:enterprise-app-registration-list')
),
orphan(k) AS (VALUES
  ('compliance:audit-log-retention'),('cost:license-count-by-sku'),
  ('cost:unused-unassigned-licenses'),('cost:utilization-by-sku'),
  ('exchange:auto-forwarding-rules'),('onedrive:external-sharing-settings'),
  ('platform:tenant-password-expiration')
),
members AS (
  SELECT c.key
  FROM monitor_checks c
  WHERE c.status = 'active'
    AND c.key NOT IN (SELECT k FROM internal)
    AND c.key NOT IN (SELECT k FROM orphan)
    AND c.key NOT IN (SELECT k FROM t3only)
)
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:growth', m.key, row_number() OVER (ORDER BY m.key) - 1
FROM members m
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ── 4. Premier membership — 133 checks ──────────────────────────────────────
-- = every active check EXCEPT the 2 internal/diagnostic and the 7 orphans.
-- (Growth ⊂ Premier holds automatically: Premier = Growth ∪ the 5 T3-only.)
WITH internal(k) AS (VALUES
  ('diagnostics:ps-execution-test'),('appgov:enterprise-app-registration-list')
),
orphan(k) AS (VALUES
  ('compliance:audit-log-retention'),('cost:license-count-by-sku'),
  ('cost:unused-unassigned-licenses'),('cost:utilization-by-sku'),
  ('exchange:auto-forwarding-rules'),('onedrive:external-sharing-settings'),
  ('platform:tenant-password-expiration')
),
members AS (
  SELECT c.key
  FROM monitor_checks c
  WHERE c.status = 'active'
    AND c.key NOT IN (SELECT k FROM internal)
    AND c.key NOT IN (SELECT k FROM orphan)
)
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'core:premier', m.key, row_number() OVER (ORDER BY m.key) - 1
FROM members m
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ============================================================================
-- POST-RUN VERIFICATION (read-only — run these after the inserts)
-- ============================================================================
-- 1. Tier sizes should be exactly 30 / 129 / 133 and strictly nested:
--      SELECT package_key, count(*) FROM monitoring_package_checks
--      WHERE package_key IN ('core:foundation','core:growth','core:premier')
--      GROUP BY package_key ORDER BY count(*);
-- 2. Nesting invariant — Foundation ⊂ Growth ⊂ Premier (both queries return 0):
--      SELECT count(*) FROM monitoring_package_checks f
--      WHERE f.package_key='core:foundation'
--        AND NOT EXISTS (SELECT 1 FROM monitoring_package_checks g
--                        WHERE g.package_key='core:growth' AND g.check_key=f.check_key);
--      SELECT count(*) FROM monitoring_package_checks g
--      WHERE g.package_key='core:growth'
--        AND NOT EXISTS (SELECT 1 FROM monitoring_package_checks p
--                        WHERE p.package_key='core:premier' AND p.check_key=g.check_key);
-- 3. No orphan leaked into any tier (returns 0):
--      SELECT count(*) FROM monitoring_package_checks
--      WHERE package_key IN ('core:foundation','core:growth','core:premier')
--        AND check_key IN ('compliance:audit-log-retention','cost:license-count-by-sku',
--          'cost:unused-unassigned-licenses','cost:utilization-by-sku',
--          'exchange:auto-forwarding-rules','onedrive:external-sharing-settings',
--          'platform:tenant-password-expiration');
-- 4. Old packages untouched (counts unchanged: 23 / 113 / 132):
--      SELECT key, (SELECT count(*) FROM monitoring_package_checks c WHERE c.package_key=p.key)
--      FROM monitoring_packages p
--      WHERE key IN ('core:security-baseline','core:enhanced-monitoring','detail:full-item-collection');
-- ============================================================================

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-foundation-growth-premier-tiers-1134.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

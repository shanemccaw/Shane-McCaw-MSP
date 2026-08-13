-- ============================================================================
-- War Room pillar stat callouts — coverage audit (#341, epic #302)
-- READ-ONLY except for the clearly-marked, commented-out section 4.
-- Manual — run by hand, not drizzle-kit.
-- ============================================================================
--
-- SYMPTOM (Shane, confirmed POST-completion, not mid-scan — that is #340):
-- Governance/Licensing/Adoption/Compliance/Health show a real dial score
-- (19/24/31/28/41) but their stat text reads NO DATA. Security and Copilot show
-- both a real score and real stat text.
--
-- DIAGNOSIS, established from the repo and now regression-tested in
-- `war-room-pillar-stats.test.ts` — this is NOT a matching or reading bug:
--
--   * A pillar's SCORE comes from the SIGNALS that fired, and a signal's impact
--     is many-to-many across pillars (one identity:* signal legitimately carries
--     governanceImpact, licensingImpact, adoptionImpact…). So one domain's
--     checks can honestly score all seven pillars.
--   * A STAT needs ITS OWN named check to have a tenant_monitor_profiles row.
--     There is deliberately no cross-pillar substitute — that is what stops a
--     card inventing a number.
--   * The 28 stat specs name 22 distinct checks. `core:security-baseline` (the
--     canonical scan package, and the msp_diagnostic_runs.package_key DEFAULT)
--     curates 29 checks, and exactly FOUR of the 22 are in it:
--       identity:mfa-registration, identity:global-admin-count,
--       identity:legacy-auth-usage, identity:risky-users
--     Three feed Security; the fourth feeds Copilot, whose headline stat is the
--     pillar score itself and so is never empty. That is the 2-of-7 split,
--     exactly.
--
-- SHIPPED IN CODE: those stats no longer report `no_data` ("the check ran and
-- found nothing"). They report `not_in_scan_package`, resolved from the real
-- monitoring_package_checks rows of the packages this customer has actually
-- run, and each stat now carries its real `checkKey`.
--
-- WHAT THIS FILE IS FOR: (1) confirming the above against the live tenant rather
-- than trusting it, and (2) deciding the ONE thing the repo cannot decide — the
-- Health card, whose four stats name `intune:*` while the package runs four
-- semantically parallel `devices:*` checks.
--
-- Replace 4 with the real customer id (tenants.id) throughout. 4 is the id the
-- 2026-07-26 cost-waste audit and the #333 audit both used.


-- ── 1. THE HEADLINE. One row per stat callout, in card order. ───────────────
-- `in_a_scanned_package` is the column that decides #341. Expect it TRUE for
-- exactly the four identity:* rows and FALSE for the other eighteen. Expect
-- `check_exists_in_catalog` FALSE for the intune:* family if the registry keys
-- are phantom (the `identity:high-risk-signins` trap, 2026-07-26 audit) — that
-- would make them a wiring bug rather than a curation gap, and section 3 is
-- then the fix rather than section 4.
WITH stat_checks (pillar, stat_label, check_key) AS (VALUES
  ('governance','sites inventoried',            'compliance:sharepoint-sites'),
  ('governance','overshared sites',             'compliance:overshared-sites'),
  ('governance','items over-exposed',           'copilot:overshare-exposure'),
  ('governance','public channels',              'compliance:public-channels'),
  ('licensing', 'inactive licences',            'licensing:inactive-user-licenses'),
  ('adoption',  'active Teams users',           'usage:teams-activity'),
  ('adoption',  'active SharePoint users',      'usage:sharepoint-activity'),
  ('adoption',  'active OneDrive users',        'usage:onedrive-activity'),
  ('adoption',  'active email users',           'usage:email-activity'),
  ('compliance','missing sensitivity labels',   'compliance:missing-labels'),
  ('compliance','retention policy drift',       'compliance:retention-drift'),
  ('compliance','weak DLP policies',            'compliance:weak-dlp-policies'),
  ('compliance','guest users',                  'compliance:guest-users'),
  ('health',    'non-compliant devices',        'intune:non-compliant-devices'),
  ('health',    'device config drift',          'intune:config-drift'),
  ('health',    'unencrypted devices',          'intune:unencrypted-devices'),
  ('health',    'outdated OS devices',          'intune:outdated-devices'),
  ('security',  'MFA-registered users',         'identity:mfa-registration'),
  ('security',  'global administrators',        'identity:global-admin-count'),
  ('security',  'legacy auth sign-ins',         'identity:legacy-auth-usage'),
  ('security',  'items in blast radius',        'copilot:overshare-exposure'),
  ('copilot',   'items Copilot could reach',    'copilot:overshare-exposure'),
  ('copilot',   'risky users',                  'identity:risky-users'),
  ('copilot',   'duplicate licences',           'licensing:duplicate-assignments')
), scanned_packages AS (
  SELECT DISTINCT package_key FROM msp_diagnostic_runs WHERE customer_id = 4
), scanned_checks AS (
  SELECT DISTINCT pc.check_key
  FROM monitoring_package_checks pc
  JOIN scanned_packages sp ON sp.package_key = pc.package_key
)
SELECT s.pillar,
       s.stat_label,
       s.check_key,
       (mc.key IS NOT NULL)                       AS check_exists_in_catalog,
       mc.status                                  AS check_status,
       (sc.check_key IS NOT NULL)                 AS in_a_scanned_package,
       p.status                                   AS last_run_status,
       p.collected_at,
       p.item_count,
       (p.check_key IS NOT NULL)                  AS has_any_profile_row
FROM stat_checks s
LEFT JOIN monitor_checks  mc ON mc.key = s.check_key
LEFT JOIN scanned_checks  sc ON sc.check_key = s.check_key
LEFT JOIN LATERAL (
  SELECT tp.check_key, tp.status, tp.collected_at, tp.item_count
  FROM tenant_monitor_profiles tp
  JOIN tenants t ON t.tenant_id = tp.tenant_id
  WHERE t.id = 4 AND tp.check_key = s.check_key
  ORDER BY tp.collected_at DESC
  LIMIT 1
) p ON TRUE
ORDER BY s.pillar, s.stat_label;

-- 1b — which packages this customer has actually been scanned with, and how
-- many checks they curate between them. This is the evidence the new
-- `scannedPackageKeys` / `scannedCheckCount` fields on the payload report. If
-- this returns zero rows, the code deliberately makes NO not_in_scan_package
-- claim and every stat keeps its honest `no_data`.
SELECT r.package_key,
       count(*)                                   AS runs,
       max(r.created_at)                          AS last_run_at,
       (SELECT count(*) FROM monitoring_package_checks pc
         WHERE pc.package_key = r.package_key)     AS curated_checks
FROM msp_diagnostic_runs r
WHERE r.customer_id = 4
GROUP BY r.package_key
ORDER BY last_run_at DESC;


-- ── 2. THE SCORE SIDE, so the two halves can be compared honestly. ──────────
-- Confirms the diagnosis' first claim: the pillars whose stats are dark still
-- score because signals fired with a nonzero impact on them, from checks that
-- belong to a DIFFERENT pillar's domain. Look for rows where
-- `owning_check_domain` is identity/security/devices but the impact column for
-- governance / licensing / adoption / compliance / architecture is > 0.
SELECT sig                                        AS fired_signal_key,
       split_part(r.source_key, ':', 1)           AS owning_check_domain,
       r.rule_type,
       r.source_key,
       r.governance_impact, r.licensing_impact, r.adoption_impact,
       r.compliance_impact, r.architecture_impact, r.security_impact, r.copilot_impact
FROM (
  SELECT raw_signals FROM tenant_engine_snapshots
  WHERE customer_id = 4 AND engine_key = 'health'
  ORDER BY captured_at DESC LIMIT 1
) s
CROSS JOIN LATERAL jsonb_array_elements_text(s.raw_signals) AS sig
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (signal_key)
         signal_key, rule_type, source_key,
         governance_impact, licensing_impact, adoption_impact,
         compliance_impact, architecture_impact, security_impact, copilot_impact
  FROM signal_derivation_rules
  WHERE signal_key = sig AND msp_id IS NULL
) r ON TRUE
ORDER BY owning_check_domain NULLS LAST, sig;


-- ── 3. THE ONE DECISION THIS CANNOT BE MADE FROM THE REPO. ──────────────────
-- The Health card asks for non-compliant / drifted / unencrypted / outdated
-- devices. `core:security-baseline` genuinely runs four parallel checks —
-- devices:compliant-vs-noncompliant, devices:encryption-status,
-- devices:os-patch-compliance, devices:bitlocker-key-escrow — and their FINDINGS
-- already land on this card (`devices` is a health domain). So re-pointing the
-- four stats looks like a one-line win.
--
-- IT WAS NOT DONE, deliberately. dashboard-resolvers' monitorScalarForTenant
-- takes the mapping targetField whose NAME best matches the metric, and failing
-- that falls through to `_itemCount` — literally items.length, the row count of
-- whatever the endpoint returned. If devices:compliant-vs-noncompliant lists ALL
-- devices and its mapping declares no numeric field, re-pointing would render
-- the whole device inventory under the caption "non-compliant devices". That is
-- the identical trap #333 documented for identity:stale-accounts and the
-- "14 global administrators" number.
--
-- 3a — read endpoint and mapping together. Re-pointing is safe ONLY for a check
-- whose mapping declares a numeric targetField that genuinely means the caption.
-- Implemented transforms (monitor-executor.ts): count, exists, first, join,
-- countTruthy, countFalse, countEquals('x'), countIfLastSignInOlderThan(N),
-- groupByCount, countDuplicates. Anything else yields a raw array, not a number.
SELECT key, label, status, method, endpoint, select_params, filter_params,
       properties, mapping
FROM monitor_checks
WHERE key IN (
  'devices:compliant-vs-noncompliant',
  'devices:encryption-status',
  'devices:os-patch-compliance',
  'devices:bitlocker-key-escrow',
  'devices:app-protection-coverage',
  'devices:update-rings-config'
)
ORDER BY key;

-- 3b — what those four actually stored for this tenant. If extracted_properties
-- carries a real per-concept number, re-pointing is a genuine fix and four new
-- `devices.*` registry metrics should be added (the registry has NO devices:*
-- entry today). If it is only `_itemCount`, the correction belongs to the CHECK
-- (endpoint and/or mapping) and needs its own issue, since changing a check
-- changes every consumer of it.
SELECT p.check_key, p.status, p.collected_at, p.item_count, p.extracted_properties
FROM tenant_monitor_profiles p
JOIN tenants t ON t.tenant_id = p.tenant_id
WHERE t.id = 4
  AND p.check_key LIKE 'devices:%'
ORDER BY p.check_key, p.collected_at DESC;

-- 3c — do the intune:* keys the registry names exist in the catalog at all?
-- Zero rows means the whole Health card is wired to phantom sourceKeys (the
-- `identity:high-risk-signins` failure mode) and the resolver will now be
-- reporting `unknown_check_key`, not `not_in_scan_package`.
SELECT key, label, status, endpoint FROM monitor_checks WHERE key LIKE 'intune:%' ORDER BY key;


-- ── 4. WHAT WOULD ACTUALLY MAKE THE FIVE PILLARS POPULATE. NOT RUN. ─────────
-- The five dark pillars are dark because their checks are not curated into the
-- package the scan runs. No code change can conjure that data; curating the
-- checks is the fix, and it is a deliberate, costed decision (every added check
-- is another Graph call on every scan), which is why this is left commented out
-- rather than shipped.
--
-- Run section 1 FIRST: only add a check whose `check_exists_in_catalog` is true
-- and whose status is 'active'. The guard below skips anything else rather than
-- failing the whole statement on the FK, exactly as the 2026-07-21 repopulation
-- migration does.
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'core:security-baseline', v.check_key, v.sort_order
-- FROM (VALUES
--   ('compliance:sharepoint-sites',      29),
--   ('compliance:overshared-sites',      30),
--   ('compliance:public-channels',       31),
--   ('compliance:missing-labels',        32),
--   ('compliance:retention-drift',       33),
--   ('compliance:weak-dlp-policies',     34),
--   ('compliance:guest-users',           35),
--   ('copilot:overshare-exposure',       36),
--   ('licensing:inactive-user-licenses', 37),
--   ('licensing:duplicate-assignments',  38),
--   ('usage:teams-activity',             39),
--   ('usage:sharepoint-activity',        40),
--   ('usage:onedrive-activity',          41),
--   ('usage:email-activity',             42)
-- ) AS v(check_key, sort_order)
-- WHERE EXISTS (
--   SELECT 1 FROM monitor_checks c WHERE c.key = v.check_key AND c.status = 'active'
-- )
-- ON CONFLICT (package_key, check_key) DO NOTHING;
--
-- After running it: trigger a real scan, then re-run section 1. Every row added
-- above should flip `in_a_scanned_package` to TRUE, and the cards should show a
-- real number wherever `has_any_profile_row` is TRUE. A stat that STILL reads
-- empty after a successful run is then a genuine per-check problem — read its
-- `last_run_status` and `extracted_properties` and treat it as a check bug, not
-- a War Room bug.

-- ============================================================================
-- POST-RUN SUMMARY TO CAPTURE
--   1. Section 1: the exact count of `in_a_scanned_package = true` rows.
--      Expect 4. Anything else means the curation moved since 2026-07-21 and
--      the test's CORE_SECURITY_BASELINE_CHECKS fixture needs re-syncing.
--   2. Section 3c: whether intune:* exists. This decides whether the Health
--      card is a curation gap or a phantom-sourceKey wiring bug.
--   3. Section 3a/3b: whether the devices:* checks can honestly back the four
--      Health stats. If yes, that is a follow-up issue: add four devices.*
--      registry metrics and re-point WAR_ROOM_PILLAR_STAT_SPECS.health.
-- ============================================================================

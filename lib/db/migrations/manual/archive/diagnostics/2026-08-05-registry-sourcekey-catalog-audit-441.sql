-- ============================================================================
-- Registry sourceKey ↔ live monitor_checks audit (#441, epic #343)
-- READ-ONLY. Every statement is a SELECT. Nothing here changes any row.
-- Manual — run by hand, not drizzle-kit.
-- ============================================================================
--
-- SYMPTOM (Shane, 2026-08-05, on a confirmed-live generation — the loading
-- spinner was on screen, so this was not a cached response):
-- the Copilot Readiness Report showed a paying customer eight raw check keys,
-- in two sections, as figures "your scan does not carry":
--
--   blast-radius line:  copilot:overshare-exposure
--                       compliance:overshared-sites
--                       compliance:sharepoint-sites
--   Workflow Enablement: usage:teams-activity, usage:sharepoint-activity,
--                       usage:onedrive-activity, usage:email-activity,
--                       cost:unused-unassigned-licenses
--
-- WHERE THOSE STRINGS ACTUALLY COME FROM. Not from copilotReadinessReport.ts
-- and not from copilot-readiness-narrative-generator.ts — neither file contains
-- any of them, which is why grepping the two files named in the issue found
-- nothing. They are DATA carried down the wire:
--
--   copilotReadinessReport.ts  buildRows() prints `stat.checkKey`
--     ← GET /portal/assessment/war-room-pillars
--       ← war-room-pillar-stats.ts  statFromMetricResult(spec, def.sourceKey, …)
--         ← lib/dashboard-registry  DASHBOARD_METRICS[…].sourceKey
--           ← monitor_checks.key    ← THIS TABLE. The only hop that is data.
--
-- The reason text beside each one is `unavailableReasonText(stat.unavailableReason)`,
-- and "not wired to a check in the catalogue" is the wording for
-- `unknown_check_key` — which `resolveMetric` returns when, and only when,
-- `def.sourceKey` matches no monitor_checks row at all.
--
-- ALREADY FIXED IN CODE, on evidence the repo could carry:
--   * The four `usage:*` keys. `usage` is not a check-key domain (confirmed by
--     Shane's own live domain sweep, 2026-08-05). All twelve `usage:*` registry
--     sourceKeys across fourteen metrics were retired to the `not_collected:`
--     sentinel, and the four adoption stats they backed were removed from
--     WAR_ROOM_PILLAR_STAT_SPECS and from the report's WORKLOAD_PICKS. They were
--     NOT repointed at the real adoption:* usage reports — see PART C.
--   * `cost:unused-unassigned-licenses`. Still an ACTIVE catalog row; what
--     changed on 2026-08-05 is that it left the assess:copilot-readiness
--     package. license-waste-source.ts used to sort it to the front of the
--     /subscribedSkus candidates by NAME, so it kept being cited as the
--     provenance of the tenant's live licence figures off a stale stored page.
--     Provenance now follows `collected_at` recency. See PART D.
--   * Anything resolving as `unknown_check_key` / `unknown_metric_key` /
--     `resolver_error` is now logged at error server-side and excluded from the
--     customer-facing document — those are our defects, not statements about
--     the tenant's environment.
--
-- WHAT THIS FILE IS FOR — three things the repo genuinely cannot answer:
--   PART A  Capture the catalog, so the new contract test can check exact keys
--           instead of only the dated deny list.
--   PART B  Settle the blast-radius three: do they exist, and if so is the
--           reader seeing "not in your scan package" (true, and correct) or
--           "not wired to a check" (our bug, and still present)?
--   PART C  Decide whether a real per-workload ACTIVE-USER count can exist.
--   PART D  Confirm the cost:unused-unassigned-licenses package state.
--
-- Replace 4 with the real customer id (tenants.id) throughout — the id the
-- #333, #341 and 2026-07-26 audits all used.


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — CAPTURE THE CATALOG (this is the deliverable that stops the bug
-- recurring; everything else here is diagnosis).
-- ════════════════════════════════════════════════════════════════════════════
--
-- `lib/dashboard-registry/src/sourceKeyContract.ts` holds
-- MONITOR_CHECK_CATALOG_SNAPSHOT, which ships EMPTY. While it is empty the
-- contract test can only fail on keys a previous audit already ruled out. Paste
-- A2's single output value into it and the test upgrades to a complete
-- membership check: every registry sourceKey, and every stat a customer
-- document is grounded in, must name a key that exists. A rename then fails a
-- test run instead of reaching a customer's report.
--
-- Re-run and re-paste whenever checks are added or removed. `capturedOn` makes
-- a stale snapshot visible rather than silently authoritative.

-- A1 — eyeball it first: how big is the catalog, and what domains exist?
-- The `usage` row should be ABSENT. If it is present, #441's central premise is
-- wrong and the registry retirement above needs revisiting rather than the
-- catalog.
SELECT split_part(key, ':', 1) AS domain,
       count(*)                AS checks,
       count(*) FILTER (WHERE status = 'active') AS active
FROM monitor_checks
GROUP BY 1
ORDER BY 1;

-- A2 — the snapshot itself. Copy the single returned value verbatim into
-- MONITOR_CHECK_CATALOG_SNAPSHOT, and set capturedOn to today's date.
SELECT jsonb_pretty(jsonb_agg(key ORDER BY key)) AS keys_json
FROM monitor_checks
WHERE status = 'active';


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — THE BLAST-RADIUS THREE, AND EVERY OTHER KEY THE REPORT TOUCHES
-- ════════════════════════════════════════════════════════════════════════════
--
-- One row per check the Copilot Readiness Report can name, with the exact
-- reason the resolver will produce for customer 4. Read `expected_reason`:
--
--   'unknown_check_key'    → OUR bug. The registry sourceKey is wrong. It no
--                            longer reaches the customer (it is filtered and
--                            logged), but it must still be fixed — that stat can
--                            never render for anyone.
--   'not_in_scan_package'  → TRUE and correct to show. The check is real; this
--                            tenant's packages do not curate it. PART B2 is the
--                            fix if the figure is wanted in the report.
--   'no_data'              → real, in the scan, reported nothing.
--   'has value'            → renders as a number; nothing to do.
--
-- The three from the screenshot are marked. If they come back
-- 'not_in_scan_package', the report is already behaving correctly for them and
-- the remaining work is curation (B2), not code.
WITH report_checks (source_key, note) AS (VALUES
  ('copilot:overshare-exposure',       'blast radius — security.blastRadius, from the screenshot'),
  ('compliance:overshared-sites',      'blast radius — governance.overshared, from the screenshot'),
  ('compliance:sharepoint-sites',      'blast radius — governance.sites, from the screenshot'),
  ('identity:legacy-auth-usage',       'prerequisites'),
  ('identity:mfa-registration',        'prerequisites'),
  ('identity:global-admin-count',      'prerequisites'),
  ('intune:non-compliant-devices',     'prerequisites — intune:* existence still unconfirmed (#341 s3c)'),
  ('intune:unencrypted-devices',       'prerequisites — same'),
  ('intune:outdated-devices',          'prerequisites — same'),
  ('licensing:inactive-user-licenses', 'prerequisites'),
  ('identity:ca-policy-count',         'named as a coverage gap in code; real check, no registry metric'),
  ('cost:unused-unassigned-licenses',  'licence figures provenance — see PART D')
), scanned_packages AS (
  SELECT DISTINCT package_key FROM msp_diagnostic_runs WHERE customer_id = 4
), scanned_checks AS (
  SELECT DISTINCT pc.check_key
  FROM monitoring_package_checks pc
  JOIN scanned_packages sp ON sp.package_key = pc.package_key
)
SELECT r.source_key,
       r.note,
       (mc.key IS NOT NULL)        AS exists_in_catalog,
       mc.status                   AS check_status,
       (sc.check_key IS NOT NULL)  AS in_a_scanned_package,
       p.collected_at,
       CASE
         WHEN mc.key IS NULL                 THEN 'unknown_check_key'
         WHEN p.check_key IS NOT NULL        THEN 'has value (or no_data if the mapping yields none)'
         WHEN sc.check_key IS NULL           THEN 'not_in_scan_package'
         ELSE                                     'no_data'
       END                         AS expected_reason
FROM report_checks r
LEFT JOIN monitor_checks mc ON mc.key = r.source_key
LEFT JOIN scanned_checks sc ON sc.check_key = r.source_key
LEFT JOIN LATERAL (
  SELECT tp.check_key, tp.collected_at
  FROM tenant_monitor_profiles tp
  JOIN tenants t ON t.tenant_id = tp.tenant_id
  WHERE t.id = 4 AND tp.check_key = r.source_key
  ORDER BY tp.collected_at DESC
  LIMIT 1
) p ON TRUE
ORDER BY expected_reason, r.source_key;

-- B2 — NOT RUN. The blast-radius line only becomes a real NUMBER if these three
-- are curated into a package this tenant is scanned with. No code change can
-- conjure the data, and each added check is another Graph call on every scan, so
-- this is Shane's costed decision — the same one #341 section 4 left open.
--
-- assess:copilot-readiness is the package the Copilot funnel runs (7 checks).
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'assess:copilot-readiness', v.check_key, v.sort_order
-- FROM (VALUES
--   ('compliance:sharepoint-sites',  9),
--   ('compliance:overshared-sites', 10),
--   ('copilot:overshare-exposure',  11)
-- ) AS v(check_key, sort_order)
-- WHERE EXISTS (SELECT 1 FROM monitor_checks c WHERE c.key = v.check_key AND c.status = 'active')
-- ON CONFLICT (package_key, check_key) DO NOTHING;
--
-- NOTE the sort_order values start at 9: assess:copilot-readiness's live rows
-- run 1,2,3,4,6,7,8 (5 is genuinely absent), so 9+ appends without colliding.


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — CAN A REAL PER-WORKLOAD ACTIVE-USER COUNT EXIST?
-- ════════════════════════════════════════════════════════════════════════════
--
-- The four `usage:*` keys were retired, not repointed, and this is why. The
-- nearest real checks are Graph usage-report DETAIL endpoints:
--
--   adoption:teams-activity-trend       /reports/getTeamsUserActivityUserDetail(period='D7')
--   adoption:sharepoint-onedrive-trend  /reports/getSharePointSiteUsageDetail(period='D7')
--   adoption:email-activity-trend       /reports/getEmailActivityUserDetail(period='D7')
--   adoption:overall-active-rate        /reports/getOffice365ActiveUserDetail(period='D7')
--
-- Each returns ONE ROW PER USER (or per SITE, for the SharePoint one). A metric
-- pointed at one of them takes the mapping's numeric targetField, and failing
-- that `_itemCount` — the row count. So "1,631 active Teams users" would in fact
-- be "1,631 licensed users", under a caption that says otherwise. That is the
-- #333 trap, and it is worse here because the number looks plausible.
--
-- C1 — read the mapping. Repointing is safe ONLY for a check whose mapping
-- declares a numeric targetField that genuinely means "active users". If none
-- does, the honest fix is a mapping change on the CHECK (or a new check), and
-- the registry stays on `not_collected:` until then.
SELECT key, label, status, method, endpoint, select_params, filter_params, properties, mapping
FROM monitor_checks
WHERE key LIKE 'adoption:%' OR key LIKE 'usage:%'
ORDER BY key;

-- C2 — what those checks have actually stored for this tenant. The most
-- promising is adoption:overall-active-rate: getOffice365ActiveUserDetail
-- carries per-workload lastActivityDate columns, so a per-workload active count
-- is derivable IF the mapping exposes them.
SELECT p.check_key, p.status, p.collected_at, p.item_count, p.extracted_properties
FROM tenant_monitor_profiles p
JOIN tenants t ON t.tenant_id = p.tenant_id
WHERE t.id = 4 AND (p.check_key LIKE 'adoption:%' OR p.check_key LIKE 'usage:%')
ORDER BY p.check_key, p.collected_at DESC;

-- C3 — belt and braces on the central premise. Expect ZERO rows.
SELECT key, status FROM monitor_checks WHERE key LIKE 'usage:%' ORDER BY key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — cost:unused-unassigned-licenses AND THE /subscribedSkus CANDIDATES
-- ════════════════════════════════════════════════════════════════════════════
--
-- Confirms the removal, and shows which check now legitimately supplies the
-- licence figures. license-waste-source.ts picks candidates by ENDPOINT (never
-- by key name) and, since #441, orders them by how recently each one's page was
-- collected. The `would_win` row is the checkKey the report will now cite.
SELECT c.key,
       c.status,
       c.endpoint,
       (SELECT string_agg(pc.package_key, ', ' ORDER BY pc.package_key)
          FROM monitoring_package_checks pc WHERE pc.check_key = c.key) AS in_packages,
       p.collected_at,
       (p.raw_response IS NOT NULL)                                     AS has_stored_page,
       rank() OVER (ORDER BY p.collected_at DESC NULLS LAST)            AS recency_rank
FROM monitor_checks c
LEFT JOIN LATERAL (
  SELECT tp.collected_at, tp.raw_response
  FROM tenant_monitor_profiles tp
  JOIN tenants t ON t.tenant_id = tp.tenant_id
  WHERE t.id = 4 AND tp.check_key = c.key
  ORDER BY tp.collected_at DESC
  LIMIT 1
) p ON TRUE
WHERE c.status = 'active' AND lower(c.endpoint) LIKE '%subscribedskus%'
ORDER BY recency_rank, c.key;

-- D2 — the removal itself, stated rather than assumed.
-- Expect NO row for cost:unused-unassigned-licenses.
SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE package_key = 'assess:copilot-readiness'
ORDER BY sort_order;


-- ============================================================================
-- POST-RUN SUMMARY TO CAPTURE
--   1. PART A1: is there a `usage` domain? Expect no. If there is, say so —
--      the code change assumed there is not.
--   2. PART A2: paste into MONITOR_CHECK_CATALOG_SNAPSHOT. This is the one
--      durable fix; everything else is this week's instance of the bug.
--   3. PART B: for each of the blast-radius three, the `expected_reason`. Any
--      'unknown_check_key' is a registry sourceKey still to correct.
--   4. PART C1: does ANY adoption:* mapping declare a numeric field that
--      honestly means active users? If yes, that is a follow-up issue (new
--      registry metrics + restored stat specs). If no, the adoption card stays
--      empty and the gap stays in WAR_ROOM_UNPRODUCIBLE_STATS.
--   5. PART D: which check now supplies the licence figures, and confirmation
--      that cost:unused-unassigned-licenses is out of the package.
-- ============================================================================

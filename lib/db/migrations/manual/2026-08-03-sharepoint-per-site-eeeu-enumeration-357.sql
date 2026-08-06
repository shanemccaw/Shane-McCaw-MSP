-- ============================================================================
-- #357 — SharePoint Per-Site EEEU (Everyone Except External Users) Enumeration
-- ============================================================================
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
-- Idempotent: ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Every SharePoint sharing check in the platform today reports a tenant-wide
-- AGGREGATE COUNT (compliance:overshared-sites is literally a number of sites).
-- Nothing enumerates WHICH sites, so a Copilot Readiness / Governance document
-- can only say "41 overshared sites", and the War Room Governance walk's
-- per-site cards are marked NOT WIRED for exactly this reason
-- (warRoomGovernanceWalk.ts). This adds the real per-site enumeration: site
-- name, site URL, and the sharing level(s) actually granted, per site.
--
-- ── THE GRAPH SHAPE — CONFIRMED, NOT ASSUMED (v1.0 reference, 2026-08-03) ────
-- Per-site sharing enumeration is NOT a single flat call, and the obvious
-- endpoint is the wrong one. Three routes were checked:
--
--   1. GET /sites/{siteId}/permissions — REJECTED.
--      learn.microsoft.com/en-us/graph/api/site-list-permissions?view=graph-rest-1.0
--      Its own example response contains nothing but
--      grantedToIdentitiesV2[].application entries: this is the Sites.Selected
--      APP-grant collection, not the site's user/group ACL. It also requires
--      Sites.FullControl.All (delegated AND application) — the same permission
--      wall sharepoint-admin.ts is already blocked behind. It can never surface
--      "Everyone except external users".
--
--   2. SharePoint Advanced Management "Data access governance" EEEU report —
--      REJECTED. learn.microsoft.com/en-us/sharepoint/data-access-governance-
--      everyone-except-external-user-report + .../powershell-for-data-access-
--      governance. Admin-centre / SPO PowerShell only
--      (Start-SPODataAccessGovernanceInsight) — there is NO Graph API. It needs
--      the separately-licensed SharePoint Advanced Management add-on, covers
--      only the TOP 100 sites over a trailing 28 days, and lags up to 24 hours.
--      None of that is a basis for an on-demand per-tenant assessment.
--
--   3. GET /sites/{siteId}/drive/root/permissions — CHOSEN.
--      learn.microsoft.com/en-us/graph/api/driveitem-list-permissions?view=graph-rest-1.0
--      Documented as "the effective sharing permissions on a driveItem",
--      INHERITED grants included. It is the one v1.0 surface that returns real
--      SharePoint principals: grantedToV2.siteUser / grantedToV2.siteGroup
--      carry the raw claim in `loginName`, and sharing links arrive as a `link`
--      facet carrying `scope` (anonymous | organization | users |
--      existingAccess — learn.microsoft.com/en-us/graph/api/resources/sharinglink).
--
--      >>> PERMISSIONS: Application permission Sites.Read.All is sufficient for
--          BOTH the enumeration and the per-site permission read, and
--          Sites.Read.All is ALREADY in REQUIRED_MT_SCOPES (graph.ts). No new
--          scope, and therefore NO tenant re-consent, is needed for this check.
--          (Contrast identity:pim-groups, which is still blocked on a scope
--          nobody has granted.) <<<
--
-- Site enumeration: GET /sites/getAllSites (v1.0, Application Sites.Read.All,
-- @odata.nextLink/$skiptoken paginated) — learn.microsoft.com/en-us/graph/api/
-- site-getallsites?view=graph-rest-1.0, documented as the way to enumerate every
-- site "in a non-multi-geo tenant" as well as across geographies.
--
-- ── THE CLAIM STRING ────────────────────────────────────────────────────────
-- EEEU is the SharePoint claim  c:0-.f|rolemanager|spo-grid-all-users/{tenantId}
-- and "Everyone" (which INCLUDES external users) is  c:0(.s|true .
-- The code matches EEEU by PREFIX, not equality: the claim means "all members
-- of the tenant that owns the site" whatever GUID is stamped on it (older
-- tenants carry a different one), so pinning the GUID would silently miss real
-- EEEU grants.
--
-- ── EXECUTION MODEL — REUSED, NOT REINVENTED ────────────────────────────────
-- This runs on the SAME fan-out path identity:pim-groups already uses
-- (monitor-executor.ts :: runFanOutCheck, added by
-- 2026-07-24-fan-out-capability-and-pim-groups.sql): enumerate fan_out_source,
-- substitute each item's id into the endpoint's {itemId}, bounded concurrency,
-- per-request 429 backoff, honest "partial" status. Part B below adds two
-- NULLABLE, opt-in columns to that same path — no second execution model.
--
-- ── STORAGE — REUSED, NOT REINVENTED ────────────────────────────────────────
-- Nothing new is created to hold the results:
--   * the AGGREGATE counts land in tenant_monitor_profiles.extracted_properties,
--     exactly like every other check; and
--   * the FULL per-site list lands in tenant_check_item_details.items, via the
--     existing detail:full-item-collection package (#339). Part D links the new
--     check into that package — that is the entire "full per-item detail" wiring.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect: the two aggregate-only sharing checks the registry already points at
-- (lib/dashboard-registry/src/metrics.ts sourceKeys), and NO row for the new
-- key. If compliance:eeeu-site-sharing already exists, Part C is a no-op and
-- you are re-running this file — which is safe.

SELECT key, label, endpoint, fan_out_source, engines, status
FROM monitor_checks
WHERE key IN ('compliance:overshared-sites', 'compliance:sharepoint-sites', 'compliance:eeeu-site-sharing')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — SCHEMA: two additive, NULLABLE fan-out columns
-- ══════════════════════════════════════════════════════════════════════════════
-- Mirrors lib/db/src/schema/msp.ts :: monitorChecksTable. Both are NULL for
-- every existing row, and NULL means "behave exactly as before", so no current
-- check changes in any way.
--
-- WHY EACH ONE IS NEEDED (neither is speculative — the check below needs both):
--
--   fan_out_item_filter
--     /sites/getAllSites returns every user's OneDrive as isPersonalSite: true.
--     Without a filter those would each cost a Graph request AND consume the
--     fan_out_max_items budget ahead of the real SharePoint sites — so a
--     400-seat tenant's actual sites would be silently truncated away. The
--     filter is evaluated BEFORE the cap, using the SAME condition grammar
--     severity_rules already use (evalConditionGrammar), against each
--     enumerated source object.
--
--   fan_out_item_normalizer
--     The default fan-out flattens every per-item response into one anonymous
--     bag, which is right when the aggregate IS the answer (PIM's total
--     eligible assignments across all groups) and WRONG here: a bag of
--     permission objects has thrown away which site each came from, which is
--     precisely the count-not-a-list failure #357 exists to fix. A normalizer
--     receives the source item alongside its results and emits one row PER
--     SITE, carrying that site's real name and URL.
--
--     It stores a KEY into a code-owned registry (FAN_OUT_ITEM_NORMALIZERS in
--     monitor-executor.ts) and nothing else — never a script, never an
--     expression. That is the same contract ps_cmdlet_key already follows
--     against the ps container's own cmdlet allowlist. An unknown key is a hard
--     execution error, not a silent fall-back to raw flattening.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS fan_out_item_filter     text,
  ADD COLUMN IF NOT EXISTS fan_out_item_normalizer text;

COMMENT ON COLUMN monitor_checks.fan_out_item_filter IS
  'Optional condition-grammar expression evaluated against EACH enumerated fan-out source item; only items that pass are fanned out, and it is applied BEFORE fan_out_max_items. NULL = fan out to every enumerated item (prior behaviour).';
COMMENT ON COLUMN monitor_checks.fan_out_item_normalizer IS
  'Key into the code-owned FAN_OUT_ITEM_NORMALIZERS registry (monitor-executor.ts) — an identifier only, never a script, same contract as ps_cmdlet_key. Reshapes one source item''s per-item results before they join the flattened union, so a fan-out can emit one row per source item. NULL = flatten raw results (prior behaviour).';


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-03-sharepoint-per-site-eeeu-enumeration-357.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — THE CHECK
-- ══════════════════════════════════════════════════════════════════════════════
-- A NEW row, deliberately not a rewrite of compliance:overshared-sites.
-- compliance:overshared-sites is already consumed live by copilot-readiness.ts
-- (the SharePoint/Teams sub-indicator's numerator), war-room-pillar-stats.ts and
-- the metric registry; repointing it at a fan-out with a different
-- extracted_properties shape would change those numbers in the same commit that
-- introduces the enumeration. This lands alongside it, and rewiring consumers is
-- separate follow-up scope (see the FOLLOW-UP block at the foot of this file).
--
-- HOW THE MAPPING WORKS
--   The normalizer emits ONE row per site with boolean flags on it, so the
--   check's ordinary mapping rules count SITES rather than permission objects:
--     broadAccess         -> oversharedSiteCount        (any of the four kinds)
--     hasEeeu             -> eeeuSiteCount              (the #357 headline)
--     hasEveryone         -> everyoneSiteCount          ("Everyone", incl. external)
--     hasAnonymousLink    -> anonymousLinkSiteCount     ("Anyone with the link")
--     hasOrganizationLink -> organizationLinkSiteCount  (org-wide link)
--     siteId              -> sitesScanned               (the real denominator)
--     highestSharingLevel -> sitesByHighestSharingLevel (distribution)
--   Sites with NO broad sharing still emit a row: "we looked and it is clean" is
--   a different statement from "we never looked", and sitesScanned has to be a
--   real denominator for any ratio built on it to be real.
--
-- SEVERITY ORDER MATTERS: classifySeverity returns the FIRST rule that matches,
-- so the rules are ordered most-severe-first. An anonymous link outranks EEEU
-- because it needs no sign-in at all.
--
-- fan_out_max_items = 400 (below the platform default of 500) because each item
-- here is one extra Graph round trip against a tenant that is being scanned
-- concurrently by the scoring run. Truncation is never silent: it lands in
-- _fanOut.truncated and in the row's error_message.

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "fan_out_source", "fan_out_item_id_field", "fan_out_max_items",
  "fan_out_item_filter", "fan_out_item_normalizer",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'compliance:eeeu-site-sharing',
  'Per-Site Broad Sharing (EEEU)',
  'Real per-SITE enumeration of broad SharePoint sharing — site name, site URL and sharing level per site, not a tenant aggregate (#357). Fans /sites/getAllSites out to GET /sites/{itemId}/drive/root/permissions, the one v1.0 surface that returns actual SharePoint principals (grantedToV2.siteUser/siteGroup carry the claim in loginName) and sharing links (link.scope). Recognises four broad kinds, most→least severe: anonymous_link (link.scope=anonymous, no sign-in), everyone (claim c:0(.s|true, INCLUDES external users), eeeu (claim c:0-.f|rolemanager|spo-grid-all-users/{tenantId}), organization_link (link.scope=organization). link.scope users/existingAccess and ordinary named users/site groups are deliberately NOT findings. Personal OneDrive sites are excluded by the fan-out item filter. App permission Sites.Read.All only — already in REQUIRED_MT_SCOPES, so no re-consent.',
  '/sites/{itemId}/drive/root/permissions',
  'GET',
  '/sites/getAllSites',
  'id',
  400,
  '{{isPersonalSite}} != true',
  'sharepoint:site-sharing',
  '[]'::jsonb,
  '[{"sourceField":"broadAccess","targetField":"oversharedSiteCount","transform":"countTruthy"},
    {"sourceField":"hasEeeu","targetField":"eeeuSiteCount","transform":"countTruthy"},
    {"sourceField":"hasEveryone","targetField":"everyoneSiteCount","transform":"countTruthy"},
    {"sourceField":"hasAnonymousLink","targetField":"anonymousLinkSiteCount","transform":"countTruthy"},
    {"sourceField":"hasOrganizationLink","targetField":"organizationLinkSiteCount","transform":"countTruthy"},
    {"sourceField":"siteId","targetField":"sitesScanned","transform":"count"},
    {"sourceField":"highestSharingLevel","targetField":"sitesByHighestSharingLevel","transform":"groupByCount"}]'::jsonb,
  '[{"expression":"{{anonymousLinkSiteCount}} > 0","severity":"critical","label":"One or more sites are shared with an anonymous \"Anyone with the link\" grant"},
    {"expression":"{{everyoneSiteCount}} > 0","severity":"critical","label":"One or more sites are shared with Everyone, which includes external users"},
    {"expression":"{{eeeuSiteCount}} > 0","severity":"warning","label":"One or more sites are shared with Everyone except external users"},
    {"expression":"{{organizationLinkSiteCount}} > 0","severity":"info","label":"One or more sites carry an organization-wide sharing link"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — WIRE THE FULL PER-SITE LIST INTO THE EXISTING DETAIL TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- This is the entire "full per-item detail" wiring — no new table, no new
-- runner. detail:full-item-collection (#339) already runs its linked checks with
-- includeItems: true and persists each COMPLETE item list to
-- tenant_check_item_details.items. For this check, that item list IS the per-site
-- record set (one row per site, carrying siteName/siteUrl/highestSharingLevel/
-- grants), which is what document generation and the War Room per-site cards
-- will read.
--
-- Note the #339 migration populated that junction by INSERT..SELECT over the
-- checks active AT THE TIME, so a newly-inserted check needs this row explicitly.
--
-- sort_order is set past the current maximum so the existing deterministic run
-- order is not disturbed.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  'compliance:eeeu-site-sharing',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — OPTIONAL: also run it inside the SCORING scan (Shane's call)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT done automatically, on purpose. core:security-baseline is a deliberately
-- curated entry-tier subset (29 of ~133 checks — see
-- 2026-07-21-repopulate-monitoring-package-checks.sql), and this is the most
-- expensive check in the catalog: one Graph request per non-personal site, on
-- top of the scoring scan already running. Left out of it, the check still runs
-- and still writes its tenant_monitor_profiles row on every detail collection
-- (executeMonitorCheck always does), so the aggregate counts are collected
-- either way — it simply does not lengthen the entry-tier scan.
--
-- >>> SHANE: uncomment to add it to the scored baseline as well. Note engines
--     is ["compliance"] on the check above, so doing this makes it recompute the
--     compliance engine after each scan.
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'core:security-baseline', 'compliance:eeeu-site-sharing',
--        COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
--                   WHERE package_key = 'core:security-baseline'), -1) + 1
-- ON CONFLICT (package_key, check_key) DO NOTHING;
-- <<<


-- ══════════════════════════════════════════════════════════════════════════════
-- PART F — READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect one check row with both new columns populated, and detail_package_rows
-- = 1. If detail_package_rows = 0, the #339 migration has not been run on this
-- database — run it first, then re-run Part D.

SELECT
  key, label, endpoint, fan_out_source, fan_out_item_id_field, fan_out_max_items,
  fan_out_item_filter, fan_out_item_normalizer, engines, status
FROM monitor_checks
WHERE key = 'compliance:eeeu-site-sharing';

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'compliance:eeeu-site-sharing')                       AS check_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'detail:full-item-collection'
      AND check_key = 'compliance:eeeu-site-sharing')                 AS detail_package_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'core:security-baseline'
      AND check_key = 'compliance:eeeu-site-sharing')                 AS scoring_package_rows;


-- ── AFTER THE FIRST REAL SCAN — the honesty check ───────────────────────────
-- The per-site list, straight out of the detail table. If `items` is NULL,
-- read items_omitted_reason: the row holds the FULL list or none of it, never a
-- prefix, so a document can never under-report from it.

-- SELECT d.tenant_id, d.status, d.item_count, d.items_omitted_reason,
--        s->>'siteName'             AS site_name,
--        s->>'siteUrl'              AS site_url,
--        s->>'highestSharingLevel'  AS sharing_level,
--        s->'grants'                AS grants
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS s
-- WHERE d.check_key = 'compliance:eeeu-site-sharing'
--   AND (s->>'broadAccess')::boolean IS TRUE
-- ORDER BY d.collected_at DESC, s->>'siteName';

-- And the aggregate side, from the ordinary profile row:
-- SELECT tenant_id, status, severity_matched, collected_at,
--        extracted_properties->'sitesScanned'                AS sites_scanned,
--        extracted_properties->'eeeuSiteCount'               AS eeeu_sites,
--        extracted_properties->'anonymousLinkSiteCount'      AS anon_link_sites,
--        extracted_properties->'sitesByHighestSharingLevel'  AS by_level,
--        extracted_properties->'_fanOut'                     AS fan_out_coverage
-- FROM tenant_monitor_profiles
-- WHERE check_key = 'compliance:eeeu-site-sharing'
-- ORDER BY collected_at DESC
-- LIMIT 20;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
-- #357's scope note is explicit that consumers are separate work, and none of it
-- should land before the enumeration has been confirmed against a real tenant:
--
--   * Document generation naming the real affected sites instead of a count.
--   * The War Room Governance walk's per-site NOT WIRED cards (per-site file
--     counts, the "3 sites carry 78% of the exposure" concentration headline,
--     anonymous link counts) — warRoomGovernanceWalk.ts.
--   * A metric-registry entry (lib/dashboard-registry/src/metrics.ts) pointing a
--     metric at sourceKey 'compliance:eeeu-site-sharing'. Note the registry's
--     existing compliance.oversharedSiteCount still points at
--     compliance:overshared-sites and is UNCHANGED by this file.
--   * war_room_pillar_stat_specs coverage for the new check.
--
-- One real gap worth recording rather than hiding: this reads the DEFAULT
-- document library root of each site. A site whose oversharing lives only on a
-- non-default library, a subsite, or an individual file will not be caught —
-- Graph exposes no tenant-wide "all shared items" enumeration at v1.0, and
-- walking every drive item of every site is a different order of cost. The check
-- reports what it genuinely covered (_fanOut), so nothing here claims otherwise.

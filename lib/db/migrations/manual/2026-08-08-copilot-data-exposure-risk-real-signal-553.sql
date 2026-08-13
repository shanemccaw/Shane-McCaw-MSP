-- ============================================================================
-- #553 — copilot:data-exposure-risk: a bare count of all sites → a real signal
-- ============================================================================
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
-- Idempotent: the UPDATE is guarded on the DEFECTIVE config, so re-running the
-- file after it has applied is a no-op rather than a second rewrite.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
-- Confirmed live on tenant c4c814d4-3afe-441e-9145-62461d0a4fd3 (2026-08-08):
--
--   endpoint            /sites
--   fan_out_source      NULL
--   fan_out_item_filter NULL
--   mapping             [{transform:"count", sourceField:"id",
--                         targetField:"copilotExposedSiteCount"}]
--
-- That is count(id) over every SharePoint site in the tenant. There is no
-- filter, no fan-out, and no per-site condition, so `copilotExposedSiteCount`
-- equals the number of sites — 99 — and a freshly generated copilot_readiness
-- document stated "All 99 of 99 scanned SharePoint sites are flagged as
-- Copilot-exposed" and used it as THE reason deployment must not proceed.
--
-- The same tenant's already-correct per-site broad-sharing check
-- (compliance:eeeu-site-sharing, #357) found exactly ONE genuinely oversharing
-- site out of the same 99. The claim overstated the known-real number ~99x on
-- the platform's highest-stakes go/no-go statement.
--
-- ============================================================================
-- PART 0 — INVESTIGATION: what Microsoft actually defines as Copilot exposure
-- ============================================================================
-- #553 required this be established from Microsoft's own guidance before any
-- definition was assumed, to #357's standard (name what was checked and
-- rejected, and why). All references read 2026-08-08.
--
-- ── THE DEFINITION, FROM MICROSOFT ──────────────────────────────────────────
-- learn.microsoft.com/en-us/microsoft-365/copilot/get-ready-copilot-sharepoint-
-- advanced-management, opening line:
--
--   "Copilot and agents retrieve data from Microsoft Graph and RESPECT
--    EXISTING PERMISSIONS, SHARING SETTINGS, AND POLICIES."
--
-- Copilot therefore grounds on whatever the ASKING USER can already reach. The
-- sites that widen that blast radius are the ones where the whole tenant (or
-- wider) already holds access. The same article's "Identify high-risk sites"
-- section lists Microsoft's own risk signals, first among them:
--
--   * "Broad sharing through 'Anyone,' 'Everyone,' and organization-wide links"
--   * "Large audiences with excessive permissions"
--   * "Broken permission inheritance and complex access models"
--   * "Sensitive content with weak protection"
--   * "Unlabeled or public sites"
--   * "Governance gaps with ownerless, inactive, or unreviewed sites"
--
-- and adds: "Sites where MULTIPLE RISK SIGNALS OVERLAP are considered high
-- risk."
--
-- The first bullet is exactly — name for name — the four broad-sharing kinds
-- #357 already classifies per site from real Graph payloads: anonymous_link
-- ("Anyone"), everyone ("Everyone", includes external users), eeeu (Everyone
-- except external users) and organization_link (organization-wide link).
-- Microsoft's Copilot blueprint says the same in its remediation step:
-- "Remove excess users, groups, and company-wide sharing links (including
-- EEEU)" (learn.microsoft.com/en-us/microsoft-365/copilot/configure-secure-
-- governed-data-foundation-microsoft-365-copilot, Step 1).
--
-- So the corrected metric is: the number of sites carrying REAL broad sharing —
-- `broadAccess` on #357's per-site row — out of a REAL scanned denominator.
--
-- ── WHAT WAS CHECKED AND REJECTED ───────────────────────────────────────────
--
--   1. SharePoint Advanced Management "Data access governance" reports
--      (site permissions snapshot, EEEU activity, sharing links activity) —
--      REJECTED, and this is the SECOND time (#357 rejected it for the same
--      reasons; nothing has changed).
--      learn.microsoft.com/en-us/sharepoint/data-access-governance-reports +
--      .../powershell-for-data-access-governance. Admin-centre / SPO PowerShell
--      only (Start-SPODataAccessGovernanceInsight) — there is NO Graph API.
--      The EEEU activity report covers the TOP 100 sites over a trailing 28
--      days and lags up to 24 hours; activity reports without SAM require data
--      collection to be enabled 24h in advance and pause after 3 months of
--      disuse. None of that is a basis for an on-demand per-tenant assessment.
--
--   2. Purview DSPM data risk assessments ("overshared sites with sensitive
--      data") — REJECTED. The Copilot blueprint's own first recommendation
--      (configure-secure-governed-data-foundation..., Step 1), but it is a
--      Purview portal experience with no Graph read surface, and it depends on
--      sensitive-information-type detection this platform does not run.
--
--   3. Restricted Content Discovery (RCD) state per site — REJECTED. This
--      would be the single most Copilot-specific signal there is (RCD exists
--      precisely to "prevent content from appearing in Copilot or agentic
--      experiences"), but it is set in the SharePoint admin centre or SPO
--      PowerShell, and the Graph v1.0 `site` resource exposes no such property
--      — see 4. learn.microsoft.com/en-us/sharepoint/restricted-content-discovery
--
--   4. PER-SITE SENSITIVITY-LABEL COVERAGE — REJECTED, and this one matters
--      because #553 explicitly floated "broad sharing AND absent sensitivity
--      labels" as the likely definition. It is not obtainable:
--        * The Graph v1.0 `site` resource's property table
--          (learn.microsoft.com/en-us/graph/api/resources/site?view=graph-rest-1.0)
--          is createdDateTime, description, eTag, id, isPersonalSite,
--          lastModifiedDateTime, name, root, sharepointIds, siteCollection,
--          webUrl. There is NO sensitivity label property, and no label
--          relationship. /sites/getAllSites cannot return one.
--        * The platform's two existing label checks — copilot:sensitivity-
--          labels-exist and governance:sensitivity-label-adoption — BOTH read
--          /security/dataSecurityAndGovernance/sensitivityLabels, which is the
--          tenant's label CATALOGUE (the labels available across the tenant).
--          It is tenant-scoped by construction; it carries no per-site or
--          per-file application data. Joining it to a site would be inventing
--          the fact, which is the exact defect class #553 exists to remove.
--        * Real per-FILE label data does exist (driveItem: extractSensitivity-
--          Labels, v1.0) but it is one POST per file — walking every file of
--          every site is orders of magnitude beyond a scan budget.
--        * Real per-SITE-CONTAINER label data exists only as a Microsoft 365
--          GROUP's `assignedLabels`, which covers ONLY group-connected sites.
--          Using it would silently score every communication site and classic
--          site as "unlabelled", i.e. re-introduce a fabricated count in a new
--          place. It also needs a second enumeration and a group→site join the
--          fan-out executor has no mechanism for.
--      Conclusion: absent sensitivity-label coverage is REAL guidance but is
--      NOT reachable per site from anything this platform can call today. It is
--      therefore deliberately NOT part of this metric. The overlap condition
--      Microsoft describes is implemented instead as the SHARING-KIND tiering
--      the severity rules below apply, which is derived entirely from data
--      Graph really returns.
--
-- ── ARCHITECTURE: reuse #357, do not duplicate it ───────────────────────────
-- #553 asked whether this check should consume compliance:eeeu-site-sharing's
-- per-site output directly rather than re-deriving a separate enumeration.
-- Both routes were examined:
--
--   A. A new `derived` executor type reading the sibling check's stored rows
--      from tenant_check_item_details — REJECTED. executeMonitorCheck's
--      executor types (graph / powershell / sharepoint-admin / dns) are all
--      "go and collect a real fact"; a derived type would be the first that
--      reads another check's OUTPUT, which introduces a cross-check ordering
--      dependency the package runner does not model. Worse, it is silently
--      stale by construction: compliance:eeeu-site-sharing is a member of
--      detail:full-item-collection and NOT of the scoring package (#357 Part E
--      was deliberately left commented out), so during a scoring scan the row
--      it would read may be hours or days old, or absent — and the check would
--      report a number with no honest way to say which scan it came from.
--
--   B. Share #357's VERIFIED GRAPH ROUTE AND ITS PER-SITE DERIVATION CODE, and
--      differ only in how the rows are aggregated — CHOSEN, and applied below.
--      This check now uses the identical fan_out_source, endpoint,
--      fan_out_item_filter and fan_out_item_normalizer as #357. The normalizer
--      key 'sharepoint:site-sharing' resolves to normalizeSiteSharing in
--      artifacts/api-server/src/lib/sharepoint-sharing.ts, so every judgement
--      about what counts as broad — the EEEU claim prefix match, the
--      link.scope handling, the "users"/"existingAccess" exclusions, the
--      most→least severe ordering — is the SAME CODE, not a second
--      implementation that can drift from it. ZERO new TypeScript is required
--      by this migration.
--
--      What it costs, stated rather than hidden: when both checks run in the
--      same scan they each issue their own per-site Graph requests (the
--      executor's idempotency key is tenant:CHECK:trigger, so there is no
--      cross-check response reuse). Part A below prints both checks' package
--      membership so that cost is visible and deliberate. It is bounded by the
--      same fan_out_max_items = 400 cap and the same concurrency of 4.
--
--      Why not simply retire this check and let compliance:eeeu-site-sharing
--      emit copilotExposedSiteCount: because that check is engines=["compliance"]
--      and its severity labels are compliance-framed, while
--      signal.copilot.data-exposure-risk is the copilot pillar's highest-
--      weighted signal (copilot_impact 90). Moving the finding across pillars
--      is a document-behaviour change, which #553 puts explicitly out of scope.
--
-- ── FIELD NAMING ────────────────────────────────────────────────────────────
-- `copilotExposedSiteCount` is KEPT as the headline target field. It is the
-- literal source_key of signal_derivation_rules → signal.copilot.data-exposure-
-- risk, and source_key resolves as a mapping targetField against the merged
-- tenant profile (tenant-signals.ts). Renaming it would silently unwire the
-- signal. Only its MEANING is corrected.
--
-- Every other new field is prefixed `copilot*` on purpose: the merged profile
-- is a flat union across checks (#544), and compliance:eeeu-site-sharing
-- already publishes sitesScanned / eeeuSiteCount / everyoneSiteCount /
-- anonymousLinkSiteCount / organizationLinkSiteCount / sitesByHighestSharing-
-- Level. Reusing those names here would create a merge collision on every
-- scan — benign today because both checks read the same enumeration, and a
-- trap the first time they diverge.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect the defective row described at the top of this file, and — for
-- contrast — #357's correct one. If copilot:data-exposure-risk already shows
-- fan_out_source = '/sites/getAllSites', this file has already been applied and
-- Part B will correctly do nothing.

SELECT
  key, label, endpoint, method,
  fan_out_source, fan_out_item_id_field, fan_out_max_items,
  fan_out_item_filter, fan_out_item_normalizer,
  select_params, filter_params,
  properties, mapping, severity_rules, output_schema,
  executor_type, engines, schema_version, status
FROM monitor_checks
WHERE key IN ('copilot:data-exposure-risk', 'compliance:eeeu-site-sharing')
ORDER BY key;

-- Package membership for BOTH checks — this is the per-site Graph cost picture.
-- Any package listing both will issue two independent per-site sweeps.
SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key IN ('copilot:data-exposure-risk', 'compliance:eeeu-site-sharing')
ORDER BY check_key, package_key;

-- The live fabricated value, for the before/after record.
SELECT tenant_id, status, severity_matched, severity_label, collected_at,
       extracted_properties->'copilotExposedSiteCount' AS copilot_exposed_site_count,
       item_count
FROM tenant_monitor_profiles
WHERE check_key = 'copilot:data-exposure-risk'
  AND tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
ORDER BY collected_at DESC
LIMIT 5;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — THE FIX
-- ══════════════════════════════════════════════════════════════════════════════
-- MAPPING — every rule reads a field normalizeSiteSharing really emits:
--
--   broadAccess         -> copilotExposedSiteCount              (THE fix: sites
--                          with at least one of Microsoft's four broad grants,
--                          not every site that exists)
--   siteId              -> copilotSitesScanned                  (the real
--                          denominator, so a finding can say "3 of 99")
--   hasAnonymousLink    -> copilotAnonymousLinkSiteCount        ("Anyone")
--   hasEveryone         -> copilotEveryoneSiteCount             ("Everyone",
--                          INCLUDES external users)
--   hasEeeu             -> copilotEeeuSiteCount                 (EEEU)
--   hasOrganizationLink -> copilotOrganizationLinkSiteCount     (org-wide link)
--   highestSharingLevel -> copilotExposureByHighestSharingLevel (distribution)
--
-- Sites with NO broad sharing still emit a row from the normalizer, so
-- copilotSitesScanned is a genuine denominator — "we looked and it is clean" is
-- a different statement from "we never looked".
--
-- SEVERITY — classifySeverity returns the FIRST matching rule, so these are
-- ordered most-severe-first, in Microsoft's own broad-sharing order and in the
-- same order #357 uses (BROAD_SHARING_KINDS: anonymous_link > everyone > eeeu >
-- organization_link). An anonymous link outranks EEEU because it needs no
-- sign-in at all. Labels interpolate {{path}} against this run's own extracted
-- data (#418) and always name the real denominator, so no finding can ever
-- again read as "all N of N" unless that is genuinely true.
--
-- ALSO CLEARED, and each for a reason:
--   select_params / filter_params -> NULL. They were authored against the flat
--     /sites call; on the fan-out path appendQueryParams applies them to the
--     PER-ITEM endpoint (/sites/{itemId}/drive/root/permissions), where a
--     $select written for a site would drop the permission fields the
--     normalizer reads.
--   properties -> '[]'. Named-property extraction was pointed at site objects;
--     the items are now per-site summary rows, so any stale name would extract
--     nulls into extracted_properties.
--   output_schema -> NULL. validateOutputShape runs on the fan-out path too, so
--     a schema describing the old flat shape would mark every future run
--     _schemaValid = false.
--   schema_version -> +1. The extracted_properties shape genuinely changes, and
--     that column is what tells a stored profile row which shape it holds.

BEGIN;

UPDATE monitor_checks
SET
  description = 'Counts SharePoint sites that carry REAL broad sharing — the exposure Microsoft names first when identifying high-risk sites for Copilot ("Broad sharing through ''Anyone,'' ''Everyone,'' and organization-wide links", learn.microsoft.com/en-us/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management), because "Copilot and agents retrieve data from Microsoft Graph and respect existing permissions, sharing settings, and policies" — it grounds on whatever the asking user can already reach. Fixed in #553: this was previously count(id) over /sites, i.e. every site in the tenant, which reported 100% of sites as Copilot-exposed. Deliberately shares #357''s verified Graph route and its per-site derivation code rather than re-deriving a second site enumeration: same fan_out_source (/sites/getAllSites), same per-item endpoint (/sites/{itemId}/drive/root/permissions — the one v1.0 surface returning real SharePoint principals via grantedToV2.siteUser/siteGroup loginName claims and sharing links via link.scope), same personal-OneDrive filter, and the same code-owned normalizer (sharepoint:site-sharing → normalizeSiteSharing), so what counts as broad is one implementation, not two. Application permission Sites.Read.All only — already in REQUIRED_MT_SCOPES, so no re-consent. NOT included: per-site sensitivity-label coverage — the Graph v1.0 site resource carries no label property and /security/dataSecurityAndGovernance/sensitivityLabels is the tenant label catalogue, so it cannot be obtained per site; see the #553 migration for the full rejected-candidate list.',
  endpoint                = '/sites/{itemId}/drive/root/permissions',
  method                  = 'GET',
  fan_out_source          = '/sites/getAllSites',
  fan_out_item_id_field   = 'id',
  fan_out_max_items       = 400,
  fan_out_item_filter     = '{{isPersonalSite}} != true',
  fan_out_item_normalizer = 'sharepoint:site-sharing',
  -- Explicit rather than assumed: only executor_type 'graph' reaches the
  -- fan-out branch in executeMonitorCheck. A row left on any other executor
  -- would ignore every fan_out_* column above without saying so.
  executor_type           = 'graph',
  select_params           = NULL,
  filter_params           = NULL,
  properties              = '[]'::jsonb,
  output_schema           = NULL,
  mapping = '[{"sourceField":"broadAccess","targetField":"copilotExposedSiteCount","transform":"countTruthy"},
    {"sourceField":"siteId","targetField":"copilotSitesScanned","transform":"count"},
    {"sourceField":"hasAnonymousLink","targetField":"copilotAnonymousLinkSiteCount","transform":"countTruthy"},
    {"sourceField":"hasEveryone","targetField":"copilotEveryoneSiteCount","transform":"countTruthy"},
    {"sourceField":"hasEeeu","targetField":"copilotEeeuSiteCount","transform":"countTruthy"},
    {"sourceField":"hasOrganizationLink","targetField":"copilotOrganizationLinkSiteCount","transform":"countTruthy"},
    {"sourceField":"highestSharingLevel","targetField":"copilotExposureByHighestSharingLevel","transform":"groupByCount"}]'::jsonb,
  severity_rules = '[{"expression":"{{copilotAnonymousLinkSiteCount}} > 0","severity":"critical","label":"{{copilotAnonymousLinkSiteCount}} of {{copilotSitesScanned}} scanned SharePoint sites are shared with an anonymous \"Anyone with the link\" grant — that content needs no sign-in at all, and Copilot grounds on whatever the asking user can already reach"},
    {"expression":"{{copilotEveryoneSiteCount}} > 0","severity":"critical","label":"{{copilotEveryoneSiteCount}} of {{copilotSitesScanned}} scanned SharePoint sites are shared with Everyone, which includes external guests — Copilot surfaces that content to every user who can already reach it"},
    {"expression":"{{copilotEeeuSiteCount}} > 0","severity":"warning","label":"{{copilotEeeuSiteCount}} of {{copilotSitesScanned}} scanned SharePoint sites are shared with Everyone except external users — every internal user already holds standing access, so Copilot can surface that content to all of them"},
    {"expression":"{{copilotOrganizationLinkSiteCount}} > 0","severity":"info","label":"{{copilotOrganizationLinkSiteCount}} of {{copilotSitesScanned}} scanned SharePoint sites carry an organization-wide sharing link"}]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'copilot:data-exposure-risk'
  -- Guard: only rewrite the DEFECTIVE row. Re-running this file after it has
  -- applied is a no-op, and it will not silently overwrite a different fix
  -- someone else landed in the meantime.
  AND fan_out_source IS DISTINCT FROM '/sites/getAllSites';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — READ-ONLY: verify the config landed
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect: rewritten = 1 on the first run, 0 on any re-run, and normalizer_ok =
-- true. If normalizer_ok is false the fan-out will THROW at execution time
-- (resolveFanOutItemNormalizer treats an unknown key as a hard error rather
-- than silently flattening raw permission objects) — that is by design, but it
-- means the api-server build predates #357 and must be deployed first.

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'copilot:data-exposure-risk'
      AND fan_out_source = '/sites/getAllSites'
      AND fan_out_item_normalizer = 'sharepoint:site-sharing'
      AND endpoint = '/sites/{itemId}/drive/root/permissions'
      AND mapping @> '[{"targetField":"copilotExposedSiteCount","transform":"countTruthy"}]'::jsonb
  ) AS rewritten,
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'copilot:data-exposure-risk'
      AND mapping @> '[{"transform":"count","sourceField":"id","targetField":"copilotExposedSiteCount"}]'::jsonb
  ) AS defect_remaining,   -- must be 0
  (SELECT fan_out_item_normalizer = 'sharepoint:site-sharing'
     FROM monitor_checks WHERE key = 'compliance:eeeu-site-sharing'
  ) AS normalizer_ok;      -- proves the shared normalizer key is the real one


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — AFTER THE NEXT REAL SCAN: the honesty check
-- ══════════════════════════════════════════════════════════════════════════════
-- Run a fresh scan for c4c814d4-3afe-441e-9145-62461d0a4fd3, then run these.
--
-- WHAT A CORRECT RESULT LOOKS LIKE:
--   * copilot_exposed_site_count is SMALL and strictly < copilot_sites_scanned.
--     It must NOT equal the site count. The pre-fix value was 99 of 99.
--   * copilot_eeeu_site_count matches compliance:eeeu-site-sharing's
--     eeeuSiteCount for the same tenant — known-real, and 1 on this tenant.
--   * copilot_exposed_site_count equals that check's oversharedSiteCount, since
--     both are broadAccess over the same enumeration. A mismatch means the two
--     runs saw different sites (different scan times / a truncated fan-out) —
--     check _fanOut on both rows before trusting either number.

-- SELECT tenant_id, status, severity_matched, severity_label, collected_at,
--        extracted_properties->'copilotExposedSiteCount'              AS copilot_exposed_site_count,
--        extracted_properties->'copilotSitesScanned'                  AS copilot_sites_scanned,
--        extracted_properties->'copilotAnonymousLinkSiteCount'        AS anon_link_sites,
--        extracted_properties->'copilotEveryoneSiteCount'             AS everyone_sites,
--        extracted_properties->'copilotEeeuSiteCount'                 AS eeeu_sites,
--        extracted_properties->'copilotOrganizationLinkSiteCount'     AS org_link_sites,
--        extracted_properties->'copilotExposureByHighestSharingLevel' AS by_level,
--        extracted_properties->'_fanOut'                              AS fan_out_coverage
-- FROM tenant_monitor_profiles
-- WHERE check_key = 'copilot:data-exposure-risk'
--   AND tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
-- ORDER BY collected_at DESC
-- LIMIT 3;

-- Side-by-side against the known-correct #357 check. The two right-hand columns
-- are the whole point of #553: they must agree.
-- SELECT
--   c.collected_at                                              AS copilot_collected_at,
--   e.collected_at                                              AS eeeu_collected_at,
--   c.extracted_properties->>'copilotSitesScanned'              AS copilot_sites_scanned,
--   e.extracted_properties->>'sitesScanned'                     AS eeeu_sites_scanned,
--   c.extracted_properties->>'copilotExposedSiteCount'          AS copilot_exposed,
--   e.extracted_properties->>'oversharedSiteCount'              AS eeeu_overshared,
--   c.extracted_properties->>'copilotEeeuSiteCount'             AS copilot_eeeu,
--   e.extracted_properties->>'eeeuSiteCount'                    AS eeeu_eeeu
-- FROM (SELECT * FROM tenant_monitor_profiles
--        WHERE check_key = 'copilot:data-exposure-risk'
--          AND tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
--        ORDER BY collected_at DESC LIMIT 1) c
-- CROSS JOIN (SELECT * FROM tenant_monitor_profiles
--        WHERE check_key = 'compliance:eeeu-site-sharing'
--          AND tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
--        ORDER BY collected_at DESC LIMIT 1) e;

-- And the sites themselves, by name, from #357's detail rows — so the number
-- above can be checked against a list a human can read.
-- SELECT s->>'siteName' AS site_name, s->>'siteUrl' AS site_url,
--        s->>'highestSharingLevel' AS sharing_level, s->'grants' AS grants
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS s
-- WHERE d.check_key = 'compliance:eeeu-site-sharing'
--   AND d.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
--   AND (s->>'broadAccess')::boolean IS TRUE
-- ORDER BY d.collected_at DESC, s->>'siteName';


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
--   * The copilot_readiness document's rendering and prompt behaviour around
--     this finding — #553 puts it out of scope until the number is right.
--   * Naming the affected sites in the document. The per-site list already
--     exists in tenant_check_item_details for compliance:eeeu-site-sharing
--     (#357 Part D); this check is deliberately NOT added to
--     detail:full-item-collection, because its item rows would be byte-for-byte
--     the same list under a second key.
--   * Whether both checks should share one scan. If Part A shows them in the
--     same package, that package now issues two per-site sweeps. Removing one
--     is a scoring change (engines differ: ["compliance"] vs the copilot
--     pillar), so it is Shane's call, not a silent edit here.
--   * The other checks named in #551 — separate issue, separate checks.
--
-- One real limit, inherited from #357 and restated rather than hidden: this
-- reads the DEFAULT document library root of each site. A site whose
-- oversharing lives only on a non-default library, a subsite, or an individual
-- file is not caught. Graph exposes no tenant-wide "all shared items"
-- enumeration at v1.0. The check reports what it genuinely covered in _fanOut,
-- so nothing here claims otherwise.


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-copilot-data-exposure-risk-real-signal-553.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

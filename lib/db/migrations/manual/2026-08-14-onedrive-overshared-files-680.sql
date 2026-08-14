-- ============================================================================
-- #680 — New check: OneDrive overshared files (zero coverage today)
-- ============================================================================
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
-- Idempotent: ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Confirmed via live repo grep 2026-08-10: OneDrive overshared files has zero
-- coverage anywhere in the current check catalog. The three existing
-- category:"onedrive" checks (onedrive:departed-user-access,
-- onedrive:external-sharing-settings, onedrive:storage-utilization) do no
-- file/permission-level scanning at all. This adds the real enumeration: which
-- personal OneDrive drives carry broad sharing, and what kind — the OneDrive
-- twin of #357's per-site SharePoint EEEU enumeration.
--
-- ── SEQUENCING ──────────────────────────────────────────────────────────────
-- Per #704's signed-off sequencing proposal, this is built AFTER #404
-- (onedrive:departed-user-access manager-based fix) specifically to avoid
-- overlapping edits to OneDrive exposure logic in the same window. #404 is
-- config-only (no code) and touches a different check key entirely, so there
-- is no actual overlap in what either migration writes.
--
-- ── WHY THIS REUSES #357'S CODE, NOT A NEW CLASSIFIER ──────────────────────
-- /sites/getAllSites (the SAME enumeration #357 already uses) models every
-- user's OneDrive as a `site` object with isPersonalSite: true, and
-- /sites/{itemId}/drive/root/permissions (the SAME endpoint #357 already uses)
-- returns the identical driveItem permission shape for a personal OneDrive
-- drive root as it does for a SharePoint site's drive root —
-- grantedToV2.siteUser/siteGroup carrying the claim in loginName, sharing
-- links carrying link.scope. #357's own header already documents rejecting
-- the two alternative routes (site-list-permissions' Sites.Selected-only
-- app-grant collection, and the admin-centre-only EEEU report with no Graph
-- API) — those rejections apply identically here, so they are not re-litigated.
--
-- This is therefore the SAME broad-sharing classification #357 ships
-- (artifacts/api-server/src/lib/sharepoint-sharing.ts:
-- classifySharingPermission/summarizeSiteSharing), reused rather than
-- re-derived, via a new thin module (onedrive-sharing.ts) that registers its
-- own fan-out normalizer key so the two checks' item lists stay distinct.
--
-- App permission Sites.Read.All only — already in REQUIRED_MT_SCOPES
-- (graph.ts), same as #357, so no new tenant consent is needed.
--
-- ── EXECUTION MODEL / STORAGE — REUSED, NOT REINVENTED ─────────────────────
-- Same fan-out path as #357 and identity:pim-groups (monitor-executor.ts ::
-- runFanOutCheck). fan_out_item_filter / fan_out_item_normalizer already exist
-- on monitor_checks (added by #357's migration) — the ADD COLUMN IF NOT
-- EXISTS below is a no-op if that migration already ran, and here purely so
-- this file is runnable standalone/idempotently regardless of run order.
-- Aggregate counts land in tenant_monitor_profiles.extracted_properties like
-- every check; the full per-drive list lands in tenant_check_item_details.items
-- via the existing detail:full-item-collection package (#339) — Part D wires it.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: what exists today (run first, keep the output)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect: the three existing zero-coverage onedrive:* checks, and NO row for
-- the new key. If onedrive:overshared-files already exists, Part C is a
-- no-op and you are re-running this file — which is safe.

SELECT key, label, endpoint, fan_out_source, engines, status
FROM monitor_checks
WHERE key IN ('onedrive:departed-user-access', 'onedrive:external-sharing-settings',
              'onedrive:storage-utilization', 'onedrive:overshared-files')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — SCHEMA: confirm the two fan-out columns #357 added (idempotent no-op
-- if already applied)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS fan_out_item_filter     text,
  ADD COLUMN IF NOT EXISTS fan_out_item_normalizer text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-onedrive-overshared-files-680.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — THE CHECK
-- ══════════════════════════════════════════════════════════════════════════════
-- HOW THE MAPPING WORKS
--   onedrive-sharing.ts's normalizer emits ONE row per OneDrive drive with the
--   same boolean flags #357's site rows carry, so the check's mapping rules
--   count DRIVES rather than permission objects:
--     broadAccess         -> oversharedDriveCount        (any of the four kinds)
--     hasEeeu             -> eeeuDriveCount               (EEEU / Copilot-oversharing case)
--     hasEveryone         -> everyoneDriveCount           ("Everyone", incl. external)
--     hasAnonymousLink    -> anonymousLinkDriveCount      ("Anyone with the link")
--     hasOrganizationLink -> organizationLinkDriveCount   (org-wide link)
--     siteId              -> drivesScanned                (the real denominator)
--     highestSharingLevel -> drivesByHighestSharingLevel  (distribution)
--   Drives with NO broad sharing still emit a row: "we looked and it is clean"
--   is a different statement from "we never looked".
--
-- fan_out_item_filter is the INVERSE of #357's ('{{isPersonalSite}} == true'
-- vs. '!= true') — this check exists specifically to enumerate the personal
-- OneDrive drives #357 deliberately excludes from its own scan.
--
-- SEVERITY ORDER MATTERS: classifySeverity returns the FIRST rule that
-- matches, so rules are ordered most-severe-first — identical reasoning to
-- #357: an anonymous link needs no sign-in at all, so it outranks EEEU.
--
-- fan_out_max_items = 400, same budget rationale as #357 (one extra Graph
-- round trip per item, against a tenant scanned concurrently by the scoring
-- run). Truncation is never silent — lands in _fanOut.truncated.

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "fan_out_source", "fan_out_item_id_field", "fan_out_max_items",
  "fan_out_item_filter", "fan_out_item_normalizer",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'onedrive:overshared-files',
  'OneDrive Overshared Files',
  'Real per-DRIVE enumeration of broad OneDrive sharing — which personal OneDrive drives carry broad sharing, and what kind (#680). Fans /sites/getAllSites out to GET /sites/{itemId}/drive/root/permissions, the same v1.0 surface #357 uses for SharePoint sites, filtered to isPersonalSite drives only (the inverse of #357''s filter). Reuses #357''s classification (artifacts/api-server/src/lib/sharepoint-sharing.ts) via a thin OneDrive-specific normalizer (onedrive-sharing.ts): anonymous_link (link.scope=anonymous, no sign-in), everyone (claim c:0(.s|true, INCLUDES external users), eeeu (claim c:0-.f|rolemanager|spo-grid-all-users/{tenantId}), organization_link (link.scope=organization). link.scope users/existingAccess and ordinary named grants are deliberately NOT findings. App permission Sites.Read.All only — already in REQUIRED_MT_SCOPES, so no re-consent.',
  '/sites/{itemId}/drive/root/permissions',
  'GET',
  '/sites/getAllSites',
  'id',
  400,
  '{{isPersonalSite}} == true',
  'onedrive:drive-sharing',
  '[]'::jsonb,
  '[{"sourceField":"broadAccess","targetField":"oversharedDriveCount","transform":"countTruthy"},
    {"sourceField":"hasEeeu","targetField":"eeeuDriveCount","transform":"countTruthy"},
    {"sourceField":"hasEveryone","targetField":"everyoneDriveCount","transform":"countTruthy"},
    {"sourceField":"hasAnonymousLink","targetField":"anonymousLinkDriveCount","transform":"countTruthy"},
    {"sourceField":"hasOrganizationLink","targetField":"organizationLinkDriveCount","transform":"countTruthy"},
    {"sourceField":"siteId","targetField":"drivesScanned","transform":"count"},
    {"sourceField":"highestSharingLevel","targetField":"drivesByHighestSharingLevel","transform":"groupByCount"}]'::jsonb,
  '[{"expression":"{{anonymousLinkDriveCount}} > 0","severity":"critical","label":"One or more OneDrive drives are shared with an anonymous \"Anyone with the link\" grant"},
    {"expression":"{{everyoneDriveCount}} > 0","severity":"critical","label":"One or more OneDrive drives are shared with Everyone, which includes external users"},
    {"expression":"{{eeeuDriveCount}} > 0","severity":"warning","label":"One or more OneDrive drives are shared with Everyone except external users"},
    {"expression":"{{organizationLinkDriveCount}} > 0","severity":"info","label":"One or more OneDrive drives carry an organization-wide sharing link"}]'::jsonb,
  '["compliance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — WIRE THE FULL PER-DRIVE LIST INTO THE EXISTING DETAIL TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- No new table, no new runner. detail:full-item-collection (#339) already runs
-- its linked checks with includeItems: true and persists each COMPLETE item
-- list to tenant_check_item_details.items — the same wiring #357 uses.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  'onedrive:overshared-files',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E — OPTIONAL: also run it inside the SCORING scan (Shane's call)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT done automatically, same reasoning as #357: core:security-baseline is a
-- deliberately curated entry-tier subset, and this is an expensive check (one
-- Graph request per OneDrive). Left out of it, the check still runs and still
-- writes its tenant_monitor_profiles row on every detail collection.
--
-- >>> SHANE: uncomment to add it to the scored baseline as well. Note engines
--     is ["compliance"] on the check above, so doing this makes it recompute
--     the compliance engine after each scan.
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'core:security-baseline', 'onedrive:overshared-files',
--        COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
--                   WHERE package_key = 'core:security-baseline'), -1) + 1
-- ON CONFLICT (package_key, check_key) DO NOTHING;
-- <<<


-- ══════════════════════════════════════════════════════════════════════════════
-- PART F — READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect one check row with both fan-out columns populated, and
-- detail_package_rows = 1. If detail_package_rows = 0, the #339 migration has
-- not been run on this database — run it first, then re-run Part D.

SELECT
  key, label, endpoint, fan_out_source, fan_out_item_id_field, fan_out_max_items,
  fan_out_item_filter, fan_out_item_normalizer, engines, status
FROM monitor_checks
WHERE key = 'onedrive:overshared-files';

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'onedrive:overshared-files')                       AS check_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'detail:full-item-collection'
      AND check_key = 'onedrive:overshared-files')                 AS detail_package_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'core:security-baseline'
      AND check_key = 'onedrive:overshared-files')                 AS scoring_package_rows;


-- ── AFTER THE FIRST REAL SCAN — the honesty check ───────────────────────────

-- SELECT d.tenant_id, d.status, d.item_count, d.items_omitted_reason,
--        s->>'siteName'             AS drive_owner,
--        s->>'siteUrl'              AS drive_url,
--        s->>'highestSharingLevel'  AS sharing_level,
--        s->'grants'                AS grants
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS s
-- WHERE d.check_key = 'onedrive:overshared-files'
--   AND (s->>'broadAccess')::boolean IS TRUE
-- ORDER BY d.collected_at DESC, s->>'siteName';

-- SELECT tenant_id, status, severity_matched, collected_at,
--        extracted_properties->'drivesScanned'                AS drives_scanned,
--        extracted_properties->'eeeuDriveCount'                AS eeeu_drives,
--        extracted_properties->'anonymousLinkDriveCount'       AS anon_link_drives,
--        extracted_properties->'drivesByHighestSharingLevel'   AS by_level,
--        extracted_properties->'_fanOut'                       AS fan_out_coverage
-- FROM tenant_monitor_profiles
-- WHERE check_key = 'onedrive:overshared-files'
-- ORDER BY collected_at DESC
-- LIMIT 20;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP — DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
-- Same honest gap #357 records: this reads the DEFAULT document library root of
-- each personal OneDrive. A file shared from a non-root folder is not caught —
-- Graph exposes no tenant-wide "all shared items" enumeration at v1.0, and
-- walking every drive item of every OneDrive is a different order of cost. The
-- check reports what it genuinely covered (_fanOut), so nothing here claims
-- otherwise.
--
-- Not wired here (separate follow-up scope, same as #357's FOLLOW-UP block):
--   * Document generation naming the real affected OneDrive owners.
--   * A metric-registry entry (lib/dashboard-registry/src/metrics.ts).
--   * war_room_pillar_stat_specs coverage for the new check.
-- ============================================================================

-- ============================================================================
-- #1117 — Governance: Public Groups (Group & Collaboration Sprawl)
-- ============================================================================
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude
-- env). Idempotent: ON CONFLICT DO NOTHING throughout.
--
-- ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
-- #1117 asked for three additions to GroupSprawl.tsx: Public Groups, Public
-- Teams, SharePoint EEEU. Investigation found the issue's "net-new checks for
-- all three" premise was only 1/3 right — governance:public-teams-discoverable
-- (#396) and compliance:eeeu-site-sharing (#357) already exist in the catalog
-- and run daily; both were deliberately left unwired to the metric registry
-- as follow-up scope in their own migration files. That wiring (metrics.ts +
-- GroupSprawl.tsx) ships in the same commit as this file, no schema change
-- needed for either. Public Groups (M365 Groups with public visibility — a
-- group need not be Team-provisioned to be publicly joinable via Outlook/
-- Groups) has no existing check at all — this file is that one genuinely new
-- check.
--
-- ── THE GRAPH SHAPE — mirrors #396's confirmed, not assumed, shape ──────────
-- GET /groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayName,visibility
-- One flat, paginated call — every M365 (Unified) Group, and `visibility`
-- (Public/Private/HiddenMembership) is a property on the group object
-- directly, exactly like #396's Team-backed subset. Public-group filtering
-- happens CLIENT-side (no server-side $filter support on `visibility`), via
-- the same countEquals('Public') mapping transform #396 used.
--
-- ── OVERLAP WITH PUBLIC TEAMS IS EXPECTED, NOT A BUG ─────────────────────────
-- Every Team is backed by an M365 Group, so a group that is BOTH Team-
-- provisioned and Public will be counted by this check AND by
-- governance:public-teams-discoverable. Deliberately not filtered out
-- (e.g. by excluding resourceProvisioningOptions containing 'Team'): the two
-- checks report two genuinely different join surfaces for the same
-- underlying object (Outlook/Groups membership vs the Teams app), and #396's
-- own precedent was "report every public team found, no filtering — a human
-- judges legitimacy, not the check." Same reasoning applies here.
--
-- ── PERMISSIONS — zero re-consent needed ─────────────────────────────────────
-- Directory.Read.All is already in REQUIRED_MT_SCOPES
-- (artifacts/api-server/src/lib/graph.ts) — confirmed by reading the file
-- before writing this migration. No new tenant consent required.
--
-- ── STORAGE — reused, not reinvented ─────────────────────────────────────────
--   * the aggregate publicGroupCount/groupsScanned land in
--     tenant_monitor_profiles.extracted_properties, same as every other check.
--   * the full per-group list (id, displayName, visibility) lands in
--     tenant_check_item_details.items, via the existing detail:full-item-
--     collection package (#339). Part B links the new check into that
--     package. No fan-out normalizer needed: the flat executor path already
--     returns `items` verbatim when includeItems is set — purely a
--     declarative monitor_checks row, same as #396.
--
-- Severity set to "warning" (not "critical"), matching #396's own precedent
-- for this exact class of "signal present" Governance exposure.
-- ============================================================================

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'governance:public-groups-discoverable',
  'Public Groups Discoverability',
  'Enumerates every Microsoft 365 (Unified) Group in the tenant (GET /groups?$filter=groupTypes/any(c:c eq ''Unified'')&$select=id,displayName,visibility) and reports how many are set to Public, meaning discoverable and joinable by anyone in the tenant via Outlook/Groups. Flat single call, no fan-out. Overlaps by design with governance:public-teams-discoverable for groups that are both Team-provisioned and Public -- the two checks cover different join surfaces for the same object, same "report everything, no allowlist" precedent as #396. Directory.Read.All is already in REQUIRED_MT_SCOPES, so no new tenant consent is required.',
  '/groups?$filter=groupTypes/any(c:c eq ''Unified'')&$select=id,displayName,visibility',
  'GET',
  '["id", "displayName", "visibility"]'::jsonb,
  '[{"sourceField":"visibility","targetField":"publicGroupCount","transform":"countEquals(''Public'')"},
    {"sourceField":"id","targetField":"groupsScanned","transform":"count"}]'::jsonb,
  '[{"expression":"{{publicGroupCount}} > 0","severity":"warning","label":"One or more Microsoft 365 Groups are set to Public and are discoverable/joinable by anyone in the tenant"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — WIRE THE FULL PER-GROUP LIST INTO THE EXISTING DETAIL TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- No new table, no new runner. detail:full-item-collection (#339) already runs
-- its linked checks with includeItems: true and persists each COMPLETE item
-- list to tenant_check_item_details.items — for this check, the raw fetched
-- Graph items (id, displayName, visibility, per group) ARE that list, exactly
-- the same pattern #396 used for its per-team list.
--
-- sort_order is set past the current maximum so existing deterministic run
-- order is not disturbed.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  'governance:public-groups-discoverable',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — OPTIONAL: also run it inside the SCORING scan (Shane's call)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT done automatically, on purpose — same reasoning as #396's Part C.
-- core:security-baseline is a deliberately curated entry-tier subset; this
-- check still runs and still writes its tenant_monitor_profiles row on every
-- detail collection (executeMonitorCheck always does), so the aggregate count
-- is collected either way even if left out of the entry-tier scan.
--
-- >>> SHANE: uncomment to add it to the scored baseline as well. engines is
--     ["governance"] on the check above, so doing this makes it recompute the
--     governance engine after each scan.
--
-- INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
-- SELECT 'core:security-baseline', 'governance:public-groups-discoverable',
--        COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
--                   WHERE package_key = 'core:security-baseline'), -1) + 1
-- ON CONFLICT (package_key, check_key) DO NOTHING;
-- <<<


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, engines, severity_rules, status
FROM monitor_checks
WHERE key = 'governance:public-groups-discoverable';

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'governance:public-groups-discoverable')               AS check_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'detail:full-item-collection'
      AND check_key = 'governance:public-groups-discoverable')         AS detail_package_rows;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-governance-public-groups-1117.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

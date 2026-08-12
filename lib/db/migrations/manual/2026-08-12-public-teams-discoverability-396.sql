-- ============================================================================
-- #396 — Public Teams Discoverability (Governance)
-- ============================================================================
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude
-- env). Idempotent: ON CONFLICT DO NOTHING throughout.
--
-- ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
-- Public Teams discoverability is one of four checks Shane named core to
-- Copilot security readiness alongside Conditional Access, SharePoint EEEU
-- sharing (#357/#394, landed) and sensitivity Labels (existence signal already
-- covered by copilot:sensitivity-labels-exist / governance:auto-labeling-
-- coverage). No existing check covers it today — this is new work, not a fix.
--
-- ── THE GRAPH SHAPE — CONFIRMED, NOT ASSUMED (Shane's 2026-08-10 comment) ────
-- GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')
--     &$select=id,displayName,visibility
-- One flat, paginated call. Every Team is backed by a Microsoft 365 Group, and
-- `visibility` (Public/Private/HiddenMembership) is a property on that group
-- object directly. This is NOT a fan-out check like #357's per-site EEEU
-- enumeration — no per-item sub-calls, a single enumeration+filter, so it runs
-- on the same unchanged flat 'graph' executor path every check before #357
-- used (fanOutSource stays NULL). Public-team filtering happens CLIENT-side
-- (the `visibility` property has no server-side $filter support), via the
-- countEquals('Public') mapping transform below.
--
-- ── PERMISSIONS — zero re-consent needed ─────────────────────────────────────
-- Directory.Read.All and Team.ReadBasic.All are both already in
-- REQUIRED_MT_SCOPES (artifacts/api-server/src/lib/graph.ts) — confirmed by
-- reading the file before writing this migration. Ships without any tenant
-- needing to re-consent, same clean situation #357 had with Sites.Read.All.
--
-- ── STORAGE — reused, not reinvented ─────────────────────────────────────────
--   * the aggregate publicTeamCount/teamsScanned land in
--     tenant_monitor_profiles.extracted_properties, same as every other check.
--   * the FULL per-team list (id, displayName, visibility — every team, not
--     just public ones, same "we looked and it's clean is different from we
--     never looked" reasoning #357 used for its per-site list) lands in
--     tenant_check_item_details.items, via the existing detail:full-item-
--     collection package (#339). Part B links the new check into that package.
--     No fan-out normalizer needed: the flat executor path already returns
--     `items` (the raw fetched Graph objects) verbatim when includeItems is
--     set, so no new code is required for this check at all — purely a
--     declarative monitor_checks row, same as security:insider-risk-alerts.
--
-- ── REAL DECISIONS, CONFIRMED WITH SHANE 2026-08-10 — do not re-litigate ─────
--   * Report EVERY public team found — no naming-pattern filter/allowlist for
--     "expected" public teams (all-hands, town halls, etc.). The human
--     reviewing results judges legitimacy, not the check.
--   * Pillar: Governance.
--
-- Severity set to "warning" (not "critical"), matching the same band the
-- Governance pillar's other "signal present" checks use for a comparable
-- non-scalar exposure (see 2026-08-06-sensitivity-label-severity-rules-470.sql
-- reference note: governance:auto-labeling-coverage's own falsy-signal pattern
-- is the "correct pattern" other Governance checks were aligned to).
-- ============================================================================

INSERT INTO "monitor_checks" (
  "key", "label", "description",
  "endpoint", "method",
  "properties", "mapping", "severity_rules",
  "engines", "frequency", "requires_customer_script",
  "schema_version", "status"
) VALUES (
  'governance:public-teams-discoverable',
  'Public Teams Discoverability',
  'Enumerates every Microsoft Team in the tenant (GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq ''Team'')&$select=id,displayName,visibility — every Team is backed by an M365 Group, and visibility is a property on that group object) and reports how many are set to Public, meaning discoverable and joinable by anyone in the tenant. Flat single call, no fan-out. Reports every public team found with no naming-pattern allowlist — a human judges legitimacy, not the check. Directory.Read.All and Team.ReadBasic.All are already in REQUIRED_MT_SCOPES, so no new tenant consent is required.',
  '/groups?$filter=resourceProvisioningOptions/Any(x:x eq ''Team'')&$select=id,displayName,visibility',
  'GET',
  '["id", "displayName", "visibility"]'::jsonb,
  '[{"sourceField":"visibility","targetField":"publicTeamCount","transform":"countEquals(''Public'')"},
    {"sourceField":"id","targetField":"teamsScanned","transform":"count"}]'::jsonb,
  '[{"expression":"{{publicTeamCount}} > 0","severity":"warning","label":"One or more Microsoft Teams are set to Public and are discoverable/joinable by anyone in the tenant"}]'::jsonb,
  '["governance"]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — WIRE THE FULL PER-TEAM LIST INTO THE EXISTING DETAIL TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- No new table, no new runner. detail:full-item-collection (#339) already runs
-- its linked checks with includeItems: true and persists each COMPLETE item
-- list to tenant_check_item_details.items — for this check, the raw fetched
-- Graph items (id, displayName, visibility, per team) ARE that list, exactly
-- the same pattern #357 used for its per-site list.
--
-- sort_order is set past the current maximum so existing deterministic run
-- order is not disturbed.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  'governance:public-teams-discoverable',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'detail:full-item-collection'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'detail:full-item-collection')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — OPTIONAL: also run it inside the SCORING scan (Shane's call)
-- ══════════════════════════════════════════════════════════════════════════════
-- NOT done automatically, on purpose — same reasoning as #357's Part E.
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
-- SELECT 'core:security-baseline', 'governance:public-teams-discoverable',
--        COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
--                   WHERE package_key = 'core:security-baseline'), -1) + 1
-- ON CONFLICT (package_key, check_key) DO NOTHING;
-- <<<


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D — READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, engines, severity_rules, status
FROM monitor_checks
WHERE key = 'governance:public-teams-discoverable';

SELECT
  (SELECT count(*) FROM monitor_checks
    WHERE key = 'governance:public-teams-discoverable')               AS check_rows,
  (SELECT count(*) FROM monitoring_package_checks
    WHERE package_key = 'detail:full-item-collection'
      AND check_key = 'governance:public-teams-discoverable')         AS detail_package_rows;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-12-public-teams-discoverability-396.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- ============================================================================
-- Overshared Items: per-(item x grant) table + backfill from existing scans (#1275)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres / shaneapp://executeSql
-- per current CLAUDE.md. Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS,
-- the backfill INSERT is ON CONFLICT DO NOTHING, safe to re-run.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- #1262 found the Overshared SharePoint pages (portal-v2-gov-oversharing.tsx,
-- portal-v2-gov-oversharing-all.tsx) render 100% fixture data because the only
-- real collected source, `tenant_check_item_details.items`, stores the full
-- per-site SiteSharingSummary[] as one jsonb blob per (run, checkKey) with no
-- per-item index — paginating/searching inside it means scanning the whole
-- blob on every request, which does not scale toward the enterprise volumes
-- (23k+ rows) the bulk page is sized for.
--
-- #1275 is the sign-off: build the dedicated per-row table + backfill NOW
-- against the real, currently-active `compliance:eeeu-site-sharing` data
-- (~93 site-level rows on the testbed tenant), rather than waiting on the
-- three deferred collection-side follow-ups (per-file/per-link descent,
-- site-visibility capture, named-identity/UPN resolution) that would grow
-- this toward the 23k figure. That 23k figure was a UI sizing reference, not
-- a data-volume gate — the paging/search UI is built to that scale; it is
-- populated with the real ~93 rows today.
--
-- Decisions from #1275 (all three signed off):
--   1. Row granularity: one row per (item x grant) — searchable/indexable by
--      principal and grant kind, not nested jsonb.
--   2. Snapshot retention: keep history for trend / "newly overshared since
--      last scan", not latest-run-only. `run_id` is a partition key — rows
--      are never deleted by this table itself. `natural_key` (independent of
--      run_id) is the stable identity a rescan uses to carry `remediation_state`
--      forward and that a future trend query diffs two runs against.
--   3. Scope of v1: land the table + endpoint against the existing site-root
--      data now.
--
-- Every row here today has scope='site' (no file_path/drive_id/site_visibility/
-- principal_upn — those are the three deferred follow-ups landing as new
-- non-null values in existing columns, no schema change needed later).
--
-- Accept-risk audit reuses `msp_risk_decisions` per #1262's recommendation —
-- no new table for that. Per-site runbook *state* is deferred to the
-- SOP/Runbook subsystem, also per #1262 — not built here.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS overshared_items (
  id                 SERIAL PRIMARY KEY,
  item_id            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id          TEXT NOT NULL,
  customer_id        INTEGER,
  run_id             UUID NOT NULL,
  check_key          TEXT NOT NULL,
  scope              TEXT NOT NULL DEFAULT 'site',
  -- location
  site_id            TEXT NOT NULL,
  site_name          TEXT,
  site_url           TEXT,
  site_visibility    TEXT,
  is_personal_site   BOOLEAN NOT NULL DEFAULT FALSE,
  drive_id           TEXT,
  item_path          TEXT,
  item_web_url       TEXT,
  item_name          TEXT,
  -- the grant
  grant_kind         TEXT NOT NULL,
  principal_label    TEXT,
  principal_upn      TEXT,
  principal_id       TEXT,
  login_name         TEXT,
  roles              JSONB NOT NULL DEFAULT '[]',
  link_scope         TEXT,
  inherited          BOOLEAN NOT NULL DEFAULT FALSE,
  permission_id      TEXT,
  -- severity / display
  sharing_level      TEXT,
  severity           TEXT,
  -- remediation state — durable, carried forward across rescans by natural_key
  remediation_state  TEXT NOT NULL DEFAULT 'open',
  natural_key        TEXT NOT NULL,
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT overshared_items_run_natural_key_uidx UNIQUE (run_id, natural_key)
);

CREATE INDEX IF NOT EXISTS overshared_items_tenant_check_collected_idx
  ON overshared_items (tenant_id, check_key, collected_at, id);
CREATE INDEX IF NOT EXISTS overshared_items_tenant_state_idx
  ON overshared_items (tenant_id, remediation_state);
CREATE INDEX IF NOT EXISTS overshared_items_tenant_grant_kind_idx
  ON overshared_items (tenant_id, grant_kind);
CREATE INDEX IF NOT EXISTS overshared_items_tenant_run_idx
  ON overshared_items (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS overshared_items_natural_key_idx
  ON overshared_items (natural_key);

-- Real, indexed substring search over the text a user actually searches
-- (site/item name, path, principal) — the one thing the jsonb-blob approach
-- could never do at scale (#1262).
CREATE INDEX IF NOT EXISTS overshared_items_search_trgm_idx
  ON overshared_items USING gin (
    (coalesce(site_name, '') || ' ' || coalesce(item_name, '') || ' ' ||
     coalesce(item_path, '') || ' ' || coalesce(principal_label, '') || ' ' ||
     coalesce(principal_upn, '') || ' ' || coalesce(login_name, ''))
    gin_trgm_ops
  );

-- ── Backfill: every EXISTING tenant_check_item_details row for the two
-- oversharing check keys, one output row per (site x grant). Historical runs
-- are all backfilled (not just the latest), consistent with decision 2 —
-- there is real trend data to seed from day one wherever more than one scan
-- has already run. Clean sites (grants = []) contribute no row, matching the
-- table's purpose (an "overshared" register, not a full site inventory);
-- `tenant_check_item_details.item_count` remains the real scanned-site
-- denominator for a "N of M sites clean" statistic if a UI wants one later.
INSERT INTO overshared_items (
  tenant_id, customer_id, run_id, check_key, scope,
  site_id, site_name, site_url, is_personal_site,
  grant_kind, principal_label, login_name, roles, inherited, permission_id,
  sharing_level, severity, natural_key, collected_at
)
SELECT
  d.tenant_id,
  d.customer_id,
  d.run_id,
  d.check_key,
  'site' AS scope,
  site->>'siteId' AS site_id,
  site->>'siteName' AS site_name,
  site->>'siteUrl' AS site_url,
  COALESCE((site->>'isPersonalSite')::boolean, false) AS is_personal_site,
  grant_row->>'kind' AS grant_kind,
  grant_row->>'principal' AS principal_label,
  grant_row->>'loginName' AS login_name,
  COALESCE(grant_row->'roles', '[]'::jsonb) AS roles,
  COALESCE((grant_row->>'inherited')::boolean, false) AS inherited,
  grant_row->>'permissionId' AS permission_id,
  site->>'highestSharingLevel' AS sharing_level,
  CASE grant_row->>'kind'
    WHEN 'anonymous_link' THEN 'critical'
    WHEN 'everyone' THEN 'high'
    WHEN 'eeeu' THEN 'high'
    WHEN 'organization_link' THEN 'medium'
    ELSE 'info'
  END AS severity,
  d.tenant_id || '|' || d.check_key || '|' || (site->>'siteId') || '|' || (grant_row->>'kind') || '|' ||
    COALESCE(grant_row->>'permissionId', grant_row->>'loginName', grant_row->>'principal', '') AS natural_key,
  d.collected_at
FROM tenant_check_item_details d
CROSS JOIN LATERAL jsonb_array_elements(d.items) AS site
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(site->'grants', '[]'::jsonb)) AS grant_row
WHERE d.check_key IN ('compliance:eeeu-site-sharing', 'onedrive:overshared-files')
  AND d.items IS NOT NULL
  AND jsonb_typeof(d.items) = 'array'
  AND site->>'siteId' IS NOT NULL
ON CONFLICT (run_id, natural_key) DO NOTHING;

-- ── FOLLOW-UP — DELIBERATELY NOT DONE HERE ────────────────────────────────
-- 1. Per-file/per-link descent collector (site-root only today).
-- 2. Site-visibility (Public/Private) capture.
-- 3. Named-identity/UPN resolution for guest/user grants.
-- 4. "Newly overshared since last scan" trend query/endpoint — the schema
--    (run_id + natural_key) supports it, nothing built against it yet.
-- 5. remediation_state carry-forward on rescans older than this migration
--    (the live collector wiring in item-detail-collector.ts, landed in this
--    same session, ON CONFLICT DO NOTHINGs a repeat natural_key per run
--    rather than copying forward a prior run's accepted/remediating state).
-- Each is its own follow-up issue, per #1262's sequencing.

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-overshared-items-1275.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

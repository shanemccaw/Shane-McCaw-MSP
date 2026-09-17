-- ============================================================================
-- #4538 -- sharepoint:inactive-sites still can't evaluate lastModifiedDateTime
-- even after #4524 added select_params='id,lastModifiedDateTime'.
-- ============================================================================
-- Additive, idempotent data fix: a single UPDATE by key, safe to re-run. Run
-- locally in-session; Replit/Staging carries it via the #1630 release checklist.
--
-- ── ROOT CAUSE (live Graph evidence, tenant 2080 / mccawsoft2.onmicrosoft.com) ─
-- Bare `GET /sites` (no `search=`) is Graph's site-collection enumeration path.
-- It does not project `lastModifiedDateTime` even in its own default field set,
-- and it does not honor `$select` for any field outside that fixed set --
-- confirmed live: `GET /sites?$select=id,lastModifiedDateTime` came back 200
-- with 99 items whose ONLY field was `id` (the `$select` was silently ignored
-- beyond `id`), and plain `GET /sites` with no `$select` at all also never
-- carried `lastModifiedDateTime` on any of the same 99 items.
--
-- `GET /sites?search=*` is backed by SharePoint search instead -- a different
-- Graph code path that both honors `$select` for arbitrary site properties and
-- found more real sites in this tenant than the bare listing does (143 vs 99).
-- Confirmed live: `GET /sites?search=*&$select=id,lastModifiedDateTime` came
-- back 200 with all 143 items carrying a real `lastModifiedDateTime` value (0
-- missing). Single-site fetch (`GET /sites/{id}?$select=...`) also works, but
-- fanning out per-site is unnecessary extra request volume when the search
-- listing already returns the field directly.
--
-- No `ConsistencyLevel: eventual` header is needed for `search=*` (confirmed
-- live 200 without it) -- that header is Graph's AAD-advanced-query mechanism
-- for /users and /groups, unrelated to SharePoint site search.
--
-- select_params/properties/mapping/requireField are left exactly as #4524 set
-- them. appendQueryParams() (monitor-executor.ts) already appends `&$select=...`
-- correctly onto an endpoint that already carries a `?`, so no code change is
-- needed in the executor -- this is a data-only fix, same shape as #4524's.
-- ============================================================================

UPDATE monitor_checks
SET
  endpoint       = '/sites?search=*',
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'sharepoint:inactive-sites'
  AND endpoint IS DISTINCT FROM '/sites?search=*';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-sharepoint-inactive-sites-search-endpoint-4538.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

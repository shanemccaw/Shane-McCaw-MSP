-- ============================================================================
-- #4539 -- governance:guest-staleness has no guest filter: it counts staleness
-- across ALL users, not just guests, despite its key/label/description/severity
-- rule all being guest-specific.
-- ============================================================================
-- Additive, idempotent data fix: a plain UPDATE of one monitor_checks row by
-- key, safe to re-run. Run locally in-session; Replit/Staging carries it via
-- the #1630 release checklist.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--   endpoint /users, filter_params NULL, properties ["id","userType","signInActivity"]
--   mapping [{countIfLastSignInOlderThan(90), signInActivity -> staleGuestCount}]
--
-- `userType` is fetched and shown in evidence, but nothing in the mapping or
-- endpoint scopes the fetch or the count to guests. `staleGuestCount` is really
-- "stale users of any type" -- it would over-count on a tenant with stale
-- member accounts and under-represent the guest population specifically.
--
-- (#4524 separately added the missing $select=id,userType,signInActivity so the
-- check evaluates at all; it deliberately left the guest-scoping defect for
-- this issue -- see #4539's issue body.)
--
-- ── FIX ──────────────────────────────────────────────────────────────────────
-- Add a server-side Graph $filter scoping the /users fetch to guests only, the
-- same shape identity:break-glass-health already uses on this same /users
-- endpoint (filter_params, not a client-side countEquals like
-- governance:guest-count uses -- that check has no second condition to combine
-- with, so scoping the fetch itself is simpler and cheaper than fetching every
-- user to filter client-side):
--
--   filter_params = "userType eq 'Guest'"
--
-- monitor-executor.ts's graphFetchPaginated already adds the
-- `ConsistencyLevel: eventual` header automatically whenever the built URL
-- contains `$filter=` (see resolveEndpointPlaceholders / graphFetchPaginated in
-- artifacts/api-server/src/lib/monitor-executor.ts), so no code change is
-- needed -- `userType eq 'Guest'` is a standard (non-advanced) Graph filter and
-- works with or without that header, and the header is harmless either way.
--
-- select_params/properties/mapping/severity_rules are unchanged -- the endpoint
-- already selects and evaluates signInActivity correctly per-item; the only
-- defect was the missing population scope.
-- ============================================================================

UPDATE monitor_checks
SET
  filter_params  = 'userType eq ''Guest''',
  schema_version = schema_version + 1,
  updated_at     = now()
WHERE key = 'governance:guest-staleness'
  AND filter_params IS DISTINCT FROM 'userType eq ''Guest''';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-guest-staleness-guest-filter-4539.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

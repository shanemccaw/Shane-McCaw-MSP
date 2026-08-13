-- Fan-Out Capability for Group-Scoped Monitor Checks + wire identity:pim-groups
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────
-- Part A: read-only receipt of the current identity:pim-groups row (before).
-- Part B: adds the three additive fan-out columns to monitor_checks.
-- Part C: wires identity:pim-groups onto the new fan-out execution path.
-- Part D: read-only receipt of the row (after) + the fan-out column values.
--
-- The CODE half of this capability is already committed (monitor-executor.ts:
-- runFanOutCheck, the {itemId} placeholder, the opt-in 429 throttle-retry, and
-- the new "partial" status). This file is the DATA half.
--
-- ── STATUS ENUM NOTE (no DB change needed) ───────────────────────────────────────
-- The new check-result status "partial" needs NO schema change: tenant_monitor_
-- profiles.status is a plain `text` column (the enum lives only in the Drizzle TS
-- type, not as a Postgres enum type), so the column already accepts "partial".
-- The three columns below are the only real schema delta.
--
-- ══════════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: current stored config for identity:pim-groups (before)
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, method, endpoint, mapping, severity_rules, status
FROM monitor_checks
WHERE key = 'identity:pim-groups';


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART B — SCHEMA: additive fan-out columns on monitor_checks
-- ══════════════════════════════════════════════════════════════════════════════════
-- All three are NULLABLE with no default, so EVERY existing check is unaffected:
-- fan_out_source IS NULL means "use the default one-check-one-URL execution path",
-- which is exactly what all current rows resolve to. Nothing about a non-fan-out
-- check changes.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS fan_out_source        text,
  ADD COLUMN IF NOT EXISTS fan_out_item_id_field text,
  ADD COLUMN IF NOT EXISTS fan_out_max_items     integer;

COMMENT ON COLUMN monitor_checks.fan_out_source IS
  'Graph list endpoint enumerating the items to iterate (e.g. /groups?$select=id). NULL = no fan-out (default one-check-one-URL path).';
COMMENT ON COLUMN monitor_checks.fan_out_item_id_field IS
  'Field on each enumerated item whose value is substituted into the per-item {itemId} placeholder. NULL defaults to "id".';
COMMENT ON COLUMN monitor_checks.fan_out_max_items IS
  'Per-check cap on enumerated items scanned (throttle guard). NULL = platform default (FAN_OUT_MAX_ITEMS_DEFAULT = 500).';


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-24-fan-out-capability-and-pim-groups.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART C — WIRE identity:pim-groups ONTO THE FAN-OUT PATH
-- ══════════════════════════════════════════════════════════════════════════════════
-- PIM for Groups has NO tenant-wide form. The eligibilitySchedules endpoint REQUIRES
-- a $filter scoping to one groupId (confirmed live: "This method requires the $filter
-- (eq) query parameter to scope the request to a principalId or a groupId"), so the
-- only way to cover a tenant is to enumerate every group and call it once per group.
--
-- Docs (v1.0, verified 2026-07-24):
--   learn.microsoft.com/en-us/graph/api/privilegedaccessgroup-list-eligibilityschedules
--     GET /identityGovernance/privilegedAccess/group/eligibilitySchedules?$filter=groupId eq '{groupId}'
--   Returned object fields: groupId, principalId, accessId, memberType, status, scheduleInfo.
--
-- HOW THE FAN-OUT EXECUTES THIS ROW (monitor-executor.ts:runFanOutCheck):
--   1. Enumerate fan_out_source = /groups (paginated — hundreds of groups won't fit
--      one page; the executor exhausts @odata.nextLink).
--   2. For each group id, substitute it into the endpoint's {itemId} and GET the
--      per-group eligibilitySchedules (bounded concurrency + per-request 429 backoff).
--   3. Aggregate:
--        * mapping counts principalId across the FLATTENED union of every group's
--          schedules  -> extractedProperties.eligibleAssignmentsTotal (tenant-wide
--          total standing eligible assignments); and
--        * extractedProperties._fanOut.sourceItemsWithResults -> the number of GROUPS
--          that have >=1 eligible assignment (PIM's primary coverage signal).
--   4. Status: ok (all groups scanned), partial (some per-group calls failed but real
--      data was collected), error (none succeeded), consent_revoked / license_gap
--      (tenant-wide — short-circuited out to the shared executor catch).
--
-- The severity rule fires on the coverage metric: any group carrying a standing
-- eligible PIM assignment is worth surfacing (standing privileged access is the
-- thing PIM-for-Groups review exists to catch). Tune the threshold as needed.

UPDATE monitor_checks
SET
  endpoint = '/identityGovernance/privilegedAccess/group/eligibilitySchedules?$filter=groupId eq ''{itemId}''',
  method = 'GET',
  fan_out_source = '/groups?$select=id',
  fan_out_item_id_field = 'id',          -- explicit; NULL would default to "id" anyway
  fan_out_max_items = NULL,              -- platform default cap (500) applies
  mapping = '[{"sourceField":"principalId","targetField":"eligibleAssignmentsTotal","transform":"count"}]'::jsonb,
  severity_rules = '[{"expression":"{{_fanOut.sourceItemsWithResults}} > 0","severity":"warning","label":"One or more groups have standing eligible PIM assignments"}]'::jsonb,
  updated_at = now()
WHERE key = 'identity:pim-groups';

-- ── PERMISSIONS — READ BEFORE RELYING ON THIS CHECK ──────────────────────────────
-- Enumeration (GET /groups): covered by Directory.Read.All, which IS already in
--   REQUIRED_MT_SCOPES (graph.ts). So the group enumeration will work today.
-- Per-group PIM read (eligibilitySchedules): needs the Application permission
--   PrivilegedEligibilitySchedule.Read.AzureADGroup. This is NOT in REQUIRED_MT_SCOPES.
--   >> Until it is granted, the per-group calls will 403/permission-error, and the
--      fan-out will HONESTLY report status "error" (or "partial" if some groups are
--      reachable) — it will NOT fabricate a clean pass. That is the intended safe
--      behavior; no wrong "ok" is possible.
--   >> Adding a scope forces re-consent on every tenant, so it belongs to its own
--      task (same policy the 2026-07-23 corrections migration applied to
--      identity:pim-eligible-roles' RoleManagement scope). Not added here.
-- PIM for Groups also requires Microsoft Entra ID P2 on the tenant; a tenant lacking
--   it surfaces as license_gap via the shared executor path, not as a failure.


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART D — READ-ONLY: verify the wiring (after)
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, method, endpoint, fan_out_source, fan_out_item_id_field, fan_out_max_items,
       mapping, severity_rules, status
FROM monitor_checks
WHERE key = 'identity:pim-groups';


-- ── FOLLOW-UP (NOT DONE HERE, DELIBERATELY) ──────────────────────────────────────
-- adoption:planner-usage is the second check blocked on this same capability
-- (2026-07-24-planner-usage-fanout-blocked.sql). It is a SEPARATE follow-up task and
-- is intentionally NOT wired here — pim-groups proves the capability first. When it
-- is wired, its shape will be:
--   endpoint      = '/groups/{itemId}/planner/plans'   (per-group plans; app-only Tasks.Read.All)
--   fan_out_source= '/groups?$select=id'
--   mapping       = count over the flattened plans (tenant-wide plan rollup)
--   _fanOut.sourceItemsWithResults = number of groups that own >=1 plan
-- i.e. the exact same fan-out primitive, a different endpoint + aggregation target.

-- ============================================================================
-- #404 -- onedrive:departed-user-access measures the wrong thing. Repoint it
-- at the real exposure: a departed account whose OneDrive nobody was ever
-- automatically granted access to.
-- ============================================================================
-- Manual migration -- Shane runs this himself (no DATABASE_URL in the Claude
-- Code environment, per CLAUDE.md). Idempotent: PART B is a plain UPDATE of
-- one row by key, safe to re-run.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- Before this migration, per docs/endpoints.json ("onedrive:departed-user-
-- access" -> GET /users) and the issue body, the check's mapping only reads
-- `accountEnabled == false` off plain /users -- i.e. it counts every disabled
-- account in the tenant, full stop. That is not a OneDrive-exposure signal at
-- all: it is the general disabled-account count license:unused-assigned and
-- several identity:* checks already report from the same field.
--
-- The real, confirmed-in-research mechanism (issue body): when an Entra ID
-- account is deleted, Microsoft AUTOMATICALLY grants the departed user's
-- manager (or a designated secondary owner) access to their OneDrive -- but
-- ONLY if a manager/secondary owner is actually assigned on the account. When
-- neither exists, nobody receives that automatic grant, and the departed
-- user's OneDrive content sits accessible to no one -- unhandled. THAT is the
-- exposure worth flagging, not "account disabled" in isolation.
--
-- ── THE REAL QUERY SHAPE ─────────────────────────────────────────────────────
-- endpoint: /users?$expand=manager($select=id)&$select=id,accountEnabled,signInActivity
-- This is the documented Graph shape for expanding a user's manager
-- (single-valued navigation property) alongside a $select
-- (learn.microsoft.com/en-us/graph/api/user-list -- $expand on a
-- singleValuedNavigationProperty is supported inline exactly like this).
-- signInActivity is added for the age signal below (same field
-- license:unused-assigned already selects off /users -- confirmed live via
-- docs/endpoints.json, so the app registration already holds whatever Graph
-- permission that requires; this migration adds no new consent surface).
--
-- WHAT "NO MANAGER ASSIGNED" LOOKS LIKE IN THE RESPONSE -- not independently
-- confirmable against live data from this environment (no DATABASE_URL/Graph
-- credential here, per CLAUDE.md), so the mapping below is written to be
-- correct under EVERY shape Graph could plausibly return, rather than betting
-- on one:
--   * `"manager": null`        -- resolvePathInData("manager.id", item) walks
--                                  into null and returns undefined.
--   * key absent entirely      -- resolvePathInData("manager.id", ...) returns
--                                  undefined the same way (data.manager is
--                                  undefined, walk short-circuits).
--   * `"manager": {}`          -- manager.id itself is undefined.
-- All three collapse to the same `undefined`, and the countWhere clause below
-- compares with `== null`, which is `undefined == null` in JS (true) --
-- so `{{manager.id}} == null` reads as "no manager id present" regardless of
-- which of the three shapes Graph actually sends. Confirmed by reading
-- resolvePathInData and evalClause's `==` branch directly
-- (artifacts/api-server/src/lib/monitor-executor.ts), not assumed. If live
-- data later shows a shape none of these three handle, that is a narrower
-- follow-up to this file, not a rebuild of the mechanism.
--
-- ── THE REAL SIGNAL, WITH AGE (per the issue's explicit ask) ────────────────
-- The existing `countWhere('<expression>')` transform (added for #541/#551,
-- the same primitive appgov:stale-app-registrations and
-- appgov:cert-secret-expiration use) already composes `&&` and the
-- `olderThanDays N` word-operator from #401 -- no executor code change is
-- needed, exactly like #541/#551 needed none.
--
-- /users has no "date this account was disabled" field -- Graph does not
-- expose one. signInActivity.lastSignInDateTime (already selected above) is
-- the best available proxy for "how long has this sat unhandled": a disabled,
-- manager-less account with no recent sign-in is not mid-offboarding, it has
-- genuinely been sitting exposed. This is an honest proxy, not a literal
-- "days since disabled" -- documented here so nobody mistakes one for the
-- other, same discipline #551 used for createdDateTime not being a usage
-- signal.
--
-- Two countWhere fields, mirroring #551's two-band shape:
--   departedUserOneDriveExposureCount:
--     countWhere('{{accountEnabled}} == false && {{manager.id}} == null')
--   departedUserOneDriveExposureOver30dCount:
--     countWhere('{{accountEnabled}} == false && {{manager.id}} == null
--                 && {{signInActivity.lastSignInDateTime}} olderThanDays 30')
-- (the 30d field is a strict subset of the unqualified field -- both are real
-- counts of the SAME underlying set, one further filtered by age, not
-- complementary buckets that must sum to the total.)
--
-- ── SEVERITY THRESHOLDS -- SHANE'S CALL, PROPOSED HERE AS A STARTING POINT ──
-- warning  >= 1 unhandled departed-user OneDrive (no manager, any age --
--             may be mid-offboarding, still worth surfacing)
-- critical >= 1 unhandled departed-user OneDrive sitting >30 days with no
--             sign-in activity (genuinely stuck, not offboarding-in-progress)
-- Same "any, not a percentage" reasoning #551 used: nobody's OneDrive content
-- sitting accessible to no one is not a volume question. If this reads as too
-- noisy against real customer tenants, raise the two literals here -- this
-- file is the only place to edit them.
--
-- ── LABEL / DESCRIPTION ───────────────────────────────────────────────────────
-- `key` (onedrive:departed-user-access) is left UNCHANGED -- renaming would
-- break monitoring_package_checks/tenant_monitor_profiles joins for zero
-- benefit. `label`/`description` move off the old "Transfer Status" framing
-- (which implied a transfer either happens or doesn't, rather than "was
-- nobody even eligible to receive it") to state the real mechanism.
--
-- ── LOGGING ──────────────────────────────────────────────────────────────────
-- No executor code change ships with this migration (the fix is entirely
-- config-driven, via the existing countWhere primitive), so there is no new
-- code path to wire a logger onto. The engine already logs this check's
-- execution through the module-level `logger.child({ channel: "engine.monitor" })`
-- binding at the top of monitor-executor.ts -- unchanged, and correct for
-- this check same as every other monitor_checks-driven check.
--
-- ── VERIFICATION STATUS ──────────────────────────────────────────────────────
-- Not smoke-tested against a live tenant -- no DATABASE_URL/Graph credential
-- in this environment (the issue itself asks for live confirmation of the
-- manager-expand response shape before finalizing; that confirmation could
-- not be performed here). Pinned instead by a new vitest suite
-- (artifacts/api-server/src/lib/onedrive-departed-user-access-manager-404.test.ts)
-- exercising applyMapping/classifySeverity against fixtures covering all
-- three "no manager" response shapes above, the age cutoff, and severity
-- bands. PART C below is the live confirmation query -- run it after the next
-- real scan, and if the manager-expand shape turns out to differ from all
-- three modeled here, that is the next thing to fix, not evidence this
-- migration is wrong on the parts it could verify (the countWhere/olderThanDays
-- primitives themselves, already proven by #541/#551 in production).
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: the before-state, on the record
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect endpoint '/users' (no $expand), a single accountEnabled==false
-- mapping rule, and whatever severity_rules currently exist. Keep this output.

SELECT key, label, endpoint, method, properties, mapping, severity_rules,
       engines, schema_version, status
FROM monitor_checks
WHERE key = 'onedrive:departed-user-access';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B -- THE CORRECTION (transactioned). Review PART A output first.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  label = 'Departed-User OneDrive Access Left Unhandled',

  endpoint = '/users?$expand=manager($select=id)&$select=id,accountEnabled,signInActivity',

  properties = '["id","accountEnabled","manager","signInActivity"]'::jsonb,

  mapping = '[
    {"sourceField":"accountEnabled","targetField":"departedUserOneDriveExposureCount","transform":"countWhere(''{{accountEnabled}} == false && {{manager.id}} == null'')"},
    {"sourceField":"accountEnabled","targetField":"departedUserOneDriveExposureOver30dCount","transform":"countWhere(''{{accountEnabled}} == false && {{manager.id}} == null && {{signInActivity.lastSignInDateTime}} olderThanDays 30'')"}
  ]'::jsonb,

  severity_rules = '[
    {"expression":"{{departedUserOneDriveExposureOver30dCount}} > 0","severity":"critical","label":"{{departedUserOneDriveExposureOver30dCount}} departed-user OneDrive account(s) unhandled for over 30 days -- no manager was ever assigned to receive automatic access"},
    {"expression":"{{departedUserOneDriveExposureCount}} > 0","severity":"warning","label":"{{departedUserOneDriveExposureCount}} departed-user OneDrive account(s) with no manager assigned -- automatic access transfer cannot occur"}
  ]'::jsonb,

  description = 'Departed-user OneDrive exposure via the REAL Entra mechanism (#404): on account deletion, Microsoft '
    || 'automatically grants the user''s manager (or a designated secondary owner) access to their OneDrive -- but ONLY '
    || 'if one is assigned. This check counts disabled accounts (accountEnabled == false) with NO manager on record '
    || '(via GET /users?$expand=manager($select=id)) -- content nobody was ever eligible to automatically inherit. '
    || 'departedUserOneDriveExposureOver30dCount additionally requires no sign-in activity in the last 30 days '
    || '(signInActivity.lastSignInDateTime), as a proxy for "not mid-offboarding" -- Graph has no literal '
    || '"date this account was disabled" field on /users, so recency of sign-in is the best available signal that this '
    || 'is a stuck, unhandled case rather than a just-departed one still being processed. Does NOT mean the OneDrive '
    || 'content is deleted or unreachable to an admin -- it means the AUTOMATIC handoff Microsoft performs on deletion '
    || 'has nobody to hand off to, and a manual secondary-owner assignment or file-transfer action is needed.',

  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'onedrive:departed-user-access'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ────────────────────────────────────────────────────
-- Exactly 1 row. endpoint now carries $expand=manager($select=id). mapping now
-- carries the two countWhere rules above; the old plain accountEnabled==false
-- rule is gone. severity_rules now carries the two bands above.
--
-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-onedrive-departed-user-access-manager-based-404.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C -- THE LIVE SMOKE TEST (do this after the next real scan)
-- ══════════════════════════════════════════════════════════════════════════════
-- EXPECT:
--   * status 'ok' (or the tenant's real Graph state), not an error -- in
--     particular, confirm the $expand=manager($select=id) query shape itself
--     is accepted by Graph and does not 400.
--   * departedUserOneDriveExposureCount LESS THAN the count of ALL disabled
--     accounts on any tenant where at least one disabled account genuinely
--     has a manager assigned -- if it always equals the full disabled-account
--     count, the manager.id == null clause is not discriminating (most likely
--     cause: the live "no manager" shape is not null/absent/empty-object, see
--     the file header -- read the raw `manager` value on a few disabled rows
--     with a known manager to confirm what non-null actually looks like too).
--   * departedUserOneDriveExposureOver30dCount <= departedUserOneDriveExposureCount.
--   * severity_matched 'critical'/'warning' only when the corresponding count
--     is nonzero.

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'departedUserOneDriveExposureCount' AS exposure,
       p.extracted_properties -> 'departedUserOneDriveExposureOver30dCount' AS exposure_over_30d
FROM tenant_monitor_profiles p
WHERE p.check_key = 'onedrive:departed-user-access'
ORDER BY p.collected_at DESC
LIMIT 5;


-- ── Raw manager shape on a handful of disabled accounts, straight off the
--    stored item detail -- run this FIRST if PART C's counts look suspicious,
--    to see what "no manager" really looks like on this tenant's real data ──

-- SELECT d.tenant_id, d.collected_at,
--        u ->> 'id'             AS user_id,
--        u ->  'accountEnabled' AS account_enabled,
--        u ->  'manager'        AS manager_raw
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS u
-- WHERE d.check_key = 'onedrive:departed-user-access'
--   AND (u -> 'accountEnabled') = 'false'::jsonb
-- ORDER BY d.collected_at DESC
-- LIMIT 20;

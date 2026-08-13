-- ============================================================================
-- #551 (final phase) -- appgov:stale-app-registrations flags EVERY app
-- registration as stale, because the transform it uses cannot exist for the
-- endpoint it runs against. Repoint it at a real age-based signal.
-- ============================================================================
-- Manual migration -- Shane runs this himself (no DATABASE_URL in the Claude
-- Code environment, per CLAUDE.md). Idempotent: PART B is a plain UPDATE of
-- one row by key, safe to re-run; PART D is an ON CONFLICT DO NOTHING insert.
--
-- ── WHAT WAS WRONG (confirmed live 2026-08-07 and again 2026-08-12) ─────────
-- Before this migration:
--   endpoint:       /applications
--   mapping:        [{"transform":"countIfLastSignInOlderThan(180)",
--                      "sourceField":"createdDateTime",
--                      "targetField":"staleAppRegistrationCount"}]
--   severity_rules: []
--
-- `countIfLastSignInOlderThan` (artifacts/api-server/src/lib/monitor-executor.ts)
-- is hardcoded to read `signInActivity.lastSignInDateTime` off each item --
-- `sourceField` only gates presence, it is never the field actually compared.
-- The Graph `application` resource (learn.microsoft.com/en-us/graph/api/
-- resources/application) has NO `signInActivity` property at all -- that lives
-- on the SERVICE PRINCIPAL side, a different resource. So on every real
-- /applications item `lastSignIn` resolves null, and the transform's miss
-- branch ("never signed in" => stale) fires unconditionally:
--
--     const lastSignIn = resolvePathInData("signInActivity.lastSignInDateTime", item);
--     if (lastSignIn == null) return true;   // <- fires on all 11/11 live apps
--
-- Live confirmation (2026-08-07 diagnostics, re-confirmed 2026-08-12):
--     item_count: 11      staleAppRegistrationCount: 11
-- including app registrations created 2 and 4 weeks before the scan. The
-- `180` argument is completely inert -- any value produces the same 11/11.
-- Second defect on the same check: `severity_rules: []`, so this maximally
-- wrong number never fires a finding either -- the identical pair of bugs
-- #541 fixed on appgov:cert-secret-expiration (empty rules + a mislabelled
-- count), on the next check along in the same category.
--
-- ── THE REAL AGE-COMPARISON OPERATOR -- CONFIRMED IN SOURCE, NOT ASSUMED ────
-- There is no `countIfOlderThan` transform. The full vocabulary
-- `applyMapping` implements is KNOWN_TRANSFORMS (monitor-executor.ts ~L178):
--   none, count, exists, first, join, raw, countTruthy, countFalse,
--   countEmptyArray, countEquals, countIfLastSignInOlderThan, groupByCount,
--   countDuplicates, valueWhere, flattenValues, countDuplicatesBy, countWhere
-- The real age-comparison primitive is the `olderThanDays` / `newerThanDays`
-- word-operator inside `evalClause` (~L575-632), reachable from a mapping via
-- `countWhere('<condition expression>')` (~L1211) -- the SAME
-- evalConditionGrammar severity_rules and the workflow engine already run, so
-- `olderThanDays` means here exactly what it means everywhere else in the
-- platform. This is the exact mechanism #541 used for
-- appgov:cert-secret-expiration's `countWhere('{{endDateTime}} olderThanDays 0')`
-- (lib/db/migrations/manual/2026-08-07-cert-secret-expiration-mapping-severity-541.sql)
-- -- same primitive, applied here to `createdDateTime` on the WHOLE item
-- (countWhere operates on whole items whenever sourceField does not resolve
-- to an array; `createdDateTime` is a scalar ISO date on every /applications
-- item, so it always falls to that path -- confirmed reading the countWhere
-- case body directly, not inferred from its docstring).
--
-- ── OPTION 1, PER SHANE'S 2026-08-13 SCOPING COMMENT: AGE, NOT USAGE ────────
-- The Graph `application` resource genuinely has no usage/last-sign-in signal
-- (confirmed above) -- the only surface that has one,
-- GET /reports/servicePrincipalSignInActivities, is /beta-only, and
-- graphFetchPaginated hardcodes GRAPH_BASE to v1.0 (monitor-executor.ts), so
-- reaching it is a real executor change plus a deliberate accepted-risk call
-- on an API Microsoft says not to use in production. That is Option 2, and it
-- is explicitly NOT this build -- Shane's comment scopes this phase to
-- Option 1 (age-based, no beta dependency). This migration does not claim a
-- usage/staleness signal the endpoint cannot support; it renames the check to
-- say exactly what it measures instead.
--
-- ── TWO AGE BANDS, NOT ONE COUNT ─────────────────────────────────────────────
-- Two countWhere fields rather than one, so severity can key off "how old",
-- not just "old or not":
--   appRegistrationsOver180dCount : countWhere('{{createdDateTime}} olderThanDays 180')
--   appRegistrationsOver365dCount : countWhere('{{createdDateTime}} olderThanDays 365')
-- (olderThanDays 365 items are a subset of olderThanDays 180 items -- both
-- fields are real counts of the SAME underlying set at two cutoffs, not
-- complementary buckets that must sum to the total.)
--
-- ── SEVERITY THRESHOLDS -- SHANE'S CALL, PROPOSED HERE AS A STARTING POINT ──
-- warning  >= 1 app registration older than 180 days
-- critical >= 1 app registration older than 365 days
-- Deliberately "any", not a percentage or a higher count floor: an app
-- registration is credential-bearing attack surface for as long as it exists,
-- and an age-based check has no basis to say a SINGLE year-old, unreviewed
-- registration is not worth surfacing. If that reads as too noisy once run
-- against real customer tenants, the fix is raising these two literals in
-- severity_rules, not changing the underlying mapping. If a different cutoff
-- pair is wanted, this file is the only place to edit them.
--
-- ── RENAME OFF "STALE" ───────────────────────────────────────────────────────
-- `key` (appgov:stale-app-registrations) is left UNCHANGED -- renaming the key
-- itself would break monitoring_package_checks/tenant_monitor_profiles/
-- tenant_check_item_details joins for zero benefit; the key is an internal
-- identifier, not customer-facing text. `label` and `description` -- the
-- surfaces the admin UI and document generation actually read -- move off
-- "stale" to "Aging App Registrations", matching the age-based reality.
--
-- ── PER-ITEM "AFFECTED" TAGGING -- WHY THIS FILE DOES NOT ADD A NORMALIZER ──
-- Checked directly in source before deciding this (not assumed): the
-- FAN_OUT_ITEM_NORMALIZERS registry and FanOutItemNormalizer hook that
-- compliance:eeeu-site-sharing uses (#357) are invoked ONLY from
-- runFanOutCheck (monitor-executor.ts) -- there is no equivalent decoration
-- hook on the ordinary (non-fan-out) execution path this check runs on, and
-- appgov:stale-app-registrations has no fan_out_source (confirmed live,
-- 2026-08-07 addendum: Phase 1 was WRONG that this meant "no enumeration
-- exists" -- tenant_check_item_details has been collecting the full raw
-- /applications item list for this check all along via
-- detail:full-item-collection's includeItems:true, independent of fan-out).
--
-- Building a new non-fan-out decoration hook to write a stored `isAging`/
-- `isOverAYear` boolean onto each raw item would be new plumbing -- and
-- Shane's own scoping comment says this phase needs none ("same normalizer
-- pattern ... no new fan-out plumbing required"). It also is not needed to
-- get an honest affected subset: `createdDateTime` is already a plain
-- top-level field on every raw /applications item stored in
-- tenant_check_item_details.items (properties below keep it, plus
-- displayName/appId/id for real per-app identity). A reader -- document
-- generation, an admin UI list, or a follow-up migration -- recovers the
-- affected subset from the stored rows with the IDENTICAL predicate this
-- migration's mapping uses (`createdDateTime olderThanDays 180` /
-- `olderThanDays 365`), the same way #541 left cert-secret-expiration's
-- affected-subset item shape as an explicit open decision rather than
-- guessing at a stored-flag design. If a stored per-item flag is wanted
-- later, that is new scope for its own issue, not a silent addition here.
--
-- ── PACKAGE WIRING (issue item 5) ────────────────────────────────────────────
-- Phase 1 addendum's live package-membership table (Q4) found this check in
-- core:enhanced-monitoring and detail:full-item-collection only -- NOT in
-- assess:copilot-readiness, so whatever it reports does not reach the paid
-- Copilot Readiness Assessment product today. PART D adds it, idempotently
-- (ON CONFLICT DO NOTHING), safe to run even if membership has since changed.
--
-- ── VERIFICATION STATUS ──────────────────────────────────────────────────────
-- Not smoke-tested against a live tenant -- no DATABASE_URL/Graph credential
-- in this environment. Pinned by a new vitest suite
-- (artifacts/api-server/src/lib/stale-app-registrations-age-based-551.test.ts)
-- replaying the OLD transform against a fixture shaped like the real 11-item
-- tenant (defect reproduction: 11/11 stale, confirming the 180 argument is
-- inert), then the NEW countWhere mapping against the same fixture (fix
-- verification: only the genuinely-old items count, at both cutoffs),
-- severity band tests (warning/critical/clean), and a package-membership
-- assertion mirroring 05dd885e's rigor. PART C below is the live confirmation
-- query -- run it after the next real scan.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: the before-state, on the record
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect endpoint '/applications', the countIfLastSignInOlderThan(180) mapping
-- described above, and severity_rules '[]'. Keep this output.

SELECT key, label, endpoint, method, properties, mapping, severity_rules,
       engines, schema_version, status
FROM monitor_checks
WHERE key = 'appgov:stale-app-registrations';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B -- THE CORRECTION (transactioned). Review PART A output first.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  label = 'Aging App Registrations',

  -- id/displayName/appId keep real per-app identity on every stored row;
  -- createdDateTime is what both new mapping rules and any future reader's
  -- affected-subset filter compare against.
  properties = '["id","displayName","appId","createdDateTime"]'::jsonb,

  mapping = '[
    {"sourceField":"createdDateTime","targetField":"appRegistrationsOver180dCount","transform":"countWhere(''{{createdDateTime}} olderThanDays 180'')"},
    {"sourceField":"createdDateTime","targetField":"appRegistrationsOver365dCount","transform":"countWhere(''{{createdDateTime}} olderThanDays 365'')"}
  ]'::jsonb,

  severity_rules = '[
    {"expression":"{{appRegistrationsOver365dCount}} > 0","severity":"critical","label":"{{appRegistrationsOver365dCount}} app registration(s) over a year old, unreviewed"},
    {"expression":"{{appRegistrationsOver180dCount}} > 0","severity":"warning","label":"{{appRegistrationsOver180dCount}} app registration(s) over 180 days old, unreviewed"}
  ]'::jsonb,

  description = 'App registration AGE, not usage (#551). Counts app registrations older than 180 and 365 days off '
    || 'GET /applications'' own createdDateTime -- the only registration-age signal the /applications resource carries. '
    || 'DOES NOT MEASURE USAGE OR LAST SIGN-IN: the application resource has no signInActivity property at all (that '
    || 'lives on the service principal, a different Graph resource), so a five-year-old app registration in daily '
    || 'production use is counted the same as one nobody has touched since creation. Read this alongside real activity '
    || 'signals, never as "this app is unused". Per-app detail (name / app ID / creation date per row) reaches '
    || 'tenant_check_item_details through the detail:full-item-collection package this check is already linked to; the '
    || 'affected subset (items older than 180 or 365 days) is recoverable from those stored rows with the identical '
    || 'createdDateTime olderThanDays predicate this check''s own mapping uses -- no separate stored flag exists.',

  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'appgov:stale-app-registrations'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ────────────────────────────────────────────────────
-- Exactly 1 row. mapping now carries the two countWhere rules above; the old
-- countIfLastSignInOlderThan(180) rule is gone. severity_rules now carries the
-- two bands above (was '[]'). endpoint is untouched -- /applications was
-- never wrong, only the transform reading it.
--
-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-12-stale-app-registrations-age-based-551.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C -- THE LIVE SMOKE TEST (do this after the next real scan)
-- ══════════════════════════════════════════════════════════════════════════════
-- EXPECT:
--   * status 'ok' (or whatever the tenant's real Graph state produces), not an
--     error.
--   * appRegistrationsOver180dCount and appRegistrationsOver365dCount BOTH
--     LESS THAN item_count on any tenant with at least one recently-created app
--     registration -- the old check's defect was reading 11/11 (=item_count)
--     unconditionally; a count now equal to item_count on every run would mean
--     the predicate still is not discriminating.
--   * severity_matched 'critical' or 'warning' only when the corresponding
--     count is nonzero -- 'ok'/null when both are zero.

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'appRegistrationsOver180dCount' AS over_180d,
       p.extracted_properties -> 'appRegistrationsOver365dCount' AS over_365d
FROM tenant_monitor_profiles p
WHERE p.check_key = 'appgov:stale-app-registrations'
ORDER BY p.collected_at DESC
LIMIT 5;


-- ── The affected subset, straight out of the detail table (no stored flag --
--    same predicate this check's own mapping uses, applied by the reader) ───

-- SELECT d.tenant_id, d.collected_at, d.item_count, d.items_omitted_reason,
--        a ->> 'displayName'      AS app_name,
--        a ->> 'appId'            AS app_id,
--        a ->> 'createdDateTime'  AS created_at
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS a
-- WHERE d.check_key = 'appgov:stale-app-registrations'
--   AND (a ->> 'createdDateTime')::timestamptz < (now() - interval '180 days')
-- ORDER BY d.collected_at DESC, created_at;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D -- WIRE INTO assess:copilot-readiness (issue item 5)
-- ══════════════════════════════════════════════════════════════════════════════
-- Idempotent regardless of current membership. sort_order set past the current
-- maximum so existing run order in that package is not disturbed.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'assess:copilot-readiness',
  'appgov:stale-app-registrations',
  COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
             WHERE package_key = 'assess:copilot-readiness'), -1) + 1
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'assess:copilot-readiness')
ON CONFLICT (package_key, check_key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART E -- READ-ONLY: verify package membership after PART D
-- ══════════════════════════════════════════════════════════════════════════════

SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'appgov:stale-app-registrations'
ORDER BY package_key;

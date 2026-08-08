-- ============================================================================
-- #551 PHASE 3 -- appgov:unreviewed-consents and appgov:risky-permission-grants
-- both compute the SAME bare count() of the same 37 /oauth2PermissionGrants
-- rows under two different names. Redefine both using the real consentType
-- axis Phase 1 confirmed.
-- ============================================================================
-- Manual migration -- Shane runs this himself (no DATABASE_URL in the Claude
-- environment, per CLAUDE.md). Idempotent: a plain UPDATE of two rows by key,
-- safe to re-run.
--
-- ── WHAT WAS WRONG (confirmed live 2026-08-07, Phase 1 + its addendum, not
--    re-diagnosed here) ───────────────────────────────────────────────────────
-- appgov:unreviewed-consents:
--   mapping:  [{"transform":"count","sourceField":"consentType","targetField":"unreviewedConsentCount"}]
--   severity_rules: []
-- appgov:risky-permission-grants:
--   mapping:  [{"transform":"count","sourceField":"scope","targetField":"riskyPermissionGrantCount"}]
--   severity_rules: []
--
-- Both are `count`, which counts non-null VALUES of sourceField across items,
-- not a filtered subset. Every oAuth2PermissionGrant has both a consentType
-- and a scope, so both counts read exactly item_count (37) on the live test
-- tenant -- "37 unreviewed consent grants" and "37 risky permission grants"
-- are the same 37 rows, twice, neither computed from anything.
--
-- ── THE FIELD -- CONFIRMED AGAINST CURRENT GRAPH DOCS, NOT ASSUMED FROM THE
--    ISSUE'S OWN PARAPHRASE (learn.microsoft.com/en-us/graph/api/resources/
--    oauth2permissiongrant, v1.0, fetched 2026-08-08) ─────────────────────────
-- oAuth2PermissionGrant has exactly six properties: clientId, consentType, id,
-- principalId, resourceId, scope. consentType is documented verbatim as:
--   "Indicates if authorization is granted for the client application to
--    impersonate all users or only a specific user. AllPrincipals indicates
--    authorization to impersonate all users. Principal indicates authorization
--    to impersonate a specific user. Consent on behalf of all users can be
--    granted by an administrator. Nonadmin users might be authorized to
--    consent on behalf of themselves in some cases, for some delegated
--    permissions."
-- The two literal string values are exactly "AllPrincipals" and "Principal" --
-- the issue's phrasing was already the literal Graph enum, not a paraphrase
-- that needed correcting. $filter (eq only) is supported natively, but the
-- fix below stays a mapping-time countEquals rather than a $filter, so BOTH
-- checks can read the same /oauth2PermissionGrants response without needing
-- two different endpoint configs for what is otherwise the identical request.
--
-- ── THE SPLIT -- CONFIRMED LIVE, NOT ASSUMED (2026-08-07 diagnostic run,
--    Phase 1 addendum) ────────────────────────────────────────────────────────
--   AllPrincipals: 24   Principal: 13   total: 37   (24 + 13 = 37, reconciles)
--
-- Shane's call (this session): the two checks get the two SIDES of the same
-- honest split, not the same number twice under different names --
--
--   appgov:unreviewed-consents    -> consentType == 'Principal'      -> 13
--     A single end user consented on their own behalf. Per the Graph
--     description above, no administrator was ever in that loop. This is the
--     literal, narrow meaning of "unreviewed": nobody with authority looked
--     at it before it took effect.
--
--   appgov:risky-permission-grants -> consentType == 'AllPrincipals' -> 24
--     Tenant-wide, admin-granted. Renamed in effect from "was this reviewed"
--     (it was -- an administrator approved it) to "how many applications can
--     currently act as ANY user in this tenant" -- a real blast-radius signal
--     an admin consenting one grant does not shrink. This is the field the
--     issue's own Phase 1 recommendation named for a genuine risk read
--     ("scope is the right field... matched against something"); consentType
--     is used instead of a curated sensitive-scope list because the latter is
--     a real product decision (which scopes count as "risky"?) that this
--     migration does not make for Shane -- see the severity_rules note below.
--
-- Both checks keep a `totalConsentGrantCount` field (bare `count` on
-- consentType, i.e. the old, honest meaning of "every grant exists") as the
-- denominator, so "13 of 37" / "24 of 37" is expressible in the finding label
-- without a second Graph call -- same numerator+denominator shape #541 used
-- for passwordCredentialCount/expiredPasswordCredentialCount.
--
-- targetField names (`unreviewedConsentCount`, `riskyPermissionGrantCount`)
-- are UNCHANGED from today's mapping on purpose: signal_derivation_rules rows
-- (`docs/signals.json`, source_key columns) already reference these exact
-- field names, and changing them would silently break that wiring rather than
-- fix the check.
--
-- ── properties -- UNTOUCHED, DELIBERATELY ───────────────────────────────────
-- The endpoint and item shape are not changing (still /oauth2PermissionGrants,
-- still one item per grant), only the mapping's transform. Unlike #551 Phase 2
-- (a genuine endpoint swap), there is no reason to touch `properties` here and
-- doing so risks discarding whatever raw fields are already extracted for
-- these two rows with no benefit.
--
-- ── SEVERITY_RULES -- NOT SYMMETRIC, AND THAT ASYMMETRY IS DELIBERATE ───────
--
-- appgov:unreviewed-consents: {{unreviewedConsentCount}} > 0 -> "high".
-- A bare presence rule is safe here specifically because consentType ==
-- Principal means an ADMINISTRATOR NEVER SAW IT, by the Graph resource's own
-- definition -- there is no such thing as an ordinary, expected amount of
-- ungoverned self-consent the way "having a client secret" is ordinary for
-- cert-secret-expiration. "high" matches the severity already declared for
-- this signal in `docs/signals.json` (signal_derivation_rules,
-- signal.appgov.unreviewed-consents), which has been unreachable dead
-- metadata since severity_rules on the check itself was `[]`.
--
-- appgov:risky-permission-grants: NOT a bare `{{riskyPermissionGrantCount}} >
-- 0` rule, on purpose. AllPrincipals consent is exactly the "having a secret
-- at all is normal" case #541's own header warned against for a naive `> 0`
-- rule: Microsoft's own first-party setup (Office, Teams, the various
-- first-party service principals every tenant provisions) creates ordinary,
-- expected AllPrincipals grants, so `> 0` would fire "critical" on literally
-- every M365 tenant that has ever existed -- indistinguishable noise, the
-- opposite failure mode from today's silent-always-ok bug but not an
-- improvement over it. Shipped instead as a two-band magnitude rule:
--   >= 15 -> critical,  >= 5 -> warning
-- **These two numbers are a first-cut judgment call, not derived from a
-- confirmed "healthy" baseline** -- no reference tenant survey exists for
-- what a normal AllPrincipals count looks like across this platform's
-- customer base, the same honest gap the issue's own Phase 1 comment left
-- open for stale-app-registrations' beta-vs-rename choice. They are picked so
-- the check produces real content (the live test tenant's 24 clears both
-- bands) rather than sitting at "ok" forever, without guaranteeing noise on a
-- clean small tenant whose entire AllPrincipals footprint is a handful of
-- Microsoft defaults. Revising these two numbers as real tenant data
-- accumulates is expected and does not require another endpoint or mapping
-- change -- only this file's severity_rules values. The investigation's
-- sharper alternative (match risky SCOPES like Mail.ReadWrite,
-- Files.ReadWrite.All, Directory.ReadWrite.All rather than counting grants)
-- remains open as a follow-up; it needs a curated sensitive-scope list, which
-- is a product decision this migration does not make for Shane.
--
-- ── VERIFICATION STATUS ──────────────────────────────────────────────────────
-- No DATABASE_URL / no Graph credential in this environment. Logic is pinned
-- by a new vitest suite replaying applyMapping()/classifySeverity() against a
-- fixture shaped like the real tenant's confirmed 24/13 split (see
-- artifacts/api-server/src/lib/unreviewed-consents-risky-grants-551.test.ts).
-- PART D below is the one-shot live confirmation -- run it after a fresh scan
-- and expect unreviewedConsentCount 13 and riskyPermissionGrantCount 24 on
-- tenant c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com,
-- not last time's 37/37.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: the before-state, on the record
-- ══════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, properties, mapping, severity_rules, schema_version, status
FROM monitor_checks
WHERE key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
ORDER BY key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B -- THE CORRECTION (transactioned). Review PART A output first.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  mapping = '[
    {"sourceField":"consentType","targetField":"totalConsentGrantCount","transform":"count"},
    {"sourceField":"consentType","targetField":"unreviewedConsentCount","transform":"countEquals(''Principal'')"}
  ]'::jsonb,
  severity_rules = '[
    {"expression":"{{unreviewedConsentCount}} > 0","severity":"high","label":"{{unreviewedConsentCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) were self-consented by an end user with no administrator review (consentType Principal)"}
  ]'::jsonb,
  description = 'Grants where consentType is Principal -- a single end user consented on their own behalf and, per the oAuth2PermissionGrant resource''s own Graph documentation, no administrator was ever in that loop (#551 Phase 3). '
    || 'Replaces a bare count() of every /oauth2PermissionGrants row (37 on the live test tenant), which had no reviewed/unreviewed distinction of any kind -- oAuth2PermissionGrant carries no reviewed, approved or status property at all. '
    || 'totalConsentGrantCount is the honest denominator (every grant, admin- and self-consented alike); unreviewedConsentCount is the Principal-only subset. '
    || 'See appgov:risky-permission-grants for the AllPrincipals (admin-consented, tenant-wide) side of the same split -- the two checks now report two different real numbers instead of the same fictional one twice.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'appgov:unreviewed-consents'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

UPDATE monitor_checks
SET
  mapping = '[
    {"sourceField":"consentType","targetField":"totalConsentGrantCount","transform":"count"},
    {"sourceField":"consentType","targetField":"riskyPermissionGrantCount","transform":"countEquals(''AllPrincipals'')"}
  ]'::jsonb,
  severity_rules = '[
    {"expression":"{{riskyPermissionGrantCount}} >= 15","severity":"critical","label":"{{riskyPermissionGrantCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant"},
    {"expression":"{{riskyPermissionGrantCount}} >= 5","severity":"warning","label":"{{riskyPermissionGrantCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant"}
  ]'::jsonb,
  description = 'Grants where consentType is AllPrincipals -- tenant-wide, admin-granted access; the application can act as ANY user in the tenant for that grant''s scope (#551 Phase 3). '
    || 'Replaces a bare count() of every /oauth2PermissionGrants row (37 on the live test tenant, keyed off "scope" -- every grant has one, so it counted the same 37 rows as appgov:unreviewed-consents under a different name, with nothing risk-related computed). '
    || 'totalConsentGrantCount is the honest denominator (every grant, admin- and self-consented alike); riskyPermissionGrantCount is the AllPrincipals-only subset. '
    || 'NOT a presence rule (count > 0): ordinary Microsoft first-party tenant setup creates real, expected AllPrincipals grants, so severity fires only past the 5/15 magnitude bands below -- see this migration''s own header for why those two numbers are a first-cut judgment call, not a confirmed baseline. '
    || 'A finer signal (matching the grant''s scope string against a curated sensitive-permission list, e.g. Mail.ReadWrite / Files.ReadWrite.All / Directory.ReadWrite.All, rather than counting AllPrincipals grants) remains a follow-up -- it needs a product decision on which scopes count as risky that this migration does not make. '
    || 'See appgov:unreviewed-consents for the Principal (self-consented, unreviewed) side of the same split.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'appgov:risky-permission-grants'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ─────────────────────────────────────────────────────
-- Exactly 1 row per UPDATE. endpoint/properties/label untouched on both --
-- /oauth2PermissionGrants was already the correct endpoint and item shape;
-- only the mapping transform and severity_rules change.
--
-- If the receipts look right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-unreviewed-consents-risky-grants-consenttype-551.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C -- ASSESS:COPILOT-READINESS WIRING (issue item 5)
-- ══════════════════════════════════════════════════════════════════════════════
-- The Phase 1 addendum's Q4 table confirmed appgov:unreviewed-consents reaches
-- ONLY core:enhanced-monitoring, not assess:copilot-readiness -- so whatever it
-- is corrected to report never appeared in a Copilot Readiness assessment.
-- appgov:risky-permission-grants was not in that table's original WHERE clause
-- at all, so its assess:copilot-readiness membership was never actually
-- checked in Phase 1 -- confirmed here rather than assumed either way.
--
-- Read-only check FIRST -- see what's actually there before this file changes
-- anything.

SELECT c.key,
       bool_or(pc.package_key = 'assess:copilot-readiness')  AS in_copilot_readiness,
       bool_or(pc.package_key = 'core:security-baseline')    AS in_security_baseline,
       bool_or(pc.package_key = 'core:enhanced-monitoring')  AS in_enhanced_monitoring,
       array_agg(DISTINCT pc.package_key) FILTER (WHERE pc.package_key IS NOT NULL) AS all_packages
FROM monitor_checks c
LEFT JOIN monitoring_package_checks pc ON pc.check_key = c.key
WHERE c.key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
GROUP BY c.key
ORDER BY c.key;

-- The fix. Idempotent membership add, appended after whatever the package's
-- current highest sort_order is (mirrors #357's pattern for adding
-- compliance:eeeu-site-sharing to detail:full-item-collection) -- ON CONFLICT
-- DO NOTHING means this is safe to run whether or not either check turns out
-- to already be linked.

INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT 'assess:copilot-readiness', v.check_key,
       COALESCE((SELECT max(sort_order) FROM monitoring_package_checks
                  WHERE package_key = 'assess:copilot-readiness'), -1)
       + row_number() OVER (ORDER BY v.check_key)
FROM (VALUES ('appgov:unreviewed-consents'), ('appgov:risky-permission-grants')) AS v(check_key)
WHERE EXISTS (SELECT 1 FROM monitoring_packages WHERE key = 'assess:copilot-readiness')
  AND EXISTS (SELECT 1 FROM monitor_checks c WHERE c.key = v.check_key AND c.status = 'active')
ON CONFLICT (package_key, check_key) DO NOTHING;

-- Confirm after.

SELECT c.key,
       bool_or(pc.package_key = 'assess:copilot-readiness') AS in_copilot_readiness
FROM monitor_checks c
LEFT JOIN monitoring_package_checks pc ON pc.check_key = c.key
WHERE c.key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
GROUP BY c.key
ORDER BY c.key;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART D -- THE LIVE SMOKE TEST (do this after PART B/C and a fresh scan)
-- ══════════════════════════════════════════════════════════════════════════════
-- EXPECT on tenant c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com:
--   totalConsentGrantCount     37  (both rows -- same tenant, same endpoint)
--   unreviewedConsentCount     13  (was 37)
--   riskyPermissionGrantCount  24  (was 37)
-- If either comes back 37 again, that row's UPDATE did not actually take.

SELECT p.check_key, p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'totalConsentGrantCount'    AS total_grants,
       p.extracted_properties -> 'unreviewedConsentCount'    AS unreviewed_count,
       p.extracted_properties -> 'riskyPermissionGrantCount' AS risky_count
FROM tenant_monitor_profiles p
WHERE p.check_key IN ('appgov:unreviewed-consents', 'appgov:risky-permission-grants')
ORDER BY p.check_key, p.collected_at DESC
LIMIT 10;

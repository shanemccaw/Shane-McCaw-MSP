-- ============================================================================
-- appgov:cert-secret-expiration never fires + mapping counts all credentials,
-- not expiring ones (Git #541)
-- Manual — run by hand, not drizzle-kit. No DATABASE_URL in this environment.
-- ============================================================================
--
-- ── TWO CONFIRMED ROOT CAUSES (per the issue, not re-diagnosed here) ───────────
-- 1. monitor_checks.severity_rules for this check is an empty jsonb array
--    ([]) — classifySeverity() (monitor-executor.ts) returns null when nothing
--    matches, so EVERY run falls through to "ok" / "Check passed" regardless
--    of tenant state. Same class of bug as #470.
-- 2. The stored mapping is `{"transform":"count","sourceField":"passwordCredentials",
--    "targetField":"expiringCredentialCount"}` — a raw count of every secret the
--    app has, healthy or expired, mislabeled as "expiring". A naive `> 0`
--    severity rule on that field would fire on nearly every app registration
--    in existence (having a client secret at all is normal) — false-positive
--    noise, the opposite failure mode from the current silent-always-ok bug.
--
-- ── TWO MORE REAL GAPS FOUND DURING THIS INVESTIGATION, NOT IN THE ORIGINAL
--    ISSUE TEXT ─────────────────────────────────────────────────────────────
-- 3. The check is titled "Certificate/Secret Expiration Tracking" but the
--    stored mapping only ever read `passwordCredentials` (secrets).
--    `keyCredentials` (certificates) — the OTHER half of what the check's own
--    name promises to track — was never mapped at all. Fixed here alongside
--    the two confirmed bugs since it is the same shape of bug on the same
--    check and would otherwise ship as a second silent gap immediately after
--    this migration.
-- 4. Actually running `applyMapping`'s "count" transform against a fixture
--    (artifacts/api-server/src/lib/cert-secret-expiration-541.test.ts) showed
--    the old mapping's bug is deeper than its own paraphrase: `count` on an
--    array-valued sourceField maps sourceField to ONE VALUE PER ITEM
--    (resolvePathInData returns the whole array or undefined) and counts
--    non-null values — i.e. it counts APP REGISTRATIONS that have a
--    passwordCredentials array, never the credential entries inside it. A
--    tenant with 3 apps and 8 total password credentials read
--    `expiringCredentialCount: 3`, not 8. So this migration's
--    passwordCredentialCount/keyCredentialCount also use `countWhere` (with a
--    tautological per-entry predicate, `{{keyId}} != null` — every real
--    credential entry Graph returns carries its own keyId) rather than
--    `count`, so the "total" fields are finally real per-credential counts
--    too, not just the expired ones.
--
-- ── INVESTIGATION: CAN evalConditionGrammar READ A NESTED ARRAY FIELD
--    (each credential's own endDateTime) DIRECTLY IN A severity_rules
--    EXPRESSION? ───────────────────────────────────────────────────────────
-- No. `resolvePathInData` (monitor-executor.ts) walks NAMED properties only —
-- given `{{passwordCredentials.endDateTime}}` it steps into the array (an
-- object, so the walk continues) and asks it for an `endDateTime` property it
-- does not have, resolving to undefined for every item. A severity_rules
-- expression only ever sees the check's flat extracted_properties record, so
-- it cannot itself iterate "does ANY credential in this array satisfy X" —
-- confirming the issue's premise that a mapping-level pre-filter is required
-- BEFORE the severity rule ever sees the data, mirroring #212's PostFilter
-- pattern (adapted here: this check hits Graph directly via
-- GET /applications, no PowerShell/container involved).
--
-- The real mapping-level mechanism already exists and needed no new code:
-- `applyMapping`'s `countWhere('<expression>')` transform (grepped the FULL
-- transform vocabulary in applyMapping's switch, not just "count" — count,
-- exists, first, join, countTruthy, countFalse, countEquals, countEmptyArray,
-- countIfLastSignInOlderThan, groupByCount, countDuplicates, valueWhere,
-- flattenValues, raw, countWhere, countDuplicatesBy). Per its own
-- documentation in the source: when sourceField resolves to an ARRAY on at
-- least one item, countWhere evaluates its predicate — the SAME
-- evalConditionGrammar severity_rules uses — against each ARRAY ENTRY, not
-- the whole item. Each passwordCredentials/keyCredentials entry carries its
-- own `endDateTime` as a flat top-level property, so
-- `countWhere('{{endDateTime}} olderThanDays 0')` with sourceField
-- "passwordCredentials" (or "keyCredentials") counts exactly the entries
-- whose OWN endDateTime is in the past — a real per-credential expiry count,
-- computed once at mapping time, that a plain severity_rules expression could
-- never produce on its own.
--
-- ── WHY THIS FIX IS "ALREADY EXPIRED" ONLY, NOT "EXPIRING WITHIN N DAYS" ────
-- evalClause's olderThanDays/newerThanDays (monitor-executor.ts) are both
-- anchored backward from now: cutoff = now - N days, so olderThanDays N tests
-- "more than N days in the past" and newerThanDays N tests "within the last N
-- days" — the day argument is also regex-constrained to `^\d+$` (no sign), so
-- neither operator can express a FORWARD-looking window ("will expire within
-- the next N days"). olderThanDays 0 (cutoff = now) is exactly the boundary
-- that reads "already expired," which is what Shane's own description of the
-- live tenant names (a 2018 date, a 2023 date, one that expired 3 days before
-- the scan ran) — real past dates, not a future window. Building a genuine
-- "expiring within N days" signal would need a new forward-bound day operator
-- added to evalClause itself (a monitor-executor.ts code change, not a data
-- migration) plus Shane's sign-off on the window size N — left as an explicit
-- follow-up, not guessed at here, per the issue's own framing that this is a
-- product decision ("expired" vs "expiring soon" — separate or combined).
--
-- ── SEVERITY: "warning", matching #470's precedent for this same class of
--    bug (missing severity rule on a real hygiene/governance signal) — no
--    basis in the issue for a higher band, and "warning" (unlike "medium"/
--    "high"/"low") is one of the two severities PILLAR_FINDING_SEVERITIES
--    actually surfaces on customer-facing War Room pillar cards
--    (pillar-summary-stats.ts) ─────────────────────────────────────────────
--
-- ── VERIFICATION: no DATABASE_URL in this environment. PART A is read-only
--    and prints the current row so the before-state is on record. Real
--    testbed tenant named in the issue (c4c814d4-3afe-441e-9145-62461d0a4fd3 /
--    mccawsoft2.onmicrosoft.com) has 11 real credentials right now with
--    several already expired as of early August 2026 — Shane to re-scan after
--    running this and confirm expiredPasswordCredentialCount/
--    expiredKeyCredentialCount land nonzero and a real warning finding
--    appears, where today it silently reads "ok". Logic itself is pinned by
--    a new vitest suite replaying classifySeverity()/applyMapping() against a
--    fixture shaped like the real tenant's described credentials (see
--    artifacts/api-server/src/lib/cert-secret-expiration-541.test.ts).

-- ════════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: current state before anything changes
-- ════════════════════════════════════════════════════════════════════════════════

SELECT key, label, endpoint, method, properties, mapping, severity_rules, schema_version, status
FROM monitor_checks
WHERE key = 'appgov:cert-secret-expiration';

-- ════════════════════════════════════════════════════════════════════════════════
-- PART B -- CORRECTION (transactioned). Review PART A output first.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  mapping = '[
    {"sourceField":"passwordCredentials","targetField":"passwordCredentialCount","transform":"countWhere(''{{keyId}} != null'')"},
    {"sourceField":"keyCredentials","targetField":"keyCredentialCount","transform":"countWhere(''{{keyId}} != null'')"},
    {"sourceField":"passwordCredentials","targetField":"expiredPasswordCredentialCount","transform":"countWhere(''{{endDateTime}} olderThanDays 0'')"},
    {"sourceField":"keyCredentials","targetField":"expiredKeyCredentialCount","transform":"countWhere(''{{endDateTime}} olderThanDays 0'')"}
  ]'::jsonb,
  severity_rules = '[
    {"expression":"{{expiredPasswordCredentialCount}} > 0 || {{expiredKeyCredentialCount}} > 0","severity":"warning","label":"{{expiredPasswordCredentialCount}} expired secret(s) and {{expiredKeyCredentialCount}} expired certificate(s) found on this tenant''s app registrations"}
  ]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'appgov:cert-secret-expiration'
RETURNING key, label, endpoint, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ─────────────────────────────────────────────────────────
-- Exactly 1 row (appgov:cert-secret-expiration). endpoint/properties/label are
-- intentionally untouched — /applications is already the correct endpoint and
-- was not flagged as wrong by the issue.
-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-07-cert-secret-expiration-mapping-severity-541.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;

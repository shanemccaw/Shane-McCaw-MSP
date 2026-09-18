-- #4601 — Rework identity:mfa-method-breakdown from a bare count to a real
-- legacy-method predicate, and author severity_rules so it can finally
-- surface a finding.
-- Manual migration — run by hand against local Postgres (do NOT run
-- drizzle-kit push/push --force).
--
-- Real, live-confirmed against local Postgres (shanemccawmsp): identity:mfa-
-- method-breakdown's mapping was `[{"transform": "count", "sourceField":
-- "methodsRegistered", "targetField": "legacyMfaMethodCount"}]` — a plain
-- count of every user with ANY registered method (even after #4537's
-- empty-array fix), despite the check's own targetField name and description
-- ("Phishing-resistant (FIDO2/Windows Hello) vs SMS/legacy MFA methods in
-- use") promising a legacy-vs-modern distinction. severity_rules was `[]`,
-- so the check could never produce a finding regardless of its value.
--
-- `methodsRegistered` (Graph: userRegistrationDetails.methodsRegistered) is a
-- String collection, not an array of objects — countWhere's array-of-entries
-- path only accepts object-shaped entries (monitor-executor.ts's countWhere
-- case skips scalar entries as non-object), so filtering methodsRegistered's
-- own entries directly is not possible with that transform. Instead this
-- reuses the catalog's existing, proven pattern for "does this item's array
-- field contain one of these values" — sourceField "value" (whole-item scope,
-- a WHOLE_ITEM_SOURCE_FIELDS member) + the condition grammar's array-aware
-- `contains` operator, already live in identity:ca-legacy-auth-block's own
-- mapping against conditions.clientAppTypes.
--
-- Legacy method values (sms, voiceMobile, voiceAlternateMobile, voiceOffice)
-- per #4601's own body — real Graph enum values for methodsRegistered.
--
-- Severity shape follows the closest structural comparables in this catalog:
-- identity:mfa-registration ("mfaRegistrationGapCount > 0", warning) and
-- identity:legacy-auth-usage ("legacyAuthSignInCount > 0", warning) — single
-- rule, warning severity, fires when any user has a legacy method registered.

UPDATE monitor_checks
SET mapping = '[{"transform": "countWhere(\"{{methodsRegistered}} contains ''sms'' || {{methodsRegistered}} contains ''voiceMobile'' || {{methodsRegistered}} contains ''voiceAlternateMobile'' || {{methodsRegistered}} contains ''voiceOffice''\")", "sourceField": "value", "targetField": "legacyMfaMethodCount"}]'::jsonb,
    severity_rules = '[{"label": "{{legacyMfaMethodCount}} user(s) have a legacy (SMS/voice call) MFA method registered — phishing-susceptible compared to FIDO2/Windows Hello for Business", "severity": "warning", "expression": "legacyMfaMethodCount > 0"}]'::jsonb,
    updated_at = now()
WHERE key = 'identity:mfa-method-breakdown';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-18-mfa-method-breakdown-severity-rules-4601.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

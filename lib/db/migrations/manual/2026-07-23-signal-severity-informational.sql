-- ─────────────────────────────────────────────────────────────────────────────
-- Add "informational" as a legal severity value for signal_derivation_rules
-- and signal_rule_groups.
--
-- WHY: a live restore of snapshot id=1 (198-row original) hit rows whose real
-- severity is "informational" (signal.adoption.email-activity-trend,
-- signal.appgov.enterprise-app-count, signal.copilot.usage-by-app, and
-- others) — a value the TypeScript SIGNAL_SEVERITIES enum
-- (tenant-signals.ts, lib/db/src/schema/index.ts) never allowed. The
-- restore endpoint's own validation (parseIntelligenceFields,
-- admin-signal-rules.ts) correctly rejected it — that rejection now aborts
-- the restore loudly (see the accompanying code fix) instead of silently
-- writing blank INSERT params, which is what previously produced
-- "Failed query... $8 onward blank". SIGNAL_SEVERITIES has been updated in
-- code to ["informational", "low", "medium", "high", "critical"]; this
-- migration is the DB-side half of that change, IF a CHECK constraint
-- exists.
--
-- STEP 0 — RUN THIS FIRST: neither signal_derivation_rules nor
-- signal_rule_groups has a CREATE TABLE in this repo's migration history
-- (both predate the manual-migrations convention), so there is no static
-- evidence here of whether a DB-level CHECK constraint on `severity` exists.
-- Drizzle's `text(..., { enum: [...] })` is a TypeScript-only type hint —
-- it does NOT generate a Postgres CHECK constraint by itself. Run this
-- query and read the result before doing anything else:

SELECT
  con.conname,
  con.conrelid::regclass AS table_name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname IN ('signal_derivation_rules', 'signal_rule_groups')
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%severity%';

-- ── CASE A: the query above returns ZERO rows ─────────────────────────────────
-- There is no DB-level CHECK constraint — `severity` is a plain unconstrained
-- `text` column and "informational" is already a legal value at the DB
-- layer today. No ALTER needed. Nothing below this line needs to run.
-- (Also worth confirming no bad data already exists from a genuinely
-- different invalid value — run STEP 2 below regardless.)

-- ── CASE B: the query above returns a constraint row ──────────────────────────
-- A real CHECK exists and must be widened. Uncomment and run the two blocks
-- below, substituting the ACTUAL constraint name(s) from the query above —
-- do not assume the guessed names here are correct.

-- ALTER TABLE signal_derivation_rules DROP CONSTRAINT IF EXISTS signal_derivation_rules_severity_check;
-- ALTER TABLE signal_derivation_rules ADD CONSTRAINT signal_derivation_rules_severity_check
--   CHECK (severity IN ('informational', 'low', 'medium', 'high', 'critical'));

-- ALTER TABLE signal_rule_groups DROP CONSTRAINT IF EXISTS signal_rule_groups_severity_check;
-- ALTER TABLE signal_rule_groups ADD CONSTRAINT signal_rule_groups_severity_check
--   CHECK (severity IN ('informational', 'low', 'medium', 'high', 'critical'));

-- ── STEP 2 — sanity check for genuinely-invalid data (either case) ────────────
-- Confirms the only non-standard severity value in real data is
-- "informational" itself, not some other typo/garbage value that the new
-- fail-loudly restore/import code would (correctly) now reject.
SELECT DISTINCT severity, 'signal_derivation_rules' AS source_table FROM signal_derivation_rules
UNION
SELECT DISTINCT severity, 'signal_rule_groups' AS source_table FROM signal_rule_groups
ORDER BY severity;

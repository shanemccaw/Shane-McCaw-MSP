-- #2518 — policy_decisions.review_cadence: constrain to a fixed enum.
--
-- Carried forward from #2092, which found `reviewCadence` was genuinely free
-- text (`z.string().trim().min(1).max(100).optional()` in
-- artifacts/api-server/src/routes/portal-policy-decisions.ts) with no fixed
-- vocabulary anywhere, confirmed by the column's own schema comment. Shane
-- decided (#2518): Option A — fixed enum.
--
-- Vocabulary: Monthly, Quarterly, Semi-Annual, Annual, Biennial. Anything
-- outside that set is rejected at create time (400) by the app layer, not
-- silently accepted with a null review_due_at.
--
-- No DB-level CHECK constraint on the enum values themselves — matching this
-- schema's house convention of enforcing enums at the application layer
-- (REVIEW_CADENCES in lib/db/src/schema/msp.ts, drizzle `text({ enum: ... })`)
-- rather than a DB CHECK, the same precedent CLEARANCE_TRIGGER_TYPES and
-- msp_alert_rules.condition_type already set on this same table. The existing
-- `policy_decisions_review_xor_clearance_chk` CHECK (#1526) is untouched by
-- this migration — still enforcing review_cadence XOR clearance_condition.
--
-- policy_decisions is empty at authoring time (verified with psql: 0 rows),
-- so there is nothing to backfill or that could violate the new vocabulary —
-- this migration is documentation + the run-tracking marker, not a real DDL
-- change (the column was already nullable `text` from #1526; drizzle's
-- `{ enum: [...] }` is TS-side typing only, no DB-level effect to migrate).

BEGIN;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-policy-decision-review-cadence-enum-2518.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

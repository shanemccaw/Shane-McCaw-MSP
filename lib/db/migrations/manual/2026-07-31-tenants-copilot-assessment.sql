-- Persist the completed Copilot Assessment quiz profile per tenant — #237,
-- sub-issue of the Copilot Assessment epic #183.
--
-- Problem this fixes (confirmed with Shane on #237): the wizard's completed
-- QuizProfile lived ONLY in copilot-assessment.tsx's local React state. A
-- customer who did consent -> pay -> login -> complete the 13-step quiz, then
-- came back after a gap (a meeting, a fresh login), was made to redo the whole
-- quiz because nothing about it was ever written down. A schema audit for
-- #237 confirmed there was no table or column holding these answers at all —
-- the pre-existing `quiz_leads` table is the public marketing-site lead-capture
-- quiz (pre-auth, lead-gen), an entirely different artifact, and is NOT this.
--
-- Shape: ONE jsonb column on `tenants`, keyed by assessment section, following
-- the exact convention already set by `tenants.consent` (three independent
-- consent records folded into a single keyed jsonb map rather than three
-- columns or three tables). Only the "quiz" key is written today; the epic's
-- later phases (personas / use cases / final report) can persist per-tenant
-- state under their own keys with no further migration.
--
--   {
--     "quiz": {
--       "profile": { ...the frozen QuizProfile shape from #184... },
--       "completedAt": "2026-07-31T12:34:56.000Z",
--       "completedByUserId": 42
--     }
--   }
--
-- Default '{}' matches `consent`'s default, so every existing tenant row reads
-- back as "no completed quiz" without a backfill — the restore path treats a
-- missing "quiz" key as "show the quiz", which is exactly today's behaviour.
--
-- Drizzle definition: lib/db/src/schema/msp.ts (tenantsTable.copilotAssessment,
-- typed CopilotAssessmentStateMap).
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS copilot_assessment jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-tenants-copilot-assessment.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

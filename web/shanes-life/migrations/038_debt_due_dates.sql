-- Shane's Life -- real due_day on debts, for the Tax Levy payment reminder (Git #3161).
--
-- Numbered 038: live `finances` (checked directly, not assumed from the checked-out tree, per
-- this build's own prompt warning) already had 035_people_patterns.sql and
-- 036_push_subscriptions.sql applied from concurrent, not-yet-merged sessions -- same pattern
-- 034_catches.sql's own header documented. Then a genuine number COLLISION at 037 itself: a
-- concurrent session's 037_user_display_name.sql landed on the same live ledger under the same
-- number this file originally used, caught live by `bin/check.mjs`'s assertNoOrphanLedgerRows
-- before either file existed on origin/main. Renumbered to 038 and re-applied under the new
-- filename; 035/036/037 stay free for those sessions' real files.
--
-- Design contract pack Section 3, "Real Tax Levy payment reminder": the real, existing
-- $242/month IRS installment is "already tracked in ShanesSurvival's `debts` table, due the 12th
-- of each month starting November." `accounts` already carries a real `due_day` for exactly this
-- kind of recurring monthly date; `debts` has never needed one until now because nothing else in
-- it recurs on a calendar day. This adds the same real column, with the same real range check,
-- rather than inventing a second due-date shape.
--
-- Deliberately generic, not a name-matched special case: any debt row that gets a real due_day
-- becomes eligible for its own real, distinct due-date nudge (core/money.mjs
-- findDueDebtReminders, kind 'debt_due') -- separate from the general bill list simply by being
-- in this table at all, per Section 3's "own real, distinct nudge... not lumped anonymously into
-- the general bill list." Only the one real row below has a real due date to backfill today.

ALTER TABLE debts ADD COLUMN IF NOT EXISTS due_day integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debts_due_day_check') THEN
    ALTER TABLE debts ADD CONSTRAINT debts_due_day_check CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31);
  END IF;
END $$;

-- The real Treasury Offset Program installment agreement (this row's own `notes`, confirmed
-- 2026-09-04): "Recurring monthly payments the 12th of each month starting 11/12/2026."
UPDATE debts SET due_day = 12 WHERE creditor_name = 'Treasury Offset Program' AND due_day IS NULL;

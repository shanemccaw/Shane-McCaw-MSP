-- Shane's Life -- Bankruptcy/debt tracker, ported from Finance-Tracker (Git #3163).
--
-- Numbered 042: applied live against `finances` as 041_bankruptcy_overlay.sql, then a genuine
-- number COLLISION surfaced -- a concurrent, not-yet-merged session's 041_plaid_item_health.sql
-- landed on the same live ledger under the same number one second later, caught by
-- `src/migrate.mjs`'s own orphan-ledger-row check on the next boot. Same pattern 038's own
-- header documents. Renamed to 042 and the schema_migrations ledger row fixed up by hand
-- (rename, not re-run -- the ALTER/UPDATE below are the same ones already applied); 041 stays
-- free for that other session's real file.
--
-- Finance-Tracker's `BankruptcyItem` (FinanceContext.tsx:160-169, 1087-1112) was fully modeled
-- and CRUD'd -- addBankruptcyItem/updateBankruptcyItem/deleteBankruptcyItem -- but
-- FINANCE_TRACKER_AUDIT.md's own §6 calls it a "dead sub-feature": no screen there ever read
-- `finance.bankruptcyItems` or called a mutator. Confirmed by Shane directly: genuinely wanted,
-- just never got surfaced.
--
-- Real, investigated decision (also independently confirmed in
-- docs/shanes-life-design-contract-pack.md Section 12, "Bankruptcy/debt tracker -- real port,
-- overlaid onto ShanesSurvival's existing real debt data where it makes sense, not a
-- disconnected second list"): ShanesSurvival's own `debts` table already carries the real
-- bankruptcy-relevant debts (H1 Mortgage arrears, the Treasury Offset/IRS installment -- both
-- already `is_critical`). Finance-Tracker's shape (`type`, `originalBalance`/`currentBalance`
-- payoff tracking, `lastPaymentDate`) is a genuine overlay concern, not a separate entity --
-- `creditor`/`currentBalance`/`notes` already exist here as `creditor_name`/`balance`/`notes`.
-- This adds only the fields `debts` didn't already have, plus an explicit flag for which debts
-- are actually part of the bankruptcy filing (not every future `debts` row necessarily will be).
--
-- `debt_type` is deliberately free text, not a DB enum: Finance-Tracker's own "credit_card" |
-- "bnpl" is too narrow for what's actually here (a mortgage arrears, a federal tax debt) --
-- matching this app's existing "genuinely open classification, no fixed enum" convention
-- (README, `src/core/categories.mjs`) rather than inventing a vocabulary that doesn't fit.

ALTER TABLE debts ADD COLUMN IF NOT EXISTS debt_type text;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS original_balance numeric(14,2);
ALTER TABLE debts ADD COLUMN IF NOT EXISTS last_payment_date date;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS included_in_bankruptcy boolean NOT NULL DEFAULT false;

-- Backfill the two real, existing bankruptcy-relevant debts -- both already `is_critical`,
-- both real per the notes already on these rows.
UPDATE debts SET debt_type = 'mortgage', included_in_bankruptcy = true
  WHERE creditor_name = 'H1 Mortgage' AND debt_type IS NULL;
UPDATE debts SET debt_type = 'tax', included_in_bankruptcy = true
  WHERE creditor_name = 'Treasury Offset Program' AND debt_type IS NULL;

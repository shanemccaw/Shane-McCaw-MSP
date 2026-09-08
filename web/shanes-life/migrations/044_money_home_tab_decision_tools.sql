-- Shane's Life -- Home-tab decision tools support: bill skip-priority category + pending
-- paycheck distribution plans (Git #3171, real port of Finance-Tracker's Home tab per contract
-- pack Section 12: "Home-tab decision-support tools (Distribute Paycheck, Period Review, Skip
-- Suggestions, Transfer Instructions)").
--
-- Numbered 044: live `finances` already has real, unrelated files applied beyond what this
-- checkout had at branch time (041_plaid_item_health.sql, 043_account_mask.sql are real ledger
-- rows with no matching file in EITHER migrations directory on this checkout -- a pre-existing,
-- unrelated orphan-ledger condition filed separately, not caused by this migration). 040 and 042
-- are real, present files. 044 is the first number clear of all of that.
--
-- Two real, additive pieces:
--
-- 1. `accounts.bill_category` -- Skip Suggestions (Finance-Tracker `index.tsx:499-518`) ranks
--    bills to skip by category priority (shared > general > cars > h2 > h1). Finance-Tracker had
--    this as a first-class field on its own JSONB bill blob; ShanesSurvival's real `accounts`
--    table has never needed a skip-priority grouping until now. Backfilled from the real, already
--    -established ShanesSurvival naming convention (H1 / H2 prefixes for the two households,
--    vehicle/auto bills) rather than left NULL for every existing real bill -- an unclassified
--    bill would rank as 'general' by default anyway (money.mjs's own priority table), so this
--    backfill only sharpens bills that are unambiguously identifiable from their own real name.
--    Same pattern as 038_debt_due_dates.sql adding `debts.due_day`: a real field Shane's Life
--    itself owns and mutates on a table ShanesSurvival's own migrations otherwise own (money.mjs's
--    header is explicit that core bill fields -- target_amount, balance, role, due_day -- stay
--    ShanesSurvival's own MCP tools' job; bill_category is a NEW field with no ShanesSurvival
--    equivalent, so there is nothing to collide with).
--
-- 2. `paycheck_distributions` -- Distribute Paycheck's real "apply" step (Finance-Tracker
--    `applyDistribution`, `index.tsx:761-782`) has to persist SOMETHING for Transfer Instructions
--    (`index.tsx:784-799`, `transferGroups` `:383-408`) to read afterward -- Finance-Tracker's own
--    version reads this back off `bill.envelopeBalance > 0`, a shape that was deliberately NOT
--    ported here (money.mjs's own #3162 header: bill accounts are real, separate, Plaid-linked
--    accounts, so there is no shadow envelope ledger to shadow-write). What Shane's Life needs
--    instead is a real, small, purpose-built table: a computed distribution plan sits here as
--    "pending" (real money the plan calls for moving, not yet actually moved at NFCU) until
--    Transfer Instructions' own "Mark as Transferred" clears it -- the literal Shane's Life
--    analogue of Finance-Tracker's "bills with envelope money already sitting in them."
--    Structurally read-only with respect to real balances, same discipline as simulateTransfer:
--    nothing in this table can move a real dollar, it only records the plan.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bill_category text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_bill_category_check') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_bill_category_check
      CHECK (bill_category IS NULL OR bill_category IN ('shared', 'general', 'cars', 'h2', 'h1'));
  END IF;
END $$;

-- Real backfill from ShanesSurvival's own existing naming convention. Order matters: the H1/H2
-- prefix checks run first so a hypothetical "H1 Auto Loan" lands on its household, not 'cars'.
UPDATE accounts SET bill_category = 'h1' WHERE role = 'bill' AND bill_category IS NULL AND name ILIKE 'H1 %';
UPDATE accounts SET bill_category = 'h2' WHERE role = 'bill' AND bill_category IS NULL AND name ILIKE 'H2 %';
UPDATE accounts SET bill_category = 'cars' WHERE role = 'bill' AND bill_category IS NULL
  AND (name ILIKE '%Tesla%' OR name ILIKE '%Kia%' OR name ILIKE '%Auto%');
-- Everything else real and unclassified (Subscriptions, etc.) defaults to 'general' -- the same
-- tier an unset category would rank at in the priority sort anyway, made explicit.
UPDATE accounts SET bill_category = 'general' WHERE role = 'bill' AND bill_category IS NULL;

CREATE TABLE IF NOT EXISTS paycheck_distributions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount         numeric(12, 2) NOT NULL CHECK (amount > 0),
    source_amount  numeric(12, 2) NOT NULL, -- the total paycheck this plan was distributed from
    created_at     timestamptz NOT NULL DEFAULT now(),
    transferred_at timestamptz -- set by "Mark as Transferred"; NULL = still pending
);

-- "Current pending plan" is the real hot path (Transfer Instructions reads this on every Money
-- load); partial index keeps it cheap regardless of how much transferred history accumulates.
CREATE INDEX IF NOT EXISTS paycheck_distributions_pending_idx
  ON paycheck_distributions (user_id, account_id)
  WHERE transferred_at IS NULL;

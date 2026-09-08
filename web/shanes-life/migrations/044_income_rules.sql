-- Shane's Life -- real income-matching rules + transaction auto-scan (Git #3169).
--
-- Real port of `shanemccaw/Finance-Tracker`'s `IncomeRule` + `scanTransactions()`
-- (artifacts/finance-home/app/(tabs)/income.tsx, :282-355, read via FINANCE_TRACKER_AUDIT.md
-- section 1) -- same real, transparent, debuggable text-match model (contains/starts-with/
-- exact, optional amount range), not an opaque ML categorizer.
--
-- `income_sources`, `income_entries` and `transactions` already exist -- they are
-- ShanesSurvival's own real tables, shared via #3107's unification, same as `accounts`/`debts`
-- #3137 already reads. This migration extends them additively:
--
--   1. income_sources.is_primary -- the real, honest gap the Finance-Tracker audit calls out by
--      name: "no way to change which income source is primary... a one-way flag set only by a
--      one-time migration fallback, yet it drives the entire app's cycle math." Unlike
--      Finance-Tracker (one household income model), Shane's Life's own Budget Day
--      (money.mjs computeBudgetDay) already treats every active source equally and picks
--      whichever's next_pay_date is soonest -- there is no single flag driving app-wide math
--      here to begin with. So this column is the real, editable setting the gap asks for
--      (a label Shane can set and change, surfaced in list_income_rules/get_gate_status), not a
--      rewire of Budget Day's own working multi-source model onto a single "primary" source.
--
--   2. income_rules -- the real rule rows themselves. Every column has a direct Finance-Tracker
--      counterpart (name, accountId, matchText, matchType, incomeSourceId, isActive) plus the
--      one improvement the audit itself flags Finance-Tracker as missing on THIS specific rule
--      type: "amountMin/amountMax inputs are exposed only [on TransactionRule], not in the
--      analogous Income Rule editor, which has no amount filter at all." The issue's own scope
--      explicitly asks for the amount range here, so both min_amount and max_amount are real
--      columns from the start.
--
--   3. income_entries.transaction_id -- real dedupe. Finance-Tracker's own scan keys off
--      `incomeEntries.transactionId` the same way; this is the column income_entries never
--      needed until an automated writer (this scan) could create more than one entry for the
--      same real deposit. A partial unique index makes "no real duplicates on a second scan"
--      (the issue's own verification line) a structural guarantee, not just app-level care.
--
--      Real, honest note found while building this (not fixed by this migration, just why the
--      dedupe logic in src/core/income-rules.mjs also tries a same-source/date/amount claim
--      before inserting): the real local `finances` database already has 9 real income_entries
--      rows for the one real income source (NASA Salary), entered before this feature existed
--      via ShanesSurvival's own RecordEntryAsync MCP tool, with nothing to link them to their
--      own real transactions row. A dedupe keyed on transaction_id alone would not recognise
--      those as already-recorded and would duplicate them the first time a real rule matches
--      the same real deposits.
CREATE TABLE IF NOT EXISTS income_rules (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    -- The real linked account whose transactions this rule watches (e.g. DirectDeposit).
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Which real income source a match gets credited to.
    source_id    uuid NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
    match_type   text NOT NULL DEFAULT 'contains'
                 CHECK (match_type IN ('contains', 'starts_with', 'exact')),
    match_text   text NOT NULL,
    -- Optional real amount range, in dollars (matches every other money column in this schema).
    -- Both null means "no amount filter", same as Finance-Tracker's TransactionRule shape.
    min_amount   numeric(14,2),
    max_amount   numeric(14,2),
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
);

CREATE INDEX IF NOT EXISTS income_rules_account_idx ON income_rules (account_id) WHERE is_active;

ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- At most one real primary source at a time. A partial unique index on a column that is only
-- ever indexed while true means a second UPDATE ... SET is_primary = true collides on the
-- existing row instead of silently creating two "primary" sources -- setPrimarySource()
-- (income-rules.mjs) clears the old one and sets the new one in the same real transaction, but
-- this is the structural backstop if that ever isn't the only write path.
CREATE UNIQUE INDEX IF NOT EXISTS income_sources_primary_idx ON income_sources (is_primary) WHERE is_primary;

ALTER TABLE income_entries ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS income_entries_transaction_id_idx
    ON income_entries (transaction_id) WHERE transaction_id IS NOT NULL;

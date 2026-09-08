-- Shane's Life -- real payoff-progress history for the critical debts overlay (Git #3210).
--
-- The design (`Shanes Life 17 - Money v3.dc.html` option 1d, "Debts · critical first") asks for
-- a real payoff-progress sparkline per debt plus a "Since Jan 1: $X paid down across both"
-- summary. Neither exists today: `debts` (migration 042's bankruptcy overlay) only ever carried
-- the CURRENT balance -- no history table anywhere in this schema or ShanesSurvival's own
-- (checked both migrations/ directories, see README's shared-database rule) records what a
-- debt's balance was on any past date. There is no real Jan-1-2026 balance to read, so this
-- does not fabricate one -- it starts a real, growing snapshot history from today forward, and
-- the "paid down since" summary reads its real earliest recorded date, whatever that is, rather
-- than a hardcoded "Jan 1" that would have nothing real behind it.
--
-- One row per debt per day (`UNIQUE (debt_id, recorded_on)`) -- updateDebt firing more than
-- once in a day overwrites that day's snapshot rather than growing a second row for it, so the
-- sparkline reads one point per real day of history, not one point per edit.

CREATE TABLE IF NOT EXISTS debt_balance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  recorded_on DATE NOT NULL DEFAULT CURRENT_DATE,
  balance NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (debt_id, recorded_on)
);

CREATE INDEX IF NOT EXISTS debt_balance_history_debt_id_recorded_on_idx
  ON debt_balance_history (debt_id, recorded_on);

-- Real backfill: today's snapshot for every real debt on file, taken from its own real current
-- balance -- the honest starting point for tracking going forward, not an invented past value.
INSERT INTO debt_balance_history (debt_id, recorded_on, balance)
SELECT id, CURRENT_DATE, balance FROM debts
ON CONFLICT (debt_id, recorded_on) DO NOTHING;

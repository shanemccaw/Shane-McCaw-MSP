-- Git #3212: the bill-detail bottom sheet's real envelope breakdown (Shane's own resolution on
-- #3209 -- "it's not really software tracking, the envelope is the bank account ... it's whatever
-- is actually in the bank account"). The rolled-over/this-cycle split is a real, lightweight
-- COMPUTED VIEW over two real Plaid balances -- the account's current balance, and a real snapshot
-- of that same balance taken once at the start of the current cycle -- never a separate, driftable
-- assigned/envelopeBalance shadow ledger.
--
-- One row per (bill account, cycle start) captured once and never overwritten: it is the real
-- balance at a real point in time, and a later balance change (spending down, a second deposit)
-- must not rewrite what "rolled over" meant at the moment the cycle began. Captured by
-- money.mjs's captureBillCycleSnapshots(), run at boot and on the existing 6-hour housekeeping
-- sweep (server.mjs) -- idempotent via the unique (account_id, cycle_start) below, so a sweep
-- that runs after the first one already captured this cycle is a real no-op.
--
-- Doubles as the real "Funded at each payday · 8 cycles" sparkline's data source: the design's own
-- GigSparkline, scrubbed to one bill. There is no synthetic backfill for cycles before this
-- migration ran -- the sparkline honestly shows only the real cycles captured going forward,
-- rather than inventing history that was never actually recorded.
CREATE TABLE IF NOT EXISTS bill_cycle_snapshots (
    id            bigserial PRIMARY KEY,
    account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    cycle_start   date        NOT NULL,
    balance_cents bigint      NOT NULL,
    captured_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, cycle_start)
);

CREATE INDEX IF NOT EXISTS bill_cycle_snapshots_account_idx
    ON bill_cycle_snapshots (account_id, cycle_start DESC);

-- The real "Payment reference in Vault ->" link (design 1e): a vault entry can now name which
-- real bill account it's the payment reference for, so the bill sheet can look one up instead of
-- the link being permanently unreachable. Nullable and ON DELETE SET NULL -- an entry is never
-- deleted just because the bill account it was linked to was removed upstream in ShanesSurvival.
ALTER TABLE vault ADD COLUMN IF NOT EXISTS bill_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vault_bill_account_idx ON vault (bill_account_id) WHERE bill_account_id IS NOT NULL;

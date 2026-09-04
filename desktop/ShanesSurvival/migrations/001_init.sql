-- ShanesSurvival — initial schema
-- Hand-written SQL, no ORM migration tool. Run once against the target Postgres database
-- (see README.md for how the app resolves its connection string).
--
-- Run manually with, e.g.:
--   psql "postgresql://postgres:<password>@localhost:5432/shanessurvival" -f migrations/001_init.sql

BEGIN;

CREATE TABLE IF NOT EXISTS plaid_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_token      TEXT NOT NULL,
    institution_name  TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plaid_item_id     UUID NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
    plaid_account_id  TEXT NOT NULL,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    subtype           TEXT,
    current_balance   NUMERIC(14, 2),
    available_balance NUMERIC(14, 2),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plaid_item_id, plaid_account_id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plaid_transaction_id  TEXT NOT NULL UNIQUE,
    amount                NUMERIC(14, 2) NOT NULL,
    date                  DATE NOT NULL,
    merchant_name         TEXT,
    category              TEXT,
    pending               BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manually entered by Shane, not sourced from Plaid — real debts/collections/garnishments
-- often don't show up cleanly in Plaid transaction data.
CREATE TABLE IF NOT EXISTS debts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creditor_name    TEXT NOT NULL,
    balance          NUMERIC(14, 2) NOT NULL,
    minimum_payment  NUMERIC(14, 2),
    is_delinquent    BOOLEAN NOT NULL DEFAULT false,
    days_past_due    INTEGER NOT NULL DEFAULT 0,
    notes            TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A point-in-time manual snapshot Shane can save of his overall financial position.
CREATE TABLE IF NOT EXISTS survival_snapshots (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_cash           NUMERIC(14, 2) NOT NULL,
    total_debt           NUMERIC(14, 2) NOT NULL,
    monthly_income       NUMERIC(14, 2) NOT NULL,
    monthly_fixed_costs  NUMERIC(14, 2) NOT NULL,
    notes                TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_plaid_item_id ON accounts (plaid_item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);

COMMIT;

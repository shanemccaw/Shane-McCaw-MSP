-- Financial Ledger (Git #4863, sub-issue of #3086's Money room).
--
-- Money had real current-state tools (get_gate_status, list_debts/set_debt) but nothing that
-- records EVENTS over time -- a payment made, a transfer between accounts, a lender notice. Those
-- landed as free-text capture() blobs. This is the real dated ledger.
--
-- event_type is free text (payment | transfer | notice | balance_update | legal | other), NOT a
-- CHECK or enum -- same "don't over-engineer into a fixed enum" precedent as debts.debt_type.
-- amount_cents is nullable: a notice or legal event may carry no amount. debt_id resolves a real
-- debts row (the tool matches by creditor name); ON DELETE SET NULL so deleting a debt never
-- destroys the history, and `note` always keeps the full free-text detail.
CREATE TABLE IF NOT EXISTS financial_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type   text        NOT NULL,
    amount_cents integer,
    from_account text,
    to_account   text,
    source       text,
    debt_id      uuid        REFERENCES debts(id) ON DELETE SET NULL,
    occurred_on  date        NOT NULL DEFAULT CURRENT_DATE,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_events_user_occurred_idx
    ON financial_events (user_id, occurred_on DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS financial_events_debt_idx
    ON financial_events (debt_id, occurred_on DESC);

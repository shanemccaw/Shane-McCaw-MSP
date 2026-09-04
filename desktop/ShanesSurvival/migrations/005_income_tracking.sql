-- ShanesSurvival — Income sources + pay history tracking (#2905)
-- Real income sources (NASA salary biweekly, Ronnie's Uber gig income, Shane McCaw Consulting
-- freelance) and real historical deposits, same shape as the old budgeting app export Shane
-- shared 2026-09-04. Sets up (but does not itself wire) #2904's pay_period_due_status pulling
-- next_pay_date automatically from a real income source — out of scope here. Applied
-- automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

CREATE TABLE IF NOT EXISTS income_sources (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 TEXT NOT NULL UNIQUE,
    person               TEXT NOT NULL,
    pay_frequency_days   INTEGER,
    expected_per_cycle   NUMERIC(14, 2),
    next_pay_date        DATE,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS income_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID NOT NULL REFERENCES income_sources (id) ON DELETE CASCADE,
    date         DATE NOT NULL,
    amount       NUMERIC(14, 2) NOT NULL,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_income_entries_source_id_date
    ON income_entries (source_id, date DESC);

COMMIT;

-- ShanesSurvival — Expected one-time events (#2910)
-- Real need, from Shane 2026-09-04: he won a lawsuit against his homeowners insurance and got
-- a new roof. Two real one-time amounts to track: owes $2,500 (the real deductible) and expects
-- $6,000 (real repair reimbursement, contingent on the roofing company certifying the completed
-- roof with the insurance company — not yet real money, no guaranteed date).
--
-- Neither existing table fits: debts (#2903) is real owed money modeled around ongoing
-- arrears/creditors, not a one-time contingent obligation; income_sources/income_entries
-- (#2905) are recurring/already-received income, not a one-time pending inflow. This is its own
-- honest concept — a pending one-time event that hasn't happened yet, might be inflow or
-- outflow, and Claude Desktop can factor into planning conversations without it being counted
-- as real money until it's actually realized.
--
-- Deliberately NOT linked into gate_status/bill_status shortfall math this pass — these are
-- real, *pending* amounts, not current real balances; folding them in would misrepresent
-- today's actual position.
--
-- Applied automatically by MigrationRunner (see README.md) — no manual psql step needed.

BEGIN;

CREATE TABLE IF NOT EXISTS expected_one_time_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description        TEXT NOT NULL,
    direction          TEXT NOT NULL,
    amount             NUMERIC(14, 2) NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    contingency_notes  TEXT,
    expected_date      DATE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    realized_at        TIMESTAMPTZ
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'expected_one_time_events_direction_check'
    ) THEN
        ALTER TABLE expected_one_time_events
            ADD CONSTRAINT expected_one_time_events_direction_check
            CHECK (direction IN ('inflow', 'outflow'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'expected_one_time_events_status_check'
    ) THEN
        ALTER TABLE expected_one_time_events
            ADD CONSTRAINT expected_one_time_events_status_check
            CHECK (status IN ('pending', 'realized', 'cancelled'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expected_one_time_events_status_expected_date
    ON expected_one_time_events (status, expected_date);

COMMIT;

-- Shane's Life -- Money -> Cars: real maintenance spend history (Git #3149).
--
-- 017_money_extras.sql already created `vehicles` (name, loan_bill_id, insurance_amount,
-- registration_due, registration_amount, maintenance_interval_miles, next_maintenance_on,
-- next_maintenance_note) -- the per-vehicle identity + next-reminder half of the Cars card.
-- What is still missing is anywhere for "real maintenance spend" (contract Section 3) to
-- actually live: without a log, "aggregated all-in $/mo" would have to either omit maintenance
-- entirely or invent a number, and neither is honest. This is that log.
--
-- Deliberately NOT modeled on pet_vaccines' interval_days/last_on/due_on shape: that pattern
-- rolls a due date forward by a fixed number of DAYS, but vehicles.maintenance_interval_miles
-- is a mileage interval, and this app has no real odometer feed to convert miles to a calendar
-- date. Faking that conversion would be inventing data, not building a feature -- so
-- next_maintenance_on/next_maintenance_note (017) stay exactly what they already are: a
-- real date Shane or Claude states directly (same "on-the-fly, not computed" pattern as a
-- birthday or a visit), and this table only ever records what was ACTUALLY done and what it
-- ACTUALLY cost.

CREATE TABLE IF NOT EXISTS vehicle_maintenance_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id   uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performed_on date        NOT NULL DEFAULT current_date,
    description  text        NOT NULL,
    amount       numeric(12,2) NOT NULL,
    mileage      integer,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_maintenance_log_vehicle_idx
    ON vehicle_maintenance_log (vehicle_id, performed_on DESC);

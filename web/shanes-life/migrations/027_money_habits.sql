-- Shane's Life -- the real modeled recurring habit behind Money's "really" line (Git #3137).
--
-- Numbered 027, not 026: #3135's 026_medications.sql landed on main while this was in flight.
--
-- Design/design_handoff_shanes_life/README.md, "Money math (mirror `DashboardService.cs`)":
--   "Habit modeling: subtract the modeled recurring habit (cigarettes, $148/cycle) in the
--    'really' line."
-- and the prototype's own logic class, which carries it as a single real number on the money
-- state (`habit: 148`) and spends it in exactly two places:
--   habitLine = 'Cigarettes usually run <habit> a cycle. Counting that: <top - habit> really.'
--   whatIf(amt) = top - habit - amt
--
-- ShanesSurvival has no table for this: `accounts` carries bill targets, `debts` carries what is
-- owed, `smoke_log` (017) carries what was actually smoked -- none of them carry "what a habit
-- costs me per pay cycle, as a model". Without this table the "really" line and what_if() would
-- have to hardcode 148, which is exactly the fixture-data failure this repo bans. So it is a
-- real column instead: Shane (or Claude, over MCP) states the model once, and every later
-- computation reads it.
--
-- Deliberately general rather than a single `cigarettes_per_cycle` column: "the modeled
-- recurring habit" is the design's example, not its limit, and the same subtraction is correct
-- for any real recurring personal spend that never lands as a bill account. Rows are summed, so
-- a second habit needs no schema change and no code change.
--
-- Per cycle, not per month: the whole Money screen is denominated in the real pay cycle
-- (income_sources.pay_frequency_days, 14 today), so a monthly figure here would silently mix
-- units with the shortfall it is subtracted from.
CREATE TABLE IF NOT EXISTS money_habits (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             text          NOT NULL,
    -- The model itself. What this habit is expected to cost across one real pay cycle.
    amount_per_cycle numeric(12,2) NOT NULL,
    -- Optional real unit economics, so a log entry ("bought a pack") can price itself rather
    -- than carrying a literal: unit_label 'pack', unit_cost 8.40. Null when the habit is only
    -- ever modeled in aggregate.
    unit_label       text,
    unit_cost        numeric(12,2),
    -- The design's red-tinted "Cigarettes, in plain numbers" card is fed from smoke_log (017);
    -- this points a habit at that real log so the two are not two unrelated ideas of the same
    -- thing. 'smoke_log' is the only real value today; null means "modeled only, nothing logs it".
    log_source       text,
    is_active        boolean       NOT NULL DEFAULT true,
    note             text,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- One row per named habit per user. Saying "cigarettes run about $160 now" updates the model
-- rather than stacking a second cigarettes row that would be double-subtracted.
CREATE UNIQUE INDEX IF NOT EXISTS money_habits_user_name_idx ON money_habits (user_id, lower(name));
CREATE INDEX IF NOT EXISTS money_habits_user_active_idx ON money_habits (user_id) WHERE is_active;

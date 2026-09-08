-- Shane's Life -- Tesla battery/charging-aware Money nudges (Git #3238, Feature #3237).
--
-- Real scope confirmed after investigating Tesla's own Fleet API docs (developer.tesla.com):
-- the "kWh needed x Tesla's own real per-kWh Supercharger rate" cost formula the issue itself
-- proposed doesn't hold -- Tesla's charging endpoints (charging_history, charging_invoice,
-- nearby_charging_sites) publish no documented, structured pricing field anywhere; the only
-- structured "invoice" artifact is a PDF for a session that already happened, useless for a
-- forward-looking estimate. Same real gap #3217 already hit and the same real fix: the cost
-- estimate is computed from Shane's own real, self-entered settings (commute distance, his
-- car's real efficiency, his real charging rate) -- not a value invented or scraped from
-- Tesla. The battery-shortfall check itself IS real, live Tesla data
-- (charge_state.battery_range, documented and already reachable via the fleetGet() helper
-- Git #3158 shipped).
--
-- These columns live on tesla_accounts (one real row per user, migration 055) rather than a
-- new table -- there is exactly one real Tesla connection per user today, and this is
-- genuinely per-connection configuration, not a repeating record.
--
-- Idea #2 (failed-Tesla-payment nudge) is deliberately NOT represented here: investigated and
-- confirmed not buildable against Tesla's real, documented API (no payment/invoice status
-- field exists anywhere) -- see build-journal/3238.md and the filed finding issue for the
-- real evidence. Nothing here fabricates that signal.

ALTER TABLE tesla_accounts
    ADD COLUMN IF NOT EXISTS low_battery_nudge_enabled boolean NOT NULL DEFAULT false,
    -- Real, Shane-stated one-way-or-round-trip commute distance this vehicle needs to cover
    -- tomorrow. Never inferred/guessed -- there is no real odometer-trip-history feed this
    -- app has that could derive it honestly.
    ADD COLUMN IF NOT EXISTS commute_miles_needed numeric(6,1),
    -- Real, Shane-stated vehicle efficiency (miles per kWh) -- Tesla's API does not publish
    -- this per-vehicle either; it's on the window sticker / Tesla's own app, so Shane already
    -- knows the real number.
    ADD COLUMN IF NOT EXISTS efficiency_miles_per_kwh numeric(6,2),
    -- Real, Shane-stated cost per kWh (his real electricity rate, or the Supercharger rate he
    -- actually pays) -- see the header above for why this can't come from Tesla directly.
    ADD COLUMN IF NOT EXISTS charge_cost_per_kwh numeric(6,3);

-- Real fix for Git #3284 (sub-issue of Feature #3237): "Sync stuff works. But then goes away.
-- You have to sync again to see it." Confirmed root cause -- viewTesla()'s "Right now" card
-- (public/app.js, migration 060's Cars/Tesla room) held the last real climate/charge read
-- (lastClimate, rangeLine/battLine/climateLine) only in local JS variables scoped to that one
-- call of viewTesla(). render()'s view.replaceChildren() on every navigation, and the #3268
-- pull-to-refresh gesture's own render() call, both wipe those variables back to their initial
-- "not read yet" / "—" state. No server-side persistence of a real read existed at all.
--
-- These seven columns are the real last-read snapshot, written by tesla.mjs's
-- getVehicleClimateState()/getChargeState() after every successful real Fleet API read (the
-- same two calls runCheckNow() already makes), and returned by GET /api/tesla/status so
-- viewTesla() can pre-populate the card on load instead of always starting blank. All nullable:
-- null means genuinely never read, the same honest "not read yet" state the room already shows
-- today -- this does not invent a value where none exists yet.
-- last_battery_range is numeric, not integer: Tesla's real charge_state.battery_range is a
-- decimal rated-range figure (e.g. 245.32), not a whole mile -- same precision
-- getChargeState()/viewTesla() already display today, so storing it as an integer would
-- silently truncate a real value on every persisted read.
ALTER TABLE tesla_accounts
    ADD COLUMN IF NOT EXISTS last_battery_range  numeric(6,2),
    ADD COLUMN IF NOT EXISTS last_battery_level  integer,
    ADD COLUMN IF NOT EXISTS last_charging_state text,
    ADD COLUMN IF NOT EXISTS last_inside_temp    numeric(5,2),
    ADD COLUMN IF NOT EXISTS last_outside_temp   numeric(5,2),
    ADD COLUMN IF NOT EXISTS last_climate_on     boolean,
    ADD COLUMN IF NOT EXISTS last_read_at        timestamptz;

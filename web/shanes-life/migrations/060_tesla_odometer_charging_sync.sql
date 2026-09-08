-- Real Tesla odometer sync + charging session tracking (Git #3217, Feature #3237, sub-issue of
-- the Cars tab #3149): "so a real question like 'is this car actually worth keeping' has one
-- real aggregated answer" now extends to mileage-based maintenance and real charging data,
-- feeding vehicles.mjs's own "no real odometer feed" gap called out in migration 032's header.
--
-- Real, investigated conclusion on the charging-cost question #3217 itself asked to confirm
-- rather than assume: Tesla's Fleet API publishes no documented, structured cost/price/fee field
-- anywhere reachable by a personal (non-Business) developer account -- `charging/invoice` returns
-- a PDF, `charging/sessions` (which does carry pricing) is Business-fleet-only, and
-- `charging/history` itself has no field schema published at all on developer.tesla.com. This
-- matches and extends #3238/#3258's own prior investigation of the same real API surface (see
-- migration 056's header) -- confirmed independently again this session, including against a
-- real third-party integration built directly on this endpoint (energy added, duration, battery
-- range, location -- no cost field). So: real energy/session data is synced from Tesla;
-- cost_estimate_cents below is always a computed ESTIMATE off Shane's own real
-- tesla_accounts.charge_cost_per_kwh (migration 056), never a value Tesla itself provides --
-- same honest-estimate discipline #3238 already established for the commute-shortfall nudge.

-- Which one real Money-tracked vehicle (vehicles, migration 017) is the currently-connected
-- Tesla (tesla_accounts.vehicle_id) -- there is exactly one real Tesla connection today, but
-- Cars can hold more than one real vehicle (Model 3 + Kia Forte), so this has to be a real,
-- explicit link Shane sets, not an assumption baked into the sync. current_mileage/
-- mileage_synced_at are the real, periodically-synced odometer reading -- see core/tesla.mjs's
-- getVehicleState() (vehicle_state.odometer, Tesla's own long-stable, documented field, in
-- miles) and core/vehicles.mjs's syncOdometerFromTesla().
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS tesla_synced boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS current_mileage integer,
    ADD COLUMN IF NOT EXISTS mileage_synced_at timestamptz;

-- Real charging sessions pulled from Tesla's own /api/1/dx/charging/history. tesla_session_key
-- is a best-effort dedupe key -- Tesla's own session id when the real response actually carries
-- one recognisable, else a stable hash of that session's own start time + location -- because,
-- per the header above, this endpoint's field schema is not officially published and this build
-- has no live connection yet to confirm a canonical id field; the unique index still makes a
-- repeat sync idempotent either way once it does run live. `raw` retains the real, unparsed
-- response for the row so a future session can revisit field-mapping against what Tesla actually
-- sends, rather than this session's best-evidenced guess being the last word on it.
CREATE TABLE IF NOT EXISTS tesla_charging_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tesla_session_key   text        NOT NULL,
    started_at          timestamptz,
    location            text,
    energy_added_kwh    numeric(8,3),
    cost_estimate_cents integer,
    raw                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
    synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tesla_charging_sessions_user_key_idx
    ON tesla_charging_sessions (user_id, tesla_session_key);
CREATE INDEX IF NOT EXISTS tesla_charging_sessions_user_started_idx
    ON tesla_charging_sessions (user_id, started_at DESC);

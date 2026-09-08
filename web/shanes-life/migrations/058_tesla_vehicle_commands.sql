-- Real Tesla vehicle-command capability (Git #3218, Feature #3237): the first concrete Tesla-room
-- automation Shane named -- checkout-to-trunk. #3158 built read-only OAuth (`vehicle_device_data`)
-- deliberately WITHOUT command capability; this is that sibling work.
--
-- Real, deliberate architecture choice on HOW a command actually reaches the car: Tesla vehicles
-- built since ~2021 reject unsigned Fleet API commands outright (HTTP 412) -- a real command has
-- to be signed with a private key that is separately enrolled to the vehicle via the Tesla mobile
-- app (a real, physical, owner-only action). Tesla ships the signing protocol itself as an
-- official, closed-source-adjacent Go SDK/local proxy (github.com/teslamotors/vehicle-command)
-- specifically so third-party apps do not have to reimplement that security-critical binary
-- protocol from scratch. This app therefore never handles TESLA_PRIVATE_KEY (unchanged from
-- migration 055) and instead calls out to that proxy over `TESLA_COMMAND_PROXY_URL` -- see
-- tesla.mjs's sendVehicleCommand(). This table only tracks the app's own side: what was asked
-- for and when, real audit trail for a real action against Shane's actual car.
--
-- tesla_scheduled_commands: one real row per scheduled (not yet necessarily sent) command. A
-- 5-minute countdown that lived only in a setTimeout would silently die on every redeploy --
-- this app redeploys often (Replit) -- so the schedule is a real, persisted row a periodic sweep
-- (server.mjs, same 5-minute cadence the existing snoozed-nudge redelivery already polls at)
-- picks up and fires, the same durability reasoning nudge_events' snoozed_until already relies on.
CREATE TABLE IF NOT EXISTS tesla_scheduled_commands (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command        text        NOT NULL,               -- Tesla Fleet API command name, e.g. 'actuate_trunk'
    reason         text        NOT NULL,                -- what triggered this, e.g. 'checkout-to-trunk'
    scheduled_for  timestamptz NOT NULL,
    status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'canceled')),
    error          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    sent_at        timestamptz
);

-- The sweep's own query shape: due, still-pending rows for any user, oldest first.
CREATE INDEX IF NOT EXISTS tesla_scheduled_commands_due_idx
    ON tesla_scheduled_commands (scheduled_for)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tesla_scheduled_commands_user_idx
    ON tesla_scheduled_commands (user_id, created_at DESC);

-- Real per-user opt-in, defaults OFF -- this fires a genuine physical trunk actuator on Shane's
-- actual car; unlike a read (climate check) or a nudge, this is not something to turn on by
-- default just because Tesla is connected. Lives on tesla_accounts since it's meaningless without
-- a real connected vehicle to fire it against.
ALTER TABLE tesla_accounts ADD COLUMN IF NOT EXISTS auto_trunk_on_checkout boolean NOT NULL DEFAULT false;

-- Shane's Life -- the nudge cap and the inbound hooks (Git #3107).
--
-- Design/design_handoff_shanes_life/README.md, "Data model additions":
--   nudges(day, count) for the 3/day cap;  hooks(kind, payload, at) for Tesla, BuildConsole,
--   location.
--
-- The cap is a non-negotiable: 1-3 nudges a day, and "the fourth is HELD, never stacked". A
-- held nudge is a real row with held_at set, not a dropped one -- the tray's "N of up to 3
-- nudges today" line and the decision to hold both have to be answerable from the database.

-- One row per day per user. cap is stored per row rather than read from a constant so raising
-- nudgeCap tomorrow never rewrites what yesterday's cap actually was.
CREATE TABLE IF NOT EXISTS nudges (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        date        NOT NULL,
    count      integer     NOT NULL DEFAULT 0,
    cap        integer     NOT NULL DEFAULT 3,
    held_count integer     NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nudges_user_day_key ON nudges (user_id, day);

-- The individual nudges themselves, so "the fourth is held" is a real, inspectable state.
-- Meds batches do not count against the cap (handoff, Non-negotiables) -- counts_to_cap false.
CREATE TABLE IF NOT EXISTS nudge_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day           date        NOT NULL DEFAULT current_date,
    kind          text        NOT NULL,                    -- tesla | meds | buildconsole | appointment | ...
    title         text        NOT NULL,
    body          text,
    payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    counts_to_cap boolean     NOT NULL DEFAULT true,
    sent_at       timestamptz,
    held_at       timestamptz,                             -- set instead of sent_at when over cap
    released_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nudge_events_user_day_idx ON nudge_events (user_id, day, created_at);
CREATE INDEX IF NOT EXISTS nudge_events_held_idx     ON nudge_events (user_id, held_at) WHERE held_at IS NOT NULL AND released_at IS NULL;

-- /hooks/tesla, /hooks/buildconsole, /hooks/location {place}. The raw inbound payload is kept
-- verbatim: "Context over clock" means the tray's Next card is driven by where Shane actually
-- is, and when that reads wrong the only way to tell why is the payload that produced it.
CREATE TABLE IF NOT EXISTS hooks (
    id           bigserial PRIMARY KEY,
    user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
    kind         text        NOT NULL,                     -- tesla | buildconsole | location
    payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at           timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS hooks_kind_at_idx ON hooks (kind, at DESC);
CREATE INDEX IF NOT EXISTS hooks_unprocessed_idx ON hooks (at) WHERE processed_at IS NULL;

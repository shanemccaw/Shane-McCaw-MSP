-- Shane's Life -- Dates (Git #3107).
--
-- Straight out of Design/design_handoff_shanes_life/README.md, "Data model additions":
--   dates(id, kind, category, title, at DATE, time, interval_days NULL, lead_days, provider,
--         subject_type ('self'|'pet'|'person'), subject_id, source)
--   date_asks(date_id, text, asked_at NULL)
--   date_visits(date_id, visited_on, notes)
--   date_photos(visit_id, url, label)
--   federal_holidays(year, name, observed_on)
--
-- Two deliberate naming departures from that list, and why: `at` and `time` are both SQL
-- keywords, and `time` is a type name. They are `at_date` and `at_time` here so no query in
-- this app ever has to quote an identifier to read a date. Everything else keeps the design's
-- own name.
--
-- kind is FREE TEXT, not an enum. Screen 8's lead-time table (appointment 1, vet 1, birthday 10,
-- want-to-go 14, federal holiday 7, visit 3, renewal 21, vaccine 30) is the set that exists
-- today; "mom's coming to visit the 12th-18th" creating a Visits kind on the fly is the whole
-- point of Section 3, and an enum would make that a developer task.

CREATE TABLE IF NOT EXISTS dates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          text        NOT NULL,               -- appointment | vet | birthday | event
                                                      -- | holiday | visit | renewal | vaccine | ...
    category      text,                               -- on-the-fly category slug, if one was made
    title         text        NOT NULL,
    at_date       date        NOT NULL,               -- design: `at`
    at_time       time,                               -- design: `time`; NULL = all-day
    interval_days integer,                            -- NULL = one-off; 42 = "every 6 weeks"
    lead_days     integer     NOT NULL DEFAULT 1,     -- how far ahead it surfaces in the tray
    provider      text,                               -- "Dr. Fonji" -- what `attach_ask` matches on
    subject_type  text        NOT NULL DEFAULT 'self',-- self | pet | person
    subject_id    uuid,                               -- pets.id / a person entity, by subject_type
    source        text        NOT NULL DEFAULT 'web', -- web | mcp | opm | claude
    notes         text,
    done_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dates_user_when_idx ON dates (user_id, at_date);
CREATE INDEX IF NOT EXISTS dates_provider_idx  ON dates (user_id, lower(provider)) WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS dates_subject_idx   ON dates (subject_type, subject_id) WHERE subject_id IS NOT NULL;

-- "next time at dr fonji ask about ..." -- rows on the date detail screen. asked_at NULL means
-- still to ask; setting it is what the "Asked" tap does.
CREATE TABLE IF NOT EXISTS date_asks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date_id    uuid        NOT NULL REFERENCES dates(id) ON DELETE CASCADE,
    text       text        NOT NULL,
    asked_at   timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS date_asks_date_idx ON date_asks (date_id, created_at);

-- "Notes and photos, by visit" -- one row per real visit to a recurring appointment.
CREATE TABLE IF NOT EXISTS date_visits (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date_id    uuid        NOT NULL REFERENCES dates(id) ON DELETE CASCADE,
    visited_on date        NOT NULL,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS date_visits_date_idx ON date_visits (date_id, visited_on DESC);

-- The design says url; a photo of an after-visit summary is exactly the thing a Replit redeploy
-- must not wipe, so the real bytes go in media (013) and media_id is the real reference. url is
-- kept for a genuinely external link, and one of the two must be present.
CREATE TABLE IF NOT EXISTS date_photos (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id   uuid        NOT NULL REFERENCES date_visits(id) ON DELETE CASCADE,
    media_id   uuid REFERENCES media(id) ON DELETE SET NULL,
    url        text,
    label      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT date_photos_has_a_source CHECK (media_id IS NOT NULL OR url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS date_photos_visit_idx ON date_photos (visit_id, created_at);

-- Refreshed monthly from OPM (handoff: `opm_holidays(year)` on the WPF side). Not user-scoped:
-- a federal holiday is the same fact for everybody, and re-running the refresh must update in
-- place rather than duplicate, which is what the unique key is for.
CREATE TABLE IF NOT EXISTS federal_holidays (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    year        integer     NOT NULL,
    name        text        NOT NULL,
    observed_on date        NOT NULL,
    source      text        NOT NULL DEFAULT 'opm',
    refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS federal_holidays_year_name_key ON federal_holidays (year, name);
CREATE INDEX IF NOT EXISTS federal_holidays_observed_idx ON federal_holidays (observed_on);

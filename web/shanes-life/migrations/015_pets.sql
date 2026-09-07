-- Shane's Life -- Pets (Git #3107).
--
-- Design/design_handoff_shanes_life/README.md, "Data model additions":
--   pets(id, name, species, breed, born)
--   pet_vaccines(pet_id, name, interval_days, last_on, due_on)
--   pet_care(pet_id, name, batch)
--
-- Screen 10 reads all three: the card's "next due" line goes amber when a vaccine is inside its
-- lead window, and pet_care.batch is what puts Biscuit's joint chew in the Morning meds batch
-- and Pepper's thyroid half in Before bed (screen 6).

CREATE TABLE IF NOT EXISTS pets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    species    text,
    breed      text,
    born       date,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pets_user_idx ON pets (user_id, name);

-- lead_days defaults to 30, the vaccine lead time in screen 8's table. due_on is stored rather
-- than computed: a vet can schedule the next shot off-cycle, and the real date the vet gave
-- beats last_on + interval_days every time.
CREATE TABLE IF NOT EXISTS pet_vaccines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id        uuid        NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    interval_days integer,
    last_on       date,
    due_on        date,
    fine_until    date,                                -- the "due / fine until" pair on screen 10
    lead_days     integer     NOT NULL DEFAULT 30,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pet_vaccines_pet_idx ON pet_vaccines (pet_id, due_on);

-- "Feeding and meds (which Meds batch)". batch is free text -- 'morning' and 'bed' are what the
-- design draws today, and a third batch must not need a migration.
CREATE TABLE IF NOT EXISTS pet_care (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id     uuid        NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    batch      text,                                   -- morning | bed | ...
    detail     text,
    position   integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pet_care_pet_idx ON pet_care (pet_id, batch, position);

-- "Records (photo chips)" on the pet detail screen. Same rule as date_photos: real bytes in
-- media, url only for a genuinely external link.
CREATE TABLE IF NOT EXISTS pet_records (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id     uuid        NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    media_id   uuid REFERENCES media(id) ON DELETE SET NULL,
    url        text,
    label      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pet_records_has_a_source CHECK (media_id IS NOT NULL OR url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pet_records_pet_idx ON pet_records (pet_id, created_at DESC);

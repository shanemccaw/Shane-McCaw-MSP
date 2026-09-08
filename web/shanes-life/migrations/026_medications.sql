-- Shane's Life -- Medications (Git #3135, sub-issue of #3086's Epic: Shane's Life).
--
-- Contract pack Section 3's locked feature decision: "Medication system: batched by time of
-- day, single swipe to complete, split into auto-refill and manual-watch tiers." Screen 6
-- ("Shanes Life 07 - Meds.dc.html") draws the real shape this schema exists to serve: a
-- Morning batch (several human items + pet care rows), a Before bed batch, and a Refills
-- section split into "Needs you" (manual-watch) and "Handled automatically" (auto-refill).
--
-- Two real tables, not one, because they answer two different real questions:
--   * `medications` -- what exists (name, which batch it belongs to, dose, refill tier/state).
--     One row per real medication, edited rarely.
--   * `med_batch_log` -- what actually happened. "Single swipe per batch" (design's own "Why":
--     "the morning batch is one slide, not three taps") means completion is tracked per BATCH
--     PER DAY, not per medication -- swiping Morning marks every item in it (Shane's own Rx,
--     Biscuit's joint chew, Pepper's breakfast) done in one real row, matching migration 015's
--     pet_care.batch, which this reuses rather than duplicating (README's real scope item 5:
--     "reuses this same real system once built"). Deliberately NOT one row per medication per
--     day -- that would be the per-item friction the design explicitly rejects, and would also
--     produce a real adherence history the design explicitly says never to show ("no adherence
--     history, no streak: yesterday isn't shown anywhere").
--
-- `batch` is free text, same "not an enum" rule the rest of this schema follows (dates.kind,
-- pet_care.batch) -- 'morning' and 'evening' are what the design draws today, and a third daily
-- batch (or an as-needed one) must not need a migration.

CREATE TABLE IF NOT EXISTS medications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    dose_note     text,                                  -- "1 tablet", "2 softgels"
    batch         text        NOT NULL,                  -- morning | evening | ...
    -- Section 3's real dichotomy: auto-refill needs no action from Shane; manual-watch is a
    -- real, distinct thing that surfaces asking for his attention. Two values, hard-enforced --
    -- this is a locked design decision, not an open vocabulary Claude should be inventing a
    -- third value for.
    refill_tier   text        NOT NULL DEFAULT 'manual' CHECK (refill_tier IN ('auto', 'manual')),
    supply_days   integer,                                -- how many days one fill covers
    next_refill_on date,                                  -- manual: pharmacy due date. auto: next delivery date
    refill_note   text,                                   -- "Pharmacy needs a call before Thursday"
    position      integer     NOT NULL DEFAULT 0,
    archived_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medications_user_batch_idx
    ON medications (user_id, batch, position)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS medications_refill_idx
    ON medications (user_id, refill_tier)
    WHERE archived_at IS NULL;

-- One real row per (user, batch, day) it was actually swiped complete. UNIQUE makes "swipe
-- twice" and the capture-grammar path ("took my morning meds" said again) idempotent instead of
-- creating a second real log row for the same day.
CREATE TABLE IF NOT EXISTS med_batch_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch      text        NOT NULL,
    taken_on   date        NOT NULL,
    taken_at   timestamptz NOT NULL DEFAULT now(),
    source     text        NOT NULL DEFAULT 'web',        -- web | mcp
    UNIQUE (user_id, batch, taken_on)
);

CREATE INDEX IF NOT EXISTS med_batch_log_user_day_idx ON med_batch_log (user_id, taken_on DESC);

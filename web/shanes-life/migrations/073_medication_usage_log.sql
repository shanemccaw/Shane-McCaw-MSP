-- As-needed medication dose logging (Git #3321, sub-issue of #3226's Meds Feature).
--
-- Real, confirmed gap this closes: "as needed" medications (Albuterol, Alprazolam, etc. -- real
-- rows on file with `batch = 'as needed'`, see migration 030) exist only as a static batch
-- classification. `med_batch_log` (migration 030) records ONE swipe per (user, batch, day) for a
-- scheduled batch -- it is wrong for this, because a real as-needed dose is per-EVENT, can happen
-- more than once a day (Shane's own example: "I hit my inhaler 2x"), and carries a real quantity
-- and a real position, neither of which a batch-day row has anywhere to put.
--
-- `used_at` defaults to `now()` -- the real capture time, automatically, same as
-- `med_batch_log.taken_at` -- never a manually-entered timestamp. `latitude`/`longitude` are the
-- same real geo-tagged position already attached to the capture that logged this (migration 040,
-- Git #3159) -- this table does not introduce a new location-capture mechanism, it just carries
-- forward the coordinates the capture already had.
CREATE TABLE IF NOT EXISTS medication_usage_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id uuid        NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    quantity      integer     NOT NULL DEFAULT 1,
    used_at       timestamptz NOT NULL DEFAULT now(),
    latitude      double precision,
    longitude     double precision,
    note          text,
    source        text        NOT NULL DEFAULT 'web',     -- web | mcp, same vocabulary as med_batch_log.source
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medication_usage_log_user_used_idx
    ON medication_usage_log (user_id, used_at DESC);

CREATE INDEX IF NOT EXISTS medication_usage_log_medication_idx
    ON medication_usage_log (medication_id, used_at DESC);

-- Real pantry room build-out (Git #3316, corrects #3308's "tab inside Shopping" call --
-- Shane's own real direction was always a dedicated 14th room, and the assets now exist).
--
-- low_at is the real per-item "running low" threshold the Pantry room's own "Running low"
-- section reads (README: "low defaults to 0 for counts (only Out counts) and 1 for levels,
-- with per-item overrides"). Real, nullable so an existing row from before this column existed
-- reads as "no override yet" rather than a fabricated 0 -- core/pantry.mjs backfills the real
-- default (0 for a plain count, 1 for a 'lvl' item) the moment a row is written or read, never
-- here in bulk, since a bulk UPDATE on an empty table has nothing real to backfill and a bulk
-- UPDATE on a populated one would be guessing at unit per row when the app layer already knows
-- unit == 'lvl' at write time.
--
-- "Running low" itself is `quantity <= low_at` (COALESCE'd to the same 0/1-by-unit default at
-- read time) -- a real column, not a derived constant, because a per-item override (README's own
-- "Chicken breasts 2, Sparkling water 3, Coffee 1") genuinely differs from Shane's stated count
-- for that one real item, same "genuinely open" principle unit already gets.

ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS low_at numeric;

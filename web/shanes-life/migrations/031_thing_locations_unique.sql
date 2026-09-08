-- Git #3156: real hub/spoke item-location memory needs an atomic upsert-by-name -- "X is in the
-- garage" said again later corrects the spot in place (contract Section 8: "trust stated facts
-- immediately", no confirmation step) rather than leaving a second, stale row next to the first.
-- things_user_name_idx (016_lists_things.sql) is a plain index, not unique, so it cannot back a
-- real `ON CONFLICT` upsert -- the same shape store_aisles already uses for the same reason
-- (022_store_aisle_memory.sql). Replace it with a real unique index.

DROP INDEX IF EXISTS things_user_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS things_user_name_key ON things (user_id, lower(name));

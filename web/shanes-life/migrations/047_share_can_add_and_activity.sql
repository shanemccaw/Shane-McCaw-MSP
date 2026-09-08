-- Shared list: real can_add, aisle-ordered add attribution, and a live activity feed (Git #3186).
--
-- Real, explicit decision from Shane on #3186: share links get the full design match --
-- adding items, real Best-path/aisle-number ordering, and a real live activity feed -- a
-- deliberate expansion beyond #3116's original check-off-only decision, not a guess.
--
-- can_add mirrors can_check exactly: set at share-creation time, off by default so every
-- existing link (2 real live rows today, both list-kind) keeps its current check-off-only
-- behavior unchanged.
--
-- added_by/checked_by on list_items are the real provenance columns Shane's decision comment
-- asked for -- "so Shane can tell what a link holder added vs. what he added himself." Mirrors
-- entity_items' own existing checked_by convention (013_shanes_life_foundation.sql: "owner |
-- share:<label>"), extended with the same shape for who actually added a row. Both nullable:
-- every existing list_items row (added before this column existed) reads NULL, which the
-- application treats as "added by the owner" -- no backfill needed, nothing to guess.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS can_add boolean NOT NULL DEFAULT false;

ALTER TABLE list_items ADD COLUMN IF NOT EXISTS added_by text;
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS checked_by text;

-- The live activity feed (routes/public.mjs's new .../activity poll) reads activity_log filtered
-- by entity_id, most-recent-first -- a real per-list index rather than relying on the existing
-- (user_id, at) / (at) indexes to do it as a filter+sort.
CREATE INDEX IF NOT EXISTS activity_log_entity_at_idx ON activity_log (entity_id, at DESC)
    WHERE entity_id IS NOT NULL;

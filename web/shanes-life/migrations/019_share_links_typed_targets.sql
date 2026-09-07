-- Shane's Life -- share links follow rooms onto their own typed tables (Git #3116).
--
-- Real decision from Shane, recorded on #3116, 2026-09-07: rooms use their own typed tables
-- (`lists`/`list_items`, `things`, `contacts`, ... -- migrations 014-018), not the generic
-- `entities`/`entity_items` pair. #3107's own bookend flagged this as undecided: `share_links`
-- was built against `entities` only, and the whole no-login `/s/<token>` path
-- (`src/core/shares.mjs`, `src/routes/public.mjs`) would not work for a shared shopping list if
-- Shopping (#3088) lands on `lists` instead.
--
-- This gives share_links a real `entity_kind` and a second typed FK (`list_id`), so a link can
-- point at either shape. `entity_id` stays for the generic-entity case (still real -- captures
-- that Claude files under a category nobody coded for still land in `entities`, per 013's own
-- comment); it just stops being the only option. Starting with `lists`/`list_items` because
-- Shopping (#3088) is the first room built under #3086 and that is its real typed shape.

ALTER TABLE share_links
    ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'entity';

ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_entity_kind_check;
ALTER TABLE share_links
    ADD CONSTRAINT share_links_entity_kind_check CHECK (entity_kind IN ('entity', 'list'));

-- entity_id can no longer be NOT NULL -- a list-kind row carries list_id instead. Not destructive:
-- DROP NOT NULL is explicitly on this repo's non-destructive list (see CLAUDE.md's migration
-- gate section), and share_links is real, empty and unwired per #3116's own issue body, so there
-- are no existing rows this could orphan.
ALTER TABLE share_links ALTER COLUMN entity_id DROP NOT NULL;

ALTER TABLE share_links
    ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES lists(id) ON DELETE CASCADE;

-- Exactly one real target per link, and it has to match entity_kind -- the same discipline the
-- rest of this schema already applies (e.g. captures.entity_id added via a real FK in 013).
ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_target_xor_check;
ALTER TABLE share_links
    ADD CONSTRAINT share_links_target_xor_check CHECK (
        (entity_kind = 'entity' AND entity_id IS NOT NULL AND list_id IS NULL) OR
        (entity_kind = 'list'   AND list_id   IS NOT NULL AND entity_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS share_links_list_idx ON share_links (list_id, created_at DESC)
    WHERE list_id IS NOT NULL;

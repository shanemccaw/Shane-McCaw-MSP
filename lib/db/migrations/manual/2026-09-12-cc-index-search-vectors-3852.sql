-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3852 — CC Index Phase 1a: full-text search columns + GIN indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- Target database: BuildConsole's OWN database (BUILD_DATABASE_URL) — bt_issue_mirror
-- and bt_chats live there (moved in #3651, dropped from the product database in
-- #3653), not in the product database (DATABASE_URL / shanemccawmsp). The guards
-- below refuse to run anywhere that doesn't already have the target table.
--
-- First real piece of Feature #3851 (Command Center Data Index) Phase 1. Adds real
-- Postgres full-text search to the two tables the Command Center's Phase 1 search
-- will query — none exists anywhere in this schema today.
--
-- bt_issue_mirror: search_vector combines title (weight A, higher) + body (weight B).
--   (bt_issue_mirror.body already exists — added by a sibling migration landed after
--   this issue's body was written; not re-added here.)
-- bt_chats: search_vector combines title (weight A) + category (weight B) +
--   notes (weight C). Chat message content itself is never mirrored here (lives in
--   Claude.ai) — this only searches the real metadata this table already has.
--
-- Both use an explicit BEFORE INSERT OR UPDATE trigger function (not a GENERATED
-- ALWAYS AS column) per this issue's own real ask, so the app never has to
-- remember to recompute search_vector on write. Existing rows are backfilled by a
-- direct UPDATE once the column/trigger exist.

BEGIN;

-- ── bt_issue_mirror ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.bt_issue_mirror') IS NOT NULL THEN
    ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS search_vector tsvector;

    CREATE OR REPLACE FUNCTION bt_issue_mirror_search_vector_update() RETURNS trigger AS $fn$
    BEGIN
      NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS bt_issue_mirror_search_vector_trigger ON bt_issue_mirror;
    CREATE TRIGGER bt_issue_mirror_search_vector_trigger
      BEFORE INSERT OR UPDATE OF title, body ON bt_issue_mirror
      FOR EACH ROW EXECUTE FUNCTION bt_issue_mirror_search_vector_update();

    -- Backfill existing rows (the trigger only fires on future INSERT/UPDATE).
    UPDATE bt_issue_mirror SET search_vector =
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(body, '')), 'B')
    WHERE search_vector IS NULL;

    CREATE INDEX IF NOT EXISTS bt_issue_mirror_search_vector_idx
      ON bt_issue_mirror USING GIN (search_vector);
  END IF;
END $$;

-- ── bt_chats ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.bt_chats') IS NOT NULL THEN
    ALTER TABLE bt_chats ADD COLUMN IF NOT EXISTS search_vector tsvector;

    CREATE OR REPLACE FUNCTION bt_chats_search_vector_update() RETURNS trigger AS $fn$
    BEGIN
      NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'C');
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS bt_chats_search_vector_trigger ON bt_chats;
    CREATE TRIGGER bt_chats_search_vector_trigger
      BEFORE INSERT OR UPDATE OF title, category, notes ON bt_chats
      FOR EACH ROW EXECUTE FUNCTION bt_chats_search_vector_update();

    -- Backfill existing rows.
    UPDATE bt_chats SET search_vector =
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(notes, '')), 'C')
    WHERE search_vector IS NULL;

    CREATE INDEX IF NOT EXISTS bt_chats_search_vector_idx
      ON bt_chats USING GIN (search_vector);
  END IF;
END $$;

-- ── self-marking record ───────────────────────────────────────────────────────
-- simulator_migration_runs lives only in the product database (shanemccawmsp),
-- not in BuildConsole's own database where this migration actually runs — guard
-- the same way the other bt_* migrations in this directory already do.
DO $$
BEGIN
  IF to_regclass('public.simulator_migration_runs') IS NOT NULL THEN
    INSERT INTO simulator_migration_runs (filename, ran_at)
    VALUES ('2026-09-12-cc-index-search-vectors-3852.sql', now())
    ON CONFLICT (filename) DO UPDATE SET ran_at = now();
  END IF;
END $$;

COMMIT;

-- Git #4240 — Kanban Phase 2: wire Communications Push (#3769), Training
-- Session (#3770) and Automation Registry (#3771) in as real card types on
-- the existing Simple Kanban board (#3773).
--
-- Additive only — every existing kanban_cards row keeps working unchanged:
-- `type` is nullable and NULL means exactly what it always has (a plain
-- title/description task card), so no backfill of existing rows is needed.
--
-- Three nullable linking columns, one per type, each a REAL foreign key —
-- unlike kanban_buckets.customer_id (a tenants.id, a different system's
-- id-space, deliberately carried with no FK per that migration's own
-- comment), kanban_cards, communications_pushes, training_sessions and
-- automation_registry all live in this same Postgres schema, so a real FK is
-- the correct, safe choice here, not the "successor id-space" convention.
--
-- ON DELETE CASCADE on all three linking FKs matches the repo's own existing
-- convention (kanban_cards.bucket_id -> kanban_buckets, migration
-- 2026-09-12-kanban-buckets-cards-3773.sql; communications_push_checkpoints
-- .push_id -> communications_pushes, migration
-- 2026-09-12-communications-push-3769.sql): a card representing a
-- now-deleted entity disappears with it. The reverse is NOT true — deleting a
-- kanban_cards row never cascades back to delete the entity it was linked
-- to; the entity is the real record, the card is only its board
-- representation.
--
-- The CHECK constraints enforce, at the DB level, that exactly one linking
-- column is set and it matches `type` (or `type` is NULL and all three are
-- NULL for a plain card) — application code cannot leave a typed card
-- pointing at the wrong table or no table.

BEGIN;

ALTER TABLE kanban_cards
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS communications_push_id integer
    REFERENCES communications_pushes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS training_session_id integer
    REFERENCES training_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS automation_registry_id integer
    REFERENCES automation_registry(id) ON DELETE CASCADE;

ALTER TABLE kanban_cards DROP CONSTRAINT IF EXISTS kanban_cards_type_check;
ALTER TABLE kanban_cards ADD CONSTRAINT kanban_cards_type_check
  CHECK (type IS NULL OR type IN ('communications_push', 'training_session', 'automation_registry'));

-- NOTE: this must use IS NOT DISTINCT FROM / IS NOT NULL / boolean `=`
-- throughout, never bare `type = 'x'` OR'd together — a first draft of this
-- constraint used plain `OR`-chained `type = '...' AND ...` branches and had
-- a real hole: when `type IS NULL` but a linking column was still set, every
-- branch evaluated to NULL (three-valued SQL logic: `NULL = 'x'` is NULL,
-- not FALSE) and `FALSE OR NULL OR NULL OR NULL` is NULL, not FALSE — and a
-- CHECK only rejects a row on an explicit FALSE, so the bad row silently
-- passed. Caught by this migration's own manual verification (see #4240's
-- build journal) before shipping. IS NOT DISTINCT FROM / IS NOT NULL are
-- total (never NULL) so this version cannot fall into that trap.
ALTER TABLE kanban_cards DROP CONSTRAINT IF EXISTS kanban_cards_type_link_check;
ALTER TABLE kanban_cards ADD CONSTRAINT kanban_cards_type_link_check
  CHECK (
    (type IS NOT DISTINCT FROM 'communications_push') = (communications_push_id IS NOT NULL)
    AND (type IS NOT DISTINCT FROM 'training_session') = (training_session_id IS NOT NULL)
    AND (type IS NOT DISTINCT FROM 'automation_registry') = (automation_registry_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS kanban_cards_communications_push_id_idx ON kanban_cards (communications_push_id);
CREATE INDEX IF NOT EXISTS kanban_cards_training_session_id_idx ON kanban_cards (training_session_id);
CREATE INDEX IF NOT EXISTS kanban_cards_automation_registry_id_idx ON kanban_cards (automation_registry_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-kanban-card-types-4240.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

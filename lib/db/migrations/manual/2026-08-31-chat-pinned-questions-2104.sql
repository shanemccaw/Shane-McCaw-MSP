-- ─────────────────────────────────────────────────────────────────────────────
-- Chat Pinned Questions — Phase 1 of #2036 (Git #2104)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per outstanding question a chat is waiting on Shane to answer. Persists
-- until resolved (resolved_at set), at which point the resolve flow deletes it
-- immediately — there is no archive/history table or view for resolved pins.
-- Detection (asking chats for outstanding questions) is Phase 2 (#2105); this
-- migration only adds the storage + the constraint that keeps Phase 1's manual/
-- debug create path from stacking a redundant duplicate pin for the same chat.

CREATE TABLE IF NOT EXISTS chat_pinned_questions (
  id            SERIAL PRIMARY KEY,
  chat_id       INTEGER NOT NULL REFERENCES bt_chats(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMP WITH TIME ZONE
);

-- Redundant-pin guard: only one OPEN (unresolved) pin per chat+question text.
CREATE UNIQUE INDEX IF NOT EXISTS chat_pinned_questions_open_unique
  ON chat_pinned_questions (chat_id, question_text) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_pinned_questions_chat_id_idx ON chat_pinned_questions (chat_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-chat-pinned-questions-2104.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

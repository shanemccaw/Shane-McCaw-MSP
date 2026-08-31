-- ─────────────────────────────────────────────────────────────────────────────
-- Git #2066 — noisy, auto-detected per-chat #NNN mention registry
-- ─────────────────────────────────────────────────────────────────────────────
-- Separate from bt_chat_issues (deliberate/authoritative association table).
-- Keyed on the chat's own URL text, not a bt_chats FK, so a mention can be
-- recorded for a chat that was never explicitly linked to anything.

CREATE TABLE IF NOT EXISTS bt_chat_mentioned_issues (
  id              SERIAL PRIMARY KEY,
  chat_url        TEXT NOT NULL,
  issue_number    INTEGER NOT NULL,
  first_seen_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bt_chat_mentioned_issues_chat_issue_unique
  ON bt_chat_mentioned_issues (chat_url, issue_number);
CREATE INDEX IF NOT EXISTS bt_chat_mentioned_issues_chat_url_idx
  ON bt_chat_mentioned_issues (chat_url);
CREATE INDEX IF NOT EXISTS bt_chat_mentioned_issues_issue_number_idx
  ON bt_chat_mentioned_issues (issue_number);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-bt-chat-mentioned-issues-2066.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

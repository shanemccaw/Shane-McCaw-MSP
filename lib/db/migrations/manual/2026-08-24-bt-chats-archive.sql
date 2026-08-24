-- BuildConsole Chats panel: Archive (soft-hide, not delete) a chat.
-- The real bt_chats row + all its associations (bt_chat_issues, epic/issue
-- links) stay fully intact and retrievable; this only flags it out of the
-- default active-Chats-panel view, reversible via unarchive.

ALTER TABLE bt_chats
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-bt-chats-archive.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

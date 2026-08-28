-- Git #1480 — account-scoped chats. Adds the account a chat was created under
-- (the BuildConsole title-bar Primary/Secondary toggle, #1419) so the Chats
-- panel + In Progress list can filter to the currently-selected account
-- instead of showing a merged list across both.
--
-- NOT NULL DEFAULT 'primary' backfills every existing chat as Primary
-- (Shane's explicit call — see #1480) as part of this single ALTER; no
-- separate UPDATE pass is needed.

ALTER TABLE bt_chats
  ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'primary';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-bt-chats-account-1480.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- ShanesSurvival — Plaid Link + sync support
-- Adds the columns needed for real Plaid Link/sync (see Data/MigrationRunner.cs — applied
-- automatically, no manual psql step):
--   plaid_item_id  — Plaid's own Item ID. Unique so re-linking the same institution (or an
--                    update-mode reconnect) upserts the existing row instead of duplicating it.
--   sync_cursor    — the /transactions/sync cursor, persisted after every synced page so an
--                    incremental sync never has to re-fetch full transaction history.

BEGIN;

ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS plaid_item_id TEXT UNIQUE;
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS sync_cursor TEXT;

COMMIT;

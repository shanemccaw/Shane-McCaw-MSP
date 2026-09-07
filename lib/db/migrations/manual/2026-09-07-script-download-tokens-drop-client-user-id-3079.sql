-- Git #3079: drop script_download_tokens.client_user_id.
--
-- DESTRUCTIVE — Shane runs this himself, not the agent (see CLAUDE.md
-- Database section: "dropping columns/tables ... still go to Shane to run
-- himself"). Confirmed genuinely dead via every real writer/reader:
--   - admin-script-runner.ts:199 and portal-script-library.ts:161, the two
--     real writers, never populate clientUserId.
--   - script-ingestion.ts:188 selected it into tokenRow.clientUserId and
--     never used the value (customerId is what's actually carried forward).
--   - admin-active-directory.ts's per-user delete census and the retention
--     purger (modules.ts) both treated it as a real addressee, but since
--     nothing ever wrote it, every row's value has always been NULL.
--
-- Added alongside customer_id at this table's creation (c68d4fe04) and never
-- wired since. Dropping it is what frees the customer_id -> client_user_id
-- rename #2983 wanted across all six users.id-named-customer_id tables — this
-- was the one table where that target column name was already taken.
--
-- Before running: confirm no production row ever set a non-NULL value —
--   SELECT count(*) FROM script_download_tokens WHERE client_user_id IS NOT NULL;
-- expected: 0. If nonzero, STOP and re-open #3079 rather than running this.

ALTER TABLE script_download_tokens DROP COLUMN IF EXISTS client_user_id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-script-download-tokens-drop-client-user-id-3079.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- @migration-gate: manual
-- @gate-reason: Irreversible DROP TABLE. The Service Page Triggers feature was fully removed in d50877912 ("Remove Service Page Triggers (dead feature)", 2026-07-20) — admin page, both API routes, the seed helper, the portal hook and the Drizzle schema entry all went in that one commit. As of 2026-09-06 the table still exists in the dev database with 0 rows, and `service_page_trigger_keys` has zero references anywhere in the repo outside this file, 0053_add_service_page_trigger_keys.sql and the journal. Safe to drop, but run by hand on each real target — never by the automatic post-merge pipeline. See #2930 / #2848.

DROP TABLE IF EXISTS service_page_trigger_keys;

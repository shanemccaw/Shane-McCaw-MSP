-- ============================================================================
-- Cover every foreign-key column referencing `users` with a real index (Git #3099)
-- ============================================================================
-- Manual migration — additive DDL only. 50 `CREATE INDEX`, no data touched, no
-- column or constraint altered. Idempotent (`IF NOT EXISTS`), safe to re-run.
--
-- ── THE PROBLEM, MEASURED ───────────────────────────────────────────────────
--
-- PostgreSQL creates no index for the referencing side of a foreign key. Every
-- `DELETE FROM users` therefore has to prove, per deleted row, that no row in any
-- referencing table still points at it — one query per FK constraint. Without an
-- index on the referencing column each of those is a sequential scan.
--
-- All numbers below are from the local dev database (PostgreSQL 18.6,
-- `shanemccawmsp`, 2026-09-09). Every probe ran inside a transaction and was
-- rolled back, so no row was actually removed.
--
-- BE CAREFUL READING BEFORE/AFTER WALL-CLOCK HERE. A naive before-migration vs
-- after-migration comparison on this database is dominated by noise and by the
-- fixed per-constraint trigger overhead, and can even come out *slower* after.
-- The reliable measurement is a controlled A/B in one session on the SAME schema,
-- toggling `enable_indexscan`/`enable_bitmapscan`/`enable_indexonlyscan`, which
-- decides whether the RI plans use these indexes at all. Warm backend, two
-- independent passes each way:
--
--   DELETE of 100 users in one statement (the shape identityPurger produces):
--     scans off → 480 / 507 / 617 / 598 ms   (4.8 – 6.2 ms per user)
--     scans on  → 331 / 268 / 278 / 346 ms   (2.7 – 3.5 ms per user)
--     ≈ 1.8x faster
--
--   DELETE of a single user: 12.6 – 14.4 ms off vs 9.2 – 15.7 ms on — no reliable
--     difference. That is expected and is not an argument against these indexes:
--     45 of the 46 referencing tables here hold one or two pages, where a seq scan
--     and an index scan cost the same, so the ~77 RI trigger invocations themselves
--     are the whole cost at this data volume.
--
-- The structural result is visible per-check on the largest table in the set
-- (`emails`, 2,308 rows / 1,752 kB), asking exactly what the RI check asks:
--
--   EXPLAIN (ANALYZE, BUFFERS) SELECT 1 FROM emails WHERE linked_user_id = 99999
--     FOR KEY SHARE;
--
--     without the index:  Seq Scan, Buffers: shared hit=146, 2.842 ms
--     with the index:     Index Scan using emails_linked_user_id_idx,
--                         Buffers: shared hit=2,  0.201 ms
--
-- 73x fewer buffers, 14x faster, on a 1.7 MB table. That gap is the point: the
-- seq-scan side grows linearly with the referencing table, the index-scan side
-- stays at ~2-3 buffers forever. The cost of deleting a user scales with the SIZE
-- of every referencing table rather than with the number of users being deleted —
-- the wrong direction for a batch operation, and what this file removes.
--
-- One honest caveat found while measuring: `emails.linked_user_id` is 1 for 2,255
-- of 2,308 rows on this database, and for THAT value the planner correctly keeps
-- the seq scan (98% of the table matches). An index does not help a lookup that
-- returns most of the table; it helps every other user id, which is all of them.
--
-- ── WHY IT MATTERS HERE SPECIFICALLY ────────────────────────────────────────
--
-- Two live hot paths hit this, both per-user:
--
--   1. The RI checks themselves. `pg_constraint` currently reports 77 foreign-key
--      constraints referencing `users` (55 of them on columns with no leading-column
--      index, over 51 distinct table/column pairs).
--   2. `artifacts/api-server/src/lib/user-hard-delete.ts`, the shared cascade behind
--      both admin hard-delete routes AND `identityPurger` in
--      `retention/purgers/modules.ts`. It issues an explicit
--      `DELETE`/`UPDATE ... WHERE <col> = <userId>` against ~60 dependent tables
--      before the `users` row goes, and censuses every SET NULL attribution column.
--      Each of those is the same unindexed lookup.
--
-- NOT FIXED HERE, filed as #3361: seven of those 77 constraints are exact duplicates
-- (`audit_logs.actor_user_id`, `audit_logs.client_id`,
-- `client_app_registrations.client_user_id`, `client_automation_runs.client_user_id`,
-- `client_callback_tokens.client_user_id`, `client_documents.client_user_id`,
-- `client_documents.uploaded_by` each carry both a Postgres-named `_fkey` and a
-- drizzle-named `_users_id_fk` constraint, with identical ON DELETE actions). Each
-- duplicate makes the RI check run twice. Indexing makes both runs cheap; it does not
-- make the second one stop happening.
--
-- `identityPurger` calls `hardDeleteUserWithinTx` in a per-user loop (#2984), so the
-- 7-year post-termination purge (#1944) pays both costs once per account purged.
--
-- ── WHY PLAIN BTREE, NOT PARTIAL ────────────────────────────────────────────
--
-- Many of these are sparse attribution columns (`granted_by_user_id`,
-- `resolved_by_user_id`, `uploaded_by`, `signed_off_by`), where a
-- `WHERE <col> IS NOT NULL` partial index would carry fewer entries and still serve
-- the RI check (the planner proves `IS NOT NULL` from `<col> = $1`). It is not used
-- here for one concrete reason: drizzle-kit compares partial-index predicates by
-- text, so a hand-written predicate that does not round-trip byte-identically to what
-- Drizzle emits shows up as permanent schema drift. On these table sizes the storage
-- saved is kilobytes; a permanently red `check-drift` is not worth it. Every index
-- below is declared identically in `lib/db/src/schema/{index,msp,rbac}.ts` in the same
-- commit, so the two stay reconciled.
--
-- ── WHY `CONCURRENTLY`, AND WHAT THAT COSTS YOU ─────────────────────────────
--
-- A plain `CREATE INDEX` takes a `SHARE` lock: reads continue, but every INSERT,
-- UPDATE and DELETE against that table blocks for the whole build. On this dev
-- database that is milliseconds. On Staging/production it is a real write stall on
-- 45 tables, several of which (`emails`, `audit_logs`, `notifications`,
-- `user_sessions`) are on live request paths — `user_sessions` in particular is
-- written on every sign-in. `CONCURRENTLY` takes only `SHARE UPDATE EXCLUSIVE`, so
-- writes keep flowing; it is the correct choice for a change whose entire point is
-- that it will eventually be applied to a database large enough for the seq scans to
-- hurt.
--
-- The price is that `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction
-- block**, so unlike almost every other file in this directory:
--
--   *** THIS FILE HAS NO BEGIN/COMMIT AND MUST BE RUN WITH psql, NOT THE ***
--   *** SQL RUNNER / shaneapp://executeSql (which wraps in a transaction) ***
--
--     psql "$DATABASE_URL" -f lib/db/migrations/manual/2026-09-09-index-users-fk-columns-3099.sql
--
-- Running it inside a transaction fails on the first statement with
-- `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` and creates
-- nothing — a loud failure, not a silent partial one.
--
-- Because there is no enclosing transaction, an interrupted run leaves the indexes it
-- already built in place and simply stops. Re-running is safe: `IF NOT EXISTS` skips
-- what exists. The one case `IF NOT EXISTS` handles badly is an index left `INVALID`
-- by a `CONCURRENTLY` build that failed partway — it exists, so it would be skipped,
-- and an invalid index is never used by the planner. The `DO` block below drops
-- exactly those (and only from this file's own 50 names) first, so a retry genuinely
-- rebuilds them. `DROP INDEX` is explicitly non-destructive per CLAUDE.md's
-- destructive-migration gate: it is reversible and loses no data.
--
-- ── WHAT IS DELIBERATELY NOT INDEXED ────────────────────────────────────────
--
-- `script_download_tokens.client_user_id` is the 51st unindexed FK column and is
-- skipped on purpose. It is already slated for removal by
-- `2026-09-07-script-download-tokens-drop-client-user-id-3079.sql` (destructive, so
-- Shane runs it), it no longer exists in the Drizzle schema, and it has never held a
-- non-NULL value (verified: `SELECT count(*) FROM script_download_tokens WHERE
-- client_user_id IS NOT NULL` → 0). Indexing a column that is about to be dropped
-- would be work thrown away. That table's `customer_id`, which is real and stays, IS
-- indexed below.
--
-- ── VERIFYING ───────────────────────────────────────────────────────────────
--
--   -- expect 1 (only script_download_tokens.client_user_id, above)
--   select count(*) from (
--     select c.conrelid, a.attname
--     from pg_constraint c
--     join unnest(c.conkey) k(attnum) on true
--     join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
--     where c.confrelid='users'::regclass and c.contype='f'
--     and not exists (select 1 from pg_index i
--                     where i.indrelid=c.conrelid and i.indkey[0]=a.attnum)
--   ) s;
--
--   -- expect 0 rows: any index this file left INVALID
--   select c.relname from pg_index i join pg_class c on c.oid=i.indexrelid
--   where not i.indisvalid and c.relname like '%_idx';
-- ============================================================================

-- ── 0. Clear any INVALID leftovers from a previous interrupted run ──────────
DO $$
DECLARE
  bad text;
BEGIN
  FOR bad IN
    SELECT c.relname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE NOT i.indisvalid
      AND c.relname = ANY (ARRAY[
      'account_setup_tokens_user_id_idx',
      'active_directory_ou_assignment_requests_requested_by_idx',
      'active_directory_ou_assignment_requests_resolved_by_idx',
      'active_directory_ou_assignments_assigned_by_user_id_idx',
      'azure_tenant_credentials_client_user_id_idx',
      'checkout_sessions_account_user_id_idx',
      'client_automation_runs_client_user_id_idx',
      'client_callback_tokens_client_user_id_idx',
      'client_documents_client_user_id_idx',
      'client_documents_uploaded_by_idx',
      'client_health_history_client_id_idx',
      'client_services_client_user_id_idx',
      'contracts_user_id_idx',
      'customer_alert_settings_updated_by_user_id_idx',
      'customer_user_roles_granted_by_user_id_idx',
      'document_print_tokens_user_id_idx',
      'documents_uploaded_by_idx',
      'email_domain_rules_linked_user_id_idx',
      'emails_linked_user_id_idx',
      'impersonation_tokens_admin_user_id_idx',
      'impersonation_tokens_client_user_id_idx',
      'inbox_message_links_customer_id_idx',
      'insights_automations_customer_id_idx',
      'invoices_client_user_id_idx',
      'messages_client_user_id_idx',
      'messages_sender_user_id_idx',
      'mfa_bypass_codes_created_by_user_id_idx',
      'mfa_challenges_user_id_idx',
      'mfa_enrollments_user_id_idx',
      'msp_invites_invited_by_user_id_idx',
      'msp_staff_customer_scopes_created_by_user_id_idx',
      'msp_user_roles_granted_by_user_id_idx',
      'outbound_webhooks_disabled_by_msp_user_id_idx',
      'password_reset_tokens_user_id_idx',
      'print_tokens_user_id_idx',
      'project_closures_signer_user_id_idx',
      'project_updates_author_user_id_idx',
      'projects_client_user_id_idx',
      'projects_signed_off_by_idx',
      'quick_win_presentations_client_user_id_idx',
      'quick_win_result_shares_client_user_id_idx',
      'reports_client_user_id_idx',
      'sales_offer_events_actor_user_id_idx',
      'script_download_tokens_customer_id_idx',
      'script_run_results_customer_id_idx',
      'signup_exchange_tokens_user_id_idx',
      'status_reports_client_user_id_idx',
      'user_entitlement_overrides_granted_by_user_id_idx',
      'webauthn_challenges_user_id_idx',
      'webauthn_credentials_user_id_idx'
      ])
  LOOP
    RAISE NOTICE 'dropping INVALID index % left by an earlier interrupted run', bad;
    EXECUTE format('DROP INDEX IF EXISTS %I', bad);
  END LOOP;
END
$$;

-- ── 1. One btree index per foreign-key column referencing users(id) ─────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS account_setup_tokens_user_id_idx
  ON account_setup_tokens (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS active_directory_ou_assignment_requests_requested_by_idx
  ON active_directory_ou_assignment_requests (requested_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS active_directory_ou_assignment_requests_resolved_by_idx
  ON active_directory_ou_assignment_requests (resolved_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS active_directory_ou_assignments_assigned_by_user_id_idx
  ON active_directory_ou_assignments (assigned_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS azure_tenant_credentials_client_user_id_idx
  ON azure_tenant_credentials (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS checkout_sessions_account_user_id_idx
  ON checkout_sessions (account_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_automation_runs_client_user_id_idx
  ON client_automation_runs (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_callback_tokens_client_user_id_idx
  ON client_callback_tokens (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_documents_client_user_id_idx
  ON client_documents (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_documents_uploaded_by_idx
  ON client_documents (uploaded_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_health_history_client_id_idx
  ON client_health_history (client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS client_services_client_user_id_idx
  ON client_services (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contracts_user_id_idx
  ON contracts (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_alert_settings_updated_by_user_id_idx
  ON customer_alert_settings (updated_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_user_roles_granted_by_user_id_idx
  ON customer_user_roles (granted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS document_print_tokens_user_id_idx
  ON document_print_tokens (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_uploaded_by_idx
  ON documents (uploaded_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_domain_rules_linked_user_id_idx
  ON email_domain_rules (linked_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS emails_linked_user_id_idx
  ON emails (linked_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS impersonation_tokens_admin_user_id_idx
  ON impersonation_tokens (admin_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS impersonation_tokens_client_user_id_idx
  ON impersonation_tokens (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS inbox_message_links_customer_id_idx
  ON inbox_message_links (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS insights_automations_customer_id_idx
  ON insights_automations (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_client_user_id_idx
  ON invoices (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_client_user_id_idx
  ON messages (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_sender_user_id_idx
  ON messages (sender_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mfa_bypass_codes_created_by_user_id_idx
  ON mfa_bypass_codes (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mfa_challenges_user_id_idx
  ON mfa_challenges (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mfa_enrollments_user_id_idx
  ON mfa_enrollments (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS msp_invites_invited_by_user_id_idx
  ON msp_invites (invited_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS msp_staff_customer_scopes_created_by_user_id_idx
  ON msp_staff_customer_scopes (created_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS msp_user_roles_granted_by_user_id_idx
  ON msp_user_roles (granted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS outbound_webhooks_disabled_by_msp_user_id_idx
  ON outbound_webhooks (disabled_by_msp_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS print_tokens_user_id_idx
  ON print_tokens (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS project_closures_signer_user_id_idx
  ON project_closures (signer_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS project_updates_author_user_id_idx
  ON project_updates (author_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_client_user_id_idx
  ON projects (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_signed_off_by_idx
  ON projects (signed_off_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS quick_win_presentations_client_user_id_idx
  ON quick_win_presentations (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS quick_win_result_shares_client_user_id_idx
  ON quick_win_result_shares (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS reports_client_user_id_idx
  ON reports (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS sales_offer_events_actor_user_id_idx
  ON sales_offer_events (actor_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS script_download_tokens_customer_id_idx
  ON script_download_tokens (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS script_run_results_customer_id_idx
  ON script_run_results (customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS signup_exchange_tokens_user_id_idx
  ON signup_exchange_tokens (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS status_reports_client_user_id_idx
  ON status_reports (client_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_entitlement_overrides_granted_by_user_id_idx
  ON user_entitlement_overrides (granted_by_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS webauthn_challenges_user_id_idx
  ON webauthn_challenges (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS webauthn_credentials_user_id_idx
  ON webauthn_credentials (user_id);

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
-- Standalone, outside any transaction — see the header on why this file has none.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-index-users-fk-columns-3099.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

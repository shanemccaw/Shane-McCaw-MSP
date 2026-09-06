-- #2524 — Policy Engine: OU assignment — customer read + request-change.
--
-- #2148 gave the MSP an operator-facing "set" route for
-- active_directory_ou_assignments (Git #2148, 2026-09-03) — the customer never
-- sets this directly. This is the customer's own split-out capability: read
-- the current assignment, and REQUEST a change; the MSP approves.
--
-- CR-pipeline-vs-dedicated-table decision (see the Drizzle schema's own header
-- comment in lib/db/src/schema/index.ts for the full reasoning): an OU
-- assignment change is not a real M365 tenant configuration write —
-- msp-active-directory.ts's set/move routes only ever issue a Graph READ to
-- verify the object exists, then write our own bookkeeping row. Routing this
-- through msp_change_requests would mean fabricating meaningless values for
-- target_resource/psa_ticket_id/backup_hash/rollback_script_snippet and would
-- misfile an internal-grouping request alongside real tenant-config changes.
-- This gets its own small, dedicated table instead.
--
-- Additive only. New table, no existing column touched. Current-state per
-- request (moved to a terminal status by the MSP side), not an append-only log
-- — same discipline active_directory_ou_assignments itself already follows.

BEGIN;

CREATE TABLE IF NOT EXISTS active_directory_ou_assignment_requests (
  id                    serial PRIMARY KEY,
  msp_id                integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id           integer NOT NULL,
  tenant_id             text NOT NULL,
  object_upn            text NOT NULL,
  object_display_name   text,
  current_ou_id         integer REFERENCES active_directory_ous(id) ON DELETE SET NULL,
  requested_ou_id       integer REFERENCES active_directory_ous(id) ON DELETE SET NULL,
  requested_ou_name     text,
  note                  text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  requested_by_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_user_id   integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  resolution_note       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_directory_ou_assignment_requests_customer_id_idx
  ON active_directory_ou_assignment_requests (customer_id);
CREATE INDEX IF NOT EXISTS active_directory_ou_assignment_requests_msp_id_idx
  ON active_directory_ou_assignment_requests (msp_id);
CREATE INDEX IF NOT EXISTS active_directory_ou_assignment_requests_status_idx
  ON active_directory_ou_assignment_requests (status);

COMMENT ON TABLE active_directory_ou_assignment_requests IS
  'Customer-raised request to change an active_directory_ou_assignments row (#2524). '
  'Dedicated table, not msp_change_requests — an OU assignment is platform bookkeeping, '
  'never a Graph write, so it does not belong in the tenant-configuration change register. '
  'Resolved (approved/rejected/fulfilled) by MSP staff via msp-active-directory.ts.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'active_directory_ou_assignment_requests'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-06-ou-assignment-requests-2524.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

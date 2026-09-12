-- Git #3762 — MSP Status Reports (Feature #3434, phase 1 of 4).
--
-- Operator-authored, per-customer status reports. Same shape family as
-- retainer_work_log (#1293): a real narrative record of MSP work, scoped by
-- msp_id, with a minimal one-way draft -> published state machine (publish is
-- irreversible in v1 -- no unpublish). customer_id is tenants.id with no FK,
-- matching the existing "successor id-space, no FK by design" convention
-- already used by break_glass_pending_secrets and msp_change_requests.tenant_id.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_status_reports (
  id serial PRIMARY KEY,
  msp_id integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id integer NOT NULL,
  period_label text NOT NULL,
  as_of_date timestamptz NOT NULL,
  content text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  authored_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS msp_status_reports_msp_id_idx ON msp_status_reports (msp_id);
CREATE INDEX IF NOT EXISTS msp_status_reports_customer_id_idx ON msp_status_reports (customer_id);
CREATE INDEX IF NOT EXISTS msp_status_reports_customer_state_idx ON msp_status_reports (customer_id, state);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-msp-status-reports-3762.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

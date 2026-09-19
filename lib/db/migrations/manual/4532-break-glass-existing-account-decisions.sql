-- #4532 — a config-pack re-run against a tenant with exactly one existing
-- break-glass account (#4514) never applied the run's generated password, so the
-- break_glass_verification_gate can neither deliver nor honestly continue. Rather
-- than pick a path, the gate now pauses the run and writes one row here; an
-- operator records the customer's actual answer (reset + redeliver, or resume
-- without delivering) and the run executes exactly that.
--
-- Additive: one new table. break_glass_pending_secrets.status is plain text with no
-- CHECK constraint, so the new "discarded_unapplied" value needs no DDL.

CREATE TABLE IF NOT EXISTS break_glass_existing_account_decisions (
  id                       serial PRIMARY KEY,
  run_id                   integer NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  gate_node_id             text NOT NULL,
  customer_id              integer NOT NULL,
  pending_secret_id        integer NOT NULL REFERENCES break_glass_pending_secrets(id),
  existing_account_id      text,
  existing_account_upn     text,
  skipped_node_id          text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  customer_answer          text,
  reason                   text,
  decided_by_user_id       integer,
  decided_at               timestamptz,
  result_pending_secret_id integer REFERENCES break_glass_pending_secrets(id),
  context                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS break_glass_existing_account_decisions_run_id_idx
  ON break_glass_existing_account_decisions (run_id);
CREATE INDEX IF NOT EXISTS break_glass_existing_account_decisions_customer_id_idx
  ON break_glass_existing_account_decisions (customer_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4532-break-glass-existing-account-decisions.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- #2024 — Policy Decisions: build the real own-table schema.
--
-- Additive and reversible. Creates ONE new table, own primary key, own
-- lifecycle — deliberately NOT a `decision_state` discriminator bolted onto
-- `msp_risk_decisions`. Decided on #1528 (2026-08-31): a policy decision and a
-- risk decision look like the same shape today, but these are v1.0 modules
-- that will grow real, divergent fields — split now rather than unwind a
-- shared table later once both sides have grown.
--
-- Unlike `msp_risk_decisions` (which only ever gets a row from a raised
-- liability finding), this table's create path can start from "we've decided
-- X" with no risk required first (#1528). There is no unsigned intermediate
-- state: a row here is signed the moment it exists, written by the one
-- combined create/sign-off endpoint. Fields are the "Sign it off" form's own
-- (owner / review cadence / compensating control) plus the signature fields
-- the Risk Register's `accept` flow already established (typed name,
-- server-set timestamp, statement, IP + hash for the same audit rigor).

BEGIN;

CREATE TABLE IF NOT EXISTS policy_decisions (
  id                      serial PRIMARY KEY,
  msp_id                  integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id               text NOT NULL,

  title                   text NOT NULL,
  obligation              text NOT NULL,
  pillar                  text,

  owner                   text NOT NULL,
  owner_id                text,
  review_cadence          text NOT NULL,
  compensating_control    text NOT NULL,

  -- POLICY_DECISION_STATES (proposed | live | due). Starts 'live' — see header.
  decision_state          text NOT NULL DEFAULT 'live',
  -- RISK_REVIEW_STATES (on_track | due | overdue).
  review_state            text NOT NULL DEFAULT 'on_track',
  review_due_at           timestamptz,

  signed_by               text NOT NULL,
  signed_at               timestamptz NOT NULL,
  statement               text NOT NULL,
  ip_address              text,
  signature_hash          text NOT NULL,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_decisions_msp_id_idx     ON policy_decisions (msp_id);
CREATE INDEX IF NOT EXISTS policy_decisions_tenant_id_idx  ON policy_decisions (tenant_id);
CREATE INDEX IF NOT EXISTS policy_decisions_msp_tenant_idx ON policy_decisions (msp_id, tenant_id);

COMMENT ON TABLE policy_decisions IS
  'Policy Decisions'' own object (#2024, decided #1528): own PK, own lifecycle, '
  'created already-signed via the create/sign-off endpoint. Distinct from '
  'msp_risk_decisions (the reactive, finding-derived register) — never merge '
  'these back into one table.';

-- Verify the table + indexes landed.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'policy_decisions'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-policy-decisions-own-table-2024.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

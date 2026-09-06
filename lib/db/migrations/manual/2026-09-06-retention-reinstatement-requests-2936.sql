-- Git #2936 — reinstatement requests from a gated customer.
--
-- Shane's decision (2026-09-05): an MSP's lapsed platform subscription cascades to that
-- MSP's customers — their portals gate and their 7-year purge clocks start — but it is
-- NOT a hard lockout. A gated customer can still log in, download their data, delete
-- their own data, and REQUEST REINSTATEMENT. This table is the durable record of that
-- fourth action.
--
-- ADDITIVE ONLY: one new table, no changes to any existing one. The cascade itself needs
-- no schema at all — it is one extra conjunct in the existing billing predicate
-- (`tenant-billing-rules.ts` / `tenantBillingActiveCondition()`), reusing #2765's
-- freeze/resume/gate mechanism unchanged.
--
-- Mirrors `lib/db/src/schema/retention.ts` (`retentionReinstatementRequestsTable`).

BEGIN;

CREATE TABLE IF NOT EXISTS retention_reinstatement_requests (
  id                     serial PRIMARY KEY,
  tenant_id              integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  msp_id                 integer NOT NULL REFERENCES msps(id)    ON DELETE CASCADE,
  requested_by_user_id   integer,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  note                   text,

  -- Snapshot of what the customer was gated by when they asked. Not a live join: by the
  -- time anyone reads this row the billing state may have moved, which is exactly the
  -- case where the snapshot matters.
  lapse_source           text,
  lapse_was_msp_cascade  boolean NOT NULL DEFAULT false,
  lapsed_at              timestamptz,

  -- 'open' | 'resolved' | 'withdrawn'. Deliberately no approved/declined: #2936 settled
  -- that a customer CAN ask, not what happens to the ask — that routing decision is
  -- still open, and a vocabulary naming it would be inventing an authority nobody holds.
  status                 text NOT NULL DEFAULT 'open',
  resolved_at            timestamptz,
  resolution             text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- At most ONE open request per customer: guards against a wall that resubmits on every
-- click, not against a customer who lapses twice and legitimately asks twice.
CREATE UNIQUE INDEX IF NOT EXISTS retention_reinstatement_open_uidx
  ON retention_reinstatement_requests (tenant_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS retention_reinstatement_msp_idx
  ON retention_reinstatement_requests (msp_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS retention_reinstatement_tenant_idx
  ON retention_reinstatement_requests (tenant_id, requested_at DESC);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-06-retention-reinstatement-requests-2936.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

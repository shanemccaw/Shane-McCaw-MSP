-- Git #4111 — client_billing_overrides: the one manual knob on top of automatic
-- seat pricing. Seat-based pricing is the customer's real, live count of active
-- licensed M365 users (resolveActiveLicensedUserCount, license-waste-source.ts);
-- this table holds the operator's manually-set "service account" seat exclusion
-- to subtract from that live count before it prices the customer. One row per
-- tenant — a current-state correction, not a ledger. Additive only.

CREATE TABLE IF NOT EXISTS client_billing_overrides (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  excluded_service_account_seats INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  set_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_billing_overrides_tenant_id_idx
  ON client_billing_overrides (tenant_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4111-client-billing-overrides.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- Git #1549 — Policy Engine: Continuous evaluation (reconciliation loop, not
-- an onboarding-only trigger).
--
-- 1. tenants.policy_engine_opt_in — the per-customer onboarding checkbox
--    #1549's SETTLED section requires, default OFF. Distinct from
--    standing_policies.is_active (a per-policy switch, #1547) — this is the
--    tenant-wide kill switch: "the platform does not evaluate or act against
--    tenants that have not opted in."
-- 2. active_directory_ous.tenant_id — nullable, additive. Which real tenant
--    an OU (the #1547 attachment point) governs. Without it there is no
--    tenant for the continuous-evaluation loop to resolve at all.
-- 3. policy_evaluation_runs — the durable register the reconciliation loop
--    produces, one row per policy actually considered on a pass (event or
--    schedule trigger).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS policy_engine_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE active_directory_ous
  ADD COLUMN IF NOT EXISTS tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS active_directory_ous_tenant_id_idx ON active_directory_ous (tenant_id);

CREATE TABLE IF NOT EXISTS policy_evaluation_runs (
  id serial PRIMARY KEY,
  standing_policy_id integer NOT NULL REFERENCES standing_policies(id) ON DELETE CASCADE,
  msp_id integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id integer REFERENCES tenants(id) ON DELETE SET NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
  trigger_event_type text,
  outcome text NOT NULL CHECK (outcome IN ('compliant', 'divergent', 'not_evaluable', 'skipped_not_opted_in', 'error')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_evaluation_runs_standing_policy_id_idx ON policy_evaluation_runs (standing_policy_id);
CREATE INDEX IF NOT EXISTS policy_evaluation_runs_msp_evaluated_idx ON policy_evaluation_runs (msp_id, evaluated_at);
CREATE INDEX IF NOT EXISTS policy_evaluation_runs_tenant_evaluated_idx ON policy_evaluation_runs (tenant_id, evaluated_at);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-policy-engine-continuous-evaluation-1549.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

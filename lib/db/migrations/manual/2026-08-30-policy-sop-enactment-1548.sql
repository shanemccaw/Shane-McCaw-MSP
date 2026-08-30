-- #1548 — Policy Engine: policy is enacted by an SOP; the engine does not execute.
--
-- "Policy defines a target state and names the procedure that achieves it. It
-- does not execute anything itself, so no new execution path is created — this
-- stays inside the module boundaries already drawn." (#1548 issue body)
--
-- Two additive columns complete that sentence:
--
--   standing_policies.sop_id         — names the procedure (msp_sops.sop_id,
--                                       the text join key msp_sop_runs.sop_id
--                                       already uses). Nullable — a policy's
--                                       target state can be declared before the
--                                       SOP that will enact it exists, same
--                                       reasoning #1547 gave catalog_item_id.
--
--   msp_sop_runs.standing_policy_id  — traces a policy-invoked run (origin =
--                                       'policy') back to the standing_policies
--                                       row that caused it. Nullable — set only
--                                       for policy-origin runs. This is the
--                                       "msp_sops/msp_sop_runs become the
--                                       enactment record for policy" consequence
--                                       the issue settles.
--
-- No new execution path: both columns are consumed by the EXISTING
-- POST /api/msp/sops/:sopId/run (runSopForCustomer, #1559) and the existing
-- POST /api/msp/sop-runs writer — neither route is new.

ALTER TABLE standing_policies
  ADD COLUMN IF NOT EXISTS sop_id text;

CREATE INDEX IF NOT EXISTS standing_policies_sop_id_idx ON standing_policies (sop_id);

ALTER TABLE msp_sop_runs
  ADD COLUMN IF NOT EXISTS standing_policy_id integer
    REFERENCES standing_policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_sop_runs_standing_policy_id_idx ON msp_sop_runs (standing_policy_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-policy-sop-enactment-1548.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

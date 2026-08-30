-- Git #1847 — "Intune not configured" as a first-class, tenant-level reportable state.
--
-- Additive only. Two changes:
--
--   1. tenant_service_availability — ONE row per (tenant, Microsoft service) holding
--      whether that service will actually ANSWER for that tenant, and the evidence
--      that settled it. Before this table the platform had nowhere to record the
--      fact: the ten devices:* checks each swallowed Intune's refusal and persisted
--      status 'ok' / item_count 0, which is indistinguishable downstream from a
--      tenant that genuinely manages zero devices.
--
--   2. config_resources.service_key — which Microsoft service has to be stood up for
--      a resource to answer. Separate from `availability`, which is a PERMISSION
--      fact. Both are true at once on the testbed: 189 /deviceManagement* rows are
--      `available_now` on granted scopes while Intune itself answers nothing.
--
-- service_key is backfilled from graph_path's own root segment, which is a
-- deterministic re-derivation of published Graph paths — NOT from `workload`, whose
-- Microsoft365DSC labelling puts 226 of the 261 /deviceManagement* rows under
-- `MicrosoftGraph` and so cannot carry this fact.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_service_availability (
  id                   serial PRIMARY KEY,
  tenant_id            text NOT NULL,
  service_key          text NOT NULL,
  state                text NOT NULL DEFAULT 'unknown',
  evidence_basis       text NOT NULL,
  reason               text NOT NULL,
  detection_signature  text,
  observed_endpoint    text,
  observed_http_status integer,
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_by_check_key text,
  first_observed_at    timestamptz NOT NULL DEFAULT now(),
  last_observed_at     timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_service_availability_tenant_service_uidx
  ON tenant_service_availability (tenant_id, service_key);
CREATE INDEX IF NOT EXISTS tenant_service_availability_state_idx
  ON tenant_service_availability (state);

ALTER TABLE config_resources ADD COLUMN IF NOT EXISTS service_key text;

CREATE INDEX IF NOT EXISTS config_resources_service_key_idx
  ON config_resources (service_key);

-- Backfill: the Graph roots Intune serves. /deviceManagement is Intune's own root;
-- /deviceAppManagement is Intune app management (MAM) and fails with the same
-- backend signatures. Both are recorded in this issue's live evidence.
UPDATE config_resources
   SET service_key = 'intune',
       updated_at  = now()
 WHERE service_key IS DISTINCT FROM 'intune'
   AND graph_path IS NOT NULL
   AND (graph_path LIKE '/deviceManagement%' OR graph_path LIKE '/deviceAppManagement%');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('1847-tenant-service-availability.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- 2026-08-30-ps-capability-survey-1793.sql
--
-- Git #1793 — persist the app-only PowerShell capability survey.
--
-- The survey answers a question nothing in this platform has ever measured:
-- of the several hundred cmdlets ExchangeOnlineManagement / MicrosoftTeams
-- actually export, which ones survive app-only certificate authentication
-- through ca-ps-execution? Microsoft's docs describe delegated behaviour and
-- app-only support differs cmdlet by cmdlet, so the only source of truth is a
-- live run — these tables are where that run's real result lands.
--
-- Additive only: two NEW tables, no ALTER of anything existing, no data
-- rewrite. Nothing here derives a monitor_checks row — #1793's explicit
-- non-goal is that cataloguing what works and deciding what to check stay
-- separate decisions.
--
-- Matching Drizzle definitions: lib/db/src/schema/msp.ts
-- (psCapabilitySurveyRunsTable / psCapabilitySurveyResultsTable).

BEGIN;

CREATE TABLE IF NOT EXISTS ps_capability_survey_runs (
  id                 SERIAL PRIMARY KEY,
  -- tenants.id of the surveyed tenant. Always a testbed tenant: the only
  -- route that can produce these rows is gated by #965 server-side.
  customer_id        INTEGER NOT NULL,
  -- The org actually handed to Connect-*, as the SERVER resolved it from the
  -- gated tenant's own domain — never a caller-supplied value.
  organization       TEXT NOT NULL,
  -- The ps-execution container revision that served the run, read from its own
  -- /healthz. A survey result is only meaningful against the code that
  -- produced it (#1434's failure mode was verifying against a stale revision).
  container_revision TEXT,
  container_image    TEXT,
  status             TEXT NOT NULL DEFAULT 'running',
  notes              TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ps_capability_survey_runs_customer_idx
  ON ps_capability_survey_runs (customer_id);
CREATE INDEX IF NOT EXISTS ps_capability_survey_runs_started_idx
  ON ps_capability_survey_runs (started_at);

CREATE TABLE IF NOT EXISTS ps_capability_survey_results (
  id                        SERIAL PRIMARY KEY,
  run_id                    INTEGER NOT NULL
                              REFERENCES ps_capability_survey_runs(id) ON DELETE CASCADE,
  -- exchange | compliance | teams — which Connect-* session the cmdlet was
  -- reached through. This is the thing being measured, so it is never implied.
  session_type              TEXT NOT NULL,
  -- The real module the command was enumerated from. For Exchange/Purview
  -- this is the dynamically registered session module (tmpEXO_<random>), NOT
  -- ExchangeOnlineManagement — that distinction is why the survey enumerates
  -- post-connect instead of reading a documented cmdlet list.
  module_name               TEXT,
  cmdlet_name               TEXT NOT NULL,
  verb                      TEXT,
  noun                      TEXT,
  command_type              TEXT,
  -- ok | auth_failed | access_denied | not_supported_app_only | throttled |
  -- error | not_attempted | cmdlet_unavailable. The first seven are #1793's
  -- own vocabulary; cmdlet_unavailable is the container's already-existing
  -- #250 distinction (a real CommandNotFoundException = licensing/role gap),
  -- kept separate rather than collapsed into 'error'.
  --
  -- Deliberately a plain TEXT column with no CHECK constraint, matching the
  -- existing msp_alert enum convention in this schema (see the
  -- msp-alert-enums-are-text precedent): the vocabulary is enforced in the
  -- Drizzle type, and a survey must be able to record a NEW real outcome
  -- without a migration standing in the way of the evidence.
  status                    TEXT NOT NULL,
  -- Why a not_attempted cmdlet was never run — the literal read-safety gate
  -- that rejected it. A not_attempted row with a null reason is a defect.
  reason                    TEXT,
  -- The VERBATIM exception message on a failure. Never paraphrased.
  error_message             TEXT,
  item_count                INTEGER,
  elapsed_ms                INTEGER,
  invoked_with              TEXT,
  output_type_name          TEXT,
  -- The real output SHAPE: property NAMES only, never values. The surveyed
  -- tenant is Shane's real production Microsoft 365 tenant, so the survey
  -- stores a schema, not an extract. This is the column #1795's resource
  -- model reads.
  property_names            JSONB,
  supports_should_process   BOOLEAN,
  min_mandatory_param_count INTEGER,
  mandatory_param_names     JSONB,
  parameter_count           INTEGER,
  observed_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ps_capability_survey_results_run_session_cmdlet_uidx
  ON ps_capability_survey_results (run_id, session_type, cmdlet_name);
CREATE INDEX IF NOT EXISTS ps_capability_survey_results_status_idx
  ON ps_capability_survey_results (status);
CREATE INDEX IF NOT EXISTS ps_capability_survey_results_cmdlet_idx
  ON ps_capability_survey_results (cmdlet_name);

-- Self-marking run record so Simulator Studio's Migrations tree (#497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-ps-capability-survey-1793.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

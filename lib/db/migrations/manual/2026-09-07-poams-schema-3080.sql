-- ============================================================================
-- POA&Ms: real schema, core CRUD (Git #3080, Phase 1a of #1935)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres per current
-- CLAUDE.md. Additive only: two brand-new tables, nothing else touched.
-- Idempotent: CREATE TABLE IF NOT EXISTS — safe to re-run.
--
-- Real audit against current schema before writing this (verified via psql
-- against local `shanemccawmsp`): grepped the whole repo for poam/POA&M/
-- "plan of action" — the only real hits were (a) test fixtures in
-- retention-clock.test.ts using "poams" as an illustrative recordType/label,
-- registering nothing real, and (b) `2026-09-04-alert-catalog-risk-policy-
-- poam-1942.sql`, which seeded `poam.milestone_approaching` / `poam.expiring`
-- into `customer_tenant_alert_rules` as PENDING_DETECTOR precisely because
-- this schema did not exist yet. No table, column, or route referencing a
-- POA&M concept existed anywhere. Nothing here duplicates or conflicts with
-- either.
--
-- Mirrors `msp_risk_decisions`'s own real pattern (lib/db/src/schema/msp.ts,
-- `mspRiskDecisionsTable`) for the fields that carry over conceptually — see
-- that table definition's own header comment (and this migration's sibling
-- schema edit) for the full reasoning behind every column below.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS msp_poams (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  poam_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  primary_domain TEXT NOT NULL,

  title TEXT NOT NULL,
  weakness_description TEXT NOT NULL,

  check_key TEXT,
  additional_check_keys JSONB,

  scheduled_completion_date DATE NOT NULL,
  original_scheduled_completion_date DATE NOT NULL,

  interim_compensating_control TEXT NOT NULL,
  resources_required TEXT NOT NULL,

  status TEXT NOT NULL,

  authorizing_workload_id TEXT,
  authorizing_workload_label TEXT,
  authorizing_holder_person_ids JSONB,
  signed_by_person_id TEXT,

  signed_at TIMESTAMPTZ,
  signed_by JSONB,
  signed_statement TEXT,

  sow_id UUID REFERENCES msp_sows(sow_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_poams_msp_id_idx ON msp_poams (msp_id);
CREATE INDEX IF NOT EXISTS msp_poams_tenant_id_idx ON msp_poams (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS msp_poams_msp_id_poam_id_uidx ON msp_poams (msp_id, poam_id);
CREATE INDEX IF NOT EXISTS msp_poams_tenant_check_status_idx ON msp_poams (tenant_id, check_key, status);
CREATE INDEX IF NOT EXISTS msp_poams_sow_id_idx ON msp_poams (sow_id);

CREATE TABLE IF NOT EXISTS msp_poam_milestones (
  id SERIAL PRIMARY KEY,
  poam_id INTEGER NOT NULL REFERENCES msp_poams(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_poam_milestones_poam_id_idx ON msp_poam_milestones (poam_id);

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-poams-schema-3080.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

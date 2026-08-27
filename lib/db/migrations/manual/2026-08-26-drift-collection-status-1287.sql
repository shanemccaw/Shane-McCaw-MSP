-- Git #1287 — drift_collection_status
--
-- Per (tenant, domain) record of the most recent drift-collection attempt, so a
-- domain that was scanned but could NOT be diffed does not read as "never
-- scanned". Extending the drift engine (#1270/#1283) to every executor type
-- introduced a fourth honest outcome — a scan ran but a stable before/after
-- comparison genuinely could not be made this run (e.g. a fan-out site scan that
-- hit its coverage cap) — which must surface as a specific reason, not a silent
-- gap and not a fabricated "no drift detected". This table holds that reason.
--
-- Idempotent: safe to re-run. Reviewed and run by Shane (schema changes are
-- manual SQL in this project, never drizzle-kit push).

BEGIN;

CREATE TABLE IF NOT EXISTS drift_collection_status (
  id               serial PRIMARY KEY,
  tenant_id        text NOT NULL,
  domain_key       text NOT NULL,
  check_key        text,
  status           text NOT NULL,
  reason           text,
  coverage         jsonb,
  events_inserted  integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One current status per (tenant, domain); the collector upserts on this key.
CREATE UNIQUE INDEX IF NOT EXISTS drift_collection_status_tenant_domain_uniq
  ON drift_collection_status (tenant_id, domain_key);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-drift-collection-status-1287.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

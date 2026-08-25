-- ============================================================================
-- Configuration Drift engine — itemized drift store (#1270)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres / shaneapp://executeSql
-- per current CLAUDE.md. Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS,
-- safe to re-run.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- Three independent UI seams (Health config-drift table #1261, Architecture
-- Conditional Access drift #1265, AssessmentGeneratingScreen's Configuration
-- Drift card) were each built expecting a real per-event configuration-drift
-- history that had never existed anywhere in the backend. The 14 `drift.*`
-- dashboard metrics are declared `shape: "timeline"` / `valueType: "event-list"`
-- but their `drift:*` sourceKeys matched no `monitor_checks` row, so every one
-- resolved to `unknown_check_key`; the Health table was a hardcoded 12-row
-- fixture. #1270 (sign-off: build the real itemized store, Conditional Access
-- first) adds the backing store these surfaces consume.
--
-- Two tables:
--   * drift_baseline_snapshots — last-known / signed config snapshot per
--     (tenant, domain). Drift is a diff of a fresh scan against the CURRENT
--     (superseded_at IS NULL) baseline; the baseline stays the reference until
--     explicitly re-captured, so drift is deviation from an APPROVED state.
--   * drift_events — one row per detected per-setting change (what changed,
--     old→new value, who, when, verdict, linked CR). The itemized history the
--     timeline/table UIs render, served by the new `drift:*` resolver branch in
--     dashboard-resolvers.ts (ok → { events }).
--
-- domain_key is the bare slug of a `drift:*` metric sourceKey — e.g. metric
-- drift.caPolicyDriftCount / sourceKey "drift:ca-policy" → domain_key "ca-policy".
-- Conditional Access ("ca-policy") is the first collected domain.

CREATE TABLE IF NOT EXISTS drift_baseline_snapshots (
  id             SERIAL PRIMARY KEY,
  snapshot_id    UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  domain_key     TEXT NOT NULL,
  config         JSONB NOT NULL,
  signed         BOOLEAN NOT NULL DEFAULT FALSE,
  captured_by    TEXT,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drift_baseline_snapshots_tenant_domain_idx
  ON drift_baseline_snapshots (tenant_id, domain_key);
CREATE INDEX IF NOT EXISTS drift_baseline_snapshots_superseded_idx
  ON drift_baseline_snapshots (superseded_at);

CREATE TABLE IF NOT EXISTS drift_events (
  id                   SERIAL PRIMARY KEY,
  event_id             UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id            TEXT NOT NULL,
  domain_key           TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL UNIQUE,
  setting              TEXT NOT NULL,
  op                   TEXT NOT NULL,
  old_value            JSONB,
  new_value            JSONB,
  changed_by           TEXT,
  verdict              TEXT NOT NULL DEFAULT 'unattributed',
  cr_ref               TEXT,
  baseline_snapshot_id INTEGER,
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drift_events_tenant_domain_idx
  ON drift_events (tenant_id, domain_key);
CREATE INDEX IF NOT EXISTS drift_events_tenant_detected_idx
  ON drift_events (tenant_id, detected_at);

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-configuration-drift-engine-1270.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

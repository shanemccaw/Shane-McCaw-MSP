-- #1504 — Change Control: scheduling, collision detection, and CR dependencies.
--
-- `scheduled_for` was a single free-text column: no maintenance windows, no
-- conflict detection, no dependencies between CRs. #1762 already added the
-- real `scheduled_start`/`scheduled_end` instant pair this build's collision
-- detection and maintenance-window enforcement are evaluated against — no new
-- columns are needed on `msp_change_requests` itself for that. This adds:
--
--   1. `change_maintenance_windows` — the OPPOSITE of #1500's
--      `change_freeze_windows`: when change is EXPECTED, not forbidden. Same
--      scope/recurrence shape, its own table (never merged with the freeze
--      table — see the Drizzle schema's own header on why).
--   2. `portal_change_control_policy.enforce_maintenance_windows` — the
--      maintenance-window counterpart to the existing
--      `enforce_freeze_calendar` toggle. Off by default.
--   3. `change_request_dependencies` — a real `blocked_by` edge between two
--      CRs, enforced at the single write-authorization choke point
--      (`change-control-write-gate.ts`), not a second enforcement path.
--
-- All additive.

BEGIN;

CREATE TABLE IF NOT EXISTS change_maintenance_windows (
  id                serial PRIMARY KEY,
  msp_id            integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  scope             text NOT NULL,               -- global | tenant | workload
  tenant_id         text,                         -- required when scope = 'tenant'
  workload          text,                         -- required when scope = 'workload'
  name              text NOT NULL,
  reason            text,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  recurrence        text NOT NULL DEFAULT 'none', -- none | weekly | monthly | quarterly | annually
  recurrence_until  timestamptz,                  -- NULL = repeats indefinitely
  active            boolean NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_maintenance_windows_scope_chk CHECK (scope IN ('global','tenant','workload')),
  CONSTRAINT change_maintenance_windows_recurrence_chk CHECK (recurrence IN ('none','weekly','monthly','quarterly','annually')),
  CONSTRAINT change_maintenance_windows_span_chk CHECK (ends_at > starts_at),
  CONSTRAINT change_maintenance_windows_tenant_scope_chk CHECK (scope <> 'tenant' OR (tenant_id IS NOT NULL AND btrim(tenant_id) <> '')),
  CONSTRAINT change_maintenance_windows_workload_scope_chk CHECK (scope <> 'workload' OR (workload IS NOT NULL AND btrim(workload) <> ''))
);

CREATE INDEX IF NOT EXISTS change_maintenance_windows_msp_id_idx ON change_maintenance_windows(msp_id);
CREATE INDEX IF NOT EXISTS change_maintenance_windows_scope_idx ON change_maintenance_windows(msp_id, scope);
CREATE INDEX IF NOT EXISTS change_maintenance_windows_active_idx ON change_maintenance_windows(active);

-- portal_change_control_policy: the maintenance-window enforcement switch,
-- same shape as enforce_freeze_calendar (#1500).
ALTER TABLE portal_change_control_policy
  ADD COLUMN IF NOT EXISTS enforce_maintenance_windows boolean NOT NULL DEFAULT false;

-- CR-to-CR `blocked_by` edges.
CREATE TABLE IF NOT EXISTS change_request_dependencies (
  id                        serial PRIMARY KEY,
  msp_id                    integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  change_request_id         integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  blocks_change_request_id  integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  note                      text,
  created_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_request_dependencies_not_self_chk CHECK (change_request_id <> blocks_change_request_id)
);

CREATE INDEX IF NOT EXISTS change_request_dependencies_msp_id_idx ON change_request_dependencies(msp_id);
CREATE INDEX IF NOT EXISTS change_request_dependencies_change_request_id_idx ON change_request_dependencies(change_request_id);
CREATE INDEX IF NOT EXISTS change_request_dependencies_blocks_change_request_id_idx ON change_request_dependencies(blocks_change_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS change_request_dependencies_edge_uidx ON change_request_dependencies(change_request_id, blocks_change_request_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-cr-maintenance-windows-collision-dependencies-1504.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

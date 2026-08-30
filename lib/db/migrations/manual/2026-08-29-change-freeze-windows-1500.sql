-- #1500 — Change Control: freeze / blackout windows + server-side enforcement.
--
-- No freeze-window table existed. The retired page's `freezeException`,
-- `freezeOpen` and `freezesOv` were client-side stubs hardcoded to
-- false/null — the UI already pretended this feature was real. This adds:
--   1. `change_freeze_windows` — the real table: scope (global/tenant/
--      workload), a one-off span or a recurring cadence.
--   2. Two columns on #1496's `cr_approvals` so a freeze EXCEPTION becomes a
--      dedicated, higher-bar approval stage on the ledger that already
--      exists, rather than a second approval mechanism.
-- Both additive.

BEGIN;

CREATE TABLE IF NOT EXISTS change_freeze_windows (
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
  CONSTRAINT change_freeze_windows_scope_chk CHECK (scope IN ('global','tenant','workload')),
  CONSTRAINT change_freeze_windows_recurrence_chk CHECK (recurrence IN ('none','weekly','monthly','quarterly','annually')),
  CONSTRAINT change_freeze_windows_span_chk CHECK (ends_at > starts_at),
  CONSTRAINT change_freeze_windows_tenant_scope_chk CHECK (scope <> 'tenant' OR (tenant_id IS NOT NULL AND btrim(tenant_id) <> '')),
  CONSTRAINT change_freeze_windows_workload_scope_chk CHECK (scope <> 'workload' OR (workload IS NOT NULL AND btrim(workload) <> ''))
);

CREATE INDEX IF NOT EXISTS change_freeze_windows_msp_id_idx ON change_freeze_windows(msp_id);
CREATE INDEX IF NOT EXISTS change_freeze_windows_scope_idx ON change_freeze_windows(msp_id, scope);
CREATE INDEX IF NOT EXISTS change_freeze_windows_active_idx ON change_freeze_windows(active);

-- cr_approvals: the freeze-exception higher-bar stage (#1500, extends #1496's
-- ledger rather than duplicating it).
ALTER TABLE cr_approvals
  ADD COLUMN IF NOT EXISTS freeze_window_id integer REFERENCES change_freeze_windows(id) ON DELETE SET NULL;
ALTER TABLE cr_approvals
  ADD COLUMN IF NOT EXISTS justification text;

CREATE INDEX IF NOT EXISTS cr_approvals_freeze_window_id_idx ON cr_approvals(freeze_window_id);

-- A freeze-exception stage must carry its justification; an ordinary stage
-- must not fake one. Guarded so re-running this file is safe (Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cr_approvals_freeze_justification_chk'
  ) THEN
    ALTER TABLE cr_approvals
      ADD CONSTRAINT cr_approvals_freeze_justification_chk
      CHECK (freeze_window_id IS NULL OR (justification IS NOT NULL AND btrim(justification) <> ''));
  END IF;
END $$;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-change-freeze-windows-1500.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

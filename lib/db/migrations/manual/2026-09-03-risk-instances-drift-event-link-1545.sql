-- #1545 — Remediation: Shadow IT as an accumulating governance risk.
--
-- Additive only. One new nullable column on the existing risk_instances table
-- (#1509); no existing column touched, no existing row rewritten.
--
-- Settled architecture (#1489, #1545): individual drift events already surface
-- on their own (#1270). On top of that, an accumulating pattern of unauthorized
-- change is a real, standing governance risk about the ORGANISATION — it fits
-- the RBD container-plus-line-items shape #1509 built exactly, with no separate
-- mechanism. This column is the one piece that shape didn't already carry: a
-- pointer from a Shadow IT line item back to the specific drift_events row it
-- was raised from, so the automated accumulation path (shadow-it-governance.ts)
-- can tell "have I already logged this occurrence" without re-deriving it from
-- free-text label/object_id.
--
-- No uniqueness constraint: the SAME setting can drift, resolve, and reopen
-- again later (drift_events' own reopen lifecycle, #1290) — each reopening is
-- a genuinely new instance of exposure with its own found_at, exactly like any
-- other risk_instances row (#1509's "each with its own found date"). Multiple
-- risk_instances rows may legitimately point at the same drift_event_id over
-- that event's lifetime.
--
-- ON DELETE SET NULL: there is no deletion path for drift_events today; this
-- only guards against losing the governance record if one is ever added.

BEGIN;

ALTER TABLE risk_instances
  ADD COLUMN IF NOT EXISTS drift_event_id integer REFERENCES drift_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS risk_instances_drift_event_id_idx ON risk_instances (drift_event_id);

COMMENT ON COLUMN risk_instances.drift_event_id IS
  'The drift_events.id this line item was raised from, when it was (#1545 — '
  'Shadow IT accumulation). NULL for any line item added by hand. No '
  'uniqueness constraint — the same drift event can reopen and be logged as a '
  'new occurrence more than once over its life.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'risk_instances'
   AND column_name = 'drift_event_id';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-risk-instances-drift-event-link-1545.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

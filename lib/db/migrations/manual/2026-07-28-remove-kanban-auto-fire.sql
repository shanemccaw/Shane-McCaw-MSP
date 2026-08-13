-- Issue #101: Remove Kanban Auto-Fire.
-- The kanban_auto_fire and reconcile_orphaned_runs node types, their code paths,
-- and the seeded system workflows that used them have been deleted from the
-- codebase. This migration stops the 3 corresponding live wf_definitions rows
-- from ever firing again, without touching their historical wf_runs audit trail
-- (wf_runs/wf_versions/wf_node_output_samples all ON DELETE CASCADE from
-- wf_definitions, so a hard delete here would also erase past run history —
-- disabling the triggers is the safer default).
--
-- Affected seeded definitions (by name, as created by seed-system-workflows.ts):
--   "__system__: Orphan Reconciliation"        (startup trigger)
--   "__system__: Late Auto-Fire Reconciliation" (*/5 min cron trigger)
--   "__system__: Kanban Auto-fire"              (kanban.card_moved event trigger)

BEGIN;

UPDATE wf_triggers
   SET enabled = false
 WHERE definition_id IN (
   SELECT id FROM wf_definitions
    WHERE name IN (
      '__system__: Orphan Reconciliation',
      '__system__: Late Auto-Fire Reconciliation',
      '__system__: Kanban Auto-fire'
    )
 )
   AND enabled = true;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-28-remove-kanban-auto-fire.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;

-- Optional follow-up, run separately once you're satisfied nothing needs the
-- history: permanently removes the definitions and cascades to their
-- wf_versions/wf_triggers/wf_runs/wf_run_steps/wf_run_logs/wf_node_output_samples rows.
--
-- BEGIN;
-- DELETE FROM wf_definitions
--  WHERE name IN (
--    '__system__: Orphan Reconciliation',
--    '__system__: Late Auto-Fire Reconciliation',
--    '__system__: Kanban Auto-fire'
--  );
-- COMMIT;

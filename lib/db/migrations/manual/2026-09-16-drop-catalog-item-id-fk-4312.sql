-- #4312 — msp_change_requests.catalog_item_id is written by TWO distinct
-- write paths: change-catalog execution (change_catalog_items.id, #1498) and
-- Launch Control execution (write_action_catalog.id,
-- raiseChangeRequestForLaunchControlExecution). No single FK can point at
-- both source tables, and the strict FK to change_catalog_items(id) blocked
-- Launch Control from ever populating this column (a write_action_catalog id
-- has no matching row in change_catalog_items). Drop the FK; the column and
-- its index stay. This is a DROP CONSTRAINT, which
-- lib/db/drizzle's destructive-migration-gate explicitly classifies as
-- non-destructive (reversible, loses no data).

ALTER TABLE msp_change_requests
  DROP CONSTRAINT IF EXISTS msp_change_requests_catalog_item_id_fkey;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-drop-catalog-item-id-fk-4312.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

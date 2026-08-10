-- Git #699: nested sub-issues (an issue with its own sub-issues gets promoted
-- into bt_epics just like a top-level epic) had no link back to their real
-- parent epic, so they surfaced as unrelated top-level epics — easy to lose
-- track of, and invisible entirely once closed even with open children still
-- under them.
ALTER TABLE bt_epics
  ADD COLUMN IF NOT EXISTS parent_epic_id INTEGER REFERENCES bt_epics(id) ON DELETE SET NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-10-bt-epics-parent-epic-id-699.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

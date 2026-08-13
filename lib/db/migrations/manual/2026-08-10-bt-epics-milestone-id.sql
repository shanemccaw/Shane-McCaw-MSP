-- Adds milestone_id to bt_epics and bt_issues tables for linking epics and issues to GitHub milestones
ALTER TABLE bt_epics ADD COLUMN IF NOT EXISTS milestone_id INTEGER;
ALTER TABLE bt_issues ADD COLUMN IF NOT EXISTS milestone_id INTEGER;

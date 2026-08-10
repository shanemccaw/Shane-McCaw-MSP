-- Adds milestone_id to bt_epics table for linking epics to GitHub milestones
ALTER TABLE bt_epics ADD COLUMN IF NOT EXISTS milestone_id INTEGER;

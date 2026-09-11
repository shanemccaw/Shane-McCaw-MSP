-- Adds design_url to bt_epics: a single, settable "Claude Design URL" per epic (Git #3692)
ALTER TABLE bt_epics ADD COLUMN IF NOT EXISTS design_url TEXT;

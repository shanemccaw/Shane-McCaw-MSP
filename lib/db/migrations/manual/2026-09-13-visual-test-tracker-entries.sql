-- Visual Test Tracker Upgrade: Bug List & Test Entries
-- Adds visual_test_tracker_entries table and links screenshots to entries.
-- BuildConsole-owned tables (same pattern as 2026-08-28-visual-test-tracker.sql).
--
-- Shane To-Do: run this file against the local Postgres 18 install if using
-- database-backed persistent entries (BuildConsole also falls back cleanly to
-- local %AppData% storage when running offline or pre-migration).

CREATE TABLE IF NOT EXISTS visual_test_tracker_entries (
    id                  SERIAL PRIMARY KEY,
    entry_uuid          text NOT NULL UNIQUE,
    page_id             integer NOT NULL REFERENCES visual_test_tracker_pages(id) ON DELETE CASCADE,
    base_url            text NOT NULL DEFAULT '',
    page_path           text NOT NULL DEFAULT '',
    title               text NOT NULL DEFAULT '',
    notes               text NOT NULL DEFAULT '',
    steps_to_reproduce  text NOT NULL DEFAULT '',
    expected_behavior   text NOT NULL DEFAULT '',
    actual_behavior     text NOT NULL DEFAULT '',
    severity            text NOT NULL DEFAULT 'Bug', -- 'Blocker', 'Critical', 'Bug', 'UI Glitch', 'Functional', 'Low'
    status              text NOT NULL DEFAULT 'Open', -- 'Open', 'Resolved'
    tags                text[] NOT NULL DEFAULT '{}',
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    telemetry           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_entries_page_id
    ON visual_test_tracker_entries (page_id, created_at DESC);

-- Optional columns if the table already existed in a prior draft
ALTER TABLE visual_test_tracker_entries
    ADD COLUMN IF NOT EXISTS steps_to_reproduce text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS expected_behavior text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS actual_behavior text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS telemetry jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Optional entry_id on screenshots so captures can be associated directly with a bug entry
ALTER TABLE visual_test_tracker_screenshots
    ADD COLUMN IF NOT EXISTS entry_id integer REFERENCES visual_test_tracker_entries(id) ON DELETE SET NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-visual-test-tracker-entries.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

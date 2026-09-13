-- Bug Tracker Schema Extension: Sequential Bug Numbers, Git Issue Links, Site & Epic Categorization
-- BuildConsole-owned table extension for visual_test_tracker_entries.
--

CREATE SEQUENCE IF NOT EXISTS visual_test_tracker_bug_number_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE visual_test_tracker_entries
    ADD COLUMN IF NOT EXISTS bug_number integer DEFAULT nextval('visual_test_tracker_bug_number_seq'),
    ADD COLUMN IF NOT EXISTS git_issue_number integer NULL,
    ADD COLUMN IF NOT EXISTS site_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS epic_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS closing_build_id text NULL;

UPDATE visual_test_tracker_entries
SET bug_number = nextval('visual_test_tracker_bug_number_seq')
WHERE bug_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visual_test_tracker_entries_bug_number
    ON visual_test_tracker_entries (bug_number);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_entries_site_epic
    ON visual_test_tracker_entries (site_name, epic_name, bug_number DESC);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_entries_git_issue
    ON visual_test_tracker_entries (git_issue_number) WHERE git_issue_number IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-bug-tracker-schema.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- Git #3978 (sub-issue of #3977) — Bug lifecycle: status enum via CHECK, resolution
-- split (Fixed vs NotABug), structured selector + nullable page scoping, and the
-- is_design routing flag (added 2026-09-14 per Shane's comment on #3978).
-- BuildConsole-owned table (visual_test_tracker_entries) — no Drizzle TS schema,
-- same convention as 2026-08-28-visual-test-tracker.sql. SQL only; run manually
-- against the local Postgres 18 install.

-- 1. Status enum, via CHECK not native Postgres enum (cheaper to extend later).
UPDATE visual_test_tracker_entries SET status = 'Closed' WHERE status = 'Resolved';

ALTER TABLE visual_test_tracker_entries
    ADD CONSTRAINT chk_vtt_status CHECK (status IN ('Open', 'Verifying', 'Closed'));

-- 2. Resolution split — distinguishes a genuinely-fixed close from a dismissed
--    "not a bug" close (both currently collapse to 'Resolved' with no way to tell
--    them apart).
ALTER TABLE visual_test_tracker_entries ADD COLUMN resolution TEXT NULL;
ALTER TABLE visual_test_tracker_entries ADD COLUMN resolution_reason TEXT NULL;

ALTER TABLE visual_test_tracker_entries
    ADD CONSTRAINT chk_vtt_resolution CHECK (resolution IS NULL OR resolution IN ('Fixed', 'NotABug'));
ALTER TABLE visual_test_tracker_entries
    ADD CONSTRAINT chk_vtt_resolution_reason CHECK (resolution IS DISTINCT FROM 'NotABug' OR resolution_reason IS NOT NULL);

-- 3. Structured selector + nullable page scoping — element-level, page-level, and
--    global bug scoping. Element key is (page_id, selector); page-level is
--    (page_id) with selector NULL; global is (base_url) with page_id AND
--    page_path both NULL. page_id confirmed NOT NULL as of 2026-09-13 (every
--    entry created via GetOrCreatePageAsync), so DROP NOT NULL is a real change,
--    not a no-op.
ALTER TABLE visual_test_tracker_entries ADD COLUMN selector TEXT NULL;
ALTER TABLE visual_test_tracker_entries ALTER COLUMN page_id DROP NOT NULL;

-- 4. is_design routing flag (Shane comment, 2026-09-14) — flags a bug as routed to
--    Claude Design rather than the normal engineering dispatch pipeline. Not a
--    status or resolution: a design-flagged bug stays genuinely Open indefinitely.
--    Feeds the filter in #3982.
ALTER TABLE visual_test_tracker_entries ADD COLUMN is_design BOOLEAN NOT NULL DEFAULT false;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-bug-lifecycle-3978.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

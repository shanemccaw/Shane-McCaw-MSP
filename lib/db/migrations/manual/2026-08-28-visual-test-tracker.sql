-- Git #1472 — Visual Test Tracker: a new standalone BuildConsole floaty (separate
-- from Sticky Notes) that watches the WebView2 dev-tab navigation against a
-- configurable list of base URLs (e.g. localhost:5175/portal/shane-mccaw-consulting/
-- portal-v2), auto-fills the current page path read-only, tracks a per-page
-- Good/Bad checkbox (defaults to Bad until Shane confirms clean) + free-text notes,
-- and stores every CapturePreviewAsync screenshot (full-page or drawn-region) with
-- full history so Shane can visually diff "before this build" vs "after" by
-- scrolling a gallery instead of hunting Downloads. BuildConsole-owned tables (same
-- pattern as bt_chats/bt_issues/bt_build_queue) — no Drizzle TS schema needed, this
-- data is never read by the Next.js/Node side of the stack, only by the WPF app's
-- own Npgsql connection (VisualTestTrackerStore.cs).
--
-- Shane To-Do: run this file against the local Postgres 18 install before first
-- use of the Visual Test Tracker panel — the store surfaces an honest "database
-- not ready" state (never fixture/fake data) until this migration has run.

CREATE TABLE IF NOT EXISTS visual_test_tracker_pages (
    id           SERIAL PRIMARY KEY,
    base_url     text NOT NULL,          -- the configured watched base URL this page belongs to (e.g. "localhost:5175/portal/shane-mccaw-consulting/portal-v2")
    page_path    text NOT NULL,          -- the path auto-filled from navigation (e.g. "/portal-v2/retainer")
    is_good      boolean NOT NULL DEFAULT false,  -- defaults to Bad (false) on first visit — Shane flips to Good only when confirmed clean
    notes        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (base_url, page_path)
);

CREATE TABLE IF NOT EXISTS visual_test_tracker_screenshots (
    id            SERIAL PRIMARY KEY,
    page_id       integer NOT NULL REFERENCES visual_test_tracker_pages(id) ON DELETE CASCADE,
    capture_type  text NOT NULL CHECK (capture_type IN ('full', 'region')),
    file_path     text NOT NULL,         -- absolute path on disk, organized by app + route (see VisualTestTrackerStore)
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_screenshots_page_id
    ON visual_test_tracker_screenshots (page_id, created_at DESC);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-visual-test-tracker.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

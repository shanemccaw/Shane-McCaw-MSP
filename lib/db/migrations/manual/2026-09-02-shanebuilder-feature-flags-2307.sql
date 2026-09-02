-- Git #2307 — real backing for the Git Panel Epic detail's per-feature "Pause" action.
--
-- Park already has a real, existing home: the GitHub Project v2 board's own "Status" field
-- carries a real "Park" option (id 19cfa11c on field PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0, project
-- PVT_kwHOEiBDdc4BeoiY) — Park is written there directly, no new storage needed.
--
-- Pause has no such native home: bt_build_queue's real status vocabulary (confirmed against
-- live data — `SELECT DISTINCT status FROM bt_build_queue`) is queued/running/verifying/
-- parked/done/failed/canceled/external — there is no 'paused' value, and bt_build_queue itself
-- is BuildConsole-owned/read-only from ShaneBuilder by contract (QueueReadClient's own header).
-- This table is a new, small, ShaneBuilder-owned table for exactly this one real feature: a
-- per-feature (the epic's direct sub-issue) pause override that the Epic panel's per-feature
-- action sets/clears, and that every other surface rendering that feature (Build Queue band,
-- Git Map, chat rail) reads to show a real PAUSED state and to stop treating its open issues as
-- dispatchable.
CREATE TABLE IF NOT EXISTS shanebuilder_feature_flags (
    feature_number integer PRIMARY KEY,
    paused          boolean NOT NULL DEFAULT false,
    paused_at       timestamptz,
    paused_by       text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-shanebuilder-feature-flags-2307.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

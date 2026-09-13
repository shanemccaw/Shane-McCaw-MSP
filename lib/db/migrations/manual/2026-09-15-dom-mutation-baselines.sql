-- DOM Mutation Baselines & Regression Drift Tracking Table
-- BuildConsole-owned table for persistent DOM mutation baselines across test runs.
--

CREATE TABLE IF NOT EXISTS visual_test_tracker_dom_mutations (
    id                  SERIAL PRIMARY KEY,
    page_id             integer REFERENCES visual_test_tracker_pages(id) ON DELETE CASCADE,
    base_url            text NOT NULL DEFAULT '',
    page_path           text NOT NULL DEFAULT '',
    baseline_mutations  jsonb NOT NULL DEFAULT '[]'::jsonb,
    dom_snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_verified_at    timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (base_url, page_path)
);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_dom_mutations_lookup
    ON visual_test_tracker_dom_mutations (base_url, page_path);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-dom-mutation-baselines.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

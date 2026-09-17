-- Accessibility Audit History Table (Git #4442)
-- BuildConsole-owned table recording the last WCAG 2.1 AA audit run against each watched page,
-- so Test Mode can tell "has this page ever been accessibility-audited" and detect new violations
-- on re-scan. Mirrors visual_test_tracker_dom_mutations (2026-09-15-dom-mutation-baselines.sql).
--

CREATE TABLE IF NOT EXISTS visual_test_tracker_a11y_audits (
    id                  SERIAL PRIMARY KEY,
    page_id             integer REFERENCES visual_test_tracker_pages(id) ON DELETE CASCADE,
    base_url            text NOT NULL DEFAULT '',
    page_path           text NOT NULL DEFAULT '',
    total_violations    integer NOT NULL DEFAULT 0,
    violation_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_audited_at     timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (base_url, page_path)
);

CREATE INDEX IF NOT EXISTS idx_visual_test_tracker_a11y_audits_lookup
    ON visual_test_tracker_a11y_audits (base_url, page_path);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-visual-test-tracker-a11y-audits-4442.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

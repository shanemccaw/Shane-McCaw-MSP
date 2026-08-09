-- Simulator Studio Run History (adminv2 /run-history) -- server-side storage
-- for every command and query actually run from the admin console.
--
-- Replaces a per-browser localStorage log. The rows are written by the routes
-- that do the running (admin-deploy-console.ts's two POSTs, and
-- admin-engines.ts's /simulator/sql/execute + /simulator/migrations/execute),
-- not by the browser reporting what it saw -- so a run is kept even when the
-- tab is closed, the response never arrives, or a second admin ran it.
--
-- Notes on the shape:
--   * effect  -- short derived consequence strings ('read only', '41 rows
--                changed', 'stopped at pnpm install'). Derived from the real
--                result, never guessed from the command text.
--   * output  -- whatever the run printed, truncated server-side at 20,000
--                characters with a visible marker rather than silently.
--   * note    -- the only field a human writes; everything else is derived.
--   * actor_user_id carries NO foreign key on purpose. This is a record of
--     what was done to the server; deleting or changing a user row must not
--     delete, block or rewrite the history of what that user ran.
--
-- Safe to run more than once. Creates nothing else and touches no existing
-- table.

CREATE TABLE IF NOT EXISTS simulator_run_history (
  id             serial PRIMARY KEY,
  kind           text NOT NULL,
  cmd            text NOT NULL,
  title          text NOT NULL,
  ticket         text NOT NULL DEFAULT '',
  started_at     timestamptz NOT NULL DEFAULT now(),
  duration_ms    integer NOT NULL DEFAULT 0,
  ok             boolean NOT NULL,
  effect         jsonb NOT NULL DEFAULT '[]'::jsonb,
  output         text NOT NULL DEFAULT '',
  note           text NOT NULL DEFAULT '',
  migration_file text,
  actor_user_id  integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 'deploy' (a shell command) or 'sql' (a query, or a manual migration file).
-- The screen's two filter chips are exactly these two.
ALTER TABLE simulator_run_history
  DROP CONSTRAINT IF EXISTS simulator_run_history_kind_check;
ALTER TABLE simulator_run_history
  ADD CONSTRAINT simulator_run_history_kind_check
  CHECK (kind IN ('deploy', 'sql'));

-- The list is always read newest-first.
CREATE INDEX IF NOT EXISTS simulator_run_history_started_at_idx
  ON simulator_run_history (started_at DESC);

-- The Deploy/SQL filter.
CREATE INDEX IF NOT EXISTS simulator_run_history_kind_idx
  ON simulator_run_history (kind);

-- "Run before: 14 times in all" counts every row sharing this exact command.
CREATE INDEX IF NOT EXISTS simulator_run_history_cmd_idx
  ON simulator_run_history (cmd);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-09-simulator-run-history.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

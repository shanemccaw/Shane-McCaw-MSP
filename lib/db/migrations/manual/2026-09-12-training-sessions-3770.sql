-- Git #3770 — Training session log, backend + data model (Feature roadmap #3768).
--
-- Shane delivers training to customers -- Lunch & Learns, How-To sessions,
-- Prompt-A-Thons, Ask Me Anythings -- and wants each session tracked per
-- customer. Same shape family as msp_status_reports (#3762): a real,
-- operator-authored record scoped by msp_id, with customer_id as tenants.id
-- and no FK, matching the existing "successor id-space, no FK by design"
-- convention already used by msp_status_reports and kanban_buckets.
--
-- Backend/data-model only -- no MSP Console UI screen yet (blocked on #3768's
-- real nav placement).

BEGIN;

CREATE TABLE IF NOT EXISTS training_sessions (
  id serial PRIMARY KEY,
  msp_id integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id integer NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('lunch_and_learn', 'how_to', 'prompt_a_thon', 'ask_me_anything')),
  session_date timestamptz NOT NULL,
  topic text NOT NULL,
  notes text,
  logged_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_sessions_msp_id_idx ON training_sessions (msp_id);
CREATE INDEX IF NOT EXISTS training_sessions_customer_id_idx ON training_sessions (customer_id);
CREATE INDEX IF NOT EXISTS training_sessions_customer_date_idx ON training_sessions (customer_id, session_date);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-training-sessions-3770.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

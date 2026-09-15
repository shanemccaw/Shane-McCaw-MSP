-- Git #4277 — reverse drift: engagebay_connection and public_chat_conversations
-- have real pgTable definitions (lib/db/src/schema/msp.ts, lib/db/src/schema/index.ts)
-- and are actively read/written by live routes (artifacts/api-server/src/routes/
-- engagebay.ts, artifacts/api-server/src/routes/public-chat.ts /
-- admin-public-chat.ts) but the tables were never created in the live DB. This
-- creates them to match the schema exactly. (The third reverse-drift entry,
-- `some_table`, was confirmed to be doc-comment example code in retention.ts —
-- not a real pgTable literal — so nothing to create for it.)

CREATE TABLE IF NOT EXISTS engagebay_connection (
  id serial PRIMARY KEY,
  msp_id integer NOT NULL DEFAULT 1 UNIQUE REFERENCES msps(id) ON DELETE CASCADE,
  key_vault_secret_name text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  connected_at timestamptz,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_chat_conversations (
  id serial PRIMARY KEY,
  session_id text NOT NULL UNIQUE,
  messages jsonb NOT NULL DEFAULT '[]',
  message_count integer NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT false,
  review_reason text CHECK (review_reason IN ('purchase_intent', 'needs_shane', 'explicit_request')),
  review_status text NOT NULL DEFAULT 'new' CHECK (review_status IN ('new', 'reviewed', 'resolved', 'archived')),
  reviewed_at timestamp,
  reviewed_by_user_id integer,
  declined_personal_topic boolean NOT NULL DEFAULT false,
  contact_name text,
  contact_email text,
  contact_company text,
  service_interest text,
  request_summary text,
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_chat_conversations_needs_review_idx ON public_chat_conversations (needs_review, review_status);
CREATE INDEX IF NOT EXISTS public_chat_conversations_updated_at_idx ON public_chat_conversations (updated_at);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4277-reverse-drift-missing-tables.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

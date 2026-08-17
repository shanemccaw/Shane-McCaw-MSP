-- ShaneBot Engine Core (#1097, epic #360) — bot_instances + bot_conversations.
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- The two foundational tables the shared ShaneBot engine
-- (artifacts/api-server/src/lib/shanebot-engine.ts) is built on. Deliberately sized
-- for EXACTLY the two permanent instances that will ever exist (shanebot_public,
-- shanebot_paid) — NOT a generic bot-builder, NO pluggable grounding registry.
--
-- The behavioral CONFIG of each instance is code-canonical (it lives in
-- shanebot-engine.ts's BOT_INSTANCES). The seed rows at the bottom mirror that code
-- so the DB matches; the engine reads the code definition, so the chat routes do NOT
-- hard-depend on these rows being present before this file is run.
--
-- Consumed by:
--   - shanebot-engine.ts (persona + grounding + action_router for both surfaces)
--   - bot_conversations.instance_id FK -> bot_instances.id
--   - the deferred #361 storage migration, which moves both surfaces' transcript
--     persistence onto bot_conversations (unblocked by this table existing).

BEGIN;

CREATE TABLE IF NOT EXISTS "bot_instances" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "auth_mode" text NOT NULL CHECK ("auth_mode" IN ('public', 'portal_authenticated')),
  "grounding_source" text NOT NULL CHECK ("grounding_source" IN ('live_catalog', 'customer_entitlements')),
  -- [] for public, ["regenerate_document","rerun_scan"] for paid. Gated at fire time
  -- by the engine's action_router against this list.
  "allowed_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cost_owner" text NOT NULL CHECK ("cost_owner" IN ('platform', 'msp')),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One row per chat session/thread. Transcript is an array of structured content
-- blocks ({type:"text"} / {type:"suggested_replies"}, with {type:"card"} reserved)
-- from day one — the same shape both surfaces already use in code.
CREATE TABLE IF NOT EXISTS "bot_conversations" (
  "id" serial PRIMARY KEY,
  "instance_id" integer NOT NULL REFERENCES "bot_instances" ("id"),
  "session_id" text NOT NULL UNIQUE,
  "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "message_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bot_conversations_instance_idx"
  ON "bot_conversations" ("instance_id");
CREATE INDEX IF NOT EXISTS "bot_conversations_updated_at_idx"
  ON "bot_conversations" ("updated_at");

-- Seed the two permanent instances, mirroring shanebot-engine.ts's BOT_INSTANCES.
-- Idempotent: re-running reconciles the rows back to the code-canonical config.
INSERT INTO "bot_instances" ("slug", "name", "auth_mode", "grounding_source", "allowed_actions", "cost_owner")
VALUES
  ('shanebot_public', 'ShaneBot Public', 'public', 'live_catalog', '[]'::jsonb, 'platform'),
  ('shanebot_paid', 'ShaneBot Paid', 'portal_authenticated', 'customer_entitlements', '["regenerate_document","rerun_scan"]'::jsonb, 'msp')
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "auth_mode" = EXCLUDED."auth_mode",
  "grounding_source" = EXCLUDED."grounding_source",
  "allowed_actions" = EXCLUDED."allowed_actions",
  "cost_owner" = EXCLUDED."cost_owner",
  "updated_at" = now();

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497) reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-shanebot-engine-bot-tables-1097.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

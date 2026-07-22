-- Public AI Chat conversations — full transcript storage + pull-based review queue
-- backing POST /api/public-chat (the public site's only "talk to a human" front door,
-- replacing the removed /contact form + /book calendar).
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- One row per browser chat session; the whole transcript is re-upserted each turn.
-- EVERY conversation is stored regardless of outcome.
--
-- Escalation is PULL-BASED ONLY (a deliberate personal-safety requirement):
-- `needs_review` lands the row in the admin queue; nothing in the write path pushes
-- (no email, no notification, no web-push, no SSE). Do not add one.
--
-- `declined_personal_topic` is audit-only — it records that the guardrail declined a
-- question about Shane personally (NASA/career/media/speaking/"pick your brain"/direct
-- contact). It NEVER causes `needs_review` to be set.
--
-- Consumed by:
--   - POST /api/public-chat (public, unauthenticated) — writes/updates rows
--   - GET/PATCH /api/admin/public-chat/... (requireAdmin) — the review queue

CREATE TABLE IF NOT EXISTS "public_chat_conversations" (
  "id" serial PRIMARY KEY,
  "session_id" text NOT NULL UNIQUE,
  "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "message_count" integer NOT NULL DEFAULT 0,
  "needs_review" boolean NOT NULL DEFAULT false,
  "review_reason" text CHECK ("review_reason" IN ('purchase_intent', 'needs_shane', 'explicit_request')),
  "review_status" text NOT NULL DEFAULT 'new' CHECK ("review_status" IN ('new', 'reviewed', 'resolved', 'archived')),
  "reviewed_at" timestamp,
  "reviewed_by_user_id" integer,
  "declined_personal_topic" boolean NOT NULL DEFAULT false,
  "contact_name" text,
  "contact_email" text,
  "contact_company" text,
  "service_interest" text,
  "request_summary" text,
  "user_agent" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "public_chat_conversations_needs_review_idx"
  ON "public_chat_conversations" ("needs_review", "review_status");
CREATE INDEX IF NOT EXISTS "public_chat_conversations_updated_at_idx"
  ON "public_chat_conversations" ("updated_at");

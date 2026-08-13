-- Drop the old single-column unique constraint on endpoint (created in 0099).
-- The subscribe upsert targets (user_id, endpoint), not endpoint alone.
ALTER TABLE "push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_endpoint_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_endpoint_uidx" ON "push_subscriptions" ("user_id","endpoint");

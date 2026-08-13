-- Notification Center fields: feed_type, category, severity, msp_id, msp_user_id, recipient_type
-- Also adds indexes for efficient per-user / per-feed-type queries.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "feed_type" text NOT NULL DEFAULT 'personal';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "severity" text NOT NULL DEFAULT 'info';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "msp_id" integer;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "msp_user_id" integer;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_type" text NOT NULL DEFAULT 'platform_admin';

CREATE INDEX IF NOT EXISTS "notifications_user_feed_idx" ON "notifications" ("user_id", "feed_type");
CREATE INDEX IF NOT EXISTS "notifications_msp_user_idx" ON "notifications" ("msp_user_id");
CREATE INDEX IF NOT EXISTS "notifications_feed_type_idx" ON "notifications" ("feed_type");

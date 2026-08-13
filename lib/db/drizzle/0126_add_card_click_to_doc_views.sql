ALTER TABLE "presentation_doc_views" ADD COLUMN IF NOT EXISTS "event_type" text DEFAULT 'dwell';--> statement-breakpoint
ALTER TABLE "presentation_doc_views" ADD COLUMN IF NOT EXISTS "card_name" text;

-- Fulfillment queue — add wholesale/quote pricing columns (Phase 5 fix).
-- Hand-authored idempotent migration (ADD COLUMN IF NOT EXISTS) matching the
-- 0197/0198 pattern. lib/db/src/schema/msp.ts has declared
-- wholesaleChargedCents / customerQuoteCents on fulfillmentQueueTable, but no
-- migration ever created them, so the live table drifted from the schema:
-- SELECT * (GET /admin/fulfillment-queue) 500'd on the missing columns and the
-- sync inserts silently failed. This migration reconciles a fresh DB with the
-- schema; the dev DB had the same ALTER applied manually.

ALTER TABLE "fulfillment_queue" ADD COLUMN IF NOT EXISTS "wholesale_charged_cents" integer;--> statement-breakpoint
ALTER TABLE "fulfillment_queue" ADD COLUMN IF NOT EXISTS "customer_quote_cents" integer;

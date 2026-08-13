CREATE TABLE IF NOT EXISTS "outbound_webhooks" (
  "id" serial PRIMARY KEY NOT NULL,
  "webhook_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" text NOT NULL,
  "msp_id" integer,
  "customer_id" integer,
  "label" text NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "secret_prefix" text NOT NULL,
  "event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_webhooks_webhook_id_unique" UNIQUE("webhook_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_webhooks_msp_id_idx" ON "outbound_webhooks" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_webhooks_customer_id_idx" ON "outbound_webhooks" ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_webhook_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "delivery_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL REFERENCES "outbound_webhooks"("webhook_id") ON DELETE CASCADE,
  "event_id" uuid,
  "event_type" text NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "status_code" integer,
  "response_snippet" text,
  "request_body_snapshot" jsonb,
  "next_retry_at" timestamptz,
  "delivered_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_webhook_id_idx" ON "outbound_webhook_deliveries" ("webhook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_event_id_idx" ON "outbound_webhook_deliveries" ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_created_at_idx" ON "outbound_webhook_deliveries" ("created_at");

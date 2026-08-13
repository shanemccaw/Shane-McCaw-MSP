CREATE TABLE IF NOT EXISTS "tenant_engine_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "msp_id" integer REFERENCES "msps"("id") ON DELETE set null,
  "customer_id" integer REFERENCES "users"("id") ON DELETE set null,
  "engine_key" text NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "trend_direction" text,
  "breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "captured_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tenant_engine_snapshots_customer_engine_captured_idx" 
ON "tenant_engine_snapshots" ("customer_id", "engine_key", "captured_at");
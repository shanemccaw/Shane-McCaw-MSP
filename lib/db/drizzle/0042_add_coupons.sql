CREATE TABLE IF NOT EXISTS "coupons" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "discount_type" text NOT NULL,
  "discount_value" numeric(10, 2) NOT NULL,
  "max_uses" integer,
  "uses_count" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

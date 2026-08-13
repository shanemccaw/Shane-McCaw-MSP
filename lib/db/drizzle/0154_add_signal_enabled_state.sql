CREATE TABLE IF NOT EXISTS "signal_enabled_state" (
"signal_key" text PRIMARY KEY NOT NULL,
"enabled" boolean DEFAULT true NOT NULL,
"updated_at" timestamp DEFAULT now() NOT NULL
);

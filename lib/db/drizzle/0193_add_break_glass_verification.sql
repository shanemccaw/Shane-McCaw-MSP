-- Break-glass verification: pending secrets, verification attempts, override audit.
-- Hand-authored idempotent migration (IF NOT EXISTS throughout) because the
-- break_glass base tables predate any generated migration (schema drift) and the
-- dev/prod DBs may already carry them via drizzle-kit push. The migrate runner
-- applies the whole file in one savepoint, so IF NOT EXISTS keeps it clean whether
-- the objects already exist or not.

CREATE TABLE IF NOT EXISTS "break_glass_pending_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"encrypted_value" text NOT NULL,
	"gate_node_id" text,
	"status" text DEFAULT 'pending_delivery' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivered_to_email" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "break_glass_verification_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pending_secret_id" integer NOT NULL,
	"initiated_by_portal_user_id" integer NOT NULL,
	"invited_email" text NOT NULL,
	"link_token" text NOT NULL,
	"link_status" text DEFAULT 'pending' NOT NULL,
	"verification_outcome" text,
	"entra_user_principal_name" text,
	"failed_attempt_count" integer DEFAULT 0,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "break_glass_verification_attempts_link_token_unique" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "break_glass_override_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"admin_user_id" integer NOT NULL,
	"reason" text NOT NULL,
	"old_pending_secret_id" integer,
	"new_pending_secret_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Columns added for pre-existing (pushed) base tables that lack them.
ALTER TABLE "break_glass_pending_secrets" ADD COLUMN IF NOT EXISTS "gate_node_id" text;
--> statement-breakpoint
ALTER TABLE "break_glass_verification_attempts" ADD COLUMN IF NOT EXISTS "failed_attempt_count" integer DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_pending_secrets_run_id_idx" ON "break_glass_pending_secrets" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_pending_secrets_customer_id_idx" ON "break_glass_pending_secrets" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_verification_attempts_link_token_idx" ON "break_glass_verification_attempts" USING btree ("link_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_verification_attempts_pending_secret_id_idx" ON "break_glass_verification_attempts" USING btree ("pending_secret_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "break_glass_override_audit_customer_created_idx" ON "break_glass_override_audit" USING btree ("customer_id","created_at");

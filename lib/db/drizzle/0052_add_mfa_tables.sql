CREATE TABLE IF NOT EXISTS "mfa_enrollments" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"method" text NOT NULL,
"enabled" boolean DEFAULT true NOT NULL,
"encrypted_secret" text,
"phone" text,
"created_at" timestamp DEFAULT now() NOT NULL,
"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mfa_challenges" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"method" text NOT NULL,
"code_hash" text,
"expires_at" timestamp NOT NULL,
"used_at" timestamp,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"credential_id" text NOT NULL,
"public_key" text NOT NULL,
"counter" integer DEFAULT 0 NOT NULL,
"transports" jsonb,
"device_type" text,
"backed_up" boolean DEFAULT false NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL,
CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" integer NOT NULL,
"challenge" text NOT NULL,
"purpose" text NOT NULL,
"expires_at" timestamp NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mfa_enrollments" ADD CONSTRAINT "mfa_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

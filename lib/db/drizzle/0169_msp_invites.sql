CREATE TABLE IF NOT EXISTS "msp_invites" (
  "id" serial PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "msp_id" integer NOT NULL,
  "invited_email" text NOT NULL,
  "msp_role" text NOT NULL DEFAULT 'MSPOperator',
  "invited_by_user_id" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "msp_invites_token_unique" UNIQUE("token")
);
CREATE INDEX IF NOT EXISTS "msp_invites_msp_id_idx" ON "msp_invites"("msp_id");
CREATE INDEX IF NOT EXISTS "msp_invites_invited_email_idx" ON "msp_invites"("invited_email");

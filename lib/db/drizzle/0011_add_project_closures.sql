CREATE TABLE IF NOT EXISTS "project_closures" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "feedback" text,
  "permission_granted" boolean NOT NULL DEFAULT false,
  "signature_data_url" text,
  "signed_at" timestamp,
  "signer_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "project_closures_project_id_unique" UNIQUE ("project_id")
);

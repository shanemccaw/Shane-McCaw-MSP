CREATE TABLE IF NOT EXISTS "client_m365_profiles" (
  "id" serial PRIMARY KEY,
  "client_id" integer NOT NULL UNIQUE,
  "profile" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "client_m365_profiles_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

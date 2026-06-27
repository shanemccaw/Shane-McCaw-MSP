ALTER TABLE "client_app_registrations"
  ADD COLUMN IF NOT EXISTS "connection_tested_at" timestamp;

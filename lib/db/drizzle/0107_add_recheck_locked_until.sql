ALTER TABLE "client_app_registrations" ADD COLUMN IF NOT EXISTS "recheck_locked_until" timestamp;

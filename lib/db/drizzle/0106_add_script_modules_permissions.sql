ALTER TABLE "script_modules" ADD COLUMN IF NOT EXISTS "permissions" jsonb DEFAULT '{"appPermissions":[],"delegatedPermissions":[],"notes":""}'::jsonb NOT NULL;

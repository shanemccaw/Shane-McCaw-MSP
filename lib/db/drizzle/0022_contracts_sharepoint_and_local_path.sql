ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "sharepoint_file_url" text;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "sharepoint_file_id" text;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "local_file_path" text;

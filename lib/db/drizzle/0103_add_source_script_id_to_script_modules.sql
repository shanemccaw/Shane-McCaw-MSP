ALTER TABLE "script_modules" ADD COLUMN IF NOT EXISTS "source_script_id" uuid REFERENCES "powershell_scripts"("id") ON DELETE SET NULL;

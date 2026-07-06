ALTER TABLE "wf_runs" ADD COLUMN IF NOT EXISTS "retriggered_from_run_id" integer;
DO $$ BEGIN
 ALTER TABLE "wf_runs" ADD CONSTRAINT "wf_runs_retriggered_from_run_id_wf_runs_id_fk" FOREIGN KEY ("retriggered_from_run_id") REFERENCES "public"."wf_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

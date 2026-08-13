DO $$ BEGIN
  ALTER TABLE "msp_invites" ADD CONSTRAINT "msp_invites_msp_id_fkey"
    FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "msp_invites" ADD CONSTRAINT "msp_invites_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

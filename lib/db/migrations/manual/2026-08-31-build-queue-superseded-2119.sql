-- Git #2119 — Reply/resume creates a brand-new queue row and never touches the
-- original, so the original card stayed stuck forever showing stale active status.
--
-- The fix (Option B): a Reply keeps creating its own fresh `Reply → <title>` row
-- (genuinely required — it must never dedupe onto / re-queue out from under a row
-- that may still be running, and it carries resume_session_id so the watcher
-- launches `claude --resume <sid> "<message>"`), but now the ORIGINAL row is
-- explicitly resolved: transitioned to a new terminal `superseded` status and
-- linked to its replacement via superseded_by_id, so the panel can show
-- "↩ REPLIED → #N" instead of two disconnected entries.
--
-- superseded_by_id points at another bt_build_queue row (the replacement). FK with
-- ON DELETE SET NULL so a purge of the replacement row never orphans a dangling id.
-- Additive, nullable column. Idempotent (IF NOT EXISTS). Run against local
-- DATABASE_URL in-session; recorded on #1630 for Replit/staging release.

ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS superseded_by_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bt_build_queue_superseded_by_id_fkey'
      AND table_name = 'bt_build_queue'
  ) THEN
    ALTER TABLE bt_build_queue
      ADD CONSTRAINT bt_build_queue_superseded_by_id_fkey
      FOREIGN KEY (superseded_by_id) REFERENCES bt_build_queue(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bt_build_queue_superseded_by_id_idx
  ON bt_build_queue (superseded_by_id)
  WHERE superseded_by_id IS NOT NULL;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-build-queue-superseded-2119.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

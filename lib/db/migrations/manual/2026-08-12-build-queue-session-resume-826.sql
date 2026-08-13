-- Git #826 — Shane: "how do I respond when Code has a question... I need to
-- be able to answer." claude.exe --print is one-shot and exits the moment
-- it's done, so a question left in a finished build's log had nothing left
-- to answer. session_id captures the real Claude Code session id the
-- moment a run's stream-json output reveals it; resume_session_id lets a
-- Reply action tell the watcher to relaunch with --resume <id> and the
-- reply text, continuing that EXACT conversation instead of starting a
-- stateless new one.
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS resume_session_id text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-12-build-queue-session-resume-826.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

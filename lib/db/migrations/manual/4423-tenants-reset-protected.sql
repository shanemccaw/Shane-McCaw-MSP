-- Git #4423 — a flag that makes scripts/db/reset-dev-database.mjs refuse to run at
-- all (dry-run included) while a tenant in its target MSP's scope carries it. See
-- lib/db/src/schema/msp.ts's resetProtected doc comment for the full story: the
-- same live-consented mccawsoft2 tenant row was deleted six times in one day by
-- build sessions "live verifying" that script/its BuildConsole gate against the
-- real shared local dev DB.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reset_protected boolean NOT NULL DEFAULT false;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4423-tenants-reset-protected.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

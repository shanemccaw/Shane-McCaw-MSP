-- #2829 — retire the legacy portal_security_plans model, now that #2576
-- bridged /api/portal/security-plan onto the real, settled #1561
-- assembled/versioned/signed pipeline (msp_security_plan_versions).
--
-- DESTRUCTIVE — per CLAUDE.md's Database section, dropping tables is not
-- self-executed by an agent session. This file is written and left for
-- Shane to run himself. Do NOT run this from an agent session.
--
-- Real evidence this is safe: all four tables confirmed at 0 rows locally,
-- both at #2576 (2026-09-01ish) and again here at #2829 (2026-09-04, live
-- psql query against local DATABASE_URL). The application code no longer
-- references any of these tables or the Drizzle schema symbols for them as
-- of this same commit (artifacts/api-server/src/routes/portal-security-plan.ts,
-- lib/db/src/schema/msp.ts).
--
-- Order matters: child tables first (FK ON DELETE CASCADE to
-- portal_security_plans would handle it anyway, but drop explicitly rather
-- than rely on cascade for a destructive statement).

BEGIN;

DROP TABLE IF EXISTS portal_security_plan_versions;
DROP TABLE IF EXISTS portal_security_plan_rows;
DROP TABLE IF EXISTS portal_security_plan_sections;
DROP TABLE IF EXISTS portal_security_plans;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-drop-legacy-portal-security-plans.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

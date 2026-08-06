-- Launch Control Phase 3 — allow "DELETE" as a baseline_action_templates.method value
-- Manual migration note — review before running (do not run drizzle-kit push/push --force).
--
-- Two of the Phase 3 templates (groups.remove_member, teams.remove_member) need
-- to issue a DELETE call to Microsoft Graph. The Drizzle schema
-- (lib/db/src/schema/msp.ts) enum for baseline_action_templates.method was
-- widened from ("POST","PATCH","PUT") to ("POST","PATCH","PUT","DELETE").
--
-- baseline_action_templates.method is a plain "text" column — Drizzle's
-- { enum: [...] } option is an APPLICATION-LEVEL TypeScript constraint only,
-- it does not generate a Postgres CHECK constraint. So there is nothing to
-- ALTER on the live table for this specific change: any string, including
-- "DELETE", was always writable to this column at the database level.
--
-- Run the query below to confirm that's still true on the live table before
-- inserting the DELETE-method rows in
-- 2026-07-20-launch-control-phase3-templates.sql — if it returns a row, a
-- CHECK constraint DOES exist and will need to be dropped/widened first
-- (not expected, but not independently re-verified against live
-- information_schema in this session — no DB access here).

SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'baseline_action_templates'
  AND con.contype = 'c';

-- Expected result: zero rows (no CHECK constraint on this table). If that's
-- what you see, no further action is needed here — proceed straight to
-- 2026-07-20-launch-control-phase3-templates.sql.

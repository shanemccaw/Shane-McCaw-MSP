-- #2460 — retire users.can_approve_purchases and users.can_manage_team.
-- Part of #1696 (RBAC Role Model Redesign), migration step 5 of 5.
--
-- ── DESTRUCTIVE. DELIBERATELY NOT RUN BY THE AGENT THAT WROTE IT. ───────────
--
-- CLAUDE.md's Database section is explicit: additive DDL an agent runs itself,
-- but "destructive or irreversible changes (dropping columns/tables, bulk
-- rewrites, anything production-affecting) still go to Shane to run himself."
-- Dropping a column is named in that list. So this file is written, reviewed and
-- recorded on the #1630 release checklist, and left for a human to execute.
--
-- Leaving it unrun is not a half-finished migration. Every product reader of both
-- columns is already gone (commit "RBAC: move the two capability columns' readers
-- onto the model"), so the columns are dead weight in every environment right now,
-- and the code does not care whether they are still present. The DROP is
-- housekeeping that can happen on any schedule.
--
-- ── Why this is safe to run, with the evidence ─────────────────────────────
--
-- 1. The grants these columns carried are already rows. #2457's seed created one
--    role per column and granted it to exactly the users who carried the column:
--
--      users.can_approve_purchases  ->  msp_roles.key      = 'cap.purchases.approve'
--      users.can_manage_team        ->  customer_roles.key = 'cap.team.manage'
--
--    Confirmed against the live local database on 2026-09-10: one user carries
--    can_manage_team, and that same user (id 39) holds the cap.team.manage
--    customer role. Zero users carry can_approve_purchases.
--
-- 2. The rules that read them are rows too, and they still answer identically.
--    `pnpm --filter @workspace/db run check-rbac-parity` was run against the real
--    local Postgres immediately before the reader migration landed:
--
--      --- RBAC OLD-vs-NEW PARITY: 888 comparisons, ALL AGREED
--          (2 registered fail-closed divergences) ---
--
--    The two registered divergences are #3360's, both pre-existing and both in the
--    safe direction (old ALLOW / new DENY for a principal holding an unrecognised
--    msp_role). Neither is introduced by this migration.
--
-- 3. Nothing reads the columns. Grep-verifiable:
--
--      grep -rn 'canApprovePurchases\|canManageTeam\|can_approve_purchases\|can_manage_team' \
--        --include=*.ts --include=*.tsx --exclude-dir=node_modules artifacts/ lib/
--
--    What remains after this migration is prose (comments explaining the retirement),
--    the shim's own `LegacyUserRow` transcription — which is a record of what the
--    rules WERE and is what `legacy-ladder.test.ts` pins — and `parity-check.ts`,
--    which reads them through raw SQL and degrades to skipping its real-user pass
--    once they are gone.
--
-- ── What is NOT dropped, and why ───────────────────────────────────────────
--
-- `users.can_approve_changes` (#1496) stays. #2460's contract names two columns,
-- not three, and the third is newer than #1696's own diagnosis. It is transcribed,
-- seeded and mapped exactly like the other two (`customer:changes.approve` ->
-- `cap.changes.approve`), so retiring it later is the same three lines — but doing
-- it here would be scope this issue did not ask for on a security path.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- The columns are recoverable from the role rows, which are the authoritative copy
-- and are not touched by this migration:
--
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS can_approve_purchases boolean NOT NULL DEFAULT false;
--   ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_team       boolean NOT NULL DEFAULT false;
--   UPDATE users u SET can_approve_purchases = true
--     FROM msp_user_roles mur JOIN msp_roles r ON r.id = mur.role_id
--    WHERE mur.user_id = u.id AND r.key = 'cap.purchases.approve' AND r.msp_id IS NULL;
--   UPDATE users u SET can_manage_team = true
--     FROM customer_user_roles cur JOIN customer_roles r ON r.id = cur.role_id
--    WHERE cur.user_id = u.id AND r.key = 'cap.team.manage' AND r.tenant_id IS NULL;

BEGIN;

-- Refuse to run against a database where the grants were never carried across.
-- Without this, a DROP here on an unseeded environment silently destroys the only
-- copy of who could approve a purchase or manage a team.
DO $$
DECLARE
  missing_role_count int;
  orphaned_grants int;
BEGIN
  SELECT count(*) INTO missing_role_count FROM (
    SELECT 1 FROM msp_roles      WHERE key = 'cap.purchases.approve' AND msp_id    IS NULL
    UNION ALL
    SELECT 1 FROM customer_roles WHERE key = 'cap.team.manage'       AND tenant_id IS NULL
  ) present;

  IF missing_role_count <> 2 THEN
    RAISE EXCEPTION
      'REFUSING TO DROP: #2457''s capability-column roles are not present (found %% of 2). '
      'Run 2026-09-09-rbac-seed-current-model-2457.sql against this database first — '
      'dropping these columns now would destroy the only record of these grants.',
      missing_role_count;
  END IF;

  -- Every user carrying a column must already hold the matching role. A non-zero
  -- count here means the seed ran before a grant was made, so that grant exists
  -- ONLY in the column being dropped.
  SELECT count(*) INTO orphaned_grants FROM users u
   WHERE (
     u.can_approve_purchases
     AND NOT EXISTS (
       SELECT 1 FROM msp_user_roles mur
         JOIN msp_roles r ON r.id = mur.role_id
        WHERE mur.user_id = u.id AND r.key = 'cap.purchases.approve' AND r.msp_id IS NULL
     )
   ) OR (
     u.can_manage_team
     AND NOT EXISTS (
       SELECT 1 FROM customer_user_roles cur
         JOIN customer_roles r ON r.id = cur.role_id
        WHERE cur.user_id = u.id AND r.key = 'cap.team.manage' AND r.tenant_id IS NULL
     )
   );

  IF orphaned_grants > 0 THEN
    RAISE EXCEPTION
      'REFUSING TO DROP: %% user(s) carry a capability column with no matching role row. '
      'Those grants exist only in the columns about to be dropped. Re-run #2457''s seed '
      '(it is idempotent) so the rows catch up, then run this migration again.',
      orphaned_grants;
  END IF;
END $$;

ALTER TABLE users DROP COLUMN IF EXISTS can_approve_purchases;
ALTER TABLE users DROP COLUMN IF EXISTS can_manage_team;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-drop-capability-columns-2460.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

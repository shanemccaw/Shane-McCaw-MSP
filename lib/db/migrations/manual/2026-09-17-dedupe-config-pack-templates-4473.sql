-- 2026-09-17-dedupe-config-pack-templates-4473.sql
--
-- Git #4473 — six config packs (baseline-licensing-v1, conditional-access-baseline-v1,
-- device-compliance-v1, email-security-v1, identity-hygiene-v1, privileged-access-v1)
-- have every config_pack_templates row duplicated: same pack_id/template_id/check_key/
-- sort_order, no parameter_mapping on either copy, ids exactly 30 apart. All six packs
-- were created 2026-08-21 17:15:32-33 with no corresponding seed file anywhere in
-- lib/db/migrations/manual/ or the app/scripts tree (confirmed by search) — whatever
-- inserted these ran outside version control (e.g. an ad-hoc SQL Runner session), not
-- a committed script, so there is no script here to fix or remove.
--
-- loadConfigPack (artifacts/api-server/src/lib/config-pack-orchestrator.ts:109-128)
-- selects every row for a pack with no dedupe and maps each to a step, so running any
-- of these six packs today materializes each write step twice — including
-- non-idempotent actions (action.delete-ca-policy, action.admin-set-password,
-- action.generate-temporary-access-pass, action.restore-deleted-user, etc).
--
-- Shane's authorization for the data delete, 2026-09-17: "fix it".
--
-- Verified against live local DB before writing this file: the higher-id row of each
-- pair (ids 125-154) is a byte-for-byte duplicate (pack_id, template_id, check_key,
-- sort_order, parameter_mapping, depends_on_override all equal) of its lower-id twin
-- (ids 95-124), and no other table has a foreign key into config_pack_templates.id, so
-- the delete is safe.
--
-- Reversible: not really (a data delete), but the deleted rows were exact duplicates
-- of surviving rows, so no information is lost.

BEGIN;

-- Guard: fail loudly instead of silently deleting the wrong rows if a fresh run of the
-- issue's own detection query no longer finds exactly this duplicate set.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM config_pack_templates WHERE id BETWEEN 125 AND 154;
  IF dup_count <> 30 THEN
    RAISE EXCEPTION 'Expected exactly 30 rows with id BETWEEN 125 AND 154 (the known duplicate set), found %. Re-verify before deleting.', dup_count;
  END IF;
END $$;

DELETE FROM config_pack_templates WHERE id BETWEEN 125 AND 154;

-- Prevent recurrence: a real unique index so this class of duplicate can never be
-- inserted again, regardless of what seeds a pack's templates in the future.
CREATE UNIQUE INDEX IF NOT EXISTS config_pack_templates_pack_template_check_uniq
  ON config_pack_templates (pack_id, template_id, coalesce(check_key, ''));

-- The table carried two identical FK constraints on pack_id and two on template_id
-- (confirmed via \d config_pack_templates: both pairs reference the same target column
-- with the same ON DELETE behavior). Drop the redundant duplicate of each pair;
-- dropping a constraint is not a destructive operation (no data loss).
ALTER TABLE config_pack_templates DROP CONSTRAINT IF EXISTS config_pack_templates_pack_id_fkey;
ALTER TABLE config_pack_templates DROP CONSTRAINT IF EXISTS config_pack_templates_template_id_fkey;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-dedupe-config-pack-templates-4473.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

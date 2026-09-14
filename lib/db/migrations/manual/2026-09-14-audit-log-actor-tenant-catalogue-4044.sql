-- #4044 (part of #1946, Feature: Full Audit Log — Step 1 of 4)
-- Real audit-log data model: expand the actor role vocabulary, add real tenant scoping,
-- and add the coarse, filterable action-category catalogue column.
--
-- Additive & reversible: no column is dropped, no existing row is rewritten. The 358
-- existing rows keep their actor_role, action_type and entity_type verbatim; their new
-- action_category and tenant_id are simply NULL (the trail under the catalogue model
-- begins at this migration — existing rows are NOT backfilled, per #1946 F).
--
-- Note on actor_role: the column is plain `text` with no DB CHECK constraint (the repo's
-- established pattern for `text(col, { enum: [...] })` — see msp_alert enums), so the
-- expanded Drizzle enum is a compile-time TS constraint only and needs no DDL here. The
-- msp/customer/system/microsoft values already present in live rows remain valid.

BEGIN;

-- Coarse operation-class catalogue (create/update/delete/action/settings/auth/access/security/system).
-- Nullable: existing rows predate the catalogue and are not backfilled.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_category text;

-- Real tenant scoping (references tenants.id). Nullable: not every audited action is
-- tenant-scoped, and existing rows are not backfilled.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_tenant_id_tenants_id_fk'
      AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_logs_tenant_id_tenants_id_fk
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_logs_action_category_idx ON audit_logs (action_category);
CREATE INDEX IF NOT EXISTS audit_logs_action_type_idx ON audit_logs (action_type);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_id_idx ON audit_logs (tenant_id);

-- Self-marking so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-audit-log-actor-tenant-catalogue-4044.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

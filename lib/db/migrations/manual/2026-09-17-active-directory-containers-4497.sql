-- MSP Directory Containers (Feature #4496 / issue #4497)
--
-- Additive, reversible-shaped DDL only: one new table + two new nullable FK
-- columns + supporting indexes. Run in-session against the local DATABASE_URL
-- per CLAUDE.md (additive migrations are agent-run, not a Shane To-Do).
--
-- A Container realises the MSP -> Tenant -> Container -> Users/Roles hierarchy.
-- It is a plain local grouping node for the platform's OWN `users` and
-- `customer_roles` rows. It is NOT an OU: it has no relationship to
-- `active_directory_ous` / `active_directory_ou_assignments` (Git #1952, real
-- Microsoft Graph objects feeding the standing-policy compliance engine), which
-- this feature does not touch.
--
-- Timestamps use `timestamptz` to match the sibling `active_directory_ous`
-- table and the Drizzle definitions (`timestamp({ withTimezone: true })`),
-- rather than the naive TIMESTAMP shown in the issue body, to avoid the
-- naive-timestamp-vs-timestamptz drift the schema drift-checker flags.

BEGIN;

CREATE TABLE IF NOT EXISTS active_directory_containers (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_directory_containers_tenant_id_idx
  ON active_directory_containers(tenant_id);

-- Nullable membership FK on the platform's own users. ON DELETE SET NULL: a
-- deleted container un-files its members, it does not delete them.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS container_id INTEGER
  REFERENCES active_directory_containers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_container_id_idx ON users(container_id);

-- Same, for per-tenant RBAC roles.
ALTER TABLE customer_roles
  ADD COLUMN IF NOT EXISTS container_id INTEGER
  REFERENCES active_directory_containers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customer_roles_container_id_idx ON customer_roles(container_id);

-- Self-mark this migration as run (Git #497) so Simulator Studio's Migrations
-- tree reflects DB reality regardless of which console ran the file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-active-directory-containers-4497.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

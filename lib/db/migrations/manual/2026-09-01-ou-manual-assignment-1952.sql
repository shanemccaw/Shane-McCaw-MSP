-- #1952 — Policy Engine: OU membership manual override.
--
-- Shane's final decision on #1952 (2026-09-01T17:26:07Z): keep the Graph
-- `department`-field match (artifacts/api-server/src/lib/policy-compliance-graph.ts)
-- as the primary/automatic OU-membership resolution. Add a real manual override
-- for the case Shane confirmed from real usage: most tenants don't populate
-- `department` at all, and where it is set it's often stale. A row here for
-- (customer_id, object_id) is an explicit assignment that WINS over the
-- department-match guess for that object — same "explicit row overrides a
-- derived/computed value" convention as `portal_ownership_assignments`.
--
-- Additive only. New table, no existing column touched. Current-state only, no
-- history table — this is a small admin override, not a RACI audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS active_directory_ou_assignments (
  id                    serial PRIMARY KEY,
  msp_id                integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  ou_id                 integer NOT NULL REFERENCES active_directory_ous(id) ON DELETE CASCADE,
  customer_id           integer NOT NULL,
  tenant_id             text NOT NULL,
  object_id             text NOT NULL,
  object_upn            text NOT NULL,
  object_display_name   text,
  assigned_by_user_id   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT active_directory_ou_assignments_customer_object_uidx UNIQUE (customer_id, object_id)
);

CREATE INDEX IF NOT EXISTS active_directory_ou_assignments_ou_id_idx
  ON active_directory_ou_assignments (ou_id);
CREATE INDEX IF NOT EXISTS active_directory_ou_assignments_customer_id_idx
  ON active_directory_ou_assignments (customer_id);

COMMENT ON TABLE active_directory_ou_assignments IS
  'Manual object-to-OU membership override (#1952). One row per real Graph object '
  '(customer_id, object_id) an admin explicitly placed in an OU. Checked FIRST by '
  'policy-compliance-graph.ts''s resolveOuMembers, ahead of the department-field '
  'match, which remains the automatic fallback for any object with no row here.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'active_directory_ou_assignments'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-01-ou-manual-assignment-1952.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

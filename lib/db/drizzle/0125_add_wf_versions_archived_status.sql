-- wf_versions.status is a TEXT column; "archived" is enforced at the
-- TypeScript/application layer only.  No DDL change is required in PostgreSQL.
-- This migration file exists to keep the Drizzle journal in sync with the
-- schema enum update (added "archived" to ["draft","published","archived"]).
SELECT 1;

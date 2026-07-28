-- Manual Migration: Active Directory Phase 5 — Organizational Unit placeholder objects
-- Target: Postgres database. To be run manually by Shane.
--
-- A real, creatable/browsable OU container node for the Active Directory admin
-- tree (Issue #65). Deliberately no policy columns and no object-to-OU
-- membership model — OU policy semantics are explicitly undefined per Shane,
-- reserved for a future version.

CREATE TABLE IF NOT EXISTS active_directory_ous (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

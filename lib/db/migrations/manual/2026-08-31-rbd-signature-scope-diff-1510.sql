-- #1510 — Risk Register: signature required on scope expansion, never on
-- contraction.
--
-- Additive only. New columns on msp_rbd_versions, no existing column touched;
-- one new table (msp_rbd_narrative_audit).
--
-- Settled architecture (#1487, #1510): nobody consents to being safer.
--   - Additions present in the instance set => a fresh signature is required.
--   - Subtractions only (or no change) => the version being superseded's own
--     signature is INHERITED onto the new version; a version row is still
--     recorded either way.
-- The distinction is DERIVED by comparing risk_instances id sets between a
-- version and the one it supersedes (rbd-versioning.ts's
-- computeRbdScopeDiff) — never a flag a caller sets, so it cannot be gamed.
--
-- A narrative-only revision (hazard text, compensating controls, residual
-- score) with the instance set untouched requires no signature by the letter
-- of the rule — deliberately NOT changed here. msp_rbd_narrative_audit is the
-- interim answer the issue asks for: it makes that drift catchable without
-- adding a signature requirement for it.

BEGIN;

ALTER TABLE msp_rbd_versions
  ADD COLUMN IF NOT EXISTS scope_instance_ids integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_added_instance_ids integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_removed_instance_ids integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signature_inherited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature_inherited_from_version_uid uuid,
  ADD COLUMN IF NOT EXISTS narrative_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS msp_rbd_narrative_audit (
  id                 serial PRIMARY KEY,
  msp_id             integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  rbd_id             text NOT NULL,
  from_version_uid   uuid,
  to_version_uid     uuid NOT NULL,
  changed_fields     jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_rbd_narrative_audit_msp_id_rbd_id_idx ON msp_rbd_narrative_audit (msp_id, rbd_id);
CREATE INDEX IF NOT EXISTS msp_rbd_narrative_audit_to_version_uid_idx ON msp_rbd_narrative_audit (to_version_uid);

COMMENT ON COLUMN msp_rbd_versions.scope_instance_ids IS
  '#1510 — every risk_instances.id this version accepts as in-scope (active '
  'at capture time). Server-derived, never client-supplied. What the '
  'addition/subtraction diff runs on.';
COMMENT ON COLUMN msp_rbd_versions.requires_signature IS
  '#1510 — true when this version''s scope contains an addition (or it is '
  'the first version ever). False = subtraction-only/unchanged scope, '
  'signature inherited automatically.';
COMMENT ON COLUMN msp_rbd_versions.signature_inherited IS
  '#1510 — true when signed/signed_by/signed_at/signature_data were copied '
  'forward from the superseded version rather than captured fresh here.';
COMMENT ON TABLE msp_rbd_narrative_audit IS
  '#1510 — audit trail on narrative/score drift (hazard text, compensating '
  'controls, residual score) between consecutive RBD versions. Interim '
  'answer for the case that deliberately requires no signature.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_rbd_versions'
 ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_rbd_narrative_audit'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-rbd-signature-scope-diff-1510.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

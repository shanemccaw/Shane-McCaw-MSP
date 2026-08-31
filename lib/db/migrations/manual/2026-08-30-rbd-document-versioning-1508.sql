-- #1508 — Risk Register: RBD versioning and the supersession chain.
--
-- Additive only. New table, no existing column touched.
--
-- Settled architecture (#1487, #1508): the RBD is a container (#1509), and it is
-- this container, as a WHOLE document, that is the signed artifact and that
-- versions. Every change produces a new version of the whole document, signed as
-- a whole — the model Shane used at NASA. Line items are content WITHIN a signed
-- version, not independently signed rows.
--
-- Follows `drift_baseline_snapshots`' existing supersession precedent exactly:
-- `superseded_at IS NULL` marks the current version; a prior version is never
-- edited or backfilled once superseded, it only stops being current.
--
-- `content` is untyped jsonb, same as `drift_baseline_snapshots.config` — the
-- line-item shape (#1509), the scope-expansion diff (#1510) and role-based
-- signing authority (#1511) are separate not-yet-built issues. This table is the
-- version/supersession mechanism they attach to, not their content contract.
--
-- `rbd_id` matches `msp_risk_decisions.rbd_id`'s existing convention (e.g.
-- "RBD-..."), the one real container identifier this codebase has today. No FK
-- to `msp_risk_decisions.id` on purpose — see the Drizzle schema header.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_rbd_versions (
  id               serial PRIMARY KEY,
  version_uid      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  msp_id           integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  rbd_id           text NOT NULL,
  tenant_id        text NOT NULL,
  tenant_name      text NOT NULL,
  version_number   integer NOT NULL,
  content          jsonb NOT NULL,
  created_by       jsonb NOT NULL,
  signed           boolean NOT NULL DEFAULT false,
  signed_by        jsonb,
  signed_at        timestamptz,
  superseded_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msp_rbd_versions_msp_id_rbd_id_version_uidx UNIQUE (msp_id, rbd_id, version_number)
);

CREATE INDEX IF NOT EXISTS msp_rbd_versions_msp_id_rbd_id_idx ON msp_rbd_versions (msp_id, rbd_id);
CREATE INDEX IF NOT EXISTS msp_rbd_versions_rbd_id_superseded_idx ON msp_rbd_versions (rbd_id, superseded_at);

COMMENT ON TABLE msp_rbd_versions IS
  'RBD document versioning + supersession chain (#1508). One row per signed '
  'whole-document version of an RBD container. superseded_at IS NULL = current '
  'version, following drift_baseline_snapshots precedent. content is a full '
  'self-contained snapshot, never a pointer to re-read live rows.';
COMMENT ON COLUMN msp_rbd_versions.content IS
  'Untyped jsonb full-document snapshot at capture time (#1508/#1509 — line-item '
  'shape not yet formalized). Never re-derive by re-reading live rows.';
COMMENT ON COLUMN msp_rbd_versions.superseded_at IS
  'NULL = current version. Set once, never edited or backfilled thereafter.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_rbd_versions'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-rbd-document-versioning-1508.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

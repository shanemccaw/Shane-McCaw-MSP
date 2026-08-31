-- #1561 — Security Plan: the assembled view's version/seal chain.
--
-- Additive only. New table, no existing column touched.
--
-- Settled architecture (#1561, #1562): the Security Plan is an assembled VIEW over
-- the other eight modules (Policy #1490, Risk #1487, Ownership #1491, SOPs #1493,
-- Remediation #1489, Change Control #1486, Microsoft Changes #1494). It owns almost
-- no data of its own — only the authored prose and THESE version records. #1562 says
-- this is "the RBD pattern one level up," so this table is deliberately
-- `msp_rbd_versions` with the same supersession mechanism rather than a second
-- sealing/signing stack: `superseded_at IS NULL` marks the current version, and a
-- prior version is never edited or backfilled once superseded.
--
-- `content` is untyped jsonb at the DB layer (its TypeScript shape is
-- `SecurityPlanContent`): a full, self-contained snapshot of the assembled document
-- AS IT WAS at seal time, including the #1565 filter footprint (which filters were
-- applied, what was excluded, a count). A version that re-reads live child rows to
-- render itself is a query, not a signed document — so `content` MUST be the sealed
-- snapshot, never a pointer.
--
-- The container is one Security Plan PER CUSTOMER TENANT, so the chain is keyed on
-- `(msp_id, customer_id)` where `customer_id` is a `tenants.id` — the same id space
-- `portal_security_plans.customer_id` uses. No FK on `customer_id`, matching that
-- table's convention. `signed_by` reuses the `ClientApprover` shape and `created_by`
-- reuses `MspAssessor`, the same JSON shapes `msp_rbd_versions` already writes.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_security_plan_versions (
  id               serial PRIMARY KEY,
  version_uid      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  msp_id           integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id      integer NOT NULL,
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
  CONSTRAINT msp_security_plan_versions_msp_customer_version_uidx UNIQUE (msp_id, customer_id, version_number)
);

CREATE INDEX IF NOT EXISTS msp_security_plan_versions_msp_id_customer_id_idx
  ON msp_security_plan_versions (msp_id, customer_id);
CREATE INDEX IF NOT EXISTS msp_security_plan_versions_customer_superseded_idx
  ON msp_security_plan_versions (customer_id, superseded_at);

COMMENT ON TABLE msp_security_plan_versions IS
  'Security Plan assembled-view version + supersession chain (#1561). One row per '
  'sealed whole-document version of a customer''s Security Plan. superseded_at IS NULL '
  '= current version, following msp_rbd_versions / drift_baseline_snapshots precedent. '
  'content is a full self-contained SecurityPlanContent snapshot incl. the #1565 '
  'filter footprint, never a pointer to re-read live rows.';
COMMENT ON COLUMN msp_security_plan_versions.content IS
  'Untyped jsonb full-document snapshot at seal time (TS shape SecurityPlanContent). '
  'Includes assembled module rows, applied scope (#1563) and filter footprint (#1565).';
COMMENT ON COLUMN msp_security_plan_versions.superseded_at IS
  'NULL = current version. Set once, never edited or backfilled thereafter.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_security_plan_versions'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-security-plan-versioning-1561.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

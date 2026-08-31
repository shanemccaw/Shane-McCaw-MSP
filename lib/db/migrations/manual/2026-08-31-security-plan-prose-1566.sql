-- #1566 — Security Plan: Authored prose — carried forward, versioned with the
-- assembled content.
--
-- Additive only. New table, no existing column touched. `msp_security_plan_versions`
-- (#1561) is untouched — `content` was already untyped jsonb, so widening its
-- TypeScript shape from `prose: string | null` to `prose: SecurityPlanProse | null`
-- needs no DDL; a version sealed before this build simply keeps a legacy string/null
-- prose value in its frozen jsonb, which the code treats as legacy and never rewrites.
--
-- This migration adds the ONE new table #1566 needs: `msp_security_plan_drafts`, the
-- frozen-state holding pen for the issue's fixed authoring sequence — "freeze
-- assembled state -> write/revise prose against that frozen state -> seal and sign as
-- one version." One draft row per Security Plan (msp_id, customer_id). Sealing
-- (POST .../versions) consumes and deletes the draft; the next authoring cycle starts
-- from a fresh freeze.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_security_plan_drafts (
  id               serial PRIMARY KEY,
  msp_id           integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id      integer NOT NULL,
  tenant_id        text NOT NULL,
  tenant_name      text NOT NULL,
  frozen_content   jsonb NOT NULL,
  frozen_at        timestamptz NOT NULL,
  baseline_prose   jsonb NOT NULL,
  prose            jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msp_security_plan_drafts_msp_customer_uidx UNIQUE (msp_id, customer_id)
);

COMMENT ON TABLE msp_security_plan_drafts IS
  'Security Plan prose authoring, frozen-state holding pen (#1566). One row per plan '
  '(msp_id, customer_id) being actively authored. frozen_content is the assembled '
  'document (SecurityPlanContent, prose always null within it) as of the last freeze; '
  'baseline_prose is the carry-forward snapshot captured once at draft creation and '
  'never mutated; prose is the live edit. Sealing a version consumes and deletes this '
  'row via createSecurityPlanVersion''s caller (msp-security-plan.ts POST /versions).';
COMMENT ON COLUMN msp_security_plan_drafts.baseline_prose IS
  'Carried forward from the plan''s last version at draft creation, editedInThisVersion '
  'forced false on every section. Never mutated after creation -- edits in `prose` are '
  'diffed against this to compute editedInThisVersion, not against prose''s own prior value.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_security_plan_drafts'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-security-plan-prose-1566.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

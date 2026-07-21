-- Scope Creep Policies — per-fulfillment-type scoping column.
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Background: scope_creep_policies previously had no fulfillment-type column, so
-- fetchPolicies() in scope-creep-engine.ts returned EVERY active policy for an MSP
-- with no differentiation. A policy named "Retainer Scope Creep Policy" was applied
-- uniformly alongside every other active policy, regardless of what the customer
-- actually purchased. This adds the column that lets the engine scope policy
-- selection to the fulfillment type of the engagement being evaluated.
--
-- Semantics: NULL = applies to ALL fulfillment types (preserves the existing
-- generic catch-all behavior for any policy that does not specify one). A non-NULL
-- value restricts the policy to that single fulfillment type.
--
-- NOTE: existing rows are intentionally NOT backfilled here. Shane will run a
-- follow-up UPDATE mapping each existing policy to its real intended scope (e.g.
-- the ones named "SOW"/"Retainer") — that is a data decision, not this migration's
-- job to guess at. Until then every existing policy keeps fulfillment_type = NULL
-- and continues to apply to all types exactly as before.

-- 1. Add the column (idempotent).
ALTER TABLE scope_creep_policies
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT;

-- 2. Add the CHECK constraint guarding the allowed values (idempotent — guarded so
--    re-running does not error on an already-present constraint). NULL passes the
--    CHECK (SQL CHECK constraints permit NULL unless NOT NULL is also declared).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_creep_policies_fulfillment_type_check'
  ) THEN
    ALTER TABLE scope_creep_policies
      ADD CONSTRAINT scope_creep_policies_fulfillment_type_check
      CHECK (fulfillment_type IN ('assessment', 'monitoring', 'project', 'retainer'));
  END IF;
END $$;

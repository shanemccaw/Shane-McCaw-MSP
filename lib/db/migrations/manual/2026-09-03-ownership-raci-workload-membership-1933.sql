-- Ownership / RACI — per-workload RACI-membership toggle (#1933)
--
-- Correction (Shane, 2026-08-30, see #1933 comment thread): this is NOT a
-- tracking-scope/findings-suppression toggle. Untracking a workload here does
-- not stop scanning, findings, or alerting — it removes the workload from the
-- RACI accountability matrix only (nobody is named A/R/C/I on it). Untracking
-- a still-enabled workload is itself a finding ("disable unused services") —
-- see msp_diagnostic_findings rows with check_key
-- 'governance:untracked-workload:<key>', written by
-- ownership-workload-membership.ts, not by this migration.
--
-- One row per (customer, workload). No row = tracked=true (the default —
-- every existing customer's current behaviour, unchanged until they opt out).
-- Not deletion: toggling back to tracked=true is an update to the same row,
-- so ownership-assignment history on portal_ownership_assignments for this
-- workload's object id survives either way.
--
-- Same shape/convention as portal_ownership_policy (#2162) — no FK, matching
-- every portal-own* table; customer_id is tenants.id straight off the JWT.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).

BEGIN;

CREATE TABLE IF NOT EXISTS portal_ownership_workload_membership (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL,
  workload_key text NOT NULL,
  tracked boolean NOT NULL DEFAULT true,
  updated_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_ownership_workload_membership_customer_workload_idx
  ON portal_ownership_workload_membership (customer_id, workload_key);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-ownership-raci-workload-membership-1933.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

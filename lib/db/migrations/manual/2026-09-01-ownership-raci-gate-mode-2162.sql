-- Ownership / RACI — configurable strict/loose acceptance gate (#2162, redo of #1518)
--
-- #1518 settled the gate itself (whoever is named in R/A must agree, MSP included,
-- symmetric across the tenant boundary) and its schema landed already
-- (2026-08-31-ownership-raci-acceptance-gate-1518.sql — responded_by/responded_at/
-- decline_reason on portal_ownership_assignments). #1518 assumed the gate was
-- mandatory for every cell; Shane's 2026-09-01 decision on #2162 changes that:
-- enforcement is now a per-customer Settings toggle. strict = every A/R cell must
-- be accepted before it counts (#1518's original behaviour). loose = assignment
-- takes effect immediately, no acceptance step (matches current de facto behaviour
-- before this gate existed at all).
--
-- One row per customer, mirroring portal_change_control_policy's shape/convention
-- (id serial pk, customer_id unique, no FK — matching every other portal-own*
-- table). No row for a customer = loose (the default), computed at read time by
-- the application layer rather than backfilled, so this migration is purely
-- additive.
--
-- Additive/reversible per CLAUDE.md. Drizzle schema lives in
-- lib/db/src/schema/msp.ts (hand-written; no drizzle-kit push).

BEGIN;

CREATE TABLE IF NOT EXISTS portal_ownership_policy (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL,
  gate_mode text NOT NULL DEFAULT 'loose',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_ownership_policy_customer_id_idx
  ON portal_ownership_policy (customer_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-01-ownership-raci-gate-mode-2162.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

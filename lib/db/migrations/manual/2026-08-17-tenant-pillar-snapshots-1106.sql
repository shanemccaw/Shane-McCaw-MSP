-- Tenant Pillar Snapshots (#1106, epic #1045) — tenant_pillar_snapshots.
-- Manual migration — review and run by hand (do NOT run drizzle-kit push/push --force).
--
-- Historizes the CUSTOMER-FACING 0-100 pillar DISPLAY scores
-- (getPillarCoverage() / evaluatePillarDisplay()), one row per pillar per real
-- scan, so a customer's real first-scan-to-today pillar trend can be charted.
--
-- Deliberately a SEPARATE table from tenant_engine_snapshots: that one holds
-- raw, unbounded per-engine "Security Risk Points" (#1101) on a different scale
-- with existing raw-score consumers. This holds the normalized 0-100 numbers
-- the PillarGrid / HeroHealthScore / radar actually show.
--
-- Written by:
--   - artifacts/api-server/src/lib/pillar-snapshot.ts capturePillarDisplaySnapshots(),
--     invoked fire-and-forget the moment a scan finishes (the existing
--     diagnostics.run_completed emit in diagnostics-runner.ts), gated on
--     coverageSufficient — never on a dark/partial run, so history never contains
--     fabricated points.
-- Read by:
--   - GET /api/portal/assessment/pillar-history (portal-assessment.ts)
--
-- No backfill: tenants with no snapshots pre-dating this ship honestly render
-- "not enough history yet".

BEGIN;

CREATE TABLE IF NOT EXISTS "tenant_pillar_snapshots" (
  "id" serial PRIMARY KEY,
  -- msps.id, nulled if the MSP is deleted (mirrors tenant_engine_snapshots).
  "msp_id" integer REFERENCES "msps" ("id") ON DELETE SET NULL,
  -- tenants.id — same id-space + no-FK convention as tenant_engine_snapshots.
  "customer_id" integer,
  "pillar_key" text NOT NULL,
  "score" integer NOT NULL DEFAULT 0, -- 0-100 display score
  "previous_score" integer,
  "delta" integer,
  "trend_direction" text,
  "package_key" text,
  "run_id" text,
  "captured_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tenant_pillar_snapshots_customer_pillar_captured_idx"
  ON "tenant_pillar_snapshots" ("customer_id", "pillar_key", "captured_at");

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497) reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-tenant-pillar-snapshots-1106.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Dashboard AI Executive Summary — cache table
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- One cached row per customer, holding the last AI-generated executive summary
-- for their customer_default dashboard. Mirrors the existing OMG-card caching
-- pattern on insights_generated_documents (omg_cards/omg_cards_generated_at) —
-- generated lazily on first request, then reused until stale (see
-- dashboard-executive-summary.ts for the 24h staleness window / manual refresh).

CREATE TABLE IF NOT EXISTS "dashboard_executive_summaries" (
  "id" serial PRIMARY KEY,
  -- tenants.id — no FK by design (msp_customers, this column's original
  -- referent, was dropped in the Tenant/User Refactor, #92). Fixed
  -- 2026-08-09: if this table already exists in a given database (created
  -- before that refactor), its FK constraint was already dropped along with
  -- msp_customers and this edit has no effect there; it only matters for an
  -- environment where this migration has never successfully run.
  "customer_id" integer NOT NULL UNIQUE,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "headline" text NOT NULL DEFAULT '',
  "bullets" jsonb NOT NULL DEFAULT '[]',
  "model" text,
  "generated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "dashboard_executive_summaries_msp_id_idx" ON "dashboard_executive_summaries" ("msp_id");

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-19-dashboard-executive-summaries.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

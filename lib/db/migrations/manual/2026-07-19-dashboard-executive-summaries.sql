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
  "customer_id" integer NOT NULL UNIQUE REFERENCES "msp_customers"("id") ON DELETE CASCADE,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "headline" text NOT NULL DEFAULT '',
  "bullets" jsonb NOT NULL DEFAULT '[]',
  "model" text,
  "generated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "dashboard_executive_summaries_msp_id_idx" ON "dashboard_executive_summaries" ("msp_id");

-- M365 Third-Party SLA Tracking — historical health samples
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- The m365:service-health monitor check (2026-07-20-m365-service-health.sql)
-- is live-fetch-only by design — no per-tenant items are persisted, per its
-- own comment. That's fine for "what's the status right now" on the public
-- status page, but SLA Uptime Percentage tracking needs real history, which
-- doesn't exist anywhere yet. This table is that history: one row per
-- (tenant, service) per hourly sample, populated by the new
-- "__system__: M365 Service Health Sampling" seeded workflow.
--
-- status stores the raw Graph serviceHealthStatus enum value (not the
-- sanitized 3-value public-status.ts enum) so sla-uptime.ts can apply its own
-- up/down judgment independently of the public page's healthy/degraded/
-- interruption mapping.

CREATE TABLE IF NOT EXISTS "m365_service_health_samples" (
  "id" SERIAL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "msp_id" INTEGER NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "customer_id" INTEGER REFERENCES "msp_customers"("id") ON DELETE SET NULL,
  "service" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sampled_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "m365_service_health_samples_service_sampled_idx"
  ON "m365_service_health_samples" ("service", "sampled_at");

CREATE INDEX IF NOT EXISTS "m365_service_health_samples_tenant_service_sampled_idx"
  ON "m365_service_health_samples" ("tenant_id", "service", "sampled_at");

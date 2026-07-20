-- Platform Incidents — manual incident-history log backing the Public Status Page.
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- PlatformAdmin-authored only: rows are created/updated by hand via the admin
-- Incidents page when something breaks. Nothing in the codebase auto-inserts
-- into this table from health/monitoring signals — that's a deliberate scope
-- boundary for this task, not an oversight.
--
-- Consumed by:
--   - GET /api/status (public, unauthenticated) — last 90 days, most recent first
--   - Admin Incidents CRUD page (PlatformAdmin only)

CREATE TABLE IF NOT EXISTS "platform_incidents" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "severity" text NOT NULL CHECK ("severity" IN ('minor', 'major', 'critical')),
  "status" text NOT NULL DEFAULT 'investigating' CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved')),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_incidents_started_at_idx" ON "platform_incidents" ("started_at");
CREATE INDEX IF NOT EXISTS "platform_incidents_status_idx" ON "platform_incidents" ("status");

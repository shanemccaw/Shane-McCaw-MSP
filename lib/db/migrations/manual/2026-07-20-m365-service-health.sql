-- M365 Service Health monitor check (Public Status Page — second tab)
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- New monitor_checks row only (no new table). public-status.ts does its own
-- live Graph fetch against this check's endpoint for Shane's own tenant
-- (isDirectBusiness MSP's non-testbed customer), sanitizes each service's
-- status down to healthy/degraded/interruption, and returns it inline on the
-- public GET /api/status response — no per-tenant items are persisted, so
-- (unlike m365:message-center) this check has no companion items table.
--
-- Field names verified against Microsoft's current Graph v1.0 docs
-- (serviceHealth resource / list-healthOverviews): id, service, status.
-- status is the serviceHealthStatus enum: serviceOperational, investigating,
-- restoringService, verifyingService, serviceRestored,
-- postIncidentReviewPublished, serviceDegradation, serviceInterruption,
-- extendedRecovery, falsePositive, investigationSuspended, resolved,
-- mitigatedExternal, mitigated, resolvedExternal, confirmed, reported,
-- unknownFutureValue.

INSERT INTO "monitor_checks" (
  "key", "label", "description", "endpoint", "method",
  "properties", "mapping", "severity_rules", "engines",
  "frequency", "requires_customer_script", "status"
) VALUES (
  'm365:service-health',
  'M365 Service Health',
  'Current per-service Microsoft 365 health status (Exchange Online, Teams, SharePoint, etc.) for the Public Status Page''s M365 Service Health tab. Read live at request time by public-status.ts, not aggregated by the generic monitor-executor pipeline — this row only supplies the DB-driven endpoint/config.',
  '/admin/serviceAnnouncement/healthOverviews',
  'GET',
  '["id", "service", "status"]',
  '[]',
  '[]',
  '[]',
  'hourly',
  FALSE,
  'active'
)
ON CONFLICT ("key") DO NOTHING;

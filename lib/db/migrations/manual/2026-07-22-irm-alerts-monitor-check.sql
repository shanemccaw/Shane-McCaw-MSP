-- Insider Risk Management (IRM) Alerts — Real Monitor Check via alerts_v2 Reuse
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Reuses the existing, already-integrated Microsoft Graph /security/alerts_v2
-- endpoint (same client/auth wiring as every other check: graphFetchForTenant /
-- graphFetchPaginated in monitor-executor.ts / graph.ts) and the scope this
-- platform already requests (SecurityEvents.Read.All, REQUIRED_MT_SCOPES in
-- graph.ts). No second Graph integration path — this is one new declarative
-- monitor_checks row, following the same DB-driven convention established by
-- m365:service-health and m365:message-center.
--
-- Field verified against Microsoft's current Graph v1.0 docs (alert resource /
-- detectionSource enum, learn.microsoft.com/en-us/graph/api/resources/security-detectionsource):
-- the `detectionSource` enum member for Insider Risk Management alerts is the
-- literal string `microsoftInsiderRiskManagement` ("Microsoft Insider Risk
-- Management."). detectionSource is an evolvable enum — Graph will not return
-- this member (it comes back as `unknownFutureValue`) unless the request sends
-- `Prefer: include-unknown-enum-members`. The companion code change in
-- monitor-executor.ts's graphFetchPaginated() adds that header specifically for
-- GET requests against /security/alerts_v2, so this check actually resolves
-- real IRM alerts instead of silently seeing none.
--
-- Server-side $filter on detectionSource means `_itemCount` (stamped by
-- applyMapping()) IS the real IRM alert count for the tenant — no mapping rule
-- needed for the core "any IRM alert?" signal; signal_derivation_rules uses the
-- existing `threshold` rule type against `<checkKey>__itemCount`, exactly like
-- other item-count-driven signals (see tenant-signals.ts evaluateRule()).
-- properties + one severityRule are added anyway for admin dashboard visibility
-- (mirrors security:active-alerts' shape) and to surface high-severity IRM
-- alerts distinctly.
--
-- KNOWN PLATFORM-WIDE BLOCKER (pre-existing, not introduced or fixed here): a
-- monitor_checks row only executes for a tenant once it's attached to a
-- monitoring package via monitoring_package_checks — and that junction table is
-- confirmed empty platform-wide (see 2026-07-21-monitoring-package-checks-DIAGNOSTIC.sql
-- and 2026-07-21-repopulate-monitoring-package-checks.sql). This row ships ready
-- to run the moment Shane curates monitoring_package_checks (e.g. attaches
-- 'security:insider-risk-alerts' to core:security-baseline) — that curation is
-- Shane's manual call per the existing convention, not something this migration
-- does on his behalf.
--
-- Safe to run repeatedly: ON CONFLICT (key) DO NOTHING.

INSERT INTO "monitor_checks" (
  "key", "label", "description", "endpoint", "method",
  "properties", "mapping", "severity_rules", "engines",
  "frequency", "requires_customer_script", "status"
) VALUES (
  'security:insider-risk-alerts',
  'Insider Risk Management Alerts',
  'Detects genuine Microsoft Purview Insider Risk Management alerts via the Graph alerts_v2 endpoint, server-side filtered to detectionSource = microsoftInsiderRiskManagement. Distinct from the generic security:active-alerts check, which is not IRM-scoped.',
  '/security/alerts_v2?$filter=detectionSource eq ''microsoftInsiderRiskManagement''&$select=id,title,severity,status,detectionSource,createdDateTime,classification',
  'GET',
  '["id", "title", "severity", "status"]',
  '[]',
  '[{"expression": "{{id_count}} > 0", "severity": "warning", "label": "Insider Risk Management alert(s) detected"}, {"expression": "{{severity_values}} contains high", "severity": "critical", "label": "High-severity Insider Risk Management alert detected"}]',
  '["security"]',
  'daily',
  FALSE,
  'active'
)
ON CONFLICT ("key") DO NOTHING;

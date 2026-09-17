-- #4503 — identity:app-proxy-connector-groups fires its 0-groups info finding on
-- every tenant that has never enabled Application Proxy at all, since Graph
-- app-only access to the connectorGroups collection is undocumented and this
-- platform scans app-only. Gate the check on the tenant's real
-- applicationProxy.isEnabled singleton (which reads fine app-only, confirmed
-- live on the testbed) so a tenant with App Proxy disabled gets no finding.
--
-- New columns (monitor_checks.gate_endpoint / gate_expression, additive, NULL for
-- every other check): the executor fetches gate_endpoint first and evaluates
-- gate_expression (the same condition grammar severity_rules already use)
-- against its response; a false gate skips the check's own endpoint fetch and
-- severity evaluation entirely, persisting status='ok', severityMatched=null.

ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS gate_endpoint text;
ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS gate_expression text;

UPDATE monitor_checks SET
  gate_endpoint = 'https://graph.microsoft.com/beta/onPremisesPublishingProfiles/applicationProxy',
  gate_expression = '{{isEnabled}} == true',
  updated_at = now()
 WHERE key = 'identity:app-proxy-connector-groups';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4503-app-proxy-connector-groups-gate.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

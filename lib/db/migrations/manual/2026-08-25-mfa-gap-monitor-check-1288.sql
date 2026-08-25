-- #1288 — Detector: finding.mfa_gap
-- Adds a dedicated MFA monitor check (identity:privileged-mfa-gap) that produces
-- real msp_diagnostic_findings for privileged/user accounts without a registered
-- MFA method, off Graph GET /reports/authenticationMethods/userRegistrationDetails
-- (the same endpoint identity:mfa-registration / identity:mfa-method-breakdown
-- already use). Distinguishes privileged (isAdmin) accounts at "critical" from
-- ordinary member accounts at "warning" — identity:mfa-registration only ever
-- produced one undifferentiated "warning" count and is left unchanged so its
-- existing scoring/engine wiring doesn't shift.
--
-- Then wires the customer_tenant_alert_rules "finding.mfa_gap" catalog row
-- (seeded pending_detector/disabled by #1278, lib/db/migrations/manual/
-- 2026-08-25-customer-tenant-alert-rules-1278.sql) to this check's key and
-- flips it live/enabled, mirroring finding.ownerless_group's shape.

BEGIN;

INSERT INTO monitor_checks (
  key, label, description, endpoint, method,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script, status, executor_type
) VALUES (
  'identity:privileged-mfa-gap',
  'Privileged Account MFA Gap',
  'Privileged (admin) and standard member accounts without a registered MFA method.',
  '/reports/authenticationMethods/userRegistrationDetails',
  'GET',
  '["id","isMfaRegistered","isAdmin","userType"]'::jsonb,
  '[
    {
      "sourceField": "value",
      "targetField": "privilegedMfaGapCount",
      "transform": "countWhere(''{{isAdmin}} == true && {{isMfaRegistered}} == false'')"
    },
    {
      "sourceField": "value",
      "targetField": "memberMfaGapCount",
      "transform": "countWhere(''{{isMfaRegistered}} == false && {{userType}} == \"Member\"'')"
    }
  ]'::jsonb,
  '[
    {
      "severity": "critical",
      "expression": "privilegedMfaGapCount > 0",
      "label": "{{privilegedMfaGapCount}} privileged admin account(s) do not have MFA registered"
    },
    {
      "severity": "warning",
      "expression": "memberMfaGapCount > 0",
      "label": "{{memberMfaGapCount}} user account(s) do not have MFA registered"
    }
  ]'::jsonb,
  '["priority","security"]'::jsonb,
  'daily',
  false,
  'active',
  'graph'
)
ON CONFLICT (key) DO NOTHING;

-- Run it in the same packages identity:pim-permanent-roles (the other
-- privileged-account detector) already runs in, appended after that package's
-- current last sort_order.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT v.package_key, 'identity:privileged-mfa-gap',
  COALESCE((SELECT MAX(mpc2.sort_order) FROM monitoring_package_checks mpc2 WHERE mpc2.package_key = v.package_key), 0) + 1
FROM (VALUES
  ('core:foundation'),
  ('core:security-baseline'),
  ('core:enhanced-monitoring'),
  ('core:growth'),
  ('core:premier'),
  ('detail:full-item-collection'),
  ('assess:copilot-readiness')
) AS v(package_key)
WHERE EXISTS (SELECT 1 FROM monitor_checks c WHERE c.key = 'identity:privileged-mfa-gap' AND c.status = 'active')
ON CONFLICT (package_key, check_key) DO NOTHING;

UPDATE customer_tenant_alert_rules
SET detector_status = 'live',
    enabled = true,
    source = 'identity:privileged-mfa-gap monitor check (#1288)',
    updated_at = now()
WHERE rule_key = 'finding.mfa_gap';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-mfa-gap-monitor-check-1288.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

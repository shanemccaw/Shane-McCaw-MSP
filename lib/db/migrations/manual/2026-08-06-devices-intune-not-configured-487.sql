-- ============================================================================
-- Devices/Intune checks — zero-device "MDM not configured" finding (#487)
-- Manual — run by hand, not drizzle-kit. No DATABASE_URL in this environment.
-- ============================================================================
--
-- CONTEXT: the code half of #487 is already landed
-- (artifacts/api-server/src/lib/monitor-executor.ts,
-- isIntuneServiceNotConfiguredError). Real error bodies pulled from
-- sqloutput.json (statement 1, the platform-wide 40-failing-checks dump,
-- grouped/normalized per check_key) resolved to exactly THREE distinct wire
-- signatures across the 8 checks below, none of them license/SKU signals:
--   1. 401 "DeviceFE/StatelessDeviceFEService" — devices:encryption-status,
--      devices:os-patch-compliance, devices:enrollment-status,
--      devices:compliant-vs-noncompliant (all four call
--      /deviceManagement/managedDevices).
--   2. 400 "Resource not found for the segment
--      'windowsAutopilotDeploymentProfiles'" — devices:autopilot-coverage.
--   3. 503 raw IIS "Service Unavailable" HTML — devices:app-protection-coverage,
--      devices:compliance-policy-coverage, devices:update-rings-config.
-- All three are documented Intune-backend artifacts of a tenant whose MDM
-- authority has never been set. Contrasted against devices:bitlocker-key-escrow
-- in the SAME sample pull, which shows a completely different, clean 403
-- `authorization_error` body ("token doesn't have the required permissions") —
-- a genuine permission bug, left untouched, and proof these 8 aren't that.
-- Per Shane's note on the issue, this test tenant's Microsoft 365 E3 already
-- includes Intune — the SKU is present, it has simply never been
-- enrolled/configured — so NONE of these 8 are license_gap (scenario 1 from
-- the issue). This is scenario (2): the check now runs to completion and
-- persists a real `status: 'ok'`, `itemCount: 0` row, but every one of these
-- checks currently has an EMPTY severity_rules array (never having had a
-- chance to fire — they always errored before reaching classification), so
-- absent this migration a genuine zero-device tenant would fall through to
-- the generic "ok" / "Check passed" and the real "no MDM configured" gap
-- would go unreported, exactly the "quietly disappears" failure #470 already
-- named for a different pair of checks.
--
-- VERIFY FIRST (uncomment and run before applying the UPDATEs below) — this
-- migration prepends a rule via `jsonb` concatenation specifically so it does
-- NOT need to know each check's current severity_rules content, but it is
-- still worth confirming per Shane's own established pattern (#470) that
-- these are indeed empty/never-fired arrays and not something already
-- authored that this would now shadow:
--
-- SELECT key, severity_rules
-- FROM monitor_checks
-- WHERE key IN (
--   'devices:encryption-status', 'devices:os-patch-compliance',
--   'devices:autopilot-coverage', 'devices:enrollment-status',
--   'devices:app-protection-coverage', 'devices:compliance-policy-coverage',
--   'devices:update-rings-config', 'devices:compliant-vs-noncompliant'
-- );
--
-- Each UPDATE PREPENDS a `_itemCount == 0` rule (via `new_rule || severity_rules`,
-- so it is evaluated FIRST by classifySeverity's in-order loop, and existing
-- rules — if any — are preserved untouched after it) rather than replacing the
-- column outright. `_itemCount` (not a check-specific bad-count field like
-- unencryptedDeviceCount) is deliberate: those fields are 0 both when zero
-- devices are enrolled AND when many devices are enrolled and all compliant —
-- collapsing those two very different states into one rule would misreport a
-- genuinely healthy fleet as "no MDM configured". `_itemCount` is the raw
-- Graph item count set by every check (monitor-executor.ts's applyMapping),
-- so it is the one property that means "the collection itself was empty."

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No devices are enrolled in Intune management — device encryption status cannot be verified or enforced for this tenant"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:encryption-status';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No devices are enrolled in Intune management — OS patch compliance cannot be verified or enforced for this tenant"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:os-patch-compliance';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No Windows Autopilot deployment profiles are configured — new devices are not being automatically enrolled and provisioned through Intune"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:autopilot-coverage';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No devices are enrolled in Intune management — mobile device management (MDM) has not been configured for this tenant"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:enrollment-status';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No app protection (MAM) policies are configured in Intune — data on mobile devices is not protected at the application level"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:app-protection-coverage';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No device compliance policies are configured in Intune — device compliance cannot be enforced or verified for this tenant"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:compliance-policy-coverage';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No Windows Update for Business deployment rings are configured — update rollout is not being managed through Intune"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:update-rings-config';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "_itemCount == 0",
    "label": "No managed devices are enrolled — compliant/non-compliant device counts cannot be computed because Intune MDM has not been configured for this tenant"
  }
]'::jsonb || COALESCE(severity_rules, '[]'::jsonb),
    updated_at = now()
WHERE key = 'devices:compliant-vs-noncompliant';

-- Verify: expect the new "_itemCount == 0" rule first in each array, any
-- pre-existing rules preserved after it, endpoint/status unchanged.
SELECT key, endpoint, severity_rules
FROM monitor_checks
WHERE key IN (
  'devices:encryption-status', 'devices:os-patch-compliance',
  'devices:autopilot-coverage', 'devices:enrollment-status',
  'devices:app-protection-coverage', 'devices:compliance-policy-coverage',
  'devices:update-rings-config', 'devices:compliant-vs-noncompliant'
)
ORDER BY key;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-devices-intune-not-configured-487.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- ============================================================================
-- #4556 -- monitor_checks.required_service_plans was ANY-OF only, so
-- identity:ca-device-compliance could express "P1 or P2" but not "(P1 or P2)
-- AND Intune", even though the compliantDevice grant it measures can never be
-- satisfied without Intune (no MDM to mark a device compliant). A tenant with
-- P1 but no Intune passed the license gate and ran the real policy read
-- instead of reporting the real license gap.
-- ============================================================================
-- Additive, idempotent: one UPDATE of the monitor_checks row by key, guarded
-- on the current flat-array value so a re-run after this migration has
-- already landed is a no-op. No new column -- required_service_plans now
-- accepts a nested string[][] (AND-of-OR) alongside the existing flat
-- string[] (ANY-OF) shape; see license-gate.ts tenantHasRequiredLicense.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
-- required_service_plans: ["AAD_PREMIUM","AAD_PREMIUM_P2"]
--                       -> [["AAD_PREMIUM","AAD_PREMIUM_P2"],["INTUNE_A"]]
-- Two AND'd groups: (P1 or P2) AND (Intune). INTUNE_A is the real Graph
-- servicePlanName for Intune Plan 1, provisioned identically whether it ships
-- standalone or bundled (EMS, SPE_E3/E5, Business Premium) -- unlike the
-- skuPartNumber, the servicePlanName Graph reports on /subscribedSkus does
-- not vary by which bundle carries it, so a single name covers every case.
-- ============================================================================

UPDATE monitor_checks
SET
  required_service_plans = '[["AAD_PREMIUM","AAD_PREMIUM_P2"],["INTUNE_A"]]'::jsonb,
  description = 'Whether an ENABLED Conditional Access policy requires device compliance in its grant controls (#4534, same mechanism as #4512). '
    || 'Report-only and disabled policies, and policies granting on other controls without compliantDevice, do not count. '
    || 'Reported as a license gap without Entra ID P1/P2 AND Intune (#4556) -- compliantDevice can never be satisfied without Intune to mark a device compliant. '
    || 'Not suppressed by Security Defaults, which does not enforce device compliance.',
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:ca-device-compliance'
  AND required_service_plans = '["AAD_PREMIUM","AAD_PREMIUM_P2"]'::jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-ca-device-compliance-all-of-intune-4556.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

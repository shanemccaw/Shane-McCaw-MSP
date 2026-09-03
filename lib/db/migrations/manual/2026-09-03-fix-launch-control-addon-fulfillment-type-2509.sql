-- Git #2509.
--
-- services.fulfillmentType is a strict binary enum ("standard" |
-- "msp_monthly_subscription") reserved exclusively for genuine MSP platform
-- subscription tiers (see lib/db/src/schema/index.ts around the fulfillment_type
-- column, and productTypeConfig.ts's platform_subscription_tier -> fulfillment
-- type mapping). Row 131 (launch-control-plus-addon, "M365 Launch Control —
-- Plus Add-On") is not a platform tier — its type_attributes mark it as an
-- add-on capability grant (addOnType: "launch_control_capability",
-- requiresMinPlatformTier: "growth") — but its fulfillment_type column was
-- literally set to "msp_monthly_subscription", so it satisfied
-- GET /api/msp/signup/tiers' primary WHERE arm directly (not just the
-- fulfillmentTypeKey safety-net arm the three real tiers rely on) and leaked
-- into MSP self-service signup as if it were a fourth platform tier.
--
-- Correcting it to "standard" removes it from both the tiers listing and the
-- POST /api/msp/signup/start acceptance check (msp-signup.ts), which gate on
-- the same two columns. Purely a data correction — no schema change.
UPDATE services
SET fulfillment_type = 'standard'
WHERE id = 131
  AND slug = 'launch-control-plus-addon'
  AND fulfillment_type = 'msp_monthly_subscription';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-fix-launch-control-addon-fulfillment-type-2509.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

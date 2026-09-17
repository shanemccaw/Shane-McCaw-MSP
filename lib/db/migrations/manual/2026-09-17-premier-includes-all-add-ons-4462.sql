-- Git #4462 — Premier includes every add-on (Shane's decision on #4463), and a
-- non-Premier tenant can now actually buy one.
--
-- Part 1 — remove the doc-only `change_control` entry from monitoring_tier
-- includedFeatures. 2026-09-05-portal-tier-included-features-1168.sql added it
-- to Premier "for documentation only" while the real gate
-- (requireAddOnEntitlement) ignored it. As of #4462 that gate passes a Premier
-- tenant for EVERY add-on key by tier identity (services.tier = 'premier'), so a
-- per-key entry in the tier-MODULE list implied a narrower model than the one
-- enforced. includedFeatures itself stays: it is still the real list the
-- tier-module gate (requireTierFeature / requireAccess) reads.
--
-- Part 2 — purchase provenance on tenant_add_on_entitlements. A paid portal
-- add-on checkout (routes/portal-add-ons.ts) records the Stripe Checkout
-- Session that provisioned the row and the subscription it created, so a
-- cancellation can find the entitlement it should end. Both nullable: the
-- table predates purchases.
--
-- Additive and idempotent: re-running removes nothing further and adds nothing twice.

BEGIN;

UPDATE services
SET type_attributes = jsonb_set(
  type_attributes,
  '{includedFeatures}',
  COALESCE(
    (
      SELECT jsonb_agg(feature)
      FROM jsonb_array_elements(type_attributes->'includedFeatures') AS feature
      WHERE feature <> '"change_control"'::jsonb
    ),
    '[]'::jsonb
  )
)
WHERE service_type = 'monitoring_tier'
  AND jsonb_typeof(type_attributes->'includedFeatures') = 'array'
  AND type_attributes->'includedFeatures' @> '["change_control"]'::jsonb;

ALTER TABLE tenant_add_on_entitlements ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
ALTER TABLE tenant_add_on_entitlements ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-premier-includes-all-add-ons-4462.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verification:
-- SELECT slug FROM services WHERE service_type = 'monitoring_tier' AND type_attributes->'includedFeatures' @> '["change_control"]';  -- expect 0 rows
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tenant_add_on_entitlements' AND column_name LIKE 'stripe_%';  -- expect 2

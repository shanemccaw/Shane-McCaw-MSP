-- Git #4036 — MSP add-on subscriptions (e.g. Launch Control Plus).
--
-- msp_subscriptions has UNIQUE(msp_id) by design — one base platform tier per MSP,
-- and loadTier() (artifacts/api-server/src/lib/msp-entitlement.ts) relies on that
-- shape. An add-on row like services.id=131 ("M365 Launch Control — Plus Add-On",
-- typeAttributes.grantsCapabilityKey = "launch_control_plus") has nowhere to be
-- recorded alongside the base subscription. This table is separate and additive:
-- no change to msp_subscriptions, its unique constraint, or its tier-resolution
-- logic.
--
-- Deliberately many-to-many capable: no UNIQUE(msp_id), and no UNIQUE(msp_id,
-- service_id) either, so an MSP can hold multiple simultaneous add-ons (only one
-- exists today) and re-subscribing to the same add-on after a cancel inserts a
-- fresh row rather than fighting a stale one for the update.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_addon_subscriptions (
  id          serial PRIMARY KEY,
  msp_id      integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  -- References services.id (the Product Catalog add-on row). Not a TS-level FK
  -- for the same cross-schema-file reason msp_subscriptions.service_id isn't —
  -- enforced here at DB level instead.
  service_id  integer NOT NULL REFERENCES services(id),
  -- Same status vocabulary as msp_subscriptions.status (trialing/active/past_due/canceled/unpaid).
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_addon_subscriptions_msp_id_idx     ON msp_addon_subscriptions (msp_id);
CREATE INDEX IF NOT EXISTS msp_addon_subscriptions_service_id_idx ON msp_addon_subscriptions (service_id);
CREATE INDEX IF NOT EXISTS msp_addon_subscriptions_status_idx     ON msp_addon_subscriptions (status);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-msp-addon-subscriptions-4036.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

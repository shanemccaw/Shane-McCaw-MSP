-- Manual Migration: Active Directory Phase 7 — per-user entitlement overrides
-- Target: Postgres database. To be run manually by Shane.
--
-- Phase 2's deriveEntitlements() derives entitlements purely from the linked
-- MSP's subscription tier (servicesTable.typeAttributes.tierCapabilities) —
-- there was no per-user override concept anywhere in the schema before this.
-- Issue #67 requires PlatformAdmin to grant/revoke INDIVIDUAL entitlements on
-- one account, so this adds the smallest table that can express that: one row
-- per (user, capability key) the account's inherited tier value is overridden
-- for. Only the boolean tierCapabilities map is overridable here — numeric
-- allowances (tenantAllowance/aiCreditAllowance/overageRateCents) stay purely
-- tier-inherited, since Issue #67 talks about discrete "individual
-- entitlements", not numeric quota overrides.

CREATE TABLE IF NOT EXISTS user_entitlement_overrides (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_entitlement_overrides_user_capability_uniq
  ON user_entitlement_overrides (user_id, capability_key);

CREATE INDEX IF NOT EXISTS user_entitlement_overrides_user_id_idx
  ON user_entitlement_overrides (user_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-28-user-entitlement-overrides.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

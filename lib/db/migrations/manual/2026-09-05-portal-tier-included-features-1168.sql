-- #1168: populate real services.type_attributes.includedFeatures for all
-- Foundation/Growth/Premier monitoring_tier rows with the 10 operational
-- module keys from lib/portal-tier-features.ts (PORTAL_TIER_MODULE_KEYS).
--
-- Foundation and Growth previously carried `[]`; Premier carried only 2
-- generic report-name strings (kept, not removed — unrelated to this gate,
-- see portal-tier-features.ts header). Cumulative ladder, per #1168's mapping
-- confirmed by Shane:
--
--   Foundation: policy_decisions, risk_register
--   Growth:     + runbooks, remediation_tracking, sops_runbooks, message_center
--   Premier:    + change_control (doc-only, real gate is the add-on
--               entitlement table per #1173), ownership, security_plan,
--               pii_governance
--
-- Additive jsonb merge via `||` on an object built from the existing array
-- plus the new keys — existing entries (report-name strings, capability
-- flags) are preserved, not overwritten. Idempotent: re-running only ever
-- produces the same de-duplicated union.

UPDATE services
SET type_attributes = jsonb_set(
  COALESCE(type_attributes, '{}'::jsonb),
  '{includedFeatures}',
  (
    SELECT jsonb_agg(DISTINCT feature)
    FROM jsonb_array_elements_text(
      COALESCE(type_attributes->'includedFeatures', '[]'::jsonb)
      || '["policy_decisions", "risk_register"]'::jsonb
    ) AS feature
  )
)
WHERE service_type = 'monitoring_tier' AND tier = 'foundation';

UPDATE services
SET type_attributes = jsonb_set(
  COALESCE(type_attributes, '{}'::jsonb),
  '{includedFeatures}',
  (
    SELECT jsonb_agg(DISTINCT feature)
    FROM jsonb_array_elements_text(
      COALESCE(type_attributes->'includedFeatures', '[]'::jsonb)
      || '["policy_decisions", "risk_register", "runbooks", "remediation_tracking", "sops_runbooks", "message_center"]'::jsonb
    ) AS feature
  )
)
WHERE service_type = 'monitoring_tier' AND tier = 'growth';

UPDATE services
SET type_attributes = jsonb_set(
  COALESCE(type_attributes, '{}'::jsonb),
  '{includedFeatures}',
  (
    SELECT jsonb_agg(DISTINCT feature)
    FROM jsonb_array_elements_text(
      COALESCE(type_attributes->'includedFeatures', '[]'::jsonb)
      || '["policy_decisions", "risk_register", "runbooks", "remediation_tracking", "sops_runbooks", "message_center", "change_control", "ownership", "security_plan", "pii_governance"]'::jsonb
    ) AS feature
  )
)
WHERE service_type = 'monitoring_tier' AND tier = 'premier';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-05-portal-tier-included-features-1168.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

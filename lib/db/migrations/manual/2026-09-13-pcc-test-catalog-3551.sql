-- Git #3551 — real table for the PCC test catalog.
--
-- Replaces the static in-memory DEFAULT_TESTS array
-- (artifacts/api-server/src/lib/pcc/taxonomy-catalog.ts) that GET /api/pcc/catalog
-- and PccTestRunner.runSuite read directly. Seeded from that exact array so the
-- catalog's real content is unchanged; the source of truth moves from application
-- code to this table.

CREATE TABLE IF NOT EXISTS pcc_test_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  taxonomy TEXT NOT NULL,
  description TEXT NOT NULL,
  is_prod_safe BOOLEAN NOT NULL DEFAULT false,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcc_test_catalog_taxonomy_idx ON pcc_test_catalog (taxonomy);

INSERT INTO pcc_test_catalog (id, name, taxonomy, description, is_prod_safe, dependencies, tags)
VALUES
  ('drift-detect-settings', 'Tenant Settings Drift Check', 'ConfigDrift',
   'Compares target tenant environment configuration against the reference baseline.',
   true, '[]'::jsonb, '["drift", "configuration", "smoke"]'::jsonb),

  ('graph-user-read', 'Microsoft Graph User Directory Endpoint Test', 'GraphEndpoint',
   'Queries Graph user endpoint and validates schema compliance.',
   true, '[]'::jsonb, '["graph", "directory", "smoke"]'::jsonb),

  ('graph-license-check', 'Microsoft Graph License Inactivity Check', 'GraphEndpoint',
   'Validates that licensing signals are accurately mapped from user sign-in details.',
   true, '["graph-user-read"]'::jsonb, '["graph", "licensing", "regression"]'::jsonb),

  ('event-stripe-checkout', 'Stripe Webhook Event Injection', 'EventInjection',
   'Simulates a Stripe checkout completion webhook delivery.',
   false, '[]'::jsonb, '["stripe", "billing", "destructive"]'::jsonb),

  ('event-consent-grant', 'Consent Granted Action Injection', 'EventInjection',
   'Simulates a user accepting policy terms.',
   false, '[]'::jsonb, '["consent", "compliance", "destructive"]'::jsonb),

  ('ui-banner-check', 'System Alert Banner Visibility Test', 'UISurface',
   'Verifies warning banner positioning and copy drift.',
   true, '[]'::jsonb, '["ui", "banner", "smoke"]'::jsonb),

  ('ui-onboarding-nudge', 'Onboarding User Nudge Bubble Test', 'UISurface',
   'Validates the presence and styling of client onboarding prompts.',
   true, '["event-consent-grant"]'::jsonb, '["ui", "nudge", "regression"]'::jsonb),

  ('journey-90day-replay', '90-Day Tenant Journey Lifecycle Replay', 'JourneyReplay',
   'Replays a sequence of customer lifecycle ticks and asserts state trends.',
   false, '["event-stripe-checkout"]'::jsonb, '["replay", "temporal", "destructive"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-pcc-test-catalog-3551.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

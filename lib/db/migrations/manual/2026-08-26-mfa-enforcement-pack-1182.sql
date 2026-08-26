-- 2026-08-26-mfa-enforcement-pack-1182.sql
-- Git #1182 — MFA Enforcement Pack.
--
-- Builds the real per-user MFA *enforcement* write-action template and assembles
-- the sellable pack (config_packs + config_pack_templates + services row), the
-- same pattern the other config packs use (#1172).
--
-- Design note (the issue's core question): action.require-security-info-
-- reregistration (already real, used in the Identity Hygiene Pack) forces a user
-- to re-register their security info, but it does NOT make MFA *required* for the
-- account — an account "quietly sitting outside the policy today" would re-enroll
-- yet stay unenforced. Genuine per-user enforcement uses a distinct, real Graph
-- API: PATCH /users/{id}/authentication/requirements with perUserMfaState =
-- "enforced". So this pack adds a dedicated enforcement template AND reuses the
-- reregistration template for the forced-enrollment step. Verification is wired
-- via the existing identity:mfa-registration monitor check
-- (config_pack_templates.check_key), which reads
-- /reports/authenticationMethods/userRegistrationDetails.

BEGIN;

-- 1. New write-action template: enforce per-user MFA state (perUserMfaState).
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method,
   body_template, required_variables, success_criteria, depends_on,
   requires_verification_gate, reversible, status)
VALUES
  ('action.enforce-per-user-mfa',
   'Enforce Per-User MFA',
   'Sets the account''s per-user MFA state to enforced via the real Graph authentication/requirements API, so multi-factor auth is genuinely required at sign-in — not merely registered.',
   'identity',
   '/users/{{userId}}/authentication/requirements',
   'PATCH',
   '{"perUserMfaState": "enforced"}'::jsonb,
   '["userId"]'::jsonb,
   '{"expectStatus": 204}'::jsonb,
   '[]'::jsonb,
   true,   -- requires_verification_gate: enforcement gets a verification gate before it fires
   false,  -- reversible
   'active')
ON CONFLICT (template_id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  endpoint = EXCLUDED.endpoint,
  method = EXCLUDED.method,
  body_template = EXCLUDED.body_template,
  required_variables = EXCLUDED.required_variables,
  success_criteria = EXCLUDED.success_criteria,
  requires_verification_gate = EXCLUDED.requires_verification_gate,
  updated_at = now();

-- 2. The pack row.
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('mfa-enforcement-v1',
   'MFA Enforcement Pack',
   'Real per-user MFA enforcement — every account enrolled and set to enforced, including the ones quietly sitting outside the policy today.',
   ARRAY['Security', 'Identity'],
   'active')
ON CONFLICT (pack_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  categories = EXCLUDED.categories,
  status = EXCLUDED.status,
  updated_at = now();

-- 3. Pack template links. Idempotent: clear this pack's links, then re-insert.
--    Order: force re-registration (enrollment) first, then enforce per-user MFA.
--    The enforcement step carries the identity:mfa-registration verification check
--    and is the one flagged requires_verification_gate.
DELETE FROM config_pack_templates
WHERE pack_id = (SELECT id FROM config_packs WHERE pack_key = 'mfa-enforcement-v1');

INSERT INTO config_pack_templates (pack_id, template_id, sort_order, check_key)
SELECT cp.id, v.template_id, v.sort_order, v.check_key
FROM config_packs cp
CROSS JOIN (VALUES
  ('action.require-security-info-reregistration', 0, NULL::text),
  ('action.enforce-per-user-mfa',                 1, 'identity:mfa-registration')
) AS v(template_id, sort_order, check_key)
WHERE cp.pack_key = 'mfa-enforcement-v1';

-- 4. The sellable catalog row. $299 (price_cents 29900), matching the prepared
--    Quick-Start marketing copy. Name matched EXACTLY to the fixture
--    ("MFA Enforcement Pack") so useQuickStartPackAvailability() flips it live.
INSERT INTO services
  (name, slug, category, description, billing_type, price_cents,
   is_public, visibility, fulfillment_type, fulfillment_type_key,
   delivery_type, service_class, allow_free_checkout, is_free_offering,
   type_attributes)
VALUES
  ('MFA Enforcement Pack',
   'mfa-enforcement-pack-v1',
   'config_pack',
   'Real per-user MFA enforcement — every account enrolled and set to enforced, including the ones quietly sitting outside the policy today.',
   'one_time',
   29900,
   true, 'public', 'manual', 'config_pack',
   'none', 'add_on', true, false,
   '{"packKey": "mfa-enforcement-v1", "wiredAt": "2026-08-26"}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  is_public = EXCLUDED.is_public,
  visibility = EXCLUDED.visibility,
  fulfillment_type = EXCLUDED.fulfillment_type,
  fulfillment_type_key = EXCLUDED.fulfillment_type_key,
  type_attributes = EXCLUDED.type_attributes,
  updated_at = now();

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-mfa-enforcement-pack-1182.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

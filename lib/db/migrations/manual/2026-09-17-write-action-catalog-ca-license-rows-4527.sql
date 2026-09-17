-- 2026-09-17-write-action-catalog-ca-license-rows-4527.sql
-- Git #4527 (found during #4513): two active Conditional Access templates used by live
-- packs had no write_action_catalog row, so #4513's pack license gate
-- (evaluateConfigPackPreconditions) had no required_license_skus to refuse them with on
-- a tenant without Entra ID P1.
--   microrem.enforce-ca-policy                (PATCH /identity/conditionalAccess/policies/{{policyId}}, pack 41)
--   action.create-ca-legacy-auth-block-policy (POST  /identity/conditionalAccess/policies, pack 81)
--
-- 1. Link: row 134 "Update CA policy" is the existing, unlinked (template_id NULL) CA
--    update action and already carries ["AAD_PREMIUM","AAD_PREMIUM_P2"]; the PATCH
--    template is exactly that action.
-- 2. Add: a "Create CA policy: block legacy auth" row mirroring 214/215 (gated, growth,
--    execution_ready, same permission and SKUs), slotted after 215 (sort 46) with every
--    row >= 46 shifted up by 1 to keep sort_order contiguous.
-- Idempotent: every statement is guarded on the template_id already being linked.

BEGIN;

UPDATE write_action_catalog
SET template_id = 'microrem.enforce-ca-policy'
WHERE id = 134
  AND template_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM write_action_catalog WHERE template_id = 'microrem.enforce-ca-policy');

UPDATE write_action_catalog
SET sort_order = sort_order + 1
WHERE sort_order >= 46
  AND NOT EXISTS (SELECT 1 FROM write_action_catalog WHERE template_id = 'action.create-ca-legacy-auth-block-policy');

INSERT INTO write_action_catalog (
  domain, action_name, surface, required_permission, safe_or_gated,
  min_bundled_tier, status, sort_order, template_id, required_license_skus
)
SELECT 'Conditional Access', 'Create CA policy: block legacy auth', 'graph',
       'Policy.ReadWrite.ConditionalAccess', 'gated', 'growth', 'execution_ready',
       46, 'action.create-ca-legacy-auth-block-policy',
       '["AAD_PREMIUM", "AAD_PREMIUM_P2"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM write_action_catalog WHERE template_id = 'action.create-ca-legacy-auth-block-policy'
);

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-write-action-catalog-ca-license-rows-4527.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

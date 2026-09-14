-- 2026-09-13-write-action-catalog-ca-mfa-rows-3958.sql
-- Git #3958 (Feature #2494) -- catalog-authoring work surfaced while building #3947:
-- two real, status = 'active' baseline_action_templates rows
-- (action.create-ca-mfa-all-users-policy, action.create-ca-guest-mfa-policy) have no
-- write_action_catalog row linking to them, so a Launch Control technician can never
-- see or execute either action -- GET /msp/:mspId/launch-control/actions enumerates
-- write_action_catalog, not baseline_action_templates.
--
-- Product judgment on the new rows, matching real existing Conditional Access
-- precedent (write_action_catalog ids 133-141, all confirmed live this session):
--   domain              'Conditional Access' -- same domain as every other CA row.
--   surface              'graph' -- both templates POST to Graph
--                         (/identity/conditionalAccess/policies).
--   required_permission  'Policy.ReadWrite.ConditionalAccess' -- identical permission
--                         already used by every other CA row (133, 134, 135, 136, 137).
--   safe_or_gated         'gated' -- both templates create a real, org-wide Conditional
--                         Access policy (even though created in REPORT-ONLY state). The
--                         directly analogous row, id 133 "Create CA policy" (which uses
--                         the *general* quickstart-v1.create-ca-baseline-policy template,
--                         also report-only-first per its own description), is itself
--                         classified 'gated' -- report-only creation is not treated as
--                         'safe' anywhere else in this catalog, so these two don't
--                         default to 'safe' either. Row 136 ("Enable/disable, report-only
--                         vs on") is the one CA row classified 'safe', but that's a
--                         narrower state-toggle action, not policy creation -- not the
--                         same action shape as these two.
--   min_bundled_tier      'enhanced' -- matches id 133's tier, the directly analogous
--                         "create a CA policy" action.
--   required_license_skus '["AAD_PREMIUM", "AAD_PREMIUM_P2"]' -- identical to every
--                         other Conditional Access row, per #3947's own sourced
--                         rationale (Conditional Access requires Entra ID Premium P1 at
--                         minimum) and this issue's own explicit instruction.
--   status                'execution_ready' -- both templates are real, active, single
--                         Graph POST calls with no missing pieces.
--   template_id           links to the real baseline_action_templates row.
--   action_name           plain technician-facing label, matching the terse
--                         "Create CA policy: ..." style already used by id 133.
--
-- sort_order: fit into the existing CA block (43-51) as the two other "create a CA
-- policy" variants, immediately after the general row 133 (sort_order 43) and before
-- "Update CA policy" (was 44). write_action_catalog.sort_order is a tight, unique,
-- contiguous 1..123 sequence with no gaps (confirmed live) -- inserting here without
-- renumbering everything after it would either collide or leave a gap, so every row
-- currently >= 44 is shifted up by 2 first, additive and reversible (a plain UPDATE,
-- no data loss).
--
-- Idempotent: the shift UPDATE is guarded so it cannot double-apply (only fires if the
-- two new sort_order slots, 44 and 45, are not already the CA MFA rows below), and the
-- INSERTs are guarded by template_id via a NOT EXISTS check.

BEGIN;

-- Shift every row from the old sort_order 44 onward up by 2, to open slots 44/45 for
-- the two new rows. Guarded so a second run of this file is a no-op.
UPDATE write_action_catalog
SET sort_order = sort_order + 2
WHERE sort_order >= 44
  AND NOT EXISTS (
    SELECT 1 FROM write_action_catalog WHERE template_id = 'action.create-ca-mfa-all-users-policy'
  );

INSERT INTO write_action_catalog (
  domain, action_name, surface, required_permission, safe_or_gated,
  min_bundled_tier, status, sort_order, template_id, required_license_skus
)
SELECT * FROM (
  VALUES
    (
      'Conditional Access', 'Create CA policy: MFA for all users', 'graph',
      'Policy.ReadWrite.ConditionalAccess', 'gated', 'enhanced', 'execution_ready',
      44, 'action.create-ca-mfa-all-users-policy',
      '["AAD_PREMIUM", "AAD_PREMIUM_P2"]'::jsonb
    ),
    (
      'Conditional Access', 'Create CA policy: MFA for guests', 'graph',
      'Policy.ReadWrite.ConditionalAccess', 'gated', 'enhanced', 'execution_ready',
      45, 'action.create-ca-guest-mfa-policy',
      '["AAD_PREMIUM", "AAD_PREMIUM_P2"]'::jsonb
    )
) AS v(domain, action_name, surface, required_permission, safe_or_gated, min_bundled_tier, status, sort_order, template_id, required_license_skus)
WHERE NOT EXISTS (
  SELECT 1 FROM write_action_catalog wac WHERE wac.template_id = v.template_id
);

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-write-action-catalog-ca-mfa-rows-3958.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

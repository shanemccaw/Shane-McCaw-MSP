-- 2026-09-13-write-action-catalog-required-license-skus-3947.sql
-- Git #3947 (Feature #2494) -- Shane's real decision on #3937 (Launch Control CA
-- actions were surfacing a raw Graph 403 with no indication the tenant simply
-- isn't licensed for the feature): build a proactive, extensible license
-- precondition mechanism, not a CA-only patch.
--
-- 1. New nullable column, same "extensible via data not schema" pattern
--    already used for required_capability_key: ANY ONE of the listed Graph
--    skuPartNumber values satisfies the gate. NULL = no license precondition
--    (the default -- most rows have none). A future Defender-gated row
--    (#3938) or any other license-gated domain is a data change, not a new
--    column.
--
-- 2. Backfill: every domain = 'Conditional Access' row gets
--    ['AAD_PREMIUM', 'AAD_PREMIUM_P2'] (either Entra ID P1 or P2 satisfies
--    it). This covers all 9 live CA rows (ids 133-141), not just the 5 named
--    in #3947's dispatch note that currently have a template_id -- Microsoft
--    documents Conditional Access itself (policy CRUD, named locations, ToU
--    assignment) as requiring Azure AD/Entra ID Premium P1 at minimum
--    (https://learn.microsoft.com/entra/identity/conditional-access/overview),
--    so this is a real, sourced constraint for the whole domain, not a guess
--    scoped only to the rows #3937 happened to hit live. Two of the seven
--    template_ids named in #3947's own list --
--    action.create-ca-mfa-all-users-policy and
--    action.create-ca-guest-mfa-policy -- are real, active
--    baseline_action_templates rows with NO write_action_catalog row linking
--    to them yet (confirmed live query, this session); there is nothing to
--    backfill for those two until a catalog row exists to carry the column,
--    which is catalog-authoring work out of scope here -- filed as a finding
--    (see the build's own bookend/issue comment for the number) rather than
--    silently done in this migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the backfill UPDATE is guarded by
-- domain (re-running is a no-op past the first application).

BEGIN;

ALTER TABLE write_action_catalog
  ADD COLUMN IF NOT EXISTS required_license_skus jsonb;

UPDATE write_action_catalog
SET required_license_skus = '["AAD_PREMIUM", "AAD_PREMIUM_P2"]'::jsonb
WHERE domain = 'Conditional Access';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-write-action-catalog-required-license-skus-3947.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

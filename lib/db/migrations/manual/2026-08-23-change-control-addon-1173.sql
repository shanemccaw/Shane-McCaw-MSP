-- Git #1173 — Change Control real add-on.
--
-- Shane's 2026-08-21 comment on #1173 locked in 4 real, flat-per-bracket
-- prices for Change Control as a standalone `service_class: add_on` product
-- (NOT folded into a tier, per #1168's own reasoning on why Change Control
-- specifically stays separate). Flat because Change Control's operational
-- cost scales with change-request volume, not headcount — unlike Monitoring,
-- which is genuinely per-seat.
--
-- NOTE on bracket boundaries: Shane's own locked table names FOUR brackets
-- including a Micro band (1-25/26-100/101-499/500+). This intentionally
-- diverges from Monitoring's own bracket scheme, which retired its Micro
-- band entirely (see 2026-08-08-monitoring-micro-retire-architect-retainer-
-- bands-595.sql — Monitoring is SMB 26-100 / Mid-Market 101-500 / Enterprise
-- 501+, no Micro). Change Control's own comment on #1173 says "reuses the
-- existing... bracket boundaries", but Shane's own pinned pricing table is
-- the more specific, more recent, explicitly-locked source of truth, so it
-- wins here. Flagged for Shane: if this divergence from Monitoring's live
-- boundaries was unintentional, the seatMin/seatMax values below are a
-- one-line fix.
--
-- Part 1 creates tenant_add_on_entitlements — no table anywhere in this
-- codebase previously tracked "did this specific tenant buy add-on X"
-- (mspSubscriptionsTable is MSP-platform-tier only; client_services is keyed
-- on users.id, not tenants.id). This is deliberately generic (a free-text
-- feature_key, not a Change-Control-specific column) so a future a-la-carte
-- add-on can reuse it without a second table.
--
-- Part 2 inserts the 4 real Change Control services rows.
--
-- Part 3 seeds the shared testbed tenant (customer_id = 1 — see
-- lib/portal-customer-scope.ts and the "Portal customer-scoped seed target
-- is tenant 1" build note) with an active entitlement, so the
-- CustomerUser-floor + entitlement-gated GET /api/portal/change-control
-- route keeps serving the testbed account real data once this migration
-- runs — otherwise test-manifests/portal/change-control.json's A1/A2/etc.
-- start failing with 402 the moment the route code deploys ahead of this
-- migration being run.
--
-- Verify the real prior state with a live SELECT before trusting any
-- assumption here, same discipline as every other manual migration in this
-- directory.

BEGIN;

-- ─── Part 1: tenant_add_on_entitlements ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_add_on_entitlements (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  service_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_add_on_entitlements_tenant_feature_uq UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS tenant_add_on_entitlements_tenant_id_idx
  ON tenant_add_on_entitlements (tenant_id);

-- ─── Part 2: the 4 real Change Control services rows ────────────────────────

INSERT INTO services (
  slug, name, description, category, category_path, tagline, service_type,
  billing_type, visibility, is_public,
  service_class, delivery_type, fulfillment_type, price_cents, price,
  sort_order, tags, target_audience, type_attributes, allow_free_checkout,
  is_free_offering
)
SELECT * FROM (VALUES
  (
    'change-control-micro',
    'Change Control — Micro (1–25 seats)',
    'Formal Dev→Test→Prod change-approval workflow for your team: every change raised through the portal gets a two-gate sign-off before it runs against your tenant, plus a full customer-facing register and audit trail of every change request, its risk rating and its approval history.',
    'Add-ons', 'Add-ons',
    'Governed change approval, on top of the audit trail you already have',
    'recurring_addon', 'recurring_monthly', 'public', true,
    'add_on', 'none', 'standard', 9900, 99.00,
    0, '["change-control","add-on","governance"]'::jsonb,
    'Customers with no existing change-management process who need somewhere for approval governance to visibly live',
    '{"featureKey":"change_control","seatMin":1,"seatMax":25,"bracketLabel":"Micro"}'::jsonb,
    false, false
  ),
  (
    'change-control-smb',
    'Change Control — SMB (26–100 seats)',
    'Formal Dev→Test→Prod change-approval workflow for your team: every change raised through the portal gets a two-gate sign-off before it runs against your tenant, plus a full customer-facing register and audit trail of every change request, its risk rating and its approval history.',
    'Add-ons', 'Add-ons',
    'Governed change approval, on top of the audit trail you already have',
    'recurring_addon', 'recurring_monthly', 'public', true,
    'add_on', 'none', 'standard', 14900, 149.00,
    1, '["change-control","add-on","governance"]'::jsonb,
    'Customers with no existing change-management process who need somewhere for approval governance to visibly live',
    '{"featureKey":"change_control","seatMin":26,"seatMax":100,"bracketLabel":"SMB"}'::jsonb,
    false, false
  ),
  (
    'change-control-midmarket',
    'Change Control — Mid-Market (101–499 seats)',
    'Formal Dev→Test→Prod change-approval workflow for your team: every change raised through the portal gets a two-gate sign-off before it runs against your tenant, plus a full customer-facing register and audit trail of every change request, its risk rating and its approval history.',
    'Add-ons', 'Add-ons',
    'Governed change approval, on top of the audit trail you already have',
    'recurring_addon', 'recurring_monthly', 'public', true,
    'add_on', 'none', 'standard', 29900, 299.00,
    2, '["change-control","add-on","governance"]'::jsonb,
    'Customers with no existing change-management process who need somewhere for approval governance to visibly live',
    '{"featureKey":"change_control","seatMin":101,"seatMax":499,"bracketLabel":"Mid-Market"}'::jsonb,
    false, false
  ),
  (
    'change-control-enterprise',
    'Change Control — Enterprise (500+ seats)',
    'Formal Dev→Test→Prod change-approval workflow for your team: every change raised through the portal gets a two-gate sign-off before it runs against your tenant, plus a full customer-facing register and audit trail of every change request, its risk rating and its approval history.',
    'Add-ons', 'Add-ons',
    'Governed change approval, on top of the audit trail you already have',
    'recurring_addon', 'recurring_monthly', 'public', true,
    'add_on', 'none', 'standard', 49900, 499.00,
    3, '["change-control","add-on","governance"]'::jsonb,
    'Customers with no existing change-management process who need somewhere for approval governance to visibly live',
    '{"featureKey":"change_control","seatMin":500,"seatMax":null,"bracketLabel":"Enterprise"}'::jsonb,
    false, false
  )
) AS v(
  slug, name, description, category, category_path, tagline, service_type,
  billing_type, visibility, is_public,
  service_class, delivery_type, fulfillment_type, price_cents, price,
  sort_order, tags, target_audience, type_attributes, allow_free_checkout,
  is_free_offering
)
WHERE NOT EXISTS (SELECT 1 FROM services WHERE services.slug = v.slug);

-- ─── Part 3: seed the shared testbed tenant with an active entitlement ──────
-- customer_id = 1 is the shared CustomerUser testbed tenant every portal-v2
-- manifest logs into (see lib/portal-customer-scope.ts's resolveCustomerId —
-- the JWT customerId claim IS tenants.id).

INSERT INTO tenant_add_on_entitlements (tenant_id, feature_key, service_id, status)
SELECT 1, 'change_control', (SELECT id FROM services WHERE slug = 'change-control-smb'), 'active'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1 FROM tenant_add_on_entitlements WHERE tenant_id = 1 AND feature_key = 'change_control'
  );

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-23-change-control-addon-1173.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ─── Verification (run after COMMIT) ────────────────────────────────────────

-- Expect 4 rows, one per bracket, all visibility='public'/is_public=true.
-- SELECT slug, price_cents, type_attributes FROM services WHERE slug LIKE 'change-control-%' ORDER BY sort_order;

-- Expect the testbed tenant (1) to hold an active change_control entitlement.
-- SELECT * FROM tenant_add_on_entitlements WHERE tenant_id = 1 AND feature_key = 'change_control';

-- ============================================================================
-- #3465 (part of #1696) — customer:billing.manage, the write half of billing
-- ============================================================================
--
-- portal-billing.ts (10 routes) and portal-retainer-billing.ts (3 routes) were
-- gated by requireAuth alone. #3465 puts every one of them behind a
-- customer-system capability:
--
--   reads  (invoices, invoice detail, PDF download, Stripe receipts,
--           subscriptions, retainer intervals)          -> customer:billing.view
--   writes (pay, cancel, resume, resubscribe, Stripe customer portal,
--           switch interval, cancel interval switch)    -> customer:billing.manage
--
-- billing.view already exists (#2455 catalog, #2457 seed). billing.manage is new:
-- paying an invoice and cancelling a subscription are money-path writes, and a
-- capability named for a read should not authorise them.
--
-- The allow set below is EVERY RUNG — the same set billing.view carries, and the
-- honest transcription of the rule these routes had (requireAuth only). Nobody's
-- access moves when this runs. Narrowing either capability is the real product
-- decision #1696 was filed for, and after this migration it is a mapping-row edit
-- (AdminV2 RBAC, #2461) rather than a code change.
--
-- The mapping insert is ON CONFLICT DO NOTHING, deliberately unlike #2457's seed:
-- once a row exists it may have been narrowed through the admin UI, and re-running
-- this file must never silently widen it back to every rung.
--
-- Additive only. Mirrors lib/db/src/rbac/capabilities.ts.

BEGIN;

INSERT INTO rbac_capabilities (system, key, category, label, description) VALUES
  ('customer', 'billing.view', 'billing', 'View billing',
   'View the customer''s invoices, subscriptions and payment history. This is the capability #1696 was filed about — Shane, 2026-08-29: ''the customer needs RBAC to stop say an engineer from seeing billing.'' Enforced on every read route in artifacts/api-server/src/routes/portal-billing.ts and portal-retainer-billing.ts (#3465); the writes on the same surface ask billing.manage instead.'),
  ('customer', 'billing.manage', 'billing', 'Manage billing',
   'Act on the customer''s billing: pay an invoice, cancel, resume or re-subscribe a subscription, switch a retainer''s billing interval, and open the Stripe customer portal (where cards change and subscriptions can be cancelled). Split from billing.view by #3465 because these are money-path writes, and a capability named for a read should not authorise them. Enforced on every write route in artifacts/api-server/src/routes/portal-billing.ts and portal-retainer-billing.ts.')
ON CONFLICT (system, key) DO UPDATE SET
  category    = EXCLUDED.category,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'billing.manage',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('Assessment', 'Free', 'CustomerUser', 'ServiceAccount',
                                 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO NOTHING;

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-rbac-billing-manage-3465.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ============================================================================
-- #3629 — Customer Admin + Billing platform-default customer roles; narrow
--         customer:billing.view / customer:billing.manage (resolves #3587)
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). Sits on top of #2455's foundation,
-- #2457's seed, #3408's users -> *_user_roles sync, #3465's billing.manage and
-- #3590's Customer/Free rungs + marketplace.browse-full.
--
-- ── The product decision (Shane, 2026-09-11, resolving #3587) ────────────────
--   1. `Customer Admin` — the top of a customer org, parallel to MSPAdmin on the MSP
--      side. Holds every customer-system capability by default: billing.view,
--      billing.manage, team.manage, changes.approve, marketplace.browse-full.
--   2. `Billing` — a narrow role a Customer Admin assigns to specific employees:
--      billing.view + billing.manage only. "An engineer shouldn't see billing, but
--      someone in finance should, without full admin rights."
--   Both are platform defaults (`tenant_id IS NULL`, `is_system = true`) that an org
--   may customise or reassign through #2455's org-scoped rows.
--
-- ── What changes for billing ─────────────────────────────────────────────────
-- #3465 seeded both billing capabilities to EVERY rung — the honest transcription of
-- routes that were requireAuth-only. After this file the platform rows allow:
--
--   Customer Admin, Billing, MSPOperator, MSPAdmin, PlatformAdmin
--
-- Removed: Customer, Free, ServiceAccount. The MSP staff rungs stay, matching the
-- staff set customer:changes.approve already carries (#2457 section 5): on the
-- customer system, every existing capability lets MSP staff act by role. On today's
-- handlers that grant is inert — see the next paragraph — so keeping it moves no
-- one's access, and removing it would be a change the decision did not ask for.
-- ServiceAccount is a machine credential, is not on changes.approve's list either,
-- and nothing server-side calls a portal billing route (checked: no caller outside
-- artifacts/portal).
--
-- ── Why the billed party is granted Billing ─────────────────────────────────
-- Every handler in portal-billing.ts and portal-retainer-billing.ts reads the
-- caller's OWN rows — `invoices.client_user_id = req.user.id`,
-- `client_services.client_user_id = req.user.id` — never the tenant's. So a bill is
-- only ever visible to the one user it is addressed to, and narrowing the capability
-- without granting that user a role would leave invoices nobody can open or pay.
-- Two mechanisms close that, and they are the only memberships this file writes:
--
--   * a ONE-TIME carry-forward: every user who already has an invoices or
--     client_services row of their own is granted Billing, in the same transaction
--     as the narrowing, so no real user loses sight of a bill they have today;
--   * a TRIGGER on invoices and client_services (INSERT, or a change of
--     client_user_id) that grants the addressee Billing, so a bill issued later —
--     checkout, fulfillment, the admin invoice form, the admin service assignment —
--     never lands on someone who cannot see it.
--
-- Nobody is made Customer Admin automatically. That role also carries team.manage
-- and changes.approve, and handing it to anyone who has been billed would be a
-- privilege gain, not a carry-forward. Until the portal has a surface for it, a
-- PlatformAdmin assigns it through AdminV2 RBAC (#2461).
--
-- ── Re-running ───────────────────────────────────────────────────────────────
-- Mapping edits and the carry-forward happen ONLY on the run that creates the two
-- roles. A re-run refreshes the role names/descriptions, the capability
-- descriptions and the trigger, and touches no mapping or membership — so it can
-- never undo an edit made through AdminV2 afterwards (the #3465/#3590 rule: a re-run
-- must not silently widen; here, nor silently re-narrow). A platform role already
-- holding either key that this file did not create (`is_system = false`, i.e. made by
-- hand in AdminV2) is refused rather than adopted.
--
-- One transaction. Additive: two roles, two triggers, UPDATEs with WHERE. Run against
-- the local dev DATABASE_URL in-session per CLAUDE.md's Database section.
-- Replit/Staging is on #1630.
--
-- Verified by: pnpm --filter @workspace/db run check-rbac-parity, and
-- pnpm --filter @workspace/db test (src/rbac/customer-admin-billing-roles.test.ts).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.customer_roles') IS NULL OR to_regclass('public.customer_feature_role_mapping') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: #2455''s RBAC tables are missing. Run 2026-09-09-rbac-foundation-2455.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_roles WHERE tenant_id IS NULL AND key = 'Customer') THEN
    RAISE EXCEPTION 'REFUSING: the platform Customer rung is missing. Run 2026-09-11-rbac-customer-free-roles-3590.sql first.';
  END IF;
  IF (SELECT count(*) FROM customer_feature_role_mapping
       WHERE tenant_id IS NULL AND capability_key IN ('billing.view', 'billing.manage')) <> 2 THEN
    RAISE EXCEPTION 'REFUSING: the platform billing.view / billing.manage rows are missing. Run 2026-09-10-rbac-billing-manage-3465.sql first.';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_roles
              WHERE tenant_id IS NULL AND key IN ('customer-admin', 'billing') AND NOT is_system) THEN
    RAISE EXCEPTION 'REFUSING: a hand-made platform customer role already uses the key customer-admin or billing. Re-key it in AdminV2 first; this migration will not adopt a role it did not create.';
  END IF;

  PERFORM set_config('rbac_3629.first_run',
    (NOT EXISTS (SELECT 1 FROM customer_roles
                  WHERE tenant_id IS NULL AND key IN ('customer-admin', 'billing')))::text,
    true);
END $$;

-- ----------------------------------------------------------------------------
-- 1. The two roles — #2457 section 3's pattern exactly
-- ----------------------------------------------------------------------------
-- `key` is the stable handle (CUSTOMER_PLATFORM_ROLE_KEYS in
-- lib/db/src/rbac/legacy-ladder.ts); `name` is display only.
INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'customer-admin', 'Customer Admin',
   'The top of a customer org, parallel to MSPAdmin on the MSP side (#3629, resolving #3587). '
     || 'Holds every customer-system capability by default: billing.view, billing.manage, '
     || 'team.manage, changes.approve and marketplace.browse-full. A platform default an org '
     || 'may customise or reassign (#2455).',
   true),
  (NULL, 'billing', 'Billing',
   'Billing access without admin rights (#3629, resolving #3587): customer:billing.view and '
     || 'customer:billing.manage only — the "an engineer should not see billing, someone in '
     || 'finance should" case #1696 was framed around. A Customer Admin assigns it to specific '
     || 'employees. Also granted automatically to whoever an invoice or client service is '
     || 'addressed to, because every portal billing route reads the caller''s own rows.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. Mappings + carry-forward — first run only (see the header)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  admin_id   text := (SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key = 'customer-admin');
  billing_id text := (SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key = 'billing');
  -- The rungs the decision removes from billing: everything below MSP staff.
  dropped    text[] := ARRAY(SELECT id::text FROM customer_roles
                              WHERE tenant_id IS NULL AND key IN ('Free', 'Customer', 'ServiceAccount'));
  carried    integer;
BEGIN
  IF current_setting('rbac_3629.first_run', true) IS DISTINCT FROM 'true' THEN
    RAISE NOTICE '#3629: the Customer Admin / Billing roles already existed — mapping rows and memberships left exactly as they are.';
    RETURN;
  END IF;

  -- 2a. Carry-forward, BEFORE the narrowing: everyone with a bill of their own today
  --     keeps being able to open it.
  INSERT INTO customer_user_roles (user_id, role_id)
  SELECT billed.user_id, billing_id::uuid
    FROM (SELECT client_user_id AS user_id FROM invoices
          UNION
          SELECT client_user_id FROM client_services) billed
  ON CONFLICT (user_id, role_id) DO NOTHING;
  GET DIAGNOSTICS carried = ROW_COUNT;
  RAISE NOTICE '#3629: granted Billing to % user(s) who already have an invoice or client service of their own.', carried;

  -- 2b. Narrow billing.view / billing.manage: drop the three rungs below MSP staff, add
  --     the two roles. Edits the existing arrays rather than replacing them, so any
  --     other role an admin has added to the platform row survives.
  UPDATE customer_feature_role_mapping m
     SET roles = jsonb_set(m.roles, '{allow}', (
           SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
             FROM (SELECT e AS x FROM jsonb_array_elements_text(m.roles -> 'allow') e
                    WHERE e <> ALL (dropped)
                   UNION ALL SELECT admin_id
                   UNION ALL SELECT billing_id) s)),
         updated_at = now()
   WHERE m.tenant_id IS NULL
     AND m.capability_key IN ('billing.view', 'billing.manage');

  -- 2c. Customer Admin holds the rest of the customer catalog — appended, never
  --     overwriting what the row already allows.
  UPDATE customer_feature_role_mapping m
     SET roles = jsonb_set(m.roles, '{allow}', (m.roles -> 'allow') || to_jsonb(admin_id)),
         updated_at = now()
   WHERE m.tenant_id IS NULL
     AND m.capability_key IN ('team.manage', 'changes.approve', 'marketplace.browse-full')
     AND NOT ((m.roles -> 'allow') ? admin_id);
END $$;

-- ----------------------------------------------------------------------------
-- 3. The billed party always holds Billing — every run (CREATE OR REPLACE)
-- ----------------------------------------------------------------------------
-- #3408's shape: the grant follows the row that implies it, so no application code
-- has to remember to write it. Only ever GRANTS; a Customer Admin's revoke stands
-- until that user is addressed a new bill.
CREATE OR REPLACE FUNCTION rbac_grant_billing_to_billed_party() RETURNS trigger AS $$
BEGIN
  INSERT INTO customer_user_roles (user_id, role_id)
  SELECT NEW.client_user_id, r.id
    FROM customer_roles r
   WHERE r.tenant_id IS NULL AND r.key = 'billing'
  ON CONFLICT (user_id, role_id) DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_rbac_billing_on_write ON invoices;
CREATE TRIGGER invoices_rbac_billing_on_write
  AFTER INSERT OR UPDATE OF client_user_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION rbac_grant_billing_to_billed_party();

DROP TRIGGER IF EXISTS client_services_rbac_billing_on_write ON client_services;
CREATE TRIGGER client_services_rbac_billing_on_write
  AFTER INSERT OR UPDATE OF client_user_id ON client_services
  FOR EACH ROW EXECUTE FUNCTION rbac_grant_billing_to_billed_party();

-- ----------------------------------------------------------------------------
-- 4. Catalog descriptions — same strings as lib/db/src/rbac/capabilities.ts
-- ----------------------------------------------------------------------------
UPDATE rbac_capabilities SET updated_at = now(), description =
  'View the customer''s invoices, subscriptions and payment history. This is the capability #1696 was filed about — Shane, 2026-08-29: ''the customer needs RBAC to stop say an engineer from seeing billing.'' Enforced on every read route in artifacts/api-server/src/routes/portal-billing.ts and portal-retainer-billing.ts (#3465); the writes on the same surface ask billing.manage instead. Held by the Customer Admin and Billing roles and by MSP staff since #3629 — not by every rung.'
 WHERE system = 'customer' AND key = 'billing.view';

UPDATE rbac_capabilities SET updated_at = now(), description =
  'Act on the customer''s billing: pay an invoice, cancel, resume or re-subscribe a subscription, switch a retainer''s billing interval, and open the Stripe customer portal (where cards change and subscriptions can be cancelled). Split from billing.view by #3465 because these are money-path writes, and a capability named for a read should not authorise them. Enforced on every write route in artifacts/api-server/src/routes/portal-billing.ts and portal-retainer-billing.ts. Held by the Customer Admin and Billing roles and by MSP staff since #3629 — not by every rung.'
 WHERE system = 'customer' AND key = 'billing.manage';

UPDATE rbac_capabilities SET updated_at = now(), description =
  'Approve or reject a Change Request against the customer''s own live tenant. Granted per user by users.can_approve_changes (Git #1496), which #3408''s users trigger mirrors into the cap.changes.approve role, and by the Customer Admin role (#3629); decided through the evaluator in artifacts/api-server/src/routes/portal-change-control.ts (callerChangeApproval). Deliberately distinct from purchases.approve and team.manage — approving a configuration change to a live tenant is its own authority.'
 WHERE system = 'customer' AND key = 'changes.approve';

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-rbac-customer-admin-billing-roles-3629.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

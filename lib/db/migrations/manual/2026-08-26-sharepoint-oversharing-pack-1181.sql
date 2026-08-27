-- 2026-08-26-sharepoint-oversharing-pack-1181.sql
--
-- Git #1181 — SharePoint & OneDrive Oversharing Pack.
-- Part of #1093 (the Quick-Start pack family). This pack was priced and shown to
-- Design as real ($349, "SharePoint & OneDrive Oversharing Pack" — see
-- artifacts/shane-mccaw-consulting/src/marketing/data/quickStartPacks.ts) but had
-- no executable backing beyond the single-link removal that already exists
-- (microrem.remove-sharing-link, used by the live catalog). This migration builds
-- the missing REAL write-action templates and assembles the config pack the same
-- way as the other twelve packs (config_packs + config_pack_templates + services).
--
-- ── WHAT IS REAL vs WHAT IS A KNOWN PLATFORM GAP (read before pricing debate) ──
-- A baseline_action_template executes as exactly ONE Microsoft Graph v1.0 REST
-- call via runBaselineTemplateAgainstTenant() -> graphWriteForTenant() (which
-- prefixes https://graph.microsoft.com/v1.0 and fires {endpoint, method, body}
-- after {{variable}} substitution). It CANNOT loop/fan-out over many items, and
-- it CANNOT make a SharePoint CSOM call. That shapes what this pack can honestly do:
--
--   * TENANT-WIDE sharing-policy enforcement -> REAL here. Graph exposes
--     PATCH /admin/sharepoint/settings (the sharepointSettings resource), a single
--     call that sets the tenant external SharingCapability and related guardrails.
--     Setting SharingCapability to existingExternalUserSharingOnly (or disabled)
--     is the DURABLE control that stops NEW anonymous "Anyone" links from ever
--     being minted tenant-wide — a genuine oversharing sweep at the policy level.
--     The three new templates below are all real single Graph calls of this shape.
--
--   * PER-LINK removal -> already REAL as microrem.remove-sharing-link
--     (DELETE /sites/{siteId}/drive/items/{itemId}/permissions/{permissionId}),
--     wired into this pack for guided single-link cleanup.
--
--   * PER-SITE sharing-policy enforcement (Set-SPOSite -SharingCapability) and
--     true BULK per-item link removal across a whole site -> NOT expressible as a
--     baseline_action_template today. Per-site SharingCapability is a SharePoint
--     CSOM operation (there is no Graph v1.0 per-site sharing-capability write —
--     see artifacts/api-server/src/lib/sharepoint-admin.ts, which owns the
--     certificate-auth CSOM plumbing but is wired only to the READ side / monitor
--     checks, not to baseline-template WRITES). Bulk fan-out removal needs an
--     enumerate-then-delete loop the single-call template model has no way to
--     express. Both are real follow-ups (a "sharepoint-admin" WRITE executor for
--     baseline templates), NOT delivered by this migration and deliberately not
--     faked with a Graph endpoint that would 400.
--
-- PRICE: kept at $349 as prepared for Design. The marketing copy is honest for the
-- delivered scope — "Sharing brought back under control: links reviewed, exposure
-- removed, and sharing policy enforced tenant-wide." (review checks + per-link
-- removal + tenant-wide policy enforcement). It does NOT claim automated bulk
-- site-wide auto-removal or per-site policy, so no copy change is needed. If a
-- future revision wants those, price should be revisited alongside the CSOM
-- write-executor work above.
--
-- ── REQUIRED APP PERMISSION (Shane To-Do — not grantable from SQL) ─────────────
-- PATCH /admin/sharepoint/settings requires the Application permission
-- SharePointTenantSettings.ReadWrite.All on the multi-tenant WRITE app
-- registration, admin-consented on each customer tenant. This is a NEW permission
-- beyond the Sites.ReadWrite.All that microrem.remove-sharing-link uses. Until it
-- is granted, the three tenant-policy templates will return a Graph 403
-- (insufficient_privilege) at run time — the pack rows and templates are correct;
-- only the consent is outstanding.
--
-- Idempotent: safe to re-run. Templates upsert on template_id; the pack upserts on
-- pack_key; the service upserts on slug; the pack's template links are re-seeded
-- (delete-by-pack-id then insert) so re-running converges rather than duplicating.
-- No schema/DDL — data only, into existing tables (baseline_action_templates,
-- config_packs, config_pack_templates, services).

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — the three new write-action templates (real single Graph v1.0 PATCH
--          calls against the tenant sharepointSettings resource).
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method,
   body_template, required_variables, success_criteria, depends_on,
   requires_verification_gate, schema_version, status, reversible)
VALUES
  (
    'action.enforce-tenant-sharing-policy',
    'Enforce Tenant External Sharing Policy',
    'Sets the tenant-wide SharePoint & OneDrive external SharingCapability via '
      || 'PATCH /admin/sharepoint/settings. Set {{sharingCapability}} to '
      || '"existingExternalUserSharingOnly" (or "disabled") to stop new anonymous '
      || '"Anyone" / org-wide links from being created across the tenant — the '
      || 'durable oversharing control. Valid values are the Graph sharingCapability '
      || 'enum: disabled | externalUserSharingOnly | externalUserAndGuestSharing | '
      || 'existingExternalUserSharingOnly. Requires SharePointTenantSettings.ReadWrite.All.',
    'security',
    '/admin/sharepoint/settings',
    'PATCH',
    '{"sharingCapability": "{{sharingCapability}}"}'::jsonb,
    '["sharingCapability"]'::jsonb,
    '{"expectStatus": 200}'::jsonb,
    '[]'::jsonb,
    false, 1, 'active', false
  ),
  (
    'action.block-external-resharing',
    'Block Resharing by External Users',
    'Disables resharing of SharePoint & OneDrive content by external/guest users '
      || '(isResharingByExternalUsersEnabled = false) via PATCH /admin/sharepoint/'
      || 'settings, shrinking the blast radius of anything already shared out. '
      || 'Requires SharePointTenantSettings.ReadWrite.All.',
    'security',
    '/admin/sharepoint/settings',
    'PATCH',
    '{"isResharingByExternalUsersEnabled": false}'::jsonb,
    '[]'::jsonb,
    '{"expectStatus": 200}'::jsonb,
    '[]'::jsonb,
    false, 1, 'active', false
  ),
  (
    'action.require-invited-user-signin',
    'Require Accepting User to Match Invited User',
    'Requires the user who redeems a sharing invitation to match the user it was '
      || 'sent to (isRequireAcceptingUserToMatchInvitedUserEnabled = true) via '
      || 'PATCH /admin/sharepoint/settings, so a forwarded link cannot be redeemed '
      || 'by an unintended recipient. Requires SharePointTenantSettings.ReadWrite.All.',
    'security',
    '/admin/sharepoint/settings',
    'PATCH',
    '{"isRequireAcceptingUserToMatchInvitedUserEnabled": true}'::jsonb,
    '[]'::jsonb,
    '{"expectStatus": 200}'::jsonb,
    '[]'::jsonb,
    false, 1, 'active', false
  )
ON CONFLICT (template_id) DO UPDATE SET
  label                      = EXCLUDED.label,
  description                = EXCLUDED.description,
  category                   = EXCLUDED.category,
  endpoint                   = EXCLUDED.endpoint,
  method                     = EXCLUDED.method,
  body_template              = EXCLUDED.body_template,
  required_variables         = EXCLUDED.required_variables,
  success_criteria           = EXCLUDED.success_criteria,
  depends_on                 = EXCLUDED.depends_on,
  requires_verification_gate = EXCLUDED.requires_verification_gate,
  status                     = EXCLUDED.status,
  reversible                 = EXCLUDED.reversible,
  updated_at                 = now();

-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — the config pack itself.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES (
  'sharepoint-oversharing-v1',
  'SharePoint & OneDrive Oversharing Pack',
  'Reviews SharePoint & OneDrive external exposure (tenant sharing capability and '
    || 'overshared files), removes an identified external sharing link, and enforces '
    || 'tenant-wide sharing policy so new anonymous / org-wide links cannot be created.',
  ARRAY['Security', 'Governance'],
  'active'
)
ON CONFLICT (pack_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  categories  = EXCLUDED.categories,
  status      = EXCLUDED.status,
  updated_at  = now();

-- Re-seed this pack's template links idempotently: clear then insert. The linear
-- chain is review checks first (read), then the enforcement writes, then the
-- guided per-link removal. sort_order drives the topological linearization used by
-- config-pack-graph.ts (none of these declare depends_on, so order == sort_order).
DELETE FROM config_pack_templates
WHERE pack_id = (SELECT id FROM config_packs WHERE pack_key = 'sharepoint-oversharing-v1');

INSERT INTO config_pack_templates (pack_id, template_id, check_key, parameter_mapping, sort_order)
SELECT cp.id, v.template_id, v.check_key, NULL::jsonb, v.sort_order
FROM config_packs cp
CROSS JOIN (VALUES
  -- Review (monitor checks — read-only, surface the exposure before acting)
  (NULL,                                    'sharepoint:tenant-sharing-capability', 0),
  (NULL,                                    'onedrive:overshared-files',            1),
  -- Enforce (real Graph writes added in Part A)
  ('action.enforce-tenant-sharing-policy',  NULL,                                   2),
  ('action.block-external-resharing',       NULL,                                   3),
  ('action.require-invited-user-signin',    NULL,                                   4),
  -- Guided per-link removal (existing real template)
  ('microrem.remove-sharing-link',          NULL,                                   5)
) AS v(template_id, check_key, sort_order)
WHERE cp.pack_key = 'sharepoint-oversharing-v1';

-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — the sellable service row (mirrors the other config_pack services, e.g.
--          compromised-account-recovery-pack-v1). $349 as prepared for Design.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO services
  (name, description, category, price, price_cents, slug, is_public, billing_type,
   sort_order, service_type, visibility, fulfillment_type, fulfillment_type_key,
   service_class, delivery_type, tags, type_attributes)
VALUES (
  'SharePoint & OneDrive Oversharing Pack',
  'Sharing brought back under control: SharePoint & OneDrive external exposure '
    || 'reviewed, an identified external sharing link removed, and sharing policy '
    || 'enforced tenant-wide so new anonymous / org-wide links cannot be created. '
    || 'Executed via the write-back engine.',
  'config_pack',
  349.00,
  34900,
  'sharepoint-oversharing-pack-v1',
  true,
  'one_time',
  6,
  'config_pack',
  'public',
  'manual',
  'config_pack',
  'add_on',
  'none',
  '[]'::jsonb,
  '{"packKey": "sharepoint-oversharing-v1", "whiteLabel": {"wholesalePct": 55, "wholesaleBasis": "pct_of_retail"}, "templateCount": 3, "wiredAt": "2026-08-26"}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  category        = EXCLUDED.category,
  price           = EXCLUDED.price,
  price_cents     = EXCLUDED.price_cents,
  is_public       = EXCLUDED.is_public,
  service_type    = EXCLUDED.service_type,
  visibility      = EXCLUDED.visibility,
  service_class   = EXCLUDED.service_class,
  delivery_type   = EXCLUDED.delivery_type,
  type_attributes = EXCLUDED.type_attributes,
  updated_at      = now();

-- Self-marking row so Simulator Studio's Migrations tree (Git #497) reflects DB
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-sharepoint-oversharing-pack-1181.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

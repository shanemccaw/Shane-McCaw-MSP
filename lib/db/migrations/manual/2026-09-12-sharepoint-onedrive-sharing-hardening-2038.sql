-- #2038 — Phase 2 fan-out from #1925: SharePoint/OneDrive sharing-hardening write packs.
--
-- WHY. #1925 mapped the two tenant-level oversharing remediations already
-- (sharepoint:tenant-sharing-capability, onedrive:overshared-files) and fanned the
-- remaining SharePoint/OneDrive checks out here. Live DB before this migration: 14
-- sharepoint:*/onedrive:* checks total, 2 already we_can_run, 12 uncovered.
--
-- INVESTIGATION (this session, all 12 uncovered checks, not just the issue body's
-- named 5 — thorough per #1925's own practice):
--
--   MAPPED — 4 checks, real single-write remediations:
--   - sharepoint:anonymous-links   → remove the specific anonymous ("anyone") link.
--   - sharepoint:orgwide-links     → remove the specific org-wide ("people in your
--     org") link.
--     CORRECTION to the issue body's own candidate: sharingCapability does NOT gate
--     org-wide or anonymous links directly — per the sharepointSettings docs fetched
--     this session, sharingCapability's most restrictive value `disabled` is defined
--     as "Users can share only with people in the organization," i.e. org-internal
--     ("people in org") sharing is the FLOOR and is always allowed regardless of this
--     setting, and disabling external sharing tenant-wide does not retroactively
--     remove an already-created anonymous link either. There is no tenant-level Graph
--     v1.0 knob that reduces an existing anonymous/org-wide link count. The real,
--     precise remediation for both is removing the SPECIFIC link/permission the check
--     found — the same mechanism #1925 already proved for onedrive:overshared-files
--     (microrem.remove-sharing-link). Two new templates mirror that shape 1:1 with a
--     check-specific label/description (own template_id per check — see DISTINCT
--     TEMPLATE IDS below).
--   - onedrive:external-sharing-settings → action.enforce-tenant-sharing-policy
--     (EXISTING template, reused as-is). Confirmed correct per the issue body's own
--     note: sharepointSettings is documented as "tenant-level settings for SharePoint
--     AND OneDrive" — one resource, one sharingCapability value governs both, so
--     OneDrive external sharing genuinely does inherit this SharePoint tenant setting.
--   - sharepoint:storage-near-limit → action.enable-automatic-site-storage-limit (NEW).
--     The issue body guessed "likely admin-center/lifecycle, not a single write" —
--     that guess doesn't hold. `isSitesStorageLimitAutomatic` (sharepointSettings,
--     confirmed updatable via PATCH /admin/sharepoint/settings) is exactly this: false
--     means specific per-site storage limits are set (which a site can approach/hit);
--     true switches to tenant-pooled automatic allocation, so no site has a fixed
--     ceiling to approach. A real, single, documented write — mapped confidently.
--
--   LEFT UNCOVERED — 8 checks, correctly no single write (reasoning per check, not a
--   backend gap):
--   - sharepoint:inactive-sites — WHICH inactive sites to archive/delete is a genuine
--     customer decision (data retention, legal hold, ownership handoff); the only
--     Graph write is DELETE /sites/{id}, destructive and never safe to automate
--     blind. Matches the issue body's own prediction.
--   - onedrive:active-users, onedrive:storage-utilization, onedrive:sync-errors,
--     sharepoint:site-count, sharepoint:storage-utilization — pure usage-report
--     metrics (getOneDriveUsageAccountDetail / site counts). No tenant setting or
--     resource state a Graph write "fixes" — same "reporting-only, correctly no
--     write" class #1925 already established for adoption/copilot-usage/cost/
--     secure-score checks.
--   - sharepoint:site-label-coverage — applying a sensitivity label requires knowing
--     WHICH of the tenant's own labels to assign to a given site; that's a per-tenant
--     taxonomy/customer decision, not a backend gap.
--   - onedrive:departed-user-access — a real candidate write exists in principle
--     (grant the departed user's manager delegate access to their OneDrive via
--     POST .../drive/root/invite, or convert the account), but resolving the
--     departed user's own OneDrive site from their userId needs further research
--     this session didn't complete. Left NULL rather than guessed — thorough beats
--     complete (#1925's own standard). Candidate for a future pass.
--
-- MICROSOFT DOCS FETCHED THIS SESSION (2026-09-12), not recalled:
--   sharepointSettings resource ... https://learn.microsoft.com/en-us/graph/api/resources/sharepointsettings
--   Update sharepointSettings ..... https://learn.microsoft.com/en-us/graph/api/sharepointsettings-update
--        PATCH /admin/sharepoint/settings (SharePointTenantSettings.ReadWrite.All)
--        sharingCapability: disabled|externalUserSharingOnly|externalUserAndGuestSharing|existingExternalUserSharingOnly
--        isSitesStorageLimitAutomatic: boolean
--   Remove access to an item ...... https://learn.microsoft.com/en-us/graph/api/permission-delete
--        DELETE /sites/{site-id}/drive/items/{item-id}/permissions/{perm-id} -> 204
--        (Files.ReadWrite.All / Sites.ReadWrite.All) — same shape microrem.remove-sharing-link
--        already uses for onedrive:overshared-files.
--
-- DISTINCT TEMPLATE IDS. action.remove-anonymous-sharing-link and
-- action.remove-orgwide-sharing-link are the same DELETE shape as the existing
-- microrem.remove-sharing-link, authored as their own templates rather than reused,
-- because getStepId() keys the pack graph on template_id and a duplicate template_id
-- inside one pack breaks the topological sort (#1484) — the same reasoning #1925's
-- governance-groups-v1 migration recorded for its two visibility templates. All four
-- rows below share ONE new pack, so each needed its own template_id.
--
-- reversible=false / reverse_template_id=NULL on all three new templates: no explicit
-- single-step reverse authored here, so the 6-template reverse count is not inflated.
--
-- PLAN-ONLY. Per the issue's own note, every one of these writes can affect existing
-- shares or tenant storage behavior — none of them is ever applied for real by this
-- migration or by this session; Phase 3 below is a planOnly dry-run proof only.
--
-- IDEMPOTENT. Templates upsert on their unique template_id (DO NOTHING); the pack
-- upserts on its unique pack_key; the four mapping rows insert only WHERE NOT EXISTS
-- for (pack_id, check_key). A re-run writes nothing. Additive; reversible by deleting
-- these rows. All four target check_keys exist in monitor_checks (FK satisfied).

BEGIN;

-- ── 1. The three new write templates ─────────────────────────────────────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, status, reversible)
VALUES
  ('action.remove-anonymous-sharing-link',
   'Remove Anonymous Sharing Link',
   'Removes a specific anonymous ("anyone") sharing link/permission on a SharePoint site item via DELETE .../permissions/{id} (Files.ReadWrite.All / Sites.ReadWrite.All). Remediates sharepoint:anonymous-links. sharingCapability does not gate an already-created anonymous link retroactively — removing the specific permission is the real fix. Ref: https://learn.microsoft.com/en-us/graph/api/permission-delete',
   'security', '/sites/{{siteId}}/drive/items/{{itemId}}/permissions/{{permissionId}}', 'DELETE',
   '{}'::jsonb,
   '["siteId", "itemId", "permissionId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false),

  ('action.remove-orgwide-sharing-link',
   'Remove Org-Wide Sharing Link',
   'Removes a specific org-wide ("people in your organization") sharing link/permission on a SharePoint site item via DELETE .../permissions/{id} (Files.ReadWrite.All / Sites.ReadWrite.All). Remediates sharepoint:orgwide-links. Org-internal sharing is the floor sharingCapability always allows, so tenant policy cannot reduce this count — removing the specific permission is the real fix. Ref: https://learn.microsoft.com/en-us/graph/api/permission-delete',
   'security', '/sites/{{siteId}}/drive/items/{{itemId}}/permissions/{{permissionId}}', 'DELETE',
   '{}'::jsonb,
   '["siteId", "itemId", "permissionId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false),

  ('action.enable-automatic-site-storage-limit',
   'Enable Automatic Site Storage Limit Management',
   'Switches SharePoint site storage quota management from fixed per-site limits to automatic tenant-pooled allocation via PATCH /admin/sharepoint/settings {"isSitesStorageLimitAutomatic": true} (SharePointTenantSettings.ReadWrite.All). Remediates sharepoint:storage-near-limit — once automatic, no individual site has a fixed ceiling left to approach. Ref: https://learn.microsoft.com/en-us/graph/api/sharepointsettings-update',
   'security', '/admin/sharepoint/settings', 'PATCH',
   '{"isSitesStorageLimitAutomatic": true}'::jsonb,
   '[]'::jsonb, '{"expectStatus": 200}'::jsonb, 'active', false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('sharepoint-onedrive-sharing-hardening-v1', 'SharePoint/OneDrive Sharing Hardening',
   'Removes exposed anonymous and org-wide SharePoint sharing links, tightens OneDrive external sharing to the SharePoint tenant policy, and switches site storage to automatic tenant-pooled allocation.',
   ARRAY['Security','SharePoint','OneDrive'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind each template to the check it remediates ─────────────────────────
-- action.enforce-tenant-sharing-policy is REUSED here (already exists from #1925,
-- bound to sharepoint:tenant-sharing-capability in a DIFFERENT pack,
-- sharepoint-oversharing-v1) — reuse across packs is fine; only a duplicate
-- template_id WITHIN one pack breaks the topo sort.
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order)
SELECT cp.id, v.template_id, v.check_key, v.sort_order
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.remove-anonymous-sharing-link',       'sharepoint:anonymous-links',           1),
    ('action.remove-orgwide-sharing-link',         'sharepoint:orgwide-links',             2),
    ('action.enforce-tenant-sharing-policy',       'onedrive:external-sharing-settings',   3),
    ('action.enable-automatic-site-storage-limit', 'sharepoint:storage-near-limit',        4)
  ) AS v(template_id, check_key, sort_order)
 WHERE cp.pack_key = 'sharepoint-onedrive-sharing-hardening-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.check_key = v.check_key
   );

-- Verification — the pack, its four rows, and the new we_can_run total (expect
-- current-before + 4; sibling fan-out builds #2037/#2039 may also be landing
-- concurrently, so this is a floor, not a fixed number).
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'sharepoint-onedrive-sharing-hardening-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-sharepoint-onedrive-sharing-hardening-2038.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

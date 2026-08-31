-- #1925 — Phase 2: author write packs for uncovered Groups-Governance checks.
--
-- WHY. After Phase 1 mapped every EXISTING execution-ready template to its check,
-- four Groups-Governance checks remained with no automation at all — no template
-- writes what they read, so they could never reach we_can_run. All four are cleanly
-- remediable by a single documented Microsoft Graph v1.0 write with no lockout risk
-- (no Conditional Access, no auth methods, no enrollment). This authors those writes
-- as baseline_action_templates and binds them to their checks in a new themed pack.
--
-- MICROSOFT DOCS FETCHED THIS SESSION (2026-08-31), not recalled — exact shapes taken
-- verbatim from these pages:
--   Add group owner .......... https://learn.microsoft.com/en-us/graph/api/group-post-owners
--        POST /groups/{id}/owners/$ref  body {"@odata.id":".../users/{id}"}  -> 204  (Group.ReadWrite.All)
--   Update group (visibility)  https://learn.microsoft.com/en-us/graph/api/group-update
--        PATCH /groups/{id}  body {"visibility":"Private"}  -> 204  (Group.ReadWrite.All)
--        (visibility is listed in the updatable-properties table; values Private|Public)
--   Create groupLifecyclePolicy https://learn.microsoft.com/en-us/graph/api/grouplifecyclepolicy-post-grouplifecyclepolicies
--        POST /groupLifecyclePolicies  body {groupLifetimeInDays,managedGroupTypes,alternateNotificationEmails} -> 201 (Directory.ReadWrite.All)
--
-- TYPED-BODY NOTE. resolveBaselineTemplateRequest() JSON-stringifies body_template,
-- string-substitutes {{var}}, then JSON.parses — so a numeric value bound through a
-- {{var}} would come back a STRING. groupLifetimeInDays (integer) is therefore a
-- hardcoded literal 365 in the body (same technique as quickstart's accountEnabled:true),
-- and only genuine string values (ids, UPN, email) use {{var}}.
--
-- DISTINCT TEMPLATE IDS. governance:public-groups-discoverable and
-- governance:public-teams-discoverable both remediate by the same PATCH-visibility
-- write, but getStepId() keys the pack graph on template_id, and a duplicate template_id
-- inside one pack breaks the topological sort (the known dup-row gap, #1484). Each check
-- therefore gets its OWN template_id so every config_pack_templates row is unique in-pack.
--
-- reversible=false / reverse_template_id=NULL on all four: no explicit single-step reverse
-- template is authored here, so the 6-template reverse count is not inflated.
--
-- IDEMPOTENT. Templates upsert on their unique template_id (DO NOTHING); the pack upserts
-- on its unique pack_key; the four mapping rows insert only WHERE NOT EXISTS for
-- (pack_id, check_key). A re-run writes nothing. Additive; reversible by deleting these
-- rows. All four target check_keys exist in monitor_checks (FK satisfied).

BEGIN;

-- ── 1. The four write templates ──────────────────────────────────────────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, status, reversible)
VALUES
  ('action.add-group-owner',
   'Add Group Owner',
   'Adds a user as an owner of an ownerless Microsoft 365 or security group via POST /groups/{id}/owners/$ref (Group.ReadWrite.All). Remediates governance:ownerless-groups. Ref: https://learn.microsoft.com/en-us/graph/api/group-post-owners',
   'governance', '/groups/{{groupId}}/owners/$ref', 'POST',
   '{"@odata.id": "https://graph.microsoft.com/v1.0/users/{{ownerId}}"}'::jsonb,
   '["groupId", "ownerId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false),

  ('action.set-group-visibility-private',
   'Set Group Visibility to Private',
   'Sets a public Microsoft 365 group''s visibility to Private via PATCH /groups/{id} (Group.ReadWrite.All), so it is no longer discoverable or joinable by anyone in the tenant. Remediates governance:public-groups-discoverable. Ref: https://learn.microsoft.com/en-us/graph/api/group-update',
   'governance', '/groups/{{groupId}}', 'PATCH',
   '{"visibility": "Private"}'::jsonb,
   '["groupId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false),

  ('action.set-team-visibility-private',
   'Set Team Visibility to Private',
   'Sets a public Team''s backing Microsoft 365 group visibility to Private via PATCH /groups/{id} (Group.ReadWrite.All) — every Team is backed by a group and visibility lives on that group object — so the team is no longer discoverable or joinable tenant-wide. Remediates governance:public-teams-discoverable. Ref: https://learn.microsoft.com/en-us/graph/api/group-update',
   'governance', '/groups/{{groupId}}', 'PATCH',
   '{"visibility": "Private"}'::jsonb,
   '["groupId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false),

  ('action.configure-group-expiration-policy',
   'Configure Group Expiration Policy',
   'Creates the tenant''s single group expiration (lifecycle) policy via POST /groupLifecyclePolicies (Directory.ReadWrite.All): a 365-day lifetime applied to All Microsoft 365 groups, with renewal notices sent to {{notificationEmail}}. Remediates governance:group-expiration-policy. Ref: https://learn.microsoft.com/en-us/graph/api/grouplifecyclepolicy-post-grouplifecyclepolicies',
   'governance', '/groupLifecyclePolicies', 'POST',
   '{"groupLifetimeInDays": 365, "managedGroupTypes": "All", "alternateNotificationEmails": "{{notificationEmail}}"}'::jsonb,
   '["notificationEmail"]'::jsonb, '{"expectStatus": 201}'::jsonb, 'active', false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('governance-groups-v1', 'Groups Governance Baseline',
   'Hardens Microsoft 365 group governance: assigns an owner to ownerless groups, makes public groups and teams private, and configures a tenant group expiration policy.',
   ARRAY['Governance','Identity'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind each template to the check it remediates ─────────────────────────
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order)
SELECT cp.id, v.template_id, v.check_key, v.sort_order
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.add-group-owner',                  'governance:ownerless-groups',           1),
    ('action.set-group-visibility-private',     'governance:public-groups-discoverable', 2),
    ('action.set-team-visibility-private',      'governance:public-teams-discoverable',  3),
    ('action.configure-group-expiration-policy','governance:group-expiration-policy',    4)
  ) AS v(template_id, check_key, sort_order)
 WHERE cp.pack_key = 'governance-groups-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.check_key = v.check_key
   );

-- Verification — the pack, its four templates, and the new we_can_run total (expect 20).
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'governance-groups-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-governance-groups-write-pack-1925.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

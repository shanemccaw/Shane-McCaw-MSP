-- Launch Control Phase 3 — First Batch Template Promotion
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
-- Run 2026-07-20-baseline-action-templates-delete-method.sql first (verifies the
-- "DELETE" method value is safely writable — see that file for why).
--
-- Promotes 8 write_action_catalog reference rows into 10 real, executable
-- baseline_action_templates rows. "Add/remove member" for Groups and Teams
-- each split into two templates (add vs. remove use different Graph
-- methods/endpoints, which one template row can't express).
--
-- Endpoints are RELATIVE Graph paths (e.g. "/users/{{userId}}"), matching how
-- graphWriteForTenant() builds the request (GRAPH_BASE + path) and the
-- graph_write_operation node's own documented "endpoint" format. NOTE: the
-- earlier 0195_baseline_templates_quickstart_data.sql quick-start pack seeded
-- its 8 templates with FULL absolute URLs
-- (e.g. "https://graph.microsoft.com/v1.0/policies/..."), which — given that
-- same GRAPH_BASE + path concatenation — would build a malformed
-- double-domain URL at execution time. That looks like a pre-existing bug in
-- those 8 templates, unrelated to and out of scope for this task; flagging it
-- here rather than silently leaving it unmentioned. Not touched by this file.
--
-- successCriteria is descriptive metadata only as of this writing —
-- runBaselineTemplateAgainstTenant() calls graphWriteForTenant() with a
-- hardcoded expectedStatusCodes of [200, 201, 204] regardless of this
-- column's contents (confirmed by reading workflow-executor.ts). Set to the
-- real expected status per Graph's documented response for each call so the
-- column stays honest, matching the {"statusCode": N} shape the 0195 seed
-- data already established.
--
-- Idempotent via ON CONFLICT ("template_id") DO NOTHING — safe to re-run.

INSERT INTO "baseline_action_templates"
  ("template_id", "label", "description", "category", "endpoint", "method", "body_template",
   "required_variables", "success_criteria", "depends_on", "requires_verification_gate", "status")
VALUES

  -- Users
  (
    'users.disable_enable_signin',
    'Disable / Enable User Sign-In',
    'Sets a user account''s accountEnabled flag — used to immediately block or restore sign-in for a specific user.',
    'Users',
    '/users/{{userId}}',
    'PATCH',
    '{"accountEnabled": {{accountEnabled}}}'::jsonb,
    '["userId", "accountEnabled"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  (
    'users.force_password_reset',
    'Force Password Reset',
    'Sets a new temporary password on a user account and forces a password change at next sign-in. The caller (route) must generate a real random temporary password before invoking this template — no default/hardcoded password is used here.',
    'Users',
    '/users/{{userId}}',
    'PATCH',
    '{"passwordProfile": {"forceChangePasswordNextSignIn": true, "password": "{{tempPassword}}"}}'::jsonb,
    '["userId", "tempPassword"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- Auth/MFA
  (
    'auth.revoke_signin_sessions',
    'Revoke Sign-In Sessions',
    'Invalidates a user''s refresh tokens and current sign-in sessions across all applications and devices — used to force re-authentication, e.g. after a suspected compromise.',
    'Auth/MFA',
    '/users/{{userId}}/revokeSignInSessions',
    'POST',
    '{}'::jsonb,
    '["userId"]'::jsonb,
    '{"statusCode": 200}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- Licensing
  (
    'licensing.assign_license',
    'Assign License',
    'Assigns a Microsoft 365 license (by SKU) to a user.',
    'Licensing',
    '/users/{{userId}}/assignLicense',
    'POST',
    '{"addLicenses": [{"skuId": "{{skuId}}"}], "removeLicenses": []}'::jsonb,
    '["userId", "skuId"]'::jsonb,
    '{"statusCode": 200}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  (
    'licensing.remove_license',
    'Remove License',
    'Removes a Microsoft 365 license (by SKU) from a user.',
    'Licensing',
    '/users/{{userId}}/assignLicense',
    'POST',
    '{"addLicenses": [], "removeLicenses": ["{{skuId}}"]}'::jsonb,
    '["userId", "skuId"]'::jsonb,
    '{"statusCode": 200}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- Groups
  (
    'groups.add_member',
    'Add Group Member',
    'Adds a user (or other directory object) as a member of a Microsoft 365 / security group.',
    'Groups',
    '/groups/{{groupId}}/members/$ref',
    'POST',
    '{"@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/{{memberId}}"}'::jsonb,
    '["groupId", "memberId"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  (
    'groups.remove_member',
    'Remove Group Member',
    'Removes a member from a Microsoft 365 / security group.',
    'Groups',
    '/groups/{{groupId}}/members/{{memberId}}/$ref',
    'DELETE',
    '{}'::jsonb,
    '["groupId", "memberId"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- Teams
  (
    'teams.add_member',
    'Add Team Member',
    'Adds a user as a member of a Microsoft Team.',
    'Teams',
    '/teams/{{teamId}}/members',
    'POST',
    '{"@odata.type": "#microsoft.graph.aadUserConversationMember", "roles": [], "user@odata.bind": "https://graph.microsoft.com/v1.0/users(''{{memberId}}'')"}'::jsonb,
    '["teamId", "memberId"]'::jsonb,
    '{"statusCode": 201}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  (
    'teams.remove_member',
    'Remove Team Member',
    'Removes a member from a Microsoft Team. IMPORTANT: {{membershipId}} is the Teams CONVERSATION MEMBERSHIP id, not the user id — the caller must first resolve it via GET /teams/{{teamId}}/members and match on userId before invoking this template. Passing a user id here will 404.',
    'Teams',
    '/teams/{{teamId}}/members/{{membershipId}}',
    'DELETE',
    '{}'::jsonb,
    '["teamId", "membershipId"]'::jsonb,
    '{"statusCode": 204}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  ),

  -- SharePoint/OneDrive
  (
    'sharepoint.restore_recycle_bin_item',
    'Restore Recycle Bin Item',
    'Restores a deleted file or folder from a SharePoint/OneDrive drive''s recycle bin back to its original (or a specified) location.',
    'SharePoint/OneDrive',
    '/drives/{{driveId}}/items/{{itemId}}/restore',
    'POST',
    '{}'::jsonb,
    '["driveId", "itemId"]'::jsonb,
    '{"statusCode": 200}'::jsonb,
    '[]'::jsonb,
    false,
    'active'
  )

ON CONFLICT ("template_id") DO NOTHING;

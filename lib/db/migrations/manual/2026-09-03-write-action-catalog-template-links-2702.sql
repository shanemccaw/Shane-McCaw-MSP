-- Git #2702 -- link write_action_catalog rows to their real baseline_action_templates.
--
-- Confirmed against local DATABASE_URL this session: 0/123 write_action_catalog rows
-- had template_id set, so POST /api/msp/:mspId/launch-control/execute
-- (artifacts/api-server/src/routes/msp-launch-control.ts:220-223) 409'd unconditionally --
-- every action a technician could pick via GET /msp/:mspId/launch-control/actions was
-- dead on arrival, despite 102 real, status='active' baseline_action_templates rows
-- already existing (seeded by 2026-07-20-launch-control-phase3-templates.sql and later
-- work -- NOT the same template_id naming scheme drafted in the archived
-- archive/diagnostics/2026-07-20-launch-control-phase3-catalog-link.sql plan, which was
-- never applied; the live templates use "action.*" / "microrem.*" / "quickstart-v1.*" /
-- "groups.*" / "roleManagement.*" slugs, not that file's "domain.verb_noun" draft).
--
-- write_action_catalog.template_id is TEXT and matches baseline_action_templates' own
-- natural key (its unique "template_id" column), not the numeric baseline row id -- see
-- both tables' schema. The execute route's only gate on this column is
-- "!catalogRow.templateId" (msp-launch-control.ts:220); "status" is not read by any
-- route logic (confirmed via grep of msp-launch-control.ts -- computeAvailability()
-- only reads safeOrGated/minBundledTier) -- it is a catalog-readiness/documentation
-- field only, but the issue asks it be kept honest too, so this migration promotes it
-- alongside the link.
--
-- Matching method: each of the 123 catalog rows' (domain, action_name) was compared by
-- hand against all 102 live baseline_action_templates rows' (category, label, endpoint)
-- for genuine domain/intent equivalence -- not fuzzy/substring matching. Every
-- template_id below was independently confirmed present in baseline_action_templates
-- before writing these UPDATEs.
--
--   85 matched  -> template_id set, status promoted to the new 'execution_ready' value.
--    7 already 'blocked'/'blocked_no_workaround' (ids 115, 171, 180-184 -- 5 Teams
--      admin-center-only policies, 1 SharePoint retention-label gap, 1 legacy
--      per-user-MFA API gap; each already correctly reflects a real, previously
--      documented platform gap) -> left untouched.
--   31 have no real matching template yet (e.g. "Reset MFA (all methods)", the generic
--      "Update CA policy" -- distinct from the matched "Delete CA policy" / "Manage
--      exclusions" / named-locations rows --, "Create team", "Create site collection",
--      "Enroll device (token)") -> left untouched rather than forced onto a template
--      that doesn't actually cover it, per this issue's own instruction not to guess a
--      link that can't be verified. These 31 are real, standing Launch Control coverage
--      gaps -- each remains a genuine future-template candidate, not a data-quality bug
--      introduced by this migration.
--
-- Two deliberate one-to-many links (verified against the templates' own endpoints, not
-- guessed):
--   - Groups "Add/remove member" (126) and Teams "Add/remove member" (177) both link to
--     action.add-group-member (POST /groups/{{groupId}}/members/$ref) -- a Microsoft
--     Team's membership IS group membership under the hood (a Team is backed by an M365
--     Group), so the same Graph call genuinely serves both catalog rows. Likewise Groups
--     "Add/remove owner" (127) and Teams "Add/remove owner" (178) both link to
--     action.add-group-owner. Only the "add" direction has a real template on either
--     side -- there is no matching "remove member/owner" baseline_action_template, so
--     the "remove" half of each combined catalog label stays uncovered -- a real gap,
--     not silently invented coverage.
--   - Exchange "Enable archive mailbox" (194) links to the dedicated
--     microrem.enable-mailbox-archive template; "Set mailbox quota" (195) links to
--     action.enable-archive-and-quota (whose own template_id literally names both
--     concerns, but whose label is "Set Mailbox Quota" -- the more specific dedicated
--     template was preferred for 194 instead).
--
-- Idempotent: every UPDATE is guarded by id + domain + action_name + "template_id IS
-- NULL", so re-running this file is a no-op once applied.

UPDATE write_action_catalog SET template_id = 'action.grant-admin-consent', status = 'execution_ready' WHERE id = 205 AND domain = 'App Registrations' AND action_name = 'Grant admin consent' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.remove-risky-app-consent', status = 'execution_ready' WHERE id = 206 AND domain = 'App Registrations' AND action_name = 'Revoke app permissions' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.disable-risky-app', status = 'execution_ready' WHERE id = 207 AND domain = 'App Registrations' AND action_name = 'Disable risky enterprise app' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.rotate-app-secret', status = 'execution_ready' WHERE id = 208 AND domain = 'App Registrations' AND action_name = 'Rotate app secret/cert' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.reassign-app-owner', status = 'execution_ready' WHERE id = 209 AND domain = 'App Registrations' AND action_name = 'Reassign app owner' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.remove-auth-method', status = 'execution_ready' WHERE id = 111 AND domain = 'Auth/MFA' AND action_name = 'Remove specific auth method' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.revoke-sign-in-sessions', status = 'execution_ready' WHERE id = 112 AND domain = 'Auth/MFA' AND action_name = 'Revoke all sign-in sessions' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.require-security-info-reregistration', status = 'execution_ready' WHERE id = 113 AND domain = 'Auth/MFA' AND action_name = 'Require security info re-registration' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.generate-temporary-access-pass', status = 'execution_ready' WHERE id = 114 AND domain = 'Auth/MFA' AND action_name = 'Generate Temporary Access Pass' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'quickstart-v1.create-ca-baseline-policy', status = 'execution_ready' WHERE id = 133 AND domain = 'Conditional Access' AND action_name = 'Create CA policy' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.delete-ca-policy', status = 'execution_ready' WHERE id = 135 AND domain = 'Conditional Access' AND action_name = 'Delete CA policy' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.manage-ca-exclusions', status = 'execution_ready' WHERE id = 137 AND domain = 'Conditional Access' AND action_name = 'Manage exclusions (break-glass handling)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-named-location', status = 'execution_ready' WHERE id = 138 AND domain = 'Conditional Access' AND action_name = 'Manage named locations/trusted IPs' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.remote-wipe-device', status = 'execution_ready' WHERE id = 148 AND domain = 'Devices/Intune' AND action_name = 'Remote wipe' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.retire-device', status = 'execution_ready' WHERE id = 149 AND domain = 'Devices/Intune' AND action_name = 'Retire device' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.remote-lock-device', status = 'execution_ready' WHERE id = 150 AND domain = 'Devices/Intune' AND action_name = 'Remote lock' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.remediate-device-compliance', status = 'execution_ready' WHERE id = 151 AND domain = 'Devices/Intune' AND action_name = 'Force sync' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.restart-device', status = 'execution_ready' WHERE id = 152 AND domain = 'Devices/Intune' AND action_name = 'Restart device' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.fresh-start-device', status = 'execution_ready' WHERE id = 153 AND domain = 'Devices/Intune' AND action_name = 'Fresh Start reset' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-compliance-policy-assignment', status = 'execution_ready' WHERE id = 154 AND domain = 'Devices/Intune' AND action_name = 'Update compliance policy assignment' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-config-profile-assignment', status = 'execution_ready' WHERE id = 155 AND domain = 'Devices/Intune' AND action_name = 'Update config profile assignment' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.assign-autopilot-profile', status = 'execution_ready' WHERE id = 156 AND domain = 'Devices/Intune' AND action_name = 'Assign Autopilot profile' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.unenroll-device', status = 'execution_ready' WHERE id = 158 AND domain = 'Devices/Intune' AND action_name = 'Unenroll device' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.assign-app-protection-policy', status = 'execution_ready' WHERE id = 159 AND domain = 'Devices/Intune' AND action_name = 'Assign app protection/MAM policy' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-device-category', status = 'execution_ready' WHERE id = 162 AND domain = 'Devices/Intune' AND action_name = 'Update device category/ownership' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-shared-mailbox', status = 'execution_ready' WHERE id = 185 AND domain = 'Exchange' AND action_name = 'Create shared mailbox' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-distribution-list', status = 'execution_ready' WHERE id = 186 AND domain = 'Exchange' AND action_name = 'Create distribution list' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-room-mailbox', status = 'execution_ready' WHERE id = 187 AND domain = 'Exchange' AND action_name = 'Create room/equipment mailbox' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.convert-user-to-shared-mailbox', status = 'execution_ready' WHERE id = 188 AND domain = 'Exchange' AND action_name = 'Convert user to shared mailbox (offboarding)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.set-forwarding-rule', status = 'execution_ready' WHERE id = 189 AND domain = 'Exchange' AND action_name = 'Set forwarding rule' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.set-mail-flow-rule', status = 'execution_ready' WHERE id = 190 AND domain = 'Exchange' AND action_name = 'Set mail flow/transport rule' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.grant-send-as', status = 'execution_ready' WHERE id = 191 AND domain = 'Exchange' AND action_name = 'Grant send-as' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.grant-full-access-delegate', status = 'execution_ready' WHERE id = 192 AND domain = 'Exchange' AND action_name = 'Grant full-access delegate' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.toggle-litigation-hold', status = 'execution_ready' WHERE id = 193 AND domain = 'Exchange' AND action_name = 'Litigation hold toggle' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.enable-mailbox-archive', status = 'execution_ready' WHERE id = 194 AND domain = 'Exchange' AND action_name = 'Enable archive mailbox' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.enable-archive-and-quota', status = 'execution_ready' WHERE id = 195 AND domain = 'Exchange' AND action_name = 'Set mailbox quota' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.block-outbound-send', status = 'execution_ready' WHERE id = 196 AND domain = 'Exchange' AND action_name = 'Block/unblock outbound send (compromise response)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.set-out-of-office', status = 'execution_ready' WHERE id = 197 AND domain = 'Exchange' AND action_name = 'Set out-of-office on behalf of user' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-m365-group', status = 'execution_ready' WHERE id = 123 AND domain = 'Groups' AND action_name = 'Create M365 group' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-security-group', status = 'execution_ready' WHERE id = 124 AND domain = 'Groups' AND action_name = 'Create security group' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.delete-group', status = 'execution_ready' WHERE id = 125 AND domain = 'Groups' AND action_name = 'Delete group' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.add-group-member', status = 'execution_ready' WHERE id = 126 AND domain = 'Groups' AND action_name = 'Add/remove member' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.add-group-owner', status = 'execution_ready' WHERE id = 127 AND domain = 'Groups' AND action_name = 'Add/remove owner' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-dynamic-group-rule', status = 'execution_ready' WHERE id = 129 AND domain = 'Groups' AND action_name = 'Update dynamic membership rule' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.set-group-expiration-policy', status = 'execution_ready' WHERE id = 130 AND domain = 'Groups' AND action_name = 'Set expiration policy' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.restore-deleted-group', status = 'execution_ready' WHERE id = 132 AND domain = 'Groups' AND action_name = 'Restore deleted group' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.assign-single-license', status = 'execution_ready' WHERE id = 116 AND domain = 'Licensing' AND action_name = 'Direct assign license' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.remove-unused-license', status = 'execution_ready' WHERE id = 117 AND domain = 'Licensing' AND action_name = 'Direct remove license' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.bulk-reassign-license', status = 'execution_ready' WHERE id = 118 AND domain = 'Licensing' AND action_name = 'Bulk reassign (CSV)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.group-based-license-assign', status = 'execution_ready' WHERE id = 119 AND domain = 'Licensing' AND action_name = 'Group-based license assignment' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.group-based-license-remove', status = 'execution_ready' WHERE id = 120 AND domain = 'Licensing' AND action_name = 'Remove group-based assignment' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.sku-swap', status = 'execution_ready' WHERE id = 121 AND domain = 'Licensing' AND action_name = 'SKU swap (e.g. E3 to E5)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.pim-assign-role-eligibility', status = 'execution_ready' WHERE id = 142 AND domain = 'PIM' AND action_name = 'Assign role eligibility' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.pim-remove-role-eligibility', status = 'execution_ready' WHERE id = 143 AND domain = 'PIM' AND action_name = 'Remove role eligibility' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.pim-activate-role', status = 'execution_ready' WHERE id = 144 AND domain = 'PIM' AND action_name = 'Activate eligible role' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.pim-approve-elevation', status = 'execution_ready' WHERE id = 145 AND domain = 'PIM' AND action_name = 'Approve/deny elevation request' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.pim-assign-permanent-role', status = 'execution_ready' WHERE id = 147 AND domain = 'PIM' AND action_name = 'Assign permanent role directly' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.resolve-alert', status = 'execution_ready' WHERE id = 198 AND domain = 'Security (Defender)' AND action_name = 'Resolve/dismiss alert' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.manage-incident', status = 'execution_ready' WHERE id = 199 AND domain = 'Security (Defender)' AND action_name = 'Manage incident (assign/classify/resolve)' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.isolate-device', status = 'execution_ready' WHERE id = 201 AND domain = 'Security (Defender)' AND action_name = 'Isolate device' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.block-file-hash', status = 'execution_ready' WHERE id = 202 AND domain = 'Security (Defender)' AND action_name = 'Block file hash' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.submit-file-detonation', status = 'execution_ready' WHERE id = 204 AND domain = 'Security (Defender)' AND action_name = 'Submit file/URL for detonation' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.enforce-tenant-sharing-policy', status = 'execution_ready' WHERE id = 168 AND domain = 'SharePoint/OneDrive' AND action_name = 'Tenant-level sharing setting' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.remove-sharing-link', status = 'execution_ready' WHERE id = 169 AND domain = 'SharePoint/OneDrive' AND action_name = 'Remove specific sharing link' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.deactivate-ownerless-team', status = 'execution_ready' WHERE id = 175 AND domain = 'Teams' AND action_name = 'Archive team' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.add-group-member', status = 'execution_ready' WHERE id = 177 AND domain = 'Teams' AND action_name = 'Add/remove member' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.add-group-owner', status = 'execution_ready' WHERE id = 178 AND domain = 'Teams' AND action_name = 'Add/remove owner' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.add-custom-domain', status = 'execution_ready' WHERE id = 210 AND domain = 'Tenant' AND action_name = 'Add/verify custom domain' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-org-contact-info', status = 'execution_ready' WHERE id = 211 AND domain = 'Tenant' AND action_name = 'Update org contact info' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'quickstart-v1.set-tenant-branding', status = 'execution_ready' WHERE id = 212 AND domain = 'Tenant' AND action_name = 'Update branding/sign-in page' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.create-user', status = 'execution_ready' WHERE id = 91 AND domain = 'Users' AND action_name = 'Create user' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.delete-user', status = 'execution_ready' WHERE id = 92 AND domain = 'Users' AND action_name = 'Delete user' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.restore-deleted-user', status = 'execution_ready' WHERE id = 94 AND domain = 'Users' AND action_name = 'Restore deleted user' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.disable-user-signin', status = 'execution_ready' WHERE id = 95 AND domain = 'Users' AND action_name = 'Disable/enable sign-in' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'microrem.force-password-reset', status = 'execution_ready' WHERE id = 96 AND domain = 'Users' AND action_name = 'Force password reset' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.admin-set-password', status = 'execution_ready' WHERE id = 97 AND domain = 'Users' AND action_name = 'Admin-set password directly' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-display-name', status = 'execution_ready' WHERE id = 98 AND domain = 'Users' AND action_name = 'Update display name' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-upn', status = 'execution_ready' WHERE id = 99 AND domain = 'Users' AND action_name = 'Update UPN/primary alias' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-department', status = 'execution_ready' WHERE id = 101 AND domain = 'Users' AND action_name = 'Update department' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-job-title', status = 'execution_ready' WHERE id = 102 AND domain = 'Users' AND action_name = 'Update job title' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-manager', status = 'execution_ready' WHERE id = 103 AND domain = 'Users' AND action_name = 'Update manager' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-office-location', status = 'execution_ready' WHERE id = 104 AND domain = 'Users' AND action_name = 'Update office location' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-usage-location', status = 'execution_ready' WHERE id = 105 AND domain = 'Users' AND action_name = 'Update usage location' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.update-employee-id-type', status = 'execution_ready' WHERE id = 106 AND domain = 'Users' AND action_name = 'Update employee ID/type' AND template_id IS NULL;
UPDATE write_action_catalog SET template_id = 'action.convert-user-to-guest', status = 'execution_ready' WHERE id = 107 AND domain = 'Users' AND action_name = 'Convert user to guest / offboard' AND template_id IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-write-action-catalog-template-links-2702.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

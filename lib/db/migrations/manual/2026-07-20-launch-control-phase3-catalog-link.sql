-- Launch Control Phase 3 — link promoted templates back to write_action_catalog
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
-- Run AFTER 2026-07-20-launch-control-phase3-templates.sql has been applied
-- AND after you have independently confirmed all 10 templates below actually
-- execute successfully via POST /api/admin/baseline-templates/:templateId/test
-- against an isTestbed customer. This session (Claude Code, no DATABASE_URL /
-- DB connectivity here) could not run that live test itself and did not mark
-- Launch Control Phase 3 done in PLATFORM_BUILD.md — see that row for the
-- full explanation. Do not set status = 'promoted' on any row below until
-- you've done that confirmation yourself.
--
-- write_action_catalog has 123 rows seeded via a manual SQL run outside this
-- repo (no seed file checked in, no information_schema access from this
-- session) — the exact `action_name` text for each of the 8 source rows is
-- NOT known here. Rather than hand you hardcoded `WHERE id = N` statements
-- built from ids/names this session could not verify (the task explicitly
-- warns ids may have shifted), every UPDATE below is a two-step
-- SELECT-to-confirm, then UPDATE-by-id-literal you fill in after looking at
-- the SELECT's result. This is slower than a canned script but means you're
-- never trusting a guessed row identity for a real production update.
--
-- Run this first and read the results before touching anything below:

SELECT id, domain, action_name, status, template_id
FROM write_action_catalog
WHERE domain IN ('Users', 'Auth/MFA', 'Licensing', 'Groups', 'Teams', 'SharePoint/OneDrive')
ORDER BY sort_order;

-- ────────────────────────────────────────────────────────────────────────────
-- Straightforward 1:1 links (6 catalog rows, 6 templates)
-- For each: find the row above whose action_name matches the description,
-- substitute its real id for <ID>, then run the UPDATE.
-- ────────────────────────────────────────────────────────────────────────────

-- Users — "Disable / enable a user's sign-in" (or similarly worded)
-- UPDATE write_action_catalog SET template_id = 'users.disable_enable_signin', status = 'promoted' WHERE id = <ID>;

-- Users — "Force password reset"
-- UPDATE write_action_catalog SET template_id = 'users.force_password_reset', status = 'promoted' WHERE id = <ID>;

-- Auth/MFA — "Revoke sign-in sessions"
-- UPDATE write_action_catalog SET template_id = 'auth.revoke_signin_sessions', status = 'promoted' WHERE id = <ID>;

-- Licensing — "Assign license" (NOT the same catalog row as "Remove license" —
-- confirm the SELECT above actually has two separate license rows before
-- assuming this split matches 1:1; if the catalog only has ONE combined
-- "Assign/remove license" row, treat it the same way as the Groups/Teams
-- split below rather than guessing which template it should point at)
-- UPDATE write_action_catalog SET template_id = 'licensing.assign_license', status = 'promoted' WHERE id = <ID>;

-- Licensing — "Remove license"
-- UPDATE write_action_catalog SET template_id = 'licensing.remove_license', status = 'promoted' WHERE id = <ID>;

-- SharePoint/OneDrive — "Restore recycle bin item"
-- UPDATE write_action_catalog SET template_id = 'sharepoint.restore_recycle_bin_item', status = 'promoted' WHERE id = <ID>;

-- ────────────────────────────────────────────────────────────────────────────
-- OPEN DESIGN QUESTION — do not guess, per the task's own instruction.
--
-- Groups "Add/remove member" and Teams "Add/remove member" are each a SINGLE
-- catalog row, but were promoted into TWO templates each (groups.add_member /
-- groups.remove_member; teams.add_member / teams.remove_member) — Graph uses
-- a different HTTP method for add vs. remove, which one template row can't
-- express. write_action_catalog.template_id can only hold one value per row,
-- so each of these two catalog rows needs a decision on which of its pair is
-- "primary" (add or remove) for direct catalog-driven execution.
--
-- Neither is obviously primary: add-member is more common in day-to-day
-- provisioning (onboarding), but remove-member is arguably the more
-- consequential/urgent one for an MSP technician to have single-click access
-- to (offboarding, incident response). This session is not picking one
-- silently. Both templates exist and both are fully runnable (e.g. via a
-- future dedicated catalog row, a workflow's execute_baseline_template node,
-- or a direct POST /api/admin/baseline-templates/:templateId/test call)
-- regardless of which one this single catalog row ends up pointing at.
--
-- Once you've decided, run ONE of the two UPDATEs for each pair (leave the
-- other commented out):

-- Groups — "Add/remove member" catalog row
-- UPDATE write_action_catalog SET template_id = 'groups.add_member',    status = 'promoted' WHERE id = <ID>;  -- if add is primary
-- UPDATE write_action_catalog SET template_id = 'groups.remove_member', status = 'promoted' WHERE id = <ID>;  -- if remove is primary

-- Teams — "Add/remove member" catalog row
-- UPDATE write_action_catalog SET template_id = 'teams.add_member',    status = 'promoted' WHERE id = <ID>;  -- if add is primary
-- UPDATE write_action_catalog SET template_id = 'teams.remove_member', status = 'promoted' WHERE id = <ID>;  -- if remove is primary

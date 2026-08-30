-- 2026-08-29-drop-cc-approvers-table-1759.sql
--
-- #1759 — Change Control: the approval policy is now authoritative. Approver
-- eligibility derives live from `users.can_approve_changes` (the same capability
-- the approve/reject routes enforce), so the parallel stored approver set —
-- `portal_change_control_approvers`, with its `normal`/`emergency` bands — is
-- redundant and is dropped. This resolves #1757 (which proposed cross-validating
-- the two eligibility stores) by deletion rather than by patch.
--
-- The table was created 2026-08-29 by #1592 and confirmed to have ZERO rows on
-- the local database before this drop was written (`SELECT count(*)` = 0), so no
-- customer configuration is lost. Approver policy config (required signatures,
-- separate-approver, freeze, emergency, gated) lives on
-- `portal_change_control_policy`, which is untouched.

BEGIN;

DROP TABLE IF EXISTS portal_change_control_approvers;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-drop-cc-approvers-table-1759.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

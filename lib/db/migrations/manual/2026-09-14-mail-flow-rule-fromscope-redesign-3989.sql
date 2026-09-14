-- 2026-09-14-mail-flow-rule-fromscope-redesign-3989.sql
-- Git #3989 -- baseline_action_templates row id=75 (action.set-mail-flow-rule)
-- named a "Condition" parameter New-TransportRule does not have (its real
-- conditions are individual predicate params: From, FromScope,
-- SubjectContainsWords, ...). Shane's decision (issue comment,
-- 2026-09-14): expose -FromScope NotInOrganization -- "sender is external"
-- -- as the one real condition this template fires, fixed in the template
-- body rather than taken as a variable, since the whole point of the
-- action is "external senders only." required_variables drops "condition"
-- accordingly.
--
-- Paired code changes in the same commit: New-TransportRule added to
-- services/ps-execution/cmdlet-catalog.ps1's write entries (AllowedParams
-- limited to exactly Name, SetSCL, FromScope) and to
-- artifacts/api-server/src/lib/exchange-online-transport.ts's
-- EXCHANGE_ONLINE_CMDLET_KEYS map, matching #3948's established pattern for
-- the other 6 allowlisted write cmdlets.
--
-- write_action_catalog row id=190 stays 'endpoint_design_pending' here,
-- matching the posture #3948 already established for its 6 sibling rows
-- (185/188/191/192/194/196 -- all left un-promoted pending live
-- verification, per that commit's own "NOT live-verified... no
-- write_action_catalog row promoted" note): #3530 (Key Vault
-- 'ShaneMcCawConsulting' subscription disabled, confirmed still open this
-- session) leaves ca-ps-execution-dev unreachable, so this build cannot
-- fire a real New-TransportRule call to confirm the rule lands with
-- FromScope honored. blocked_reason is updated to name the real, current
-- blocker (the transport now exists and is wired; verification is what's
-- pending) instead of the stale #3936 "no executor for this scheme" text,
-- which #3948 already made untrue.
--
-- Idempotent: both statements are guarded UPDATEs keyed on id + a content
-- check, safe to re-run.

BEGIN;

UPDATE baseline_action_templates
SET body_template = '{"Name": "{{ruleName}}", "SetSCL": "{{scl}}", "FromScope": "NotInOrganization"}'::jsonb,
    required_variables = '["ruleName", "scl"]'::jsonb,
    updated_at = now()
WHERE id = 75
  AND template_id = 'action.set-mail-flow-rule';

UPDATE write_action_catalog
SET blocked_reason = 'Template redesigned around New-TransportRule''s real -FromScope NotInOrganization predicate (Git #3989) and the cmdlet is now allowlisted in services/ps-execution/cmdlet-catalog.ps1 + exchange-online-transport.ts, matching #3948''s pattern for its 6 sibling write cmdlets. Left endpoint_design_pending (not execution_ready) because #3530 (Key Vault ''ShaneMcCawConsulting'' subscription disabled) leaves ca-ps-execution-dev unreachable for live verification -- same un-promoted posture #3948 left its 6 sibling rows (185/188/191/192/194/196) in. Promote once #3530 clears and a real New-TransportRule -FromScope NotInOrganization -SetSCL <n> call is confirmed against the testbed tenant.'
WHERE id = 190
  AND template_id = 'action.set-mail-flow-rule';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-mail-flow-rule-fromscope-redesign-3989.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

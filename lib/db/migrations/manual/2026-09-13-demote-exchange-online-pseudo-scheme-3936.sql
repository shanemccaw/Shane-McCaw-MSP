-- Git #3936 -- Launch Control safety fix: demote write_action_catalog rows that are
-- linked to a baseline_action_templates row using the made-up "exchange-online://"
-- pseudo-scheme, back off "execution_ready".
--
-- runBaselineTemplateAgainstTenant() (artifacts/api-server/src/lib/workflow-executor.ts)
-- unconditionally routes every template through graphWriteForTenant()
-- (artifacts/api-server/src/lib/graph.ts), which only ever builds a Microsoft Graph
-- HTTP request -- there is no handling anywhere for "exchange-online://" (confirmed:
-- grep -rn "exchange-online" artifacts/api-server/src/lib/workflow-executor.ts -> zero
-- hits). Calling any of these templates today sends a literal
-- "https://graph.microsoft.com/v1.0exchange-online://Set-Mailbox"-shaped URL to Graph,
-- which 400s/404s -- it does not perform the intended Exchange Online write. A real
-- Exchange-Online-PowerShell execution path exists (ps-execution-client.ts, used by
-- monitoring/config-snapshot code) but is not wired to Launch Control. That wiring is
-- real, separate architectural work (a second execution transport for the workflow
-- engine) -- out of scope here, filed as its own sibling issue under #2494 per this
-- issue's own instruction. This migration only implements option (b): stop advertising
-- these 12 already-linked catalog rows as ready to execute.
--
-- Live reconcile at session start (2026-09-13): the 13 templates named in #3936's own
-- filing query are unchanged (still exactly 13 exchange-online:// rows in
-- baseline_action_templates). Of those, 12 have a linked write_action_catalog row, all
-- currently 'execution_ready' (ids 185-196); action.remove-forwarding-rule has no
-- linked catalog row today, so nothing to demote for it.
--
-- Status value 'endpoint_design_pending' matches the column's existing real vocabulary
-- (endpoint_design_pending / blocked_no_workaround / metadata_pending / execution_ready)
-- -- no new status string invented. Explanation recorded in "blocked_reason", following
-- the real precedent already set on catalog id 204 (action.submit-file-detonation),
-- which uses that column for exactly this "no real endpoint behind this yet" note.
--
-- Idempotent: guarded by template_id IN (...) AND status = 'execution_ready', so a
-- re-run is a no-op once applied.

UPDATE "write_action_catalog"
SET
  "status" = 'endpoint_design_pending',
  "blocked_reason" = 'Linked template''s endpoint uses a made-up "exchange-online://" pseudo-scheme (Git #3936). runBaselineTemplateAgainstTenant() -> graphWriteForTenant() only ever builds a Microsoft Graph HTTP request; there is no executor for this scheme, so calling this action today sends a malformed URL to Graph and fails, not a real Exchange Online write. A real Exchange-Online-PowerShell path exists (ps-execution-client.ts) but is not wired to Launch Control -- that wiring is separate, unbuilt architectural work. Demoted off execution_ready until a real transport exists.'
WHERE "template_id" IN (
  'action.block-outbound-send',
  'action.convert-user-to-shared-mailbox',
  'action.create-distribution-list',
  'action.create-room-mailbox',
  'action.create-shared-mailbox',
  'action.enable-archive-and-quota',
  'action.grant-full-access-delegate',
  'action.grant-send-as',
  'action.remove-forwarding-rule',
  'action.set-forwarding-rule',
  'action.set-mail-flow-rule',
  'action.toggle-litigation-hold',
  'microrem.enable-mailbox-archive'
)
AND "status" = 'execution_ready';

-- Git #497 self-marking row so Simulator Studio's Migrations tree checkbox reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-demote-exchange-online-pseudo-scheme-3936.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

-- 2026-09-16-promote-exchange-online-verified-rows-3948.sql
-- Git #3948 -- promote the exchange-online:// write_action_catalog rows whose templates
-- were LIVE-VERIFIED through the new PowerShell transport, per the dispatch's rule:
-- "only the ones actually covered by templates you've live-verified ... don't blanket-
-- promote all 12."
--
-- Verification session 2026-09-16 (build 2653), dev container revision
-- ca-ps-execution-dev--b3948b, testbed customer 1 (mccawsoft2.onmicrosoft.com), after
-- #4269's ps-execution-write-scoped role grant propagated. Each row below had its real
-- template executed end-to-end (POST /api/admin/baseline-templates/:id/test ->
-- runBaselineTemplateAgainstTenant -> exchange-online transport -> callPsExecution),
-- container 200 / success:true, with baseline_action_template_audit_log evidence:
--
--   185 action.create-shared-mailbox      audit 62  + read-back: zz-test-shared-3948
--                                                     exists as SharedMailbox
--   187 action.create-room-mailbox        audit 64  + read-back: zz-test-room-3948
--                                                     exists as RoomMailbox
--   189 action.set-forwarding-rule        audit 65  (and the row-less sibling
--                                                    action.remove-forwarding-rule,
--                                                    audit 66, undid it cleanly)
--   191 action.grant-send-as              audit 67
--   192 action.grant-full-access-delegate audit 68
--   193 action.toggle-litigation-hold     audit 71  (verified with enabled=false --
--                                                    real Set-Mailbox execution + bool
--                                                    coercion; the enable direction
--                                                    needs a litigation-hold-licensed
--                                                    target and was not fired)
--   194 microrem.enable-mailbox-archive   audit 72  + read-back: ArchiveStatus=Active
--   195 action.enable-archive-and-quota   audit 69  + read-back: ProhibitSendQuota
--                                                     changed to ~49.5 GB
--
-- NOT promoted, each with an accurate blocked_reason below:
--   186 action.create-distribution-list   -- New-DistributionGroup cmdlet_unavailable
--                                            (audit 63): role group lacks the
--                                            Distribution Groups role -> #4428
--   188 action.convert-user-to-shared-mailbox -- no safe live-test target (would
--                                            convert a real user's mailbox; no spare
--                                            licensed test user exists)
--   190 action.set-mail-flow-rule         -- deliberately not live-fired: creates an
--                                            org-wide transport rule and Remove-
--                                            TransportRule is not allowlisted, so a
--                                            test rule could not be cleaned up ->
--                                            Shane's call (see #3948 2026-09-15
--                                            comment)
--   196 action.block-outbound-send        -- executed (audit 70) but read-back shows
--                                            MaxSendSize unchanged at org default
--                                            35 MB: success without effect -> #4429
--
-- Idempotent: guarded UPDATEs keyed on id + template_id.

BEGIN;

UPDATE write_action_catalog
SET status = 'execution_ready',
    blocked_reason = NULL
WHERE (id, template_id) IN (
  (185, 'action.create-shared-mailbox'),
  (187, 'action.create-room-mailbox'),
  (189, 'action.set-forwarding-rule'),
  (191, 'action.grant-send-as'),
  (192, 'action.grant-full-access-delegate'),
  (193, 'action.toggle-litigation-hold'),
  (194, 'microrem.enable-mailbox-archive'),
  (195, 'action.enable-archive-and-quota')
);

UPDATE write_action_catalog
SET blocked_reason = 'Transport verified (#3948) but New-DistributionGroup is cmdlet_unavailable in the app-only session (audit 63, 2026-09-16): the ps-execution-write-scoped role group lacks the Distribution Groups management role. Promote after #4428 (Shane To-Do) lands and a live create-distribution-list test passes.'
WHERE id = 186 AND template_id = 'action.create-distribution-list';

UPDATE write_action_catalog
SET blocked_reason = 'Transport verified for all sibling Set-Mailbox templates (#3948, 2026-09-16) but this template has no safe live-test target: it converts a REAL user mailbox to shared, and no spare licensed test user exists in the testbed tenant. Promote after a live verification against a sanctioned target.'
WHERE id = 188 AND template_id = 'action.convert-user-to-shared-mailbox';

UPDATE write_action_catalog
SET blocked_reason = 'Transport + New-TransportRule allowlisting in place (#3948/#3989) but deliberately NOT live-fired: this creates an org-wide mail flow rule in the tenant (which is also Shane''s production M365), and Remove-TransportRule is not allowlisted, so a test rule could not be cleaned up by the agent. Needs Shane''s go-ahead (or an allowlisted removal path) before live verification + promotion — see #3948''s 2026-09-15 comment.'
WHERE id = 190 AND template_id = 'action.set-mail-flow-rule';

UPDATE write_action_catalog
SET blocked_reason = 'Live-fired 2026-09-16 (audit 70): cmdlet succeeds but read-back shows MaxSendSize unchanged at the 35 MB org default ~3 and ~20 minutes later — Set-Mailbox -MaxSendSize "0B" reports success without applying the block. Success-without-effect on a compromise-response action; not promotable until the template is redesigned with a verifiable mechanism — see #4429.'
WHERE id = 196 AND template_id = 'action.block-outbound-send';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-promote-exchange-online-verified-rows-3948.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

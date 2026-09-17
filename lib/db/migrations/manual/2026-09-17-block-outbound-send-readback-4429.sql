-- 2026-09-17-block-outbound-send-readback-4429.sql
-- Git #4429 -- action.block-outbound-send reported success without effect.
--
-- Live evidence (#3948, 2026-09-16, audit 70): Set-Mailbox -MaxSendSize "0B" returned
-- container 200 against zz-test-shared-3948@mccawsoft2.onmicrosoft.com, while
-- Get-Mailbox still showed MaxSendSize = 35 MB (36,700,160 bytes) at +3 and +20 min.
--
-- This migration does NOT change the write mechanism -- no replacement has been
-- live-verified yet, and shipping an unverified one would repeat the defect. It adds
-- a read-back to the template's success_criteria (consumed by
-- runExchangeOnlineTemplateAgainstTenant via exchange-online-readback.ts): after the
-- cmdlet returns, the ps-execution read entry get-mailbox-send-restrictions re-reads
-- the same Identity until MaxSendSizeBytes = 0 or the bounded budget runs out. An
-- unconfirmed end state is now reported as success=false instead of success.
--
-- Until the container revision carrying get-mailbox-send-restrictions is deployed to
-- ca-ps-execution-dev, the read fails (unknown cmdletKey) -> the execution reports
-- read_failed -> still a FAILURE, never a false success. Fail-closed either way.
--
-- write_action_catalog id 196 stays endpoint_design_pending; blocked_reason refreshed.

BEGIN;

UPDATE baseline_action_templates
SET success_criteria = '{"expectStatus": 200, "readBack": {"cmdletKey": "get-mailbox-send-restrictions", "params": {"Identity": "Identity"}, "expect": {"MaxSendSizeBytes": 0}}}'::jsonb,
    updated_at = now()
WHERE template_id = 'action.block-outbound-send';

UPDATE write_action_catalog
SET blocked_reason = 'Live-fired 2026-09-16 (audit 70): Set-Mailbox -MaxSendSize "0B" reported success but read-back showed the 35 MB org default at +3/+20 min. #4429 added a read-back gate (success_criteria.readBack -> get-mailbox-send-restrictions, MaxSendSizeBytes = 0), so this template now FAILS loudly instead of claiming success. Not promotable until a block mechanism is live-verified against a zz-test-* shared mailbox and the new ps-execution read entry is deployed to ca-ps-execution-dev -- see #4429.'
WHERE id = 196 AND template_id = 'action.block-outbound-send';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-block-outbound-send-readback-4429.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- 2026-09-15-exchange-online-catalog-blocked-reason-refresh-3948.sql
-- Git #3948 -- refresh blocked_reason on the 12 exchange-online:// write_action_catalog
-- rows (ids 185-196) to name the REAL, current blocker, replacing two generations of
-- stale text:
--   * the #3936 text ("no executor for this scheme") -- untrue since 286fc94c6 built the
--     transport;
--   * the #3989 text on id 190 ("#3530 ... leaves ca-ps-execution-dev unreachable") --
--     untrue since 2026-09-15: Azure billing was restored, the cae-smccaw-2184 compute
--     suspension cleared (#4265, closed), and revision ca-ps-execution-dev--b3948b built
--     from current main is live and serving.
--
-- Live verification this session (2026-09-15, build 2653) moved the blocker one hop
-- further: the transport itself works end-to-end -- a read control
-- (get-safe-links-policies) through the SAME app-only Connect-ExchangeOnline session
-- returned real policy objects -- but every WRITE cmdlet fails cmdlet_unavailable
-- (baseline_action_template_audit_log ids 56/57: New-Mailbox via
-- action.create-shared-mailbox, Set-Mailbox via action.block-outbound-send) because the
-- connecting app (MT_APP_CLIENT_ID 9ea2e409-d1b9-422a-8451-02fa0b98d1c3) holds only
-- View-Only Organization Management. Granting it an Exchange RBAC write role is a
-- Git #1913 production-boundary action, filed as #4269 (Shane To-Do; #3948 blocked_by
-- #4269).
--
-- Status stays 'endpoint_design_pending' on all 12 rows -- promotion to
-- 'execution_ready' happens per-row only after a template live-verifies through the
-- transport once #4269 lands (per #3948's dispatch: no blanket promotion).
--
-- Idempotent: plain guarded UPDATE keyed on id range + template_id linkage; re-run just
-- rewrites the same text.

BEGIN;

UPDATE write_action_catalog
SET blocked_reason = 'Transport built (#3948, 286fc94c6) and live-verified to the last hop 2026-09-15: dev container revision b3948b serving, app-only Exchange session works (read control get-safe-links-policies returned real data). Blocked solely on #4269 -- the connecting app (MT app 9ea2e409) has no Exchange RBAC WRITE role, so every write cmdlet fails cmdlet_unavailable (audit ids 56/57). Once Shane grants the role (#4269, Shane To-Do), re-dispatch #3948: live-verify per template and promote exactly the verified rows to execution_ready.'
WHERE id BETWEEN 185 AND 196
  AND status = 'endpoint_design_pending'
  AND template_id IS NOT NULL;

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-exchange-online-catalog-blocked-reason-refresh-3948.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

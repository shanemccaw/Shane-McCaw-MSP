-- ============================================================================
-- #1114 — Fix onedrive:sync-errors (#753) blank-vs-non-blank assumption
-- ============================================================================
-- Manual migration — self-executed via shaneapp://executeSql per current
-- CLAUDE.md. Idempotent: UPDATE is safe to re-run.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Follow-up from #1105, confirmed live in #1114's own investigation:
-- Microsoft's usage-report "Last Activity Date" is NOT bounded to the
-- `period` query parameter -- it is the most recent activity EVER recorded.
-- Live-verified via `shaneapp://executeScan?scan=onedrive:sync-errors`
-- against the testbed tenant (customer_id=1,
-- c4c814d4-3afe-441e-9145-62461d0a4fd3): the tenant's one OneDrive account
-- returned "Last Activity Date": "2026-07-02" against
-- "Report Refresh Date": "2026-08-16" -- 45 days stale, well outside the
-- `period='D30'` window -- yet NON-blank, so the original
-- `{{Last Activity Date}} == "" && {{Is Deleted}} == "False"` predicate
-- scored it 0 (not flagged) when it should have counted as a stale account.
-- This is the same root cause #1105 already fixed for the 3 adoption
-- active-user checks (mapping read the field as a period-bounded activity
-- flag when Graph does not bound it that way at all).
--
-- ── THE FIX ─────────────────────────────────────────────────────────────
-- Same `newerThanDays`/`olderThanDays` grammar #1105 used, composed with the
-- documented `== "" || ... olderThanDays N` pattern from monitor-executor.ts
-- (~L630) so a genuinely blank field (this issue's "never had recorded
-- activity, full stop" case) still counts as stale, not just an old but
-- present date. `evalConditionGrammar` has NO parenthesis/precedence support
-- (~L652-661: a flat split on `||` then `&&` within each OR segment, verified
-- live -- an initial parenthesized draft of this expression silently broke,
-- always evaluating false, because the trailing `)` landed inside the
-- `olderThanDays 30)` clause and failed its `^\d+$` digit-only guard), so
-- `(A || B) && C` is distributed by hand into `(A && C) || (B && C)`:
--   {{Last Activity Date}} == "" && {{Is Deleted}} == "False"
--   || {{Last Activity Date}} olderThanDays 30 && {{Is Deleted}} == "False"
-- Severity thresholds (>=20 critical, >0 warning) are unchanged -- the unit
-- being counted (stale-sync accounts) is the same, only which accounts
-- qualify as stale is corrected.
-- ============================================================================

BEGIN;

UPDATE "monitor_checks"
SET
  "description" = 'Real per-tenant OneDrive sync health proxy (#753, period-bounded fix #1114) -- Graph has no sync-error API, so this reads GET /reports/getOneDriveUsageAccountDetail(period=''D30'') and counts accounts with a BLANK or 30+-day-stale "Last Activity Date" that are NOT marked deleted. #1114 corrected the original blank-vs-non-blank read: Microsoft''s "Last Activity Date" is NOT bounded by the endpoint''s own `period` param (confirmed live -- a 45-day-old date came back non-blank against a D30 window), so a present-but-stale date was silently undercounted as healthy. This is an honest PROXY for client-side sync errors, not a literal read of them -- most flagged accounts are a stale/out-of-date OneDrive client rather than a genuine service fault. App permission Reports.Read.All only. Backs Remediation Guide Step 28 and unblocks #658''s dynamic step selection for that step.',
  "mapping" = '[{"sourceField":"value","targetField":"oneDriveStaleSyncAccountCount","transform":"countWhere(''{{Last Activity Date}} == \"\" && {{Is Deleted}} == \"False\" || {{Last Activity Date}} olderThanDays 30 && {{Is Deleted}} == \"False\"'')"},
    {"sourceField":"Owner Principal Name","targetField":"oneDriveAccountsScanned","transform":"count"}]'::jsonb
WHERE "key" = 'onedrive:sync-errors';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-onedrive-sync-errors-period-fix-1114.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════════════════════
SELECT key, mapping FROM monitor_checks WHERE key = 'onedrive:sync-errors';

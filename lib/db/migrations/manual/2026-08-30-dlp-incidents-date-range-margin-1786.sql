-- Git #1786: compliance:dlp-incidents (Export-ActivityExplorerData) was failing
-- 100% live with:
--   System.ArgumentException: Date range must be within the past 30 days and
--   cannot include future dates.
-- Confirmed via the ps-execution container's own Log Analytics trace (not a
-- guess) — this is a genuine data bug, not a container/auth problem: the
-- other 13 PowerShell-path checks in the same run succeeded.
--
-- Root cause: StartTime was computed as EXACTLY "now minus 30*24h" at request-
-- build time in the api-server (monitor-executor.ts resolvePsParamsPlaceholders,
-- {30DaysAgo}). By the time the request reaches the actual Export-
-- ActivityExplorerData call server-side — after container cold-start, Graph
-- auth, and Connect-IPPSSession (observed childElapsedMs up to ~12s in the
-- same run) — the elapsed range is StartTime..now() where now() has moved
-- forward those extra seconds, pushing the total range fractionally PAST
-- Microsoft's 30-day ceiling and tripping the strict boundary check.
--
-- Fix: back StartTime off to 29 days instead of 30, giving a full day of
-- margin against request/connect latency — far more than the observed
-- ~12-second gap ever needs, so no real DLP-incident coverage is lost.

UPDATE monitor_checks
SET ps_params = jsonb_set(ps_params, '{StartTime}', '"{29DaysAgo}"')
WHERE key = 'compliance:dlp-incidents'
  AND ps_params->>'StartTime' = '{30DaysAgo}';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-dlp-incidents-date-range-margin-1786.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

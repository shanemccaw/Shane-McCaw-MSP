-- ═══════════════════════════════════════════════════════════════
-- #2728 — sla_timers.status DEFAULT was 'active', but every reader in
-- sla-engine.ts (fetchRunningTimers, resolveSlaTimer) hardcodes 'running'
-- (or requires it in an IN-list). startSlaTimer() never listed `status`
-- in its INSERT column list, so every timer created through it started,
-- and permanently stayed, at the dead 'active' default — invisible to
-- the SLA engine's breach/warning evaluation and unresolvable via
-- POST /msp/sla/timers/:timerId/resolve.
--
-- Fix direction (b) from the issue body: change the column DEFAULT to
-- 'running' to match what every reader already expects. startSlaTimer()
-- is also updated in the same commit to explicitly INSERT status='running'
-- rather than rely on the default alone. GET /msp/sla/summary's
-- activeTimers count (msp-sla.ts) is updated in the same commit to read
-- status = 'running' instead of the now-dead 'active' value.
--
-- No existing sla_timers rows exist locally to backfill (0 rows, per the
-- issue body) — this is a DEFAULT-only change, but the UPDATE below is
-- included defensively in case any 'active' rows exist in another
-- environment this file is later run against.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE sla_timers ALTER COLUMN status SET DEFAULT 'running';

UPDATE sla_timers SET status = 'running', updated_at = NOW() WHERE status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-sla-timers-status-default-running-2728.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

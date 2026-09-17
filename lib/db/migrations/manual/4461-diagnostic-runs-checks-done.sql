-- ═══════════════════════════════════════════════════════════════
-- Git #4461 — live progress index for msp_diagnostic_runs.
--
-- checks_ok / checks_error / checks_license_gap / checks_total are only
-- written once, after the whole run finishes (diagnostics-runner.ts). While a
-- run is active they're all 0, so the portal's poll-fallback derivation of
-- "check N of M" (useScanState.ts) has nothing real to read and stalls at 1
-- until an SSE event reaches that tab. checks_done is written throttled from
-- the runner's onProgress callback so a fresh page load can show the real
-- mid-run position.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "msp_diagnostic_runs" ADD COLUMN IF NOT EXISTS "checks_done" INTEGER NOT NULL DEFAULT 0;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4461-diagnostic-runs-checks-done.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

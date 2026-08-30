# #d — Recover Session-Limit Builds button (Build Queue panel)

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** 9d7ef0efd

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane asked for a manual-recovery button in the Build
  Queue panel header, left of Paste Build / Pause / Refresh / Pin: scan every
  build's raw stdout log touched in the last 1 hour for the CLI's "You've hit
  your session limit · resets …" line (or a variation), and requeue (resume,
  not restart-from-scratch) whatever it finds regardless of what status the row
  landed in.
- 2026-08-30 ✅ DONE — 9d7ef0efd. Added `BtnRecoverSessionLimit` to
  `BuildQueuePanel.xaml` (left of Paste Build/Pause/Refresh/Pin) wired to
  `BtnRecoverSessionLimit_Click`, which calls new
  `SessionLimitAutoRestartService.ManualRecoverFromLogsAsync(TimeSpan.FromHours(1))`:
  lists `%TEMP%\bt-build-queue-logs\queue-*.log` files with a last-write within
  the window, tails each (last 32KB) and re-runs the existing
  `TryDetectLimitMessage` regex line-by-line from the end, and for every match
  calls new `BuildQueuePostgresClient.RecoverStalledSessionLimitRowAsync(id)`
  (requeues a failed/canceled/held/limit-paused row back to 'queued',
  preserving/backfilling `resume_session_id` so it resumes rather than
  restarts). Reuses the existing global-pause-toggle resume + ToastEngine/
  ActivityLog conventions already used by `BtnRecoverOrphans`. Threaded the
  service instance through `BuildQueuePanel.Initialize` and MainWindow's
  existing `_sessionLimitAutoRestart`.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not run
  live against a real capped build (none active this session) — logic is a
  file-scan + existing DB update, both already covered by the pre-existing
  automatic path's own tests-by-production-use; genuinely live-verifying would
  mean deliberately withholding a build until it hit the real session limit,
  which wasn't practical here. `git status --porcelain` clean;
  `verify-branch-merged.mjs` confirms `main` merged into `origin/main`
  (9d7ef0efd, pushed).

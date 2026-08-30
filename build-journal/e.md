# #e — Park a running (blocked) build from the context menu

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** 9613d8504

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: sometimes a build agent decides mid-session it
  cannot continue until something is unblocked. He wants to right-click a
  RUNNING build (same menu that has Open Originating Chat / Mark Complete
  (Hide)) and Park it — pull it out of the active queue into the parking lot
  until the blocker clears or he tells it to build again — rather than the
  only existing option (Stop, which marks it failed/canceled and abandons the
  session).
- 2026-08-30 ✅ DONE — Added a "🅿️ Park (blocked on something else)" item to the
  right-click menu for a `running` build in `BuildQueuePanel.xaml.cs`
  (`BuildCardContextMenu`), right after Stop. Click handler: captures the
  session id the same way Reply does (item.SessionId, falling back to
  `_watcher.GetSessionId`), calls `_watcher.TryStop` + `ReleaseInteractive` to
  actually stop the process, then calls new
  `BuildQueuePostgresClient.ParkRunningAsync(id, sessionId)` — flips the row
  to the existing `'parked'` status (same staging lot ParkAsync already uses
  for queued/limit-paused rows, already has its own filter/UI per Git #1638),
  clearing `claimed_at`/`build_pid` and preserving/backfilling
  `resume_session_id` so the existing "Un-park (send to queue)" action resumes
  the exact session (`claude --resume`) instead of restarting the prompt.
  Updated `ParkAsync`'s doc comment (previously said running was deliberately
  excluded) to point at the new method instead of contradicting it.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-verified against a real running build in this session (would require
  an actual in-flight build to park); logic reuses the exact Stop/Reply
  session-capture pattern and the pre-existing, already-working 'parked'
  status/Un-park path, both already exercised in production by the
  queued/limit-paused Park variants. `git status --porcelain` clean;
  `verify-branch-merged.mjs` confirms `main` merged into `origin/main`
  (9613d8504, pushed after a clean rebase onto Shane's concurrent
  db3b02a1c commit).

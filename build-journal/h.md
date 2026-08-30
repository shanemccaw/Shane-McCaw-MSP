# #h — Park available from every build status

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** a5a5c4180

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: "you put Park on a running build, but not on a
  Verifying or any other build type... All builds no matter there status should
  be able to be parked." Adding Park to the two remaining right-click branches
  in BuildCardContextMenu that didn't have it: 'external' and the catch-all
  else-branch (verifying/done/failed/canceled).
- 2026-08-30 ✅ DONE — a5a5c4180. Added `BuildQueuePostgresClient.ParkAnyAsync`
  (parks from ANY status except already-'parked' — `WHERE status <> 'parked'`
  — preserving/backfilling `resume_session_id` like the running/queued Park
  variants) and a shared `BuildQueuePanel.BuildParkAnyMenuItem` helper, added
  to the context menu for `external` (alongside its existing Tail Log) and the
  catch-all else-branch (verifying/done/failed/canceled, alongside its
  existing Resume Session/Retry) — the two status groups that had no Park at
  all before this. Also syncs the real GitHub "Park" board bucket (#f) the
  same way the other three Park sites do. Running/queued/limit-paused keep
  their existing dedicated Park methods unchanged (running needs the process
  stopped first; queued/limit-paused don't need a session-id backfill), so
  every reachable status branch now offers Park.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-clicked through the running app this session; logic is the same
  parked-status/resume_session_id pattern already exercised by the three
  earlier Park sites. `git status --porcelain` clean; `verify-branch-merged.mjs`
  confirms `main` merged into `origin/main` (a5a5c4180, after three rebases
  onto unrelated concurrent commits during a busy push window — file-level
  checked for overlap before each, none found).

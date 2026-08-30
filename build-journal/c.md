# #c — Session-limit auto-restart (BuildConsole)

- **Status:** ⏳ MERGE-BLOCKED — code complete; flip to ✅ DONE once Shane merges it
- **Scope:** buildconsole
- **Started:** 2026-08-28
- **Commit(s):** 99ef77d (feature), 5844184 (bookend open)

## Log
- 2026-08-28 ⏳ IN FLIGHT — Detect "You've hit your session limit · resets <time>" in build output, park the affected builds as limit-paused, and auto-restart them 10 minutes after the parsed reset. First set: Git #1446 #1439 #1441 #1442 #1452 #1444 (blocked until 2:40am ET by the 5-hour cap).
- 2026-08-28 ⏳ MERGE-BLOCKED — Shipped on branch `claude/session-limit-auto-restart-nngq59`, commit 99ef77d. New SessionLimitAutoRestartService + QueueWatcherService detection/park + BuildQueuePostgresClient limit-paused CRUD + BuildQueuePanel pill/menu + settings (SessionLimitAutoRestartEnabled, SessionLimitAutoRestartDelayMinutes=10, SessionLimitRestartAtIso, SessionLimitFirstSetBootstrapDone). One-shot startup bootstrap parks Git #1446 #1439 #1441 #1442 #1452 #1444 limit-paused and arms the 2:40am-ET+10min restart (clamped to fire promptly if that reset already passed before next app launch). Verification honest state: no .NET SDK reachable from this cloud container (proxy 403 on the dotnet install hosts), so the WPF project was NOT compiled here — detection regexes were unit-tested against real message shapes (canonical line, stream-json-escaped result event, reached/will-reset-at variants, and prose false-positive cases, all passing), brace-balance and API-shape checks done by review. First build on Shane's machine is the real compile gate.
- 2026-08-30 ⏳ MERGE-BLOCKED — Shipped countdown timer to right of "Dispatch", changed auto-restart delay to 1 minute, and implemented T-1 min flip countdown. Compiles cleanly on net8.0-windows.

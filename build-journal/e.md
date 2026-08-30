# #e — Park a running (blocked) build from the context menu

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** (fill at DONE)

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: sometimes a build agent decides mid-session it
  cannot continue until something is unblocked. He wants to right-click a
  RUNNING build (same menu that has Open Originating Chat / Mark Complete
  (Hide)) and Park it — pull it out of the active queue into the parking lot
  until the blocker clears or he tells it to build again — rather than the
  only existing option (Stop, which marks it failed/canceled and abandons the
  session).

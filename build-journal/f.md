# #f — Real "Park" GitHub Project board bucket

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** (fill at DONE)

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane, mid-#e: "you know the best way to do this...
  Create a new Bucket in Git like the 'Batter Up' called 'Park' and move the
  Git issue there... then it pulls it out of the Batter Up queue, puts it in
  its own queue away from the build." Added a real "Park" option to the live
  GitHub Project's Status field (`gh api graphql updateProjectV2Field`,
  preserving every existing option id/name/color) — new option id `19cfa11c`,
  confirmed live. Now wiring BuildQueuePanel's Park/Un-park context-menu
  actions to also move the linked issue's board Status there and back.

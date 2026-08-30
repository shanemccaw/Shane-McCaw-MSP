# #f — Real "Park" GitHub Project board bucket

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** 1066eed88

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane, mid-#e: "you know the best way to do this...
  Create a new Bucket in Git like the 'Batter Up' called 'Park' and move the
  Git issue there... then it pulls it out of the Batter Up queue, puts it in
  its own queue away from the build." Added a real "Park" option to the live
  GitHub Project's Status field (`gh api graphql updateProjectV2Field`,
  preserving every existing option id/name/color) — new option id `19cfa11c`,
  confirmed live. Now wiring BuildQueuePanel's Park/Un-park context-menu
  actions to also move the linked issue's board Status there and back.
- 2026-08-30 ✅ DONE — 1066eed88. `GitHubApiClient`: added `ParkOptionId =
  "19cfa11c"`, `GetProjectItemIdForIssueAsync` (resolves a plain issue number
  to its ProjectV2Item id on this project via `issue(number:).projectItems`),
  and `SetIssueStatusByNumberAsync` (resolves then calls the existing
  `SetProjectItemStatusAsync` mutation; no-op/false if the issue isn't on the
  board). `BuildQueuePanel.xaml.cs`: new `SyncGitHubParkStatus` helper
  (fire-and-forget, same shape as `UnparkAsync`'s existing label sync — never
  blocks the local park/un-park it's paired with), called from all three Park
  sites (running/queued/limit-paused) with `ParkOptionId`, and from Un-park
  with `BatterUpPromoteOptionId` (back to plain "Batter Up"). Since
  `ScanProjectItemsForStatusAsync` filters on an exact optionId, moving an
  issue to "Park" structurally removes it from both the Batter Up and AI
  Batter Up scans for free — no extra exclusion logic needed anywhere.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Confirmed
  live: the `updateProjectV2Field` mutation ran against the real project and
  returned all 11 options (10 pre-existing, unchanged, plus new "Park") — not
  live-clicked through the actual WPF UI this session (no running build with
  a linked issue to park at hand). `git status --porcelain` clean;
  `verify-branch-merged.mjs` confirms `main` merged into `origin/main`
  (1066eed88, after a clean rebase onto two concurrent bookend-only commits).

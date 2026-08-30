# #i — AI Batter Up: comment box + linked-chat column

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** ff8eacb78

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: "I need a text box at the bottom of the
  middle column... I should be able to respond to the issue and post a
  comment directly to it... And in the far right 3rd column remove where it
  has the No SQL Migration or test manifests referenced in this issue... and
  replace it with a Claude.ai chat... And be smart, look at find the parent,
  all the way to the parent Epic until you find the Epic with the chat
  associated... Load up that chat... so in the case of 1959, it's main parent
  Epic is 1202 and there is a chat associated... so that chat should load up
  in the far right column... and the prompt ready for it should be like:
  lets discuss Git #1959."
- 2026-08-30 ✅ DONE — ff8eacb78. **New:** `GitHubApiClient.AddIssueCommentAsync`
  (real `POST /issues/{n}/comments`). **IssueDetailView.xaml**: column 0 (body+
  comments) restructured from a bare ScrollViewer into a DockPanel with a
  bottom-docked compose box (multiline TextBox + Post Comment button) that
  stays pinned regardless of scroll position; column 2 restructured to a Grid
  holding both the original SQL/manifest `ActionsScroller` and a new
  `ChatColumnHost` Border, toggled by a new `ShowChatInsteadOfActions` bool
  property (default false — Git Board's existing detail tabs are unaffected).
  **IssueDetailView.xaml.cs**: `BtnPostComment_Click` posts and appends the
  new comment inline; `FindChatWalkingUpToEpic` walks
  `LeftSidebar.FindChatForIssue` up the issue's cached parent-epic chain
  (`LeftSidebar.BuildDetailIssue(n).ParentNumber`, cycle-guarded) until a chat
  turns up; `RenderChatColumnAsync` embeds a real chat WebView2 there,
  navigated with a `bt_prefill=lets discuss Git #<n>` query param and reusing
  the existing "New Epic Chat" poll script (`MainWindow.EpicChatPrefillPollScript`,
  changed from `private` to `internal` to share it) to insert that text into
  the composer once the SPA's composer mounts — never auto-sent, matching the
  app's existing "review it and press Enter yourself" convention.
  **AiBatterUpPanel**: sets `DetailPane.ShowChatInsteadOfActions = true` in
  its constructor — scoped to AI Batter Up only, per the literal request;
  BatterUpPanel's DetailPane is untouched (still shows SQL/manifest actions).
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-verified against a real chat load or a real posted comment this
  session (no interactive BuildConsole/WebView2 runtime or live #1959→#1202
  chat association available to click through) — logic reuses
  `FindChatForIssue`/`BuildDetailIssue` and the exact `EpicChatPrefillPollScript`
  mechanism already proven in production for the "New Epic Chat" flow.
  `git status --porcelain` clean; `verify-branch-merged.mjs` confirms `main`
  merged into `origin/main` (ff8eacb78).

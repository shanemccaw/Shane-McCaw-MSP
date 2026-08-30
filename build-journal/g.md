# #g — Batter Up / AI Batter Up documents: two-column + always expanded

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** 8317cde1a

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane, on the AI Batter Up document tab: "Can you make
  it two column. Left side being smaller than the right... left side having the
  builds, right side having the Git Hub issue details right where I can read
  what it's talking about directly." Then: "Same thing for the Batter Up
  document. And both the documents have a expand/retract you can just make it
  always expanded when on the documents." Implementing both fixes for
  AiBatterUpPanel.xaml(.cs) and BatterUpPanel.xaml(.cs) — the two controls
  MainWindow.BatterUpTabs.cs hosts as full document tabs (Git #1872).
- 2026-08-30 ✅ DONE — 8317cde1a. Root layout of both controls is now a 3-column
  Grid (`1*`/`Auto`/`2*`, same recipe `GraphApiDocumentView` already uses):
  column 0 keeps the existing header+rows DockPanel unchanged (smaller, left);
  column 1 is a `GridSplitter`; column 2 hosts a real `IssueDetailView` (the
  existing Git #840 description+comments control, unchanged) named
  `DetailPane`. Also discovered and fixed the actual root cause of the
  "expand/retract" complaint: `BtnCollapse`'s default `IsChecked="True"` with
  `RowsScroller` defaulting to `Visibility="Collapsed"` in XAML meant the rows
  list opened HIDDEN every time the document tab was opened, until Shane
  clicked the toggle once — a holdover from the pre-#1872 narrow-docked-column
  days that never got removed when these became full document tabs. Deleted
  `BtnCollapse` (XAML) and `BtnCollapse_Click` (code-behind) outright in both
  controls; `RowsScroller` now defaults Visible with no toggle to hide it.
  Added `SelectCard(Border, int)` to both code-behinds: highlights the clicked
  card's border (`BlueBrush`) and calls `DetailPane.LoadIssue(number)`; wired
  from each card's `MouseLeftButtonUp` (bubbles past the Yes/No/Queue buttons
  since `ButtonBase` marks its own click handled) and from the row-rebuild
  loop in `RefreshAsync`/`RenderFilteredRows`, which re-selects the same issue
  number if it's still present or defaults to the top row — so the detail pane
  is never left blank on open or refresh. Removed the now-dead
  `_emptyMessageActive` field from both files (only ever read by the deleted
  click handler).
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors after
  cleanup. Not live-clicked through the actual WPF UI this session (no
  interactive session available); logic reuses `IssueDetailView.LoadIssue`
  and `GraphApiDocumentView`'s already-proven splitter layout verbatim.
  `git status --porcelain` clean; `verify-branch-merged.mjs` confirms `main`
  merged into `origin/main` (8317cde1a, after two rebases onto unrelated
  concurrent commits — file-level checked for overlap before each, none
  found).

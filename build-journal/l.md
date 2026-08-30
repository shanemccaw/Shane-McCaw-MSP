# #l — Always show an address bar on the AI Batter Up chat column

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** b10189750

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: "In the documents that have a WebView2 dont
  ever hide the browser address bar... Always show it to me." The #i chat
  column embeds a raw WebView2 with zero chrome of its own — no way to see
  what's actually loaded. Adding a permanent, read-only address strip above
  it, never collapsible.
- 2026-08-30 ✅ DONE — b10189750. Added `IssueDetailView.BuildAddressBarWrappedWebView`:
  wraps the chat WebView2 in a `DockPanel` with a top-docked, read-only
  `TextBox` address strip (tracks `wv.SourceChanged`, initialized to the
  chat's URL) — no toggle, no collapse, always rendered as part of the same
  element `ChatColumnHost.Child` is set to. Scoped to the new AI Batter Up
  chat column (`RenderChatColumnAsync`), the only WebView2 embed I added this
  session with genuinely zero chrome of its own (a real tab at least has the
  shared bottom status-bar URL readout while active — this embed had
  nothing). Did not touch the Focus Immersive chat view or regular chat tabs,
  which weren't part of this session's changes and weren't named.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-clicked (no interactive runtime available this session) — a small,
  narrowly-scoped UI addition with no logic to exercise beyond the compile.
  `git status --porcelain` clean; `verify-branch-merged.mjs` confirms `main`
  merged into `origin/main` (b10189750).

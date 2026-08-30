# #j — In Progress chats bar: filter by account on load

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** d52a52ee3

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane: "The top bar where the In Progress chats are
  stored... That needs to filter by the selected Account type on load... Right
  now it loads everything there Primary & Secondary account chats... then I
  have to click Focus This to get the list to narrow down to only the account
  I'm on -- secondary currently."

  Root cause found: `FocusModeService.InProgressChatsForAccount` fails OPEN
  (returns the full unfiltered list) whenever its `_chats` board/account
  snapshot is still empty (comment: "fail-open like this project's other
  closed-state filters"). `FocusModeBar`'s first render fires on `Loaded`,
  which happens before `LeftSidebar` ever calls
  `FocusModeService.UpdateChatSnapshot` (the only call site, after the first
  real board/chats fetch) — so the very first paint always hits the fail-open
  branch and shows both accounts. `UpdateChatSnapshot` never raised any event
  on completion, so nothing told the bar to re-render once the real snapshot
  landed; it stayed on that unfiltered first paint until an unrelated action
  (the account toggle, marking a chat in progress) happened to fire
  `InProgressChatsChanged`.
- 2026-08-30 ✅ DONE — d52a52ee3. Added `InProgressChatsChanged?.Invoke();` to
  the end of `FocusModeService.UpdateChatSnapshot` — the moment real
  per-conversation account data actually becomes known now immediately
  triggers `FocusModeBar.RefreshInProgressChats` (and
  `FocusImmersiveView`'s equivalent), which already filters correctly via
  `InProgressChatsForAccount(BuildConsoleSettings.CurrentAccountLabel())` —
  that filtering logic itself needed no change, only the missing "tell it to
  re-render" signal. Left the fail-open behavior for a genuinely-empty
  snapshot untouched (still correct for the brief window before any board
  fetch has ever completed).
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-verified against an actual cold app launch with both Primary/Secondary
  in-progress chats this session (no interactive BuildConsole instance
  available); the fix is a single added event-raise at the one call site that
  populates the snapshot the existing, already-correct filter reads from.
  `git status --porcelain` clean; `verify-branch-merged.mjs` confirms `main`
  merged into `origin/main` (d52a52ee3).

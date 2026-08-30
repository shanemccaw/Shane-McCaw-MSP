# #j — In Progress chats bar: filter by account on load

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** (fill at DONE)

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

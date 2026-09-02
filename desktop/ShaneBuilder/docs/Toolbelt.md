# Toolbelt (Shell Skeleton v2)

## What it is
A per-tab strip of tool shortcuts docked above the composer bar. Each work tab (a chat/build tab, not scratch tabs) can carry its own set of open tools — switching tabs shows that tab's toolbelt, not a global one.

## Data model
- `TOOLDEFS` — static registry: `{ id: {label, icon, color, tabId, kind, subs?} }`. `subs` (optional) is a list of sub-views: `{id, label, icon, color?}`.
  - Current tools: `vault` (Shot Vault: Wall / Text Index), `batter` (Batter Up: Batter Up / AI Batter Up / AI For Shane), `matrix` (Build Matrix: Kanban / Grid Matrix / Dep Graph), `gate` (Release Gate, no subs), `health` (Project Health, no subs), `settings` (stub, no subs).
- `state.toolBelts` — map of `tabId -> {tools: [id, ...], activeToolId, subs: {toolId: subId}}`. Each work tab's belt is stored independently.

## Rules
1. **Opening a tool** (`openTool(id)`): if no work tabs exist, opens a fresh tab via `openOrSelectTab`. Otherwise it adds the tool id to the current tab's belt (if not already present) and makes it the active tool — it does not remove other tools already in that belt.
2. **Tools accumulate per tab.** A tab can carry several open tools side by side in its belt; only one is "active" (expanded) at a time.
3. **Single vs. grouped tools.** Tools without `subs` render as a single pill button. Tools with `subs` render as a grouped capsule: a small head icon (click closes the whole group) plus one pill per sub-view; the selected sub persists per tool via `belt.subs[toolId]`.
4. **Activating** (`setBeltActive(id)`): clicking a tool's pill toggles it active/inactive — clicking the already-active tool clears `activeToolId` (collapses back to the tab's normal content) rather than closing it.
5. **Removing one tool** (`removeBeltTool(id)`): drops that id from `tools`; if it was active, active clears. If it was the *last* tool in the belt, the whole belt entry for that tab is deleted.
6. **Closing the belt** (`closeBelt`, the "×" at the end of the strip): deletes the entire belt for the active tab — the tab's own content returns, tools are gone (not just collapsed).
7. **Switching tabs** (`onWorkTabSelect`): re-selecting the *already active* tab collapses its active tool (sets `activeToolId: null`) instead of doing nothing — a second click on the current tab "backs out" of whatever tool is showing. Switching to a different tab just changes `activeTabId`; that tab's belt (if any) is shown as-is.
8. **Rail icons mirror belt state.** The left icon rail (Build Matrix / Shot Vault / Batter Up / UI Automation) highlights when `beltToolActive(S, id)` is true for the current tab, i.e. when that tool is the active one in the current tab's belt — not just present in it.
9. **`beltToolAny(S, ids)`** — checks if any of a list of tool ids is the active tool in the current tab's belt; used to keep related UI (e.g. tab styling) lit up across a family of tools.

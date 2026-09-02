# Toolbelt / Wrench Menu — real audited state (Git #2233, 2026-09-02)

**This file previously described a different, unbuilt design** — a per-tab
accumulating strip (`TOOLDEFS`/`state.toolBelts`, tools: `vault`/`batter`/`matrix`/
`gate`/`health`/`settings`) lifted from an early Shell Skeleton v2 `.dc.html` export.
That design was never built. What actually shipped, one tool at a time across
#2194/#2200/#2213/#2214/#2215/#2216/#2217/#2218/#2219/#2220, and was unified under
one entry point in #2233, is documented below instead. `wpf-handoff/notes/Toolbelt.md`
still carries the original design-export note for historical reference — it is not
the live spec.

## What it is

One wrench-icon button (`BtnWrench`, chat context bar) opens a single WPF `Popup`
(`WrenchPopup`) anchored by `PlacementTarget`, populated by `BuildWrenchMenu()` in
`MainWindow.xaml.cs`. There is no per-tool accumulating belt and no per-tab state —
each entry just shows/hides that tool's own existing flyout column (the same
"bolt-on column, shared state" mechanism every tool panel already used
individually before this build). Clicking an entry toggles its panel and closes
the popup; the label itself reflects live open/closed state ("Show X" / "Hide X").

## The real 12-tool spec (Shane's screenshot, audited against the code 2026-09-02)

| # | Tool | Backing issue | Status |
|---|------|----------------|--------|
| 1 | Log Peek | #2200 / #2219 | Landed — `LogService`, `LogPeekPanel` |
| 2 | API Runner | #2220 (mini rail) | Landed — `ApiExplorerService`, `ApiExplorerColumn` (`Mode.Local`) |
| 3 | Graph Read | #2220 (mini rail) | Landed — same panel, `Mode.GraphRead` |
| 4 | Graph Write | #2220 (mini rail) | Landed — same panel, `Mode.GraphWrite` |
| 5 | Git Doctor | #2194 / #2218 | Landed — `GitDoctorService`, `GdMiniPanel` |
| 6 | Git Map | #2213 | Landed — `GitMapService`, `GitMapColumn` |
| 7 | Repo Health | #2214 | Landed — `RepoHealthService`, `RepoHealthColumn` |
| 8 | SQL Runner | #2215 | Landed — `SqlRunnerService`, `SqlRunnerColumn` |
| 9 | PowerShell | #2216 | Landed — `TerminalSessionService`, `PsColumn` |
| 10 | Terminal | #2216 | Landed — `TerminalSessionService`, `TerminalColumn` |
| 11 | JSON Viewer | #2217 | Landed — `JsonViewerColumn` |
| 12 | Windows File Browser | #2217 | Landed — `FileBrowserColumn` |

All 12 are wired into `BuildWrenchMenu()` and reuse the exact service/panel state
each tool's own build phase already created — no new panel logic, no fixture data,
per the "two surfaces, one state" precedent Log Peek set first.

**Out of scope for #2233, deliberately not in this menu as real entries:** the full
API Runner / Graph Read / Graph Write *document* view is part of #2202, which is
separately blocked on Settings (#2204) and held for the Gate template. The three
wrench-menu entries above give real, working access to those three modes today via
the #2220 mini-rail panel — they are not stubs and not a parallel path around #2202;
they are simply the smaller surface #2202 will eventually replace.

## Non-tool wrench-menu entries

The menu also carries actions that were never per-panel toggle buttons and aren't
part of the 12-tool spec: "Ask another epic a question…" (cross-epic composer),
"Show/Hide Detected panel" (a separate feature, keeps its own context-bar button
too), "Pop into Claude Floaty", and "Start a new chat".

## What changed in #2233

Seven scattered per-panel toggle buttons that duplicated menu entries were removed
from the context bar: `BtnToggleLogPeek`, `BtnToggleSqlRunner`, `BtnToggleRepoHealth`,
`BtnToggleJsonViewer`, `BtnToggleFileBrowser`, `BtnToggleGitMap`,
`BtnToggleGitDoctorMini`. Their click handlers and backing panel/column state are
untouched — only the redundant bar-level entry point is gone. `BtnToggleDetectedItems`
and `BtnFloaty` keep their own buttons since "Detected panel" and "Floaty" are not
part of the 12-tool spec.

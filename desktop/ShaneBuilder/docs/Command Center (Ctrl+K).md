# Command Center — Ctrl+K (BuildConsole Shell)

## What it is
A full-screen, keyboard-first "smart" palette (`data-screen-label="Smart Command HUD"`) that searches everything in the console and can also execute things — issues, URLs, terminal commands, SQL, API endpoints, services, open tabs, or a freeform ask to the AI agent.

## Open / close
- **Ctrl+K / Cmd+K** toggles it open (closes Filter Studio if that was open). Opening resets the query and selection (`paletteQ:'', paletteSel:0`).
- **Esc** closes it (also closes Filter Studio and any open dialogs/menus).
- Clicking the scrim closes it; clicking inside the modal (`swallow`) does not.
- Also reachable from the search bar button in the topbar and from the "New Epic Chat" quick action.

## Query → mode detection
Typing in the box (`paletteQ`) is run through a fixed set of regexes to decide the active **mode**, checked in this priority order:
1. `#123` or `123` → **issue** lookup
2. `GET /path`, `POST /path`, etc. → **endpoint** runner
3. `https://…` or `localhost:port` → **url** navigator
4. `git/npm/npx/pnpm/yarn/node/kill/docker…` or Windows `dir/cls/copy/…` or PowerShell-style (`Verb-Noun`) → **cli** (bash / cmd / powershell, picked from which pattern matched)
5. `select/insert/update/delete/with/create table/alter table…` → **sql**
6. exact service name match → **service**
7. anything else non-empty → **agent** (freeform "ask AI")

Each mode gets an icon/color (`hudModeIcon`/`hudModeColor`) and, for the executable modes (url/cli/sql/endpoint/agent), synthesizes a one-off result pinned to the top of the list.

## Result list & tabs
- All possible matches are collected into `hudAllItems`, each tagged with a `category`: `gitepics`, `gitissues`, `builds`, `claude`, `services`, `terminal`, `sql`, `buildids`, `files`.
- The tab row (`HUD_TABS`) — Smart All, Git Epics, Git Issues, Builds, Claude & URLs, Services, Terminal, SQL, Build IDs, Files — filters `hudAllItems` down to one category (`paletteTab`); each tab shows a live count. "Files" is a special case, sourced from open console tabs rather than `hudAllItems`.
- Matching is substring against title/number/name once the query is lower-cased; the number modes also strip a leading `#`.
- Left pane lists results as cards; right pane shows the detail/spec and a stats block for the selected result, plus (for CLI/SQL) an embedded log and a live command input.

## Keyboard navigation
- **↓ / ↑** — move the selection within the currently filtered list, clamped to bounds.
- **Enter** — runs the selected result's primary action (open issue/tab, navigate URL, execute command, dispatch to agent, etc.).
- **Alt+1..4** — fires one of the selected result's up to four secondary actions (e.g. Copy Branch, Refresh).
- Clicking a result card selects it (does not auto-run) — Enter or an explicit action click is what executes.

## Notes
- The input auto-focuses on open (`paletteRef`).
- Footer shows total match count and "0-Navigation Mode" hint.
- Executing most actions closes the palette; a few (embedded terminal/SQL sessions) keep it open so a session can continue.

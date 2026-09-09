# Full-page Tools (Log Viewer · Git Doctor · Local/Git Map) — BuildConsole contract pack

**Git #3018**, a sub-issue of **#3013 (Feature: BuildConsole Contract Packs)**, under
**Epic #1202 (Build Console)**. Same discipline as Portal's own
`docs/{module}-contract-pack.md` files and the sibling
`docs/buildconsole/buildconsole-gitboard-contract-pack.md`.

> **Notice for UI Designers (e.g. Claude Design)**
> This documents what is **actually built and working right now** in BuildConsole's
> three full-page tools — confirmed by reading the real code, cited to `file:line`, not
> the intended/aspirational design and nothing from memory. You have full creative
> freedom over visual appearance. You have **zero freedom over what data exists**: every
> field, colour, badge, enum value and interaction below is backed by real C#/.NET 8 WPF
> logic. Never invent a field, and never render a fabricated placeholder — a value with no
> real backing must read as unavailable, never as a fake row. Where a source is honestly
> empty today (SSH, Terminal, the stdout.log archive leaf), that is documented as a real
> gap, not something to paper over with sample data.

This pack covers the three tools the issue names:

| Tool | Real files | Host |
|---|---|---|
| **Log Viewer** | `Controls/LogViewerDocumentView.xaml(.cs)` + `Services/LogService.cs` | Editor tab (`MainWindow.OpenLogViewerTab`, `.cs:5799`) |
| **Git Doctor** | `Controls/GitDoctorView.xaml(.cs)` + `Services/GitDoctorService.cs` | Editor tab (`MainWindow.OpenGitDoctorTab`, `.cs:5751`) |
| **Local / Git Map** | `BuildChainMapWindow.xaml(.cs)` + `BuildChainMapWindow.Inspector.cs` + `Services/BuildMap/*` | Separate maximised `Window` (`MainWindow.OpenBuildChainMap`, `.cs:1876`) |

> **Naming note.** The issue's body calls the Log Viewer file `LogViewerDock` — that is
> the *ShaneBuilder* origin name (Git #2786). In BuildConsole the real control is
> `LogViewerDocumentView` (a `UserControl` hosted as a document tab, not a
> visibility-toggled dock). The issue's "the new Local Map window" refers to the
> map-picker that BuildChainMapWindow (Git Map) shares with `LocalMapWindow` (the #2806/
> #2807 live-Postgres-schema map); this pack documents the **Git Map / BuildChainMapWindow**
> the issue names by file, plus the shared picker that reaches both. The Local Map's own
> canvas (`Controls/BuildMap/LocalMapCanvasControl`, `Services/BuildMap/LocalSchemaMapService`)
> is only summarised here — it warrants its own pack.

All line citations are against each tool's own files unless another path is given.

---

# 1. Log Viewer

`Controls/LogViewerDocumentView.xaml` + `.xaml.cs`, backed by `Services/LogService.cs`.
Ported from ShaneBuilder's `LogViewerDock` (Git #2786, sub-issue of #2784 Feature: Log
Viewer) onto BuildConsole's already-ported `LogService` contract (#2785). The 280px
chat-dock flyout (`LogPeekPanel`) is a **separate sibling issue** and is not part of this
control (`.xaml:21-22`).

## 1.1 Hosting & shell

Opened as a single reusable Editor tab (icon `📜`, title "Log Viewer") via
`MainWindow.OpenLogViewerTab()` (`MainWindow.xaml.cs:5799`); a second open selects the
existing tab rather than making a new one (matched on `Tag == "log_viewer"`, `.cs:5801`).
`OpenLogViewer_Click` (`.cs:5745`) is the menu entry point. On construction MainWindow
calls `WireLogViewerSendToChat` (`.cs:2210`) so the view's `SendToChatRequested` event
routes into the shared active-Claude-chat composer inject (`SendTextToActiveClaudeChatAsync`,
same path the SQL Runner / Sticky Notes use — #937/#940).

Layout is a header row over a **three-column body** (`.xaml:52-57`): a **240px left rail**
(Sources / Archive), a fluid **center column** (filter bar + scrubber + line stream), and a
**280px right inspector** (active-filter chips, line detail, scratch pad).

Header (`.xaml:34-50`): a sky dot + "Log Viewer" title on the left; on the right the
**stream-mode switch** (`LogViewerStreamSwitch`) and a **status pill** (`LogViewerStatusPill`).

The control lazy-loads once on first `Loaded` (`EnsureLoaded`, `.cs:98`: seeds saved
filters, runs the first query, renders everything). `Unloaded` calls `StopStream` (`.cs:95`)
so closing the tab never leaves a poll loop running.

## 1.2 Data sources (real, confirmed) — `LogService`

Nine `LogSource` entries (`LogService.cs:193-204`), each `Id / Group / Label / Colour(hex) /
RelativeLogPath`:

| Id | Group | Label | Colour | Real backing |
|---|---|---|---|---|
| `marketing` | Websites | Marketing | `#4F8FF0` | `<mainRepo>/.logs/dev-all/shane-mccaw-consulting.log` |
| `portal` | Websites | Portal | `#00B4D8` | `.logs/dev-all/portal.log` |
| `admin` | Websites | Admin | `#A374EA` | `.logs/dev-all/admin-panel.log` |
| `api` | Services | API Server | `#E2593F` | **Postgres `platform_log_stream`** table (real structured level) |
| `sql` | Services | SQL Server | `#38BDF8` | The **live Postgres server log dir** (`SHOW data_directory` + `SHOW log_directory`) — this project runs local PostgreSQL 18, never MS SQL Server (`LogService.cs:311-339`) |
| `build` | Local | Build | `#E2B039` | `%TEMP%\bt-build-queue-logs\queue-*.log` (5 most-recent, `BuildLogPaths`) |
| `ssh` | Local | SSH | `#7FB08A` | **No backing today** — returns empty, never fabricates (`.cs:478-482`) |
| `terminal` | Local | Terminal | `#6EE7B7` | **No backing today** — returns empty |
| `console` | Local | Console Output | `#8FA7C4` | In-memory ring buffer sink `ConsoleOutputSink` (bounded 5000 lines) |

A `LogLine` is `(DateTime Ts, LogLevel Level, string SourceId, string Logger, string
CorrelationId, string Message, bool LevelIsInferred)` (`LogService.cs:70-72`).

**`LogLevel`** enum (`LogService.cs:64`): `Trace, Debug, Info, Warn, Error, Fatal`.

**Level is per-source, not one uniform strategy.** API Server rows carry a real
structured `level` (`LevelIsInferred = false`); every other file/stdout source is raw text
with no level field, so `InferLevel.From` (`LogService.cs:125-156`) keyword-matches a
guess and the line is flagged `LevelIsInferred = true`. The UI **must** render an inferred
level with visibly less confidence than a real one (see §1.7).

Repo-root resolution (`ResolveMainRepoRoot`, `.cs:239`) deliberately walks to the **main
checkout**, not the worktree — the populated `.logs/dev-all/*` live where the dev server
actually runs (Git #1395). `DATABASE_URL` is read from `<repoRoot>/.env.local` and parsed
via the app's own `BuildQueuePostgresClient.ParseConnectionString`.

## 1.3 Streaming model — COLD / BURST / LIVE

`LogStreamMode` enum: `Cold, Burst, Live` (`LogService.cs:66`). Rendered as three pill
buttons in `LogViewerStreamSwitch` (`.cs:184-208`); the active one is a filled blue pill
with black text, the rest `Surface0` with subtext.

| Mode | Behaviour | Status pill (`.cs:210-227`) |
|---|---|---|
| **COLD** | Not streaming. `LogService.Query` runs against files/DB on demand; search/filter re-query. | `COLD · NOT STREAMING` (subtext) — narrow: `COLD` |
| **BURST** | Live tail for **30s** (`LogBurstDefaultSeconds`, `.cs:47`), then **self-cancels back to COLD** (`.cs:263`). | `BURST · {n}s LEFT` (peach), counts down each second — narrow: `{n}s` |
| **LIVE** | Indefinite tail until mode change / tab close. | `LIVE · TAILING` (green) — narrow: `LIVE` |

Narrow layout kicks in below `ActualWidth < 1250` (`.cs:212`). Streaming appends into a
`_liveBuffer` capped at 5000 lines (`.cs:300`), pumped to the UI by a **500ms render
timer** only when the buffer is dirty (`.cs:243-251`). `LogService.Tail` merges one poll
loop per backed source into a single channel: API Server polls `platform_log_stream WHERE
id > lastId` every **1.5s** (`.cs:633`); file sources tail by byte-offset every **1s**,
handling rotation (`.cs:637-688`); console attaches to the sink event. `ssh`/`terminal`
contribute nothing.

## 1.4 Center — filter bar (`.xaml:90-144`)

Top-to-bottom:

1. **Search box** (`LogViewerSearchBox`) with placeholder "Search (plain text)…"; a **`.*`
   regex toggle** button (blue when active, `.cs:689`); and a red **exclude box**
   ("exclude, comma, separated…") — each excluded term is a case-insensitive substring
   (`LogService.cs:545-550`).
2. **HIGHLIGHT** toggle + **saved-filter chips** + a **"save current"** link.
3. **Level pills row** (`LogViewerLevelPills`) — one toggle pill per `LogLevel`, coloured
   by level, filled at 0.22 opacity when active (`.cs:759-785`).
4. **History scrubber** — a `Slider` 0–1440 (minutes back from now), with a readout
   ("now" / "{n}m back", `.cs:712-718`). Feeds `LogQuery.From`.

**HIGHLIGHT vs filter (important behaviour):** in normal mode the search text is a
**filter** (non-matches are hidden). With HIGHLIGHT on, the search text is withheld from
the query and applied client-side as a **dim to 0.35 opacity** on non-matching rows
instead (`.cs:327-330`, `368`, `416`) — matches stay in context.

**Saved filters** (`.cs:138-143`, `728-757`): three are seeded — "Graph 401s", "Drift
aborts", "Build failures". "save current" appends the current `LogQuery` as "Filter N".
Clicking a chip re-applies the whole query (search/regex/exclude/levels/sources/logger).
Saved filters are in-memory for the session only (not persisted).

## 1.5 Center — line stream (`.xaml:146-148`)

Shows the newest **600** ordered lines (`.cs:350`). Empty state: *"No lines match the
current filter."* (italic subtext). Each row (`BuildLineRow`, `.cs:405-458`):

- **Star / pin** toggle (`☆`/`★`, yellow when pinned).
- **Source colour dot** (6px, from `LogSource.Colour`).
- **Timestamp** `HH:mm:ss.fff` (mono, subtext).
- **Level pill** (`BuildLevelPill`, `.cs:377-403`): a real level renders a **solid tinted
  fill** (level colour @ 0.22); an **inferred** level renders **outline-only, a leading
  `~`, regular weight**, tooltip *"Inferred from message text — no structured level exists
  for this source"* vs *"Real level from platform_log_stream"*.
- **Message** (mono 13, ellipsis-trimmed).
- Selected row is `Surface0`-backed; dimmed rows are 0.35 opacity.

**Row context menu** (`.cs:460-479`): Copy · Copy ±3 context · Pin/Unpin · Send to chat ·
Follow this logger (disabled when the line has no logger). Left-click selects the line
(fills the inspector). "Copy" uses the format `[HH:mm:ss.fff] ~LEVEL source/logger:
message` (`FormatLine`, `.cs:481`). Send-to-chat wraps the block in a ```` ```log ````
fence and raises `SendToChatRequested`.

## 1.6 Right inspector (`.xaml:151-188`)

Three stacked regions:

- **ACTIVE FILTERS** (`LogViewerFilterChips`, `.cs:568-631`): pill-per-active-filter with
  an `×` to clear it — `search:` / `regex` / `exclude:` / `logger:` / `levels:` /
  `build:` or `sources: n/N`. Empty state renders "None" (italic).
- **Line detail** (`.cs:517-566`): LEVEL (with "(real)" or "(inferred …)"), TIMESTAMP
  (`yyyy-MM-dd HH:mm:ss.fff`), SOURCE (label), LOGGER, CORRELATION ID (`—` when empty),
  and the full MESSAGE in a read-only wrapped textbox. Empty state: *"Select a line to see
  its detail."*
- **SCRATCH PAD** (`.cs:637-678`): the set of pinned lines, with **copy** and **send to
  chat** links. Pins live in `_pinned`, a set entirely separate from the displayed buffer,
  so **they survive every filter change** (`.cs:633-636`). Empty state: *"Pin a line to
  build a set here — it survives filter changes."*

## 1.7 Left rail — Sources / Archive (`.xaml:59-73`)

Two tab buttons ("Sources" / "Archive"), the active one `Surface0`-backed.

**Sources rail** (`.cs:801-885`): collapsible group sections (Websites / Services / Local,
default all open). Each source row has: a colour dot (with a **glow DropShadow while
streaming**, `.cs:861-866`), the label, a red **error-count badge** (count of
Error+Fatal lines currently loaded for that source, `.cs:821-825`), and a **green/grey
toggle** enabling that source in the query. Toggling re-renders, re-queries, and restarts
any active stream (`.cs:878-885`).

**Archive rail** (`.cs:889-921`): an "open by Git ID" box (type an issue number, Enter →
opens `build-journal/<id>.md`), then a real **day → build → bookend** tree from
`LogService.Archive()`. "Day" groups by each bookend file's last-write date (`.cs:711-741`);
each build node's leaf is that issue's `<id>.md (bookend)`. Opening a leaf drops to COLD,
sets `_viewingArchive`, shows the amber **archive banner** ("ARCHIVE — READ-ONLY — …" with
a "Back to live sources" link, `.xaml:77-88`), and renders the file read-only in the line
panel (`.cs:959-982`). Empty state: *"No build-journal bookends found."*

> **Honest gap (documented in code):** the mockup's per-build `stdout.log` archive leaf has
> **no honest source** — BuildConsole's own `queue-{id}.log` is keyed by internal queue id
> with no reliable join back to a Git issue, so only the real `build-journal/<id>.md`
> bookend is offered (`LogService.cs:700-710`). Do not design a stdout.log leaf as if it exists.

---

# 2. Git Doctor

`Controls/GitDoctorView.xaml` + `.xaml.cs`, backed by `Services/GitDoctorService.cs`. A
port of ShaneBuilder's GitDoctorDock (Feature #2194) — every finding, branch and commit
comes from **real git commands against the repo this executable lives inside**
(`GitDoctorService.cs:10-20`). There is **no seeded/demo data path**: an empty findings
list means the repo really is clean (`GitDoctorView.xaml.cs:20-22`).

## 2.1 Hosting & shell

Opened as a single reusable Editor tab (icon `🩺`, title "Git Doctor") via
`MainWindow.OpenGitDoctorTab()` (`MainWindow.xaml.cs:5751`; matched on `Tag ==
"git_doctor"`). First open calls `gitDoctorView.EnsureLoaded()` (`.cs:5794`) which kicks
the checks off exactly once (`GitDoctorView.xaml.cs:107-115`); re-runs are via the view's
own "Re-run checks" button.

> The XAML header comment still describes a "narrow LeftSidebar ActivityBar view" (#2798);
> that was superseded by **#2809**, which moved Git Doctor to a **full-width Editor tab**
> with no content change (`MainWindow.xaml.cs:5747-5750`). Design for the full-width tab.

The view keeps its ported render code compiling by registering ShaneBuilder's semantic
resource keys (`Brush.*`, `FontFamily.*`, `FontWeight.*`, `FontSize.*`) into its own
`Resources` in the ctor, mapped to BuildConsole's Catppuccin palette
(`RegisterThemeResources`, `.cs:72-105`). Those hex values are the real palette:

| Key | Hex | Key | Hex |
|---|---|---|---|
| `Brush.Bg.Card` | `#1C2128` | `Brush.Text.Heading`/`.Primary` | `#CDD6F4` |
| `Brush.Bg.Chip` | `#313244` | `Brush.Text.Muted` | `#A6ADC8` |
| `Brush.Bg.Window` | `#0D1117` | `Brush.Text.Dim` | `#6C7086` |
| `Brush.Border.Card` | `#313244` | `Brush.Status.Running` (green) | `#A6E3A1` |
| `Brush.Border.Strong` | `#45475A` | `Brush.Epic.AppCore` (blue) | `#89B4FA` |
| `Brush.Claude.Accent` | `#FAB387` | `Brush.Epic.Gate` (red/pink) | `#F38BA8` |

Layout (`.xaml:17-146`): a top **header** (headline + subline + "End this git nightmare"
button + commit-lookup box + "Re-run checks"), a fill region split into a **findings list**
(top, max 220px scroller) over a **selected-finding detail** panel, and a bottom **Claude
bridge + run log** dock.

## 2.2 Data sources — `GitDoctorService`

`RepoRoot` is found by walking up from the executable dir / cwd for a `.git` (dir or file)
(`.cs:78-88`). All git runs shell `git` with `WorkingDirectory = RepoRoot`, 15s default
timeout, killed on timeout (`.cs:90-114`).

**Repo status** (`GetRepoStatusAsync`, `.cs:118-142`) → `GitDoctorRepoStatus(Repo, Branch,
Remote, Ahead, Behind, Worktrees)`, rendered as the subline `{repo} · {branch} · {ahead}
ahead · {behind} behind · {worktrees} worktrees` (`GitDoctorView.xaml.cs:145-147`). Repo
name is the remote slug when available.

**Checks** (`RunChecksAsync`, `.cs:155-175`) run six real detectors, each appending zero or
more `GitDoctorFinding`s. If no repo is found, a single `norepo` High finding is returned.

| CheckId | Severity | Detector | Fires when |
|---|---|---|---|
| `lock` | Low | `git rev-parse --git-dir` + file check | `.git/index.lock` exists (`.cs:177-196`) |
| `dirty` | Medium | `git status --porcelain=v1 --untracked-files=all` | any modified/untracked (counts both; #2988, `.cs:198-241`) |
| `diverged` | High | `git rev-list --left-right --count HEAD...@{u}` | both ahead **and** behind (`.cs:243-285`) |
| `detached-<sha>` / `prune-<name>` | Medium / Low | `git worktree list --porcelain` | a non-main detached-HEAD worktree, or a prunable one (`.cs:287-333`) |
| `auth` | High | `git ls-remote --exit-code origin -h` (8s) | error text matches auth-failure patterns only — a plain offline/timeout does **not** fabricate a finding (`.cs:335-360`) |
| `stale` | Medium | `ComputeBranchesAsync` | **≥ 25** local branches (`StaleThreshold`, `.cs:404-436`); `showsBranches = true` |

Two of the mockup's nine checks are **deliberately not implemented** because detecting them
would itself mutate the repo (a "pull would overwrite" only appears mid-merge; a CRLF-only
diff only appears mid-checkout) — an honest gap, stated at `.cs:17-20`.

**A `GitDoctorFinding`** (`.cs:31-56`): `CheckId, Severity, Title, Where, PlainEnglish,
RawGitOutput, Remedies[], ShowsBranches, Fixed`. **`GitDoctorSeverity`** = `Low, Medium,
High`. **A `GitDoctorRemedy`** (`.cs:27-29`): `Id, Label, Recommended, Risk, Preserves,
Steps[]`. **`GitDoctorRisk`** = `Safe, Careful, Destructive`. **A `GitDoctorStep`** =
`(Cmd, Why)`.

**Branches** (`ComputeBranchesAsync`, `.cs:362-402`) → `GitDoctorBranch(Name, Sha, AgeDays,
Merged, RemoteGone, Ahead, Behind, InWorktree)` from `git branch --merged`, `git branch
-vv` (for `: gone]`), `git for-each-ref`, and `git worktree list`.

**Commit lookup** (`LookupCommitAsync`, `.cs:438-480`) → `GitDoctorCommitInfo(Sha, Subject,
Author, When, Reachable, Where, Files[], Stat, Notes)` from `git log -1`, `git branch -a
--contains`, `git show --stat`, and a worktree cross-check.

## 2.3 Header controls & the "nightmare" button

- **Headline** (`.cs:142-144`): *"{N} thing(s) are blocking git right now"* or, once
  loaded clean, *"Everything git was complaining about is fixed"*.
- **"End this git nightmare"** (`BtnGitDoctorNightmare`): red when there are open findings,
  disabled + relabelled "Nothing left to fix" when none. Sub-line: *"backup branch first,
  then {N} commands"* (N = total remedy steps). Running it cuts a `backup/pre-doctor-<ts>`
  branch, runs each open finding's chosen remedy, then `git status --short --branch` to
  prove clean (`.cs:806-828`).
- **Commit-lookup box** (`GitDoctorQueryBox`): paste a hash; on ≥4 hex chars it runs the
  real lookup, else shows a "NOT FOUND" panel (`.cs:766-792`).
- **"Re-run checks"** re-runs `LoadGitDoctorChecksAsync`.

## 2.4 Findings list (`.xaml:119-138`)

Header "WHAT GIT IS COMPLAINING ABOUT" + an open-count on the right. Each row (`.cs:216-278`):
a state dot + title (strikethrough + green when `Fixed`) over the mono `Where` string, plus
a **severity pill** (LOW/MEDIUM/HIGH). Severity colour (`.cs:174-179`): Low = muted, Medium
= blue (`Epic.AppCore`), High = red (`Epic.Gate`). A `Fixed` finding is 0.5 opacity. The
selected row is chip-backed with a left severity accent. Empty state: *"No findings. Git is
clean."*; pre-load: *"Running checks…"*.

## 2.5 Detail panel — the three render modes (`.cs:298-311`)

Switches on selection state: a **finding**, a **commit-lookup result**, or a **not-found**
message.

**Finding detail** (`.cs:326-479`): severity pill + title + `Where`; the `PlainEnglish`
explanation; a **"WHAT GIT ACTUALLY SAID"** raw-output box (`RawGitOutput`, mono, pink
`#F0C9C2`); for `showsBranches` findings the **branch section** (§2.6); then **"HOW TO GET
OUT OF IT"** — one selectable card per remedy. Each remedy card shows a radio, label, an
optional **RECOMMENDED** badge, a **risk pill** (Safe = green / Careful = blue /
Destructive = red, `.cs:181-186`), the "Preserves" line, and every step as `cmd — why`
(cmd in blue mono). The chosen remedy defaults to the recommended one (`RemedyFor`,
`.cs:164-172`).

For the **`auth`** finding only, a **"Paste a fresh PAT directly"** card is appended
(`.cs:485-529`): a `PasswordBox` + Apply. Apply runs `GitDoctorService.ApplyGitHubPatAsync`
(`git credential approve` over stdin, then re-verifies with `ls-remote`, `.cs:528-542`) and,
on success, **also writes the PAT to `BuildConsoleSettings.GitHubPat`** — the same store
`GitHubApiClient` reads (`.cs:544-554`), a #2770-safe Load/Save round-trip.

Action row (`.cs:446-478`): **Run this fix** (coloured by the chosen remedy's risk), **Ask
Claude** (copies a markdown block of the finding + proposed fix to the clipboard, toasts),
**Copy plan JSON** (copies `{check, severity, remedy, risk, steps[]}`).

**Commit-lookup result** (`.cs:684-737`): REACHABLE/UNREACHABLE badge + short SHA + subject;
a metadata box (`commit / Author / Date / Found in / stat`); the file list (first 20); a
notes card; and actions **Save it on a branch** (`git branch recover/<sha> <sha>`),
**Cherry-pick here**, **Copy git show**, **Ask Claude**.

**Not-found** (`.cs:739-764`): "NOT FOUND" + the query + a **"Hunt for it everywhere"**
button that runs `git fetch --all --prune` → `git log --all --oneline | findstr <q>` → `git
fsck --lost-found`.

## 2.6 Branch section (stale finding only, `.cs:567-665`)

"THE BRANCHES" with five filter pills (each with a live count): **All / Merged / Unmerged /
Remote gone / Older than 90 d**. A scrollable list (max 60) of branch rows: a checkbox
(defaults to *checked for merged* branches), the branch name (muted if merged, pink if
unmerged), age `{n}d`, a **merged / {ahead} unmerged** pill, and "remote gone" / "in a
worktree" markers. Action row: **Delete N selected — backup tag first** (cuts `git tag
backup/branches-<ts>`, then `git branch -d`/`-D` per branch, then `git remote prune
origin`, `.cs:667-682`), **Select merged only**, **Clear**.

## 2.7 Run log & Claude bridge (`.xaml:65-110`)

Every remedy/step run streams through `RunGitDoctorStepsAsync` (`.cs:830-847`) into the
**RUN LOG** (max 140px scroller): a bold heading line, then each command (green on success,
`"cmd  (failed)"` otherwise) with its "why" beneath, ending "Finished — N commands."
`RunStepsAsync` executes each `Cmd` via `cmd.exe /c` with a 60s timeout (`.cs:482-490`).
`RUNNING…` shows while active. Empty state explains you can paste the whole session into a
chat.

**Claude bridge** (`.cs:911-988`): paste Claude's reply into `GitDoctorInboundBox` →
**Extract commands** parses runnable lines (matching `^(git|del|cmdkey|ssh|rm)\b`, stripping
`$`/`>`/`#` prefixes and fences) into a **checklist plan** (each toggleable) → **Run {N}
approved** runs the approved subset through the same step runner. **"send all findings"**
copies every open finding as markdown to the clipboard.

> "Ask Claude" / "send all findings" / "Copy plan JSON" all use the **clipboard**, not a
> chat composer inject — this full document has no app-owned composer next to it
> (`.cs:38-41`), unlike the Log Viewer.

---

# 3. Local / Git Map

Two map windows share one entry point and picker; this pack documents the **Git Map**
(`BuildChainMapWindow`, the file the issue names), plus the picker that reaches both.

## 3.1 Entry point & the map picker (`MainWindow.xaml.cs`)

`OpenBuildChainMap()` (`.cs:1876-1896`) is wired to `ActivityBar.BuildChainMapRequested`
(`.cs:1226`). If a map is already open it activates/un-minimises it; otherwise it shows
`PromptForMapChoice()` (`.cs:1936-1972`) — a small 340×160 dialog "Open which map?" with
two buttons: **Git Map** (default) and **Local Map**, plus Cancel.

- **Git Map** → `OpenGitMap()` (`.cs:1901-1914`): resolves the Epic from
  `LeftSidebar.ActiveEpicGithubNumber` (the "WORKING" epic in Git Board) or, failing that,
  `PromptForEpicNumber()` (`.cs:1977-2015`); opens `BuildChainMapWindow(epicNumber)`
  **maximised**, owned by MainWindow, single-instance. Logs `build-chain-map open epic=#N`.
- **Local Map** → `OpenLocalMap()` (`.cs:1919-1929`): opens `LocalMapWindow` (the #2806/
  #2807 live-Postgres schema graph, not Epic-scoped). Summarised in §3.7.

## 3.2 Git Map window — shell (`BuildChainMapWindow.xaml`)

A standalone `Window` (1440×900, min 960×600, `Background=#0a0d12`). This screen is
**high-fidelity to its own finished design pass** (`BuildMap/README.md` + reference
screenshots under `BuildMap/screenshots/`), so its palette is its **own dark-blue token
set**, deliberately NOT the app's Catppuccin chrome (`.xaml:14-33`). Inter isn't bundled,
so UI text uses Segoe UI and every number/tag uses Consolas (the spec's own fallback).

Three bands (`.xaml:71-209`):

1. **Top bar** (min 56px, `#0d1117`): title block, 7-chip stats strip, chain-integrity
   pill, and view controls.
2. **Body**: a fluid **canvas** (`ChainCanvasControl`, `Controls/BuildMap/`) over a
   **312px right Inspector** (`InspectorHost`, built in `.Inspector.cs`).
3. **Status strip** (26px, bottom): left context hint, right mono counts.

## 3.3 Data source (real GitHub) — `Services/BuildMap/*`

`RefreshAsync` (`.xaml.cs:151-213`) requires a GitHub PAT (else the status strip shows *"No
GitHub PAT configured…"*), builds a `GitHubApiClient`, resolves the local dispatch queue
(`BuildQueuePostgresClient`, non-fatal if absent), then `BuildChainMapService.BuildAsync`
produces the `ChainDoc` and `ChainRules.Derive` produces the `ChainDerived` snapshot.

`BuildChainMapService.BuildAsync` (`BuildChainMapService.cs:63`) — every field traces to a
real GitHub response:

- **Epic → Feature → Issue** — GitHub's native **sub-issues API** (`GetSubIssuesAsync`),
  in the real stored priority order the endpoint returns.
- **`blocked_by` edges** — the real **issue-dependencies API** (`GetBlockedByAsync`),
  filtered to edges whose both endpoints are in this Epic, classified fan-in / gate /
  manual per BUILD_QUEUE_METHOD.md §5.2.
- **Board Status** — the real `Status` field on project `PVT_kwHOEiBDdc4BeoiY`
  (`GetIssueBoardStatusAsync`).
- **DONE** — `DoneBookendVerifier`'s §7 protocol: a `build-journal/<n>.md` bookend on
  `origin/main` whose cited commit is a real ancestor of `origin/main` — authoritative over
  the board's own "Done" label.
- **Model / Effort** — parsed from each issue's latest real `BUILD:` comment (empty when
  absent, never fabricated).

Throws if the Epic number doesn't resolve to a real issue (fail loud); an Epic with zero
Features yields an empty `ChainDoc`, not a placeholder (`BuildChainMapService.cs:32-33`).

**Data model** (`Services/BuildMap/ChainDoc.cs`): `ChainStatus = Batter, Backlog, Ask,
Done`; `ChainEdgeKind = FanIn, Gate, Manual`. A `ChainFeature` has `Id ("F"+Num), Num,
Name (leading "Feature: " stripped), Short (buildSet PascalCase), Issues[], Sentinel (int?,
highest-numbered cascade issue by default)`. A `ChainIssue` has `Num, Title, Status, Model,
Effort, IsClosed`. A `ChainEdge` is `(From blocker, To blocked, Kind)`.

## 3.4 Top bar (`.xaml:80-161`, `.xaml.cs:114-288`)

- **Title block**: eyebrow "BUILD CHAIN · §5 FEATURE CHAINING", the Epic name, `#num`, and
  "Epic → Feature → Issue → blocked_by".
- **Stats strip** — 7 chips (`BuildStatsStrip`, `.cs:115-148`), label over mono value:
  **FEATURES**, **ISSUES**, **READY NOW** (`#7fb08a`), **WAITING** (`#6a8fb5`), **BACKLOG**
  (`#8b949e`), **ASK SHANE** (`#a374ea`), **DONE** (`#5f9a6c`). Values come straight from
  `ChainDerived.Totals` (`.cs:226-232`).
- **Chain-integrity pill** (`RenderChainPill`, `.cs:242-269`): green *"Chain exact · {G}
  gate edges, not {Cross}"* when `Gaps == 0`; amber *"Chain has {N} gap(s)"* + a **Re-wire
  §5.2** button otherwise. `Gaps`/`Cross`/gate counts are all real from `ChainDerived`.
- **Controls**: Expand all · Collapse all · Zoom − / % / + · Fit · Reset (discard local
  edits, reload from GitHub).

## 3.5 Status strip (`.xaml:164-178`, `.xaml.cs:274-286`)

Left hint (default): *"Click a Feature to open its issues · drag a header to change
priority · click an issue to see what holds it · click an edge to inspect or remove it"*.
In **link mode** it turns **amber**: *"Pick a blocker for #{target}: click any issue node.
Esc cancels."* Right mono counts: *"{fanIn} fan-in · {gate} gate · {manual} added"*.
After any action, a one-line confirmation replaces the hint (`ShowConfirmation`,
`.Inspector.cs:748-752`).

## 3.6 Inspector — four views (`BuildChainMapWindow.Inspector.cs`)

Rebuilt from scratch on every selection/edge/link-mode/doc change (`RenderInspector`,
`.cs:95-108`), driven entirely by the canvas's real selection state. Its palette is a
local dark-blue token set (`.cs:43-71`); icons are inline Lucide geometries (`.cs:79-88`).

**Node-state vocabulary** (`ChainNodeState`, derived at `ChainRules.cs:252-256`):

| State | Derived when | Dot (`InsStateDot`, `.cs:1272-1284`) | Colour |
|---|---|---|---|
| **Ready** | Batter Up, no open blockers | solid | green `#7fb08a` |
| **Blocked** ("waits N") | Batter Up, N incoming edges whose blocker isn't Done | hollow ring | blue `#6a8fb5` |
| **Held** | board status = Backlog | dashed ring | grey `#8b949e` |
| **Ask** | board status = Ask Shane | solid | violet `#a374ea` |
| **Done** | verified DONE bookend | filled + ring | green `#5f9a6c` |

**Edge kinds** (legend, `.cs:133-144`): Fan-in (blue solid), Cross-feature gate (soft-blue
solid), Manual gate (amber dashed), Added by you (violet solid).

### 3.6a Nothing selected (`.cs:112-160`)
"How to read this" explainer; a **node-state legend** (5 rows); an **edge legend** (4
rows); a **"§5.2 in numbers"** card (real fan-in/gate/issue/Feature/cross counts); and a
dashed card stating the data is live GitHub and edits write straight back.

### 3.6b Feature selected (`.cs:195-367`)
Header: **P{k+1}** badge, "Feature" eyebrow, `#num`, the name, and mono `buildSet={short} ·
{n} issues · {c} in cascade`. Five **count tiles** (READY / WAITS / HELD / ASK / DONE, from
`FeatureSummary`, zero-values ghosted). Two fact lines (gated-on / releases). A **sentinel
`<select>`** listing cascade issues highest-first — changing it calls `MakeSentinel`
(re-wires fan-in + downstream gate). A **"Gate before this Feature"** card with a 30×16
switch (hidden for P1) — auto vs manual (Backlog). **Open/Collapse issues** + **← / →
reorder** buttons. An **issues list**: state dot, `#num`, title, a target icon for the
sentinel, and a state tag ("WAITS N" for blocked); clicking a row selects that issue.

### 3.6c Issue selected (`.cs:389-540`)
Header: "Issue" eyebrow, `{feature} · P{k+1}`, `#num`, title, and a state dot + state label
(e.g. *"Waiting on N blockers"*, *"Ready — launches on the next refresh"*, *"Held in
Backlog"*, *"Ask Shane — outside the cascade"*, *"DONE bookend verified"*). If it's the
sentinel, a blue card notes how many siblings fan in. **Board status** — four buttons
**Batter Up / Backlog / Ask Shane / Done** (active one blue-filled), each calls
`SetIssueStatus`. **Blocked by** — count + **"Add blocker…"** (toggles link mode; "Cancel"
in amber while active); each incoming edge is a row (dot, `#num`, title, kind tag, `×`
remove). **Blocks** — outgoing edges, same row shape. **"Make this the sentinel"** button
(hidden if already sentinel or Ask). **Dispatch** — a real `BUILD:` block: `BUILD:
model={model} effort={effort} buildSet={short}` and `--model … --effort … --title {num}
[--blocked-by …]`, plus a note for Ask/Backlog issues.

### 3.6d Edge (or bundle) selected (`.cs:603-730`)
Header: "blocked_by edge" + kind label(s), the headline (`#to blocked_by #from` or "{N}
issues in {Feature} blocked_by #from"), and a description keyed off whether the blocker is
Done. A **blocker card** (state dot + feature + `#from` + title + state tag; clickable). A
**Holds** list (each held issue with a `×`). A **"Remove edge" / "Remove all N edges"** red
button. A footnote that removing a §5.2 edge opens a gap the Re-wire button restores.

## 3.6e Interactions & real persistence
Keyboard (`.xaml.cs:95-112`): `Esc` cancels link mode then clears selection; `Delete`/
`Backspace` removes the selected edge bundle. Canvas events wire to reorder, gate toggle,
zoom, and edge-link (`.xaml.cs:77-88`).

**Every mutation writes back to GitHub for real (Git #2481)** and is audited by re-reading
it. Each mutation captures a `ChainSnapshot` at entry, edits the in-memory `ChainDoc`,
re-derives/re-renders, then funnels through `PersistThenConfirm` (`.Inspector.cs:765-796`)
→ `ChainPersistence.PersistAndAuditAsync` (diffs before/after, applies the real `blocked_by`
+ board-column writes, re-reads each). Writes are serialized under a semaphore; the
status-strip confirmation shows the **real verified result**, e.g. *"…· saving to
GitHub…"* → the audited summary, or *"⚠ save failed: …"*. Real mutations: `ToggleManualGate`
(`.cs:982`), `MakeSentinel` (`.cs:1006`), `ReorderFeature`/`MoveFeature` (also persists the
sub-issue order via `PersistReorderAsync`, #2498, `.cs:1039/1073`), `SetIssueStatus`
(`.cs:1085`), `RemoveEdges` (`.cs:1116`), and canvas link-mode add (`PersistSingleEdgeAdd`,
`.cs:860`). A board move additionally reconciles the local `bt_build_queue` cache (#2486,
`SyncQueueAfterBoardMovesAsync`, `.cs:928`) so the edit reaches live dispatch — fail-soft.

## 3.7 Local Map (summary only — separate window)

`LocalMapWindow` + `Controls/BuildMap/LocalMapCanvasControl` + `Services/BuildMap/
LocalSchemaMapService` / `LocalSchemaDoc` / `LocalMapLayout` (Git #2806/#2807). It is the
**live Postgres schema graph** — tables/columns/foreign-keys read from the real local
database — not Epic-scoped, opened via the same picker. It is out of this pack's file scope
(the issue names `BuildChainMapWindow`); it should get its own contract pack authored from
`LocalSchemaMapService`.

---

# 4. Cross-cutting truths

- **No fixture data anywhere.** Log lines come from real files/DB/sink; Git Doctor findings
  from real git; the Map from real GitHub + a real Postgres queue. Honestly-empty sources
  (SSH, Terminal, the stdout.log archive leaf, an Epic with zero Features) render as empty,
  never as sample rows.
- **Inferred vs real must stay visually distinct** (Log Viewer level pills) — a keyword
  guess and a structured `platform_log_stream` level are never given equal weight.
- **Palettes differ by tool on purpose.** Log Viewer and Git Doctor use BuildConsole's
  Catppuccin palette; the Git Map uses its own high-fidelity dark-blue token set from its
  finished design pass. Do not homogenise the Map into Catppuccin.
- **Copy is final.** Every quoted user-facing string above is verbatim from the code (much
  of the Map's copy is reproduced 1:1 from `Build Chain Map.dc.html`). Do not rewrite it.
- **Git Map edits are real writes to GitHub** (and the local queue), audited by read-back —
  design the confirmations to reflect a verified result, not an optimistic one.

# App Shell v2 — WPF Handoff, Phase 2 (Steps 9–16)

Phase 1 (the original 8 steps: title bar, icon rail, side panels, build queue, build
detail flyout, Claude chat pane, status bar, focus nudge) is **done**. Everything below
was designed after that and is not in the Phase 1 README.

The visual target is still the mockup: **`Shell Skeleton v2.html`** in this folder — open
it in a browser and click through. Ignore the `<x-dc>` wrapper and the `<script
type="text/x-dc">` block; the UI is the HTML markup and its inline `style="…"`
attributes. Port the numbers, not the vibe. Colors still come from
**`App Shell v2 Color Palette.html`**; the new surfaces introduced only tints of colors
already in that file (recompute rgba tints from the base hex — don't invent).

Each step below is independently shippable and ordered by dependency. Where a step needs
a service, the contract is given as the minimum shape the UI binds to — names are
suggestions, shapes are not.

---

## Step 9 — Tab Workspaces

**Problem it solves.** With chats, designs, git issues, favorites, logs, API explorers and
loose files all in one tab strip, nothing is findable.

**UI.** Tabs are grouped into *workspaces*. Each workspace is a wrapping container around
its own tabs with a 2px top rail in its colour, a tinted background
(`rgba(colour, .055)` idle / `.10` when it owns the active tab), and an uppercase chip at
its head (icon + label + count pill).

| Workspace | Colour | Icon | Notes |
|---|---|---|---|
| Claude Chats | `#7c8cf0` | message-square | marked **primary** |
| Claude Designs | `#00b4d8` | layout-grid | |
| Git Issues | `#e2593f` | git-fork | |
| Favorites | `#e2b039` | star | |
| Logs | `#7fb08a` | activity | |
| API Explorers | `#c084fc` | zap | |
| Files | `#8fa7c4` | file-code | file tabs also carry an ext badge |

- **Home** is pinned first, outside every workspace: pin glyph and no close button while
  it is the only tab; closable once anything else is open. Closing the last tab resets to
  Home in its first-run state (clear tool belts, workspace collapse and stash state).
- **Collapse** — clicking a workspace chip folds its tabs to icon + count. If the active
  tab is inside a folded workspace, its title stays visible next to the chip.
- **Dismiss** — the arrow at a workspace's right edge parks the whole set in the
  workspace box (top-left, replacing the empty square left of the app name). Tabs stay
  open, just out of the strip. The box is a 4-pip grid of live workspace colours with a
  badge counting stashed sets; clicking it opens a panel to fold / unfold / restore each
  set, with per-set status ("2 tabs · dismissed", "primary").
- **Routing** — a newly opened document lands in the workspace its kind maps to, and
  opening one un-stashes and unfolds that set so you see it arrive.

**Contract.**
```csharp
record WorkspaceDef(string Id, string Label, string Icon, Color Colour, bool IsPrimary);
class TabDef { string Id; string Title; TabKind Kind; string WorkspaceId; string Ext; int Badge; }
// Kind → WorkspaceId default map lives in one place; TabDef.WorkspaceId overrides it.
IReadOnlyList<string> CollapsedWorkspaces { get; }
IReadOnlyList<string> StashedWorkspaces  { get; }
```
Ext badge tones: `md #8fa7c4`, `sql #d4a56c`, `json #7fb08a`, `cs/cshtml #a78bfa`,
`ts/tsx #7dc4f5`.

**Done when.** Tabs visibly cluster by colour; a set can be folded, unfolded, dismissed
and restored; Home behaves as described; a new chat lands next to the other chats.

---

## Step 10 — Log Viewer

**Problem it solves.** Nine log sources, all streaming all the time, none searchable
without opening a file in Notepad.

**Two surfaces, one state.**

1. **Log Peek** — a tool in the chat document's tool panel (280px). Source chips, the
   three-way stream switch, a search box, and check-boxable lines. Tick lines →
   **Send N to chat** pastes them into the composer as a fenced ```log block. Maximise
   promotes it to the full document.
2. **Log Viewer document** (Logs workspace). Left rail / centre stream / right inspector.

**Streaming model — the important part.** A three-way switch: **COLD · BURST · LIVE**.
- COLD: nothing streams. Everything already retained stays fully searchable.
- BURST: streams for `BurstSeconds` (default 30, adjustable), counts down inside the
  switch, then drops itself back to COLD.
- LIVE: tails until switched off.
Per-source toggles decide *what* streams; they never hide history. The status pill reads
`COLD · NOT STREAMING` / `BURST · 27s LEFT` / `LIVE · TAILING`, shortening to
`COLD` / `27s` / `LIVE` under 1250px.

**Left rail** has two tabs:
- **Sources** — collapsible groups: Websites (Marketing, Portal, Admin) · Services (API
  Server, SQL Server) · Local (Build, SSH, Terminal, Console Output). Each row: a dot in
  the source colour (glowing while streaming), name, error count, and a small switch.
- **Archive** — the real on-disk tree: day → build (`bld_2031`, `#1202 · FAILED 14:19`) →
  **`stdout.log`** and the **bookend named for the Git issue** (`1202.log`), plus a
  rolling `services` folder. Opening an archive file drops the viewer to COLD and shows a
  purple read-only banner.

**Filter bar.** Search (plain or regex, `.*` toggle), **HIGHLIGHT** mode (dims
non-matches instead of hiding them), an exclude field (comma-separated, red text), and
saved filters (seeded: Graph 401s, Drift aborts, Build failures) with save-current. Level
pills TRACE→FATAL below. Under the bar, a **history scrubber** with the timestamp you've
dragged back to and a retention read-out.

**Right inspector.** Active filters as removable chips; the selected line's detail
(level, timestamp, source, logger, file path, follow-correlation-ID); and a **scratch
pad** — pinned lines survive filter changes, then go to chat or the clipboard as a set.
Line actions: copy, copy ±3 context, pin, send to chat, follow this logger.
Under 1250px the inspector becomes a slide-over behind a sliders button.

**Contract.**
```csharp
record LogSource(string Id, string Group, string Label, Color Colour, string Path);
record LogLine(DateTime Ts, LogLevel Level, string SourceId, string Logger,
               string CorrelationId, string Message);
interface ILogService {
  IAsyncEnumerable<LogLine> Tail(IEnumerable<string> sourceIds, CancellationToken ct); // LIVE/BURST
  IReadOnlyList<LogLine> Query(LogQuery q);                                            // COLD search
  IReadOnlyList<ArchiveNode> Archive();       // day → build → stdout + bookend(gitId)
}
record LogQuery(string Text, bool Regex, string[] Exclude, LogLevel[] Levels,
                string[] SourceIds, DateTime? From, DateTime? To, string Logger);
```
Burst is a `CancellationTokenSource` + timer over the same `Tail`.

**Done when.** BURST counts down and self-cancels; COLD still returns search results; an
archive bookend opens by Git ID; pinned lines survive a filter change and paste as one
block.

---

## Step 11 — Alerts and Critters

**Problem it solves.** "Service crashed" as a text toast is useless — an alert has to
carry its own fix, and the good news shouldn't need words at all.

**Channel 1 — alerts that carry their fix.** A stack bottom-right above the status bar,
`max-height: 100vh - 92px`, **at most 2 visible** with a "N more waiting in the bell"
pill for the rest (three 150–185px cards do not fit a 541px window). Each card: 3px
left rail in its severity colour, title, timestamp line, the *actual evidence line* in
mono, then the resolution:

| Alert | Primary action |
|---|---|
| API Server crashed | Open the Log Viewer filtered to that source, ERROR+FATAL, inspector open on the line |
| Build failed | Same, filtered to Build + `MSB` |
| Claude is waiting on you | An inline reply field → **Send** posts to the composer and dismisses; never leaves the document |
| Issue blocked | Opens the issue in the **left Git panel**, not a document |
| Worktree dirty / diverged | Opens **Git Doctor** (Step 13) |

**Channel 2 — critters, no words.** A full-screen `IsHitTestVisible="False"` overlay,
tiered by how big the win is. Critter art is user-supplied images keyed by stable slot ids
(`critter-stage-good-0…11`, `critter-stage-evil-0…`).

| Tier | Count | Extras | Fires on |
|---|---|---|---|
| 1 | 1 | — | blocked_by cleared, clean build |
| 2 | 3 | confetti | deploy succeeded, issue closed |
| 3 | 5 | confetti + disco + banner | epic closed |
| 4 | 8 | " | milestone closed |
| 5 | 12 | " | release shipped |

Event shapes: **cheer** (run across, bobbing), **eat** (issue-closed — the `#2144` chip
gets munched away as they run), **carry** (issue opened — mean critters trudge it in
right-to-left), **whammy** (blocked — WHAMMY stamp over a shaking mean critter).
**Confetti and disco are gated on good news**; bad-news events get a red radial wash that
deepens with tier instead.

Animations (keyframes in the mockup — port as `Storyboard`s): `omRun` / `omRunBack`
(translateX across the viewport, 2.8–4.4s linear, staggered 0.16s), `omBob` / `omTrudge`
(bob + rotate, 0.44–0.62s, infinite), `omConfetti` (fall + 760° rotate, 1.9–4.1s),
`omDisco` (three radial-gradient blobs, opacity+scale, 1.6–2.1s infinite,
`mix-blend-mode: screen`), `omShake`, `omMunch`, `omStamp`, `omBanner`, `omCardIn`.

**Bell in the topbar** opens the Alert Lab: fire any alert or celebration on demand
(this is also the QA harness), plus recent history. Badge = live card count.

**Contract.**
```csharp
record Alert(string Id, AlertKind Kind, Severity Sev, string Title, string Meta,
             string Evidence, AlertAction Primary, AlertAction Secondary, bool WantsReply);
record AlertAction(string Label, Func<Task> Invoke);
record Celebration(string EventId, int Tier, Mood Mood, CelebrationShape Shape, string Text);
```
Every emitter (build runner, git watcher, deploy watcher, agent bridge) publishes one of
these two records — never a plain string.

**Done when.** A crash card lands you in the pre-filtered log; a Claude question is
answerable from the card; an epic close throws a tier-3 party; a block throws WHAMMY with
**no** confetti; nothing renders off-screen with three alerts queued.

---

## Step 12 — API Explorers (three of them) and the Autofill Lock

**Problem it solves.** The old runner made you fetch tokens from a console, and the Graph
explorer couldn't tell you *why* a call would fail.

**Three documents, one component** (API Explorers workspace), reachable from the topbar
zap menu, Ctrl+K, and the chat tool panel:
1. **API Endpoint Runner** — local API server, routes scanned from source, grouped by file.
2. **Microsoft Graph Read Explorer** — Graph v1.0 read endpoints, grouped by resource.
3. **Microsoft Graph Write Explorer** — write actions, grouped by resource, risk-rated.

**Layout.** Endpoint rail (search, method badge, human name) · request builder · response
pane (JSON Output / **Raw Response** — real status line, `content-type`, `request-id`,
`client-request-id`, Graph diagnostic header, duration, then the unindented body).

**Auth that authenticates itself.**
- Local: base URL + email/password → **Login & fill token** calls `POST /api/auth/login`
  and fills the bearer itself.
- Graph: tenant picker (each tenant carries its App Registration and its *granted*
  permission list) → **Get token for this tenant** runs client credentials. The token
  panel shows who it's for, when acquired, TTL, flow, and the truncated JWT, with
  copy/clear.
- **Permission gate.** If the selected tenant's App Reg lacks the endpoint's scope, an
  amber banner names the missing grant and offers the consent URL — and a LIVE execute
  returns the real Graph shape: `403 Forbidden`,
  `{"error":{"code":"Authorization_RequestDenied", …, "missingPermission":"…"}}`.

**Request builder.** Path tokens (`{userId}`, `:id`) become labelled fields and substitute
into a live request URL. Read mode gets first-class `$select` / `$filter` / `$top` /
`$expand`. Write mode gets a JSON body with reset-to-example. **Write mode defaults to
DRY RUN** — the response pane prints exactly what *would* be sent (method, URL, tenant,
headers, permission) and the button only turns red and reads "Execute against
&lt;tenant&gt;" when flipped to LIVE. Also: copy as cURL, and **Send to chat** for any
response.

**The autofill lock.** The lock button beside a password field *droops* (tilt +
translateY, 180ms) and opens **Autofill Gated Profile** — the configured profiles with
tier badges (Standard / Enterprise / Premium). Picking one fills both fields and marks
"filled from the gated profile". **+ Add an account** inside the dropdown takes username,
password and tier and does *add-it-and-use-it*: saves the profile, closes the lock, fills
the login. Same profile list as Settings → Accounts & Tiers. This lock is the same control
that belongs on every WebView2 tab **except claude.ai** (setting in Step 16).

**Contract.**
```csharp
record ApiEndpoint(string Group, HttpMethod Method, string Path, string Name,
                   string Permission, RiskLevel Risk, string ExampleBody);
record GraphTenant(string Id, string Label, string Env, string TenantId,
                   string AppRegistration, string[] GrantedScopes);
record GatedProfile(string Id, string User, string Password, string Description, Tier Tier);
interface ITokenBroker {
  Task<Token> ClientCredentials(GraphTenant t);        // Graph
  Task<Token> PasswordLogin(string baseUrl, string user, string pw); // local API
}
```

**Done when.** Each explorer opens from all three entry points; a token is obtained without
leaving the app; a missing scope blocks LIVE with a real 403; the lock adds an account and
logs in with it; Raw Response differs from JSON Output.

---

## Step 13 — Git Doctor

**Problem it solves.** Git refuses something, you paste the error into a chat, you paste
commands back. Git Doctor is the UI that ends that loop — and the model a C# runner binds
to.

**Entry points.** Topbar zap menu, Ctrl+K, the chat toolbox, the git-health alert's
**Fix Git**, and the **Git Pull** quick action (which now opens the Doctor with the reasons
instead of claiming "up to date").

**Header.** Repo, branch, ahead/behind, worktree count, last fetch; a plain-English
headline ("9 things are blocking git right now"); a **commit-hash search box**;
**Re-run checks**; and the red **End this git nightmare** with its subtitle ("backup
branch first, then N commands").

**Findings.** Left rail lists every failed check with a severity dot; fixed ones grey out
and strike through. Centre shows: severity pill, title, where, **what it means in plain
English**, **what git actually printed** (verbatim, mono, red-tinted), then the remedies.
Seeded checks: stale `index.lock`, dirty worktree, "local changes would be overwritten",
diverged 2/5, expired GitHub PAT, detached HEAD in a build worktree, 412 CRLF-only
"changes", prunable worktree, **131 stale branches**.

**Every remedy states its risk and what it preserves** before you run it —
`SAFE` / `CAREFUL` / `DESTRUCTIVE`, plus a sentence like "your edits go to a named stash
and come straight back". Recommended is marked. Each step shows the exact command *and*
why it runs. Destructive options say plainly that the work is gone.

**End this git nightmare** = cut `backup/pre-doctor-<ts>`, run every recommended remedy in
order, finish with `git status --short --branch` to prove the tree is clean.

**Commit lookup.** Paste a hash (`acffa5f1b`) and the finding pane is replaced by:
REACHABLE / UNREACHABLE pill, short sha, subject, the raw block (full sha, author, date,
**found in** which branch or worktree, diffstat), files touched, the consequence in words
("lives only in the bld_2024 worktree, which is prunable — one checkout and it's gone"),
then **Save it on a branch** / **Cherry-pick here** / **Copy git show** / **Ask Claude**.
A miss returns NOT FOUND with **Hunt for it everywhere**
(`git fetch --all --prune` → grep `git log --all` → `git fsck --lost-found`). Every result
prints its search scope: *3 local branches · 12 remote-tracking branches · 4 worktrees ·
reflog · dangling objects*.

**Branch Janitor** (the 131-branch finding). Filters with live counts — All / **Merged
(87)** / Unmerged / Remote gone / Older than 90 d — over a table of name, short sha, age,
`merged` or `N unmerged`, and a note for *remote gone* / *in a worktree*. Merged rows are
pre-ticked. **Delete N selected — backup tag first** builds the plan: backup tag, then
`git branch -d` for merged and `-D` for forced (each line saying which and why), then
`git remote prune origin`.

**Claude bridge, both directions.** *Ask Claude* / *send all findings* pushes the evidence
and proposed commands into the composer. Paste the reply back into the bridge box →
**Extract commands** keeps only runnable lines (`git`, `del`, `cmdkey`, `ssh`, `rm`), each
with a checkbox → **Run N approved**. The run log records every command with its reason.

**Contract — this is the binding surface.**
```csharp
record GitFinding(string CheckId, Severity Sev, string Title, string Where,
                  string PlainEnglish, string RawGitOutput, IReadOnlyList<GitRemedy> Remedies);
record GitRemedy(string Id, string Label, bool Recommended, Risk Risk,
                 string Preserves, IReadOnlyList<GitStep> Steps);
record GitStep(string Cmd, string Why);
interface IGitDoctor {
  Task<IReadOnlyList<GitFinding>> RunChecks();
  IAsyncEnumerable<StepResult> Run(IReadOnlyList<GitStep> plan);   // streams into the run log
  Task<CommitInfo?> Lookup(string shaPrefix);                       // all refs + worktrees + reflog + fsck
  Task<IReadOnlyList<BranchInfo>> Branches();
}
```
**Copy plan JSON** on any finding emits exactly
`{check, severity, remedy, risk, steps[]}` — the "end this nightmare" button is just a
runner over an ordered step list that streams status back.

**Done when.** Checks populate from real git; a remedy runs and the finding marks itself
fixed; the nightmare button cuts a backup branch first; a hash resolves with its
reachability; 87 merged branches delete behind a backup tag; a pasted Claude reply becomes
an approved, runnable plan.

---

## Step 14 — Command Center right panel (per-category)

**Problem it solves.** Ctrl+K found things, then showed one generic sentence about all of
them.

The palette keeps its own visual language (`#0d0f1a` cards, `#1c2036` hairlines,
blue-tinted mono). The right pane now renders per category:

| Tab | Right pane |
|---|---|
| **Git Epics** | milestone + contains tiles, its issues as clickable rows, **Open the epic page** / Git panel |
| **Git Issues** | label, parent epic, title card, **Open the issue page** / Git panel / Its epic / **Dispatch build** |
| **Builds** & **Build IDs** | progress bar (step count + %), the step checklist with ticks, last 10 stdout lines, **Focus in the queue** / Build Watch / **Full log** (opens the Log Viewer filtered to that build) |
| **Claude & URLs** | associated epic + milestone, context meter, the builds tied to that epic, **Open the chat** / Its epic / Sidebar |
| **Services** | status pill, port, description, **Start · Stop · See logs · Open in tab · Open in Edge** |
| **Terminal** | the search box *is* the prompt — type, Enter executes, the session accumulates; **Send session to chat**, Open tool, Clear |
| **SQL** | type SQL, Enter runs it, results as a table with row count and time; below it the repo's `.sql` files (queries / reports / migrations) each with **Load** and **Run**; **Send result to chat**, **Full SQL Runner** |

Two behaviours that are easy to get wrong and were both fixed here:
- On the Terminal and SQL tabs the typed text is a **command buffer, not a list filter** —
  their tool item is exempt from the text filter so the panel can't unmount while you
  type, and the `.sql` file list is never filtered by the query box.
- The palette body is a bounded grid (`grid-template-rows: minmax(0,1fr)` +
  `overflow:hidden`) so the right pane actually scrolls; otherwise the tall panels push
  their primary buttons outside the dialog.

**Done when.** Every tab shows its own panel; Enter in Terminal/SQL executes; a SQL result
survives without touching the input; every panel's buttons are reachable at 925×541.

---

## Step 15 — Settings, redesigned

**Problem it solves.** 31 identical cards nagging "21 Needs Value" with no path through
them.

**Header health strip** — "8 variables still need a value", "GitHub PAT configured",
"Zoho API not set", "Replit watcher off". Each chip is a jump; the first one switches to
Test Environment *and* turns on the needs-only filter.

**Left rail grouped** into Environment (Test Environment, Scheduled Runs) · Credentials
(API Tokens, Accounts & Tiers, Claude Projects) · Automation (Replit Watcher, SSH &
Remote, Web Tools) · This machine (General, Sound & Audio, LinkedIn Pre-fill), with a
count badge on anything unfinished. Rail narrows 214→186px under 1150px.

**Variables became rows, not cards.** One line each: name, domain chip, "used in N
manifests", the value field inline, then reveal / copy / clear. Unset rows are
amber-bordered; filled rows recede. Domain filters carry counts; **NEEDS VALUE (n)** is a
toggle; plus **Copy as .env** and **Re-scan manifests**. Rows wrap (name block
`flex:1 1 180px`, input from 160px) so nothing renders outside the pane on a narrow
window.

**Claude Projects supports both accounts** — Primary / Secondary tabs, each with its own
email, plan and routing, that account's projects listed, and link-another-project.

**Accounts & Tiers** is the single source for the autofill lock's profiles: list with tier
badges, reveal/copy/remove, and an add form (user, password, description, tier).

Smaller categories are real settings lists (toggle / text / segmented): Replit Watcher,
Scheduled Runs (cron per job), SSH & Remote, Web Tools, General, Sound & Audio, LinkedIn
Pre-fill.

**One trap to avoid:** the old build had a *placeholder* Settings view in the chat tool
belt ("SettingsTabView lands here"). There is one Settings surface now — the left-nav
gear, the tool-belt Settings tool, the topbar menu and Ctrl+K all render the same page.

**Contract.**
```csharp
record EnvVar(string Name, string Domain, string Value, string[] UsedInManifests);
record SettingRow(string Id, string Label, SettingType Type, object Value, string[] Options);
interface ISettingsStore {                 // per-machine, credentials in Windows Credential Manager
  T Get<T>(string key, T fallback); void Set<T>(string key, T value);
  IReadOnlyList<EnvVar> ScanManifests();   // powers "used in N manifests" + Re-scan
}
```

**Done when.** The health chips navigate and filter; a variable can be filled, revealed,
copied and cleared inline; both Claude accounts list their own projects; every category
has real controls; the gear and the tool belt show this page, not a placeholder.

---

## Step 16 — Settings in place (the cross-cutting rule)

Not a screen — a rule that applies everywhere from now on. **When a setting is what's
blocking you, offer it where you hit the wall**, and have it write to the same store the
Settings page reads.

Shipped instances:
- **Autofill lock → + Add an account** — add a gated profile mid-login, then
  *add-it-and-use-it*; appears immediately in Settings → Accounts & Tiers.
- Both lock dropdowns link to **Manage in Settings** (deep-links to that category).
- The git-health alert's **Fix Git** opens Git Doctor rather than a settings page.
- Log Viewer source toggles and the API explorers' tenant picker are settings surfaced
  in the workflow.

Still to do, same pattern: a gear on the Graph tenant picker to **add an App Registration**
inline, and a paste-a-fresh-PAT field on Git Doctor's auth finding.

**Implementation note.** `openSettings(categoryId)` is the deep-link primitive: it opens
the single Settings surface, selects a category, and collapses the side panels (the Log
Viewer and Git Doctor do the same, so the document keeps its width).

---

## Responsiveness — the recurring bug class

Every one of these documents shipped with the same defect first: fixed-width columns and
non-shrinkable rows in a `min-height: 0` flex container, so primary controls rendered
outside the visible box with no scroller. The fixes that stuck, as rules:

1. One scroll region owns the body; the title bar is the only fixed row
   (`flex:1; min-height:0; overflow-y:auto` on the body, not on a child).
2. No fixed widths on content rows — `flex: 1 1 <basis>` + `flex-wrap: wrap`.
3. Panes get `min-width: 0`; grid containers that must bound their children get
   `grid-template-rows: minmax(0, 1fr)` + `overflow: hidden`.
4. Side columns collapse behind a toggle at a breakpoint (1150px for rails, 1250px for
   inspectors) rather than squeezing the middle.
5. In WPF: `ScrollViewer` with `VerticalScrollBarVisibility="Auto"` on the body row of a
   `Grid` whose row is `Height="*"`, and `SharedSizeGroup`/`*` columns instead of fixed
   `Width` on content rows.

Verify each screen at **925×541** (the smallest window the mockup was reviewed at) and
confirm every primary button's right and bottom edges are inside its pane's bounds.

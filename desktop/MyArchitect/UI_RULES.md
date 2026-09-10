# MyArchitect — UI Shell Rules

**Status: standing rule, all future work.** Any issue that touches MyArchitect's
UI reads this first. If a new Feature's UI doesn't fit anywhere in this shell,
that's a signal to ask before building, not to bolt on a new icon/panel.

This document exists because BuildConsole's tool-rail/wrench-menu pattern —
add an icon per new tool — produced a mosh pit as it grew. With 27 Features
already filed under Epic #3454, MyArchitect does not repeat that.

---

## 1. The shell, top to bottom

**Title bar (custom, no standard Windows chrome — QAT position):**
Tenant Switcher + Command Palette trigger. Same place Office puts Undo/Redo/
Save — always visible, independent of whichever Ribbon tab is active.

**Ribbon (below the title bar):** navigation and selection — which tenant,
which view, which document. Six tabs, fixed set (see §2). Library:
**Fluent.Ribbon** (not the built-in `System.Windows.Controls.Ribbon`, which
looks like Office 2010 next to WPF-UI's dark Fluent theme).

**Left flyout — reference, read-only.** Things you look things up in. Never
an action, never a checkbox. Bookmarks/portal deep-links, VIP lookup, consent
status, document browse.

**Right flyout — "my stuff," action/log. Always docked, independent of
Ribbon tab.** Things you DO in — log a note, check off a step, acknowledge a
task. Notes, screenshots, remediation/runbook/POA&M step checkoffs, task
queue acknowledge, break-glass override.

**Middle: documents.** WebView2 tabs — portals, and anything else that's a
"document" rather than reference or action (unchanged from what's already
built).

**Bottom status bar:**
- Contract hour utilization, with a progress bar (real once #3473/#3474 land)
- Current time
- App version (from the assembly, never hardcoded — see §4)
- Rotating status messages (last action, connection state)

**Log viewer:** lives in the title-bar command area, not the Ribbon or either
flyout. Two modes, never blended:
- **Loaded (default):** static local history. Opens showing what's already
  there. Nothing arrives on its own.
- **Live (explicit only):** a real Play button starts an active subscription
  (SSE stream, local Console stdout). Pressing it again stops it. No
  auto-connect, ever, on open.

---

## 2. The six Ribbon tabs — fixed set, nothing added without updating this doc

| Tab | Groups |
|---|---|
| **Home** | Tenant switcher, portal bookmarks/deep-links, "open all tabs" |
| **Console** | Script Library, execute/replay |
| **Remediation** | Tracker, Runbooks, POA&Ms, Change Control (CAB/freeze/maintenance/PIR) |
| **Telemetry** | SOW/Assessment Viewer, Telemetry Console, SLA, Alerts |
| **Documents** | Document Hub, Notes, Screenshots |
| **Admin** | Vault, VIP lookup, consent status, Audit Log, Break-Glass, Support Tickets |

Chat is a persistent dock, not a tab — always available, never switched away
from.

A Feature that doesn't map cleanly into one of these six tabs (or the left/
right flyout split in §1) does not get a seventh tab or a new panel by
default — flag it and ask before inventing a new shell region.

---

## 3. What does NOT get permanent chrome

Genuinely rare actions (Break-Glass override, Audit Log) live inside the
Admin tab, not a dedicated icon — matches §2. Nothing in this app gets its
own icon in a generic icon bar; that pattern is exactly what this document
replaces. The four placeholder activity-bar icons Gemini scaffolded from a
generic VS Code template (Search, Source Control, Run and Debug, Extensions
& Scripts) are removed entirely — never had real content, don't get any.

---

## 4. Version / update mechanism — reuses BuildConsole's real pattern exactly

Same mechanism as `desktop/BuildConsole/MainWindow.VersionUpdate.cs` +
`Services/VersionInfo.cs`, ported for MyArchitect:

- A 30s timer polls the local repo's git commit count for
  `desktop/MyArchitect/`, computing a current build number
- Compare against the version compiled into the running binary
- Status bar shows `Current: vX.Y.build · running vX.Y.build (N behind)`
- When behind, an Update button appears in the status bar
- Click shells out to `deploy-myarchitect.cmd` (git pull + rebuild +
  relaunch) — the script owns the relaunch, replacing the running process;
  the C# code does not manage restart itself

**Explicitly different from BuildConsole: no metered-connection gate.**
BuildConsole's gate exists to stop an agent from triggering an uncapped
`pnpm install` on a rental connection — it is an agent guardrail, not a
"protect the human" feature. Clicking Update in MyArchitect is Shane acting
deliberately, so the button always shows immediately when behind, no network
check, no override needed.

---

## 5. Real dependency

Every other Feature's UI work depends on this shell existing — Ribbon tabs,
both flyouts, the title-bar QAT, and the status bar are real prerequisites
other issues attach their UI into, not decoration to retrofit later. When
Features get broken into real Issues, wire `blocked_by` against this
Feature's sentinel issue, per `BUILD_QUEUE_METHOD.md` §5.

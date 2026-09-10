# MyArchitect — UI Shell Rules

**Status: standing rule, all future work.** Any issue that touches MyArchitect's
UI reads this first. If a new Feature's UI doesn't fit anywhere in this shell,
that's a signal to ask before building, not to bolt on a new tab/panel.

This document exists because BuildConsole's tool-rail/wrench-menu pattern —
add an icon per new tool — produced a mosh pit as it grew. With 27+ Features
filed under Epic #3454, MyArchitect does not repeat that.

**This is a deliberate port of AdminV2's real, working shell** (Shane's own
design, `artifacts/admin-panel/src/adminv2/SHELL.md` — read that file too,
it's the source of truth for the mechanics below). Adapted for WPF/
Fluent.Ribbon instead of React, and for MyArchitect's own domain (tenants,
remediation, scripts) instead of AdminV2's (SQL, CRM, build tracker). Where
this doc and SHELL.md conflict on a shared concept, that's a real
inconsistency to flag, not something to silently pick a side on.

---

## The three governing rules (from AdminV2's `handoff.md`, unchanged)

1. **Navigation should not require memory.**
2. **The same thing is always in the same place.**
3. **A one-off task should not move you off what you were doing.**

---

## 1. The shell, top to bottom

**Title bar (custom, no standard Windows chrome — QAT position):**
Tenant Switcher · Command Palette trigger · Undo/Redo (screen-aware — see §7,
still open whether this ports at all).

**Ribbon:** fixed tabs + contextual tabs, both intent-restricted (§2).
Library: **Fluent.Ribbon**, not the built-in `System.Windows.Controls.Ribbon`
(looks like Office 2010 next to WPF-UI's dark Fluent theme).

**Left panel — reference, read-only.** Bookmarks/portal deep-links, VIP
lookup, consent status, document browse. Shell owns header/collapse/
splitter/persisted size; a Feature supplies only the body.

**Right panel — "my stuff," full-panel record workspace, always docked.**
NOT a small Peek overlay (AdminV2's Peek is transient/small; this is
larger, takes the entire right panel, persistently docked). Same content
model as Peek — facts, write-through edits, confirm-armed actions, list
rows — rendered at full-panel size instead. This is the resolved shape;
Shane is porting the same full-panel version back into AdminV2 separately.

**Middle: documents.** WebView2 tabs — portals and anything else that's a
"document" rather than reference or action.

**Bottom status bar:** 24px, the app's own, not a screen's.
- Contract hour utilization + progress bar (real once #3473/#3474 land)
- Current time
- App version (from the assembly, never hardcoded — §6)
- Segments are either buttons (`onSelect`) or inert text — never a fake
  clickable stop for read-only state

**Log viewer:** title-bar command area, not the Ribbon or either panel.
- **Loaded (default):** static local history, nothing arrives on its own
- **Live (explicit only):** a real Play button starts the subscription (SSE
  stream + local Console stdout); pressing again stops it. No auto-connect.

---

## 2. Ribbon tabs — fixed + contextual, intent-restricted

**A fixed tab may only carry `open`, `create`, or `global` intent — never
`record`.** Anything needing a specific tenant/runbook/change-request open
belongs on a **contextual tab**, not a fixed one. This is the rule AdminV2
enforces at the contract level (`ShellContractError` on violation) after an
audit found several of its own tabs had drifted — port the discipline, not
just the tab list.

**Fixed tabs (closed list):**

| Tab | Groups (open/create/global only) |
|---|---|
| **Home** | Tenant switcher, portal bookmarks/deep-links, "open all tabs" |
| **Console** | Script Library browse (gallery, §4), launch a run |
| **Watch** | The one "what needs me" surface — Alerts (#3483), Task Queue (#3490), SLA breaches (#3487), consolidated into shared themed groups, not three separate tabs. Live counts belong here and nowhere else. |
| **Documents** | Document Hub gallery (#3486) |
| **Admin** | Vault (#3461), Audit Log (#3489), Break-Glass (#3480), consent status (#3485) — genuinely rare, global-scope actions only |

**Contextual tabs** appear when a record opens (a specific runbook, tracker
step, change request, POA&M) and auto-select. The shell always splices a
**Back group at position 2** — largest button is wherever you just came
from, named properly, then the two before that, then "Search everything."
Never hand-author this — same reasoning as AdminV2: two Back groups in two
places breaks the one thing users rely on most.

Contextual tabs house: Remediation Tracker step actions (#3471), Runbook
step completion (#3479), POA&M milestone edits (#3481), Change Control
CAB/freeze/PIR actions on a specific request (#3482).

---

## 3. Right panel — full record workspace (resolved shape)

Same fields as AdminV2's Peek, full-panel:
- `facts` — size-aware (short numeric values large or short text renders 
big/hugs width; longer text wraps small) — same rule, don't reinvent
- `edits` — write straight through, no save step, no dirty state
- `actions` — `confirm: true` arms in place (press once → relabels
  "press again" → second press fires); no confirm dialog, ever
- `list` — rows that open another record's full-panel workspace

This is where "log something, check off something" happens: a
`remediation_tracker_steps` status field is an `edits` cycle-button; a
runbook step-complete is an `actions` entry; a Session Note is an `edits`
text field on the open record's workspace, not a separate always-visible
notes box.

---

## 4. Galleries — real data rows, not labels

A ribbon command with a gallery becomes a dropdown/panel of real rows
(tile/name/sub — a package shows its check count, a script shows
destructive-vs-read-only, a document shows when it last generated) —
never a bare label list. Script Library (#3460), Runbooks (#3479),
Document Hub (#3486) are galleries. Selecting a row opens that record's
full-panel workspace (§3), never navigates away.

---

## 5. Command Palette — four prefixes, ported directly

| prefix | type | for |
|---|---|---|
| `@` | destination | browse all places without knowing names |
| `>` | action | verbs only |
| `#` | record | nouns only — a specific tenant, runbook, request |
| `?` | answer | live numbers (SLA breaches count, open POA&Ms) — the number IS the point |

Commands are computed live on every palette open, never cached — a stale
`?` answer is worse than none. Matching stays layered: exact → prefix →
word-start → substring → **acronym** → subsequence with a gap penalty.
Keep the acronym tier — it's what makes a 3-letter guess find the right
thing without perfect recall.

---

## 6. Version / update mechanism

Same mechanism as `desktop/BuildConsole/MainWindow.VersionUpdate.cs` +
`Services/VersionInfo.cs`, ported for MyArchitect:
- 30s timer polls local repo's git commit count for `desktop/MyArchitect/`
- Status bar shows `Current: vX.Y.build · running vX.Y.build (N behind)`
- Update button shells out to `deploy-myarchitect.cmd` (git pull + rebuild +
  relaunch) — the script owns the relaunch, not the C# code

**No metered-connection gate.** BuildConsole's gate stops an agent from
triggering an uncapped `pnpm install` — an agent guardrail, not a
"protect the human" feature. Clicking Update in MyArchitect is Shane
acting deliberately: always show the button when behind, no network check.

---

## 7. Open — not yet resolved

**Undo/Redo.** AdminV2 has a real per-screen undo stack (`pushUndo`/`undo`/
`redo`, capped at 20, revert functions per mutation). Several MyArchitect
actions already have real server-side rollback (`msp_change_requests`
rollback, #3471). Does client-side Undo/Redo still add value on top of
that, or does the real rollback already cover it? Don't build either
side of this until it's answered.

---

## 8. What does NOT get permanent chrome

The four placeholder activity-bar icons Gemini scaffolded from a generic
VS Code template (Search, Source Control, Run and Debug, Extensions &
Scripts) are removed entirely — never had real content. Bookmarks stays,
folded into Home's reference panel. Nothing gets a badge except the one
Watch-tab live count (§2) and a bottom-panel queue count, same "one badge"
rule as AdminV2 — nothing is marked red just to be noticed.

---

## 9. Real dependency

Every other Feature's UI work depends on this shell existing. When
Features get broken into real Issues, wire `blocked_by` against this
Feature's (#3493) sentinel issue, per `BUILD_QUEUE_METHOD.md` §5.

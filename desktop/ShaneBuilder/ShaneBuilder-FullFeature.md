# Build Console — Full Feature Breakdown for Git

**Purpose of this document.** Git currently reports ~77% complete because the tree only
contains the work that went through chat. That is roughly 5% of the real build. This
document enumerates every major surface in the Build Console design, the features inside
each, and the issues each feature implies — so the Git tree reflects the actual product
instead of the conversation history.

**Hierarchy this maps to:** `Milestone → GATE → Epic → Feature → Issue`

**How to use this with Claude.ai chat.** Feed one Epic section at a time. Ask Claude to
create the Feature parents first, then the Issues under each. Do not create Issues before
their Feature exists — orphaned issues are the exact anomaly the Git Panel now flags as a
health finding.

**Status key used below**
- `BUILT` — designed and represented in the prototype
- `PARTIAL` — designed, obvious gaps named in the issue list
- `SPEC` — named and scoped, not yet designed
- `EXTERNAL` — lives outside the BuildConsole executable

---

## EPIC #1202 — Build Console (the shell itself)

### Feature: App Shell & Chrome — `BUILT`
The frame everything else mounts into.
- Top bar: workspace pips, objective nudge, search trigger, Filter Studio, toggle cluster
- Left icon rail with panel tiles and active-state highlighting
- Left panel host — one panel at a time, width driven by source
- Document area with tab bar
- Right Build Queue panel, retractable
- Status bar with live state counts and usage meters

**Issues**
1. Top bar renders as a context gauge for the active chat tab — wash fills L→R, 2.5px edge line at the bottom
2. Gauge colour bands: green <70%, amber 70–89%, red ≥90% with pulsing edge
3. Gauge reads empty on non-chat tabs (Home, Git Map, Gate) — no false signal
4. "Hand off to a new chat" pill appears at 70%, switches to warning copy at 90%
5. Handoff action opens a new chat tab anchored to the same feature/epic
6. Handoff pre-loads the composer with feature, epic, open issue numbers, and a pointer back to the origin chat
7. Left panel widens to full page in place (`Expand full page here`) without opening a tab
8. Every panel offers `Send to tab` as the explicit opt-in to a takeover
9. Panel width transitions animate; collapse returns to the 280px rail
10. Tab bar opens with Home only — no seeded tabs

### Feature: Focus Mode — `BUILT`
Two things at a time, everything else recedes.
- Max 2 focused items, mixed Epic and Feature
- Focus pill in the top bar, left of search
- Ghosting across every surface
- Hide-ghosts toggle

**Issues**
1. Focus pill shows one chip per focused item with kind marker (EPIC / FEAT) and its own dismiss
2. Third selection drops the oldest — never more than two
3. Ghosted items render at 20% opacity with 75% grayscale
4. Eye toggle removes ghosts from the DOM entirely instead of dimming
5. Ghosting applies to: Build Queue feature bands, Git tree epic + feature rows, Batter Up groups, chat rail rows
6. Focusing an Epic keeps all of its Features lit
7. Focus entry points: Build Queue band target button, Feature peek, Epic peek, Home objectives
8. Home "Set Today's Objectives" and Focus Mode share one state — picking on Home sets focus
9. Clear-all resets both the pill and the Home selection
10. **Gap:** focus does not yet ghost the Git Map, Shot Vault, or the document area

### Feature: Build Queue — `PARTIAL`
The right rail. Where dispatched work lives.
- Grouped by Feature by default, Epic grouping behind a toggle
- Feature band headers with ring, states, and actions
- Build cards with spine, blockers, checklists, critters
- Retracted mode
- Pause overlay

**Issues**
1. Feature/Epic grouping toggle in the queue toolbar
2. Feature band header: progress ring with % closed in the centre
3. Band header: closed/total under the ring
4. Band header: state pill (FOCUS / ACTIVE / STALLED / PARKED / PAUSED)
5. Band header: epic tag, open count, bug count, last build number
6. Band header: `Queue all` promotes every open issue in the feature
7. Six state chips per band — up next, running, verifying, blocked, parked, paused
8. Clicking a state chip filters the band to that state only
9. Active filter shows a dashed "showing X only" pill to clear it
10. Zero-count chips render dimmed and are not clickable
11. Unassigned issues collect in a "No feature assigned" band with an inline health warning
12. **Retracted queue: each build renders as a round progress ring showing its own progress** — `SPEC`
13. **Hovering a retracted build opens a popout layover with the full expanded-card design** — `SPEC`
14. Slot pinning across restarts — `SPEC`
15. Blocked builds nest under their blocker — `SPEC`
16. Queue scroll releases the wheel lock correctly — bug
17. Queue keeps scroll position across a refresh — `SPEC`

### Feature: Build Matrix — `BUILT`
Lives inside the Build Queue, not the left rail.
- 8 agent slots
- Per-slot state, issue, feature, model
- Idle slots dimmed

**Issues**
1. `Matrix` chip in the queue toolbar toggles the drawer above the queue list
2. Slot card shows slot number, state badge, issue number + title, feature and model
3. Busy/idle visual distinction; running slots pulse
4. Slot count summary (`4/8 slots`)
5. Clicking a busy slot focuses that build in the queue
6. `Tab` button sends the matrix to its own tab
7. **Gap:** no slot-level cancel, requeue, or reassign yet

### Feature: Git Panel — `BUILT`
The tree and the peek panel. The core of the whole tool.
- Milestone → Gate → Epic → Feature → Issue, all peekable in-panel
- Breadcrumb navigation
- Expand-in-place, never a forced tab

**Issues**
1. Tree renders Epic → FEATURE → Issue with collapsible feature rows
2. Feature rows show state pill, bug count, and open count
3. Clicking a Milestone opens it in the panel
4. Clicking the GATE card opens it in the panel
5. Clicking an Epic opens it in the panel
6. Clicking a FEATURE name opens it in the panel
7. Clicking an Issue opens it in the panel
8. Breadcrumb strip shows labelled chips (`MILESTONE v1.1 › EPIC #1202 Build Console › FEATURE SQL Runner`)
9. Every crumb is clickable and truncates the trail correctly
10. Back button names its destination instead of saying "Back"
11. Ancestry is derived when there is no drill trail — open an issue cold and still walk up
12. Milestone panel: ring, epics/features/issues/gate-check vitals, stalled-feature warning, per-epic rows with mini rings and weeks-to-done
13. Gate panel: ring of green checks, verdict band, blocked critical epics, full check list, Run Verification Sweep
14. Epic panel: EPIC identity badge, milestone, ring, sub-features, issues closed, burn rate, estimated remaining
15. Epic panel: on-target / behind verdict against the target date
16. Epic panel: feature list with mini ring, state, non-zero state chips, last build, idle gap, hours left, closed count
17. Epic panel: blocked-on band naming the upstream blocker
18. Epic panel: per-feature Queue all / Park / Pause
19. Park and Pause propagate to every surface the feature appears on
20. Feature panel: ring, state, epic, bug count, last build, six state chips, issue list
21. Feature panel state chips filter the issue list
22. Epics with no features show an amber "nothing here has a burndown" warning
23. Every peek offers `Expand full page here` and, where a document exists, `Send to tab`

### Feature: Git Map — `BUILT`
Four-product landscape, drill to any depth.
- Product / Epic / Feature / Issue views
- Burndowns, stalled bands, mirrored pairs
- Mini version in the chat rail

**Issues**
1. "Started and dropped" red band surfaces features untouched for N+ builds
2. Per-feature burndown and closed/total
3. Mirrored feature pairs between Customer Portal and MSP Portal
4. Focus-build parking reasons ride on the card
5. Per-issue "why is this stuck" reasoning on every open issue
6. Mini Git Map in the chat rail shares the feature roster with the full tab
7. **Gap:** full tab and mini still hold separate copies of the data

### Feature: Chats — `PARTIAL`
- Chat panel grouped by epic, anchored by feature
- Chat Finder
- New Chat with feature anchoring

**Issues**
1. Every chat row shows the feature it is anchored to
2. New Chat button at the top of the Chats panel
3. New Chat opens a disclosure explaining the anchor, listing active features with their epic and state
4. "No feature yet — decide later" option for unanchored chats
5. New chat opens as a claude.ai tab with the anchor written into its subtitle
6. Document breadcrumb reads `Epic / ⬡ Feature`
7. Cross-epic question round-trip: ask sideways, capture evidence, paste the answer back into the origin chat
8. Per-tab composer drafts so sends target the right chat
9. **Gap:** no chat archive, no context-size warning per chat row

### Feature: Test Pad — `BUILT`
Replaces Notepad during a test pass.
- Floating, never shifts layout
- Auto-stamped context
- Typed notes
- Screenshot attach + paste tray
- Notepad import

**Issues**
1. Pill bottom-right with unsent-count badge; expands to the pad
2. Composer files a note on Enter and clears
3. Leading marker sets type: `!` bug, `?` question, `+` idea, `.` works
4. Type chips insert the marker for you
5. Every note stamps screen, feature, and the build number running at that moment
6. Status band: "Claude is working — N waiting" → "Claude is free — send N" → "Nothing waiting"
7. Notes list with per-note select, delete, and SENT state
8. "By feature" regroups the list
9. Click a note body to load it back into the composer; Enter saves, Esc cancels; EDITED tag
10. Sent notes are locked from editing
11. `Send to Claude` drops a formatted block with every stamp into the open chat's composer
12. Pipeline caption makes the destination explicit: Note → Claude architects → you approve → prompt + git issue → Batter Up
13. Copy-as-markdown for the selection
14. `Attach shot` arms the next note; the note carries a droppable thumbnail
15. Sending notes with shots opens the Paste Tray
16. Paste Tray: one shot at a time, large preview, note text, `1 of 3`, Copy image → "Copied — paste with Ctrl+V", Next, Done
17. **Import: paste a whole Notepad file**
18. Import: a short line ending in `:` (or a bare 1–4 word line) becomes a Section, not a note
19. Import: a paragraph under a section becomes one note; wrapped lines rejoin
20. Import: bullets and numbering split into their own notes and get stripped
21. Import: bare short lines (`Run Test`, `RAW JSON`) split into their own notes
22. Import: `<need screen shots>` is stripped and flags the note for a shot
23. Import: features auto-match from section or body text; the dropdown is a fallback for unmatched
24. Import: header reports chars, notes, sections, and matched count, plus a type tally
25. Import: click any type chip in the preview to correct it
26. Import: per-row merge-up button
27. Import: multi-select tick boxes with `Merge N up`
28. Import: merged note shows `+N merged`, click to split back out; `Undo merges` resets all

### Feature: Batter Up — `PARTIAL`
The staging area between a decision and a build.
- Rail panel, grouped by feature, collapsed
- Four lanes

**Issues**
1. Lane switch with live counts: All / Batter Up / AI Batter Up / AI For Shane
2. Grouping by feature persists across lanes
3. Group header: state pill, count, `Dispatch all`
4. Item: AI FOUND vs YOU FILED badge, effort, why it is here
5. Item actions: Dispatch, Hold / Release
6. AI For Shane items are questions — NEEDS YOU badge, amber tint, reason it is blocking
7. AI For Shane action is `Answer in chat`, opening a chat anchored to that feature
8. Groups made entirely of questions lose `Dispatch all`
9. Items with no feature collect at the bottom flagged "needs a home before it can be built"
10. `Expand full page here` and `Send to tab`
11. **Real flow to honour:** a Batter Up item requires a build prompt written by Claude after approval, then a Git issue push, then an app-side Git refresh. Nothing may write directly to the queue.

### Feature: Shot Vault — `PARTIAL`
- Rail panel for the quick grab
- Full tab for the real thing

**Issues**
1. Panel: search by shot name or screen
2. Panel: tag filter chips derived from the shot set
3. Panel: runs newest-first with timestamps and counts
4. Panel: thumbnail grid with DIFF badges
5. Panel: per-shot Copy
6. `Expand full page here` and `Send to tab`
7. **Gap:** no retention policy, no compare-to-baseline in the panel

### Feature: Feature Index — `SPEC`
- Should be a fly-out panel
- Table and filters can shrink
- May be a duplicate of the Git Panel feature layer — decide before building

### Feature: Command Palette — `BUILT`
**Issues**
1. `Features` tab searchable by name or number
2. Feature result shows epic, open count, bug count, state, closed count, last build
3. Primary action opens the feature in the Build Queue and expands its band
4. Existing tabs: Git Epics, Git Issues, Builds, Build IDs, Claude, Services, Terminal, SQL, Files

### Feature: Detected in this chat — `BUILT`
**Issues**
1. Collapsible groups (Verifying, Claude) above loose detections
2. Typed detection cards: GIT ISSUE / TASK / TODO
3. Promote to Queue and Dismiss per card
4. Group cards render at full height inside the scroller — do not let flex children shrink

### Feature: I have a thought — `PARTIAL`
**Issues**
1. Quick capture from the top bar, saves without breaking flow
2. **Gap: a saved thought cannot be copied**
3. **Gap: a saved thought cannot be sent to chat**
4. **Gap: a saved thought cannot become a Test Pad note or a Batter Up item**
5. Decide whether this merges into Test Pad or stays a separate one-liner capture

### Feature: Favorites — `PARTIAL`
**Issues**
1. Quick-access links (LinkedIn, GitHub, etc.)
2. Clicking a favourite opens it as a tab in the main window
3. Generic links group into the **Web** workspace
4. A link matching a Dev URL groups into **Dev**
5. A link matching a Stage URL groups into **Stage**
6. A link matching a Production URL groups into **Production**
7. URL→workspace matching rules are configurable in Settings

### Feature: Build Watch — `SPEC`
1. **Not a panel.** Opens as its own top-level window so it can live on a second monitor
2. Window state and monitor position persist across restarts

---

## EPIC #1096 — Application Core

### Feature: Graph Sync — `PARTIAL`
1. Delta-token expiry falls back to a full sync
2. Per-tenant throttle backoff on 429

### Feature: Signal Engines — `PARTIAL`
1. SOW line-item diffing
2. SLA pause (blocked on Change Control)
3. Drift double-fires on DST — bug

### Feature: Config Packs — `PARTIAL`
1. `config_pack_templates.check_key` is nearly empty — only one check resolves
2. Two source files contain a literal NUL byte and are invisible to grep
3. Schema AST → TypeScript codegen worker with incremental cache

### Feature: State Snapshot & Diff — `SPEC`
1. Atomic state snapshot diff journal with rollback protection
2. Template variable substitution sandbox with a memory quota watchdog

---

## EPIC #1485 — Customer Portal
### Feature: API Gateway & RBAC — `PARTIAL`
### Feature: Edge Security & TLS — `SPEC`
(Existing Git content — reconcile rather than recreate.)

---

## EPIC #1571 — MSP / Portal Admin
Every customer-facing capability needs its management counterpart here. Mirrored pairs
are already modelled in the Git Map — carry them into Git as explicit links.

---

## EXTERNAL — outside the BuildConsole executable

### Feature: UI Automation (Playwright) — `SPEC`
Web tests running through Playwright.
1. **Run Test** dialog — needs a screenshot before design
2. **Raw JSON** view — needs a screenshot before design
3. **Workflow Chart** view — needs a screenshot before design
4. Suite status surfaces in the shell; drill in only on failure
5. Agents block on the real result, not a simulated one

### Feature: WebTester — `EXTERNAL`
A separate executable that runs the Playwright suites.
1. Placeholder in the Console reporting whether WebTester is running
2. Live progress while a suite executes
3. Error surface when the runner itself fails, distinct from a test failure
4. Report view the agent can read when testing finishes
5. Handshake contract between BuildConsole and WebTester — define before building either side

---

## Cross-cutting: Repo Health — `BUILT`
Anomalies detected live from GitHub data, surfaced in the Claude chat panel rather than a
Kanban.
1. Depth violations (issues deeper than the allowed level)
2. Naming violations ("Epic:" prefix on something sitting at feature depth)
3. Dead-subtree and stale-reference detection against retired paths
4. Orphan detection — open children of closed parents
5. **Issues with no Feature parent** — they never appear in a burndown and go missing between builds
6. Select findings and send them to Claude; findings update from the conversation

---

## What to tell Claude.ai when you paste this

> Create Git Features under each Epic exactly as named above. Then create one Issue per
> numbered line under each Feature. Mark anything tagged `SPEC` as not-started, `PARTIAL`
> as in-progress, and `BUILT` as ready-for-verification rather than closed — closing them
> is a separate pass once each is verified in the app. Do not create any Issue without a
> Feature parent.

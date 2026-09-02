# Handoff: Build Chain Map

A standalone page for ShaneBuilder that visualizes and edits one Epic's build chain:
**Epic → Feature → Issue → `blocked_by`**, exactly as defined in `BUILD_QUEUE_METHOD.md` (§1, §5, §6, §10).
It shows which issues can launch now, what holds every other issue, and how Features gate one another
through their sentinels. It is also an editor: priority order, sentinels, manual gates, board status and
`blocked_by` edges can all be changed on the map.

This handoff covers **this page only**. It has no dependency on any other ShaneBuilder screen.

## About the design files

`Build Chain Map.dc.html` is a **design reference built in HTML** — a working prototype of the intended look and
behavior, not production code to ship. Recreate it in the target codebase's existing environment and patterns
(ShaneBuilder's stack; if no UI framework exists yet, pick the one the rest of ShaneBuilder will use). Open the
HTML in a browser to see and click through the real thing; the README documents every measurement it uses.

Files in this bundle:

- `Build Chain Map.dc.html` — the prototype (template + logic in one file).
- `support.js`, `lucide-local.js`, `_ds/…` — prototype runtime, icon set and font/color tokens the HTML loads. Reference only.
- `BUILD_QUEUE_METHOD.md` — the process doc the page implements. The rules below cite it by section.

## Fidelity

**High-fidelity.** Colors, type sizes, spacing, node geometry and interactions are final. Recreate them as documented.
The **data is placeholder**: Feature/issue numbers and titles were invented from the §10 worked example
(the real ones must come from GitHub — see *Data model*). Model/effort per issue is also illustrative.

---

## Screen: Build Chain Map

Single screen, dark, VS-Code-tight density. Designed at 1440 × 900, fills the window.
Root: `display:flex; flex-direction:column; height:100%; background:#0a0d12; color:#c9d1d9; font-family: Inter`.

### Layout (top to bottom)

1. **Top bar** — `min-height:56px; padding:10px 14px; background:#0d1117; border-bottom:1px solid #21262d`.
   Flex row, `gap:8px 14px`, `flex-wrap:wrap` (below ~1390px the stats and controls drop to a second row).
2. **Body** — `flex:1; display:flex`:
   - **Canvas** (left, `flex:1; overflow:auto`) — scrollable graph stage. Background `#0a0d12` with a dot grid:
     `radial-gradient(#141a22 1px, transparent 1px)`, `background-size:22px 22px`.
   - **Inspector** (right, `width:312px; background:#0d1117; border-left:1px solid #21262d; padding:14px 15px 18px; overflow-y:auto; gap:12px`).
3. **Status strip** — `height:26px; padding:0 14px; background:#0d1117; border-top:1px solid #21262d; font-size:10px`.
   Left: context hint (icon + text). Right: `"{fanin} fan-in · {gate} gate · {manual} added"` in mono.

Scrollbars: 11px, thumb `#2e3742` with 3px `#0d1117` border, radius 8, hover `#3d4856`.

### Top bar contents (left → right)

- **Title block**: 28×28 icon tile (`background:#1d3450; color:#6a8fb5; radius 7`, Lucide `git-fork` 14px) +
  eyebrow `BUILD CHAIN · §5 FEATURE CHAINING` (8.5px / 800 / tracking .11em / uppercase / `#6a8fb5`) over a baseline row:
  epic name (13.5px / 800 / `#e6edf3`), `#2198` (mono 10px `#576069`), subtitle `Epic → Feature → Issue → blocked_by` (10.5px `#8b949e`, nowrap).
- **Stats strip** (`flex:1 1 380px; border-left:1px solid #21262d; padding-left:14px; gap:12px; overflow:hidden`): seven chips —
  Features, Issues, Ready now (`#7fb08a`), Waiting (`#6a8fb5`), Backlog (`#8b949e`), Ask Shane (`#a374ea`), Done (`#5f9a6c`).
  Chip = label (8px / 800 / tracking .09em / uppercase / `#576069`) over value (mono 13px / 800).
- **Chain pill** (`height:26px; padding:0 10px; radius 99px; font 10px/700`):
  - exact → `background:#0f1a14; border:1px solid #2e4a36; color:#7fb08a`, Lucide `check`, text `Chain exact · {gate} gate edges, not {cross}`.
  - gaps → `background:#1a1512; border:1px solid #5a3f2a; color:#e0a879`, Lucide `alert-triangle`, text `Chain has N gap(s)` + button
    **Re-wire §5.2** (18px tall, `background:#3a2a1c; border:1px solid #5a3f2a; color:#f0c9a6; 9px/800`).
- **Controls** (`margin-left:auto; gap:6px`): `Expand all`, `Collapse all`, zoom group (`−` · `100%` · `+` · `Fit`), `Reset` (icon `rotate-ccw`).
  Button: `height:24px; padding:0 9px; background:#0f1319; border:1px solid #21262d; radius 5; color:#c9d1d9; 10.5px/700`; hover `background:#161c25`.

### Canvas geometry (auto-layout, no manual node placement)

All positions are absolute inside a stage sized to content; zoom is a CSS `transform: scale(z)` on the stage
(`transform-origin: 0 0`) with the scroll container sized to `W·z × H·z`. Zoom range 0.35–1.6, step 0.1; **Fit** = `min(1, (viewportWidth − 16) / W)`.

Constants (px):

| name | value | meaning |
|---|---|---|
| padL | 20 | left padding |
| railY | 42 | y of the epic tree rail |
| top | 66 | y of all Feature headers and the Epic card |
| epicW / epicGap | 148 / 64 | Epic card width, gap to first column |
| colW | 204 | collapsed Feature column width |
| stackW | 212 | issue stack width (expanded) |
| sentGap / sentW | 40 / 160 | gap to, and width of, the sentinel card |
| headH | 94 | Feature header height |
| gutter | 88 | horizontal space between Feature columns |
| rowH / rowGap | 26 / 5 | issue row height and gap |
| sentH | 66 | sentinel card height |

Column x positions accumulate left → right in **priority order**: `x₀ = padL + epicW + epicGap`; each column is
`colW` wide when collapsed or `stackW + sentGap + sentW = 412` when expanded; `x += width + gutter`.
Expanded column: header at `(x, top)`; sibling issues (every issue except the sentinel, ascending by number) stacked
from `y₀ = top + headH + 18` at pitch 31; the sentinel card sits to the right at `x + stackW + sentGap`, vertically
centered on the stack. Stage `W = lastX + padL + 24`, `H = lowest node bottom + 48`.

**Epic tree connectors** (SVG, `stroke:#2a323d`, 1px): from the Epic card's right-middle, horizontal to
`padL + epicW + epicGap/2`, up to `railY`, across to the last column, with a vertical drop into each header at `header.x + 28`.

### Nodes

**Epic card** — `148×94` at `(padL, top)`. `background:#0d1117; border:1px solid #2e3742 (#21262d when something else is selected); radius 7; padding:9px 10px`.
Rows: [20px tile `layers` icon + `EPIC` eyebrow (`#6a8fb5`) + `#2198` mono right] / name 12.5px 800 `#e6edf3` /
meta 9.5px `#8b949e`: `"10 Features · 84 issues · 124 blocked_by edges"`. Click → clears selection.

**Feature header** — `204×94` (collapsed) or `412×94` (expanded). `background:#0d1117; border:1px solid #21262d`
(expanded `#2e3742`, selected `#6a8fb5` + `box-shadow:0 0 0 1px #6a8fb5`); `radius 7; padding:9px 10px`; `justify-content:space-between`. Draggable.
1. `P{n}` badge (mono 8.5px/800, `background:#1d3450; color:#9fc0dd; radius 4; padding:1px 5px`) · `FEATURE` eyebrow (`#576069`) · `#num` mono · chevron (`chevron-down` / `chevron-up`) right.
2. Name 12px / 800 / `#e6edf3`, ellipsis.
3. Stacked state bar (4px tall, `radius 99px; background:#0a0d12; border:1px solid #1b212a`) with flex-grow segments:
   ready `#7fb08a`, waiting `#4d7aa8`, done `#2f5a3a`, held `#3a4250`, ask `#8b7aa8`; then `"{n} issues"` mono 9px `#8b949e`.
4. `sentinel #{num}` mono 9px `#576069` · right-aligned state text 9px/700 (see *Feature state text*).

**Issue row** — `212×26; radius 5; padding:0 8px; gap:6px`. `background:#0f1319` (done `#0c1210`, selected `#131c27`).
Contents: 7px state dot · `#num` mono 9px `#576069` · title 10.5px/600 (ready/held/ask `#e6edf3`, waiting `#aab4bf`, done `#576069`), ellipsis · right tag mono 8.5px/800 uppercase in the state color.
Border by state: ready `#2e4a36`, waiting `#1b212a`, held `1px dashed #2e3742`, ask `#3a3050`, done `#1b212a`.
Selected: `1px solid #6a8fb5` + ring `0 0 0 1px #6a8fb5`. Blocker of the selection: `#e0a879` + ring `rgba(224,168,121,.35)`. Blocked by the selection: `#4d7aa8`.

**Sentinel card** — `160×66; radius 6; padding:7px 9px; gap:4px; background:#0e141c; border:1px solid #3d5875`
(same selected/blocker/dependent borders as rows). Rows: `target` icon + `SENTINEL` eyebrow (8px/800/tracking .12em/`#6a8fb5`) + `#num` /
title 10.5px/700 / `fan-in {done}/{total}` mono 9px `#8b949e` + state tag right.

**Gate pill** — centered in every gutter at header mid-height: `80×20; radius 99px; mono 8px/800 uppercase tracking .09em`.
Auto: `background:#0d1117; border:1px solid #21262d; color:#576069`, icon `zap`, label `auto`.
Manual: `background:#1a1512; border:1px solid #5a3f2a; color:#e0a879`, icon `pause`, label `manual gate`, plus a vertical
`1px dashed rgba(224,168,121,.4)` line down the whole gutter from `railY` to `H − 24`. Click toggles.

Node state → dot style:

| state | meaning | dot | tag |
|---|---|---|---|
| ready | Batter Up, 0 open blockers | `background:#7fb08a` | `ready` |
| blocked (waiting) | Batter Up, ≥1 open blocker | `1.5px solid #4d7aa8` ring | open-blocker count |
| held | Backlog | `1.5px dashed #6b7480` ring | `held` |
| ask | Ask Shane | `background:#8b7aa8` | `ask` |
| done | DONE bookend | `background:#2f5a3a; border:1px solid #7fb08a` | `done` |

Tag/state colors: ready `#7fb08a`, waiting `#6a8fb5`, held `#8b949e`, ask `#a374ea`, done `#5f9a6c`.

### Edges (SVG layer under the nodes)

Every `blocked_by` edge is drawn from the blocker's **out-port** (right-middle) to the blocked issue's **in-port**
(left-middle). If a Feature is collapsed, its header stands in for its issues: edges between the same two nodes are
**bundled** into one path with a `×N` label at the midpoint (mono 9px/700, `paint-order:stroke` with a 4px `#0a0d12`
halo). Fan-in edges inside a collapsed Feature are not drawn.

Path shape (tweakable, default **orthogonal**): `M a H mid V b.y H b` where `mid = (a.x + b.x)/2`.
Alternative *curved*: cubic Bézier with control offset `dx = clamp(|b.x − a.x|/2, 36, 110)`.
Arrowheads: 6×6 marker at the target end, filled in the edge color. Transitions: `stroke, stroke-opacity 150ms`.

| edge | stroke | width | opacity | dash |
|---|---|---|---|---|
| fan-in (`kind: fanin`) | `#4d7aa8` | 1.1 | .5 | — |
| cross-feature gate (`kind: gate`) | `#6a8fb5` | 1.1 | .6 | — |
| gate behind a **manual** gate | `#e0a879` | 1.1 | .7 | `4 3` |
| added by user (`kind: manual`) | `#a374ea` | 1.1 | .75 | — |
| blocker already DONE (any kind) | `#7fb08a` | 1.1 | .4 | — |

Selection emphasis (tweak `dimUnrelated`, default on):
- Issue selected: edges **into** it `#e0a879` / 1.8 / 1.0 (its blockers); edges **out of** it `#9fc0dd` / 1.6 / .95; everything else opacity .1.
- Feature selected: edges touching any of its issues keep their style; others opacity .1.
- Edge selected: `#e6edf3` / 2 / 1.0; others opacity .18.
- Hover: opacity 1, width ≥ 1.8. Hit area is an invisible 10px-wide twin path.

### Inspector (right panel) — four views

**Nothing selected**
- `HOW TO READ THIS` eyebrow (9px/800/tracking .13em/`#576069`) + paragraph (12px `#8b949e`, line-height 1.6):
  *"Left to right is priority order. Each Feature collapses to one card. Open it and its issues fan into a sentinel; that sentinel gates every issue in the next Feature. Select any node and the edges that hold it turn amber."*
- Node legend: five rows (8px dot · label 10.5px/700 `#c9d1d9` · description 10px `#576069`) using the state table above. Descriptions:
  Ready — *Batter Up with no open blockers. Launches on the next refresh.* / Waiting — *Batter Up, waiting on blocked_by edges to clear. The number is how many.* /
  Held (Backlog) — *Backlog. A human moves it, even after its edges clear.* / Ask Shane — *An open question with no build attached; outside the cascade.* / Done — *Verified DONE bookend on origin/main.*
- Edge legend (18px line swatches): Fan-in, Cross-feature gate, Manual gate, Added by you (copy in the prototype).
- Card **§5.2 in numbers** (`background:#0f1319; border:1px solid #1b212a; border-left:2px solid #4d7aa8; radius 7; padding:11px 12px`):
  `"{fanin} fan-in and {gate} gate edges chain {issues} issues across {features} Features. Wiring every next-Feature issue to every previous-Feature issue would take {cross} edges."`
- Bottom note (dashed `#2e3742` border): seed/persistence disclaimer.

**Feature selected**
- `P{n}` badge · `FEATURE` · `#num` right; name 16px/800/−.02em; `buildSet={Short} · {n} issues · {m} in cascade` mono 9.5px `#576069`.
- Five count tiles (ready / waits / held / ask / done): `background:#0f1319; border:1px solid #1b212a; radius 6; padding:6px 7px`; label 7.5px/800 uppercase; value mono 15px/800 in the state color (`#3f4756` when zero).
- Two fact lines with 11px icons (`lock`, `corner-up-right`): what gates this Feature (`Gated on #{prevSentinel}, the sentinel of {Prev}…` or `First in priority. Nothing gates it.`) and what it releases (`Its sentinel #{s} releases {Next} ({k} issues).` or `Last in priority. Releases nothing.`).
- **Sentinel** section: `<select>` (26px, `#0f1319`, border `#21262d`) listing the cascade issues, highest first; help text *"Highest-numbered issue by default. Changing it re-wires the fan-in and the downstream gate."*
- **Gate before this Feature** card (hidden for P1): title, explanatory line, and a 30×16 switch (off `#21262d`/knob `#8b949e`; on `#5a3f2a`/knob `#e0a879`, knob slides 150ms).
- Buttons: primary `Open issues` / `Collapse issues` (`background:#1d3450; border:1px solid #3d5875; color:#cfe0f0`), then 30px `arrow-left` / `arrow-right` (move earlier / later).
- **Issues** list: rows 4px 6px, hover `#0f1319`: 6px dot · `#num` · title · `target` icon if sentinel · state tag. Click selects the issue and opens its Feature.

**Issue selected**
- `ISSUE` · `{Feature} · P{n}` · `#num` right; title 15px/800; state line (8px dot + text in state color):
  `Waiting on N blocker(s)` / `Ready — launches on the next refresh` / `Held in Backlog` / `Ask Shane — outside the cascade` / `DONE bookend verified`.
- If sentinel: info card (`background:#0e141c; border:1px solid #3d5875; color:#9fc0dd`): *"Sentinel of {Feature}: N siblings fan in here. It is the last thing in the Feature to clear."*
- **BOARD STATUS**: four equal buttons `Batter Up | Backlog | Ask Shane | Done` (24px; active `#1d3450`/`#3d5875`/`#cfe0f0`, inactive `#0f1319`/`#21262d`/`#8b949e`).
- **BLOCKED BY** `{count}` + right-aligned `Add blocker…` button (20px, primary colors; while linking it reads `Cancel` in amber `#1a1512`/`#5a3f2a`/`#e0a879`).
  Rows (`#0f1319`, border `#1b212a`, radius 5): dot · `#num` · title (click → select) · kind tag (`fan-in` / `gate` / `added`) · `x` remove button (hover `#2a1a1a` / `#e8746f`).
  Empty: *"Nothing. Launches on the next refresh if it is in Batter Up."*
- **BLOCKS** `{count}`: same rows for outgoing edges. Empty: *"Nothing waits on this issue."*
- `Make this the sentinel` button (hidden if already sentinel or status is Ask Shane).
- **DISPATCH**: the live BUILD comment in a mono code block (`#0a0d12`, 9.5px, line-height 1.55):
  line 1 `BUILD: model={model} effort={effort} buildSet={Short}` (`#c9d1d9`), line 2 `--model {model} --effort {effort} --title {num} --blocked-by {a,b,c}` (`#8b949e`; `--blocked-by` derived from the current edges, omitted when none).
  Ask Shane → no block, note *"No BUILD comment. An Ask Shane item carries a question, not a dispatch."* Backlog → note *"Dispatched but held. Backlog waits for a human to move it to Batter Up."*

**Edge (or bundle) selected**
- `BLOCKED_BY EDGE` · kind label right (`fan-in`, `cross-feature gate`, `manual gate`, `added by you`, joined with ` + ` for mixed bundles).
- Headline `#{to} blocked_by #{from}` or `{N} issues in {Feature} blocked_by #{from}`; description explains the hold (or *"Cleared. #{from} has a DONE bookend…"*).
- Blocker card (click → select the blocker): dot · `BLOCKER · {Feature}` · `#num title` · state tag.
- **HOLDS** `{N}` rows with per-row `x`; destructive button `Remove edge` / `Remove all N edges`
  (`background:#1d1211; border:1px solid #4a2320; color:#e8746f`); note that removing a §5.2 edge opens a gap and Re-wire restores it.

### Feature state text (header, right of `sentinel #`)

Priority order, first match wins: all done → `complete` (`#5f9a6c`); any ready → `{n} ready now` (`#7fb08a`);
any waiting → `{n} waiting on #{prevSentinel}` (`#6a8fb5`); any held → `{n} held` + ` · manual gate` if gated (`#8b949e`);
only ask → `{n} ask Shane` (`#a374ea`). Append ` · {k} ask` when the Feature also has Ask Shane items.

---

## Interactions & behavior

| action | result |
|---|---|
| Click Feature header | Toggle expand/collapse **and** select the Feature. (Collapse-until-selected: a Feature is one node until opened.) |
| Click issue / sentinel | Select it. Its blockers' edges turn amber; nodes it blocks get a blue border. |
| Click an edge or bundle | Select it (white, 2px). `Delete`/`Backspace` removes it. |
| Click empty canvas / Epic card | Clear selection, cancel linking. `Esc` does the same (first cancels linking, then deselects). |
| Drag a Feature header onto another | Reorder priority: dragged Feature takes the drop target's index (header at 45% opacity while dragging). Then **all `gate` edges are regenerated** for the new order (§5.2 step 3); `fanin` and user-added `manual` edges are kept. |
| Inspector ← / → | Same reorder by one step. |
| Gate pill click, or inspector switch | Toggle manual gate before that Feature. **On:** every Batter Up issue in it → Backlog (§5.3). **Off:** every Backlog issue → Batter Up. `blocked_by` edges are untouched (the technical floor stays). |
| Sentinel `<select>` / `Make this the sentinel` | Set the Feature's sentinel. Remove that Feature's `fanin` edges, wire every other cascade issue → new sentinel, then regenerate all `gate` edges. Ask Shane items cannot be sentinels. |
| Board status buttons | Set `status`. Moving **to** Ask Shane drops the issue's fan-in and gate edges (it leaves the cascade); moving **from** Ask Shane wires them back. Marking the sentinel Done releases the next Feature (derived, no edges change). |
| `Add blocker…` | Enter link mode (status-strip hint turns amber, cursor `crosshair`; the selected node shows `not-allowed`). Clicking any other issue adds `{from: clicked, to: selected, kind:'manual'}`; duplicates are ignored. |
| Remove (`x`, `Remove edge`, `Remove all`) | Delete edge(s). The chain pill reports the resulting gaps. |
| `Re-wire §5.2` | Regenerate all `fanin` + `gate` edges from the current order, sentinels and statuses; keep `manual` edges. |
| `Expand all` / `Collapse all`, zoom −/+/Fit | View only. |
| `Reset` | Discard saved edits, reload the seed. |
| Hover edge | Opacity 1, width 1.8, `cursor:pointer`. |

Status-strip hint: default *"Click a Feature to open its issues · drag a header to change priority · click an issue to see what holds it · click an edge to inspect or remove it"*;
link mode *"Pick a blocker for #{n}: click any issue node. Esc cancels."* (amber, `crosshair` icon); after an action, a one-line confirmation
(e.g. *"Priority changed. Cross-feature gates re-wired per §5.2; your added edges were kept."*).

Animation is limited to 150ms color/opacity transitions on edges and the gate switch knob. No motion otherwise.

## Chain rules (from BUILD_QUEUE_METHOD.md §5) — implement exactly

- **Cascade** of a Feature = its issues whose status ≠ Ask Shane (§10: Ask Shane items sit *"separate from the cascade"*).
- **Sentinel** = the highest-numbered cascade issue by default (§5.2 step 1); user-changeable within the cascade.
- **Fan-in** (§5.2 step 2): for every cascade issue `i ≠ sentinel`, edge `sentinel blocked_by i` (`kind: fanin`).
- **Cross-feature gate** (§5.2 step 3): for consecutive Features A → B in priority order, every cascade issue `j` of B gets `j blocked_by A.sentinel` (`kind: gate`).
- **Manual gate** (§5.3): same edges, plus B's issues are held in Backlog instead of Batter Up.
- **Derived state** per issue: `done` if status Done; `ask` if Ask Shane; `held` if Backlog; else `blocked` when any blocker is not Done, otherwise `ready`.
- **Chain integrity**: gaps = missing fan-in edges + missing gate edges under the rules above. `cross` = Σ over transitions of `|cascade(A)| × |cascade(B)|` (the O(n·m) alternative the method avoids).

## State & data model

```ts
type Status = 'batter' | 'backlog' | 'ask' | 'done';          // Batter Up, Backlog, Ask Shane, Done (§6)
type EdgeKind = 'fanin' | 'gate' | 'manual';                 // manual = added by the user
interface Issue   { num: number; title: string; status: Status; model: string; effort: string }
interface Feature { id: string; num: number; name: string; short: string /* buildSet */; issues: Issue[]; sentinel: number | null }
interface Edge    { from: number /* blocker */; to: number /* blocked */; kind: EdgeKind }
interface ChainDoc {
  epic: { num: number; name: string };
  features: Feature[];
  order: string[];                 // Feature ids in priority order
  edges: Edge[];                   // `to` blocked_by `from`
  gates: Record<string, boolean>;  // downstream Feature id → manual gate before it
}
// UI state: expanded: Record<featureId, boolean>; selection: none | feature(id) | issue(num) | edge(pairs[]); linkMode; zoom (0.35–1.6)
```

The prototype seeds §10's worked example: Epic #2198 ShaneBuilder; priority order Test Pad (28) → Build Matrix (7) →
Shot Vault (7) → I have a thought (5) → Favorites (7) → Focus Mode (10) → App Shell & Chrome (8) → Command Palette (3) →
WebTester UI (2 dispatched + 3 Ask Shane) → **manual gate** → Build Queue (4, Backlog). 77 issues in Batter Up,
71 fan-in + 53 gate edges (vs. a 503-edge cross-product). Feature and issue numbers/titles in the file are placeholders.

Production data source: GitHub via native sub-issues (Epic → Feature → Issue) and `blocked_by` relationships, board
status from the project board, DONE from the verified bookend (§7). Persist edits back as real `blocked_by` edges,
sub-issue sentinel choice, and board-column moves; the prototype only persists to `localStorage` (`build-chain-map.v1`).

## Tweakable props (prototype "Tweaks"; expose as settings or leave as constants)

- `edgeStyle`: `'orthogonal'` (default) | `'curved'`
- `dimUnrelated`: `true` — fade edges unrelated to the selection
- `showFanIn`: `true` — draw fan-in edges inside expanded Features

## Design tokens

Canvas `#0a0d12` · panel `#0d1117` · card `#0f1319` · sentinel card `#0e141c` · selected fill `#131c27` · done fill `#0c1210` ·
borders `#1b212a`, `#21262d`, `#2e3742` · text `#e6edf3` / `#c9d1d9` / `#aab4bf` / `#8b949e` / `#576069` / `#3f4756` ·
blue `#1d3450` (fill), `#3d5875` (border), `#4d7aa8`, `#6a8fb5`, `#9fc0dd`, `#cfe0f0` · green `#7fb08a`, `#5f9a6c`, `#2f5a3a`, `#2e4a36`, `#0f1a14` ·
amber `#e0a879`, `#f0c9a6`, `#5a3f2a`, `#3a2a1c`, `#1a1512` · violet `#a374ea`, `#8b7aa8`, `#3a3050` · red `#e8746f`, `#4a2320`, `#1d1211`, `#2a1a1a`.
No saturated/neon color anywhere — the whole palette is muted.

Type: **Inter** (400–800) for UI; **Consolas / ui-monospace / Menlo** for every number, `#id`, tag and BUILD line.
Sizes in use: 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 12.5, 13, 13.5, 15, 16 px. Eyebrows 800 weight, uppercase, tracking .09–.13em. Headlines −.01/−.02em.

Radii: 4 (badges, small buttons), 5 (rows, buttons), 6 (cards), 7 (headers, panels), 99 (pills, dots, bars). Shadows: only the selection ring `0 0 0 1px`.
Spacing: 4px base; header padding 9/10, inspector 14/15, row padding 0/8, gaps 3–14.

## Assets

Icons: Lucide, 2px stroke — `git-fork, layers, target, lock, corner-up-right, chevron-down, chevron-up, zap, pause, check, alert-triangle,
minus, plus, rotate-ccw, arrow-left, arrow-right, x, trash-2, crosshair, info, help-circle`. No images.

## Files

- `Build Chain Map.dc.html` — full prototype. Template (markup, inline styles) at the top; `class Component` at the bottom holds the seed
  (`SPEC`), the chain rules (`rechainFanin`, `rechainGates`, `rechainAll`), derived state (`derive`), layout (`layout`, `outPort`, `inPort`),
  edge rendering (`buildEdgeLayer`, `edgeLook`) and every handler named in the table above.

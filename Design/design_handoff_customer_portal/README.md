# Handoff: Customer Portal — Round One Build + Round Two Updates

## Overview

The authenticated customer portal for Shane McCaw MSP: the place a customer lands after the Copilot Readiness Assessment and lives from then on. It is not a results page. It is an operational console over their Microsoft 365 tenant — six pillar dashboards, drill-down finding pages with Graph API provenance, a remediation playbook system that gates every change behind a change request, procedure runbooks with time-based hold windows, a purchasable document library, and a global command palette that falls through to ShaneBot when the portal has no answer.

The shell is `Customer Portal Shell.dc.html`. Navigation is a single `active` state key — there is no router in the prototype. Most pages are sections inside that one file, but **three modules are now separate design files imported by the shell**: `Ownership.dc.html`, `Change Control.dc.html`, and `Microsoft Changes.dc.html`. Treat them as the same product — the shell mounts them with data and callbacks passed as props — not as standalone pages.

**Scope of this build: the Customer Portal Shell and its components only** (the four files above). `Copilot Readiness Reveal.dc.html` is included purely as background context — the pre-portal journey the customer arrives from — it is already built and is not part of this implementation task.

## Round Two updates (this pass)

If you've already started implementing from Round One, these are the concrete changes to reconcile — a diff pass, not a rebuild:

- **Change control policy moved into global Settings.** It used to live only inside the Change Control module (its own "Policy & settings" nav item, and a badge/link that jumped there). That nav item is removed from Change Control's own left nav. The policy UI (master on/off, gated actions, notification rules, approvers, log) now renders inline as a section of the shell's Settings page, alongside Ownership routing and Departments — selecting it in Settings no longer navigates away from Settings. Entry points elsewhere (the header change-control badge, alerts, etc.) still deep-link into the Change Control module's own equivalent view; only Settings' own nav behaves consistently with its siblings now.
- **People & roles moved from Ownership into Settings.** Ownership no longer has its own "People & roles" button/slide-over. The people list (name, role, side, kind, away/deputy) is now owned by the shell (`state.ownPeople`) and passed into `Ownership.dc.html` as a `people` prop plus an `onPeopleChange` callback; Ownership falls back to its own local state when used standalone (so the file still opens and works on its own). Edit it from Settings → People & roles; the Ownership matrix reads the same data live.
- **Settings nav trimmed.** Removed the two placeholder entries that had no content behind them ("Scans and alerting", "Tenant and billing"). Settings now only lists sections that are actually built: Ownership routing, Change control policy, People & roles, Departments.
- **Ownership matrix status pills → boxes, one row.** The five counters above the matrix (ownership gaps / duty conflicts / carrying too much / not in the matrix / objects owned here) changed from pill-shaped inline buttons to box-shaped cards in a fixed 5-column grid (`repeat(5, 1fr)`) so they never wrap to a second row; labels wrap to two lines instead of truncating.
- **Sub-nav active-state accent changed** from a left vertical bar to a leading `↳` glyph on the active sub-item, across Change Control, Ownership, SOPs and Microsoft Changes sub-navigation.
- **Horizontal scroll removed from several data displays** that were forcing `overflow-x:auto` at narrower viewport widths: the Projects Gantt chart and the 5-lane task board (board now wraps lanes with `auto-fit` instead of scrolling), and the Change Control CR/Microsoft-changes Gantt rows. These were all already built on fluid grid columns (`minmax(0,1fr)`); the fix was removing an unnecessary fixed `min-width` floor and its scroll wrapper. Some dense tables (the CR register, the notification-rules table) still assume a reasonably wide desktop viewport — flag if the target breakpoint needs them redesigned as cards instead.
- **Bug fix:** Active Runbooks' step checklist was rendering blank labels — the row data used `text`/`textCss` but the template read `label`/`labelCss`. Fixed to read the correct field; no data shape change needed on your end, just confirms the field names (`text`, `checked`, `toggle`, `boxCss`, `checkIconHtml`, `textCss`) if you're modeling this list server-side.

## Round Three updates (this pass)

- **Left nav regrouped.** The old "Standards & risk" catch-all (7 mixed items) is split into two groups: **Governance** — Ownership, Risk Register, Security Plan, PII Governance — and **Reference** — SOPs & Runbooks, Microsoft Changes. Order is now Operate / Governance / Reference / Library.
- **Overview pillar-card row fixed.** The six pillar cards on the tenant health overview sit in a `repeat(6, minmax(0,1fr))` grid; a stray `margin-right:56px` on that grid was shrinking the row and leaving blank space to the right of the Health card. Removed — the six cards now fill the row evenly.

## Round Four updates (this pass)

Two modules changed. Nothing else in the portal was touched.

### Remediation Tracker (`remediation`)

Rebuilt from a phase/task checklist into a working tracker for the whole tenant.

- **Seven phases**, in dependency order: Discovery (target 12 Aug, Complete) → Stabilization (26 Aug, On Track) → Baseline (9 Sep, At Risk) → Hardening (30 Sep, On Track) → Copilot Readiness (21 Oct, Blocked) → Drift Cleanup (4 Nov, On Track) → Identity Hygiene (18 Nov, On Track). ~30 tasks across them.
- **Phases now live in the left nav, not in the page body.** Remediation Tracker gets sub-nav items in the same pattern as Microsoft Changes' waves: each phase shows `done/total`, its target date, a two-segment progress bar coloured by phase status (Complete `#34d399` · On Track `#60a5fa` · At Risk `#fbbf24` · Blocked `#f87171`), and a line reading `N tasks open · <status>`. Clicking a phase filters the tracker to that phase; clicking the active one clears the filter. Sub-nav is only rendered when the module is active and the sidebar is expanded. The phase-card grid that used to sit above the task list is **removed** — phases are a navigation concern now, not page content.
- **Eight operational task states**, each with its own colour and filter chip: Completed, Waiting for Evidence, In Change Control, On Hold, Blocked by Dependency, Waiting on You, Not Started, Skipped. Phase filter and state filter compose; the header states "Showing N of M tasks" with a clear action.
- **CR gate stepper** on any task that changes the tenant: prepare → SIA/CIA → rollback plan → submit → approve → execute → evidence. A task cannot be ticked before its CR reaches evidence.
- **Hold windows** on tasks that wait on elapsed time, with release, extend and close-early actions — same contract as Active Runbooks (notify at T-24, at T-0, and when a scan clears the verdict early).
- **Evidence states** (`pending` → `filed` → `approved`); filing an evidence artefact creates the document in the Document Library.
- **Severity-weighted points that only score on verification.** Ticking a task moves it to "pending"; the points land against the pillar and tenant score only once a re-scan confirms the fix. Live pillar scores show base / confirmed / pending / forfeited as one stacked bar.
- **Drift and re-remediation.** Completed tasks stay monitored; a reversed setting spawns a re-remediation task that names the original.
- **Message Center posts map to CRs.** A post that forces a tenant change links to the task already in the plan, or raises a CR against the right phase.
- **Inline SOP runbooks** execute their Graph steps in place inside the task row.
- **Re-opening a signed-off task requires a recorded reason** — captured through the standard right-drawer form, written to the audit trail.

### Microsoft Changes (`ms-changes`)

- **Header reduced** to two controls: `Export briefing` and a single Settings panel (digest cadence, services in scope, tenant scan).
- **Six duplicate stat cards removed** — the same counts already read from the wave sub-nav.
- **Wave tiles drop down their evidence** in place rather than linking out.
- **Roadmap chart column alignment fixed.**
- Wave selection lives in the left nav (five waves, each with a stacked breaks/decide/verify/informational bar, a total, its landing range, and a one-line "what this means" note) — this is the pattern the Remediation Tracker phases now follow.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behaviour, not production code to copy. The task is to **recreate these designs in the target codebase's existing environment** (React + Vite + Tailwind v4 + shadcn/ui "new-york" + `lucide-react`, per the Shane McCaw MSP platform) using its established patterns, components and tokens.

The `.dc.html` file uses a small in-house streaming-template runtime (`support.js`) — **ignore that runtime entirely; do not port it.** What matters is:

1. The markup structure and the inline style values (they are the spec — there is no stylesheet).
2. The logic class at the bottom of the file. It holds the state machine, the data shapes, and every derived value. **Read the logic class; it is the specification.** Its `renderVals()` returns a flat bag of values the template consumes; in React those become component props and local state.

Open `Customer Portal Shell.dc.html` directly in a browser (with `support.js` and `_ds/` alongside, as bundled) to interact with the design.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, motion and copy. Recreate accurately using the codebase's existing component library. All copy is final and written in Shane's voice — direct, outcome-first, no emoji, no "Learn more" CTAs. **Do not rewrite the copy.**

The prototype uses one fictional tenant throughout — **Halden Materials, 1,240 seats, scanned 3 August 2026, Copilot gate 41 of 82**. Treat every number on screen as bound to live tenant data.

---

## Shell

| Element | Spec |
|---|---|
| Canvas | `#020617` page, `#0b1524` panels, `#0b1a2e` inputs |
| Sidebar | 256px expanded / 76px collapsed, toggled by a `panel-left` button; nav scrolls, chrome does not |
| Header | Sticky. Logo, global search trigger (max-width 280px), alerts bell, account chip |
| Alerts tray | 400px, `top:42px`, `max-height:70vh`, z-index 80 |
| Right drawers | `min(560px,94vw)` for forms, `min(340px,92vw)` for the document filter. Overlay z-124, panel z-125 |
| Command palette | `min(680px,94vw)`, `top:11vh`, centred, overlay z-200 / panel z-201 |
| Content max width | 1000–1320px depending on page; the document library and pillar pages run full width |

### Navigation (information architecture)

The sidebar is the IA. Groups, in order:

1. **Overview** (single item)
2. **My Architect**, **Projects** (ungrouped, above Pillars)
3. **Pillars** — Governance, Security, Compliance, Licensing, Adoption, Health. Each renders a coloured icon tile; the active pillar shows a sub-item for the current drill-down page.
4. **Copilot** — carries the gate score `41 / 82` as a live pill.
5. **Operate** — Change Control, Active Runbooks, Remediation Tracker, Policy Decisions
6. **Governance** — Ownership, Risk Register, Security Plan, PII Governance
7. **Reference** — SOPs & Runbooks, Microsoft Changes
8. **Library** — Documents

Group labels are 9.5px/700/`.12em` uppercase `#475569` with a hairline rule running to the panel edge. Collapsed mode replaces each label with a 1px divider and shows a 6px dot on any item carrying a badge.

**Badges are rare on purpose.** Only Active Runbooks carries one (`1 due`), driven by the count of hold windows at T-0. It is the single place in the nav that says "a decision is waiting".

### Page inventory

| Key | Page | Notes |
|---|---|---|
| `overview` | Tenant health overview | Score, six pillar cards, Most Urgent ranking |
| `governance` … `health` | Six pillar dashboards | Score ring, trend sparkline, finding rows, area link cards |
| `governance-*`, `security-*`, `compliance-*` | Pillar drill-downs | Detail pages per finding area (see below) |
| `copilot` | Copilot readiness | Gate 41/82, six pillars with now → target |
| `documents` | Document library | Faceted, expand-in-place, purchasable — see below |
| `projects` | Projects | Gantt, contracted scope, deliverables, phase schedule, status feed |
| `retainer` | My Architect | Retainer hours, documents, ask box |
| `change-control` | Change Control | CR list, 4-step CR wizard, JSON pre/post diff, approve / rollback |
| `operate-runbooks` | Active Runbooks | Progress, steps, **hold windows** — see below |
| `sop-hub` | SOPs & Runbooks | Procedure library, categories, SOP authoring wizard |
| `sop-*` | SOP categories | Incident Response, Security Drift, Mail Flow, Device Management |
| `remediation` | Remediation Tracker | 7 phases (in the left nav), ~30 tasks, 8 states, CR gate, holds, evidence, verified scoring |
| `risk-register` | Risk Register | Accepted risks, owner, review date, expiry |
| `ms-changes` | Microsoft Changes | Message centre posts with tenant impact |
| `alert-preferences`, `webhooks`, `billing`, `receipt`, `account-security` | Settings | Reached from the account menu |

**Drill-down page template** (used by every pillar detail page): purpose paragraph → Graph API provenance block (which endpoint, what was read, when) → stat cards with sparkle icons → expandable evidence table → tenant-policy block → wrench fixes tied to named playbooks. Follow the Overshared SharePoint page (`governance-oversharing-full`) as the reference implementation.

---

## The five systems

Everything in the portal is one of these five patterns. Build them once.

### 1. The change request gate

**Nothing changes in the tenant without a CR.** Every fix, every accepted risk, every executed SOP, every early-closed hold window routes through the fix panel → CR step → submit. The panel states what changes, what does not, the risk of doing it, the risk of not doing it, the exact Graph/PowerShell call, the manual steps, and the evidence filed afterwards. A snapshot is taken before execution; rollback is offered afterwards.

State: `fixPanelOpen`, `fixPanelStep` (`choose` | `cr`), `fixPanelKey`, `fixAgreeChecked`, `fixCrIntent`, `fixCrSubmitted`, `fixCrConfirm`, `fixCrWindow`.

Playbook data lives in `GOV_FIXES` / `CMP_FIXES` (and the per-pillar equivalents), keyed by `fixKey`, each with `{ title, desc, risk, reward, manual[], graph[], result }`.

### 2. ShaneBot — selection-based, not always-on

Not a floating widget. Highlight any text on any page and a single chip appears **at the selection**; `⌘K` with a selection sends it to ShaneBot with tenant context attached; `Escape` dismisses. Nothing follows the pointer.

Entry points: the selection chip, "Ask ShaneBot about this" buttons on documents / findings / holds / CRs, and the last row of the command palette. Replies carry an Active Card (`finding` | `fix` | `datum` | `ticket` | `escalate`) — the card is the actionable part; escalation opens a Zoho Desk ticket with the conversation and tenant context attached.

### 3. Hold windows (runbook timers)

Some procedures wait on elapsed time, not on work — "enable CA01 in report-only, wait 7 days, then decide". A hold window is a step that gates the steps after it, and the tenant is scanned while it runs.

Four states, each with its own tone and decision set:

| State | Trigger | Tone | Decision offered |
|---|---|---|---|
| `running` | > 24h left | `#64748b` | Prepare the CR now · Extend |
| `closing` | ≤ 24h left | `#fbbf24` | Prepare the CR now · Extend |
| `due` | T-0 or past | `#60a5fa` | Release the gated step · Exclude what the scan flagged · Extend |
| `early` | scan verdict clear before the window ends | `#22d3ee` | **Close the window N days early** · Let it run |

The scan verdict is the interesting part and is what the customer asked for: `clear` (nothing would break — offer to close early), `signals` (enforcing today breaks something named — do not release), `watch` (something worth a look before close). The card states the verdict in words, the evidence line, and the scan cadence.

Reported in three places, all from one data source: the Hold windows panel on Active Runbooks (day-tick track + T-minus readout), a hold band inside each runbook card, and a Hold windows section in the alerts tray that lists only windows needing a decision. Runbook status becomes `Holding` / `Decision due` / `Clear to close early`.

Data: `HOLD_DEFS` — `{ id, runbook, title, gates, startedAt (ISO), waitDays, scanVerdict, scanLine, scanAt, why }`. Derived: `hoursLeft`, `hoursDone`, day ticks, state, tone, badge, T-minus label. `HOLD_NOW` is a fixed clock in the prototype — **use the real clock in production, and re-derive state on an interval so T-24 fires without a reload.**

**Alerting contract:** a window must notify at **T-24** and at **T-0**, and again the moment a scan turns the verdict to `clear` before the window ends. The third is not a reminder — it is a finding ("you don't need to wait the remaining 9 days").

### 4. The document library

Designed to scale to 80+ purchasable documents; 33 are written out and 9 are owned. Rows are dense and sortable; a row expands **in place** into the full document rather than navigating.

- **Row**: caret · generated cover spine (26×36, accent gradient + document number) · title · meta line (`type · pillar · for audience · offering`) · state (`Current` / `Regenerate` / `Signed` / price) · `Add` for unowned. Title column floors at 180px; the state column shrinks with an ellipsis.
- **Expanded, owned**: a 200×272 generated cover (accent field, number, title, pillar chip, issue date) beside headline → standfirst → fact cards → sections with bullet points → "where this document lives in the portal" links → an amber **Out of date** band when telemetry has moved → Regenerate / Share & export / Ask ShaneBot.
- **Expanded, unowned**: what it contains, "built from your tenant, not a template" provenance, price block, Add to your library, "Does this apply to us?" → ShaneBot.
- **Filters live in a right slide-out** so the page reads full width. The sticky bar keeps a `Filters · n` button and removable chips for every active facet.
- **Facets**: availability, pillar, document type, written-for audience, offering. Counts are computed excluding the facet's own group so the numbers behave like a real faceted search.
- **Cart**: selecting unowned documents shows a strip with the count and total; `Add to your library` opens the purchase form (PO reference, billing, notify).

**Documents are generated, not filed.** Each owned document has a freshness state and regenerates from current telemetry; each unowned one states the telemetry it will be built from. Types in scope: assessment reports, remediation plans, configuration guides with tenant-specific step-by-step instructions (e.g. Conditional Access baseline), policies, SOPs and runbooks, and statements of work.

### 5. The command palette (⌘K)

The header search field is a trigger, not an input. `⌘K` with no selection opens the palette; with a selection it asks ShaneBot about the selection instead.

Indexed: every page and pillar, all documents (owned and library), finding areas across the pillars, remediation playbooks (opening a result opens the fix panel directly), compliance and licensing findings, hold windows, and change requests by code. The footer states the indexed count.

Ranking: exact label match → label prefix → label contains → sub/kind contains. Results are capped at 14, each showing a coloured type label. `↑↓` moves, `↵` opens, `esc` closes, hover moves selection. With no query the palette shows "needs a decision, and where you were".

**The last row is always `Ask ShaneBot: "<query>"`** — a search that finds nothing becomes a question, never a dead end.

---

## Interactions & behaviour

- **Forms live in the right drawer, never inline.** One `openForm({ kicker, title, intro, submitLabel, fields[], doneNote })` primitive drives every form in the portal — field kinds `text` / `select` / `textarea`, `wide` for full-row, `required` defaulting true. On submit the drawer switches to a done state showing `doneNote`.
- **Expand in place, don't navigate.** Pillar card pages, document rows and CR rows all expand with a caret (`›` → `⌄`).
- **No dead ends.** Every button opens a form, gates a CR, or escalates to ShaneBot.
- **Motion**: 150–300ms `transition-colors` / `transition-all`. Chevrons rotate. No bounce, no parallax, no scale-on-press — depth is colour, not scale.
- **Hover**: low-opacity overlay (~3%) or a one-step-lighter background; border colour intensifies to the accent. Focus is a 1–2px Electric Blue ring.

## State

Prototype state is one flat object on the component. In a real build most of it is server state; these are the client-only keys worth keeping:

`active` (current page key) · `expanded` (sidebar) · `alertsOpen` · `accountMenuOpen` · `paletteOpen` / `paletteQ` / `paletteSel` · `docOpenKey` / `docQuery` / `docFacets` / `docSort` / `docCart` / `docFilterOpen` · `fixPanel*` (see CR gate) · `sbOpen` / `sbInput` (ShaneBot) · `askLabel` / `askX` / `askY` (selection chip) · `runbookCustomSteps` / `runbookNewStepText` / per-SOP `*Checked` arrays · `ccExpanded` / `ccDraft` · `govFilter` / `govExpanded` / pager and search keys per drill-down.

## Design tokens

**Brand**: Deep Navy `#0A2540` · Electric Blue `#0078D4` (hover `#005A9E`) · Bright Teal `#00B4D8` · Off-White `#F7F9FC`.

**Portal surfaces (dark)**: canvas `#020617` · panel `#0b1524` · raised `rgba(15,23,42,.35–.6)` · input `#0b1a2e` · border `rgba(30,41,59,.8–.95)` · hairline `rgba(148,163,184,.09–.16)`.

**Text**: `#f8fafc` (headline) · `#f1f5f9` · `#e2e8f0` · `#cbd5e1` (body) · `#94a3b8` (secondary) · `#64748b` (tertiary) · `#475569` (labels).

**Pillars**: Governance `#3B82F6` / `#60a5fa` · Security `#8B5CF6` / `#a78bfa` · Compliance `#F3F4F6` / `#cbd5e1` · Licensing `#14B8A6` / `#2dd4bf` · Adoption `#F97316` / `#fb923c` · Health `#22C55E` / `#4ade80` · Cross-pillar `#22d3ee`. (Darker value for tiles and accents, lighter for text and icons.)

**Semantic**: red `#f87171` · amber `#fbbf24` / `#c2a63d` · green `#34d399` / `#4ade80` · info `#60a5fa` / `#93c5fd` / `#bfdbfe` · teal `#22d3ee`.

**Tint convention**: fills at `12–22%` alpha (`+'14'`, `+'1f'`, `+'22'` on the hex), borders at `35–55%`, accent bars at `cc`.

**Typography**: Inter 400–800 exclusively. 26px/800 page headline · 21px/800 document headline · 18–20px/800 page title · 13–14px/700 card title · 12.5–13.5px/400–500 body at 1.55–1.7 · 11–11.5px secondary · 9–9.5px/700 `.12–.2em` uppercase labels. Headline letter-spacing `-.02em`. `'SF Mono', Menlo, Consolas, monospace` for every number, score, code, timer and date.

**Radius**: 5–7px controls and chips · 9–12px cards and panels · 14px palette · 3px cover spines.

**Spacing**: 4px base. Row padding 11px × 20–26px · card padding 14–18px · page padding 26–28px · panel gaps 10–14px.

**Shadows**: navy-tinted only — `0 18px 44px rgba(2,6,23,.55)` (tray), `-24px 0 60px rgba(2,6,23,.6)` (drawer), `0 30px 70px rgba(2,6,23,.7)` (palette).

## Assets

No bitmaps. All graphics are inline SVG (stroke icons, score rings, sparklines, Gantt bars, radar) or CSS gradients. Icons in the prototype are hand-rolled Lucide paths in an `iconSvg(name, color, size)` helper — **use `lucide-react` instead**; names map 1:1 (`shield-check`, `git-commit`, `play-circle`, `clipboard-list`, `shield-off`, `bell`, `file-text`, `check-circle`, `wrench`, `search`, `panel-left`, `users`, `activity`, `alert-triangle`, `scale`, `credit-card`, `webhook`, `key`, `mail`, `smartphone`, `life-buoy`, `layers`, `lock`, `eye`). The "SM" brand mark is a `blue → teal` gradient tile with the wordmark in Inter — use the codebase's existing `Logo` component. **No emoji anywhere.**

## Out of scope / flagged for round one

- **Routing.** The prototype has none; every page is a key in one `active` state. Round one needs real routes and deep links (a CR, a document, a hold window must all be linkable).
- **Hold-window clock.** Fixed `HOLD_NOW` in the prototype. Needs the real clock, an interval re-derive, and the T-24 / T-0 / early-clear notifications wired to the existing alert channels.
- **Palette index.** Built client-side from in-memory arrays. At real scale this is a server-side search endpoint; keep the ranking rules and the ShaneBot fall-through.
- **Document generation.** Regenerate and purchase both open forms that stop at a confirmation. The generation pipeline, the "previous issue kept alongside" versioning, and the freshness comparison are backend work.
- **80+ document catalogue.** 33 documents are written out; the remaining ~51 need titles, blurbs, "what it contains" and provenance lines before the library is real. The footer copy in the design says so explicitly.
- **Licensing, Adoption and Health card pages.** The six pillar dashboards are complete; drill-down pages exist for Governance, Security and Compliance. The remaining pillars' card pages follow the same template and are not yet built.
- **Mobile.** Desktop only. No responsive work has been done below ~1000px; the document rows were the only place tested at narrow width.
- **ShaneBot grounding.** UI, selection chip, Active Cards and context passing are designed. Grounding replies on documents, findings and SOWs needs its own architecture proposal.
- **Billing backend.** Reuses the live Stripe integration.

## Files

| File | Contents |
|---|---|
| `Customer Portal Shell.dc.html` | The shell — nav, most pages, all five systems, logic class |
| `Ownership.dc.html` | Ownership matrix module, imported by the shell (`people` / `onPeopleChange` props wire it to Settings) |
| `Change Control.dc.html` | Change Control module, imported by the shell (`view` / `onView` props drive its sub-pages) |
| `Microsoft Changes.dc.html` | Microsoft Changes module, imported by the shell |
| `Copilot Readiness Reveal.dc.html` | Reference only — the pre-portal journey the customer arrives from. Already built; not in scope for this task. |
| `_ds/` | The bound Shane McCaw MSP design system (tokens + components) |
| `support.js` | Prototype runtime only — ignore, do not port |

If you're re-syncing an in-progress build: the Round Two changelog above is the fast path — read that first, then diff only the sections it names rather than re-reading every file end to end.

A separate bundle, `design_handoff_copilot_readiness/`, covers the pre-portal journey (Reveal → Document Viewer → SOW → Checkout) in the same format.

# Handoff: Shane McCaw MSP Console

## Overview

The MSP Console is the operator-side surface of the Shane McCaw M365 governance platform. It is the screen a managed-service-provider technician lives in: one tree of every managed tenant on the left, and, for whichever node is selected, the full working surface for that tenant — signals, change control, governance, access, commercial and audit.

It is deliberately not the customer portal. The customer portal shows a tenant its own posture. This console shows an operator *many* tenants at once, and gives them the write actions the customer cannot perform on themselves: granting and revoking consent, running scans, issuing break-glass credentials, resetting MFA, recording customer signatures on risk-acceptance decisions, and deleting a tenant outright.

The design covers 50 screens across two trees, plus the shell they all mount in:

- **Console Shell** — the chrome itself: header, tenant tree, breadcrumb, screen slot, status bar, command palette, and its five states.
- **Managed Tenants** — a directory, then per tenant 22 pages grouped into Overview, Monitoring, Change Control, Governance, Access & identity, Commercial, and Audit log, plus Ownership.
- **Operations (MSP-wide)** — 9 cross-tenant pages: MSP settings, Executive view, Activity timeline, Configuration State, Sales, Scope & SLA, SOPs, Documents, SharePoint connectors.
- **Contract-pack screens** — 13 further surfaces built one-to-one from the UI contract packs in `docs/msp-console/` (screens 38–50). Each was written from a pack that had been extracted from the real route code, so each states on itself what its routes can and cannot do. **Twelve of the thirteen are mounted in the console navigation** (see "Where they sit in the tree" below); Authentication is standalone, because sign-in happens before the shell exists.

## About the design files

The files in this bundle are **design references created in HTML**. They are prototypes that show intended look, structure and behaviour. They are not production code and should not be copied into an application as-is.

`MSP Console.dc.html` is a single self-contained page written against a small in-house streaming-component runtime (`support.js`); `Console Shell.dc.html` and the nineteen module files are the same thing, one surface each. Their markup uses custom elements (`<x-dc>`, `<sc-if>`, `<sc-for>`, `<x-import>`) and a logic class that returns a flat bag of values to the template. None of that is meant to survive into the real app — it exists so the prototype could be authored and iterated quickly.

**The task is to recreate these designs in the target codebase's existing environment**, using its established patterns and libraries. For this project that target is almost certainly the existing `shanemccaw/Shane-McCaw-MSP` repository, which is React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york") + `lucide-react`. Every value in this document maps cleanly onto Tailwind utilities and the shadcn token system already defined in `artifacts/msp-portal/src/index.css`.

If you are building somewhere with no existing frontend, pick the framework that fits the rest of the stack and implement the designs there.

## Fidelity

**High fidelity.** Colours, type sizes, weights, letter-spacing, radii, borders, spacing and hover states in the prototype are all final and intentional. Reproduce them. Every hex value and pixel measurement below is taken directly from the source, not estimated.

Two things are *not* final:

- **All data is mock data.** Tenant names (Northwind Logistics, Halcyon Health, Kestrel Financial, Mccawsoft2), people, scan runs, CR numbers, risk decisions and dollar figures are invented for the prototype. Wire real data from the API routes named throughout.
- **Detail views and drawers are designed but not routed.** They open from their parent list; they do not have their own URLs in the prototype. Give them real routes.

## The design system

This design follows the **Shane McCaw MSP Design System**, bundled here under `_ds/`. The console uses its **dark** mode — the marketing site's slate-950 canvas rather than the portal's light off-white default, because operators work in it all day and it sits visually alongside the telemetry surfaces.

Brand anchors:

| Token | Value | Use |
|---|---|---|
| Deep Navy | `#0A2540` | Header chrome |
| Electric Blue | `#0078D4` | Brand gradient start |
| Bright Teal | `#00B4D8` | Brand gradient end |
| Off-White | `#F7F9FC` | Light-mode only; unused here |

Typeface is **Inter** throughout, weights 400–800. No other family. No emoji anywhere — this is a brand rule, not a preference.

Icons are **Lucide**, 2px stroke. The prototype loads the UMD build from `unpkg.com/lucide` and renders glyphs into `<span data-icon="name">` elements; in the real app use `lucide-react` components directly. Icon names in the prototype are the canonical Lucide kebab-case names (`shield-alert`, `git-pull-request`, `key-round`, `chart-no-axes-gantt`), so they translate directly.

## Design tokens

### Colour

**Surfaces** (darkest to lightest — depth comes from these four plus borders, never from shadows):

| Purpose | Value |
|---|---|
| Page canvas | `#020617` |
| Header | `#0A2540` |
| Sidebar | `#061527` |
| Breadcrumb bar | `#050f1e` |
| Card / panel | `rgba(15, 23, 42, .6)` |
| Popover / dropdown | `#0f172a` |

**Text**

| Purpose | Value |
|---|---|
| Page title | `#f8fafc` |
| Strong body / row primary | `#f1f5f9` |
| Default body | `#e2e8f0` |
| Secondary | `#cbd5e1` |
| Muted / supporting | `#94a3b8` |
| Label, eyebrow, placeholder | `#64748b` |
| Faintest label | `#475569` |

**Semantic signal colours.** Each has a strong tone (dots, bars, icons) and a light tone (text on dark), plus a `/.08–.12` tint fill and a `/.22–.35` border. This pairing is the single most repeated pattern in the design.

| Signal | Strong | Text | Tint | Border |
|---|---|---|---|---|
| Critical / destructive | `#f87171` | `#fca5a5` | `rgba(248,113,113,.12)` | `rgba(248,113,113,.35)` |
| Warning | `#fbbf24` | `#fcd34d` | `rgba(251,191,36,.10)` | `rgba(251,191,36,.28)` |
| OK / healthy | `#34d399` | `#6ee7b7` | `rgba(52,211,153,.10)` | `rgba(52,211,153,.30)` |
| Info / primary accent | `#60a5fa` | `#93c5fd` | `rgba(96,165,250,.10)` | `rgba(96,165,250,.30)` |
| Brand sub-label | `#7dd3fc` | — | — | — |
| Notice / advisory | `#a78bfa` | — | `rgba(167,139,250,.08)` | `rgba(167,139,250,.24)` |
| Neutral | `#94a3b8` | — | `rgba(148,163,184,.06)` | `rgba(148,163,184,.18)` |

**Action blue.** Primary buttons are `#2563eb`, hover `#3b82f6`, with `box-shadow: 0 8px 24px rgba(37,99,235,.28)`. Selected tree rows are `rgba(37,99,235,.22)`.

**Borders.** Hairline and translucent, doing the work shadows would do on a light surface:

- Standard card / divider: `1px solid rgba(148,163,184,.16)`
- Softer divider inside a card: `rgba(148,163,184,.12)`
- Faintest row separator: `rgba(148,163,184,.08)`
- Header and sidebar edges: `rgba(148,163,184,.16)` / `rgba(148,163,184,.14)`
- Interactive border on hover: shifts to `rgba(96,165,250,.4)`

### Typography

| Role | Size | Weight | Tracking | Colour |
|---|---|---|---|---|
| Page title (h1) | 23px | 800 | −0.02em | `#f8fafc` |
| Page eyebrow | 10px | 700 | 0.14em, uppercase | `#64748b` |
| Section eyebrow | 10px | 700 | 0.10–0.12em, uppercase | `#64748b` |
| Micro eyebrow | 9.5px | 700 | 0.10em, uppercase | `#475569` |
| Page note / subhead | 12.5px | 400 | — | `#94a3b8` |
| Card title | 13px | 600 | — | `#f1f5f9` |
| Body | 12–13px | 400 | — | `#94a3b8`–`#e2e8f0` |
| Table header | 10px | 700 | 0.10em, uppercase | `#64748b` |
| Metric value | 28px | 700 | — | semantic |
| Button label | 12.5px | 600 | — | — |
| Chip / pill | 11–11.5px | 600 | — | semantic |
| Code, IDs, hashes | 11–12px | 400 | Menlo, monospace | `#93c5fd` / `#64748b` |

Base font size on the app root is 14px. Body copy that wraps uses `text-wrap: pretty`.

### Spacing, radius, motion

Spacing runs on a loose 4px step; the values that actually recur are **5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20px**. Content padding is `20px 20px 40px`, card padding `15–16px`, dense row padding `11–13px 14–16px`.

Radii: **6px** dense controls and tree rows, **7px** small buttons, **8px** buttons and inputs, **11px** inner panels, **12px** cards and popovers, **13px** icon tiles, **999px** pills.

Shadows are used only twice: `0 24px 48px rgba(2,6,23,.6)` on popovers, and the blue glow on primary buttons.

Transitions are 120–180ms: `background-color .12s` on tree rows, `.15s` on buttons, `border-color .15s` on the search field, `width .18s ease` on the sidebar collapse.

Four keyframes, all short and functional:

```css
@keyframes smcFade  { from { opacity:0; transform:translateY(-4px) }        to { opacity:1; transform:none } }
@keyframes smcPop   { from { opacity:0; transform:translateY(8px) scale(.98) } to { opacity:1; transform:none } }
@keyframes smcSlide { from { transform:translateX(24px); opacity:0 }        to { transform:none; opacity:1 } }
@keyframes smcPulse { 0%,100% { opacity:.35 } 50% { opacity:.7 } }
```

`smcFade` is for dropdowns (140ms), `smcPop` for modals, `smcSlide` for right-hand drawers, `smcPulse` for skeleton loading rows.

---

## The shell

Every screen shares one chrome. Build this once.

```
┌──────────────────────────────────────────────────────────────┐
│ header — 56px, #0A2540                                       │
├───────────────┬──────────────────────────────────────────────┤
│               │ breadcrumbs — #050f1e                        │
│ tree sidebar  ├──────────────────────────────────────────────┤
│ #061527       │ page header (eyebrow / h1 / note / actions)  │
│ 260px         │                                              │
│               │ page body — scrolls independently            │
└───────────────┴──────────────────────────────────────────────┘
```

Root is `display:flex; flex-direction:column; height:100vh; min-height:640px; overflow:hidden`. Only the page body scrolls.

### Header (56px, fixed height, `z-index: 40`)

Left to right: logo lockup, a 1px × 24px divider `rgba(148,163,184,.2)`, the context path, a flex spacer, then the right cluster.

- **Logo lockup.** 28px square, radius 8, `linear-gradient(135deg, #0078D4, #00B4D8)`, "SM" in 11px/800 white. Beside it, stacked at `line-height:1.1`: "Shane McCaw" 13.5px/700 `#fff` tracking −0.01em, and "MSP CONSOLE" 9.5px/600 `#7dd3fc` tracking 0.14em.
- **Context path.** 12px `#64748b`, single line, ellipsised. Shows the current tenant's domain, or "Directory root".
- **Search.** A 260 × 34 button, not an input — clicking opens the command palette. Radius 8, border `rgba(148,163,184,.18)`, background `rgba(2,6,23,.5)`, `#64748b` 12.5px, with a `search` icon and a ⌘K chip (10px/600, radius 4, border `rgba(148,163,184,.25)`, `#94a3b8`). Hover moves the border to `rgba(96,165,250,.4)`.
- **Break-glass pill.** Only when credentials are pending. Height 30, radius 999, border `rgba(248,113,113,.35)`, fill `rgba(248,113,113,.12)`, `#fca5a5` 11.5px/600, `key-round` icon. Hover fill `rgba(248,113,113,.2)`. Clicking jumps to the cross-tenant break-glass watchlist.
- **Notifications.** 34px square ghost button, `bell` icon 16px, with a 6px `#f87171` dot at top 6 / right 7 ringed by a 2px `#0A2540` border. Opens a 340px popover titled "SIGNAL FEED" with a "Mark all read" link; each row is a 26px tinted icon tile plus title (13px/600) and meta (11px `#64748b`).
- **User menu.** 25px circle avatar, `rgba(96,165,250,.18)` on `rgba(96,165,250,.35)`, initials 10px/700 `#93c5fd`, plus `chevron-down`. Opens a 230px popover headed "Shane McCaw / PlatformAdmin — full access".

Both popovers sit at `top: 42px; right: 0`, background `#0f172a`, border `rgba(148,163,184,.2)`, radius 12, shadow `0 24px 48px rgba(2,6,23,.6)`, animation `smcFade .14s ease-out`.

### Tree sidebar

260px expanded, collapsing to an icon rail; width transitions over 180ms. Background `#061527`, right border `rgba(148,163,184,.14)`.

A 38px filter row sits at the top (26px field, radius 6, `filter` icon, "Filter tree" placeholder) next to a 26px collapse toggle. The tree scrolls between that and a footer holding a full-width "Onboard tenant" outline button (height 30, radius 7, border `rgba(148,163,184,.2)`).

Rows are single-line, radius 6, with a chevron slot, an icon slot, a label, and an optional right-aligned count. Indentation and row height vary by depth. Hover `rgba(148,163,184,.08)`; selected `rgba(37,99,235,.22)` with `#ffffff` text against `#cbd5e1`/`#94a3b8` when idle.

The tree has two roots:

1. **Shane McCaw Consulting** (badge "MSP") → **Operations** → the nine MSP-wide pages.
2. **Managed Tenants** (count 4) → one node per tenant, showing seat count → the seven page groups.

Tenant nodes carry a status dot: `#34d399` healthy, `#fbbf24` warnings, `#f87171` critical, `#64748b` never scanned.

### Breadcrumbs

A horizontally scrolling row, padding `10px 20px`, background `#050f1e`, bottom border `rgba(148,163,184,.12)`. Segments are 12px; ancestors are clickable and muted, the last is `#f1f5f9` and inert. Separators are 12px `chevron-right` at `#475569`.

### Page header

Eyebrow, `<h1>`, and note stacked at the left; actions at the right, both wrapping. Where a screen demonstrates multiple data states, a "STATE" chip group (Ready / Loading / Empty / 403 / 404) sits in the action area — that control is a **prototype affordance for reviewing states and must not ship**.

Primary action button: height 34, padding `0 13px`, radius 8, `#2563eb` on `#2563eb`, white 12.5px/600, glow `0 8px 24px rgba(37,99,235,.28)`, hover `#3b82f6`.

---

## Screens

Screenshots are in `screenshots/`, numbered to match the list below. They are above-the-fold captures at 909 × 540 — they establish each screen's identity and top content; the prototype itself is the reference for everything below the fold.

### 1. Managed Tenants — `01-managed-tenants.png`

The directory root. A break-glass watchlist across the whole book sits first (pending credentials, per tenant, with a `pending_delivery` pill), followed by an advisory panel explaining that the list can 403 for a PlatformAdmin session because scope resolves from the session's own MSP claim. Then a cross-tenant data-rights activity feed, then the tenant table.

Table columns: tenant (name + domain), seats, people, last run, signals. Signals render in the tenant's status colour.

### 2. Tenant home — `02-tenant-home.png`

Selecting a tenant node itself, rather than one of its pages. This is the tenant control surface and the densest write-action screen in the console:

- **Identity header** — name, "Tenant" kind, and status chips (connected / not connected, seat count, last run).
- **Business Unit tile** — the only inline-editable field on the screen. Click to edit, save writes back immediately.
- **Consent rows** — one per granted scope, each with an armed **Revoke** (requires a second click) and a **Re-consent** link that copies the consent URL.
- **Admin write-back consent** — surfaced separately because it is the permission that lets the console change the tenant rather than read it.
- **Scores and results** — composite score plus the six engine scores (Security, Health, Governance, Drift, SLA, Scope creep) as labelled bars, then the latest run's critical and warning findings, worst severity first. **The customer portal's free-tier paywall does not apply here**: the customer-facing route redacts finding and recommendation text behind a paid assessment, this one never does, because the operator is the one doing the work. Reads `GET /msp/customers/:id/scores`.
- **Recent scans** and **Purchased services**.
- **Users** list.
- **Delete tenant** — type-the-name confirmation, no exceptions.

**Run Scan** opens a package picker only when more than one package exists; otherwise it runs against the resolved subscription directly.

### 3–24. Tenant pages

| # | Screen | Purpose |
|---|---|---|
| 3 | Overview | Everything open across the tenant, ordered by what needs a person first |
| 4 | Signals | Engine output, newest first, filterable by engine and severity |
| 5 | Diagnostics | Diagnostic runs and their findings |
| 6 | Remediation | Steps, checklist, fix and bypass paths per finding |
| 7 | CR register | Change requests, their state and schedule |
| 8 | Standard Catalog | Pre-approved standard changes |
| 9 | CAB | Change advisory board queue and decisions |
| 10 | Freeze & maintenance | Freeze windows and maintenance windows, with scope and recurrence |
| 11 | Dependencies | What a change touches and what touches it |
| 12 | Executions | Runbook runs, human actions and write actions, with plan-match and attestation |
| 13 | PIRs | Post-incident reviews |
| 14 | Risk Register | Risk-based decisions (RBDs): hazard, controls, raw and residual score, liability, approver, signature status, versions |
| 15 | Runbooks | Runbook definitions and active cycles |
| 16 | Data rights | Export, deletion and access requests |
| 17 | Team | Operator-side roster: member, role/department, MFA method, status. Invite flow, roster filter, and Suspended / Locked out / No MFA facets |
| 18 | Break-glass | Emergency credentials: secrets, delivery attempts, outcomes, expiry |
| 19 | Launch Control | Catalog actions wired to templates, with pre-flight checks that block on red |
| 20 | Webhooks | Endpoints, deliveries and retries per customer |
| 21 | Contracts | SOWs, SLA terms, and the scope-creep ledger |
| 22 | Documents | Tenant document hub |
| 23 | Billing | Seats, plan, prorations and invoice history |
| 24 | Audit log | Every console and Graph API action against the tenant, `actorSurface: msp` |

Pages 3, 21, 4, 23 and 24 are frame-based: they render a 12-column grid of named placeholder frames (`Signal timeline` 12 cols × 220px, `Engine summary` 6 × 170px, and so on) rather than finished content. Those frames are **intentional scaffolding** — the layout and naming are decided, the contents are not. Treat them as a brief, not as a design to reproduce pixel-for-pixel.

Page 3 (Overview) is now a real roll-up rather than a frame grid: four count tiles (critical and breached · awaiting a decision or signature · break-glass unclaimed · accounts locked or without MFA), four grouped row lists (Needs you · Signal and posture · Work in flight · Commercial and records), and a **How this roll-up is assembled** note block recording, per domain, which read each row comes from and what it cannot say. Those notes are load-bearing: the risk register arrives whole and is filtered client-side, the SLA and scope counts are capped at 200/100 so they are floors, SOP runs are filtered out of the MSP-wide history, data-rights activity is MSPAdmin-only and status-less, and the webhooks row counts operator-disabled endpoints separately from owner-switched-off ones.

### 25–33. MSP-wide pages

| # | Screen | Purpose |
|---|---|---|
| 25 | MSP settings | Organisation-level configuration |
| 26 | Executive view | Cross-tenant rollup metrics |
| 27 | Activity timeline | Everything happening across the book, chronological |
| 28 | Configuration State | Tracked configuration per tenant and its drift |
| 29 | Sales | Sales offers and their state |
| 30 | Scope & SLA | Contracted scope and SLA attainment across tenants |
| 31 | SOPs | Standard operating procedures and their runs |
| 32 | Documents | MSP-wide document library |
| 33 | SharePoint connectors | Connector health and configuration |

### 34–36. Console Shell — `34-console-shell-default.png`, `35-console-shell-collapsed-rail.png`, `36-console-shell-command-palette.png`

`Console Shell.dc.html` is the chrome on its own, with the screen region left as an explicit dashed slot. Build this first; every module page mounts inside it.

Five regions: **header** (56px, `#0A2540`, brand lockup, context path, 260px search button with a ⌘K pill, break-glass pill, signal feed, account menu), **tenant tree** (260px, `#061527`, root → operations pages → tenants → page groups → leaves, with a label filter), **breadcrumb bar** (`#050f1e`, derived from the selection, every segment but the last navigates), **screen slot** (eyebrow, title, note from the node's metadata, then the module's own page), **status bar** (28px, book counts at the root, tenant seats and people once a customer is selected).

Five states are on the page as chips: Default, Tree collapsed, Command palette, No tenants, Loading. Collapsed is a 56px icon rail — 36px centred tiles, a 2px left accent bar on the selected one, a hairline divider between the operations block and the tenants, and group/leaf nodes dropped entirely; clicking a tenant in the rail re-expands the tree. Loading paints the chrome first and skeletons the tree; No tenants keeps the chrome, resets the selection to the root, and says the directory returned an empty array rather than an error.

The shell's only state is the selection plus which nodes are expanded. It holds no module data and caches none between nodes; per-staff customer scoping and the MSPAdmin-only screens are enforced by the routes behind each page, not by the tree.

### 38–50. Contract-pack screens

These thirteen were each built from one contract pack in `docs/msp-console/` — documents extracted from the route code, listing every wire field, every real enum, the honest-empty state, and the gaps. **The notes panel at the foot of each of these screens is not filler.** It records what the routes behind that screen genuinely cannot do, and several layout decisions exist only because of those limits. Where a screen holds a guard the server does not, that is called out below; do not quietly drop it in the rebuild.

### Where they sit in the tree

Twelve are real nodes in `MSP Console.dc.html`. Authentication is deliberately not — it is the pre-login surface.

| Tree location | Screens |
|---|---|
| Per tenant → Governance | POA&Ms |
| Per tenant → Access & identity | OU assignment |
| Per tenant → Commercial | Status reports, Marketplace purchase |
| Operations (MSP-wide) | Policy engine, Account security, Reports, Dead letter queue, Retention queue, Partner revenue, Plan & billing, Offboarding |
| Not in the tree | Authentication |

Account security sits under Operations rather than per tenant on purpose: its routes resolve their target by MSP id, never by tenant, so a per-tenant node would have shown the same MSP-wide roster on every tenant.

### The `embedded` contract

Each screen carries `showNotes`, `rootPad`, `rootBg`, plus two props the console passes when it mounts them:

- **`embedded`** — suppresses the screen's own page header (the shell already renders eyebrow, title and note from the tree node) and hides its **data-state** toggle, because the shell's own STATE chip group drives that instead. The standalone file keeps both, which is why the screenshots show a header these mounts do not.
- **`forceEmpty`** — a boolean the console passes straight through from its STATE chips, so Populated/Empty is chosen once in the shell rather than per screen. Passed to the eight screens that have a real empty state: POA&Ms, OU assignment, Status reports, Account security, Reports, DLQ, Retention queue, Partner revenue.

**`embedded` deliberately does not hide the permission simulators** — the role pill on POA&Ms, Reports and Offboarding, and the card-on-file switch on Marketplace Purchase. Those gate real branches (the cancel-bypass, the admin-only delete, the declined payment), so hiding them would make those paths unreachable inside the console. They are still review affordances and still must not ship; they are simply a different kind of control from a data-state toggle.

In the rebuild, both props disappear: the real app renders one page header from the route, and real data decides whether a list is empty.

| # | Screen | File | Built from | What the design turns on |
|---|---|---|---|---|
| 38 | Authentication | `Authentication.dc.html` | `auth.ts`, `mfa.ts` | Five screens in one: sign in, two-factor, forgot/reset password, change MFA, sign out. Header pills switch account role and MFA enforcement, because the admin passkey-only rule and the enforcement flag change most outcomes. Login covers 400, the generic 401, the distinguishable "no password set" 401, the 423 lockout, and the `mfaSetupPending` session that can reach only the enrollment routes. |
| 39 | Account Security | `Account Security.dc.html` | `msp-settings.ts` user-security routes | The operator acting on someone else's account: password reset email, temporary password, MFA clear, MFA enforcement, suspend, session revoke. **The target-role ceiling is enforced by this screen only** — the server checks the caller's tier, never the target's (#3032), so selecting the PlatformAdmin row shows what is unprotected. The roster shows each row's scope because four of nine reachable accounts are customer users caught by a legacy id. |
| 40 | Status Reports | `Status Reports.dc.html` | `msp-status-reports.ts` | Draft → published, one way. Publish carries a confirm step because there is no unpublish and no edit afterwards. A null author renders as "Unknown operator" — the wire has no fallback. Empty is the live state: zero rows exist anywhere. |
| 41 | POA&Ms | `POA&Ms.dc.html` | `msp-poams.ts` | Plans with milestones. **The role pill is load-bearing**: as an operator, Cancel goes through the generic edit route, which accepts the same status without the admin check the dedicated cancel route enforces (#3452). Overdue and signed are derived client-side because these routes return the bare row. A completed milestone is frozen against edits but still deletable. |
| 42 | Reports | `Reports.dc.html` | `msp-reports.ts` | Definitions, runs, canvases and schedules, license waste. A run whose email send failed stays marked generated with the failure only in an error field, so **each run row carries an explicit warning rather than reading as success**. Retry is labelled as a brand-new run. Schedules show no next-send date because nothing executes them. |
| 43 | DLQ | `DLQ.dc.html` | `msp-dlq.ts` | Replay is held closed unless the payload carries a workflow key, because the route has no precheck and returns a bare 500 — and every live row fails that way (#3446). Bulk replay is drawn disabled: it is registered one path level too deep and 404s (#3445). |
| 44 | Retention Queue | `Retention Queue.dc.html` | `msp-retention-queue.ts` | Opens on its real state: nothing can reach this queue, because no record class is registered and nothing calls soft-delete. Three tiles name what is missing. The populated queue sits behind an explicitly labelled "not live data" view. Approve purges inside the same request — no staged step, no undo. |
| 45 | Offboarding | `Offboarding.dc.html` | `msp-portal.ts` offboarding routes | A four-step stepper for the whole MSP, forward-only, with one action live at a time. The first step carries the heaviest warning because nothing resets the state. The export route never verifies cancellation happened, so the sequence is enforced by the screen. Archival suspends the MSP with the same status non-payment produces. |
| 46 | AD OU Assignment | `AD OU Assignment.dc.html` | `msp-active-directory.ts` | Placements and the customer request queue. A manual placement beats the department-name guess, so clearing one hands the person back to it. Placing verifies the address in the real directory; moving does not re-verify. Approving a request that names a non-existent unit writes nothing, so the button reads "Approve (writes nothing)". |
| 47 | Marketplace Purchase | `Marketplace Purchase.dc.html` | `msp-marketplace-purchase.ts` | Buying for a customer on the MSP's card. **The accepted offer is written and pushed to the customer before payment is attempted and nothing rolls it back** (#3400) — so the screen confirms before sending and shows what a decline leaves. Retainers warn that a monthly item bills once (#3403); items with an unknown fulfilment type warn that nothing will be provisioned (#3404). |
| 48 | Partner Revenue | `Partner Revenue.dc.html` | `msp-partner-revenue.ts` | Two halves that must never be conflated or totalled: verified platform spend as a solid statement panel, and the resale worksheet as a dashed, muted panel with its disclaimer always present, because MSPs invoice outside the platform and nothing there is charged or reconciled. |
| 49 | Plan Self-Service | `Plan Self-Service.dc.html` | `msp-plan-self-service.ts` | The MSP's own plan and payment method. |
| 50 | Policy Engine | `Policy Engine.dc.html` | `msp-policy-decisions.ts`, `msp-standing-policies.ts` | Customer-signed policy decisions and MSP standing policies. Two different reasons both produce the same route outcome, so reason is rendered separately from route. |

Screenshots `38-authentication.png` through `50-policy-engine.png`.

**A pattern shared by all thirteen.** Where a route is missing a guard, these screens supply it in the UI and say so on the face of the screen rather than hiding it. When the corresponding upstream issue lands (#3032, #3400, #3403, #3404, #3405, #3445, #3446, #3452), the guard can move to the server — but until then, removing it from the UI removes it entirely. Each screen also carries a small toggle or two (role, empty state, card on file) that exist **to review states during design and must not ship**, exactly like the STATE chip group described above.

### 37. Ownership — `37-tenant-ownership.png`

The operator half of RACI, as its own module page (`Ownership.dc.html`): what our staff hold across the book, per-customer coverage including the zero rows, and one customer's matrix with cell detail. Its feature is not architected upstream, which the screen states on itself.

---

## Interactions and behaviour

### Navigation

Selection is a single state object:

```js
sel = { kind: 'root' }                              // directory
     | { kind: 'tenant', tenant: <index> }          // tenant home
     | { kind: 'page',   tenant: <index>, page: <pageId> }
     | { kind: 'msp',    page: <pageId> }
```

Give each of these a real URL — `/tenants`, `/tenants/:id`, `/tenants/:id/:page`, `/ops/:page`. Selecting a tenant page auto-expands both the tenant node and the group containing that page.

### Command palette

⌘K or clicking the header search. Lists the directory root, then every tenant × page combination as "Tenant › Page", grouped by ROOT / NODE. Filter as you type, Enter to navigate.

### Armed destructive actions

Three escalating patterns, used consistently:

1. **Arm-then-confirm.** Consent revoke. First click arms the row (state holds `{ tenant, key }`), second click commits. Clicking elsewhere disarms.
2. **Confirmation drawer.** Most write actions. A right-hand drawer (`smcSlide`) with a tinted warning block, a labelled list of exactly what will be written, and a single CTA.
3. **Type-the-name.** Tenant delete only. The confirm button stays disabled until the typed string matches the tenant name exactly.

The danger drawer for user actions (temporary password, MFA reset, emergency bypass code) returns a **shown-once result**: an eyebrow, a monospace code, and a note telling the operator to relay it out-of-band. Once dismissed the value is gone.

### Drawers

All drawers slide from the right at 24px over 140–200ms. Four kinds: invite, confirm, danger, and the RBD/run family (sign, revoke, capture version, share version, offer state). Each RBD drawer carries its own eyebrow showing the exact API route it calls — keep those visible; operators use them to reason about what a button actually does.

### Data states

Five states are designed for every list: Ready, Loading, Empty, 403, 404.

- **Loading** — skeleton rows inside the normal card, animating with `smcPulse`.
- **Empty** — centred 44px icon tile (`rgba(96,165,250,.1)` on `rgba(96,165,250,.22)`, radius 13) above a short explanation. Copy is specific to the screen, never "No data".
- **403 / 404** — an advisory panel stating the scope rule that caused it, plus the route. These matter: several of the console's lists legitimately 403 for a PlatformAdmin session because scope resolves from the session's MSP claim rather than a route parameter.

### Hover and focus

Hover is always a background or border shift, never a transform except the deliberate card lift on marketing-style cards (`-translate-y-1`). Ghost buttons go to `rgba(148,163,184,.12)`. Tree rows go to `rgba(148,163,184,.08)`. Focus is a 1–2px Electric Blue ring. Nothing shrinks on press.

### Responsive

The console is a desktop tool and assumes ≥1280px. Tables scroll horizontally inside their card below their natural width (`min-width: 720px` on the directory table, `1040px` on the roster). The sidebar collapses to an icon rail. Grids use `repeat(auto-fit, minmax(…, 1fr))` and reflow. There is no mobile layout and none is planned.

## State

Held in one component in the prototype; split it sensibly when you rebuild.

**Navigation** — `sel`, `open` (expanded tenant nodes), `openGroups` (expanded page groups, keyed `tenantIndex:groupId`), `openCC`, `treeQuery`, `expanded` (sidebar).

**Overlays** — `notifsOpen`, `userOpen`, `paletteOpen`, `drawer`, `dangerUser`, `result`.

**Per-screen** — `tenBU` (business-unit edit), `tenRevoke` (armed consent row), `tenOutcome` (toast), `bgTab`, `bgSecret`, `doc`, `rbdSel`, `cfgTarget`, `invite`, `inviteConflict`.

Every overlay closes on navigation. `drawer`, `doc`, `rbdSel`, `dangerUser` and `result` all reset whenever `sel` changes.

## Data and API

The prototype is built against routes in `artifacts/api-server/src/routes/`, 74 non-test `msp-*` route files. Route names appear verbatim in the UI wherever a control writes something — those labels are load-bearing documentation and should survive into the real build.

Named explicitly in the design:

- `GET /msp/customers/:id/scores` — composite, per-engine and pillar scores plus priority findings (`msp-customer-scores.ts`)
- `GET /api/msp/break-glass` — cross-tenant pending credentials
- `PATCH /api/msp/rbd/:rbdId/sign` — record the customer's signature
- `PATCH /api/msp/rbd/:rbdId/revoke` — revoke a risk-based decision
- `POST /api/msp/rbd/:rbdId/versions` — capture a version
- `POST /api/msp/rbd/:rbdId/versions/:versionUid/share` — share the current version (returns a token, not a URL; 30-day expiry)
- `PATCH /api/msp/sales-offers/:id/state` — advance a sales offer

`github.md` in this bundle records the repository, branch, last sync and a screen-to-source map. It also carries a **contract-pack inventory**: all 38 packs under `docs/msp-console/` with the screen each maps to and the pack's blob sha, so a later session can tell which packs changed upstream.

The thirteen contract-pack screens (38–50) each name their own routes in the UI, in the same load-bearing way: the route path and its real response are printed next to the control that calls it, and the route log on several of them shows the exact status and message the server returned.

## Assets

- **`_ds/`** — the Shane McCaw MSP Design System bundle: `styles.css`, the five token stylesheets (`fonts`, `colors`, `typography`, `spacing`, `elevation`), and `_ds_bundle.js` carrying the React components. Use the tokens; they are the same values tabulated above.
- **Icons** — Lucide, loaded from CDN in the prototype. Use `lucide-react` in the real build.
- **Brand mark** — the "SM" tile is drawn in CSS (gradient + text), not an image file. There is no wordmark asset; the wordmark is set in Inter.
- No photography, no illustration, no generated imagery anywhere in this design.

## Files in this bundle

| Path | What it is |
|---|---|
| `MSP Console.dc.html` | The full interactive prototype. Open it in a browser to click through every screen. |
| `Console Shell.dc.html` | The shell on its own — chrome, tree, palette, status bar, and its five states. Start here. |
| 19 module files | `Diagnostics`, `Remediation`, `Change Control`, `Risk Register`, `Runbooks`, `Ownership`, `Data Rights`, `Team`, `Break Glass`, `Launch Control`, `Webhooks`, `Documents`, `Executive View`, `Activity Timeline`, `Configuration State`, `Sales`, `Scope and SLA`, `SOPs` (`.dc.html` each). Each opens standalone and is also mounted inside `MSP Console.dc.html`. |
| 13 contract-pack screens | `Authentication`, `Account Security`, `Status Reports`, `POA&Ms`, `Reports`, `DLQ`, `Retention Queue`, `Offboarding`, `AD OU Assignment`, `Marketplace Purchase`, `Partner Revenue`, `Plan Self-Service`, `Policy Engine` (`.dc.html` each). Screens 38–50. Each opens standalone; none is mounted inside `MSP Console.dc.html` yet. |
| `support.js` | The prototype runtime. Required for the HTML to run; not for production. |
| `_ds/` | Design system tokens, stylesheet and component bundle. |
| `screenshots/` | 49 PNGs, numbered to match the Screens section. Screens 38–50 are captured **standalone**, so they show the page header and toggles that the console mount suppresses. |
| `github.md` | Repository, branch, last sync commit, and the screen-to-source map. |
| `README.md` | This document. |

To run the prototype, serve the bundle folder over HTTP (the runtime fetches `support.js` and the `_ds/` files by relative path) and open `MSP Console.dc.html`.

# Handoff: Shane McCaw Customer Portal — UI Shell only

## Overview

This package covers **the application shell** of the Shane McCaw customer portal: the top bar, the six-pillar tab strip, the left module navigation, the Tenant Status card (including live scan progress), the three top-right popovers, the right-slide detail panel, the ShaneBot dock, and the Settings container.

**Page content is explicitly out of scope.** Everywhere a module page would render, the shell exposes a single content slot. In the bundled reference file that slot shows a dashed `PAGE CONTENT` placeholder. Build the shell so pages can be dropped into that slot later without touching the chrome.

## About the design files

`Shell.dc.html` in this folder is a **design reference written in HTML**, not production code to copy. It is a working prototype of the intended look and behaviour. Your task is to **recreate it in the target codebase's own environment** — the real product is React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york") + Lucide icons — using that project's established patterns. If no environment exists yet, React + Vite + Tailwind is the right choice for consistency with the rest of the product.

The reference file loads a design-system bundle from `../_ds/...`. Those paths only resolve inside the design project; ignore them and use the token values listed below.

## Fidelity

**High fidelity.** Colours, type sizes, spacing and states below are exact values taken from the reference file. Recreate them precisely, using the codebase's existing primitives (shadcn `Button`, `Card`, `Badge`, `Input`) where they can carry these values.

## Screenshots

| File | What it shows |
|---|---|
| `screenshots/01-overview-never-scanned.png` | Default shell, tenant never scanned |
| `screenshots/02-user-menu.png` | Top-right user menu open |
| `screenshots/03-alerts-popover.png` | Alerts popover, empty state |
| `screenshots/04-tenant-status-scanning.png` | Tenant Status mid-scan: determinate bar, check count, live finding |
| `screenshots/05-scan-log-panel.png` | Right-slide panel with the per-check scan log |
| `screenshots/06-scan-complete.png` | Completed scan: score, outcome block, full log |
| `screenshots/07-shanebot.png` | ShaneBot dock expanded |
| `screenshots/08-settings-your-data.png` | Settings → Your data |
| `screenshots/09-settings-export-panel.png` | Export-my-data request panel over Settings |

## Layout

Full-viewport column, `height: 100vh`, `background: #020617`, no page-level scroll. Top to bottom:

1. **Impersonation banner** (conditional) — `height: 36px`, `background: #0078D4`, `padding: 0 16px`, `flex: none`. Eye icon 14px `#fff`, title 12.5px/600 `#fff`, subtitle 12px `rgba(255,255,255,.75)`, right-aligned "End session" pill 11.5px/600, `border: 1px solid rgba(255,255,255,.55)`, `border-radius: 999px`, `padding: 3px 12px`.
2. **Top bar** — `height: 56px`, `padding: 0 16px 0 20px`, `border-bottom: 1px solid rgba(255,255,255,.10)`, `display: flex; align-items: center; gap: 14px`.
   - Brand lockup: 28×28 tile, `border-radius: 6px`, `background: linear-gradient(135deg,#0078D4,#00B4D8)`, letter "S" 13px/700 `#fff`. Beside it "Shane McCaw" 13.5px/600 `#f8fafc` over "CUSTOMER PORTAL" 10px `#64748b`, `letter-spacing: .08em`, uppercase.
   - 1×20px divider `rgba(255,255,255,.10)`.
   - Breadcrumb: parent 12.5px `#64748b`, chevron 12px `#334155`, current page 14px/600 `#f8fafc`.
   - Right cluster: SOP-runs icon button, alerts bell (with unread count badge), user avatar + chevron. Buttons take `background: rgba(255,255,255,.06)` while their popover is open.
3. **Pillar tab strip** — `height: 64px`, `overflow-x: auto`, `border-bottom: 1px solid rgba(255,255,255,.10)`. Six equal tabs, each `flex: 1 0 130px`, `border-right: 1px solid rgba(255,255,255,.06)`. Each tab: a 3px top band `linear-gradient(90deg, <primary>, <accent>)`, then a row with `padding: 0 16px; gap: 9px` holding a 17px Lucide icon stroked in the pillar's primary colour, a 12.5px/600 label, and a right-aligned 13px/700 score with `font-variant-numeric: tabular-nums`. Selected tab: `background: rgba(255,255,255,.05)`, label `#f8fafc`; unselected label `#cbd5e1`; hover `rgba(255,255,255,.04)`.
4. **Body row** — `flex: 1; display: flex; min-height: 0`.
   - **Sidebar**: `width: 232px; flex: none`, `border-right: 1px solid rgba(255,255,255,.10)`, `padding: 14px 10px 12px`, column layout.
   - **Content slot**: `flex: 1; display: flex; min-height: 0; position: relative`. The page owns its own scrolling; the shell never scrolls.

### Pillar colours

| Pillar | Primary | Accent (band end) |
|---|---|---|
| Governance | `#3B82F6` | `#60A5FA` |
| Security | `#8B5CF6` | `#A78BFA` |
| Compliance | `#F3F4F6` | `#D1D5DB` |
| Licensing | `#14B8A6` | `#2DD4BF` |
| Adoption | `#F97316` | `#FB923C` |
| Health | `#22C55E` | `#4ADE80` |

Score colour by band: `>= 60` `#34d399`, `>= 50` `#fbbf24`, below `#f87171`. Never scanned renders an em dash `—` in `#475569` — never a zero.

### Sidebar module list

Scrollable list (`overflow-y: auto; overflow-x: hidden; min-height: 0; gap: 1px; margin-bottom: 10px`). Each row: `display: flex; align-items: center; gap: 10px; padding: 5.5px 10px; border-radius: 6px`, 15px Lucide icon (1.75 stroke) + 13px label. Active row `background: rgba(255,255,255,.06)`, label `#f8fafc`, weight 600. Inactive label `#94a3b8`, weight 400. Hover `rgba(255,255,255,.04)`.

Order: Overview, Microsoft Changes, Change Control, Risk Register, Remediation, SOPs, Runbooks, Ownership / RACI, Policy Decisions, Configuration State, Security Plan.

## Tenant Status card (bottom of the sidebar)

`margin-top: auto`, `border-radius: 14px`, `border: 1px solid rgba(255,255,255,.10)`, `background: linear-gradient(135deg, rgba(0,120,212,.12), rgba(139,92,246,.10))`, `padding: 14px 14px 12px`.

Contents, top to bottom:

- **Header row** (clickable — opens the scan log panel): 13px sparkle glyph filled `#00B4D8`, label `TENANT STATUS` 10px/600 `#64748b` `letter-spacing: .13em` `white-space: nowrap`, and a right-aligned phase chip 9.5px/600 `#475569` `white-space: nowrap`. Chip copy by phase: `Live`, `Live · late`, `Complete`, `Partial`, `Failed`, `No stream`, `Summary`, `No run`. Keep these short — the row is only ~200px wide.
- **Score**: 30px/800 `#f8fafc` with `font-variant-numeric: tabular-nums`, plus `/ 100` at 13px `#475569`. Never scanned: `—` in `#475569` and no `/ 100`.
- **Severity label**: 12.5px/600, `padding: 5px 0 2px`. Healthy `#34d399` "Healthy", attention `#fbbf24` "Attention required", critical `#f87171` "Critical", none `#64748b` "Not scanned yet".
- **Status line**: 11.5px `#64748b`, `line-height: 1.45`.
- **Progress block** (while a run is live, or after a stream drop): 3px track `rgba(255,255,255,.08)` `border-radius: 999px`. Determinate fill `linear-gradient(90deg,#0078D4,#00B4D8)` with `width: <index/total>%` and `transition: width 400ms ease`. When the stream has dropped, swap the fill for the indeterminate sweep (`@keyframes scanSlide` — `translateX(-110%)` → `translateX(360%)`, 1.8s ease-in-out infinite, 34% wide). Below it: count line 11px/600 `#cbd5e1` tabular-nums ("Check 12 of 22", plus " · joined mid-scan" on a late join) and a right-aligned "Open log" hint 10px `#475569`. When the most recent check matched a severity rule, show its finding sentence at 11px `#cbd5e1` with a 2px left border in the matched severity's colour (`critical #f87171`, `warning #c2a63d`, `info #60a5fa`).
- **Outcome block** (terminal states): `border-top: 1px solid rgba(255,255,255,.07)`, `padding-top: 9px`. A 6px dot + head 11.5px/600 in the state colour, then body 11px `#64748b`.
- **CTA**: full-width button, `background: #0078D4`, hover `#005A9E`, 12.5px/600 `#fff`, `border-radius: 6px`, `padding: 8px 0`. Label "Run first scan" when never scanned, otherwise "Run a new scan". Hidden while a run is live or the stream has dropped.

### Scan states (all eight)

| Phase | Card head / body |
|---|---|
| `none` | "First scan establishes your baseline". CTA visible. No progress or outcome block. |
| `running` | Determinate bar, "Check N of 22", live finding sentence. |
| `late-join` | As running, count line reads " · joined mid-scan"; the panel states that earlier checks were not replayed. |
| `complete` | "Scan complete" `#34d399` · "22 checks · 11 findings". |
| `partial` | "Finished partially" `#c2a63d` · adds " · N checks failed". |
| `failed` | "Scan failed" `#f87171` · the run's own message (e.g. no tenant connected). |
| `disconnected` | "Live progress stream disconnected" `#c2a63d` · "The scan may still be running." Indeterminate sweep, last-seen index. |
| `cache-cleared` | "That run finished before this page opened" `#60a5fa`, dashed dot · shows the stored summary and **no** per-check log. |

Two rules that must survive implementation:

1. A dropped connection and a failure the run reported are rendered identically — **but only if the run had not already completed.** A drop after success must never replace a real success with an error.
2. The live stream and the two polling endpoints work together, not as alternatives: the poll supplies the run to watch and the terminal summary once the live replay window has closed. A finished run whose replay cache is cleared has no log, and the panel says so rather than inventing one.

## Popovers (top right)

All three: `position: absolute`, top offset 64px (100px when the impersonation banner shows), `border-radius: 14px`, `border: 1px solid rgba(255,255,255,.10)`, dark panel background, subtle shadow. A full-viewport click-catching overlay closes them. Only one is open at a time.

- **User menu** (~304px): identity block (36px round avatar, name 13.5px/600, e-mail 12px `#64748b`, a "Customer" pill), then rows at `padding: 8px 10px; gap: 11px; border-radius: 8px`, 15px Lucide icon `#94a3b8`, label 13px `#cbd5e1`, optional 10.5px `#64748b` sub-label; hover `rgba(255,255,255,.04)`. Items: Billing, Webhooks, Settings (sub "Alert preferences"), divider, Account security (sub "Password · MFA · active sessions"), divider, Sign out. Footer strip "Managed by Shane McCaw" 10.5px `#64748b`.
- **Alerts** (~404px): header "Alerts" 13.5px/600 with a right-aligned status ("Up to date" / unread count), grouped rows (TODAY / EARLIER) with severity dot + title + body + timestamp, and a footer link "Alert preferences" that navigates to Settings. Empty state: 44px round icon tile, "Nothing needs your attention" 13px/600 `#cbd5e1`, explanatory 12px `#64748b`.
- **SOP runs** (~360px): live procedure runs with a per-run progress bar; footer "Open Runbooks". Empty state mirrors the alerts empty state.

## Right-slide detail panel

One shared panel for every contextual detail in the shell. Desktop: `position: absolute; top: 0; right: 0; width: 384px; height: 100%; border-radius: 0`. Below 760px viewport width it becomes a bottom sheet: full width, `max-height: 84%`, `border-radius: 16px 16px 0 0`. Behind it, a dimming overlay closes it.

Structure: header (title 15px/600 `#f8fafc`, state line 11.5px `#64748b`, close X), scrollable body (`flex: 1; overflow-y: auto; padding: 16px 18px 20px; gap: 14px`), optional footer with a primary CTA and a 10.5px foot note.

Body block types the shell uses:
- **Steps** — numbered 20px rings; done rings `border: 1px solid rgba(52,211,153,.45)`, `background: rgba(52,211,153,.12)`, tick `#34d399`; pending rings `rgba(255,255,255,.14)` with `#94a3b8` numerals. Each step has a title and a sub-line. The scan log uses this, newest first.
- **Rows** — a key/value list: key 11px/600 `#cbd5e1`, value 12px `#94a3b8`, optional right-aligned action link `#60a5fa`.
- **Note** — a single emphasised sentence, colour set per panel (`#c2a63d` for cautions).

## Settings container

`Settings` is a shell-owned page, not a module page. Layout: a 196px settings nav (`border-right: 1px solid rgba(255,255,255,.06)`, `padding: 20px 10px 0 12px`) beside a scrolling pane (`flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden`).

Nav: heading `SETTINGS` 10px/700 `#475569` `letter-spacing: .14em`; then group labels 9px/700 `#334155` `letter-spacing: .13em`; then items (`padding: 7px 10px; border-radius: 6px`, 14px icon + 12.5px label), active `background: rgba(255,255,255,.06)` label `#f8fafc`, inactive `#94a3b8`. Footer note: "Each module adds its own settings here as it lands — this list grows." 10.5px `#334155`.

Groups today:
- **ALERTS** → Alert preferences (the existing 23-rule catalogue pane).
- **YOUR ACCOUNT** → Your data.

**This grouping is the extension point.** New modules append a group + item; nothing else in the shell changes.

### Settings → Your data

Two cards, each `border: 1px solid rgba(255,255,255,.09)`, `border-radius: 14px`, `background: rgba(255,255,255,.02)`, `padding: 18px 20px`, `display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap` (wrapping matters — the CTA must drop below the copy on narrow viewports).

1. **Export my data** — 18px download icon `#60a5fa`; title 14px/600; body 12.5px `#94a3b8` (`min-width: 200px`); CTA "Request an export" 12.5px/600 `#93c5fd`, `border: 1px solid rgba(0,120,212,.5)`, `background: rgba(0,120,212,.1)`, hover border `rgba(0,120,212,.8)`.
2. **Request deletion** — 18px trash icon `#f87171`; same structure; CTA "Start a request" `#fca5a5` with `border: 1px solid rgba(248,113,113,.4)`, hover `rgba(248,113,113,.7)`.

Closing line, 11px `#475569`: both requests are handled by the MSP rather than acted on automatically, and both are recorded against the account.

Both CTAs open the right-slide panel. The export panel explains what the export contains, how it arrives, and that the request is recorded. The deletion panel explains that nothing is deleted immediately, that retained records (signed decisions, approvals, change history) are named in the reply, and carries the caution note "This starts a conversation, not a deletion."

These two actions used to live in the top-right user menu and were moved here; the user menu must not carry them.

## ShaneBot dock

Collapsed: bottom-right pill, `border-radius: 999px`, dark panel background with a `#0078D4`→`#00B4D8` 28px icon tile and the label "ShaneBot" 13px/600. Expanded: ~404px wide card anchored bottom-right with a header (title + "Answers from your own tenant"), a scrolling transcript (user turns right-aligned as pills, replies as 14px `#e2e8f0` prose, optional attachment chips), and a composer input with a round send button. Footer line: "Answers draw only on your tenant's own data" 10.5px `#64748b`.

Replies are generated from real tenant state only. With no scan, the bot has nothing to say about the tenant — do not invent an answer.

## Interactions & behaviour

- One popover open at a time; the overlay closes any of them.
- Selecting a pillar tab or a sidebar item switches the content slot and closes popovers.
- The Tenant Status header row, progress block and outcome block all open the scan log panel. The panel content must be **derived at render time** from live scan state, not snapshotted when it opens — otherwise the log freezes.
- Transitions: colour/background 150–300ms; the scan bar width 400ms ease; the ShaneBot rail 260ms `cubic-bezier(.4,0,.2,1)`; ambient severity washes 1800ms.
- Keyboard: every popover trigger, nav row and panel control is a real focusable control with a visible `#0078D4` focus ring.
- Below 760px the panel becomes a bottom sheet. The pillar strip scrolls horizontally rather than wrapping.

## State

| State | Type | Notes |
|---|---|---|
| `page` | `null \| "settings" \| "pillar" \| <module key>` | `null` is Overview |
| `pillarKey` | pillar id | Which pillar page is selected |
| `settingsTab` | `"alerts" \| "data"` | Settings pane |
| `openPopover` | `null \| "user" \| "alerts" \| "sop"` | Mutually exclusive |
| `panel` | `null \| { kind }` | Right-slide panel; derive its content from live state |
| `botOpen` | boolean | ShaneBot dock |
| `narrow` | boolean | `window.innerWidth < 760`, from a resize listener |
| `severity` | `"none" \| "healthy" \| "attention" \| "critical"` | Tenant severity band |
| `scanPhase` | the eight phases above | From the SSE stream + status poll |
| `scanIndex` / `scanTotal` | number | Current check / plan length |

## Data the shell needs

The shell itself reads three things (all customer-scoped):

1. **Scan status poll** — whether the tenant has ever scanned, the last scan time, the active run (id, status, counts) and the last run's summary. Poll every 30–60s, every ~3s while a run is live.
2. **Scan plan** — the ordered list of check keys the active run will execute; fetch once per run. This is what makes the progress bar determinate.
3. **Run-scoped live progress stream** — one event per check as it resolves (key, label, status, index, total, matched severity band, matched finding sentence), then a terminal complete/partial event or a run-error event. Connection errors are handled as described above.

Everything else on the shell (alerts, SOP runs, ShaneBot) belongs to its own module contract and can be stubbed while the shell is built.

## Design tokens

**Colours**
- Canvas `#020617`; panel surfaces `rgba(255,255,255,.02)`; hairlines `rgba(255,255,255,.06–.10)`; hover overlay `rgba(255,255,255,.04)`; active overlay `rgba(255,255,255,.06)`.
- Brand: Deep Navy `#0A2540`, Electric Blue `#0078D4` (pressed `#005A9E`), Bright Teal `#00B4D8`.
- Text: primary `#f8fafc`, secondary `#cbd5e1`, tertiary `#94a3b8`, muted `#64748b`, faint `#475569`, faintest `#334155`.
- Semantic: success `#34d399`, caution `#c2a63d` / `#fbbf24`, danger `#f87171` (soft `#fca5a5`), info `#60a5fa` (soft `#93c5fd`), neutral-dashed `#8494ab`.

**Type** — Inter throughout. 30/800 score · 20/700 page title · 15/600 panel title · 14/600 section head · 13.5/600 card title · 13/400–600 nav · 12.5/600 button · 12/400 body · 11.5/400 sub-body · 11/400 meta · 10.5/700 uppercase eyebrow (`letter-spacing: .06–.07em`) · 10/600 chrome label (`letter-spacing: .13em`) · 9.5/700 pill. Tabular numerals on every number. Menlo monospace only for codes and JSON snapshots.

**Spacing** — 4px base. Card padding 13–20px; row padding 6–9px vertical, 10–16px horizontal; section gaps 8–16px; sidebar gutters 10–14px.

**Radii** — 6px controls and nav rows · 8–9px menu rows and inner cells · 12–14px cards and popovers · 999px pills, dots and bars.

**Elevation** — borders do the separation work, not shadows. Popovers and the slide panel carry one soft dark shadow; nothing else does.

**Motion** — `scanSlide` (indeterminate sweep), `washBreathe` (ambient severity glow), `livePulse` (live dots). No bounce, no parallax.

## Files in this package

| File | What it is |
|---|---|
| `Shell.dc.html` | The shell design reference. Page mounts are replaced with the `PAGE CONTENT` placeholder — the shell's own chrome is complete and interactive. |
| `support.js` | Runtime the reference HTML needs to render. Not part of what you build. |
| `screenshots/*.png` | The nine states listed above. |

## Out of scope

Every module page (Overview, Microsoft Changes, Change Control, Risk Register, Remediation, SOPs, Runbooks, Ownership / RACI, Policy Decisions, Configuration State, Security Plan, Account Security) and the Alert-preferences pane's internals. Those have their own designs and their own contracts. Build the slot; leave the pages.

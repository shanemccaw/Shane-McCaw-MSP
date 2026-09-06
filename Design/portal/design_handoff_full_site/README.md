# Handoff: Shane McCaw Consulting — Customer Portal (full site)

## Overview

This package covers the **entire authenticated customer portal** for Shane McCaw Consulting, an M365 governance SaaS: the app shell/chrome plus every module screen inside it, and the six pre-auth screens that sit in front of it. 24 screens in total, listed below.

## About the design files

Everything under `screens/` is a **design reference written in HTML** — a working prototype of intended look and behavior, not production code to copy directly. The real product is **React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york" style) + Lucide icons**. Your task is to **recreate these designs in that stack** (or the target codebase's existing environment, if different), using its established components and patterns — not to ship the HTML files as-is.

Each reference file loads a design-system bundle from a relative `_ds/...` path and some load `support.js`. Those only resolve inside the design tool; ignore them and build from the token values and component notes below and in each screen's contract pack.

Several screens include a **"real response state" switcher** at the top (visible in some of the screenshots, e.g. Auth Sign-In's `401 invalid credentials` / `423 account locked` / `200 mfaRequired` pills). These are not decorative — they enumerate every real state the backend can actually return for that screen, extracted from source. Build the UI to handle every state shown, not just the default.

## Fidelity

**High fidelity.** Colors, type, spacing, and states are exact values taken from the reference files and from the contract packs in `docs/`. Recreate them precisely using the codebase's existing primitives (shadcn `Button`, `Card`, `Badge`, `Input`, etc.) where they can carry these values.

## How this package is organized

- **`screens/`** — the 24 `.dc.html` design files, one per screen, plus `support.js` (the runtime they need to render inside the design tool — not something you build).
- **`screenshots/`** — one PNG per screen, numbered to match the table below.
- **`docs/`** — contract-pack markdown files. These are backend-extraction documents: for most modules, a pack traces every field and state shown on that screen back to the real API route and database schema (file:line citations). They are the single most reliable source for exact data shapes, validation rules, error states, and "what's real vs. not built yet." Read the relevant pack before implementing a screen.

## Update log

- **Security Plan** (`screens/Security Plan.dc.html`) — added the real customer-facing review + sign action: a sealed-but-unsigned version now shows a "Review and sign this version" CTA opening a typed full-name (+ optional title) panel. Signing never edits plan content, only attaches a signature to the already-sealed version. Backed by `docs/security-plan-contract-pack.md`.
- **Configuration State** (`screens/Configuration State.dc.html`) — refreshed to the latest real snapshot numbers and workload roll-up, and added a new change-attribution panel: a verdict roll-up (attributed / accepted risk / contested / unattributed / ignored) on the changes-since-last-snapshot card, with the honest all-unattributed state explained in place rather than read as a defect. Backed by `docs/configuration-state-contract-pack.md`.

## Screen inventory

| # | Screen | File | Contract pack | Notes |
|---|---|---|---|---|
| 01 | App shell | `Shell.dc.html` | — | Top bar, six-pillar tab strip, sidebar nav, Tenant Status card + live scan, popovers, right-slide panel, ShaneBot dock, Settings container. Every other screen mounts inside its content slot. |
| 02 | Overview | `Overview.dc.html` | `customer-home-and-timeline-contract-pack.md` | Home dashboard: engine scores, priority items, activity timeline, cross-module roll-up counts. |
| 03 | Microsoft Changes | `Microsoft Changes.dc.html` | — | Message-center change feed (built from a design brief, not a contract pack — see `github.md` history). |
| 04 | Change Control | `Change Control.dc.html` | `change-control-contract-pack.md` (stale — see caveat below) | Change requests, approvals, freeze calendar, standard-change catalogue. |
| 05 | Risk Register | `Risk Register.dc.html` | `risk-register-contract-pack.md` | Risk lifecycle, likelihood/impact heat map, role-gated acceptance signatures. |
| 06 | Remediation Tracking | `Remediation Tracking.dc.html` | `remediation-tracking-contract-pack.md` | Findings checklist + 28-step programme + verification/acceptance flows. |
| 07 | SOPs | `SOPs.dc.html` | `sops-contract-pack.md` | SOP library, per-tenant custom steps, run queue and history. |
| 08 | Ownership / RACI | `Ownership RACI.dc.html` | `ownership-raci-contract-pack.md` | Role assignment matrix, decline flow, per-cell history. |
| 09 | Policy Decisions | `Policy Decisions.dc.html` | `policy-decisions-contract-pack.md` | Signed policy register, review cadences, typed authorities. |
| 10 | Configuration State | `Configuration State.dc.html` | `configuration-state-contract-pack.md` | Tenant configuration snapshot; also defines the Settings-as-container pattern used by the shell. |
| 11 | Security Plan | `Security Plan.dc.html` | `security-plan-contract-pack.md` | Assembled/versioned/signed security plan, drift against last signed version. |
| 12 | Pillar pages | `Pillar Pages.dc.html` | — | The six pillar landing pages (Governance, Security, Compliance, Licensing, Adoption, Health) reached from the shell's tab strip. |
| 13 | Account Security | `Account Security.dc.html` | `account-security-contract-pack.md` | Password/MFA/sessions for the signed-in user, plus tenant-wide Graph security readings. |
| 14 | Billing | `Billing.dc.html` | `billing-contract-pack.md` | Receipts, plan state, Stripe billing-portal handoff. |
| 15 | Webhooks | `Webhooks.dc.html` | `webhooks-contract-pack.md` | Outbound webhook endpoints, delivery log, secret rotation. |
| 16 | Notification Preferences | `Notification Preferences.dc.html` | `notification-preferences-contract-pack.md` | 15-category in-app/email preference matrix. |
| 17 | Portal Alerts | `Portal Alerts.dc.html` | — | Alerts dropdown + the alert-preferences settings pane. |
| 18 | ShaneBot | `ShaneBot.dc.html` | `shanebot-contract-pack.md` | Full-page support chat surface with real "Active Card" renderers (invoice, subscription, score, data-answer). |
| 19 | Auth: Sign in | `Auth Sign-In.dc.html` | `auth-core-contract-pack.md` | |
| 20 | Auth: MFA challenge | `Auth MFA Challenge.dc.html` | `auth-core-contract-pack.md` | TOTP + emergency bypass; SMS/passkey are real backend routes with no UI wired yet (stated in the pack). |
| 21 | Auth: Forgot password | `Auth Forgot Password.dc.html` | `auth-core-contract-pack.md` | Always responds 200 regardless of whether the email exists (enumeration resistance) — reflect this, don't add a "email not found" state. |
| 22 | Auth: Reset password | `Auth Reset Password.dc.html` | `auth-core-contract-pack.md` | Issues no session on success. |
| 23 | Auth: Account setup | `Auth Account Setup.dc.html` | `auth-core-contract-pack.md` | First-password flow for a new purchase; double entitlement gate. |
| 24 | Auth: Sign-in help | `Auth Sign-In Help.dc.html` | `auth-core-contract-pack.md` | Locked-out ticket flow; only ever attaches real sign-in history, never fabricated rows. |

## A note on "contract packs"

Most of the `docs/*-contract-pack.md` files are not design specs written for this handoff — they're extraction documents built by reading the actual backend (routes, schema, live queries) and citing file:line for every field and state claim. Treat them as the ground truth for:

- exact request/response shapes
- every real error/edge state (not just the happy path)
- which capabilities are genuinely live vs. stubbed vs. not built
- "honest-empty" contracts — cases where the correct UI is an explicit empty/can't-read state rather than a zero or a guess

Two packs are flagged as stale in `github.md`: `change-control-contract-pack.md` (the pack was deleted upstream after the underlying code grew past it — the screen was left as-is and should be re-verified against source before a rebuild) and `microsoft-changes` (no pack exists; the screen was built from a design brief).

## Shared design tokens

These apply across all 24 screens (the shell defines the chrome every module sits inside).

**Colors**
- Canvas `#020617`; panel surfaces `rgba(255,255,255,.02)`; hairlines `rgba(255,255,255,.06–.10)`; hover overlay `rgba(255,255,255,.04)`; active overlay `rgba(255,255,255,.06)`.
- Brand: Deep Navy `#0A2540`, Electric Blue `#0078D4` (pressed `#005A9E`), Bright Teal `#00B4D8`.
- Text: primary `#f8fafc`, secondary `#cbd5e1`, tertiary `#94a3b8`, muted `#64748b`, faint `#475569`, faintest `#334155`.
- Semantic: success `#34d399`, caution `#c2a63d` / `#fbbf24`, danger `#f87171` (soft `#fca5a5`), info `#60a5fa` (soft `#93c5fd`).
- Pillar colors: Governance `#3B82F6`, Security `#8B5CF6`, Compliance `#F3F4F6`, Licensing `#14B8A6`, Adoption `#F97316`, Health `#22C55E`.

**Type** — Inter throughout, weights 400–800, tight tracking on headings, tabular numerals on every number. Scale runs from 30/800 (score display) down to 9.5/700 (pill labels); see `screens/Shell.dc.html` region comments for the full ramp. Menlo monospace only for codes/JSON.

**Spacing** — 4px base unit. Card padding 13–20px; row padding 6–9px vertical; section gaps 8–16px.

**Radii** — 6px controls/nav rows, 8–9px menu rows, 12–14px cards/popovers, 999px pills/dots/bars.

**Elevation** — borders do the separation work, not shadows. Popovers and slide-in panels carry one soft dark shadow; nothing else does.

**Motion** — color/background transitions 150–300ms; progress-bar fills 400ms ease; panel slide-ins ~260ms `cubic-bezier(.4,0,.2,1)`; ambient severity washes ~1800ms. No bounce, no parallax.

## Shared UI patterns

- **Right-slide detail panel** — one shared panel design used across the shell for every contextual detail (scan logs, export requests, etc). Desktop: fixed-width panel sliding from the right edge. Below ~760px viewport width it becomes a bottom sheet.
- **Real-response-state switcher** — several screens (all six Auth screens, and others) expose a control that switches between every real state the underlying endpoint can return. This is documentation-in-the-design, not a feature to ship — but every state it shows must be a state your implementation actually handles.
- **Honest-empty states** — a recurring, deliberate pattern: when data genuinely can't be read or doesn't exist yet, screens say so explicitly rather than showing a fabricated zero, blank chart, or generic error. Contract packs call this out per-field; preserve it.
- **Settings as a shared container** — Settings is shell-owned, not a module page. Each module contributes its own nav group + item to one settings shell (see `Configuration State.dc.html` and `Shell.dc.html`).

## Interactions & behavior (shell-level, applies everywhere)

- One popover/panel open at a time; a click-catching overlay closes it.
- Selecting a pillar tab or sidebar item switches the content slot and closes any open popover.
- Every popover trigger, nav row, and panel control is a real focusable element with a visible `#0078D4` focus ring.
- Below 760px viewport width, side panels become bottom sheets and the pillar tab strip scrolls horizontally instead of wrapping.

## Assets

No external image assets — the design uses Lucide icons (stroke style, 2px weight) throughout, and a text-based "SM" brand mark (gradient tile, Electric Blue → Bright Teal). No custom illustration or photography.

## Files in this package

- `screens/*.dc.html` — the 24 design references (see inventory above).
- `screens/support.js` — runtime dependency for the reference files inside the design tool. Not something to port.
- `screenshots/*.png` — one representative screenshot per screen, numbered to match the inventory table.
- `docs/*-contract-pack.md` — backend-grounded extraction packs, one per module (see note above).

## Out of scope

- The MSP-side console (internal ops tool) — a separate, unbuilt surface referenced in some contract packs.
- Any module named in `docs/` without a matching screen here has no design yet.
- Marketing website — a separate, dark-themed public site, not part of this authenticated-portal package.

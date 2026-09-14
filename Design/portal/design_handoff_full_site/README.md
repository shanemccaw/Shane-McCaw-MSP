# Handoff: Shane McCaw Consulting — Customer Portal (full site)

## Overview

This package covers the **entire authenticated customer portal** for Shane McCaw Consulting, an M365 governance SaaS: the app shell/chrome, every module screen inside it, the six pre-auth screens in front of it, and a mobile layout reference. **44 screens in total**, listed below. This is the single, up-to-date handoff package — it supersedes and folds in every earlier incremental package built in this project (full-site, last-updates, portal-modules-and-mobile, billing-roles-and-new-modules).

## About the design files

Everything under `screens/` is a **design reference written in HTML** — a working prototype of intended look and behavior, not production code to copy directly. The real product is **React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york" style) + Lucide icons**. Your task is to **recreate these designs in that stack** (or the target codebase's existing environment, if different), using its established components and patterns — not to ship the HTML files as-is.

Each reference file loads a design-system bundle from a relative `_ds/...` path and some load `support.js` / `ios-frame.jsx`. Those only resolve inside the design tool; ignore them and build from the token values and component notes below, the screenshots, and each screen's contract pack.

Most screens include a **"real response state" / `scene` switcher** at the top (visible in several screenshots, e.g. Auth Sign-In's `401 invalid credentials` / `423 account locked` / `200 mfaRequired` pills, or POA&Ms' `live` / `empty` / `tier-gated` / `failed`). These are not decorative — they enumerate every real state the backend can actually return for that screen, extracted from source. **Build the UI to handle every state shown, not just the default.**

Most screens also end with a **"What this page deliberately does not do" ledger**, citing contract-pack sections. Treat these as part of the design spec, not footnotes — they call out gaps, known limits, and "honest empty" states you must not silently "fix" by inventing data.

## Fidelity

**High fidelity.** Colors, type, spacing, copy, and states are exact values taken from the reference files and the contract packs in `docs/`. Recreate them precisely using the codebase's existing primitives (shadcn `Button`, `Card`, `Badge`, `Input`, `Sheet`, `Sidebar`, etc.) where they can carry these values.

## How this package is organized

- **`screens/`** — the 44 `.dc.html` design files, one per screen, plus `ShaneBot Card Gallery.dc.html` (all of ShaneBot's card templates in one reference sheet) and `support.js` / `ios-frame.jsx` (runtime dependencies for the design tool — not something you build).
- **`screenshots/`** — one image per screen, numbered to match the inventory table below.
- **`docs/`** — contract-pack markdown files. These are backend-extraction documents: for most modules, a pack traces every field and state shown on that screen back to the real API route and database schema (file:line citations). They are the single most reliable source for exact data shapes, validation rules, error states, and "what's real vs. not built yet." **Read the relevant pack before implementing a screen.**
- **`sync-record.md`** — a copy of the project's `github.md`: the source repo, the full sync history, and a table mapping every screen to the exact repo files it was built from.

## Screen inventory

| # | Screen | File | Contract pack | Notes |
|---|---|---|---|---|
| 01 | App shell | `Shell.dc.html` | — | Top bar, six-pillar tab strip, sidebar nav (incl. POA&Ms, Status reports, Projects), Tenant Status card + live scan, popovers, right-slide panel, ShaneBot dock, module-grouped Settings container (now incl. a Departments tab). Every other screen mounts inside its content slot. |
| 02 | Overview | `Overview.dc.html` | `customer-home-and-timeline-contract-pack.md` | Home dashboard: engine scores, priority items, activity timeline, cross-module roll-up counts (`overviewCounts`). |
| 03 | Microsoft Changes | `Microsoft Changes.dc.html` | `microsoft-changes-contract-pack.md` | Message-center change feed. |
| 04 | Change Control | `Change Control.dc.html` | `change-control-contract-pack.md` | Change requests, approvals, freeze calendar, standard-change catalogue, maintenance windows, dependencies, metrics. |
| 05 | Risk Register | `Risk Register.dc.html` | `risk-register-contract-pack.md` | Risk lifecycle, likelihood/impact heat map, role-gated acceptance signatures. |
| 06 | Remediation Tracking | `Remediation Tracking.dc.html` | `remediation-tracking-contract-pack.md` | Findings checklist + 28-step programme + verification/decline-to-risk flows. |
| 07 | SOPs | `SOPs.dc.html` | `sops-contract-pack.md` | SOP library, per-tenant custom steps, run queue and history. |
| 08 | Ownership / RACI | `Ownership RACI.dc.html` | `ownership-raci-contract-pack.md` | Role assignment matrix, decline flow, per-cell history, tier gate. |
| 09 | Policy Decisions | `Policy Decisions.dc.html` | `policy-decisions-contract-pack.md` | Signed policy register, review cadences, typed authorities, tier-gated read. |
| 10 | Configuration State | `Configuration State.dc.html` | `configuration-state-contract-pack.md` | Tenant configuration snapshot; also defines the Settings-as-container pattern used by the shell. |
| 11 | Security Plan | `Security Plan.dc.html` | `security-plan-contract-pack.md` | Assembled/versioned/signed security plan, drift against last signed version, customer review-and-sign action. |
| 12 | Pillar pages | `Pillar Pages.dc.html` | — | The six pillar landing pages reached from the shell's tab strip. |
| 13 | Account Security | `Account Security.dc.html` | `account-security-contract-pack.md` | Password/MFA/sessions for the signed-in user, plus tenant-wide Graph security readings. |
| 14 | Billing | `Billing.dc.html` | `billing-contract-pack.md` | Receipts, plan state, Stripe billing-portal handoff. |
| 15 | Webhooks | `Webhooks.dc.html` | `webhooks-contract-pack.md` | Outbound webhook endpoints, delivery log, secret rotation. |
| 16 | Notification Preferences | `Notification Preferences.dc.html` | `notification-preferences-contract-pack.md` | 15-category in-app/email preference matrix. |
| 17 | Portal Alerts | `Portal Alerts.dc.html` | `alert_preferences.md` | Alerts dropdown + the alert-preferences settings pane. |
| 18 | ShaneBot | `ShaneBot.dc.html` | `shanebot-contract-pack.md` | Full-page support chat surface with real "Active Card" renderers (invoice, subscription, score, data-answer). |
| 18b | ShaneBot card gallery | `ShaneBot Card Gallery.dc.html` | `shanebot-contract-pack.md` | Every card ShaneBot's response engine can render, laid out side by side for template extraction: invoice, subscription, score, data-answer, and one `gen:*` template per module (Change Control, Risk Register, POA&Ms, Team, Billing, etc.) with its real copy, status tokens, and "open module" link label. Use this as the source of truth for building each card as a reusable component, then wire the response engine to pick one per `kind`. |
| 19 | Auth: Sign in | `Auth Sign-In.dc.html` | `auth-core-contract-pack.md` | |
| 20 | Auth: MFA challenge | `Auth MFA Challenge.dc.html` | `auth-core-contract-pack.md` | TOTP + emergency bypass; SMS/passkey are real backend routes with no UI wired yet. |
| 21 | Auth: Forgot password | `Auth Forgot Password.dc.html` | `auth-core-contract-pack.md` | Always responds 200 regardless of whether the email exists (enumeration resistance). |
| 22 | Auth: Reset password | `Auth Reset Password.dc.html` | `auth-core-contract-pack.md` | Issues no session on success. |
| 23 | Auth: Account setup | `Auth Account Setup.dc.html` | `auth-core-contract-pack.md` | First-password flow for a new purchase; double entitlement gate. |
| 24 | Auth: Sign-in help | `Auth Sign-In Help.dc.html` | `auth-core-contract-pack.md` | Locked-out ticket flow; only ever attaches real sign-in history. |
| 25 | Break-glass Access | `Break-glass Access.dc.html` | `break-glass-access-contract-pack.md` | Status read of a paused Config Pack run; never the credential. |
| 26 | Consent and Onboarding | `Consent and Onboarding.dc.html` | `consent-and-onboarding-contract-pack.md` | Consent-callback outcomes, staff-role interstitial, onboarding-link states. |
| 27 | Privacy and your data | `Data Rights and Privacy.dc.html` | `data-rights-and-privacy-contract-pack.md` | Data export + deletion request. |
| 28 | Diagnostics | `Diagnostics and Scripts.dc.html` | `diagnostics-and-scripts-contract-pack.md` | Latest scan findings, pillar health bars, honestly-empty scripts section. |
| 29 | Documents | `Documents.dc.html` | `documents-contract-pack.md` | Generated documents + uploaded reports, view/PDF/share gates. |
| 30 | Email authentication | `Email Authentication Setup.dc.html` | `email-authentication-setup-contract-pack.md` | SPF/DKIM/DMARC status. |
| 31 | My Architect | `My Architect.dc.html` | `my-architect-contract-pack.md` | Retainer hours, work log, sent status reports. |
| 32 | Leaving (offboarding) | `Offboarding.dc.html` | `offboarding-contract-pack.md` | Offboard/export request. |
| 33 | Offers + SOW | `Offers and SOW Acceptance.dc.html` | `offers-and-sow-acceptance-contract-pack.md` | Sales offers, SOW review/sign, scope-aware pricing. |
| 34 | Public share pages | `Public Share Pages.dc.html` | `public-share-pages-contract-pack.md` | Unauthenticated document/SOW viewers reached by share token. |
| 35 | Requests | `Requests and Support Chat.dc.html` | `requests-and-support-chat-contract-pack.md` | Customer request list/detail; chat surface itself is ShaneBot. |
| 36 | Resources (marketing site) | `Resources Page.dc.html` | `resources-page-contract-pack.md` | Public resources/blog page, copy verbatim from source. |
| 37 | Runbooks | `Runbooks.dc.html` | `runbooks-contract-pack.md` | Cycle model, run history, hold-window decisions. |
| 38 | Service and scope | `Scope and SLA.dc.html` | `scope-and-sla-contract-pack.md` | SLA + scope-creep readings, drawn with an honest empty-set caveat. |
| 39 | MSP signup / agreement / invite | `Signup Agreement and Invite.dc.html` | `signup-agreement-and-invite-contract-pack.md` | Tier signup, platform agreement acceptance, staff invite links. |
| 40 | Team | `Team Management.dc.html` | `team-management-and-invitations-contract-pack.md` | Roster, invites, Customer Admin / Billing role grants. |
| 41 | POA&Ms | `POAMs.dc.html` | `poams-contract-pack.md` | Plans of action & milestones; signature ceremony; tier-gated (402) on every real tenant today. |
| 42 | Status reports | `Status Reports.dc.html` | `status-reports-portal-contract-pack.md` | Published MSP-console status reports + two-sided comment thread. |
| 43 | Projects | `Projects.dc.html` | `projects-contract-pack.md` | Single customer project by id (no list route); five-column kanban board. |
| 44 | Mobile preview | `Mobile Preview.dc.html` | — | The shell + Resources + sign-in rendered at 390×844: sidebar-as-drawer, stacked settings, clamped popovers. |

## A note on "contract packs"

Most `docs/*-contract-pack.md` files are not design specs written for this handoff — they're extraction documents built by reading the actual backend (routes, schema, live queries) and citing file:line for every field and state claim. Treat them as ground truth for exact request/response shapes, every real error/edge state, which capabilities are genuinely live vs. stubbed vs. not built, and "honest-empty" contracts (cases where the correct UI is an explicit empty/can't-read state rather than a zero or a guess).

Every contract pack under the source repo's `docs/portal/` has a screen in this package — including POA&Ms, Projects, and Status Reports, which were built ahead of their nominal milestone per a standing instruction: every portal pack gets a screen regardless of any "deferred" note inside it.

Two known staleness notes carried from the project's sync history: the held `change-control-contract-pack.md` was regenerated after the original was deleted upstream (now current); `security-plan-contract-pack.md` is missing the `GET /api/portal/security-plan/drift` route (#3027) that the screen's "Changes since signing" section already draws correctly.

## Shared design tokens

These apply across all 44 screens (the shell defines the chrome every module sits inside).

**Colors**
- Canvas `#020617`; panel surfaces `rgba(255,255,255,.02)`; hairlines `rgba(255,255,255,.06–.10)`; hover overlay `rgba(255,255,255,.04)`; active overlay `rgba(255,255,255,.06)`.
- Brand: Deep Navy `#0A2540`, Electric Blue `#0078D4` (pressed `#005A9E`), Bright Teal `#00B4D8`.
- Text: primary `#f8fafc`, secondary `#cbd5e1` (`#e2e8f0` on some screens), tertiary `#94a3b8`, muted `#64748b`, faint `#475569`, faintest `#334155`.
- Semantic: success `#34d399`, caution `#fbbf24` (note text `#c2a63d`), danger `#f87171` (button `#dc2626`), info `#60a5fa` (soft `#93c5fd`), violet `#a78bfa`.
- Pillar colors: Governance `#3B82F6`, Security `#8B5CF6`, Compliance `#F3F4F6`, Licensing `#14B8A6`, Adoption `#F97316`, Health `#22C55E`.

**Type** — Inter throughout, weights 400–800, tight tracking on headings (`-0.01em`/`-0.02em`), tabular numerals on every number. Page titles 20px/700; card titles 13.5px/600; body 12–12.5px at line-height 1.55–1.6; micro-labels/eyebrows 9–9.5px/700 uppercase, wide tracking. Menlo/`ui-monospace` only for codes, ids, and reference numbers.

**Spacing** — 4px base unit. Card padding 13–20px; row padding 6–11px vertical; section gaps 8–16px.

**Radii** — 6px controls/nav rows/inputs, 8–12px menu rows/inner tiles, 12–16px cards/popovers/modals, 999px pills/dots/bars.

**Elevation** — borders do the separation work, not shadows. Popovers, slide-in panels, drawers, and modals carry one soft dark shadow; nothing else does.

**Motion** — color/background transitions 150–300ms; progress-bar fills 400ms ease; panel slide-ins ~260ms `cubic-bezier(.4,0,.2,1)`; spinners `spin .9s linear`; ambient severity washes ~1800ms. No bounce, no parallax.

## Shared UI patterns

- **Right-slide detail panel** — one shared panel design used across the shell for every contextual detail (scan logs, export requests, role-grant confirms, etc). Desktop: fixed-width panel sliding from the right edge. Below ~760px viewport width it becomes a bottom sheet.
- **Real-response-state / `scene` switcher** — most screens expose a control that switches between every real state the underlying endpoint can return. This is documentation-in-the-design, not a feature to ship — but every state it shows must be a state your implementation actually handles.
- **Honest-empty states** — a recurring, deliberate pattern: when data genuinely can't be read, doesn't exist yet, or the tenant isn't entitled, screens say so explicitly rather than showing a fabricated zero, blank chart, or generic error. Real-zero, cannot-read, and not-entitled are drawn as three different states with three different treatments.
- **Point-in-time authority** — decisions that require an "Accountable" or authorizing role (Risk Register, POA&Ms, Team Management) show the holder as it was at the time of the action, never re-derived from today's org chart.
- **"What this page deliberately does not do" ledger** — a closing section on most screens, each row citing the contract-pack section it comes from. Part of the design; don't "fix" the gaps it names without checking the pack.
- **Settings as a shared container** — Settings is shell-owned, not a module page. Each module (incl. the new Departments tab) contributes its own nav group + item to one settings shell.

## Interactions & behavior (shell-level, applies everywhere)

- One popover/panel open at a time; a click-catching overlay closes it.
- Selecting a pillar tab or sidebar item switches the content slot and closes any open popover.
- Every popover trigger, nav row, and panel control is a real focusable element with a visible `#0078D4` focus ring.
- Below 760px viewport width, the sidebar becomes a drawer behind a header menu button, side panels become bottom sheets, settings stack, and popovers clamp to the viewport (see `Mobile Preview.dc.html`).

## Assets

No external image assets — the design uses Lucide icons (stroke style, 1.75–2px weight) throughout, and a text-based "SM" brand mark (gradient tile, Electric Blue → Bright Teal). No custom illustration or photography.

## Out of scope

- The MSP-side console (internal ops tool) and MSP-side halves of hybrid modules (e.g. `msp-poams.ts` cancel/convert/milestones, MSP-side projects admin, `msp-status-reports.ts` comment routes, the break-glass operator watchlist) — separate, unbuilt-here surfaces.
- Marketing website beyond the one Resources page included here — a separate, dark-themed public site.
- Any module named in the repo's `docs/msp-console/` or `docs/buildconsole/` trees — MSP-operator and build-console surfaces, not customer-portal screens.

# Handoff: Customer Portal — last set of updates (2026-09-06 → 2026-09-09)

## Overview

This is an **incremental** package, not the whole portal. It carries the six customer-portal screens that changed in the last two sync rounds against the source repository (`shanemccaw/Shane-McCaw-MSP`, branch `main`), plus the contract packs and the sync record behind those changes.

If you need the complete portal (24 screens, shell chrome, shared tokens and patterns), use `design_handoff_full_site/` — this package assumes that one has already landed and only describes what moved since.

| # | Screen | File | Screenshot | Contract pack |
|---|---|---|---|---|
| 01 | Overview | `screens/Overview.dc.html` | `screenshots/01-overview.png` | `docs/customer-home-and-timeline-contract-pack.md` |
| 02 | Change Control | `screens/Change Control.dc.html` | `screenshots/02-change-control.png` | `docs/change-control-contract-pack.md` |
| 03 | Policy Decisions | `screens/Policy Decisions.dc.html` | `screenshots/03-policy-decisions.png` | `docs/policy-decisions-contract-pack.md` |
| 04 | Remediation Tracking | `screens/Remediation Tracking.dc.html` | `screenshots/04-remediation-tracking.png` | `docs/remediation-tracking-contract-pack.md` |
| 05 | Ownership / RACI | `screens/Ownership RACI.dc.html` | `screenshots/05-ownership-raci.png` | `docs/ownership-raci-contract-pack.md` |
| 06 | Security Plan | `screens/Security Plan.dc.html` | `screenshots/06-security-plan.png` | `docs/security-plan-contract-pack.md` |

Security Plan is included for reference only — its design did not change this round; one route behind it did (see the update log).

## About the design files

Everything under `screens/` is a **design reference written in HTML** — a working prototype of intended look and behavior, not production code to copy. The real product is **React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york") + Lucide icons**. Recreate these designs in that stack using its existing components and patterns; do not ship the HTML.

The reference files load a design-system bundle from a relative `_ds/...` path and `support.js`. Those resolve only inside the design tool — ignore them and build from the token values below, the screenshots, and each screen's contract pack.

Several screens carry a **state switcher** at the top. It is documentation-in-the-design: it enumerates every real state the underlying route can return. Every state it shows must be a state your implementation actually handles.

## Fidelity

**High fidelity.** Colors, type, spacing, and states are exact values from the reference files and the contract packs.

## Update log

### Overview
- `overviewCounts` gained `raciPendingAcceptance` (#3049). The RACI count is now a real backend field scoped by `customerId`, so it still reads when `tenantScope` is null — previously it could not be answered.
- The no-scope state now zeroes six of seven counts (the RACI count survives it). Draw `no_tenant_scope` and an unentitled `change_control` add-on as first-class real-zero states, not as errors.
- Counts render as linked tiles into the owning module. No score bars anywhere — the registers do not share a scale.

### Change Control
Rebuilt against the regenerated contract pack (#2989 — the pack deleted upstream on 2026-09-03 is back and re-extracted: 2 → 14 customer routes plus a 3-route settings surface). What the screen now draws:
- **Maintenance windows** with the raise-time containment check, collision refusal, and blocked-by / blocks dependencies (#1504), drawn on a real CR-2026-116 → CR-2026-118 edge.
- **Attachments** with the four real kinds (#1503).
- **Change metrics** under the "unavailable is never zero" rule (#1506).
- **Customer settings surface**: policy switches, a live-computed approver list, and seven fixed notification rules. The per-gate switches (`gated: Record<gateKey, boolean>`) are deliberately omitted — the gate-key catalogue is not in the pack.
- **Fail-closed split**: register GETs answer empty, actions answer 409. Risk discharge happens at capture time.
- Three known upstream gaps are drawn where they bite: **#3044** (catalogue execute skips freeze/window/collision checks), **#3045** (metrics ignore PIR close codes), **#3046** (approval SLA breach is computed but never escalated).
- Stated as MSP-side only: rollback, CAB, PIR, execution. Moving a booked change has no route at all — do not build a reschedule affordance.

### Policy Decisions
Reconciled with the #1722 regeneration (which replaces the 2026-08-29 pack wholesale):
- **#1168 tier-gated read state** added — reading positions back is bundled from a higher Monitoring tier; *creating* one is never gated, and is drawn that way.
- An unresolvable tenant is drawn as a true empty, not a failure.
- Catalogue corrected to the real 8 seeded rows; PCI DSS and ISO 27001 A.5.18 are typed as certifications (ISO added).
- The customer's own authorities (insurance schedule, records schedule) are demoted to **text citations** — no route anywhere can create a tenant-authored catalogue row. Still true as of this sync: the new MSP-side `msp-policy-decisions.ts` adds no obligation-create either.
- The pack's §9 open question is answered on the page as **pick-one**: this page holds freestanding positions; risk-derived positions live on Risk Register. Nothing is merged. Treat that as this design's proposal, not a settled product decision.
- Standing policies stay off this page — they are MSP-console-operated and carry no customer authority.

### Remediation Tracking
- **#2827 closed upstream** — the checklist PUT now refuses `accepted_risk`.
- **#2869 built** — the findings checklist gained its own signed decline-to-risk action, mirroring the programme's (a repeat answers 409).
- The known-limits ledger is corrected down to one cosmetic rough edge (an export status label).

### Ownership / RACI
- **#1168 tier-not-included state** — Premier-only visibility. Writes are untouched and nothing is removed from the matrix; the state is stated in place.
- The **#1518/#1524 delegation decision** (keep as-is) is stated on the page. Decline still stops at the assigner (**#2527** — it cannot climb a management chain).
- Surfaces A and B only; C/D are not drawn.

### Security Plan (no design change)
`portal-security-plan-document.ts` gained `GET /api/portal/security-plan/drift` at **#3027** — the customer-scoped reuse of the same `computeSecurityPlanDrift` the MSP console already served. Section 7 of the screen ("Changes since signing") already drew exactly that comparison, including `hasLastSignedVersion: false` as its own never-signed state, so the route backs the section rather than changing it. **The security-plan contract pack is stale on #3027** — its route table lists only the MSP-side `/drift`. Build the customer route; trust the source over the pack here.

## Contract packs

The `docs/*-contract-pack.md` files are not design specs — they are extraction documents built by reading the actual backend (routes, schema, live queries) with file:line citations for every field and state claim. Treat them as ground truth for:
- exact request/response shapes
- every real error/edge state, not just the happy path
- which capabilities are live vs. stubbed vs. not built
- **honest-empty contracts** — where the correct UI is an explicit empty or cannot-read state rather than a zero or a guess

`sync-record.md` (a copy of the project's `github.md`) records which repo files each screen was built from, the full sync history, and the open gaps carried on each screen.

## Design tokens (unchanged this round)

**Colors** — canvas `#020617`; panel surfaces `rgba(255,255,255,.02)`; hairlines `rgba(255,255,255,.06–.10)`; hover overlay `rgba(255,255,255,.04)`; active `rgba(255,255,255,.06)`. Brand: Deep Navy `#0A2540`, Electric Blue `#0078D4` (pressed `#005A9E`), Bright Teal `#00B4D8`. Text: `#f8fafc` / `#cbd5e1` / `#94a3b8` / `#64748b` / `#475569` / `#334155`. Semantic: success `#34d399`, caution `#c2a63d` and `#fbbf24`, danger `#f87171` (soft `#fca5a5`), info `#60a5fa` (soft `#93c5fd`).

**Type** — Inter 400–800, tight tracking on headings, tabular numerals on every number. Menlo monospace only for codes, reference IDs, and JSON.

**Spacing** — 4px base. Card padding 13–20px; row padding 6–9px vertical; section gaps 8–16px.

**Radii** — 6px controls, 8–9px menu rows, 12–14px cards and popovers, 999px pills and dots.

**Elevation** — borders separate, not shadows. Only popovers and slide-in panels carry a shadow.

**Motion** — color transitions 150–300ms; progress fills 400ms ease; panel slide-ins ~260ms `cubic-bezier(.4,0,.2,1)`. No bounce, no parallax.

## Patterns to preserve

- **Honest-empty states** — when data genuinely cannot be read or does not exist yet, say so explicitly. Never a fabricated zero, blank chart, or generic error. This is the single most load-bearing convention in these screens.
- **Real-zero vs. cannot-read vs. not-entitled** are three different states with three different treatments. The packs distinguish them per field.
- **Known-limits ledger** — most screens end with a short table of what the screen deliberately does not do, each row citing its pack section. Keep it; it is how the product states its own boundaries to the customer.
- **Signed actions are write-once** — signatures carry no expiry and no renewal, and a repeat attempt answers 409.

## Assets

No image assets. Lucide icons (stroke, 2px) throughout; the "SM" brand mark is a text tile with an Electric Blue → Bright Teal gradient.

## Out of scope

- The MSP-side console (`msp-*` routes, incl. the new `msp-policy-decisions.ts` and `msp-standing-policies.ts`) — internal ops surface, no design here.
- The 18 other screens of the portal — see `design_handoff_full_site/`.
- The public marketing site.

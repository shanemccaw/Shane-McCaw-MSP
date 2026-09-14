# Handoff: Team billing/admin roles + three new portal modules (2026-09-14)

## Overview

This is an **incremental** package on top of `design_handoff_full_site/`, `design_handoff_last_updates/`, and `design_handoff_portal_modules_and_mobile/`. It carries everything that changed in the latest sync round against `shanemccaw/Shane-McCaw-MSP` (branch `main`, tree `434a30b929b0`, 2026-09-14):

1. **Team Management** gained a Billing / Customer Admin role-grant surface.
2. **Three brand-new modules** — Projects, POA&Ms, Status Reports — built because every contract pack under the repo's `docs/portal/` gets a screen in this project regardless of its issue's milestone or any "deferred" note inside the pack (standing rule from Shane, 2026-09-14 — see `sync-record.md`). With these, all 37 portal packs now have a screen.
3. **Shell** navigation wiring for the three new modules, plus a Projects board fix (fixed five-column layout, template previews split into their own strip).

| # | Screen | File | Screenshot | Contract pack |
|---|---|---|---|---|
| 01 | Team | `screens/Team Management.dc.html` | `screenshots/01-team-management.png` | `docs/team-management-and-invitations-contract-pack.md` (#2895, #4013/#4031) |
| 02 | Projects | `screens/Projects.dc.html` | `screenshots/02-projects.png` | `docs/projects-contract-pack.md` (#1737 for #1570) |
| 03 | POA&Ms | `screens/POAMs.dc.html` | `screenshots/03-poams.png` | `docs/poams-contract-pack.md` (#4021 for #1935) |
| 04 | Status reports | `screens/Status Reports.dc.html` | `screenshots/04-status-reports.png` | `docs/status-reports-portal-contract-pack.md` (#3889 for #3435) |
| 05 | App shell (nav updated) | `screens/Shell.dc.html` | `screenshots/05-shell-nav.png` | — |

## About the design files

Everything under `screens/` is a **design reference written in HTML** — a working prototype of intended look and behavior, not production code to copy. The real product is **React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york") + Lucide icons**. Recreate these designs in that stack using its existing components — do not ship the HTML.

The reference files load a design-system bundle from a relative `_ds/...` path and `support.js`. Those resolve only inside the design tool — ignore them and build from the screenshots, the token values below, and each screen's contract pack.

Every screen carries a **`scene` / state tweak** — it enumerates the real response states the underlying route can return. Every state it shows is a state your implementation must handle; the packs give the exact HTTP status and body for each.

## Fidelity

**High fidelity.** Colors, type, spacing, copy and states are exact values from the reference files and the contract packs.

## What changed, screen by screen

### Team Management — new Billing / Customer Admin role surface (#4013 / #4031)
This was a **design gap, not a code fix**: the roster read on `main` already returns `isCustomerAdmin` / `hasBillingRole` per member (#3647), and `PATCH /portal/team/:userId/role` already takes `{ role: "customer-admin" | "billing", granted }`. The screen catches the design up to the live route:
- **Role chips** on roster rows for members holding either platform role.
- A **Roles block** on the member detail panel: Held / Not held for each of the two roles, with what each one grants spelled out — Customer Admin = `billing.view` + `billing.manage` + `team.manage` + `changes.approve` + `marketplace.browse-full`; Billing = the two billing capabilities only (per the #3629 migration).
- **Grant / remove confirm modals** that name the exact audit action and role key being written.
- A **self-revoke block** carrying the server's own refusal reason (read-only in the viewer scene).
- The **#3629 trigger fact** stated in copy: Billing is auto-granted to whoever a bill is addressed to; a manual removal stands only until the next bill re-grants it.
- **Ledger corrections**: only the two platform role keys are ever offered (any other key is a 400), the action is gated on the viewer's own live `team.manage` grant, there is no "last admin" floor, a 503 is drawn as unavailable rather than denied, and the stale "roster does not carry Reports to" line is removed (`managerUserId` has been on the wire since #3996).

### Projects — new screen
Built from the projects contract pack (#1737 for #1570) against the one real customer route, `GET /api/portal/projects/:id` (plus its `kanban-events` SSE stream — there is **no list route**, so this is a by-id page reached from a link, and the screen says so).
- Project header: type, status, free-text phase, and the admin-computed progress (`completed / total tasks`).
- Signed contract and SharePoint folder links; the coupon line drawn as **earliest-invoice-only** — the pack's own sum-vs-single finding, not a total.
- Four workflow steps on the real enum, including `blocked`.
- Five-column kanban board — the real DB enum includes `review`, which the admin route's TypeScript cast omits; `waiting_on_customer` is highlighted.
- `previewTasks` drawn as **dashed template projections** in Backlog for unseeded workflow steps — a synthetic read-only preview, not real task rows. (Screen fix folded in: these previews now sit in their own "Coming up" strip rather than living inside the Backlog column, and the board uses five fixed side-scrolling columns instead of auto-fit, which used to orphan `COMPLETED` onto a second row under 810px.)
- Project updates on the real 4-kind enum; documents; sent-only retainer status reports with a `pendingStatusReport` flag that links to My Architect.
- The **closure request (#4025) is drawn as an honest dead end**: a real request, a real email link — no customer sign-off route exists. Not a fake confirmation form.
- Scenes: live / review-pending / closure-requested / not-found (the real answer for every id today — `projects` is 0 rows, and there is no list route either) / failed.

### POA&Ms — new screen
Built from the POA&Ms pack (#4021 for #1935) plus the live `portal-poams.ts` (all 6 routes).
- Newest-first list on the real `WirePoam` shape; all six status words are the server's own, including `converted_to_risk_acceptance` and `cancelled` as MSP-side finals and `completed` explained as **never written by any route**.
- Overdue is derived only for active plans / pending milestones. Live target date vs. the write-once original date, shown together. Current Accountable holder shown beside the point-in-time "backed at signing" block.
- Milestones are read-only. Signature ceremony: typed full name + a literal-true checkbox, gated by the #1511 role check (holder / 403 not-holder / 409 no-holder — `signerRole` tweak covers all three).
- Soft delete always requires a reason; a UI-only warn-then-type-the-code confirmation ladder is labelled as UI-only (#1696/#1704). Acceleration requests are drawn as a queued operator review, not an instant action.
- Customer create form: scope is server-derived, the reference code is server-assigned, and every new plan starts `pending_signature`.
- **Pack correction folded in**: §7.1 of the held pack says `signed.authorizedBy` is always null on read — that's now fixed on `main` (`resolveRiskAuthoritiesBatch` / `resolveAuthorizedByAsOf` feed a 4th argument into `toWirePoam`). The screen draws the replayed point-in-time holder on every read and states in its ledger that the pack is behind the code on this point.
- Scenes: live / empty / tier-gated (**402 — the current state for every real tenant**, drawn with the honest "you can raise a plan anyway, you just can't read it back" path) / failed.

### Status Reports — new screen
Built from the status-reports portal pack (#3889 for #3435) plus the live `portal-status-reports.ts` (4 routes, matches the pack exactly).
- Published-only list, newest-period-first (a late-entered report sorts by its period, not its entry date).
- Report detail on the narrowed customer wire shape (`reportToWire`) — no `state`, `customerId`, or `authoredByUserId` leak to the client. `authoredByName: null` is drawn as "Unknown operator", not hidden.
- Two-sided comment thread, oldest-first, with `authorType` chips distinguishing customer vs. operator. Composer enforces the real 1–10,000 character body rule; a successful post is a 201 append; a failed post (500 "Failed to add comment") is its own scene (`commentOutcome` tweak).
- 404 is drawn as **one indistinguishable answer** for a foreign report, a draft report, or an unknown id — the route gives the client no way to tell them apart.
- Ledger disambiguates §0 of the pack: this is **not** the retainer status-reports card on My Architect (a different table, `status_reports` vs. `msp_status_reports`) — and states the §1.4 finding that customer→operator comment notification is unverified live (the screen only claims the comment was recorded, not that anyone was told).

### Shell — navigation wiring
Sidebar gained three new items: **POA&Ms** (after Risk Register), **Status reports** (after My Architect), **Projects** (after Offers). Header titles, page flags and mounts added for all three.

## Contract packs

The `docs/*-contract-pack.md` files are backend-extraction documents (routes, schema, live queries, file:line citations) — ground truth for exact request/response shapes, every real error/edge state, and what's live vs. stubbed vs. not built. `sync-record.md` is a copy of the project's `github.md`: full sync history, screen-to-repo-file map, and every open gap carried on each screen.

## Design tokens (unchanged)

**Colors** — canvas `#020617`; panel surfaces `rgba(255,255,255,.02)`; hairlines `rgba(255,255,255,.06–.10)`; hover overlay `rgba(255,255,255,.04)`; active `rgba(255,255,255,.06)`. Brand: Deep Navy `#0A2540`, Electric Blue `#0078D4` (pressed `#005A9E`), Bright Teal `#00B4D8`. Text: `#f8fafc` / `#e2e8f0` / `#cbd5e1` / `#94a3b8` / `#64748b` / `#475569` / `#334155`. Semantic: success `#34d399`, caution `#fbbf24` (note text `#c2a63d`), danger `#f87171` (button `#dc2626`), info `#60a5fa`, violet `#a78bfa`.

**Type** — Inter 400–800; page titles 20px/700 `-0.01em`; card titles 13.5px/600; body 12–12.5px, line-height 1.55–1.6; micro-labels 9px/700 uppercase `.09em`; tabular numerals on every number. `ui-monospace, Menlo` only for ids, codes, and reference numbers.

**Spacing** — 4px base. Card padding 15–20px; row padding 9–11px vertical; section gap 16px.

**Radii** — 6px controls/inputs, 10–12px inner tiles/notices, 14px cards, 16px modals, 999px pills.

**Elevation** — borders separate, not shadows; only drawers, popovers, panels and modals carry a shadow.

**Motion** — color transitions 150–300ms; spinners `spin .9s linear`. No bounce, no parallax.

## Patterns to preserve

- **Honest-empty states** — when data cannot be read or does not exist, say so explicitly; never a fabricated zero or generic error. Real-zero, cannot-read, and not-entitled are three different states with three different treatments (see POA&Ms' 402, Projects' 404/no-list-route, Status Reports' collapsed 404).
- **Known-limits ledger** on every screen, each row citing the pack section it comes from.
- **Point-in-time authority is never re-derived from the current org chart** — POA&Ms and Team Management both draw the holder as it was at the time of an action, not who holds the role today.
- **Secrets and destructive confirmations are explicit** — Team Management's role-grant modals name the exact audit action being written.

## Assets

No image assets. Lucide icons (stroke, 1.75–2px) throughout; the "SM"/"S" brand mark is a text tile with an Electric Blue → Bright Teal gradient.

## Out of scope

- MSP-console halves of these modules (`msp-poams.ts` cancel/convert/milestones, the MSP-side projects admin routes, `msp-status-reports.ts` comment routes) — internal ops surfaces, no design here.
- Everything already covered by the three earlier handoff packages (`design_handoff_full_site/`, `design_handoff_last_updates/`, `design_handoff_portal_modules_and_mobile/`) is unchanged and not repeated here.

# Old UI Removal Plan

**Status:** Index + plan only. Nothing deleted. Per Shane's instruction — do not
execute until reviewed.

Every page under `artifacts/msp-portal/src/pages/` was checked, not assumed.
Confidence level is stated per item — do not delete anything marked
"needs investigation" without checking first.

---

## Category 1 — High confidence, safe to remove now

Self-describing as internal/preview/isolated in their own file header, or
explicitly named as a trial run:

- `dashboard-canvas-preview.tsx` — own comment: "Internal-only preview page for
  the Dashboard Web Part System's Components."
- `copilot-assessment-fluent-preview.tsx` — own comment: "ISOLATED PREVIEW
  ROUTE — #288 ... the real-Fluent-2 restyle of the [Persona screen]."
- `dashboard-designer.tsx` — needs a quick content check, but the name pattern
  matches the two above (a builder/preview tool, not a customer page).
- `overview-test.tsx` — name says test; needs a quick content check before
  confirming, but very likely another abandoned trial.
- `war-room.tsx`, `war-room-ladder.tsx`, `war-room-radar.tsx` — Shane's
  explicit named example. #1153 already removed the nav entry and router link
  (deliberately deferred full deletion). This plan is the "way later" moment
  #1153 referred to — safe to remove the actual page files and backing
  components now, since the redesign supersedes the whole concept.

## Category 2 — Old customer dashboard pages, superseded by /portal-v2

The pillar/dashboard pages this whole session spent hours fixing, now replaced
by the new design. High confidence these are superseded, but **do not delete
until the re-route (item 3) is live and confirmed working** — these are the
fallback if something's wrong with the new portal.

| Old page | New portal-v2 equivalent |
|---|---|
| `governance.tsx` | `portal-v2-governance.tsx` |
| `security-overview.tsx` (confirm vs `security.tsx` — two candidates, check which is actually routed before removing either) | `portal-v2-security.tsx` |
| `m365-health.tsx` | `portal-v2-overview.tsx` |
| `compliance.tsx` | `portal-v2-compliance.tsx` |
| `adoption.tsx` | `portal-v2-adoption.tsx` |
| `licensing.tsx` | `portal-v2-licensing.tsx` |
| `architecture.tsx` | superseded by the Health pillar (`portal-v2-health.tsx`) — confirm this file is genuinely dead and not still linked from somewhere before removing |
| `customer-home.tsx` | `portal-v2-overview.tsx` |
| `customer-diagnostics.tsx` | `portal-v2-overview.tsx` + the pillar drill-downs (this was the "wall of findings" page redesigned away) |
| `customer-timeline.tsx` | Activity Timeline, once #1159 lands in portal-v2 |
| `customer-offers.tsx` | My Offers equivalent in portal-v2 (confirm this exists in the design/build — not explicitly named in the parallel plan's 12 parts, may need a 13th part or may be folded into another page) |
| `customer-billing.tsx` | `portal-v2-billing.tsx` |
| `customer-team.tsx` / `settings-team.tsx` (confirm which is real) | Settings page in portal-v2 |
| `customer-requests.tsx` | needs a portal-v2 equivalent — the Zoho Desk ticket UI from #1158, confirm it's been ported into the new design or still needs it |
| `customer-notifications.tsx` | `portal-v2-alert-preferences.tsx` |
| `customer-privacy.tsx` / `data-rights.tsx` | `portal-v2-account-security.tsx` |
| `webhooks.tsx` (old frontend) | `portal-v2-webhooks.tsx` (real backend at `/api/portal/webhooks/*` stays — only the old frontend page is superseded) |
| `scope-creep-dashboard.tsx` | Scope indicator, now part of the redesigned shell |
| `customer-sla.tsx` / `m365-sla.tsx` / `sla-dashboard.tsx` (three candidates — confirm which is actually live before assuming all three are dead) | Service Levels equivalent in portal-v2 (confirm this has a home in the new design) |

## Category 3 — Needs real investigation before any decision

- `offboarding.tsx` — 568 lines, no preview/deprecated markers, looks like a
  genuinely real, substantial page. **Do not assume this is trial UI.** Given
  tonight's design conversation assumed Onboarding/Offboarding was mock-only
  on the MSP side, this may be a real customer-facing page that changes that
  assumption — check what it actually does before deciding whether it's
  superseded, needs porting into the new design, or was already the real
  thing all along.
- `documents.tsx` / `documents-hub.tsx` / `document-detail.tsx` /
  `customer-documents.tsx` — four candidates for what should map to one
  Document Library concept. Confirm which (if any) is the real, currently-live
  one before assuming any are dead.
- `marketplace.tsx` — the Marketplace feature itself is paused (#1148), not
  cancelled. This page likely stays as-is until that decision is revisited,
  not a removal candidate right now.
- `assessment-dashboard.tsx` — tied to open issue #1059 (drift visualization).
  Confirm whether this is old-portal-specific or part of the separate,
  still-real Copilot Readiness Assessment product line before touching it.

## Category 4 — Explicitly NOT in scope, do not touch

**Named exception, confirmed by Shane:** `pages/msp-portal.tsx` (the route at
`/portal/shane-mccaw-consulting/msp-portal`) — the MSP-internal operations
console (SOPs, Risk-Based Decisions, Change Management, ~20 sub-consoles).
This is Shane's own operations tool, not customer-facing UI, and is NOT part
of the customer portal rewrite. Do not delete or touch this page under any
part of this plan, even though some of its ~20 sub-consoles share conceptual
overlap with what the new customer portal is building (SOPs, Risk Register,
Change Control) — those are separate, real, MSP-side features Shane uses
himself, distinct from the customer-facing pages this plan covers.

Everything else in the pages directory is either the separate, real Copilot
Readiness Assessment product (`copilot-readiness*.tsx`, `copilot-assessment.tsx`,
`assessment-shell.tsx`, etc. — a different product line, not part of this
redesign), real auth/account flows (`login.tsx`, `signup.tsx`,
`reset-password.tsx`, `accept-invite.tsx`, `accept-agreement.tsx`, etc.), or
MSP-operator/admin-side pages (`customers.tsx`, `msps.tsx`, `revenue.tsx`,
`chargeback.tsx`, `dlq.tsx`, `scripts.tsx`, etc.) — none of these are customer
portal "trial UI," they're real, separate systems.

---

## Sequencing

1. Confirm Category 3's open questions first — cheap to check, and the
   answers change what Category 2's mapping table even says.
2. Complete the /portal/ re-route (item 3) and let Shane test it live.
3. Only once the new portal is confirmed working end-to-end: remove Category 1
   (already safe) and Category 2 (the old dashboard pages) together, plus the
   War Room backing components #1153 deliberately left in place.
4. Do not delete anything in Category 2 before step 2 is confirmed — these are
   the working fallback if the re-route surfaces a real problem.

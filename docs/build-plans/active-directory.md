# Initiative: Active Directory (Admin Panel)

**Slug:** active-directory
**Status:** In Progress
**Iteration:** 1
**Area:** admin-panel
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-28

## Goal
A Microsoft Active Directory-styled object browser in the Admin Panel,
under the left nav's existing "Platform" section, giving PlatformAdmin one
IDE-style surface (reusing the established `GlobalIDEShell.tsx` /
`SimulatorLeftTree.tsx` pattern) to browse and manage every real object in
the platform — MSPs, Customers, Users, and RBAC roles — as a real
directory tree, with a universal cross-property search and a detail pane
that renders full context on whatever is selected. Originates from Issue
#57 (account management) but reframed as a directory/object-browser model
rather than a flat account list.

## Scope
- **Left tree** (OU-style container nodes, matching MS AD's `OU=`
  convention visually/conceptually): `OU=MSPs` (one node per real MSP,
  `msps` table), `OU=Customers` (one node per real customer, grouped
  under their owning MSP), `Groups` (one node per RBAC role:
  PlatformAdmin/MSPAdmin/MSPOperator/CustomerUser/ServiceAccount).
  Organizational Units themselves are a placeholder object type for now
  (undefined policy semantics) — a real Phase 5 skeleton (creatable,
  browsable) with an explicit "policies not yet implemented" state.
  Future home for org-level policy/lockout controls per Shane, not built
  in this initiative.
- **Universal search**: searches across all indexed object properties
  (MSP name/slug, customer name, user name/email, role) from one search
  box, not per-object-type search boxes.
- **Middle detail pane**: renders full detail for whatever tree node is
  selected — object type determines the renderer (MSP / Customer / User
  / RBAC Group / OU).
- **MSP Object**: everything the platform holds about that MSP — profile,
  subscription/plan, customers, users, billing/dunning state, entitlements,
  agreements — read view.
- **Customer Object**: everything held about that customer — profile,
  owning MSP, linked users, tenant consent status, subscription/services,
  diagnostic run history — read view.
- **RBAC/Group Object**: every account holding that role, with its own
  search-within-members and a live member count.
- **User Object**: everything held about that account, plus full control:
  - RBAC role reassignment
  - MSP/customer reassignment
  - Service entitlement view + grant/revoke
  - Admin-triggered forced password reset
  - Admin-triggered MFA reset/un-enrollment
  - Impersonation launch into `/portal/` (reusing the existing portal
    impersonation mechanism already used elsewhere, not a new one)
  - Dev-environment-only cascading hard delete (consent + tenant
    telemetry + generated documents + everything tied to the account)
- Explicitly OUT of scope for this initiative: OU policy enforcement
  itself (placeholder only); any production-environment delete path;
  bulk/batch object operations (one object at a time for v1).

## Dependencies / Prerequisites
- Reuses `GlobalIDEShell.tsx` shell pattern and its existing
  `LS_NAV_EXPANDED`-style tree-state persistence precedent — no new IDE
  paradigm invented.
- Reuses the existing 5-role auth model / JWT claims — no auth schema
  change expected.
- Impersonation action (User Object) reuses the platform's existing
  portal-impersonation mechanism (already used by MSP-side
  impersonate-customer per `resolveCustomerPortalUserId` /
  `837ec48f`) rather than building a second one — audit at Phase-build
  time to confirm the exact reusable entry point for a PlatformAdmin
  actor.
- Credential-ops phase extends `mfa.ts`'s existing self-service
  enrollment/reset logic with an admin-initiated path, not a duplicate.
- Phase 9 (delete) requires its own live table-footprint audit at build
  time (consent, telemetry, documents, MFA enrollment, sessions) before
  any delete logic is written — not guessed here.
- Nav registration: new entry in `workspaceNav.tsx`'s existing
  `"platform"` section (`/system/platform-revenue`,
  `/system/platform-agreements`, `/system/simulator` already live there).

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | IDE shell + tree skeleton (OU containers, MSP/Customer/Group nodes) + universal search + nav registration | In Progress | #61 |
| 2 | MSP Object detail pane | Not Started | #62 |
| 3 | Customer Object detail pane | Not Started | #63 |
| 4 | RBAC/Group Object detail pane (members, search, count) | Not Started | #64 |
| 5 | Organizational Unit placeholder objects (creatable/browsable stub, no policy logic yet) | Not Started | #65 |
| 6 | User Object detail pane (full read view) | Not Started | #66 |
| 7 | User Object — RBAC + MSP/customer reassignment + entitlement grant/revoke | Not Started | #67 |
| 8 | User Object — credential ops (forced password reset + admin MFA reset) + impersonation launch into /portal/ | Not Started | #68 |
| 9 | User Object — dev-only cascading hard delete | Not Started | #69 |

## Notes
Phase count/order may change (decimal insertion, e.g. 2.5, if a phase
splits mid-build). This table is the index only — full spec per phase
lives in that phase's GitHub issue. This file is the source of truth;
the GitHub Issue/Project card is a derived view. If they ever disagree,
this file wins and the Issue gets corrected to match it.

Phase 9 is the highest-risk phase in this initiative — a genuinely wrong
cascading delete is unrecoverable data loss. Its GitHub issue must itemize
every table touched (found via a live audit at build time) and the exact
server-side non-production check, before any implementation prompt for
that phase is generated.

Supersedes the earlier `account-management` plan draft (same day,
2026-07-28, never committed/issued) — Shane reframed the request from a
flat account-management list into this AD-styled object browser before
any issues were created, so there is no prior-phase cleanup needed.

Audited against existing code before drafting (2026-07-28): no
`admin-users`/`admin-accounts`/directory route or page exists today.
`GlobalIDEShell.tsx` and the Simulator Studio tree pattern
(`SimulatorLeftTree.tsx`) are the confirmed reusable shell. `mfa.ts` is
self-service/`requireAuth`-only (no admin-reset path yet). The
"platform" nav section in `workspaceNav.tsx` (lines ~193-200) is the
confirmed real registration point.

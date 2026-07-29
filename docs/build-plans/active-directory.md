# Initiative: Active Directory (Admin Panel)

**Slug:** active-directory
**Status:** Done — all 10 phases landed and verified, initiative complete (2026-07-29)
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
| 1 | IDE shell + tree skeleton (OU containers, MSP/Customer/Group nodes) + universal search + nav registration | Done | #61 |
| 2 | MSP Object detail pane | Done | #62 |
| 3 | Customer Object detail pane | Done | #63 |
| 4 | RBAC/Group Object detail pane (members, search, count) | Done | #64 |
| 5 | Organizational Unit placeholder objects (creatable/browsable stub, no policy logic yet) | Done | #65 |
| 6 | User Object detail pane (full read view) | Done | #66 |
| 7 | User Object — RBAC + MSP/customer reassignment + entitlement grant/revoke | Done | #67 |
| 8 | User Object — credential ops (forced password reset + admin MFA reset) + impersonation launch into /portal/ | Done | #68 |
| 9 | User Object — dev-only cascading hard delete | Done | #69 |
| 10 | Tree relabel to Tenant + nested Users + Tenant admin actions (consent revoke, scores, telemetry) | Done | #91 |

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


Phase 10 was added mid-build (2026-07-28), after Shane used the initiative
for a session and wanted: the tree's "Customer" nodes relabeled "Tenant"
(display label only — the internal object-type identifier stays
"customer" to avoid colliding with Phases 7/8, which were actively
wiring against that type at the time this phase was scoped), real Users
nested as tree children under each Tenant (not just a linked list inside
the Tenant pane), and three new Tenant-level admin actions on top of
Phase 3's existing consent/telemetry summary: Graph consent revoke
(reuses the existing PATCH /api/admin/consent/:tenantId/revoke — already
built, admin-gated, audit-logged elsewhere in the platform), a live
pillar-score display (reuses the existing GET
/admin/signal-rules/customer-pillar-scores/:customerId), and a tenant
telemetry view (reuses the existing tenant_monitor_profiles read pattern
from admin-monitor-checks.ts). Also adds SharePoint consent revoke, a
manual scan trigger, and a re-consent invite-link generator, all
confirmed to have existing reusable backend mechanisms rather than being
built from scratch. Depends on Phase 3 (Done) for the pane it extends.


**Phase 9 is BLOCKED (2026-07-28) by the same Issue #92 refactor, which has
now PARTIALLY LANDED on main** (commit `91b1c8b9` "Tenant/User Refactor
Phase 0: Schema + wipe", merged via `e654d547`). A Phase 9 build session
started, ran the mandatory pre-delete table-footprint audit, and stopped at
the audit stage per this phase's own stop-don't-guess rule, because the
schema the cascade must be audited against changed out from under the spec:
`msp_users`, `msp_customers`, `tenant_consent`, `tenant_write_consent`, and
`tenant_sharepoint_consent` no longer exist in `lib/db/src/schema` —
msp_users was absorbed into a single expanded `users` table, and consent is
now a `jsonb` column on the new `tenants` table. Issue #69's candidate table
list is therefore stale, and `admin-active-directory.ts` (Phases 1–8) itself
still imports the dropped tables — it currently typechecks ONLY because the
built declarations in `lib/db/dist` are stale and still declare them; a
decls rebuild will surface the breakage across the whole api-server. Phase 9
must be re-scoped and its table-footprint audit re-run from scratch against
#92's final schema, after the Phases 1–8 surface has been migrated to it.
Do not build the cascade against either schema until then — the live DB's
actual state cannot be verified from a Claude Code session (no DB access),
and a wrong guess here is unrecoverable data loss.

**Phase 10 is BLOCKED (2026-07-28) by Issue #92** ("Fix database to
have a true Tenant Customer hierarchy") in a separate initiative,
opened after Shane took the Tenant/User data model refactor proposal
(see that chat's handoff document) to a dedicated session. Phase 10's
own scope — a real Tenant hierarchy with nested Users — is exactly what
#92's schema refactor (new `tenants` table, single expanded `users`
table) makes possible correctly. Do not build Phase 10 against the
current `msp_customers`/`msp_users`/loose-string-`tenant_id` schema; it
would need a rewrite the moment #92 lands. Phase 10's issue body still
references the pre-refactor schema and must be re-scoped against #92's
real final shape before any implementation prompt is written for it.


**Phase 10 UNBLOCKED (2026-07-28)** — #92 (tenant/user data model
refactor) and all sub-issues closed and verified against real code
(real `tenants` table, single `users` table, `mspCustomersTable`/
`mspUsersTable` genuinely gone, AD's own route file already cut over).
Phase 3 of that refactor (#96) was a straight table-swap only — the AD
tree/pane still need Phase 10's actual work (relabel, nested Users,
revoke/scores/telemetry actions), unchanged in substance. See the
amendment comment on #91 for corrected mechanism references (consent
revoke is now one route covering Graph+SharePoint via a key param, not
two separate mechanisms as originally scoped). Ready to build.

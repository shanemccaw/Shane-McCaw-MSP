# Settings — consolidating contract pack for the single-page design

**Issue:** `#4057`, part of `#1596` (Feature: Settings (Portal)), part of `#1485` (EPIC: Portal).
Answers `#1596`'s own 2026-09-14 real decision: *"The target is a real, single, consolidated
Settings page holding: Change control policy, Departments, Ownership routing/People & roles,
Alert preferences, and the 'Your data'/Account Security settings that currently live embedded in
their own pages."*

**Read-only build. No product code, schema, or UI was changed to produce this document.** This is
a **consolidating** pack — it assembles what already exists, cited to its real source, rather than
re-deriving content that's already extracted elsewhere. `CURRENT` = serves/persists real data
today. `DECIDED` = architecture settled, not yet built, with an issue number. Anything else is an
open question, labelled as such. Real enum unions only.

---

## 0. What this pack answers, and how it's organized

`#4057`'s own real question for Design: *"One page, multiple real data sources with different
owning routes/auth scopes — state plainly whether each section is same-page-different-tab, or a
single unified fetch, and flag any real auth-scope mismatch between sections before Design assumes
a single permission gate covers the whole page."*

Answer, stated up front: **this must be same-page-different-tab (or -section), never a single
unified fetch.** Five sections, five independent routes, three different auth-scope shapes, and
one section (Ownership) gated by a **tier entitlement** none of the other four carry. A single
fetch behind one permission gate is structurally wrong here — see §6.

Five sections below, each: real endpoints, real wire shape (cited, not re-derived, where a current
pack already covers it), CURRENT/DECIDED status, and its own auth-scope statement. §6 is the
cross-section auth-scope comparison Design needs before assuming anything. §7 lists findings filed
at pack time.

---

## 1. Departments

**Fully extracted in `docs/portal/settings-contract-pack.md` §1-2 (#1734) — cited, not
re-derived.** Summary for this pack's purpose:

- `GET`/`PUT`/`DELETE /api/portal/settings/departments(/:name/mapping)`
  (`artifacts/api-server/src/routes/portal-settings-departments.ts`), all `requireCapability(
  "ladder.customer-user")`.
- Backend `CURRENT`, schema `portal_department_mappings` (`lib/db/src/schema/msp.ts:8566-8582`).
- **Zero page consumers today anywhere in `artifacts/portal/src`** — filed as `#4051`, parented to
  `#1596`. This consolidated Settings page is the page that closes that gap; per `#1596`'s own
  2026-09-14 decision, Departments should **not** get a standalone page of its own — it belongs as
  one section of this one.
- Known open gap: no live Microsoft Graph security-group-membership read corrects a group-mapped
  department's headcount — filed as `#4053`, parented to `#1596`. Real, current, not blocking.

---

## 2. Change Control policy

**Fully extracted in `docs/portal/settings-contract-pack.md` §3 (#1734) — cited, not re-derived.**
Summary:

- `GET /api/portal/settings/change-control`, `PUT .../policy`, `PUT
  .../notifications/:eventKey` (`artifacts/api-server/src/routes/portal-settings-change-control.ts`),
  all `requireCapability("ladder.customer-user")`.
- Backend `CURRENT` and **already has a real page consumer** —
  `artifacts/portal/src/components/change-control/PolicySection.tsx` renders it inside
  `/change-control` today (`data-testid="change-control-policy"`, landed by `#1717`).
- Fields: `on`, `gated` (per-`CcGateKey`), `approvals`, `separate`, `freeze`
  (`enforceFreezeCalendar`), `maintenanceWindows` (`enforceMaintenanceWindows`, added by `#1717`,
  enforced by the `#3044` catalog-execute gate), `emergency`. Full per-field enforcement mapping
  and real enum unions are in the cited pack — not repeated here to avoid a second copy that can
  drift.
- **`docs/portal/change-control-contract-pack.md` §10 is stale** on this exact surface (says "no
  page imports the hook yet," omits `maintenanceWindows`) — filed as `#4052`, parented to `#1486`
  (Change Control's own Feature). **As of this pack's writing (2026-09-14), `#4052` is still
  OPEN — the correction has not landed.** Cited honestly: `change-control-contract-pack.md` §10
  should not be trusted for this surface until `#4052` closes; `settings-contract-pack.md` §3 (and
  this section, which mirrors it) is the current-against-`main` source in the meantime.

**Real consolidation question this raises:** Change Control's policy panel already lives inside
`/change-control` itself, not floating free. Consolidating it into the Settings page means either
(a) it moves out of `/change-control` entirely, or (b) it stays there AND appears in Settings
(duplicate mount of the same live hook, not a duplicate of data — `useChangeControlSettingsLive()`
is safe to mount twice, it owns no write-lock). `#1596`'s body doesn't resolve which; flagged as a
real product decision for Shane, not something this pack settles.

---

## 3. Ownership routing / People & roles

**No standalone contract pack file — extracted directly from route source for this pack**, since
`docs/portal/ownership-raci-contract-pack.md` documents Ownership/RACI's matrix surfaces (A-D) for
`#1491`/`#1686`, and only touches the two **Settings-owned** sub-surfaces (E/F) in passing (its
§4 "Cross-surface edges"). E/F are what this Settings page actually needs — extracted in full
below, cited to file:line, verified against `main` this session.

**Correction to `#1596`'s own body:** the hook names it cites (`usePortalV2OwnershipObjects` /
`usePortalV2People`) do not exist in the current codebase — those were portal-v2-era names, and
`artifacts/msp-portal`/portal-v2 was retired wholesale in `f40438cdc`. The real, current
equivalent is `GET /api/portal/ownership`'s `people`/`objects` fields (surface A, below) — cited
honestly here rather than repeating a stale hook name.

### 3a. Surface E — the acceptance-gate toggle

`GET`/`PUT /api/portal/settings/ownership(/policy)`
(`artifacts/api-server/src/routes/portal-settings-ownership.ts:54-110`), `requireCapability(
"ladder.customer-user")`. Scoped by `resolveCustomerId(req)` off the JWT (`:58`, `:82`) — same
customer-scoped era of table as Departments/Change Control.

| Field | Type | Nullability | Marker | Source |
|---|---|---|---|---|
| `gateMode` | `"strict" \| "loose"` | never null | **CURRENT** | `:65-67` (GET), `:88-101` (PUT) |

**Default: no saved row = `"loose"`** (`DEFAULT_OWNERSHIP_GATE_MODE`, route header `:24-27`) —
"the behaviour every existing customer already has today," not a guess. `"strict"` = every A/R
cell must be accepted before it counts (`#1518`'s original behaviour); `"loose"` = an assignment is
effective immediately, no acceptance step. Read by the assign/accept/decline routes in
`portal-ownership.ts` and the symmetric MSP-side `msp-ownership.ts`, via the shared
`lib/portal-ownership-policy.ts` lookup — per `ownership-raci-contract-pack.md` §4's "Settings→
matrix edges": `gateMode` gates `initialAcceptance` and `actorMayRespond` on **both** the
customer-side (A/B) and MSP-side (C/D) routes, one lookup, read fresh per request, no caching.

**Real, live, backend-complete. No page consumer anywhere** — the route's own header states this
outright (`:19-22`): *"Wire contract only — no customer-facing page. `Design/portal/` has no
Ownership export yet."* Confirmed: no `Design/portal/` export named Ownership or Settings exists
(§8). Not filed as a new finding — it's the same gap `#4051`/Departments already names for this
consolidated page, and `#1596`'s structured index already tracks the design commission as the
next real step.

### 3b. Surface F — per-workload RACI-membership

`GET /api/portal/settings/ownership/workloads`, `PUT .../workloads/:key`
(`portal-settings-ownership.ts:120-181`), same `requireCapability("ladder.customer-user")` /
`resolveCustomerId` scoping as 3a.

`GET` response `{ workloads: WorkloadMembershipRow[] }`
(`artifacts/api-server/src/lib/ownership-workload-membership.ts:63-68,75-103`):

| Field | Type | Nullability | Marker | Source |
|---|---|---|---|---|
| `workloadKey` | `string` | never null | **CURRENT** | `:64`, `groupEnabledServicePlansByWorkload` |
| `label` | `string` | never null | **CURRENT** | `:65` |
| `servicePlanNames` | `readonly string[]` | never null, may be `[]` | **CURRENT** | `:66` |
| `tracked` | `boolean` | never null | **CURRENT** | `:67`, default `true` (`DEFAULT_WORKLOAD_TRACKED`, `:61`) when no saved row |

**The row set is this customer's real, currently-enabled workloads** (`groupEnabledServicePlansByWorkload`
over `tenant_service_plans`, `:79-86`) — a workload with no saved membership row still appears,
defaulted `tracked: true`, "the default every customer already has" (`:71-73`). A customer with no
enabled service plans gets `workloads: []` (`:77,86`) — genuinely empty, not an error.

`PUT .../workloads/:key` body: `{ tracked: boolean }`, required (`:159-163`, 400 if not boolean).
Upserts on `(customerId, workloadKey)` (`setWorkloadTracked`, lib `:119-...`).

**What `tracked: false` actually does — and does not do**, per the lib's own header (`:1-38`,
corrected from the issue's original framing per Shane's own 2026-08-30 words, quoted verbatim in
the file): it removes the workload from the RACI accountability matrix only —
`gatherOwnershipObjects` omits it from `objects[]` (`ownership-raci-contract-pack.md` §4,
`:307-315`). **It does not touch scanning, `tenant_service_plans`, or any alert/monitor-check
evaluator** — those keep running unchanged. Untracking a still-enabled workload writes a real
`msp_diagnostic_findings` row (`checkKey: "governance:untracked-workload:<key>"`) — "disable unused
services" is itself the finding, not something this toggle silently suppresses.

**Real, live, backend-complete. No page consumer** — same scope-stop as 3a.

### 3c. The people/matrix data itself — surface A, tier-gated (real auth-scope mismatch, see §6)

If this Settings section is meant to show **who** the RACI holders are (not just the two policy
toggles above), that data comes from `GET /api/portal/ownership`'s `people`/`objects` fields
(`ownership-raci-contract-pack.md` §1a, `portal-ownership.ts:421-547`) — **not** from
`portal-settings-ownership.ts` at all. That route:

- Is `requireRole("CustomerUser")` **plus** `requireTierFeature(PORTAL_TIER_MODULE_KEYS.ownership)`
  (`portal-ownership.ts:426`, added by `#1168`) — Premier tier only, per
  `lib/db/migrations/manual/2026-09-05-portal-tier-included-features-1168.sql:52-59`
  (`ownership` is in Premier's `includedFeatures` union; absent from Foundation's and Growth's).
- This is the **one** real auth-scope mismatch `#4057` explicitly asked this pack to surface — see
  §6.

**Design must decide:** does the consolidated Settings page's Ownership section show only the two
policy toggles (3a/3b, no tier gate), or the actual people/roster list (3c, Premier-gated)? Those
are two different real answers to "what auth does this section need," and `#1596`'s body doesn't
distinguish them. Not resolved here — a real product/design decision, not a missing extraction.

---

## 4. Alert Preferences

**Real, live, backend-complete — and a genuinely different system from what `#4057`'s own
dispatch prompt named.** `#4057`'s body cites *"Alert preferences — real, shipped Feature
(#1662). Cross-reference its real contract pack/route rather than re-deriving."* **That citation
is incorrect and is corrected here, not silently followed:** `#1662` ("Feature: Notification
Preferences (Portal)") shipped `notification-preferences.ts` /
`customer_notification_preferences` — the 15-category bell/email/webhook system, live today at
`/notification-preferences` (`#2992`). That is a real, separate, already-consolidatable settings
surface (§4a) — but it is not "Alert Preferences."

**Alert Preferences is `customer_alert_preferences`** (`#1276`/`#1278`) — a genuinely different,
7-category monitoring-digest taxonomy, per the schema's own decision comment
(`lib/db/src/schema/msp.ts:8404-8411`): *"a NEW taxonomy, not folded into the existing
15-technical-category `customer_notification_preferences`... genuinely non-overlapping."*
`docs/portal/notification-preferences-contract-pack.md` §8 already documents this as a `DECIDED`
boundary. `#1596`'s architecture list names both "Alert preferences" (this one) as a section
distinct from the 15-category bell system, which is not one of the five named sections at all —
so this pack treats the bell system (§4a) as the closer match to `#1596`'s "Alert preferences" in
spirit, and documents the real `customer_alert_preferences` system (§4b) as the other real
candidate, since both are plausible readings of "Alert preferences" and only one of them was
actually shipped as a page.

### 4a. Notification Preferences (`#1662`, shipped) — cited, not re-derived

**Fully extracted in `docs/portal/notification-preferences-contract-pack.md` — cited in full, not
repeated.** Summary: `GET`/`PATCH /api/portal/notification-preferences`
(`artifacts/api-server/src/routes/notification-preferences.ts`), `requireAuth` only (**no
capability/role check** — see §6), scoped to `req.user!.id`. 15 fixed categories
(`KNOWN_CATEGORIES`), `inAppEnabled`/`emailEnabled` per category. **Live today** at
`/notification-preferences` (`#2992`) — this is real product surface, currently reachable outside
Settings. Consolidating it means either moving that page's content into Settings or leaving it
standalone and just linking it — `#1596`'s body doesn't resolve which, same open question as
Change Control (§2).

### 4b. Alert Preferences (`customer_alert_preferences`, real, live route, no page consumer)

**Backend `CURRENT`.** `GET`/`PUT /api/portal/alert-preferences`
(`artifacts/api-server/src/routes/portal-alert-preferences.ts`), `requireCapability(
"ladder.customer-user")`, scoped by `req.user!.customerId` — every portal user for a tenant reads/
writes the same shared profile (route header `:9-11`). Real schema:
`customer_alert_preferences`, `customer_alert_settings`, `customer_alert_recipients`
(`lib/db/migrations/manual/2026-08-25-customer-alert-preferences-1276.sql`,
`2026-08-25-customer-tenant-alert-rules-1278.sql`).

A real design field inventory already exists — `docs/portal/alert_preferences.md` — extracted
against the route, `customer-tenant-alert-engine.ts`, `customer-alert-delivery.ts`, and the two
migrations above. Cited, not re-derived; summary:

| Field | Source |
|---|---|
| 7 categories: `findings, drift, progress, reviews, remediation, billing, support` | `CUSTOMER_ALERT_BALANCED_DEFAULTS` keys |
| Per-category `enabled`, `emailEnabled`, `mode` (`immediate`\|`daily`\|`weekly`), `threshold` | `CategoryPrefShape` / GET response `categories[cat]` |
| 23 real alert-rule rows (`rule_key`, `label`, `severity`, `detector_status`) | `2026-08-25-customer-tenant-alert-rules-1278.sql` seed — 19 `live`, 4 `pending_detector` |
| `settings.activePreset`, `quietHoursEnabled`, `quietHoursFrom`, `quietHoursTo`, `quietBreakForCritical` | GET response `settings` |
| `primaryRecipient` (always the requesting user, never stored) / `recipients[]` (`customer_alert_recipients`) | same route |

**Real, live, backend-complete. Zero page consumers anywhere in `artifacts/portal/src`** —
`grep -rln "portal-alert-preferences|alert-preferences|useAlertPreferences|customerAlertPreferences"
artifacts/portal/src` returns no matches. The predecessor page
(`portal-v2-alert-preferences.tsx`) was retired wholesale in the portal-v2 rebuild and never
rebuilt. **Filed as `#4071`, parented to `#1596`, this session** — the same shape of finding as
`#4051` (Departments), and the section of this consolidated page most likely to be what `#1596`
actually meant by "Alert preferences," given it is not yet reachable anywhere in the live portal.

---

## 5. Account Security settings-relevant fields

**Extracted fully in `docs/portal/account-security-contract-pack.md` (`#1595`'s own pack) — cited,
not re-derived.** `#4057` asks for only the **settings-shaped pieces**, not the full page (the
full page also covers MFA enrollment CTAs, sessions list, delete-account, which stay under
Account Security's own page/scope, not Settings). The settings-relevant subset:

| Field/action | Route | Marker | Notes |
|---|---|---|---|
| MFA enrollment state (`totp`, `sms`, `smsPhone`, `passkey`, `passkeyCount`) | `GET /api/auth/mfa/enrollments` (`mfa.ts:350-372`) | **CURRENT** | `requireAuth` only — see §6 |
| Active sessions list + revoke (single / "sign out everywhere else") | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others` (`auth.ts:869-907`) | **CURRENT**, write capability already live | `requireAuth` only |
| Change password | `POST /api/auth/change-password` (`auth.ts:888` per current line numbers; cited pack's line `822` is against the retired page's era) | **Endpoint CURRENT; no live UI trigger found** | `requireAuth` only |
| Password age / failed sign-ins / device compliance (tenant-wide Graph signals) | `GET /api/portal/account-security/graph-signals` (`#1593`, `routes/portal-account-security-graph.ts`) | **BUILT** — real discriminated union per signal, `available: false` for two of three on the testbed tenant (no Entra Premium, no full Intune) | `requireCapability("ladder.free")` — see §6 |
| Data export / delete-account request | `POST /api/portal/deletion-request` (`portal-privacy.ts:272-274`) | **Endpoint CURRENT; "Your data" is `#1595`'s page's own section, arguably not a Settings-page concern** | not this section's scope — flagged, not pulled in |

**No live page anywhere in `artifacts/portal` consumes any of these today** — the retired
`portal-v2-account-security.tsx` and its hooks are gone (`f40438cdc`), and no `Design/portal/`
export exists for a replacement (confirmed §8). This is the same "backend real, no consumer" shape
as Departments/Alert Preferences — but **not filed as a new finding here**, because
`account-security-contract-pack.md` §2 already names each of these as "not yet assigned — flagged"
in its own CURRENT/DECIDED table; a second filing would duplicate that pack's own record.

**"Your data" (export/delete-account) is deliberately excluded from this section** — per `#1596`'s
own body, only "the settings-shaped pieces (not the full Account Security page)" belong in
Settings; data export/deletion is a distinct, higher-stakes concern that reads more naturally as
its own destination (`/privacy`, already documented in `docs/portal/data-rights-and-privacy-
contract-pack.md`) than a Settings tab. Flagged for Shane's call, not decided here.

---

## 6. Auth-scope comparison across all five sections — the real question `#4057` asked

Five sections, **three distinct auth-scope shapes**, one of them additionally tier-gated. Design
must not assume one permission check covers the whole page:

| Section | Gate | Scope key | Floor |
|---|---|---|---|
| Departments (§1) | `requireCapability("ladder.customer-user")` | `resolveCustomerId(req)` (JWT, `tenants.id`) | Customer-tenant-scoped |
| Change Control (§2) | `requireCapability("ladder.customer-user")` | same | Customer-tenant-scoped |
| Ownership E/F (§3a/3b, policy toggles) | `requireCapability("ladder.customer-user")` | same | Customer-tenant-scoped |
| **Ownership people/matrix (§3c)** | `requireRole("CustomerUser")` **+ `requireTierFeature(ownership)`** | same, plus a **Premier-tier entitlement check** | Customer-tenant-scoped, **and Premier-only** |
| Notification Preferences (§4a) | `requireAuth` only — **no capability/role check** | `req.user!.id` (the authenticated user's own row) | **Any authenticated role** (CustomerUser, MSPAdmin, MSPOperator, PlatformAdmin) |
| Alert Preferences (§4b) | `requireCapability("ladder.customer-user")` | `req.user!.customerId` | Customer-tenant-scoped |
| Account Security — MFA/sessions/password (§5) | `requireAuth` only | caller's own user id | **Any authenticated role** |
| Account Security — Graph signals (§5) | `requireCapability("ladder.free")` | `resolveCustomerId`/tenant, per pack | Customer-tenant-scoped, **lower floor** than `ladder.customer-user` (`ladder.free` sits below `ladder.customer-user` on the rung order — `lib/db/migrations/manual/2026-09-12-rbac-repair-2457-rerun-3867.sql:108`: `Free` rung 0, `Customer` rung 1) |

**Two real mismatches, not one:**

1. **The tier mismatch (`#4057`'s own example scenario, confirmed real).** Four of five sections
   (Departments, Change Control, Ownership policy toggles, Alert Preferences) require only the
   `ladder.customer-user` capability floor — no purchased-tier check. The Ownership **people/
   matrix** data (§3c) additionally requires the `ownership` tier feature, which only Premier
   carries (`2026-09-05-portal-tier-included-features-1168.sql:52-59`). **A Foundation or Growth
   customer opening this consolidated Settings page would see four working sections and one that
   403s or must be hidden/upsold** — Design cannot draw Ownership's roster the same way it draws
   the other four sections without a paywall state. If the Ownership section is scoped to just the
   two policy toggles (§3a/§3b, not tier-gated), this mismatch does not apply to it — reinforcing
   the §3c open question about what "Ownership routing" in this page actually shows.

2. **The role-scope mismatch (new finding, not previously stated in any cited pack).**
   Notification Preferences and Account Security's MFA/sessions/password routes use bare
   `requireAuth` — genuinely **any** authenticated role, not just `CustomerUser`. Departments,
   Change Control, Ownership's settings toggles, and Alert Preferences are all floored at
   `ladder.customer-user` specifically. In practice this is low-impact for a portal session (a
   portal login is functionally always a `CustomerUser`), but it means the five sections do not
   share one capability check today, and a future MSP-staff-facing reuse of this page's components
   would behave differently per section without an explicit gate added. Not itself a bug — no
   route enforces the wrong thing — but confirms **same-page-different-tab is structurally
   correct** for this consolidation (5 independent fetches, 5 independent gates), not a single
   `GET /api/portal/settings` doing one auth check and returning everything.

**Recommendation for Design, stated as a fact pattern, not a decision this pack makes:** each
section should fetch and gate itself independently on mount (tab-scoped loading/error/empty
states, matching the honest-tri-state pattern all four cited packs already document for their own
surfaces), and the Ownership tab specifically needs its own entitlement-aware state (locked/upsell
for non-Premier) distinct from the other four tabs' simpler auth-failure handling.

---

## 7. Findings filed at pack time

- **`#4071`** — "Settings: Alert Preferences backend (`portal-alert-preferences.ts`) has zero page
  consumers — `customer_alert_preferences` taxonomy is real and live, unwired" — parented to
  `#1596`, labelled `bug`, board status `AI Batter Up`. (§4b)

No other new orphaned-endpoint finding was found in this pack's scope. `#4051` (Departments, zero
consumers) and `#4053` (Departments, no live Graph group read) were already filed by `#1734` and
remain open, unaffected by this pack. `#4052` (stale Change Control pack §10) remains open — cited
honestly in §2, not silently treated as fixed.

---

## 8. Existing design assets — a real caveat for whoever commissions the Design export

**No `Design/portal/` export named "Settings" exists.** Confirmed:
`find Design -iname "*.dc.html"` has no `Settings.dc.html` anywhere in the repo.

**A pre-existing, page-per-page design pass does exist and should not be mistaken for progress on
this consolidation.** `Design/portal/design_handoff_full_site/screens/` (landed `daed32419`,
2026-09-06 — **before** `#1596`'s 2026-09-14 consolidation decision) contains individual
`Account Security.dc.html`, `Change Control.dc.html`, `Notification Preferences.dc.html`, and
`Ownership RACI.dc.html` exports, each with its own contract-pack copy under that same directory's
`docs/` (mirroring, not superseding, the `docs/portal/*-contract-pack.md` files cited throughout
this pack). These are **separate-page** designs from before the "one consolidated page" decision
existed — they are not a partial version of the Settings page this pack is scoping, and `#1735`
(Settings' own Design export issue) should commission a genuinely new, single-page export rather
than assume any of these four can be repurposed as a Settings tab as-is. Flagged for whoever picks
up `#1735`, not filed as its own issue — it's a sequencing caveat, not a code or doc defect.

---

## 9. Summary — CURRENT vs DECIDED vs open, all five sections

| Section | Backend | Page consumer today | Status |
|---|---|---|---|
| Departments | `CURRENT` | none (`#4051`) | Ready to consolidate |
| Change Control policy | `CURRENT` | yes — `/change-control` (`PolicySection.tsx`) | Ready to consolidate; move-vs-duplicate question open (§2) |
| Ownership policy toggles (E/F) | `CURRENT` | none | Ready to consolidate |
| Ownership people/matrix | `CURRENT`, **Premier-tier-gated** | `/ownership` page not yet architected (`#1686`) | Real tier mismatch vs. the other four sections (§6) |
| Notification Preferences | `CURRENT` | yes — `/notification-preferences` (`#2992`) | Ready to consolidate; move-vs-duplicate question open (§4a); `#4057`'s own citation of this as "#1662 Alert Preferences" corrected (§4) |
| Alert Preferences (`customer_alert_preferences`) | `CURRENT` | none (`#4071`, filed this session) | Ready to consolidate — likely the closer match to `#1596`'s "Alert preferences" wording |
| Account Security (settings subset) | `CURRENT` (MFA/sessions/password); `BUILT` (Graph signals, `#1593`) | none | Ready to consolidate; "Your data" deliberately excluded (§5) |

**Real, unresolved product decisions this pack surfaces for Shane, not settled here:**
1. Does the Ownership section show the two policy toggles only, or the tier-gated people/matrix
   too (§3c)?
2. Do Change Control's policy panel and Notification Preferences move out of their current
   standalone pages into Settings, or duplicate into both (§2, §4a)?
3. Does "Alert preferences" in `#1596`'s body mean the shipped 15-category bell system (`#1662`,
   §4a) or the unwired 7-category `customer_alert_preferences` system (§4b) — or both, as separate
   sub-tabs?

## 10. Verification ledger

- Every file:line citation traces to a direct read of the named file on `main` in this worktree
  this session (2026-09-14) — no claim taken from a pack's prior citation without re-checking
  against current code where the claim was load-bearing for this pack's own conclusions (the tier
  gate, the role-scope comparison, the zero-consumer greps).
- `grep -rln "portal-alert-preferences|alert-preferences|useAlertPreferences|customerAlertPreferences"
  artifacts/portal/src` — no matches, confirmed live this session (§4b).
- `find Design -iname "*.dc.html"` — no `Settings.dc.html` anywhere, confirmed live this session
  (§8).
- `#4052`'s state (`OPEN`) checked live via `gh issue view 4052` this session, not assumed from the
  citing pack's own text (§2).
- `#1662`'s real scope checked live via `gh issue view 1662` this session — confirmed it ships
  Notification Preferences, not `customer_alert_preferences` (§4).
- Tier-gate claim (§3c, §6) traces to `portal-ownership.ts:426` and
  `lib/db/migrations/manual/2026-09-05-portal-tier-included-features-1168.sql:52-59`, both read
  directly this session.
- Ladder-rung ordering (§6) traces to
  `lib/db/migrations/manual/2026-09-12-rbac-repair-2457-rerun-3867.sql:108`, read directly this
  session.

# PlatformAdmin MSP tenant management (Admin Panel) — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document (five real, evidenced gaps found while extracting it were filed as their own issues
— #3680, #3681, #3683, #3684, #3686 — rather than fixed here).

Module: **MSP tenant administration**, the **PlatformAdmin** surface, leaf issue #3672, Feature
#1690 (Settings (MSP Console)). Filed because #3672 found `docs/msp-console/msp-settings-contract-pack.md`
is a **false match by filename** — it documents `msp-settings.ts`, the unrelated MSP-operator
*self-service* surface, and never once covers the files this pack is actually about:
`artifacts/api-server/src/routes/msp-admin-settings.ts`, `admin-impersonation.ts`, and their real
adminv2 consumer, `artifacts/admin-panel/src/adminv2/screens/ad/canvases/AdMspCanvas.tsx`.

**Read this framing before anything else, because it's the opposite of the sibling pack's
situation.** `msp-settings-contract-pack.md`'s defining fact was that its whole 39-route backend
was **orphaned** — a finished backend with zero frontend callers. This module is the reverse: it
is **not** an MSP Console (`artifacts/msp-console`) surface at all, despite the design export that
prompted #3672 living under `Design/MSP_Console/design_handoff_msp_console/`. Every route here is
called from **real, live, routed pages in `artifacts/admin-panel`** — the PlatformAdmin tool, not
the MSP-operator product. The design export's own in-file note (`MSP Console.dc.html:4534`, the
"Two Active Directory surfaces" callout) says this plainly: *"Nothing on this screen is editable
from the operator console... every write above is a PlatformAdmin action in the admin panel."*
The dc.html screen renders inside the MSP Console mockup purely as a design reference for what the
Admin Panel's own screen does — it is not proposing a new MSP Console feature.

Auth for every route in this pack is the **legacy two-value `usersTable.role` column**
(`"admin" | "client"`, `schema/index.ts:71`), gated by `requireAdmin` (`requireAuth.ts:200-208`,
`req.user?.role !== "admin"` → 403). This is a **completely different, older mechanism** than the
`mspRole` hierarchy that gates every route in the sibling `msp-settings-contract-pack.md`. The two
systems coexist on the same `usersTable` row but answer unrelated questions: `role` says "is this a
platform operator at all," `mspRole` says "what tier of MSP-side access does this account have."
Design should not assume `MSPAdmin`/`PlatformAdmin` from the `mspRole` enum implies anything about
reaching these routes — only `role === "admin"` does.

**A stronger, separate correction to the sibling pack itself, found while confirming the above:**
`msp-settings-contract-pack.md` states every one of its 39 routes is gated by `requireRole("MSPAdmin")`,
doing "a `ROLE_ORDER` index comparison" at `requireAuth.ts:81-89,206+`, over a 7-value hierarchy
(`Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`).
**None of that is true on `main` today.** `requireAuth.ts:81-89` today is a comment block titled
*"MSP privilege ladder — RETIRED HERE (#2460)"*; `requireRole` no longer exists anywhere in that
file (`grep -n "function requireRole" requireAuth.ts` — zero matches); and `msp-settings.ts` itself
now gates every route with `requireCapability("ladder.msp-admin")` / `requireCapability("ladder.free")`
(e.g. `msp-settings.ts:240,267,300,324,370`), a capability-evaluator lookup, not a role-ladder index
comparison. Separately, `LEGACY_ROLE_ORDER` (`@workspace/db/rbac/legacy-ladder.ts:46-52`) is now
**six** values, not seven — `Free, Customer, ServiceAccount, MSPOperator, MSPAdmin, PlatformAdmin`
— per a same-day product decision recorded in that file's own comment (`:42-44`, "Shane 2026-09-11":
`CustomerUser` renamed `Customer`, `Assessment` folded into `Free`). `msp-settings-contract-pack.md`
was generated 2026-09-06, five days before both of these landed — its auth-model section and its
role-enum table are now stale, not wrong-when-written. Filed as its own finding, **#3686**
(sibling sub-issue of Feature #1690), rather than corrected in place here, since fixing a pack this
pack does not own is out of scope for a read-only extraction build.

---

## 0. The three route groups and where they actually live

| File | Routes | Registered at |
|---|---|---|
| `msp-admin-settings.ts` (568 lines) | MSP CRUD/list, suspend/reactivate, overrides, plan capabilities, sessions | `routes/index.ts:146,466` |
| `admin-impersonation.ts` (191 lines) | User impersonate, **MSP impersonate**, view-as account list | `routes/index.ts:28,374` |

The design export's four cited actions (`MSP Console.dc.html:4516-4519`) span **both** files:
`PATCH /admin/msps/:id`, `POST /admin/msps/:id/suspend`, `POST /admin/msps/:id/reactivate` are in
`msp-admin-settings.ts`; `POST /admin/msps/:id/impersonate` is in `admin-impersonation.ts` even
though it shares the same `/admin/msps/:mspId/...` URL family — a real, easy-to-miss split #3672's
own issue body already pointed at (citing `admin-impersonation.ts:73` for the 30-minute token) but
didn't say plainly. That exact line has since drifted — the real 30-minute expiry for the
MSP-scoped impersonate route is at `:79` on `main` today, `:24` for the user-level route — ordinary
line drift since the audit, not a discrepancy worth chasing further.

**AdMspCanvas.tsx's own GET is neither of these routes.** It calls `fetchAdMsp` →
`GET /api/admin/active-directory/msp/:id` (`adApi.ts:74-77`), which lives in a **third** file,
`admin-active-directory.ts:306-415` (Phase 2 of `docs/build-plans/active-directory.md`), gated by
the same `requireAdmin`. That route's own header comment (`:300-305`) is explicit that entitlements
are "derived from the subscription's Product Catalog tier... no separate entitlements table" —
true today, see §3 for what that claim misses. This pack documents the write-side files (the
subject of #3672); the read-side AD detail route is out of scope here — no existing pack covers it
either, worth a Design/backlog note but not re-litigated in full in this document.

---

## 1. Per-route wire contract — `msp-admin-settings.ts`

### 1a. List / Create / Detail / Update MSPs

**`GET /api/admin/msps`** (`:86-135`) — paginated (`page`, `limit` capped at 100, default 25),
filterable by `search` (ILIKE across `name`/`slug`/`domain`, OR'd, `:96-102`), `status`
(`"active"|"suspended"|"trial"`, silently ignored if not one of those three, `:104-106`), and
`isTestbed` (only the literal string `"true"` matches, `:107-109` — `isTestbed=false` or any other
value does **not** filter). Returns `{ msps: [...], total, page, limit }`; each row:

| Field | Type | Line |
|---|---|---|
| `id`, `name`, `slug`, `domain`, `logoUrl` | as `mspsTable` | `116-120` |
| `status` | `"active"\|"suspended"\|"trial"` | `121` |
| `trialEndsAt` | `string \| null` | `122` |
| `offboardingState` | `null \| "cancellation_requested"\|"export_ready"\|"archival_flagged"` | `123` |
| `isDirectBusiness`, `isTestbed` | `boolean` | `124-125` |
| `createdAt` | `string` | `126` |

Sorted newest-first (`desc(createdAt)`, `:130`), no other sort option.

**`POST /api/admin/msps`** (`:139-186`) — body `createMspSchema` (`:139-151`): `{ name:
string(2-120), slug: string(2-60, /^[a-z0-9-]+$/), domain?, status?: "active"|"trial" = "trial",
isDirectBusiness? = false, isTestbed? = false, primaryContactName?, primaryContactEmail?,
primaryContactPhone?, address?, notes? }`. 409s if the slug already exists (`:161-169`, a real
pre-check, not a DB unique-constraint 500). Sets `trialEndsAt` to **exactly 14 days from now**
regardless of the requested `status` (`:173` — even a `status: "active"` create gets a
`trialEndsAt` stamped, since the column always gets a value here). Returns the full inserted row,
`201`. Audit: `msp.create` (`:176-183`).

**`GET /api/admin/msps/:mspId`** (`:190-227`) — **a different, narrower detail shape than
AD's `GET /admin/active-directory/msp/:id`** (see §0): `{ ...msp, subscription, userCount,
override }`, where `subscription` is `{ id, status, dunningState, stripeCustomerId,
stripeSubscriptionId, stripePriceId, currentPeriodStart, currentPeriodEnd, tenantCountSnapshot,
serviceName } | null` (`:197-213`) and `override` is the **raw `mspOverridesTable` row** (`:220-224`,
not a derived/merged view — see §3 for why that raw value is never actually applied anywhere).
No `customers`/`users`/`agreementAcceptances`/`entitlements` — this route is **not** what
AdMspCanvas renders; it's what the legacy `MspAdmin.tsx` detail drawer renders (§4).

**`PATCH /api/admin/msps/:mspId`** (`:244-273`) — body `updateMspSchema` (`:231-242`), all
optional: `{ name?, domain?, logoUrl?, primaryColor?(/^#[0-9a-fA-F]{6}$/), isTestbed?,
primaryContactName?, primaryContactEmail?, primaryContactPhone?, address?, notes? }` — every
nullable field accepts explicit `null` to clear it. **`status` is deliberately absent from this
schema** — AdMspCanvas's own doc comment (`AdMspCanvas.tsx:105-107`) states this is intentional:
suspend/reactivate below are the only sanctioned status transition. 404s if the MSP doesn't exist
(`:260`). Returns the full updated row. Audit: `msp.update`, metadata is the raw parsed body
(`:262-270`).

### 1b. Suspend / Reactivate

**`POST /api/admin/msps/:mspId/suspend`** (`:277-292`) — atomic guarded update: only succeeds
`where(id = mspId AND status = 'active')` (`:285`), so calling it on an already-suspended or
trial MSP 404s `"MSP not found or not in active state"` rather than silently no-op'ing (`:288`).
Sets `status: "suspended"`, `suspendedAt: now`. Returns `{ ok: true, status: "suspended" }`. Audit:
`msp.suspend` (`:290`). **A trial MSP cannot be suspended by this route** — the guard requires
`status = 'active'` exactly, so a trial-status MSP would need to become active first, or use some
other path this file doesn't expose.

**`POST /api/admin/msps/:mspId/reactivate`** (`:294-309`) — mirror guard, only succeeds
`where(status = 'suspended')` (`:302`), clears `suspendedAt: null`, sets `status: "active"`.
404s `"...not in suspended state"` otherwise. Returns `{ ok: true, status: "active" }`. Audit:
`msp.reactivate` (`:307`).

### 1c. MSP Overrides

**`GET /api/admin/msps/:mspId/overrides`** (`:313-324`) — the raw `mspOverridesTable` row for
that MSP, or `null` if none exists (no 404 — absence is a normal state, `:323`).

**`PUT /api/admin/msps/:mspId/overrides`** (`:334-371`) — body `overrideSchema` (`:326-332`):
`{ featureFlags: Record<string, boolean> = {}, tenantAllowanceOverride?: int > 0 | null,
aiCreditAllowanceOverride?: int > 0 | null, reason: string(5-500), expiresAt?: ISO datetime | null
}`. `reason` is **required** on every save, even an update that only changes `featureFlags`
(`:330`). Full upsert on `mspId` (unique, `:358`) — every field in the conflict `set` is the
freshly-parsed body, so a PUT that omits `tenantAllowanceOverride` resets it to `null`, same
silent-reset shape as the sibling pack's Group B connector PUT. Returns the saved row. Audit:
`msp.overrides.upsert`, metadata `{ featureFlags, reason }` (`:361-368`) — note `tenantAllowanceOverride`/
`aiCreditAllowanceOverride`/`expiresAt` are **not** included in the audit metadata even though
they're part of what changed.

**`DELETE /api/admin/msps/:mspId/overrides`** (`:373-388`) — unconditional delete-by-`mspId`,
always `{ ok: true }` and always writes `msp.overrides.delete` to the audit log (`:379-385`) even
if no override row existed to delete — the audit trail cannot distinguish "removed a real override"
from "no-op on an MSP with none."

**This entire group is real, wired, and reachable — `MspOverrides.tsx` (`/msp/overrides`, a real
routed Admin Panel page) is a complete UI for it — but is functionally inert everywhere else in the
platform. See §3; filed as #3681.**

### 1d. Plan Capability Rules

**`GET /api/admin/plan-capabilities`** (`:392-407`) — every `mspPlanCapabilitiesTable` row,
left-joined to `servicesTable` for `serviceName` (so a row whose service was deleted still lists,
with `serviceName: null`), ordered by `(serviceId, capabilityKey)`. No MSP scoping — this is a
**global**, tier-level rule table, one row per `(serviceId, capabilityKey)` pair (unique index,
schema `msp.ts:1871`), not per-MSP.

**`PUT /api/admin/plan-capabilities/:serviceId/:capabilityKey`** (`:413-454`) — body `{ enabled:
boolean }`. Upserts on the `(serviceId, capabilityKey)` unique pair. `false` means "gated on this
tier," `true` means "available" — **a missing row is also "available"** (per the schema's own
comment, `msp.ts:1858`: "Missing row = capability available"), so this table only ever needs rows
for the *exceptions*, not a complete enumeration. Returns the saved row. Audit:
`plan_capability.upsert` (`:444-450`).

**`DELETE /api/admin/plan-capabilities/:serviceId/:capabilityKey`** (`:456-483`) — deletes the
rule (reverting to "available" per the same missing-row convention). Always `{ ok: true }`. Audit:
`plan_capability.delete` (`:473-479`).

**This group is real and wired to a UI (`PlanManagement.tsx`) but does not gate anything by
itself** — the actual runtime gate, `requirePlanFeature()` (`msp-entitlement.ts:97+`), reads a
same-named-but-different value (`tierCapabilities` nested in `servicesTable.typeAttributes`, via
`loadTier()`, `:40-66`), not this table. See §3 for the full picture — `mspPlanCapabilitiesTable`
and the tier's own JSON attribute are two parallel real mechanisms with the same apparent purpose,
and this route file's writes only ever reach the one that isn't consulted at runtime. Filed as
**#3683** (sibling sub-issue of Feature #1690).

### 1e. Sessions (refresh tokens + impersonation tokens)

**`GET /api/admin/msps/:mspId/sessions`** (`:487-529`) — `{ refreshTokens, impersonationTokens }`
for every user under the MSP. `refreshTokens`: unrevoked `mspRefreshTokensTable` rows, capped 50,
newest-first (`:503-514`) — returned as **raw rows** (`db.select()` with no join), so each item
carries only `userId` (an integer) with no email/name enrichment, unlike the sibling pack's
Group K sessions list which joins to `usersTable`. `impersonationTokens`: unrevoked
`mspImpersonationTokensTable` rows scoped to `targetMspId`, capped 20 (`:515-526`).

**`DELETE /api/admin/msps/:mspId/sessions/:type/:sessionId`** (`:531-566`) — `type` must be
`"refresh"` or `"impersonation"` (400 otherwise, `:550-553`); sets `revokedAt: now` on the matching
row in the corresponding table, keyed by `tokenHash` (refresh) or `tokenId` (impersonation). The
route file's own **header comment is stale**: it documents this as `DELETE
/api/admin/msps/:mspId/sessions/:sessionId` (`:20`, no `:type` segment) — the real route requires
`:type` in the path (`:532`), so a caller following the header comment literally would 404 on a
malformed URL. No 404/error if nothing matched either revoke `UPDATE` — the route always returns
`{ ok: true }` regardless of whether a row was actually found and revoked (`:564`).

**The `impersonationTokens` half of this group cannot work.** `mspImpersonationTokensTable`
(`msp_impersonation_tokens`) is never written to anywhere in the codebase — confirmed by a
repo-wide search and a live query against the local dev DB (0 rows, vs. 1 real row in the actual
`impersonation_tokens` table the mint routes use). Filed as **#3680** (sibling sub-issue of Feature
#1690). Design should treat the "impersonation sessions" half of any Sessions UI drawn from this
route as **currently un-buildable against real data** until #3680 is resolved — the `refreshTokens`
half is real and would work.

**This entire group (`GET`/`DELETE .../sessions...`) is orphaned** — confirmed by a repo-wide
search of every frontend app for `msps/.../sessions`: the only match is the route file itself. No
UI anywhere calls it today.

---

## 2. Per-route wire contract — `admin-impersonation.ts`

**`POST /api/admin/impersonate/:userId`** (`:12-44`) — targets a `usersTable` row with the
**legacy** `role = "client"` (not `mspRole`), 404s otherwise (`:16-19`). Mints a 32-byte-hex token
into `impersonationTokensTable` (`impersonation_tokens` — **not** `mspImpersonationTokensTable`),
**30-minute** expiry (`:23-24`). Returns `{ token, client: { id, email, name } }`. Audit via
`createAuditLog` (`audit.ts:18-35`) — **writes to `auditLogsTable` (`audit_logs`), a completely
different table from `mspAuditLogsTable` (`msp_audit_logs`)** that `msp-admin-settings.ts`'s own
`writeAuditLog` writes to: `admin_impersonated` (`:33-41`), fire-and-forget (`void`, `:33` — a write
failure here is never surfaced to the caller). See §3 for why this table choice matters.

**`POST /api/admin/msps/:mspId/impersonate`** (`:50-113`) — **this is the route AdMspCanvas's
"Impersonate" button actually calls** (`impersonateAdMsp`, `adApi.ts:251-254`). Looks up the MSP
(404 if missing, `:54-62`), then finds **one** user with `mspRole = LEGACY_ROLE.mspAdmin` under
that MSP (`:64-66`) — 404s `"No MSPAdmin user found for this MSP"` if none exists (`:67-74`, a
real, reachable state for any MSP with zero MSPAdmin-role staff). If multiple MSPAdmin users exist
for the MSP, **the query has no deterministic order** (`:64-66`, plain `.where()` with no
`.orderBy()` and no `.limit(1)` — `db.select()` here returns every match but only `[mspAdmin]`
destructures the first, so which one is "first" depends on the database's own unspecified scan
order) — Design should not assume impersonation always lands on the same staff member for an MSP
with more than one MSPAdmin. Mints into `impersonationTokensTable` (same real table as above),
**30-minute** expiry (`:78-79`). Returns `{ token, targetSlug, msp: { id, name, slug } }`. Audit:
`admin_impersonated_msp` (`:88-96`) — **into `auditLogsTable`, same as above, not
`mspAuditLogsTable`** — plus a structured `log.info` regardless of audit outcome (`:98-106`). The
frontend (`AdMspCanvas.tsx:244-246`) opens
`${origin}/portal/?impersonation_token=...&target_slug=...` in a new tab — the token/slug pair is
what `/auth/impersonate-exchange` (not in this file) consumes to establish the session.

**`GET /api/admin/view-as/accounts`** (`:151-188`) — powers `ViewAsSwitcher.tsx`, a real, wired
admin-panel component distinct from AdMspCanvas. Lists active users whose `mspRole` is one of
`Free`, `Customer`, or `MSPAdmin` (`VIEW_AS_GROUPS`, `:137-149`) — a fixed, code-defined 3-group
allowlist, not the full 6-value role hierarchy (`LEGACY_ROLE_ORDER`, see the correction above).
Each account carries a server-computed `groupKey` and `impersonationScope: "msp" | "user"`
(`:177-186`) telling the caller
which of the two impersonate routes above to call for that account — `MSPAdmin` rows route to
`/admin/msps/:mspId/impersonate`, everything else to `/admin/impersonate/:userId`. Per the file's
own extensive comment (`:120-136`, referencing #2459/#1696), this exists specifically so the
*client* never re-derives which endpoint to call from a role literal — the server states it.

---

## 3. Cross-surface edges and gaps

- **MSP Overrides writes go nowhere (filed as #3681).** `mspOverridesTable.featureFlags` /
  `tenantAllowanceOverride` / `aiCreditAllowanceOverride` are set through a real, shipped CRUD
  surface (§1c + `MspOverrides.tsx`) but are never read by `deriveEntitlements()`
  (`active-directory.ts:302-316`, AdMspCanvas's own Entitlements panel) or by `loadTier()` /
  `requirePlanFeature()` (`msp-entitlement.ts:40-97`, the actual tier-gate every capability check
  goes through) — both are 100% subscription-tier-derived. A PlatformAdmin granting an MSP
  "unlimited tenants" via this real page today has zero product effect.
- **§1d's `mspPlanCapabilitiesTable` is not the table `requirePlanFeature()` actually reads.**
  `requirePlanFeature()` (`msp-entitlement.ts:97+`, via `loadTier()`, `:40-66`) gates on
  `tierCapabilities` nested inside `servicesTable.typeAttributes` — a JSON blob on the
  *service/tier* row, real and actively consumed (e.g. `msp-launch-control.ts:15-16` names it
  explicitly as one of its two entitlement axes). §1d's `mspPlanCapabilitiesTable` is a
  **separate, dedicated** table with the same apparent intent (`serviceId` + `capabilityKey` →
  `enabled`) that nothing outside its own CRUD route ever reads back (repo-wide search:
  `mspPlanCapabilitiesTable` appears only in its schema definition and `msp-admin-settings.ts`).
  `PlanManagement.tsx`'s own "capability rules" section (the UI for §1d) never references
  `tierCapabilities` at all — confirmed by grep of the component — so this pack's §1d group and the
  value actually enforced are two parallel, disconnected mechanisms; whether `typeAttributes` /
  `tierCapabilities` has its own edit path elsewhere (e.g. a generic Services/Product-Catalog JSON
  editor under `admin-services.ts`) is outside this pack's scope (that route file is not one of
  #3672's named files) and is not claimed here either way.
- **Impersonation sessions cannot be listed or revoked (filed as #3680).** §1e's `GET`/`DELETE
  .../sessions` reads/writes `mspImpersonationTokensTable`, a table nothing ever inserts into —
  the real tokens both impersonate routes in §2 mint go into the differently-shaped
  `impersonationTokensTable`, which has no `revokedAt` column at all (only `usedAt`/`expiresAt`),
  so even a correctly-targeted revoke could not be expressed against the real table as it exists
  today.
- **MSP-level impersonation audits into the wrong table (filed as #3684).** Both impersonate
  routes in §2 (`admin_impersonated`, `admin_impersonated_msp`) audit via `createAuditLog()`
  (`audit.ts:18-35`) into `auditLogsTable` (`audit_logs`). AdMspCanvas's own "Activity" panel reads
  exclusively from `mspAuditLogsTable` (`msp_audit_logs`) via `GET /api/msp/audit` — confirmed
  live: `audit_logs` has 3 real `admin_impersonated_msp` rows and 16 real `admin_impersonated`
  rows; `msp_audit_logs` has zero rows of either type. Every *other* write on this same canvas
  (profile edit, suspend, reactivate, overrides, plan capabilities) goes through
  `msp-admin-settings.ts`'s own `writeAuditLog()`, which correctly targets `mspAuditLogsTable` —
  impersonation is the one action on this screen whose own audit trail is invisible to the
  screen's own Activity panel. This directly contradicts the design mockup that prompted #3672,
  whose `mspActivity` fixture includes `"msp.impersonation.started"` as an example row.
- **Two independently-real MSP detail reads exist for the same MSP** (§0): this pack's own
  `GET /admin/msps/:mspId` (§1a, consumed by `MspAdmin.tsx`) and AD's
  `GET /admin/active-directory/msp/:id` (consumed by `AdMspCanvas.tsx`) return different shapes off
  overlapping data — the former includes the raw `override` row (unused by anything downstream,
  per the point above), the latter includes `entitlements`/`customers`/`users`/
  `agreementAcceptances` and omits `override` entirely. Neither is wrong; they serve two different
  screens, but a UI must not assume one page's response shape describes the other's endpoint.
- **`PATCH /admin/msps/:id`'s own schema deliberately excludes `status`** (§1a) — the only
  sanctioned way to move status is suspend/reactivate (§1b), each independently guarded by the
  MSP's *current* status so neither can be called out of order into a no-op state.
- **The suspend/reactivate guards are strict, not permissive.** Suspend requires `status =
  'active'` exactly (a trial MSP cannot be suspended by this route); reactivate requires `status =
  'suspended'` exactly. Both 404 rather than silently succeeding on a call that doesn't match.

---

## 4. Who actually calls what — confirmed by grep, not inferred

| Route(s) | Real caller(s) |
|---|---|
| `GET /admin/msps` (list) | `MspAdmin.tsx:111` (paginated table) · `MspOverrides.tsx:69` (MSP picker) · `SimulatorCenterCanvas.tsx:465` and `TestbedContext.tsx:90` (testbed-only picker, `isTestbed=true`) · `dashboard-designer.tsx:78` |
| `POST /admin/msps` (create) | `MspAdmin.tsx:146` (legacy create dialog) · `adminv2/screens/ad/index.tsx:71` via `createAdMsp` (AD tree's own create flow) |
| `GET /admin/msps/:id` (this file's own detail) | `MspAdmin.tsx:132` only |
| `PATCH /admin/msps/:id` | `AdMspCanvas.tsx` (via `updateAdMspProfile`, `adApi.ts:241`) only — the legacy `MspAdmin.tsx` has no edit action |
| `POST .../suspend`, `POST .../reactivate` | Both `MspAdmin.tsx:170,186` **and** `AdMspCanvas.tsx` (via `suspendAdMsp`/`reactivateAdMsp`) — the one write action both surfaces share |
| `POST .../impersonate` | `AdMspCanvas.tsx` (via `impersonateAdMsp`) · `ViewAsSwitcher.tsx:75` (for `MSPAdmin`-group accounts) |
| `GET/PUT/DELETE .../overrides` | `MspOverrides.tsx` only |
| `GET/PUT/DELETE /admin/plan-capabilities/...` | `PlanManagement.tsx` only |
| `GET`/`DELETE .../sessions...` | **nobody** — orphaned (§1e) |
| `POST /admin/impersonate/:userId` | `ViewAsSwitcher.tsx` (for `Free`/`Customer`-group accounts) |
| `GET /admin/view-as/accounts` | `ViewAsSwitcher.tsx` only |

Unlike the sibling pack, this module is **mostly wired** — the only fully-orphaned group is
Sessions (§1e), and that group is also the one that's internally broken (#3680).

---

## 5. Live-DB facts (queried this session against the local `DATABASE_URL`, 2026-09-11)

| Table | Row count |
|---|---|
| `msps` | 2 |
| `msp_overrides` | 0 |
| `msp_plan_capabilities` | 1 |
| `msp_impersonation_tokens` | 0 |
| `impersonation_tokens` | 1 (a real impersonation session) |
| `audit_logs` (`action_type ilike '%impersonat%'`) | 19 (16 `admin_impersonated` + 3 `admin_impersonated_msp`) |
| `msp_audit_logs` (`action_type ilike '%impersonat%'`) | 0 |

`msp_overrides` being empty means #3681's gap has not yet produced a real customer-visible
incident — but the mechanism is inert by construction, not merely untested; adding a row today
would demonstrate the gap immediately (see #3681's reproduction). `msp_impersonation_tokens` being
permanently empty is not a live-data artifact — see #3680, no code path can ever write to it. The
`audit_logs`/`msp_audit_logs` split is the opposite of untested: 19 real impersonation events have
already happened and are already invisible to AdMspCanvas's Activity panel today (#3684).

---

## 6. CURRENT vs DECIDED

Everything in §1-§2 is **CURRENT** — built, wired (mostly — §1e is the one orphaned group), and
reachable via HTTP right now on `main`. There is no DECIDED-but-not-built category for this module;
every group is a direct CRUD or action surface over its own table(s). The four real product/bug
questions this pack surfaced (should `msp_overrides` actually gate anything; should
`mspPlanCapabilitiesTable` actually feed `requirePlanFeature()`; should the Sessions group be
wired to the real `impersonation_tokens` table or removed; which audit table should impersonation
actually write to) are **not** CURRENT-vs-DECIDED ambiguity — they're the substance of #3681,
#3683, #3680, and #3684 respectively, filed for Shane's/a future build's decision rather than
resolved here.

---

## 7. Forbidden list — what this pack found that a UI must never do

- **Never present "impersonation sessions" as a live, revocable list sourced from
  `GET .../sessions`.** The data behind it (`msp_impersonation_tokens`) can never be populated by
  any code path that exists today (§1e, #3680) — a UI built against this response will show an
  honestly-empty list forever, not a temporarily-empty one.
- **Never wire an "Advanced overrides" UI action to `PUT/DELETE .../overrides` expecting it to
  change what an MSP can actually do.** It saves and round-trips correctly but has no downstream
  effect anywhere in the platform (§3, #3681) — until that's resolved, this UI can only honestly be
  framed as "record a note," not "grant a capability."
- **Never wire a "capability rule" toggle to `PUT/DELETE /admin/plan-capabilities/...` expecting
  it to gate a feature.** Same shape as the overrides finding above, different table — the value
  `requirePlanFeature()` actually checks lives elsewhere (§3, #3683).
- **Never assume `PATCH /admin/msps/:id` can change `status`.** The schema excludes it by design
  (§1a) — a client sending `status` in the body has it silently ignored (Zod strips unknown/extra
  keys are not stripped by default here, but `status` simply isn't in `updateMspSchema`'s shape, so
  it has no effect on the update).
- **Never call suspend/reactivate speculatively "just in case."** Both guard on the MSP's exact
  current status and 404 rather than no-op (§1b) — a caller must check `status` first, not retry
  blindly.
- **Never assume MSP-level impersonation always targets the same account for an MSP with multiple
  MSPAdmin users.** The lookup has no explicit ordering (§2) — if that matters to a workflow,
  it needs its own decision, not an assumption drawn from today's single-admin-per-MSP dev data.
- **Never present an "Activity" panel backed by `GET /api/msp/audit` as a complete record of every
  admin action against an MSP, including impersonation.** Both impersonate routes in §2 audit into
  a different table that panel never reads (§3, #3684) — 19 real impersonation events already
  exist and are already invisible there.

---

*Pack generated 2026-09-11, session for #3672 (Feature #1690: Settings (MSP Console)). Read-only:
no product code, schema or UI changed. Five real findings surfaced during extraction were filed
separately rather than fixed here: #3680 (dead impersonation-sessions table), #3681 (MSP Overrides
has zero enforcement anywhere), #3683 (Plan Capability Rules table has zero enforcement anywhere),
#3684 (MSP-level impersonation audits into the wrong table), and #3686 (the sibling
`msp-settings-contract-pack.md`'s own auth-model section is now stale) — all five sibling
sub-issues of Feature #1690.*

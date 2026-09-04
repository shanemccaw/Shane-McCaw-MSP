# Team Management and Invitations (MSP Console) — contract extraction pack

**#2638**, step 3 of **#2567** (Feature: Team Management and Invitations, MSP Console — the
operator half of #2676), under **#1571** (EPIC: Portal Admin — MSP-side operator surface).
Follows the **#1642 pattern**: per-surface wire contracts extracted verbatim and cited to
file:line, CURRENT vs DECIDED marked on every field, real enum unions only, cross-surface
edges, honest tri-state, forbidden list, orphaned endpoints listed explicitly. Read-only — no
product code, schema, or UI changed to produce this document.

**This is a different surface from `docs/team-management-and-invitations-contract-pack.md`,
not a re-run of it.** That pack (#2447, part of #1656 "Feature: Team Management and
Invitations (Portal)") is scoped to the **customer-facing** half — `portal-team.ts`'s 10
routes, session-scoped to a CustomerUser managing their own tenant's roster. #2567 is the
other half: the **MSP-console operator** surface that lets MSP staff (MSPOperator/MSPAdmin/
PlatformAdmin) manage a roster for a customer elsewhere in their book. Same domain, same
tables, two different route files, two different actors, two different Features — same split
pattern the offboarding pair (`docs/offboarding-contract-pack.md` vs
`docs/offboarding-msp-console-contract-pack.md`) already established.

Backend route file: `artifacts/api-server/src/routes/msp-team.ts` — all 10 routes, one file,
one router, mounted at `/api` in `artifacts/api-server/src/routes/index.ts:268,550`
(`import mspTeamRouter from "./msp-team"; ... router.use(mspTeamRouter);`) — the router's own
paths already carry the literal `/msp/...` prefix, so the real mounted paths are
`/api/msp/customers/:customerId/team...` and `/api/msp/team/:userId/...`.

Confirmed real and live (`e8380d1f7`, "MSP console: real operator routes for Team Management
and Invitations (#2676)"). **No dedicated test file exists for this router** — there is no
`msp-team.test.ts` alongside `msp-team.ts`, unlike `portal-team.ts`'s own
`portal-team.test.ts`. Every wire contract below is read directly from source, not confirmed
against a passing test; noted honestly rather than implied otherwise.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-team.ts` — all 10 routes
- `artifacts/api-server/src/routes/portal-team.ts` — the sibling Portal file, cited only for
  the two places §5 draws a direct behavioral contrast (invite's `mspId` source; the TTL
  constant)
- `docs/team-management-and-invitations-contract-pack.md` — the Portal pack, cited for the
  shared vocabulary (`mfaStatus` derivation, `MSP_ROLES`, per-user capability flags) this pack
  does not re-derive
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole()` (`:205-221`),
  `ROLE_ORDER`/`roleIndex` (`:80-93`), `assertCustomerAccess()` (`:295-324`),
  `AuthUser` shape
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict()` (`:75-77`): reads
  `req.user?.mspId` directly off the session, **no** `?mspId=`/`?slug=` override for
  PlatformAdmin (contrast `resolveMspId()`'s admin-override branch, `:29-51`, which this file
  does not use)
- `artifacts/api-server/src/lib/session-tracking.ts` — `revokeAllOtherSessions()`
- `artifacts/api-server/src/lib/audit.ts` — `createAuditLog()` call shape (fire-and-forget,
  `void`-called, never blocks the response), `AuditEvent.actorRole: "admin" | "client"`
- `artifacts/api-server/src/lib/portal-url.ts` — `getPortalBaseUrl()`, `getMspPortalBaseUrl()`,
  `buildAccountSetupUrl()`
- `artifacts/api-server/src/lib/mailer.ts` — `sendEmailFromTemplate()`, `passwordResetEmail()`
- `artifacts/api-server/src/lib/client-setup-token.ts` — `ensureClientSetupToken()`
- `lib/db/src/schema/index.ts` — `usersTable`, `mfaEnrollmentsTable`, `webauthnCredentialsTable`,
  `passwordResetTokensTable`, `mfaChallengesTable`, `webauthnChallengesTable`,
  `mfaBypassCodesTable`, `MSP_ROLES` (real column/enum sources)
- `lib/db/src/schema/msp.ts` — `userSessionsTable`, `tenantsTable` (`:199-229`, `mspId` is
  `notNull`, FK'd to `mspsTable` — the real, authoritative owning-MSP column for a tenant)
- `artifacts/msp-console/src/App.tsx`, `src/pages/index.tsx` — comparison surface for the
  orphaned-endpoint check; the app is scaffolded (#2668) but has exactly one real route (`/`)
  and no team page

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-04):

```
 id  |                    name                    
------+--------------------------------------------
    1 | Shane McCaw Consulting
 1626 | Regression Testbed MSP (billing lifecycle)

   msp_role    | count 
---------------+-------
 Assessment    |     4
 CustomerUser  |     4
 PlatformAdmin |     1
```

**Zero MSPAdmin or MSPOperator users exist locally today** — the one real MSP-staff-tier row
is the single PlatformAdmin (`id=1`, `mspId=1`, `role="admin"`). No route in this pack has
ever been called by anything but a PlatformAdmin against this environment; §5's finding below
is a real bug reachable specifically by that role.

---

## 0. Authorization model — shared shape, but NOT the Portal file's `denyIfCannotManageTeam`

Every route in this file is gated by `requireRole("MSPOperator")` first (MSPOperator, MSPAdmin
or PlatformAdmin pass; `ROLE_ORDER`, `requireAuth.ts:80-93`). This file deliberately does
**not** call `denyIfCannotManageTeam` (the Portal file's own two-gate helper, contract pack
§0) — its second gate, the per-user `canManageTeam` DB flag, "only ever applies to the
customer tier... MSP staff and PlatformAdmin bypass this second check entirely" (Portal pack
§0). Role is already the gate here; the only remaining question is tenant ownership +
per-staff-member scoping, answered by `assertCustomerAccess` — the same helper
`denyIfCannotManageTeam` itself calls first (`msp-team.ts:1-39` header comment).

Two shapes of that check appear in this file:

1. **`GET`/`POST .../team[/invite]`** — `customerId` comes from `req.params.customerId`
   directly; 400 `{ error: "Invalid customerId" }` on `NaN`, then
   `assertCustomerAccess(req.user!, customerId)` → 403 `{ error: "Access to this customer is
   not permitted" }` on failure (`:118-127`, `:222-231`).
2. **Every `.../team/:userId/...` mutating route** — `resolveTargetCustomerId(req)`
   (`:81-99`), a private helper unique to this file (no equivalent named export in
   `portal-team.ts`, which inlines the same three steps per-route instead): parses `userId` →
   400 `{ error: "Invalid userId" }` on `NaN` → looks up the target's `tenantId` via a single
   `usersTable` row select → 404 `{ error: "Team member not found" }` if that row or its
   `tenantId` is missing → `assertCustomerAccess(req.user!, target.customerId)` → 403
   `{ error: "Access to this team member is not permitted" }` on failure. Same "404 before
   403" ordering as the Portal file's §0 (a request against a nonexistent user id 404s rather
   than 403ing).

Both `GET .../team` and every mutating route in this file require the `requireRole` role
gate — **unlike** the Portal file's `GET /portal/team`, which has no `denyIfCannotManageTeam`
gate at all (any authenticated tenant member can view their own roster). There is no
read-without-role-gate case in this file.

Every route additionally calls `resolveMspIdStrict(req)` or resolves `customerId`/`userId`
before doing anything else — `mspId` itself is used only as a **presence check** (400
`{ error: "No MSP context resolved for this session" }` if the caller's session carries no
`mspId` claim, `:113-116`, `:217-220`), never as a query filter. The routes' actual data scope
is entirely `customerId`/`target.tenantId`-driven via `assertCustomerAccess`, not `mspId`-
driven — see §5 for why this distinction is the mechanism behind the one real bug this pack
found.

---

## 1. Wire contract — `GET /api/msp/customers/:customerId/team`

Auth: `requireRole("MSPOperator")` + `assertCustomerAccess` against the `:customerId` route
param (§0.1). No query params, no pagination — every `users` row for the target tenant
(`eq(usersTable.tenantId, customerId)`, `:129-143`), unfiltered by role/active-status. Returns
`[]` immediately if the tenant has zero users (`:145-148`) — no batched lookups run in that
case, same short-circuit as the Portal roster route.

Otherwise, three parallel queries (`Promise.all`, `:152-172`) build a per-user summary — **the
same shape as the Portal roster**, with one real, load-bearing difference in `lastLoginAt`'s
derivation (below):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `users.id` (aliased twice, same as the Portal roster — see `userId`) |
| `userId` | `number` | not null | `users.id` — same value as `id`, both keys present (`:189-190`) |
| `email` | `string` | not null | `users.email` |
| `name` | `string \| null` | nullable | `users.name` |
| `phone` | `string \| null` | nullable | `users.phone` |
| `isActive` | `boolean` | not null | `users.is_active` |
| `isLockedOut` | `boolean` | not null (derived) | `Boolean(lockedUntil && lockedUntil > now())` (`:195`) — identical derivation to the Portal roster |
| `mfaStatus` | `"TOTP" \| "FIDO2" \| "SMS" \| "Disabled"` | not null (derived) | `reduceMfaStatus()` (`:101-106`, byte-identical precedence to the Portal file's own copy — passkey beats totp beats sms beats Disabled) |
| `mfaEnforced` | `boolean` | not null | `users.mfa_enforced` |
| `department` | `string` | not null (coerced) | `users.department ?? ""` |
| `jobTitle` | `string` | not null (coerced) | `users.job_title ?? ""` |
| `lastLoginAt` | `string \| null` (ISO, from `max()`) | nullable | `max(user_sessions.created_at)` where `session_type = "standard"` (`:168-171`) — same derived-not-column source as the Portal roster (Portal pack §5's own finding applies identically here, not re-filed) |
| `createdAt` | `string` (ISO) | not null | `users.created_at` |
| `activeSessionsCount` | `number` | not null (derived, default `0`) | `count(*)` of `user_sessions` rows, `session_type = "standard"`, `revoked_at IS NULL`, `expires_at >= now()`, grouped by `user_id` (`:159-167`) |

No sort applied — rows return in whatever order the tenant-scoped `SELECT` produces (no
`ORDER BY`, `:129-143`), identical to the Portal roster's own lack of ordering.

**One structural difference from the Portal roster worth Design knowing:** the Portal route's
four parallel queries include a fourth (passkey rows are queried separately and merged into
`methodsByUser`, same here at `:156-158` and `:180-184` — both files do this identically). The
actual difference is upstream: the Portal roster's `SELECT` on `usersTable` pulls 10 columns
in one query and never re-selects `department`/`jobTitle` per-user afterward; this file's
initial `SELECT` (`:130-141`) is column-for-column the same set. No field-shape drift between
the two roster payloads — Design can treat `GET .../team` (MSP) and `GET /portal/team`
(Portal) as byte-identical response shapes for a given tenant.

---

## 2. Wire contract — `POST /api/msp/customers/:customerId/team/invite`

Auth: `requireRole("MSPOperator")` + `assertCustomerAccess` against the `:customerId` route
param (§0.1) — **not** `denyIfCannotManageTeam`; there is no per-caller `canManageTeam` DB
flag check on this route at all (that flag only ever gates the customer tier, §0). Any
MSPOperator/MSPAdmin/PlatformAdmin whose `assertCustomerAccess` passes for the target
`customerId` can invite, full stop.

Request body: `{ email: string (required), name?: string, department?: string, jobTitle?:
string }` — identical shape to the Portal invite route. 400 `{ error: "email is required" }`
if missing/blank (`:239-242`). Email lower-cased and trimmed before any lookup or insert
(`:243`).

409 `{ error: "An account with this email already exists" }` if a `users` row with that exact
(normalized) email already exists **anywhere in the system** (`:245-250`) — same global
uniqueness check as the Portal route (`usersTable.email` DB-level `unique()`).

On success, inserts a new `users` row (`:252-263`):

| Column | Value |
|---|---|
| `email` | normalized input |
| `passwordHash` | `null` |
| `role` | `"client"` (legacy admin/client column) |
| `name` | trimmed input or `null` |
| `mspId` | **`resolveMspIdStrict(req)` — the calling MSP staff member's own `mspId` claim** (§5 finding) |
| `tenantId` | `customerId` (the target tenant, from the route param) |
| `mspRole` | `"CustomerUser"` — same flat tier as every Portal-invited teammate; no invite-time way to grant `canManageTeam` (same open product question the Portal pack §5 already flagged, not re-raised here) |
| `isActive` | `true` |
| `department` | trimmed input or `null` |
| `jobTitle` | trimmed input or `null` |

Fires (non-blocking, `void`-called, failures logged but never surfaced to the caller):

- `createAuditLog({ actionType: "team_member_invited", ..., metadata: { actorSurface: "msp",
  customerId } })` (`:265-272`) — the `actorSurface: "msp"` tag is new relative to the Portal
  route's own call (which carries no `actorSurface` key at all, contract pack §2) and appears
  on **every** audit call in this file (§4) — the one systematic, deliberate wire difference
  between the two Feature's audit trails.
- `ensureClientSetupToken(newUser.id)` → `buildAccountSetupUrl(setupToken)` →
  `sendEmailFromTemplate("account-setup", ...)`, same 72-hour-expiry setup link, same
  best-effort wrapping so a token/email failure still returns `201` (`:274-286`)

Response: `201 { ok: true }` — same as the Portal route, no id/email echoed back.

---

## 3. Enum / vocabulary reference — delta from the Portal pack only

This pack does not re-derive `mfaStatus`'s reduction rule, `mfa_enrollments.method`,
`user_sessions.session_type`/`login_method`, or `MSP_ROLES`' member list — all identical to
the Portal pack §3, cited there. The one addition specific to this surface:

- **`ROLE_ORDER` (`requireAuth.ts:80-93`) is the real privilege order this file's
  `requireRole("MSPOperator")` gate compares against — NOT `MSP_ROLES`'s declared array
  order.** Lowest to highest: `Assessment < Free < CustomerUser < ServiceAccount <
  MSPOperator < MSPAdmin < PlatformAdmin`. Every route in this file passes for
  MSPOperator/MSPAdmin/PlatformAdmin and rejects everything below MSPOperator — including
  CustomerUser, so a customer-tier user (even one with `canManageTeam = true`) cannot reach
  any route in this file; the two Features are mutually exclusive by role, not by any shared
  runtime check.
- **`tenantsTable.mspId`** (`msp.ts:201`) — `notNull`, FK'd to `mspsTable.id` — is the real,
  single source of truth for which MSP owns a given tenant. §5 is the direct consequence of
  this file writing a *different* value (the caller's own `mspId`) onto a new `users` row
  instead of reading this column for the target tenant.

---

## 4. Remaining mutating routes — `POST/PATCH/DELETE /api/msp/team/:userId/...`

Every route below shares the common shape from §0.2 (parse `userId` → 400 on `NaN` → resolve
target's `tenantId` → 404 if missing → `assertCustomerAccess` → 403 on failure) via the shared
`resolveTargetCustomerId()` helper, and is omitted from the table cells that would just repeat
it. Every mutating route's `createAuditLog` call carries `metadata: { actorSurface: "msp",
customerId: resolved.customerId }` — cited once here, not repeated per route below.

### 4a. `DELETE /msp/team/:userId/sessions`

(`:297-312`) Revokes every one of the target's own **other** standard sessions via
`revokeAllOtherSessions(targetUserId, null)` — `exceptTokenHash: null`, same "no exclusion"
shape as the Portal route's own §4a (caller and target are always different users here by
construction). Response: `{ ok: true, revokedCount: number }`. **Same gap as the Portal
file's own §4a**: no `createAuditLog` call on this route — the one mutating route in *this*
file, too, that fires no audit row. Not re-filed (Portal pack §5 already flagged the identical
gap on the sibling route); this file inherited the same omission when it was written to mirror
`portal-team.ts` 1:1.

### 4b. `PATCH /msp/team/:userId/status`

(`:316-357`) Body: `{ isActive: boolean }` — 400 `{ error: "isActive must be a boolean" }` if
not strictly boolean. Same self-suspend guard as the Portal route: 400 `{ error: "You cannot
suspend your own account" }` if `targetUserId === req.user!.id && !isActive` (`:332-335`) —
an MSP staff member could theoretically be their own tenant's `users` row target only if they
somehow appear in their own book's roster, an edge case this guard covers defensively rather
than one confirmed reachable today. On success: `UPDATE users SET is_active = isActive`;
audit `team_member_activated` / `team_member_suspended`; if suspending, fire-and-forget
`revokeAllOtherSessions(targetUserId, null)`. Response: `{ ok: true, isActive }`.

### 4c. `PATCH /msp/team/:userId/mfa-enforcement`

(`:361-391`) Body: `{ enforced: boolean }`, same 400 typeof-guard as §4b. `UPDATE users SET
mfa_enforced = enforced`. Audit `team_member_mfa_enforcement_enabled` / `_disabled`. Response:
`{ ok: true, mfaEnforced: enforced }`. Same "takes effect on next login, not current session"
behavior as the Portal route (shared schema comment, `index.ts:81-82`).

### 4d. `POST /msp/team/:userId/unlock`

(`:395-422`) No body. `UPDATE users SET failed_login_attempts = 0, last_failed_login_at =
NULL, locked_until = NULL` — same full lockout-state reset as the Portal route. Audit
`team_member_unlocked`. Response: `{ ok: true, isLockedOut: false }` — hardcoded post-update
state, not re-queried, same as the Portal route.

### 4e. `POST /msp/team/:userId/reset-password`

(`:428-475`) No body. Mints a `password_reset_tokens` row (`token`: 32 random bytes hex,
`expiresAt`: now + `TEAM_RESET_TOKEN_TTL_MS`, `:424`). **`TEAM_RESET_TOKEN_TTL_MS = 60 * 60 *
1000` — 1 hour, the same value and the same comment ("matches /auth/forgot-password and
portal-team.ts") as the Portal file's own constant** (Portal pack §2b cites the identical
value at `portal-team.ts:391`) — the two files each declare their own copy of this constant
rather than sharing one, but the values agree; not a drift. Emails the target a reset link via
`getPortalBaseUrl()` (not `getMspPortalBaseUrl()` — the reset-password page itself is a Portal
route, reached the same way regardless of which surface triggered the reset) and
`passwordResetEmail()`. Audit `team_member_password_reset_email_sent`. Response: `{ ok: true
}` — no token/link returned to the caller.

### 4f. `POST /msp/team/:userId/temp-password`

(`:479-517`) No body. Same fixed pattern as the Portal route: `Temp-${6 random bytes hex,
uppercased}!9`, bcrypt-hashed (cost 12), `UPDATE users SET password_hash = ...`. Audit
`team_member_temp_password_set`. Response: `{ ok: true, tempPassword: string }` — **the
plaintext temp password is returned directly**, same as the Portal route; the MSP staff caller
is expected to relay it to the customer teammate out-of-band. No email sent.

### 4g. `POST /msp/team/:userId/reset-mfa`

(`:521-584`) No body. Reads current enrollments + passkey presence to build `clearedMethods:
string[]`, then deletes all four MFA-related tables for the target (`mfa_enrollments`,
`mfa_challenges`, `webauthn_credentials`, `webauthn_challenges`, `:552-555`) — full teardown,
identical to the Portal route. Emails the target (`mfa-reset` template) with the same
human-readable `clearedMethods` rendering, but **`loginLink`/`securityLink` resolve off
`getMspPortalBaseUrl()`** (`:563-564`) — same base-URL choice as the Portal route's own §4g
(both already resolve exclusively through `getMspPortalBaseUrl()`, confirmed live by the
Portal pack's own `portal-team.test.ts:143-171` citation; this file has no equivalent test of
its own to re-confirm it, so this is read from source only, not test-confirmed here). Audit
`team_member_mfa_reset` with `metadata: { ..., clearedMethods }`. Response: `{ ok: true,
clearedMethods: string[] }`.

### 4h. `POST /msp/team/:userId/emergency-bypass`

(`:588-640`) No body. Same 16-hex-char `EMERGENCY-XXXX-XXXX-XXXX-XXXX` code generation
(8 random bytes, uppercased, grouped), bcrypt-hashed (cost 12), 24-hour expiry, "one active
code per user" enforcement (existing `mfa_bypass_codes` row deleted before insert, `:617`) —
byte-identical mechanics to the Portal route. Insert carries `createdByUserId` (the MSP staff
caller) and `customerId` (`resolved.customerId`, the target's real tenant — **correctly**
resolved through `resolveTargetCustomerId()`, unlike the invite route's `mspId`, §5). Audit
`team_member_emergency_bypass_generated`. Response: `{ ok: true, bypassCode: string,
expiresAt: string (ISO) }` — plaintext code returned directly, same as the Portal route. Same
highest-privilege-action-in-the-file status the Portal pack §4h calls out: a working bypass
code lets its holder skip MFA on the target's account for 24 hours, and here the holder is an
MSP staff member acting on a customer, not the customer's own manager.

---

## 5. Finding — filed

**§2's invite route writes the caller's own `mspId`, not the target tenant's real owning MSP,
onto the new user row.** `mspId` at `msp-team.ts:257` is `resolveMspIdStrict(req)` — the
calling MSP staff member's own session `mspId` claim (`resolve-msp-id.ts:75-77`, a direct
read of `req.user?.mspId`, no tenant lookup). `tenantId` on the same insert (`:258`) is
`customerId`, the **target** tenant from the route param, resolved independently via
`assertCustomerAccess`. For an MSPAdmin/MSPOperator caller these two values happen to agree,
because `assertCustomerAccess` (`requireAuth.ts:301-311`) only lets that tier reach a
`customerId` whose `tenantsTable.mspId` already equals their own `mspId` — so the mismatch is
masked for that role tier. **For a PlatformAdmin caller it is not masked**:
`assertCustomerAccess` returns `true` unconditionally for PlatformAdmin regardless of the
target tenant's real owning MSP (`requireAuth.ts:299`), so a PlatformAdmin inviting a teammate
for a customer under a *different* MSP than their own session `mspId` writes a `users` row
whose `mspId` column does not match `tenantsTable.mspId` for that same user's `tenantId` — a
real, confirmed data-integrity mismatch between the two authoritative MSP-ownership columns
for one row, producible today by the only role tier this pack found locally live (§ header:
the one real MSP-staff-tier user in this environment is a PlatformAdmin, `mspId=1`). The
correct value is `tenantsTable.mspId` for the target `customerId`, already resolvable in the
same request (`resolveTargetCustomerId`/the inline `assertCustomerAccess` call both touch the
tenant row already) — not the caller's own claim. Filed as **#2822** (sibling sub-issue of
this pack's own Feature #2567), labeled `bug`.

**Not filed** (documented for Design/implementation awareness, matching the Portal pack's own
severity judgment call for its parallel case):

- **`DELETE /msp/team/:userId/sessions` has no `createAuditLog` call** (§4a) — the exact same
  gap the Portal pack already flagged on its own sibling route, inherited here since this file
  mirrors `portal-team.ts` 1:1. One gap, two files, already on record once.
- **No `msp-team.test.ts` exists** — every wire contract in this pack is read from source, not
  confirmed by a passing test the way the Portal file's routes are (via
  `portal-team.test.ts`). Not filed as a standalone gap: this pack's own scope is extraction,
  and #2567's own build order (architect → endpoints → pack → Design → wire) has no step yet
  that depends on test coverage existing before Design can build against this contract.

---

## 6. Cross-surface edges

- **Shares every table and helper with `portal-team.ts`** — `usersTable`,
  `mfaEnrollmentsTable`, `webauthnCredentialsTable`, `userSessionsTable`,
  `passwordResetTokensTable`, `mfaChallengesTable`, `webauthnChallengesTable`,
  `mfaBypassCodesTable`, `revokeAllOtherSessions()`, `createAuditLog()`,
  `ensureClientSetupToken()`, `sendEmailFromTemplate()`/`passwordResetEmail()`. Both files can
  act on the exact same `users` row — an MSP staff member force-resetting MFA for a customer
  teammate, and that same teammate's own manager independently doing the same thing through
  the Portal route, land on the identical four-table teardown with no coordination between
  the two call paths (no lock, no "already reset by X" signal).
- **`mfa_bypass_codes.customerId` is written correctly here, in contrast to §5's `mspId`
  finding** — `resolveTargetCustomerId()`'s `resolved.customerId` (the real target tenant) is
  what §4h's insert uses, not the caller's own claim. The invite route (§2) is the one place
  in this file that reaches for the wrong source; every other route resolves the target
  correctly through the shared helper.
- **`GET /api/admin/msps`** (`msp-admin-settings.ts`, cited by the offboarding MSP-console pack
  §0.1) is a separate, unrelated read of `mspsTable`/`tenantsTable` for the PlatformAdmin
  admin-panel — no overlap with this pack's routes beyond both ultimately keying off
  `tenantsTable.mspId`, the same column §5's finding is about.
- **`artifacts/admin-panel`** has its own, entirely separate staff/team-adjacent surfaces
  (out of scope here) — not analyzed, cited only to note this pack's 10 routes are not the
  only "manage a user" surface in the platform, just the one scoped to #2567.

---

## Orphaned-endpoint check

None of the 10 routes in this pack has a live frontend caller anywhere in the current tree:

```
grep -rn "msp/team\|msp/customers.*team" artifacts/portal/src artifacts/msp-console/src \
  artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src
```

returns no matches. `artifacts/msp-console` exists and is live-registered (#2668), but is a
bare scaffold — `App.tsx` has exactly one real route (`/`, rendering a placeholder page) and
no chrome, no auth gate, and no page for Team Management. No `Design/msp-console/` export
exists yet for this Feature either. All 10 routes are real, live, and reachable by any
sufficiently-privileged session today, but none is exercised by any current UI — expected,
current state per #2567's own build order (architect → build the endpoints → regenerate the
contract pack → Design → wire), not a gap this pack invents.

---

## Not covered by this pack

Per #2638's own step-3 scope (mirrored from the Portal pack's identical language), no
page/UI-shape decisions are made here. This pack extracts what exists on `msp-team.ts` in
full (all 10 routes) — it does not decide what an MSP-console Team Management page should
look like, how the roster table should be organized relative to other MSP-console surfaces,
or which of the eight per-user mutating actions get surfaced as buttons vs. an overflow menu.
The MFA-bypass redemption route, the self-service "log out other sessions" route, and
`portal-checkout-free.ts`'s onboarding flow are the same out-of-scope adjacent surfaces the
Portal pack already named — not re-analyzed here.

---

## Provenance

Extracted 2026-09-04 against branch `agent/2638-q1523`, a new pack (no prior version of this
MSP-console-scoped surface existed). Full read of all 10 routes in `msp-team.ts` (lines
1-642), the shared `resolveTargetCustomerId()` helper, `resolveMspIdStrict()`
(`resolve-msp-id.ts:75-77`), `assertCustomerAccess()` (`requireAuth.ts:295-324`),
`ROLE_ORDER`/`requireRole()` (`:80-93`, `:205-221`), and the Drizzle schema
(`tenantsTable`, `usersTable`, `mfaBypassCodesTable`, `MSP_ROLES`). Live DB state confirmed
via direct `psql` against local `DATABASE_URL`: 2 real `msps` rows, 1 real PlatformAdmin
user, 0 MSPAdmin/MSPOperator users. Consumer sweep: `grep -rn "msp/team|msp/customers.*team"`
across `artifacts/portal/src`, `artifacts/msp-console/src`, `artifacts/msp-website`,
`artifacts/shane-mccaw-consulting`, `artifacts/admin-panel/src` found zero callers, and
confirmed `artifacts/msp-console` is a live but bare scaffold. One genuine finding (§5) filed
as **#2822**, sibling sub-issue of Feature #2567. Read-only pass: no product code, schema, or
UI was changed.

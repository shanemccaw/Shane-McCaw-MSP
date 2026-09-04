# Team Management and Invitations (MSP Console) — contract extraction pack

**#2896**, regenerating **#2638**'s pack (step 3 of **#2567**, Feature: Team Management and
Invitations, MSP Console — the operator half of #2676), under **#1571** (EPIC: Portal Admin —
MSP-side operator surface). Full line-by-line re-audit against the real, current backend, not
an incremental patch of the prior file — per #2896's own instruction and the #1642 pattern:
per-surface wire contracts extracted verbatim and cited to file:line, CURRENT vs DECIDED marked
on every field, real enum unions only, cross-surface edges, honest tri-state, forbidden list,
orphaned endpoints listed explicitly. Read-only — no product code, schema, or UI changed to
produce this document.

**This is a different surface from `docs/team-management-and-invitations-contract-pack.md`,
not a re-run of it.** That pack (#2447, part of #1656 "Feature: Team Management and
Invitations (Portal)") is scoped to the **customer-facing** half — `portal-team.ts`'s routes,
session-scoped to a CustomerUser managing their own tenant's roster. #2567 is the other half:
the **MSP-console operator** surface that lets MSP staff (MSPOperator/MSPAdmin/PlatformAdmin)
manage a roster for a customer elsewhere in their book. Same domain, same tables, two different
route files, two different actors, two different Features — same split pattern the offboarding
pair (`docs/offboarding-contract-pack.md` vs `docs/offboarding-msp-console-contract-pack.md`)
already established.

Backend route file: `artifacts/api-server/src/routes/msp-team.ts` — all 10 routes, one file,
one router, mounted at `/api` in `artifacts/api-server/src/routes/index.ts:268,550`
(`import mspTeamRouter from "./msp-team"; ... router.use(mspTeamRouter);`) — the router's own
paths already carry the literal `/msp/...` prefix, so the real mounted paths are
`/api/msp/customers/:customerId/team...` and `/api/msp/team/:userId/...`.

**No dedicated test file exists for this router** — there is no `msp-team.test.ts` alongside
`msp-team.ts`, unlike `portal-team.ts`'s own `portal-team.test.ts`. Every wire contract below
is read directly from source, not confirmed against a passing test; noted honestly rather than
implied otherwise.

## What changed since the #2638 extraction (2026-09-04)

Confirmed real by direct diff of `msp-team.ts` and its neighbors, not assumed from the issue
body alone — **one change landed that #2896's own body doesn't name**:

- **#2822 (named in #2896's body) — the invite route's `mspId` bug is fixed.** §2's insert now
  reads `tenantsTable.mspId` for the *target* tenant (a new `SELECT`, `:243-247`), not the
  caller's own session claim. This also adds a new response code: `404 { error: "Customer not
  found" }` if the target tenant row itself doesn't exist (`:248-251`) — not present in the pre-
  fix version. §5 below reflects the finding as **fixed**, not open.
- **#2832 (not named in #2896's body — found during this audit, real and current, closed same
  day, 2026-09-04T15:38:33Z) — partial error-envelope conversion.** The two `assertCustomerAccess`
  403s that gate `GET .../team` and `POST .../team/invite` (§0.1) now call
  `apiError(res, 403, ApiErrorCode.FORBIDDEN, "...")` (`:127`, `:231`) instead of hand-rolling
  `res.status(403).json({ error: "..." })`, and `requireRole`'s own 403
  (`requireAuth.ts:216`, `"Insufficient privileges — <role> or above required"`) already used
  `apiError()` before this file's routes did. **This was a partial fix, not a file-wide one** —
  see §0.3 for exactly which error paths in this file still use the old bare-string shape.
- **#2527 (named in #2896's body) — `users.managerUserId` and a manager-chain route landed, but
  entirely on the Portal side.** `portal-team.ts` gained `PATCH /portal/team/:userId/manager`
  (`portal-team.ts:315-391`) and `usersTable` gained a nullable self-referencing
  `managerUserId` column (`lib/db/src/schema/index.ts:142`, migration
  `2026-09-04-users-manager-reports-to-2527.sql`). **`msp-team.ts` has no equivalent route, and
  its roster `SELECT` (§1) does not project `managerUserId` at all.** See §6 for the
  cross-surface note — this is documented, not filed, per #2567's own build-order (extraction
  only, no page-shape decisions at this step).

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-team.ts` — all 10 routes (lines 1-662 as of this audit)
- `artifacts/api-server/src/routes/portal-team.ts` — the sibling Portal file, cited for the
  places §2 and §6 draw a direct behavioral contrast (invite's `mspId` source, now fixed; the
  TTL constant; the manager-chain route this file lacks)
- `docs/team-management-and-invitations-contract-pack.md` — the Portal pack, cited for the
  shared vocabulary (`mfaStatus` derivation, `MSP_ROLES`, per-user capability flags) this pack
  does not re-derive
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole()` (`:206-222`),
  `ROLE_ORDER`/`roleIndex` (`:81-94`), `assertCustomerAccess()` (`:294-323`), `AuthUser` shape
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict()` (`:75-77`): reads
  `req.user?.mspId` directly off the session, **no** `?mspId=`/`?slug=` override for
  PlatformAdmin (contrast `resolveMspId()`'s admin-override branch, which this file does not
  use)
- `artifacts/api-server/src/lib/api-helpers.ts` — `apiError()`/`ApiErrorCode` (`:17-47`): the
  nested `{ error: { code, message, details?, traceId? } }` envelope, now partially adopted by
  this file (§0.3)
- `artifacts/api-server/src/lib/session-tracking.ts` — `revokeAllOtherSessions()`
- `artifacts/api-server/src/lib/audit.ts` — `createAuditLog()` call shape (fire-and-forget,
  `void`-called, never blocks the response), `AuditEvent.actorRole: "admin" | "client"`
- `artifacts/api-server/src/lib/portal-url.ts` — `getPortalBaseUrl()`, `getMspPortalBaseUrl()`,
  `buildAccountSetupUrl()`
- `artifacts/api-server/src/lib/mailer.ts` — `sendEmailFromTemplate()`, `passwordResetEmail()`
- `artifacts/api-server/src/lib/client-setup-token.ts` — `ensureClientSetupToken()`
- `lib/db/src/schema/index.ts` — `usersTable` (including the new `managerUserId` column),
  `mfaEnrollmentsTable`, `webauthnCredentialsTable`, `passwordResetTokensTable`,
  `mfaChallengesTable`, `webauthnChallengesTable`, `mfaBypassCodesTable`, `MSP_ROLES` (real
  column/enum sources)
- `lib/db/src/schema/msp.ts` — `userSessionsTable`, `tenantsTable` (`mspId` is `notNull`, FK'd
  to `mspsTable` — the real, authoritative owning-MSP column for a tenant)
- `artifacts/msp-console/src/App.tsx`, `src/pages/index.tsx` — comparison surface for the
  orphaned-endpoint check; the app is scaffolded (#2668) but still has exactly one real route
  (`/`) and no team page

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-04 — unchanged since the
#2638 extraction):

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
is the single PlatformAdmin (`id=1`, `mspId=1`, `role="admin"`). No route in this pack has ever
been called by anything but a PlatformAdmin against this environment.

---

## 0. Authorization model — shared shape, but NOT the Portal file's `denyIfCannotManageTeam`

Every route in this file is gated by `requireRole("MSPOperator")` first (MSPOperator, MSPAdmin
or PlatformAdmin pass; `ROLE_ORDER`, `requireAuth.ts:81-94`). This file deliberately does
**not** call `denyIfCannotManageTeam` (the Portal file's own two-gate helper, contract pack
§0) — its second gate, the per-user `canManageTeam` DB flag, "only ever applies to the
customer tier... MSP staff and PlatformAdmin bypass this second check entirely" (Portal pack
§0). Role is already the gate here; the only remaining question is tenant ownership + per-
staff-member scoping, answered by `assertCustomerAccess` — the same helper
`denyIfCannotManageTeam` itself calls first (`msp-team.ts:28-39` header comment).

Two shapes of that check appear in this file:

### 0.1 `GET`/`POST .../team[/invite]`

`customerId` comes from `req.params.customerId` directly; 400 `{ error: "Invalid customerId" }`
on `NaN` (bare-string, §0.3), then `assertCustomerAccess(req.user!, customerId)` → 403 via
`apiError(res, 403, ApiErrorCode.FORBIDDEN, "Access to this customer is not permitted")`
(`:126-129`, `:230-233` — **nested shape, since #2832**) on failure.

### 0.2 Every `.../team/:userId/...` mutating route

`resolveTargetCustomerId(req)` (`:83-101`), a private helper unique to this file (no equivalent
named export in `portal-team.ts`, which inlines the same three steps per-route instead): parses
`userId` → `{ status: 400, error: "Invalid userId" }` on `NaN` → looks up the target's
`tenantId` via a single `usersTable` row select → `{ status: 404, error: "Team member not
found" }` if that row or its `tenantId` is missing → `assertCustomerAccess(req.user!,
target.customerId)` → `{ status: 403, error: "Access to this team member is not permitted" }`
on failure. Every caller of this helper does the same thing with the result:
`res.status(resolved.status).json({ error: resolved.error })` (`:321,346,391,419,452,503,545,
612`, all 8 §4 routes) — **plain bare-string shape, unchanged by #2832**. Same "404 before 403"
ordering as the Portal file's §0 (a request against a nonexistent user id 404s rather than
403ing).

### 0.3 Real, current envelope inconsistency (found during this audit, not filed as a new
issue — see §5)

As of #2832 (closed 2026-09-04T15:38:33Z, same day as this pack), **this single file now
answers logically identical "you can't act on this customer/user" 403s in two different
shapes depending on which gate produced them**:

| Path | Shape |
|---|---|
| §0.1's two `assertCustomerAccess` 403s (`GET .../team`, `POST .../team/invite`) | `apiError()` nested: `{ error: { code: "FORBIDDEN", message: "...", traceId? } }` |
| `requireRole("MSPOperator")`'s own 403 (every route, `requireAuth.ts:216`) | `apiError()` nested — was already this shape before #2832 |
| §0.2's `resolveTargetCustomerId` 400/403/404 (all 8 `.../team/:userId/...` routes) | bare-string: `{ error: "..." }` |
| `customerId`/`mspId` 400s in §0.1's two routes (`"Invalid customerId"`, `"No MSP context resolved for this session"`) | bare-string: `{ error: "..." }` |
| Invite's new `404 { error: "Customer not found" }` (#2822) | bare-string: `{ error: "..." }` |

A client written against the now-standardized `apiError()` shape gets `undefined` reading
`.error.message` from any of the 8 `.../team/:userId/...` routes' error responses, or from
either of §0.1's own two `400`s, or from the new invite `404` — the same class #2832 fixed for
two call sites in this exact file, still live everywhere else in it. #2832's own scope was
explicitly the sites it listed (`msp-team.ts:125,229` pre-fix line numbers — the two
`assertCustomerAccess` 403s only), not a file-wide sweep.

Both `GET .../team` and every mutating route in this file require the `requireRole` role
gate — **unlike** the Portal file's `GET /portal/team`, which has no `denyIfCannotManageTeam`
gate at all (any authenticated tenant member can view their own roster). There is no
read-without-role-gate case in this file.

Every route additionally calls `resolveMspIdStrict(req)` or resolves `customerId`/`userId`
before doing anything else — `mspId` itself is used only as a **presence check** on the two
§0.1 routes (400 `{ error: "No MSP context resolved for this session" }` if the caller's
session carries no `mspId` claim, `:114-118`, `:218-222`), never as a query filter. The routes'
actual data scope is entirely `customerId`/`target.tenantId`-driven via `assertCustomerAccess`,
not `mspId`-driven.

---

## 1. Wire contract — `GET /api/msp/customers/:customerId/team`

Auth: `requireRole("MSPOperator")` + `assertCustomerAccess` against the `:customerId` route
param (§0.1). No query params, no pagination — every `users` row for the target tenant
(`eq(usersTable.tenantId, customerId)`, `:131-145`), unfiltered by role/active-status. Returns
`[]` immediately if the tenant has zero users (`:147-150`) — no batched lookups run in that
case, same short-circuit as the Portal roster route.

Otherwise, three parallel queries (`Promise.all`, `:154-174`) build a per-user summary — **the
same shape as the Portal roster**, with one real, load-bearing difference in `lastLoginAt`'s
derivation (below):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `users.id` (aliased twice, same as the Portal roster — see `userId`) |
| `userId` | `number` | not null | `users.id` — same value as `id`, both keys present (`:191-192`) |
| `email` | `string` | not null | `users.email` |
| `name` | `string \| null` | nullable | `users.name` |
| `phone` | `string \| null` | nullable | `users.phone` |
| `isActive` | `boolean` | not null | `users.is_active` |
| `isLockedOut` | `boolean` | not null (derived) | `Boolean(lockedUntil && lockedUntil > now())` (`:197`) — identical derivation to the Portal roster |
| `mfaStatus` | `"TOTP" \| "FIDO2" \| "SMS" \| "Disabled"` | not null (derived) | `reduceMfaStatus()` (`:103-108`, byte-identical precedence to the Portal file's own copy — passkey beats totp beats sms beats Disabled) |
| `mfaEnforced` | `boolean` | not null | `users.mfa_enforced` |
| `department` | `string` | not null (coerced) | `users.department ?? ""` |
| `jobTitle` | `string` | not null (coerced) | `users.job_title ?? ""` |
| `lastLoginAt` | `string \| null` (ISO, from `max()`) | nullable | `max(user_sessions.created_at)` where `session_type = "standard"` (`:170-173`) — same derived-not-column source as the Portal roster (Portal pack §5's own finding applies identically here, not re-filed) |
| `createdAt` | `string` (ISO) | not null | `users.created_at` |
| `activeSessionsCount` | `number` | not null (derived, default `0`) | `count(*)` of `user_sessions` rows, `session_type = "standard"`, `revoked_at IS NULL`, `expires_at >= now()`, grouped by `user_id` (`:161-169`) |

**`managerUserId` is not in this SELECT or the response shape** — #2527's new column exists on
`usersTable` but this route's field list (`:132-142`) was not extended to project it. See §6.

No sort applied — rows return in whatever order the tenant-scoped `SELECT` produces (no
`ORDER BY`, `:131-145`), identical to the Portal roster's own lack of ordering.

**One structural difference from the Portal roster worth Design knowing:** the Portal route's
parallel queries include a passkey-rows lookup merged into `methodsByUser` the same way this
file does at `:158-160` and `:182-186`. The initial `SELECT` on `usersTable` (`:132-142`) is
column-for-column the same set the Portal roster pulls (still true after #2527 — neither file's
roster SELECT projects `managerUserId`). No field-shape drift between the two roster payloads —
Design can treat `GET .../team` (MSP) and `GET /portal/team` (Portal) as byte-identical
response shapes for a given tenant.

---

## 2. Wire contract — `POST /api/msp/customers/:customerId/team/invite`

Auth: `requireRole("MSPOperator")` + `assertCustomerAccess` against the `:customerId` route
param (§0.1) — **not** `denyIfCannotManageTeam`; there is no per-caller `canManageTeam` DB
flag check on this route at all (that flag only ever gates the customer tier, §0). Any
MSPOperator/MSPAdmin/PlatformAdmin whose `assertCustomerAccess` passes for the target
`customerId` can invite, full stop.

**Fixed since the #2638 extraction (#2822):** before the body validation and the email-
uniqueness check, this route now does a `SELECT tenantsTable.mspId WHERE tenantsTable.id =
customerId` (`:243-247`). `404 { error: "Customer not found" }` (bare-string, §0.3) if that
tenant row doesn't exist (`:248-251`) — a new response code not present pre-fix. The resolved
`targetTenant.mspId` is what's written to the new user row (§ table below), not the caller's
own session claim.

Request body: `{ email: string (required), name?: string, department?: string, jobTitle?:
string }` — identical shape to the Portal invite route. 400 `{ error: "email is required" }`
if missing/blank (`:259-262`, bare-string). Email lower-cased and trimmed before any lookup or
insert (`:263`).

409 `{ error: "An account with this email already exists" }` if a `users` row with that exact
(normalized) email already exists **anywhere in the system** (`:265-270`, bare-string) — same
global uniqueness check as the Portal route (`usersTable.email` DB-level `unique()`).

On success, inserts a new `users` row (`:272-283`):

| Column | Value |
|---|---|
| `email` | normalized input |
| `passwordHash` | `null` |
| `role` | `"client"` (legacy admin/client column) |
| `name` | trimmed input or `null` |
| `mspId` | **`targetTenant.mspId` — the target tenant's own real owning MSP, resolved via `tenantsTable` (fixed by #2822; was `resolveMspIdStrict(req)`, the caller's own claim, prior to that fix)** |
| `tenantId` | `customerId` (the target tenant, from the route param) |
| `mspRole` | `"CustomerUser"` — same flat tier as every Portal-invited teammate; no invite-time way to grant `canManageTeam` (same open product question the Portal pack §5 already flagged, not re-raised here) |
| `isActive` | `true` |
| `department` | trimmed input or `null` |
| `jobTitle` | trimmed input or `null` |

No `managerUserId` is set at invite time on either surface — a new teammate always starts with
no manager, set afterward (Portal-side only, §6) via the separate `PATCH .../manager` route.

Fires (non-blocking, `void`-called, failures logged but never surfaced to the caller):

- `createAuditLog({ actionType: "team_member_invited", ..., metadata: { actorSurface: "msp",
  customerId } })` (`:285-292`) — the `actorSurface: "msp"` tag is new relative to the Portal
  route's own call (which carries no `actorSurface` key at all, contract pack §2) and appears
  on **every** audit call in this file (§4) — the one systematic, deliberate wire difference
  between the two Feature's audit trails.
- `ensureClientSetupToken(newUser.id)` → `buildAccountSetupUrl(setupToken)` →
  `sendEmailFromTemplate("account-setup", ...)`, same 72-hour-expiry setup link, same
  best-effort wrapping so a token/email failure still returns `201` (`:294-306`)

Response: `201 { ok: true }` — same as the Portal route, no id/email echoed back.

---

## 3. Enum / vocabulary reference — delta from the Portal pack only

This pack does not re-derive `mfaStatus`'s reduction rule, `mfa_enrollments.method`,
`user_sessions.session_type`/`login_method`, or `MSP_ROLES`' member list — all identical to
the Portal pack §3, cited there. The additions specific to this surface:

- **`ROLE_ORDER` (`requireAuth.ts:81-94`) is the real privilege order this file's
  `requireRole("MSPOperator")` gate compares against — NOT `MSP_ROLES`'s declared array
  order.** Lowest to highest: `Assessment < Free < CustomerUser < ServiceAccount <
  MSPOperator < MSPAdmin < PlatformAdmin`. Every route in this file passes for
  MSPOperator/MSPAdmin/PlatformAdmin and rejects everything below MSPOperator — including
  CustomerUser, so a customer-tier user (even one with `canManageTeam = true`) cannot reach
  any route in this file; the two Features are mutually exclusive by role, not by any shared
  runtime check.
- **`tenantsTable.mspId`** (`msp.ts`) — `notNull`, FK'd to `mspsTable.id` — is the real, single
  source of truth for which MSP owns a given tenant. §2's invite route now reads this column
  directly for the target tenant (post-#2822); it is no longer derived from the caller's own
  claim.
- **`ApiErrorCode`** (`api-helpers.ts:17-27`) — the enum backing the nested error envelope this
  file now partially uses (`FORBIDDEN` only, on the two §0.1 sites; see §0.3 for exactly which
  paths in this file have and haven't adopted it).
- **`usersTable.managerUserId`** (`index.ts:142`) — nullable, self-referencing FK to
  `usersTable.id`, `onDelete: "set null"`. Real column, real data (#2527), but **not read or
  written anywhere in this file** — see §6.

---

## 4. Remaining mutating routes — `POST/PATCH/DELETE /api/msp/team/:userId/...`

Every route below shares the common shape from §0.2 (parse `userId` → 400 on `NaN` → resolve
target's `tenantId` → 404 if missing → `assertCustomerAccess` → 403 on failure, all bare-
string per §0.3) via the shared `resolveTargetCustomerId()` helper, and is omitted from the
table cells that would just repeat it. Every mutating route's `createAuditLog` call carries
`metadata: { actorSurface: "msp", customerId: resolved.customerId }` — cited once here, not
repeated per route below.

### 4a. `DELETE /msp/team/:userId/sessions`

(`:317-332`) Revokes every one of the target's own **other** standard sessions via
`revokeAllOtherSessions(targetUserId, null)` — `exceptTokenHash: null`, same "no exclusion"
shape as the Portal route's own §4a (caller and target are always different users here by
construction). Response: `{ ok: true, revokedCount: number }`. **Same gap as the Portal
file's own §4a**: no `createAuditLog` call on this route — the one mutating route in *this*
file, too, that fires no audit row. Not re-filed (Portal pack §5 already flagged the identical
gap on the sibling route); this file inherited the same omission when it was written to mirror
`portal-team.ts` 1:1.

### 4b. `PATCH /msp/team/:userId/status`

(`:336-377`) Body: `{ isActive: boolean }` — 400 `{ error: "isActive must be a boolean" }` if
not strictly boolean. Same self-suspend guard as the Portal route: 400 `{ error: "You cannot
suspend your own account" }` if `targetUserId === req.user!.id && !isActive` (`:352-355`) —
an MSP staff member could theoretically be their own tenant's `users` row target only if they
somehow appear in their own book's roster, an edge case this guard covers defensively rather
than one confirmed reachable today. On success: `UPDATE users SET is_active = isActive`;
audit `team_member_activated` / `team_member_suspended`; if suspending, fire-and-forget
`revokeAllOtherSessions(targetUserId, null)`. Response: `{ ok: true, isActive }`.

### 4c. `PATCH /msp/team/:userId/mfa-enforcement`

(`:381-411`) Body: `{ enforced: boolean }`, same 400 typeof-guard as §4b. `UPDATE users SET
mfa_enforced = enforced`. Audit `team_member_mfa_enforcement_enabled` / `_disabled`. Response:
`{ ok: true, mfaEnforced: enforced }`. Same "takes effect on next login, not current session"
behavior as the Portal route (shared schema comment).

### 4d. `POST /msp/team/:userId/unlock`

(`:415-442`) No body. `UPDATE users SET failed_login_attempts = 0, last_failed_login_at =
NULL, locked_until = NULL` — same full lockout-state reset as the Portal route. Audit
`team_member_unlocked`. Response: `{ ok: true, isLockedOut: false }` — hardcoded post-update
state, not re-queried, same as the Portal route.

### 4e. `POST /msp/team/:userId/reset-password`

(`:448-495`) No body. Mints a `password_reset_tokens` row (`token`: 32 random bytes hex,
`expiresAt`: now + `TEAM_RESET_TOKEN_TTL_MS`, `:444`). **`TEAM_RESET_TOKEN_TTL_MS = 60 * 60 *
1000` — 1 hour, the same value and the same comment ("matches /auth/forgot-password and
portal-team.ts") as the Portal file's own constant** (Portal pack §2b cites the identical
value) — the two files each declare their own copy of this constant rather than sharing one,
but the values agree; not a drift. Emails the target a reset link via `getPortalBaseUrl()`
(not `getMspPortalBaseUrl()` — the reset-password page itself is a Portal route, reached the
same way regardless of which surface triggered the reset) and `passwordResetEmail()`. Audit
`team_member_password_reset_email_sent`. Response: `{ ok: true }` — no token/link returned to
the caller.

### 4f. `POST /msp/team/:userId/temp-password`

(`:499-537`) No body. Same fixed pattern as the Portal route: `Temp-${6 random bytes hex,
uppercased}!9`, bcrypt-hashed (cost 12), `UPDATE users SET password_hash = ...`. Audit
`team_member_temp_password_set`. Response: `{ ok: true, tempPassword: string }` — **the
plaintext temp password is returned directly**, same as the Portal route; the MSP staff caller
is expected to relay it to the customer teammate out-of-band. No email sent.

### 4g. `POST /msp/team/:userId/reset-mfa`

(`:541-604`) No body. Reads current enrollments + passkey presence to build `clearedMethods:
string[]`, then deletes all four MFA-related tables for the target (`mfa_enrollments`,
`mfa_challenges`, `webauthn_credentials`, `webauthn_challenges`, `:572-575`) — full teardown,
identical to the Portal route. Emails the target (`mfa-reset` template) with the same
human-readable `clearedMethods` rendering, but **`loginLink`/`securityLink` resolve off
`getMspPortalBaseUrl()`** (`:583-584`) — same base-URL choice as the Portal route's own §4g
(both already resolve exclusively through `getMspPortalBaseUrl()`, confirmed live by the
Portal pack's own `portal-team.test.ts` citation; this file has no equivalent test of its own
to re-confirm it, so this is read from source only, not test-confirmed here). Audit
`team_member_mfa_reset` with `metadata: { ..., clearedMethods }`. Response: `{ ok: true,
clearedMethods: string[] }`.

### 4h. `POST /msp/team/:userId/emergency-bypass`

(`:608-660`) No body. Same 16-hex-char `EMERGENCY-XXXX-XXXX-XXXX-XXXX` code generation
(8 random bytes, uppercased, grouped), bcrypt-hashed (cost 12), 24-hour expiry, "one active
code per user" enforcement (existing `mfa_bypass_codes` row deleted before insert, `:637`) —
byte-identical mechanics to the Portal route. Insert carries `createdByUserId` (the MSP staff
caller) and `customerId` (`resolved.customerId`, the target's real tenant — resolved through
`resolveTargetCustomerId()`, the same correctly-sourced pattern the invite route now also
follows post-#2822). Audit `team_member_emergency_bypass_generated`. Response: `{ ok: true,
bypassCode: string, expiresAt: string (ISO) }` — plaintext code returned directly, same as the
Portal route. Same highest-privilege-action-in-the-file status the Portal pack §4h calls out: a
working bypass code lets its holder skip MFA on the target's account for 24 hours, and here the
holder is an MSP staff member acting on a customer, not the customer's own manager.

---

## 5. Findings — status

**§2's old finding is fixed, not open.** The #2638 pack filed **#2822** ("invite writes the
caller's own `mspId`, not the target tenant's real owning MSP") — confirmed closed and landed
on `main` (`f0533274d`, "Fix msp-team.ts invite writing caller's mspId instead of target
tenant's owning MSP (#2822)"). Verified by reading the current insert (§2 table above): `mspId`
is now `targetTenant.mspId`, read from `tenantsTable` for the target `customerId` in the same
request, not `resolveMspIdStrict(req)`. Nothing left to re-file on this point.

**Not filed** (documented for Design/implementation awareness, matching the Portal pack's own
severity judgment call for its parallel cases):

- **`DELETE /msp/team/:userId/sessions` has no `createAuditLog` call** (§4a) — the exact same
  gap the Portal pack already flagged on its own sibling route, inherited here since this file
  mirrors `portal-team.ts` 1:1. One gap, two files, already on record once.
- **No `msp-team.test.ts` exists** — every wire contract in this pack is read from source, not
  confirmed by a passing test the way the Portal file's routes are (via `portal-team.test.ts`).
  Not filed as a standalone gap: this pack's own scope is extraction, and #2567's own build
  order (architect → endpoints → pack → Design → wire) has no step yet that depends on test
  coverage existing before Design can build against this contract.
- **§0.3's mixed error envelope** (bare-string on 8 of this file's routes and 3 of its own 400/
  404 paths, nested `apiError()` on the two `assertCustomerAccess` 403s and the shared role
  gate) is real and current, but is the same class #2113/#2832 already track — this pack
  documents the specific current split for Design/implementation awareness rather than filing
  it as a new issue, since finishing the sweep #2832 started is squarely that pair's own
  continuation, not a new discovery about this Feature's own domain.

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
- **`mfa_bypass_codes.customerId` is written correctly here** (§4h) — `resolveTargetCustomerId()`'s
  `resolved.customerId` (the real target tenant) is what the insert uses, not the caller's own
  claim, the same correctly-sourced pattern §2's invite route now also follows post-#2822.
- **`usersTable.managerUserId` (#2527) is Portal-only.** `portal-team.ts` gained
  `PATCH /portal/team/:userId/manager` — same-tenant validation, cycle guard, feeds
  `notifyOwnershipDeclined`'s manager-chain walk (`notification-center.ts`) elsewhere in the
  platform. This file has **no route to set or clear a target's manager**, and §1's roster
  `SELECT` does not project `managerUserId` into the response at all — an MSP staff member
  managing a customer's roster from the MSP console has no way to see or set who reports to
  whom for that tenant, even though the column and the Portal-side mutation both exist. Not
  filed: #2567's own build order for this Feature is extraction-only at this step (architect →
  endpoints → contract pack → Design → wire), and whether the MSP console should expose manager-
  chain management at all is a page-shape/scope decision for Design, not something this
  extraction pack settles.
- **`GET /api/admin/msps`** (`msp-admin-settings.ts`, cited by the offboarding MSP-console pack
  §0.1) is a separate, unrelated read of `mspsTable`/`tenantsTable` for the PlatformAdmin
  admin-panel — no overlap with this pack's routes beyond both ultimately keying off
  `tenantsTable.mspId`, the same column §2's now-fixed invite route reads.
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

returns no matches. `artifacts/msp-console` exists and is live-registered (#2668), but is still
a bare scaffold — `App.tsx` has exactly one real route (`/`, rendering a placeholder page) and
no chrome, no auth gate, and no page for Team Management. No `Design/msp-console/` export
exists yet for this Feature either. All 10 routes are real, live, and reachable by any
sufficiently-privileged session today, but none is exercised by any current UI — expected,
current state per #2567's own build order (architect → build the endpoints → regenerate the
contract pack → Design → wire), not a gap this pack invents.

---

## Not covered by this pack

Per #2638's own step-3 scope (mirrored from the Portal pack's identical language, unchanged by
#2896), no page/UI-shape decisions are made here. This pack extracts what exists on
`msp-team.ts` in full (all 10 routes) — it does not decide what an MSP-console Team Management
page should look like, how the roster table should be organized relative to other MSP-console
surfaces, whether/how manager-chain management should be surfaced on this side (§6), or which
of the eight per-user mutating actions get surfaced as buttons vs. an overflow menu. The
MFA-bypass redemption route, the self-service "log out other sessions" route, and
`portal-checkout-free.ts`'s onboarding flow are the same out-of-scope adjacent surfaces the
Portal pack already named — not re-analyzed here.

---

## Provenance

Regenerated 2026-09-04 against branch `agent/2896-q1649`, per #2896's own instruction: full
line-by-line audit against the real, current backend, not an incremental patch of the #2638
pack. Full re-read of all 10 routes in `msp-team.ts` (lines 1-662), the shared
`resolveTargetCustomerId()` helper, `resolveMspIdStrict()` (`resolve-msp-id.ts:75-77`),
`assertCustomerAccess()` (`requireAuth.ts:294-323`), `ROLE_ORDER`/`requireRole()`
(`:81-94`, `:206-222`), `apiError()`/`ApiErrorCode` (`api-helpers.ts:17-47`), and the Drizzle
schema (`tenantsTable`, `usersTable` including the new `managerUserId` column,
`mfaBypassCodesTable`, `MSP_ROLES`). Confirmed by real diff against the #2638 pack and git
history: **#2822** (named in #2896's body) landed and closed — §2/§5 updated to reflect the
fix, not re-file it. **#2832** (real and current, closed the same day, *not* named in #2896's
body — found during this audit) landed a partial error-envelope conversion — §0.3 documents
exactly which paths in this file adopted the new shape and which didn't. **#2527** (named in
#2896's body) landed `users.managerUserId` and a manager-chain route, but Portal-side only —
§6 documents the gap on this MSP-console side, not filed (page-shape/scope decision, not an
extraction-pack finding). Live DB state re-confirmed via direct `psql` against local
`DATABASE_URL`: 2 real `msps` rows, 1 real PlatformAdmin user, 0 MSPAdmin/MSPOperator users —
unchanged since the #2638 extraction. Consumer sweep: `grep -rn "msp/team|msp/customers.*team"`
across `artifacts/portal/src`, `artifacts/msp-console/src`, `artifacts/msp-website`,
`artifacts/shane-mccaw-consulting`, `artifacts/admin-panel/src` found zero callers, and
confirmed `artifacts/msp-console` is still a live but bare scaffold. Zero new findings filed —
the one open item from the prior pack (§5) is now fixed in code, and the two newly-observed
items (§0.3's mixed error envelope, §6's manager-chain gap) are documented rather than filed,
for the reasons stated at each. Read-only pass: no product code, schema, or UI was changed.

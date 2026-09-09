# Team Management and Invitations (Portal) — contract extraction pack

**Issue:** #2895, part of #1656 ("Feature: Team Management and Invitations (Portal)"), part
of #1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below traces
to one of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

**Regeneration note (#2895 — supersedes the #2447 extraction):** the real surface grew by one
route since the last pack. #2527 landed the buildable half of #1519's "escalates internally,
to the assigner or up their chain" — a real, nullable, self-referencing `usersTable.managerUserId`
column, written only by a new eleventh route (`PATCH /portal/team/:userId/manager`), and read by
`notifyOwnershipDeclined()` (`notification-center.ts`, out of scope for this pack, cited at §6)
to walk the chain on a customer-side Ownership/RACI decline. Everything else in this pack was
re-verified line-by-line against the current backend, not carried forward unchecked; two file:line
citations drifted (noted where they occur) and are corrected below.

`artifacts/api-server/src/routes/portal-team.ts` — **11** distinct routes, one file, one router,
mounted at `/api` in `artifacts/api-server/src/routes/index.ts:13,354` (`import portalTeamRouter
from "./portal-team"; ... router.use(portalTeamRouter);`) — the router's own paths already carry
the literal `/portal/team/...` prefix, so the real mounted path is `/api/portal/team/...`
(confirmed by the route file's own test, `portal-team.test.ts:127-131`).

**All 11 routes are currently orphaned — no live frontend consumer**, re-confirmed this pass:

```
grep -rn "portal/team" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

returns no matches. `artifacts/msp-portal` (the old portal-v2 codebase whose `customer-team.tsx`
called these — 1,369 lines against this same backend, per #1656's own body) was retired wholesale
on 2026-08-29 (`f40438cdc`, preserved at tag `portal-archive-2026-08-29`); the replacement
`artifacts/portal` scaffold under #1485 still has no page calling any of these routes, and no
`Design/portal/` export exists for Team Management. That is real, current state, not a gap this
pack invents.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-team.ts` — all 11 routes
- `artifacts/api-server/src/routes/portal-team.test.ts` — real mount path, real request/response
  shapes exercised by the one live test (`reset-mfa`, #172) — **no test coverage exists for the
  new manager route (§4i)**, noted at §5
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser` shape, `assertCustomerAccess`
  (the tenant-isolation gate, now at `:294-321`, drifted from the prior pack's `:295-324`),
  `MSP_ROLES` role-hierarchy comparison
- `artifacts/api-server/src/lib/session-tracking.ts` — `revokeAllOtherSessions()`
- `artifacts/api-server/src/lib/audit.ts` — `createAuditLog()` call shape (fire-and-forget,
  `void`-called, never blocks the response)
- `artifacts/api-server/src/lib/client-setup-token.ts` — `ensureClientSetupToken()`
- `artifacts/api-server/src/lib/portal-url.ts` — `getPortalBaseUrl()`, `getMspPortalBaseUrl()`,
  `buildAccountSetupUrl()`
- `artifacts/api-server/src/lib/mailer.ts` — `sendEmailFromTemplate()`, `passwordResetEmail()`
- `artifacts/api-server/src/lib/notification-center.ts` — `notifyOwnershipDeclined()`, the one
  real reader of `managerUserId` (out of scope, cross-surface edge only, §6)
- `lib/db/src/schema/index.ts` — `usersTable` (including the new `managerUserId` column,
  `:131-142`), `mfaEnrollmentsTable`, `webauthnCredentialsTable`, `passwordResetTokensTable`,
  `mfaChallengesTable`, `webauthnChallengesTable`, `mfaBypassCodesTable`, `MSP_ROLES` (real
  column/enum sources)
- `lib/db/src/schema/msp.ts` — `userSessionsTable`
- `lib/db/migrations/manual/2026-09-04-users-manager-reports-to-2527.sql` — the real, additive
  migration that added `manager_user_id`, confirmed run (`simulator_migration_runs` self-mark)
- `artifacts/portal/src/App.tsx` — comparison surface for the orphaned-endpoint check

---

## 0. Authorization model — shared by every mutating route (Git #1142)

`denyIfCannotManageTeam(user, targetCustomerId)` (`portal-team.ts:40-55`) gates every route in
this file except the read-only `GET /portal/team`. Two ordered checks:

1. **Tenant isolation** — `assertCustomerAccess(user, targetCustomerId)`
   (`requireAuth.ts:294-321`): PlatformAdmin always; MSPAdmin/MSPOperator iff the target
   tenant belongs to their MSP (plus per-staff-member scope, `isCustomerBlockedByStaffScope`);
   CustomerUser/Free/Assessment iff `user.customerId === targetCustomerId` (own tenant only).
   Failing this returns 403 before the second check runs.
2. **Team-admin capability** — only applies to the customer tier (CustomerUser/Free/
   Assessment). That tier must additionally carry `usersTable.canManageTeam = true`, read LIVE
   from the DB on every call (`portal-team.ts:49-54`) — never cached in the JWT, so revoking the
   flag takes effect on the caller's very next request, no token refresh needed. MSP staff and
   PlatformAdmin bypass this second check entirely (role is the gate for them).

Both denial paths answer a uniform `403 { error: "Access to this team member is not permitted"
}` (or the invite route's own wording) — the response never leaks which of the two gates
failed. `canManageTeam` mirrors the shape of `usersTable.canApprovePurchases` (purchase-approval
authority) and `usersTable.canApproveChanges` (change-control approval authority) — three
distinct per-user capability flags on the same table, deliberately not merged, since each
grants a different authority nobody should get by accident from one flag (`index.ts:88-113`
comments). The new §4i manager-assignment route gates on this same flag — there is no separate
"who may set reporting lines" capability.

Every mutating route additionally: parses `req.params.userId` with `parseInt(...,10)`, 400s
`{ error: "Invalid userId" }` on `NaN`; looks up the target's `tenantId` (called `customerId` in
route-local variable names) via a single `usersTable` row select, 404s `{ error: "Team member
not found" }` if that row or its `tenantId` is missing, **before** the authorization check runs
— so a request against a nonexistent user id 404s rather than 403ing.

---

## 1. Wire contract — `GET /portal/team`

Auth: `requireAuth` only — no `denyIfCannotManageTeam` gate; any authenticated member of the
caller's own tenant can view the roster (`:168-173`). 403 `{ error: "Only customer team members
can view the team roster" }` if the caller has no `customerId` claim (i.e. not a customer-tier
session).

No query params, no pagination. Scoped by `eq(usersTable.tenantId, customerId)` — every user row
belonging to the caller's own tenant, unfiltered by role/active-status (`:175-189`). Returns `[]`
immediately if the tenant has zero users (`:191-194`) — no batched lookups run in that case.

Otherwise, four parallel queries (`Promise.all`, `:198-218`) build a per-user summary:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `users.id` (aliased twice — see `userId` below) |
| `userId` | `number` | not null | `users.id` — same value as `id`, both keys present in the response object (`:235-236`) |
| `email` | `string` | not null | `users.email` |
| `name` | `string \| null` | nullable | `users.name` |
| `phone` | `string \| null` | nullable | `users.phone` |
| `isActive` | `boolean` | not null | `users.is_active` |
| `isLockedOut` | `boolean` | not null (derived) | `Boolean(lockedUntil && lockedUntil > now())` — computed server-side, not a raw column |
| `mfaStatus` | `"TOTP" \| "FIDO2" \| "SMS" \| "Disabled"` | not null (derived) | `reduceMfaStatus()` (§3) over enabled `mfa_enrollments` + any `webauthn_credentials` row |
| `mfaEnforced` | `boolean` | not null | `users.mfa_enforced` |
| `department` | `string` | not null (coerced) | `users.department ?? ""` — null column coerced to empty string, not passed through as `null` |
| `jobTitle` | `string` | not null (coerced) | `users.job_title ?? ""` — same coercion |
| `lastLoginAt` | `string \| null` (ISO, from `max()`) | nullable | `max(user_sessions.created_at)` where `session_type = "standard"`, **not** `users.last_login_at` — the route reads the derived session-history max, ignoring the dedicated `users.last_login_at` column entirely (see §5 finding) |
| `createdAt` | `string` (ISO) | not null | `users.created_at` |
| `activeSessionsCount` | `number` | not null (derived, default `0`) | `count(*)` of `user_sessions` rows where `session_type = "standard"`, `revoked_at IS NULL`, `expires_at >= now()`, grouped by `user_id` |

`reduceMfaStatus()` precedence (`:161-166`): `passkey` (any `webauthn_credentials` row, method
tag `"passkey"`) beats `totp` beats `sms` beats `"Disabled"` — a user with both TOTP and a
passkey enrolled reports `"FIDO2"`, not `"TOTP"`. This is a single reduced status, not a list of
every enrolled method.

No sort is applied — rows return in whatever order the tenant-scoped `SELECT` produces (no
`ORDER BY` clause at `:175-189`).

**`GET /portal/team` does not return `managerUserId`.** The new self-referencing column exists
on `users` and is set/read elsewhere (§4i, §6), but the roster route's own `SELECT` (`:176-187`)
was not extended to project it — a caller of this route cannot see a member's current manager
without a separate call. Real, current state; see §5 for whether this rises to a finding.

---

## 2. Wire contract — `POST /portal/team/invite`

Auth: `requireAuth` + `denyIfCannotManageTeam(user, inviterCustomerId)` (§0) against the
**caller's own tenant** — `assertCustomerAccess` always trivially passes here (self-tenant), so
this call is effectively pure `canManageTeam` gating for the customer tier. 403 `{ error: "Only
customer team members can invite teammates" }` if the caller has no `customerId`/`mspId` claim
(`:86-91`); 403 `{ error: "You do not have permission to manage your team" }` if the capability
check fails (`:96-100`).

Request body: `{ email: string (required), name?: string, department?: string, jobTitle?:
string }`. 400 `{ error: "email is required" }` if missing/blank (`:108-111`). Email is
lower-cased and trimmed before any lookup or insert (`:112`).

409 `{ error: "An account with this email already exists" }` if a `users` row with that exact
(normalized) email already exists anywhere in the system — this is a global uniqueness check
(`usersTable.email` has a DB-level `unique()` constraint, `index.ts` schema), not scoped to the
inviter's tenant (`:114-119`).

On success, inserts a new `users` row (`:121-132`):

| Column | Value |
|---|---|
| `email` | normalized input |
| `passwordHash` | `null` — no password until account setup is completed |
| `role` | `"client"` (legacy admin/client column, unrelated to `mspRole`) |
| `name` | trimmed input or `null` |
| `mspId` | inviter's `mspId` |
| `tenantId` | inviter's `customerId` |
| `mspRole` | `"CustomerUser"` — every invited teammate lands at the flat CustomerUser tier; there is no invite-time way to grant `canManageTeam` (see §5) |
| `isActive` | `true` |
| `department` | trimmed input or `null` |
| `jobTitle` | trimmed input or `null` |

`managerUserId` is **not** one of the inserted columns — a newly invited teammate always starts
with no manager on file (column default `NULL`), the same as every pre-#2527 row; invite carries
no `managerUserId` input field.

Fires (non-blocking, `void`-called, failures logged but never surfaced to the caller):

- `createAuditLog({ actionType: "team_member_invited", ... })` (`:134-142`)
- `ensureClientSetupToken(newUser.id)` → `buildAccountSetupUrl(setupToken)` →
  `sendEmailFromTemplate("account-setup", ...)` with a 72-hour-expiry setup link
  (`:144-156`) — both the token-generation and the email-send are wrapped so a failure in
  either still returns `201` to the caller (the invite row already exists; only the
  notification is best-effort)

Response: `201 { ok: true }` — the created user's id/email are **not** echoed back to the
caller (contrast with §2c's share response, which does return generated data).

---

## 3. Enum / vocabulary reference

- **`mfaStatus` (derived, GET /portal/team only)** — `"TOTP" | "FIDO2" | "SMS" | "Disabled"`,
  computed by `reduceMfaStatus()` (`portal-team.ts:161-166`); not a DB column, not stored
  anywhere — recomputed on every roster fetch from live `mfa_enrollments` + `webauthn_credentials`
  rows.
- **`mfa_enrollments.method`** — real DB enum `"totp" | "sms" | "passkey"`
  (`index.ts:1778`, drifted from the prior pack's `:1755-1763`). The roster route reads only
  `enabled = true` rows (`:201`) — a disabled/superseded enrollment never contributes to
  `mfaStatus`.
- **`user_sessions.session_type`** — real DB enum `"standard" | "impersonation"`
  (`msp.ts:691`, drifted from `:647`). Every query in this file that touches `user_sessions`
  (active-count, last-login, `revokeAllOtherSessions`) filters to `"standard"` only — an
  impersonation session never counts toward a team member's active-session count or last-login
  timestamp, and is never revoked by these routes.
- **`user_sessions.login_method`** — real DB enum `"password" | "totp" | "sms" | "passkey" |
  "impersonation" | "bypass"` (`msp.ts:692`, drifted from `:648`). Not read or returned by any
  route in this pack —
  cited here because `emergency-bypass` (§4h) mints the credential that a subsequent login would
  record as `login_method = "bypass"`, a cross-surface edge (§6), not a value this pack's own
  routes ever produce or filter on.
- **`MSP_ROLES`** — `"PlatformAdmin" | "MSPAdmin" | "MSPOperator" | "CustomerUser" |
  "ServiceAccount" | "Free" | "Assessment"` (`requireAuth.ts` importing from
  `lib/db/src/schema/index.ts:37`). Every route in this pack is reachable by any of the top four
  tiers (PlatformAdmin/MSPAdmin/MSPOperator act on any tenant they're scoped to; CustomerUser
  acts on their own tenant iff `canManageTeam`); `ServiceAccount`, `Free`, and `Assessment` are
  never granted `canManageTeam` capability by any code path in this file — `Free`/`Assessment`
  are gated identically to `CustomerUser` by `denyIfCannotManageTeam` (they'd need the DB flag
  set, same as any customer-tier user), but nothing in this repo currently sets it for them.
- **Per-user capability flags on `usersTable`** (not a DB enum, three independent booleans,
  `index.ts:88-113`): `canManageTeam` (this pack — invite/suspend/reset/unlock/bypass/manager-set),
  `canApprovePurchases` (purchase-charge approval, out of scope here), `canApproveChanges`
  (Change Control approval, Git #1496, out of scope here). Deliberately not merged into one
  flag or a role — see the schema's own comment for why.
- **`managerUserId` (new, #2527)** — not an enum, a nullable `integer` self-FK on `usersTable`
  (`references(() => usersTable.id, { onDelete: "set null" })`, `index.ts:142`). No DB constraint
  enforces same-tenant or acyclic — both are enforced only in the route handler (§4i), by
  convention, the same pattern this table already uses for other cross-row invariants (schema
  comment, `index.ts:133-134`). `ON DELETE SET NULL`: deleting a manager's user row clears the
  pointer on their reports rather than cascading, so a report's own record survives their
  manager's row being removed.

---

## 4. Remaining mutating routes — `POST/PATCH/DELETE /portal/team/:userId/...`

Every route below shares the common shape from §0 (parse `userId` → 400 on `NaN` → look up
target's `tenantId` → 404 if missing → `denyIfCannotManageTeam` → 403 on failure) and is omitted
from the table cells that would just repeat it.

### 4a. `DELETE /portal/team/:userId/sessions`

(`:57-83`) Revokes every one of the target's own **other** standard sessions via
`revokeAllOtherSessions(targetUserId, null)` — `exceptTokenHash: null` means no exclusion is
applied, so this revokes **all** of the target's standard sessions, not "all but the caller's,"
since the caller and target are different users on this route by construction (§6 notes the
one place this same helper is called with a real exclusion). Response: `{ ok: true,
revokedCount: number }`. No audit-log call on this route — the only mutating route in the file
that doesn't fire `createAuditLog` (flagged, §5).

### 4b. `PATCH /portal/team/:userId/status`

(`:254-305`) Body: `{ isActive: boolean }` — 400 `{ error: "isActive must be a boolean" }` if
not strictly boolean. Additional guard beyond §0: 400 `{ error: "You cannot suspend your own
account" }` if `targetUserId === req.user!.id && !isActive` (`:283-286`) — a manager can
suspend a colleague but never lock themselves out through this route; self-*re*activation
(`isActive: true` on your own id) is not blocked. On success: `UPDATE users SET is_active =
isActive`; audit log `team_member_activated` / `team_member_suspended`; if suspending
(`!isActive`), fire-and-forget `revokeAllOtherSessions(targetUserId, null)` (kills every live
session the instant a suspend lands, not waiting for token expiry). Response: `{ ok: true,
isActive }`.

### 4c. `PATCH /portal/team/:userId/mfa-enforcement`

(`:394-435`) Body: `{ enforced: boolean }` — same 400 typeof-guard as §4b. `UPDATE users SET
mfa_enforced = enforced`. Audit `team_member_mfa_enforcement_enabled` /
`_disabled`. Response: `{ ok: true, mfaEnforced: enforced }`. This flag is read live at login
(schema comment, `index.ts:114-116`) — toggling it here takes effect on the target's next login
attempt, not their current session.

### 4d. `POST /portal/team/:userId/unlock`

(`:437-475`) No body. `UPDATE users SET failed_login_attempts = 0, last_failed_login_at = NULL,
locked_until = NULL` — full lockout-state reset, not just clearing `locked_until`. Audit
`team_member_unlocked`. Response: `{ ok: true, isLockedOut: false }` — the `false` is hardcoded
post-update state, not re-queried.

### 4e. `POST /portal/team/:userId/reset-password`

(`:479-527`) No body. Mints a `password_reset_tokens` row (`token`: 32 random bytes hex,
`expiresAt`: now + 1 hour — `TEAM_RESET_TOKEN_TTL_MS`, `:477`, explicitly commented as matching
`/auth/forgot-password`'s own TTL). Emails the target a reset link
(`${getPortalBaseUrl()}/reset-password?token=...`) via the same `passwordResetEmail()` template
as self-service forgot-password. Audit `team_member_password_reset_email_sent`. Response: `{
ok: true }` — no token or link returned to the caller; delivery is entirely via email to the
target.

### 4f. `POST /portal/team/:userId/temp-password`

(`:529-568`) No body. Generates a temp password (`Temp-${6 random bytes hex, uppercased}!9` —
fixed pattern, not configurable), bcrypt-hashes it (cost 12), `UPDATE users SET password_hash =
...`. Audit `team_member_temp_password_set`. Response: `{ ok: true, tempPassword: string }` —
**the plaintext temp password is returned directly in the API response**, not emailed — the
caller (the manager doing the reset) is expected to relay it to the teammate out-of-band. No
email is sent by this route, unlike §4e.

### 4g. `POST /portal/team/:userId/reset-mfa`

(`:570-635`) No body. Reads the target's current enrollments (`mfa_enrollments` rows +
whether any `webauthn_credentials` row exists) to build a `clearedMethods: string[]` list for
the audit metadata and the notification email, **then deletes** all four MFA-related rows for
the target: `mfa_enrollments`, `mfa_challenges`, `webauthn_credentials`, `webauthn_challenges`
(`:605-608`) — a full MFA teardown, not a per-method reset. Emails the target
(`mfa-reset` template) with a human-readable rendering of `clearedMethods` (`"totp"` →
"Authenticator App (TOTP)", `"sms"` → "SMS", `"passkey"` → "Passkey / Security Key", else the
raw value; `.join(", ")`, or `"None"` if empty). Audit `team_member_mfa_reset` with
`metadata: { clearedMethods }`. Response: `{ ok: true, clearedMethods: string[] }`. Confirmed
by the file's own test (`portal-team.test.ts:143-171`, tied to #172): every generated link in
this route resolves exclusively off `getMspPortalBaseUrl()`, never a stale `/crm` path.

### 4h. `POST /portal/team/:userId/emergency-bypass`

(`:637-691`) No body. Generates a cryptographically random bypass code (`EMERGENCY-XXXX-XXXX-
XXXX-XXXX`, 16 hex chars from 8 random bytes, uppercased and grouped for legibility), bcrypt-
hashes it (cost 12), `expiresAt` = now + 24 hours. **Enforces one active code per user** — any
existing `mfa_bypass_codes` row for the target (used or unused) is deleted before the new one
is inserted (`:670`), so generating a new code silently invalidates any prior unused one. Insert
carries `createdByUserId` (the caller) and `customerId` (the target's tenant, captured at
generation for audit/reporting per the schema comment, `index.ts` `mfaBypassCodesTable`).
Audit `team_member_emergency_bypass_generated` with `metadata: { expiresAt }`. Response: `{ ok:
true, bypassCode: string, expiresAt: string (ISO) }` — **the plaintext code is returned
directly**, same pattern as §4f's temp password: relay is the caller's responsibility, no email
sent. This is the single highest-privilege action in the file — a working bypass code lets its
holder skip MFA entirely on the target's account for 24 hours.

### 4i. `PATCH /portal/team/:userId/manager` (new, #2527)

(`:315-391`) The only writer of `usersTable.managerUserId` anywhere in the repo. Body:
`{ managerUserId: number | null }` — 400 `{ error: "managerUserId must be a number or null" }`
if the field is present and not one of those two shapes (`:322-326`); a request that omits the
field entirely also fails this check (`undefined` is neither `null` nor `"number"`).

Beyond the shared §0 gate, three additional ordered checks run only when `managerUserId !==
null` (clearing a manager, i.e. `managerUserId: null`, skips straight to the update — `:344`):

1. **Not self** — 400 `{ error: "A team member cannot be their own manager" }` if
   `managerUserId === targetUserId` (`:345-348`).
2. **Same tenant** — 400 `{ error: "managerUserId must be a member of the same team" }` if no
   `users` row with that id exists, or its `tenantId` differs from the target's (`:350-358`).
   This is the one place in the file this invariant is enforced in code — there is no DB
   constraint backing it (§3).
3. **Cycle guard** — walks the *candidate* manager's own existing chain upward (via
   `managerUserId`, one row per hop, cursor-following, `:362-376`), 400 `{ error: "That
   assignment would create a reporting-chain cycle" }` if `targetUserId` appears anywhere in
   that walk. Capped at 50 hops (`hops < 50`, `:364`) — the same cap `notifyOwnershipDeclined`'s
   own read-side walk uses (§6), so a pathological 51+-deep chain (which nothing else in this
   route prevents from being built one hop at a time) would silently stop enforcing the cycle
   check past hop 50 rather than erroring; real but low-probability, not filed (§5).

On success: `UPDATE users SET manager_user_id = managerUserId WHERE id = targetUserId`
(`:379`) — a bare overwrite, no diff/no-op short-circuit if the value is unchanged. Audit
`team_member_manager_set`, no `metadata` field (contrast §4g/§4h, which do carry `metadata`) —
the audit row records that a change happened and by whom, but not the before/after
`managerUserId` values themselves (§5). Response: `{ ok: true, managerUserId }` — echoes back
exactly what was written (including `null` on a clear), not a re-queried row.

---

## 5. Findings

**Not filed as standalone issues** (documented here for Design/implementation awareness, per
the same judgment call the Documents pack (#2449 §2d, §5) used for its own low-severity
observations):

- **`GET /portal/team`'s `lastLoginAt` reads `max(user_sessions.created_at)`, never
  `users.last_login_at`** (`:214-217` vs. the dedicated column at `index.ts:130`). The two are
  not obviously kept in sync by anything in this file — `users.last_login_at` is written
  elsewhere (login flow, out of scope for this pack), and this route ignores it entirely in
  favor of a derived `max()` over session history for the same "standard" session type.
  Functionally this likely converges to the same value in practice (a login both updates
  `last_login_at` and creates a `user_sessions` row), but it's two independently-maintained
  sources for the same displayed field, worth Design/implementation knowing rather than assuming
  the column and the roster's displayed value are the same write path. Unchanged since #2447.
- **`DELETE /portal/team/:userId/sessions` is the one mutating route in this file with no
  `createAuditLog` call** (contrast every other mutating route, §4b–4i, which all fire one).
  A manager force-revoking a teammate's sessions leaves no audit trail distinguishing it from
  natural session expiry. Low severity (the action is non-destructive and reversible — the
  teammate just re-logs in), flagged for awareness rather than filed, consistent with the
  Documents pack's own precedent for a similarly low-severity gap. Unchanged since #2447.
- **`POST /portal/team/invite` always creates the new teammate at `mspRole: "CustomerUser"`
  with `canManageTeam` unset (defaults `false`)** — there is no invite-time option to grant the
  new teammate management capability themselves; a second, separate action against their user
  row (not exposed by any route in this file) would be needed. This is a real product-shape
  question (should invite support "invite as manager"?), not a bug — flagged for Design, not
  filed, since it's a product decision this pack's own scope (Step 3: "no page/UI-shape
  decisions get made in this issue") explicitly defers. Unchanged since #2447.
- **`GET /portal/team` does not project `managerUserId`** (new this pass). A caller reading the
  roster has no way to see who reports to whom without a separate, unbuilt lookup — the roster
  and the manager-assignment write path (§4i) are currently disconnected surfaces. This is
  squarely a page/UI-shape and read-contract decision for whoever wires the actual Team
  Management page (the same Step 3 deferral as the invite-role question above, and this pack's
  own scope is extraction, not authoring a new response field) — flagged for Design, not filed.
- **`PATCH /portal/team/:userId/manager`'s audit row carries no `metadata`** — unlike §4g/§4h,
  the `team_member_manager_set` audit entry doesn't record the prior or new `managerUserId`
  value, only that *a* change happened, by whom, to which target. A reviewer reconstructing "who
  reported to whom, and when that changed" from the audit log alone cannot, without also having
  captured `usersTable.managerUserId`'s value at each point in time. Low severity (informational
  gap in an otherwise-complete audit trail, not a security or correctness defect), flagged for
  awareness rather than filed.
- **The cycle guard's 50-hop cap (§4i) and `notifyOwnershipDeclined`'s independent 50-hop cap
  (§6) are two separately-maintained constants enforcing the same real limit** — nothing ties
  them together, so a future change to one without the other would silently desync write-time
  cycle prevention from read-time walk depth. Low severity (both are generous caps unlikely to
  matter at real org sizes), flagged for awareness rather than filed.

**No genuine bug found that rises to the filing bar** (a live endpoint the surface doesn't call
is already covered by the orphaned-endpoint check below, not a separate finding; every gate,
every enum, and every derived field traced cleanly to real, live code, including the new
manager-assignment route and its cycle/tenant guards).

---

## 6. Cross-surface edges

- **`revokeAllOtherSessions()` shared helper** (`session-tracking.ts:107`) — called with a real
  `exceptTokenHash` (excluding the caller's own current session) elsewhere in the codebase
  (self-service "log out other sessions," out of scope for this pack); every call from
  `portal-team.ts` passes `null` (§4a, §4b) because the caller and the target are always
  different users on these routes — there is no "except self" case to exclude here.
- **`mfa_bypass_codes` vs. the login flow's bypass-code redemption** (out of scope for this
  pack — the redemption/consumption route that reads `usedAt`/`usedIp`/`usedUserAgent` back
  isn't in `portal-team.ts`): this pack's `emergency-bypass` route (§4h) only ever *writes* a
  fresh code; the columns that record its use are written by a different, unexamined route.
- **`accountSetupTokensTable` shared between invite (§2) and free-checkout onboarding** —
  `ensureClientSetupToken()` (`client-setup-token.ts:4-7`) is explicitly shared with
  `portal-checkout-free.ts`'s onboarding flow, not exclusive to team invites; both paths produce
  the same advisory-locked, 72-hour-expiry setup-token shape.
- **`user_sessions.login_method = "bypass"`** — a value this pack's `emergency-bypass` route
  (§4h) never writes itself, but whose existence in the schema (`msp.ts:692`) is the login-side
  half of the feature this route mints credentials for.
- **`usersTable.managerUserId` — written only here (§4i), read only by
  `notifyOwnershipDeclined()`** (`notification-center.ts:329-396`, out of scope for this pack).
  That function is the entire reason #2527 exists: a customer-side Ownership/RACI decline
  (`portal_ownership_assignments`, a table this pack does not otherwise touch) notifies the
  assigner (`setByPersonId`, #1519) and then walks `managerUserId` upward from the assigner,
  notifying every real manager on file, cycle-guarded and capped at 50 hops the same way §4i's
  write-side guard is (see §5's note that the two caps are independently maintained). A row
  with no `managerUserId` set — the common case today, since nothing backfills it and nothing
  outside §4i writes it — notifies only the assigner, same behavior as before #2527 shipped.
  `notifyOwnershipDeclined` itself, `portal_ownership_assignments`, and the Ownership/RACI
  matrix surface are all out of scope for this pack beyond this cross-reference.

---

## Orphaned-endpoint check

None of the 11 routes in this pack has a live frontend caller anywhere in the current tree:

```
grep -rn "portal/team" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

returns no matches. This is expected, current state — `artifacts/msp-portal` (the only prior
caller, via `customer-team.tsx`) was retired 2026-08-29, and no `Design/portal/` export exists
yet for Team Management. All 11 routes are real, none is exercised by any live surface today;
that is the honest state Design should build against, not a gap this pack needs to close. The
new manager-assignment route (§4i) is exercised only by its own route handler's internal reads
(the cycle guard) and by `notifyOwnershipDeclined()` reading the column it writes — no route in
this file, and no frontend page, calls `PATCH /portal/team/:userId/manager` today.

---

## Not covered by this pack

Per #2447 Step 3 (mirrored from the Documents pack's own Step 3 language), no page/UI-shape
decisions are made here. This pack extracts what exists on `portal-team.ts` in full (all 11
routes) — it does not decide what a Team Management page should look like, how the roster table
should be organized, whether/how a "reports to" picker gets surfaced against the roster, or
which of the nine per-user mutating actions get surfaced as buttons vs. an overflow menu. The
MFA-bypass redemption route, the self-service "log out other sessions" route,
`portal-checkout-free.ts`'s onboarding flow, and `notifyOwnershipDeclined()` /
`portal_ownership_assignments` (the Ownership/RACI matrix this pack's new manager column now
feeds) are separate routers/routes/tables sharing tables or helpers with this one (§6) but are
not analyzed here beyond that cross-reference.

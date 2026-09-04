# MSP Staff Roles and Onboarding (MSP Console) — contract extraction pack for Claude Design

**#2894** (regeneration of **#2660**'s pack, superseding it — the MFA-enforcement and
session-revoke persistence bugs documented as no-ops in the prior version were fixed by
**#2723**, commit `1f46de6dc`, real behavior change), step 3 of **#2574** (Feature: MSP
Staff Roles and Onboarding, MSP Console), under **#1571** (EPIC: Portal Admin — MSP-side
operator surface). Follows the **#1642 pattern**: per-surface wire contracts extracted
verbatim and cited to file:line, CURRENT vs DECIDED marked on every field, real enum
unions only, cross-surface edges, honest tri-state, forbidden list, orphaned endpoints
listed explicitly. Read-only — no product code, schema, or UI changed. This regeneration
was written line-by-line against the current file, not patched incrementally, per #2894's
own dispatch.

**What changed since #2660's extraction (2026-09-03):**

1. **§4's two persistence no-ops are fixed.** `PATCH .../mfa-enforcement` now writes
   `usersTable.mfaEnforced`; `DELETE .../sessions` now calls the real
   `revokeAllOtherSessions()` helper and returns a real `revokedCount`. Both routes now do
   exactly what their response payloads claim. See §4, §8 (forbidden-list item renumbered
   to reflect the fix), §9.
2. **`artifacts/msp-console` now exists** (scaffolding only — `App.tsx`, `main.tsx`,
   `pages/index.tsx`, `pages/not-found.tsx`, 6 files total, no real page calls any route
   in this pack). §0's "not built yet" framing is corrected below — the app exists, the
   surface this pack documents is still unconsumed.
3. **Every route's line numbers shifted** (+9 in `msp-settings.ts` from #2723's 10-line
   insertion two-thirds through the file; +47 in `msp-onboarding.ts` from an unrelated
   `GET /api/msp/onboarding/links` route added by #2674 ahead of the invite routes). All
   citations below are re-verified against the current file, not carried forward.
4. **The prior pack's "Tests confirming real coverage" citation
   (`msp-settings.test.ts`) does not exist and has no git history at that path** — a
   stale/incorrect citation in the original pack, not a renamed file. Real test coverage
   for this surface is much narrower than that citation implied; see the Tests line below
   and §8. Filed as **#2906** (test-coverage gap for the #2723 fix specifically),
   sibling sub-issue of #2574.
5. **Live DB state re-confirmed unchanged** — same 2 MSPs, same 9 `mspId`-carrying users,
   still 0 `msp_invites`, still 0 `msp_staff_customer_scopes` rows.

Backend route files, all real and under test (partially — see Tests line):

- `artifacts/api-server/src/routes/msp-settings.ts` — 14 routes, §1-§6 below
  (`GET/PATCH/PUT/POST/DELETE /api/msp/settings/users*`, `/api/msp/settings/invites*`,
  MSP-wide `/api/msp/settings/sessions*`)
- `artifacts/api-server/src/routes/msp-onboarding.ts:416-722` — the public accept-side of
  the same invite flow, §5 below (`GET/POST /api/public/msp-invite/:token[/accept]`)

Schema: `lib/db/src/schema/msp.ts:598-614` (`mspStaffCustomerScopesTable`), `:637-657`
(`mspInvitesTable`), `:662-677` (`mspRefreshTokensTable`); `lib/db/src/schema/index.ts:45-`
(`usersTable`, incl. `:85` `mspRole`, `:88` `isActive`, `:92` `canApprovePurchases`, `:117`
`mfaEnforced`), `:37` (`MSP_ROLES`).
Auth: `artifacts/api-server/src/middlewares/requireAuth.ts:81-89` (`ROLE_ORDER`), `:91-94`
(`roleIndex`), `:206-222` (`requireRole`), `:348-360` (`resolveStaffScopedCustomerIds`).
`resolveMspIdStrict()`: `artifacts/api-server/src/lib/resolve-msp-id.ts`.
**Tests: real, but narrow.** `artifacts/api-server/src/routes/msp-settings-portal-links.test.ts`
(`#154`/`#172` scope) covers only the reset-password and reset-mfa routes' email-link
*base URL*, not this pack's other 12 `msp-settings.ts` routes. **No test in the repo
exercises `mfa-enforcement`, per-user `sessions`, `customer-scopes`, `role`,
`approve-purchases`, or the invite create/list/revoke routes** — confirmed via
`grep -rln "mfa-enforcement\|/sessions\"" artifacts/api-server/src --include="*.test.ts"`
(4 unrelated matches) and an equivalent sweep for the others. Filed as **#2906**.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-04, re-confirmed
identical to #2660's extraction):

```
 id  |                    name                    | status
------+--------------------------------------------+--------
    1 | Shane McCaw Consulting                     | active
 1626 | Regression Testbed MSP (billing lifecycle) | active

users with mspId set (msp 1, the only MSP with any users today):
 id |                 email                 | msp_role      | is_active | can_approve_purchases | mfa_enforced
----+----------------------------------------+---------------+-----------+------------------------+--------------
  1 | shane@shanemccaw.com                   | PlatformAdmin | t         | f                      | f
 37 | shanemccaw+assessment1@outlook.com     | Assessment    | t         | f                      | f
 39 | shanemccaw+buyassessment@outlook.com   | CustomerUser  | t         | f                      | f
 42 | shanemccaw@outlook.com                 | CustomerUser  | t         | f                      | f
 50 | test@test.com                          | Assessment    | t         | f                      | f
 55 | shanemccaw@gmail.com                   | Assessment    | t         | f                      | f
 56 | shane@shanemccaw.onmicrosoft.com       | Assessment    | t         | f                      | f
 57 | shanemccaw+premier@outlook.com         | CustomerUser  | t         | f                      | f
103 | shanemccaw+1317pack@gmail.com          | CustomerUser  | t         | f                      | f

msp_invites: 0 rows.  msp_staff_customer_scopes: 0 rows.
```

**Zero real staff members exist in this environment.** Every `mspId`-carrying user is
`PlatformAdmin`, `Assessment`, or `CustomerUser` — none is `MSPAdmin` or `MSPOperator`, the
only two roles this Feature's routes manage. `GET /msp/settings/users` for `mspId=1` today
would return all 9 of these rows (§1 — the route does not filter by role), not an empty list,
but none of them is a real "MSP staff" account the way this Feature means it. No invite has
ever been sent; no staff customer-scope row has ever been created. Design should treat every
example value in this pack as a cold-start / zero-state sample, not a populated one.

---

## 0. What this surface is, and what it is not

**Two linked halves of one lifecycle: roster management (§1-§4) and staff onboarding
(§5).** An MSPAdmin manages who is already on the roster (list, role, per-staff customer
scope, purchase-approval flag, credential resets, suspend/remove) through `msp-settings.ts`;
new staff join the roster through the invite flow split across `msp-settings.ts` (MSPAdmin
side: create/list/revoke an invite) and `msp-onboarding.ts` (public side: the invited person
validates the token and accepts it, provisioning or re-pointing their `users` row).

**MSP-scoped, not customer-scoped.** Every route in §1-§4 resolves `mspId` from
`resolveMspIdStrict(req)` — the caller's own JWT `mspId` claim, never a route/query param —
and every DB read/write is `WHERE ... AND usersTable.mspId = mspId`. There is no cross-MSP
staff-management path anywhere in this pack (contrast `msp-staff.ts`'s impersonation route,
§7, which a PlatformAdmin *can* use cross-MSP).

**Only two roles are assignable through this surface.** `updateRoleSchema`
(`msp-settings.ts:699-701`) and `createInviteSchema` (`:1626-1629`) both hard-restrict
`mspRole` to `z.enum(["MSPAdmin", "MSPOperator"])` — this pack's routes can never create,
promote, or invite a `PlatformAdmin`, and can never touch a `CustomerUser`/`Assessment`/`Free`/
`ServiceAccount` account even though `GET /msp/settings/users` (§1) happens to return them
when they carry the same `mspId` (see the honest-state note above).

**The frontend now exists, but is pure scaffolding — still no real consumer.**
`artifacts/msp-console` was created by a separate scaffolding commit since #2660's
extraction (`ls artifacts/`: `admin-panel`, `api-server`, `mcp-server`, `msp-console`,
`msp-website`, `portal`, `shane-mccaw-consulting`). Its entire contents are
`components.json`, `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, and
four source files (`App.tsx`, `index.css`, `lib/utils.ts`, `main.tsx`,
`pages/index.tsx`, `pages/not-found.tsx`) — a bare Vite/React shell with no real page, and
no reference anywhere in it to any route in this pack. Every route in this pack remains
real, tested (partially — see Tests line), and currently orphaned (§0.1), same as #2660's
extraction found, and the same pre-real-page state
`docs/offboarding-msp-console-contract-pack.md` §0 and `docs/sops-msp-console-contract-pack.md`
§0 already documented for their own Features.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/settings/users` | GET | `msp-settings.ts:536-579` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/customer-scopes` | GET | `msp-settings.ts:588-622` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/customer-scopes` | PUT | `msp-settings.ts:628-697` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/role` | PATCH | `msp-settings.ts:703-732` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/approve-purchases` | PATCH | `msp-settings.ts:738-767` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId` | DELETE | `msp-settings.ts:769-797` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/reset-password` | POST | `msp-settings.ts:804-839` | **Nothing found** (test-covered link format only, not called) | **Yes** |
| `/api/msp/settings/users/:userId/temp-password` | POST | `msp-settings.ts:841-867` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/reset-mfa` | POST | `msp-settings.ts:869-922` | **Nothing found** (test-covered link format only, not called) | **Yes** |
| `/api/msp/settings/users/:userId/mfa-enforcement` | PATCH | `msp-settings.ts:924-946` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/status` | PATCH | `msp-settings.ts:948-975` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/sessions` | DELETE | `msp-settings.ts:977-1002` | **Nothing found** | **Yes** |
| `/api/msp/settings/sessions` | GET | `msp-settings.ts:1535-1574` | **Nothing found** | **Yes** |
| `/api/msp/settings/sessions/:tokenHash` | DELETE | `msp-settings.ts:1576-1614` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites` | POST | `msp-settings.ts:1631-1727` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites` | GET | `msp-settings.ts:1729-1756` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites/:inviteId` | DELETE | `msp-settings.ts:1758-1779` | **Nothing found** | **Yes** |
| `/api/public/msp-invite/:token` | GET | `msp-onboarding.ts:416-472` | **Nothing found** | **Yes** |
| `/api/public/msp-invite/:token/accept` | POST | `msp-onboarding.ts:483-722` | **Nothing found** | **Yes** |

```
grep -rn "msp/settings/users\|msp/settings/invites\|msp-invite" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src artifacts/msp-console/src
```

returns no matches — including against `artifacts/msp-console/src`, which now exists but
is still pure scaffolding (see §0). All 19 routes are real; 17 of them have zero test
coverage and 2 (reset-password, reset-mfa) are covered only for their email-link base URL,
not for being called end-to-end (see Tests line, §8) — but none has ever been called from
outside a test file. The MSP-console UI (#2662, blocked on Design #2661, blocked on this
pack) is still the first surface that will ever call any of them. Expected pre-Design
state, not a defect — not filed as a new finding beyond the test-coverage gap (#2906),
same reasoning `docs/offboarding-msp-console-contract-pack.md` §0.1 already used for its
own Feature.

---

## 1. Wire contract — `GET /api/msp/settings/users` (`msp-settings.ts:536-579`)

Auth: `requireRole("MSPAdmin")` (`:536`). No query params — `mspId` from
`resolveMspIdStrict(req)` (`:537`), 400 `{ error: "No MSP context" }` if absent.

Returns **every** `users` row carrying this `mspId`, not filtered to `MSPAdmin`/`MSPOperator`
(honest-state note, header) — ordered `desc(createdAt)`:

| Field | Type | Source | Note |
|---|---|---|---|
| `id`, `userId` | `number` | `users.id` (both keys, same value) | kept duplicated on purpose — the pre-refactor `msp_users.id` vs `users.id` split is gone, but the future UI reads both interchangeably (`:542-547` comment) |
| `mspRole` | `"PlatformAdmin" \| "MSPAdmin" \| "MSPOperator" \| "CustomerUser" \| "ServiceAccount" \| "Free" \| "Assessment"` | `users.msp_role` | not narrowed to staff roles by this query |
| `canApprovePurchases` | `boolean` | `users.can_approve_purchases` | §3 is the one route that writes it |
| `isActive` | `boolean` | `users.is_active` | §4/§9 both write it |
| `lastLoginAt` | `Date \| null` | `users.last_login_at` | |
| `createdAt` | `Date` | `users.created_at` | |
| `email`, `name` | `string`, `string \| null` | `users.email` / `.name` | |
| `assignedCustomersCount` | `number` | computed (`:565-570`), grouped count of `msp_staff_customer_scopes` rows for that `staffUserId` within this `mspId` | **`0` means UNRESTRICTED (full MSP access), not "no access"** — the route comment (`:562-564`) states this explicitly; the UI must render `0` as "All customers", not an empty-access badge |

---

## 2. Wire contract — per-staff customer scoping (`msp_staff_customer_scopes`)

**GET `/api/msp/settings/users/:userId/customer-scopes`** (`msp-settings.ts:588-622`). Auth
`requireRole("MSPAdmin")`. 400 on invalid `mspId`/`userId`. 404 `{ error: "User not found in
this MSP" }` if the target isn't a `users` row with this `mspId` (`:593-598`).

Response:

| Field | Type | Source |
|---|---|---|
| `mspRole` | real `mspRole` enum value | target's own row |
| `scopable` | `boolean` | `true` only if `mspRole` is `"MSPAdmin"` or `"MSPOperator"` (`:618`) — the UI hides the picker for every other role |
| `allCustomers` | `Array<{ id, name, status }>` | every `tenants` row for this `mspId` (`:602-605`) |
| `assignedCustomerIds` | `number[]` | this staff member's current `msp_staff_customer_scopes` rows (`:607-612`) — empty array = unrestricted |

**PUT `/api/msp/settings/users/:userId/customer-scopes`** (`:628-697`). Body:
`{ customerIds: number[] }` (`updateScopesSchema`, `:624-626`, positive ints, de-duped
`:639`). 404 if target isn't in this MSP (`:642-647`). **400** `"Customer scoping applies only
to MSP staff (MSPAdmin/MSPOperator)"` if the target's role isn't scopable (`:648-651`) — this
is a hard server-side guard, not just a UI hint. 400 `"One or more customers do not belong to
this MSP"` if any requested id isn't a `tenants` row under this `mspId` (`:655-663`) —
IDOR-safe: a caller cannot grant access to another MSP's customer even by ID-guessing.

Write is a full replace, atomic (`:668-685`): delete every existing scope row for this
`(staffUserId, mspId)`, then insert the new set (`createdByUserId: req.user!.id`). An empty
`customerIds` array is a real, valid request — it clears all scope rows, returning the staff
member to unrestricted. Response: `{ ok: true, assignedCustomerIds: <the request's own set>,
unrestricted: <customerIds.length === 0> }`.

---

## 3. Wire contract — role, purchase-approval, removal

**PATCH `/api/msp/settings/users/:userId/role`** (`:703-732`). Body: `{ mspRole: "MSPAdmin" |
"MSPOperator" }` (`updateRoleSchema`, `:699-701`) — **only these two values are ever
accepted**; a request naming any other role (including the caller trying to hand out
`PlatformAdmin`) fails Zod validation before the handler runs. 404 if target isn't in this
MSP. Writes `mspRole` + `updatedAt` (`:714-718`). Response: `{ ok: true }` — the route does not
echo the new role back.

**PATCH `/api/msp/settings/users/:userId/approve-purchases`** (`:738-767`). Body:
`{ canApprovePurchases: boolean }`. 404 if target isn't in this MSP. Writes the flag +
`updatedAt`. Response: `{ ok: true }`.

**DELETE `/api/msp/settings/users/:userId`** (`:769-797`). **400** `"Cannot remove your own
account from the MSP"` if `userId === req.user!.id` (`:775-778`) — self-removal is blocked at
this route regardless of role. Not a hard delete: sets `isActive = false` (`:780-784`) — same
soft-remove pattern as §4's `/status` route, just with a fixed target value and the extra
self-guard. 404 if target isn't in this MSP.

---

## 4. Wire contract — credential resets, MFA, status, sessions

**POST `/api/msp/settings/users/:userId/reset-password`** (`:804-839`). Real implementation —
issues a `passwordResetTokensTable` row (1-hour TTL, `MSP_RESET_TOKEN_TTL_MS`, `:802`), same
mechanism as self-service `/auth/forgot-password`, and emails the target a reset link
(`sendEmailFromTemplate`, fire-and-forget, failure logged non-fatally, `:822-828`). Response:
`{ ok: true, message: "Password reset email sent" }`. `msp-settings-portal-links.test.ts`
covers only that the emailed reset link's base URL is `getMspPortalBaseUrl()`, not the
`/crm` base — a link-format assertion, not end-to-end route coverage.

**POST `/api/msp/settings/users/:userId/temp-password`** (`:841-867`). Generates a real
temp password (`` `Temp-${randomBytes(6).toString("hex").toUpperCase()}!9` ``, `:854` — 12
uppercase hex chars), bcrypt-hashes it (`cost 12`) and writes it directly to
`users.password_hash` (`:855-856`) — **no email sent**; the plaintext temp password is
returned once in the response (`:866`) for the MSPAdmin to relay out-of-band. Response:
`{ ok: true, tempPassword: <plaintext>, requireChange: true }` — `requireChange` is
returned but nothing in this route (or elsewhere found in this pack) enforces a forced
password change on next login; it is advisory only in the payload today.

**POST `/api/msp/settings/users/:userId/reset-mfa`** (`:869-922`). Reads the target's current
`mfaEnrollmentsTable` methods + `webauthnCredentialsTable` rows to build a human-readable
`clearedMethods` list (`:882-892`), then **deletes** all four: `mfa_enrollments`,
`mfa_challenges`, `webauthn_credentials`, `webauthn_challenges` for that user (`:894-897`) —
a real, hard clear, not a soft flag. Emails the target a plain-HTML notice (not a
`sendEmailFromTemplate` call like the others — inline HTML string, `:899-910`). Response:
`{ ok: true, message: "MFA credentials cleared for re-enrollment" }`. Same link-format-only
test coverage as reset-password, above (`#172`).

**PATCH `/api/msp/settings/users/:userId/mfa-enforcement`** (`:924-946`) — **now persists
correctly (fixed by #2723, commit `1f46de6dc`).** Reads `{ enforced }` off the body, writes
`users.mfa_enforced` via `db.update(usersTable).set({ mfaEnforced: !!enforced, updatedAt:
new Date() })` scoped to `(userId, mspId)` (`:931-934`), *then* writes the audit-log row,
then returns `{ ok: true, enforced: !!enforced }`. `users.mfa_enforced`
(`index.ts:117`) is the real, load-bearing column — `auth.ts` and `msp-onboarding.ts:681`
both gate `mfaSetupPending` on it via `mfaEnforcementActive(user.mfaEnforced)` — so this
route's toggle now has the same real effect as the customer-facing analog,
`portal-team.ts:423` (`await db.update(usersTable).set({ mfaEnforced: enforced })...`).
**No test exercises this route** (see Tests line, §8, #2906).

**PATCH `/api/msp/settings/users/:userId/status`** (`:948-975`). Body: `{ isActive: boolean }`
— 400 if not boolean. **400** `"Cannot suspend your own account"` if `isActive === false` and
`userId === req.user!.id` (`:956-959`) — same self-protection pattern as §3's delete route.
Writes `isActive` + `updatedAt`. Response: `{ ok: true, isActive }`.

**DELETE `/api/msp/settings/users/:userId/sessions`** (`:977-1002`) — **now revokes for
real (fixed by #2723, commit `1f46de6dc`).** Confirms the target belongs to this MSP, then
calls the real `revokeAllOtherSessions(userId, null)` helper
(`artifacts/api-server/src/lib/session-tracking.ts:107-134` — revokes every non-revoked
`user_sessions` row for that user and cascades the matching `msp_refresh_tokens` rows to
`revokedAt = now()`), writes an audit-log row carrying the real `revokedCount` in its
metadata, and returns `{ ok: true, revokedCount }` — a real count, not the fixed message
string the prior extraction found. Same helper the customer-side analog
`portal-team.ts:81` already called, and the same helper the MSP-wide session list's sibling
routes rely on for revocation semantics. **No test exercises this route** (see Tests line,
§8, #2906).

## 5. Wire contract — MSP-wide sessions, invites (create/list/revoke), and accept

**5a. GET `/api/msp/settings/sessions`** (`:1535-1574`) — MSP-wide, not per-user: every
non-revoked `msp_refresh_tokens` row (`:1550-1571`) for every `isActive` user in this MSP,
joined to `email`/`name`, newest first, capped at 100. This is the real session list; §4's
per-user `DELETE .../sessions` above has no matching per-user GET (a design gap the
MSP-console UI will need to work around by filtering this MSP-wide list client-side, or by
using this route as the only real session source).

**5b. DELETE `/api/msp/settings/sessions/:tokenHash`** (`:1576-1614`) — real, working single-
session revoke. Verifies the token belongs to an active user in this MSP (`:1582-1598`), then
sets `revokedAt = now()` on that exact `mspRefreshTokensTable` row (`:1600-1603`). 404 if the
token doesn't exist or belongs to a different MSP's user.

**5c. POST `/api/msp/settings/invites`** (`:1631-1727`). Body: `{ email, mspRole: "MSPAdmin" |
"MSPOperator" }` (`createInviteSchema`, `:1626-1629`). **409** `"This user is already an
active member of your MSP"` if the email already resolves to an active `users` row with this
`mspId` (`:1643-1660`). **409** `"An unexpired invite already exists for this email. Revoke it
first if you need to resend."` if a non-expired, unused `msp_invites` row already exists for
`(mspId, email)` (`:1664-1680`) — no silent resend; the caller must explicitly revoke (§5e)
first. On success: inserts an `msp_invites` row (72-hour `expiresAt`, `:1688-1701`) and emails
the invite link (fire-and-forget, `:1714`). Response: the full inserted `MspInvite` row
(`res.status(201).json(invite)`, `:1726`) — includes the raw `token` field verbatim in the
JSON response (not redacted), since the creating MSPAdmin is the one who needs it to confirm
the send.

**5d. GET `/api/msp/settings/invites`** (`:1729-1756`). Lists only **still-pending** invites
for this MSP — `isNull(usedAt) AND expiresAt >= now()` (`:1746-1752`); a used or expired
invite silently drops off this list (it is never deleted, just filtered out — see §6). Fields:
`id`, `invitedEmail`, `mspRole`, `expiresAt`, `createdAt`, plus `inviterEmail`/`inviterName`
via a left join on `invitedByUserId` (`null` if the inviter's own account was later removed).

**5e. DELETE `/api/msp/settings/invites/:inviteId`** (`:1758-1779`). Hard `DELETE`, not a
soft revoke — but scoped `WHERE id = :inviteId AND mspId = mspId AND usedAt IS NULL`
(`:1763-1766`): **an already-used invite cannot be deleted through this route** (404 `"Invite
not found or already used"`), so accepted-invite history is retained by omission, not by a
status flag (see §6).

**5f. GET `/api/public/msp-invite/:token`** (`msp-onboarding.ts:416-472`). Public, no auth —
rate-limited (`inviteAcceptLimiter`). Validates the
token and returns display info for the accept page: `invitedEmail`, `mspRole`, `expiresAt`,
and the `msp` object (`id`, `name`, `slug`, `logoUrl`, `primaryColor`) — **no auth performed,
this is intentionally the public pre-login screen**. 404 nonexistent token, 410 already-used
(`row.usedAt`), 410 expired, 403 if the owning MSP's `status === "suspended"`.

**5g. POST `/api/public/msp-invite/:token/accept`** (`:483-722`). Body:
`{ name?, password? }` (`acceptInviteSchema`, `:478-481` — `password` min 8 chars). Same
404/410/410/403 validation as §5f, then branches on whether `invitedEmail` already has a
`users` row (`:533-537`):

- **Existing account** (`:543-573`): the request MUST carry a valid `Authorization: Bearer`
  JWT whose `email` claim matches the invited email exactly — 401
  `{ error: "...Please sign in to accept...", requiresSignIn: true }` if unauthenticated, 403
  if signed in as a *different* email. **A bare possession of the invite token is never
  sufficient to reassign an existing account's MSP membership** — this is a deliberate
  anti-hijack guard (comment `:539-542`).
- **New account** (`:574-584`): `name` and `password` become required (400 if either is
  missing) — the invite-accept path is also the account-creation path for a brand-new staff
  member.

Both branches run inside one transaction (`:589-648`): the invite is burned with a
`WHERE usedAt IS NULL` guard (`:592-600`, throws `ALREADY_USED` → 410 on a concurrent double-
accept race — real, tested protection, not just a comment) before either branch writes to
`users`. Existing-account branch re-points `mspId`/`mspRole`/`isActive: true` onto the existing
row **only if it isn't already exactly that** (`:625-630`) — a no-op-safe upsert, not an
unconditional overwrite. New-account branch inserts a fresh `users` row with `mspId`/`mspRole`
inline (**required** — the schema default `mspRole: "Free"` combined with the
`users_role_scope_check` constraint would reject a bare insert with no `tenantId` and no
`mspId`; comment `:607-611` states this explicitly).

On success, if `JWT_SECRET` is configured, the route auto-logs the accepting user in
(`:660-719`): issues a 15-minute access token and a 7-day refresh token (real
`mspRefreshTokensTable` insert, `:699-705`), gated by the same `mfaEnforcementActive()` /
`mfaSetupPending` check every other login path in `auth.ts` uses (`:681` — Git #439 parity,
comment cites it explicitly) so a brand-new staff account with zero MFA methods enrolled comes
back restricted to the enrollment endpoints rather than a fully open session. Response:
`{ ok: true, mspSlug, accessToken, refreshToken, refreshExpiresAt }` on the auto-login path,
or the bare `{ ok: true, mspSlug }` if token issuance fails or `JWT_SECRET` is absent
(`:661`, `:721`) — auto-login failure is caught and logged, never blocks the accept itself.

---

## 6. Real enum unions

- **MSP role hierarchy** — `MSP_ROLES` (`index.ts:37`): `["PlatformAdmin", "MSPAdmin",
  "MSPOperator", "CustomerUser", "ServiceAccount", "Free", "Assessment"]` — declared order is
  NOT privilege order. Real privilege order is `ROLE_ORDER` (`requireAuth.ts:81-89`), lowest
  to highest: `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin <
  PlatformAdmin`. Every `requireRole("MSPAdmin")` gate in this pack is a minimum-tier check
  against `ROLE_ORDER`, not `MSP_ROLES`.
- **Invitable/assignable role** — a strict 2-value subset of the above, enforced by Zod at
  two independent points (`updateRoleSchema`, `createInviteSchema`): `"MSPAdmin" |
  "MSPOperator"`. No route in this pack can produce, promote to, or invite `PlatformAdmin`.
- **Invite lifecycle** — not a stored enum column; a 3-state derived from two nullable
  timestamp fields on `msp_invites` (`usedAt`, `expiresAt`): pending (`usedAt IS NULL AND
  expiresAt >= now()`), expired (`usedAt IS NULL AND expiresAt < now()`), accepted (`usedAt IS
  NOT NULL`). §5d's list route only ever returns the pending state; expired/accepted rows are
  never deleted, just excluded from that one query (§0.1 orphan sweep found no route that ever
  lists them).
- **MSP status gate on invite accept** — reuses `msps.status: "active" | "suspended" |
  "trial"` (same enum documented in `docs/offboarding-msp-console-contract-pack.md` §5).
  §5f/§5g both 403 only on `"suspended"` — a `"trial"` MSP's invites work exactly like an
  `"active"` one's.

---

## 7. Cross-surface edges

- **`msp-staff.ts` and `msp-staff-search.ts` are real, but a different Feature's surface, not
  this one's.** `msp-staff.ts`'s `POST /api/msp/:mspId/customers/:customerId/impersonate`
  issues a time-boxed customer-impersonation token for an MSP staff member acting *as* a
  customer login — orthogonal to this pack's staff-roster/RBAC scope, though it does share
  `mspAuditLogsTable` and the same `requireRole`/`requireMspScope` middleware pair. Its
  `GET /api/msp/:mspId/fulfillment-queue` is unrelated to staff at all — a delivery-SLA
  triage list — and is itself doubly orphaned: not just unconsumed by any MSP-console UI,
  but a *different* route (`GET /api/admin/fulfillment-queue`, `admin-fulfillment.ts`,
  confirmed live via `FulfillmentQueue.tsx` / `fulfillmentApi.ts:48` in `admin-panel`) already
  serves the real fulfillment-queue UI that exists today. `msp-staff-search.ts`'s
  `GET /api/msp/staff-search` is the Cmd+K palette's cross-tenant alerts/documents search —
  real, tested, reuses `resolveStaffScopedCustomerIds` (the same helper §2's scoping feeds),
  but has nothing to do with roster management or onboarding either.
- **`resolveStaffScopedCustomerIds` is the one real enforcement consumer of §2's data.**
  `requireAuth.ts:349-370` reads `msp_staff_customer_scopes` to narrow a scoped staff member's
  access on cross-customer list/aggregate routes MSP-wide (including `msp-staff-search.ts`,
  above) — this pack's §2 PUT is the only route in the whole codebase that ever writes that
  table; every other consumer only reads it.
- **`users.mfa_enforced` is shared with the customer-facing team surface**, and that surface's
  own toggle route (`portal-team.ts:423`) persists it the same way this pack's §4
  `/mfa-enforcement` route now does, post-#2723 — the two routes are now real parity, not a
  gap (§4, §8).
- **`mspRefreshTokensTable` is written by four flows in this pack alone**: login-equivalent
  issuance at invite-accept (§5g), single-session revoke at §5b, and now-real per-user revoke
  at §4 (via `revokeAllOtherSessions`, which also revokes the matching `user_sessions` rows —
  a table outside this pack's own schema citations but load-bearing for §4's fix).
- **`msp_audit_logs` is the one audit trail for every write in this pack** — `writeAuditLog()`
  (`msp-settings.ts:102-`) is called on every mutating route in §1-§5 without exception. Prior
  to #2723 the audit trail was real even where the underlying effect was not (§4's two
  routes); post-fix, the audit trail and the underlying effect now agree for every route in
  this pack.

---

## 8. The forbidden list — declared, not merely absent

1. **No route in this pack can assign, invite, or promote to `PlatformAdmin`.** Both
   Zod schemas that accept an `mspRole` hard-restrict to `["MSPAdmin", "MSPOperator"]`
   (§6) — confirmed, not merely absent from a spot-check.
2. **`/msp/settings/users` (§1) does not filter to staff roles.** It returns every `users`
   row carrying the caller's `mspId`, including `PlatformAdmin`/`CustomerUser`/`Assessment`
   accounts that happen to share it (real, in the header's own live data) — Design should
   decide whether the MSP-console roster view needs a client-side role filter, since the
   backend does not apply one.
3. **`requireChange: true` on the temp-password response (§4) is not enforced anywhere found
   in this pack or a forward grep of `requireChange`** — it is returned but nothing forces the
   temp-password holder to change it before continuing to use it.
4. **A deleted invite (§5e) can only ever be a still-pending one.** The `WHERE usedAt IS NULL`
   clause makes an accepted invite structurally undeletable through this route — by design
   (retained history), not an oversight, but worth Design knowing before building a generic
   "delete" affordance on an accepted-invite row.
5. **No test in the repo exercises `mfa-enforcement`, per-user `sessions`,
   `customer-scopes`, `role`, `approve-purchases`, or any of the three invite routes.** The
   prior extraction's "Tests confirming real coverage" citation
   (`msp-settings.test.ts`) does not exist. A future refactor of either of §4's two
   just-fixed routes (or `revokeAllOtherSessions`) could silently reintroduce the exact
   no-op #2723 fixed, with nothing in CI to catch it. Filed as **#2906**.

---

## 9. Open gaps — NOT decided (do not resolve; flag)

1. **All 19 routes are orphaned today** (§0.1) — no UI or tool caller exists yet, and
   `artifacts/msp-console`, though it now exists, is pure scaffolding with no real page.
   #2662 (wire, blocked on #2661, blocked on this pack) is still the first thing that will
   ever call any of them from outside a test file.
2. **§4's two persistence bugs are fixed** (#2723, commit `1f46de6dc`) — both the
   MFA-enforcement toggle and per-user "revoke sessions" action now do what their response
   payloads claim. The remaining gap is test coverage for that fix, tracked separately as
   **#2906** (§8).
3. **Zero real staff members exist anywhere in this environment** (header) — nobody has ever
   invited, accepted, scoped, or managed a real `MSPAdmin`/`MSPOperator` account through this
   surface. Design/QA will need to actually drive an invite through the real routes (or via
   direct SQL) to see this Feature's later states populated with anything but a fresh empty
   roster.
4. **No per-user GET for the MSP-wide sessions list (§5a).** A staff-detail view wanting "this
   person's active sessions" has to filter the MSP-wide `GET /msp/settings/sessions` response
   client-side by `userId` — there's no scoped equivalent of §5b's revoke. Not necessarily a
   defect (MSP-wide is the one real list), but Design should know before assuming a per-user
   sessions endpoint exists to pair with §4's per-user revoke action.

---

## 10. Provenance

Extracted 2026-09-04 against branch `agent/2894-q1647`, regenerating #2660's pack per
#2894's own dispatch (full line-by-line re-audit, not an incremental patch). Full read of
all 14 `msp-settings.ts` staff/invites routes (`msp-settings.ts:536-1002`, `:1535-1779`),
the accept-side public routes (`msp-onboarding.ts:416-722`), the Drizzle schema
(`msp.ts:598-677`, `index.ts:37-117`), auth middleware (`requireAuth.ts:81-94, 206-222,
348-360`), and the customer-side analogs (`portal-team.ts:81, 423-434`) cited as direct
proof that §4's two routes now match their customer-facing parity, post-#2723. Diffed the
route file directly against the commit that fixed #2723 (`1f46de6dc`, 10 insertions/1
deletion) to confirm the exact +9-line downstream shift, and independently re-verified
every citation against the live file rather than applying the offset arithmetically.
Live DB state re-confirmed via direct `psql` against local `DATABASE_URL`: 2 real `msps`
rows, 9 real users carrying `mspId`, 0 of them `MSPAdmin`/`MSPOperator`, 0 `msp_invites`
rows, 0 `msp_staff_customer_scopes` rows — identical to #2660's extraction. Consumer sweep:
`grep -rn` across `artifacts/portal/src`, `artifacts/msp-website`,
`artifacts/shane-mccaw-consulting`, `artifacts/admin-panel/src`, and (new since #2660)
`artifacts/msp-console/src` found zero callers of any route in this pack; confirmed
`artifacts/msp-console` now exists but is 6-file scaffolding with no real page. Test-
coverage sweep (`grep -rln` across `artifacts/api-server/src --include="*.test.ts"`) found
the prior pack's `msp-settings.test.ts` citation does not exist in the repo or its git
history, and that real coverage for this surface is limited to two link-format assertions
in `msp-settings-portal-links.test.ts` — filed as **#2906**. One real finding filed this
pass: **#2906** (test-coverage gap for #2723's fix), sibling sub-issue of #2574, milestone
5, labeled `bug`, board status "AI Batter Up". No new sub-issue filed for §9's remaining
open gaps — all are expected pre-Design/pre-scaffolding state, not newly confirmed defects
meeting this project's finding bar. Read-only pass: no product code, schema, or UI was
changed by this regeneration.

# MSP Staff Roles and Onboarding (MSP Console) — contract extraction pack for Claude Design

**#2660**, step 3 of **#2574** (Feature: MSP Staff Roles and Onboarding, MSP Console), under
**#1571** (EPIC: Portal Admin — MSP-side operator surface). Follows the **#1642 pattern**:
per-surface wire contracts extracted verbatim and cited to file:line, CURRENT vs DECIDED marked
on every field, real enum unions only, cross-surface edges, honest tri-state, forbidden list,
orphaned endpoints listed explicitly. Read-only — no product code, schema, or UI changed.

**Scope correction from the dispatch comment.** #2660's dispatch comment named `msp-staff.ts`
(2 routes) + `msp-staff-search.ts` (1 route) as "the real backend, confirmed." Both files are
real and both are read below (§7, cross-surface), but neither is actually the Staff
Roles/Onboarding surface — `msp-staff.ts` is customer-impersonation-token issuance +
admin-fulfillment-queue triage, and `msp-staff-search.ts` is the Cmd+K command-palette's
cross-tenant alerts/documents search. The real backend matching this Feature's own scope line
("Real scoped accounts and RBAC for people joining the MSP itself, not customer data") is
`msp-settings.ts`'s own **Team / Users** + **Invites** route block (its header doc comment
names this directly, `msp-settings.ts:25-28`) plus the accept-side of the invite flow in
`msp-onboarding.ts`. This pack is written against that real, matching surface. Filed as
**#2723** (sibling sub-issue of #2574) so the file-identification mismatch doesn't propagate
into #2661 (Design) or #2662 (wire) working from the wrong files.

Backend route files, all real and under test:

- `artifacts/api-server/src/routes/msp-settings.ts` — 14 routes, §1-§6 below
  (`GET/PATCH/PUT/POST/DELETE /api/msp/settings/users*`, `/api/msp/settings/invites*`,
  MSP-wide `/api/msp/settings/sessions*`)
- `artifacts/api-server/src/routes/msp-onboarding.ts:369-672` — the public accept-side of the
  same invite flow, §5 below (`GET/POST /api/public/msp-invite/:token[/accept]`)

Schema: `lib/db/src/schema/msp.ts:564-580` (`mspStaffCustomerScopesTable`), `:607-623`
(`mspInvitesTable`), `:628-644` (`mspRefreshTokensTable`); `lib/db/src/schema/index.ts:45-`
(`usersTable`, incl. `:85` `mspRole`, `:88` `isActive`, `:92` `canApprovePurchases`, `:117`
`mfaEnforced`), `:37` (`MSP_ROLES`).
Auth: `artifacts/api-server/src/middlewares/requireAuth.ts:80-88` (`ROLE_ORDER`), `:90-93`
(`roleIndex`), `:205-221` (`requireRole`).
`resolveMspIdStrict()`: `artifacts/api-server/src/lib/resolve-msp-id.ts`.
Tests confirming real coverage: `artifacts/api-server/src/routes/msp-settings.test.ts` (not
read line-by-line here — this pack audits the route file itself, the primary source).

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03):

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
(`msp-settings.ts:698-700`) and `createInviteSchema` (`:1617-1620`) both hard-restrict
`mspRole` to `z.enum(["MSPAdmin", "MSPOperator"])` — this pack's routes can never create,
promote, or invite a `PlatformAdmin`, and can never touch a `CustomerUser`/`Assessment`/`Free`/
`ServiceAccount` account even though `GET /msp/settings/users` (§1) happens to return them
when they carry the same `mspId` (see the honest-state note above).

**Not built yet, on the frontend.** `artifacts/msp-console` — the app these routes are meant
to serve — does not exist (confirmed via `ls artifacts/`: `admin-panel`, `api-server`,
`mcp-server`, `msp-website`, `portal`, `shane-mccaw-consulting` — no `msp-console`). Every
route in this pack is real, tested, and currently orphaned (§0.1) — same expected
pre-scaffolding state `docs/offboarding-msp-console-contract-pack.md` §0 and
`docs/sops-msp-console-contract-pack.md` §0 already documented for their own Features.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/settings/users` | GET | `msp-settings.ts:535-578` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/customer-scopes` | GET | `msp-settings.ts:587-621` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/customer-scopes` | PUT | `msp-settings.ts:627-696` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/role` | PATCH | `msp-settings.ts:702-731` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/approve-purchases` | PATCH | `msp-settings.ts:737-766` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId` | DELETE | `msp-settings.ts:768-796` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/reset-password` | POST | `msp-settings.ts:803-838` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/temp-password` | POST | `msp-settings.ts:840-866` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/reset-mfa` | POST | `msp-settings.ts:868-921` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/mfa-enforcement` | PATCH | `msp-settings.ts:923-940` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/status` | PATCH | `msp-settings.ts:942-969` | **Nothing found** | **Yes** |
| `/api/msp/settings/users/:userId/sessions` | DELETE | `msp-settings.ts:971-993` | **Nothing found** | **Yes** |
| `/api/msp/settings/sessions` | GET | `msp-settings.ts:1526-1565` | **Nothing found** | **Yes** |
| `/api/msp/settings/sessions/:tokenHash` | DELETE | `msp-settings.ts:1567-1605` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites` | POST | `msp-settings.ts:1622-1718` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites` | GET | `msp-settings.ts:1720-1747` | **Nothing found** | **Yes** |
| `/api/msp/settings/invites/:inviteId` | DELETE | `msp-settings.ts:1749-1770` | **Nothing found** | **Yes** |
| `/api/public/msp-invite/:token` | GET | `msp-onboarding.ts:369-425` | **Nothing found** | **Yes** |
| `/api/public/msp-invite/:token/accept` | POST | `msp-onboarding.ts:436-672` | **Nothing found** | **Yes** |

```
grep -rn "msp/settings/users\|msp/settings/invites\|msp-invite" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src
```

returns no matches, and `artifacts/msp-console` does not exist to search. All 19 routes are
real and covered by `msp-settings.test.ts` / `msp-onboarding.test.ts`, but none has ever been
called from outside a test file — the MSP-console UI (#2662, blocked on Design #2661, blocked
on this pack) is the first surface that will ever call any of them. Expected pre-Design state,
not a defect — not filed as a new finding, same reasoning `docs/offboarding-msp-console-
contract-pack.md` §0.1 already used for its own Feature.

---

## 1. Wire contract — `GET /api/msp/settings/users` (`msp-settings.ts:535-578`)

Auth: `requireRole("MSPAdmin")` (`:535`). No query params — `mspId` from
`resolveMspIdStrict(req)` (`:536`), 400 `{ error: "No MSP context" }` if absent.

Returns **every** `users` row carrying this `mspId`, not filtered to `MSPAdmin`/`MSPOperator`
(honest-state note, header) — ordered `desc(createdAt)`:

| Field | Type | Source | Note |
|---|---|---|---|
| `id`, `userId` | `number` | `users.id` (both keys, same value) | kept duplicated on purpose — the pre-refactor `msp_users.id` vs `users.id` split is gone, but the future UI reads both interchangeably (`:541-546` comment) |
| `mspRole` | `"PlatformAdmin" \| "MSPAdmin" \| "MSPOperator" \| "CustomerUser" \| "ServiceAccount" \| "Free" \| "Assessment"` | `users.msp_role` | not narrowed to staff roles by this query |
| `canApprovePurchases` | `boolean` | `users.can_approve_purchases` | §3 is the one route that writes it |
| `isActive` | `boolean` | `users.is_active` | §4/§9 both write it |
| `lastLoginAt` | `Date \| null` | `users.last_login_at` | |
| `createdAt` | `Date` | `users.created_at` | |
| `email`, `name` | `string`, `string \| null` | `users.email` / `.name` | |
| `assignedCustomersCount` | `number` | computed (`:564-569`), grouped count of `msp_staff_customer_scopes` rows for that `staffUserId` within this `mspId` | **`0` means UNRESTRICTED (full MSP access), not "no access"** — the route comment (`:561-563`) states this explicitly; the UI must render `0` as "All customers", not an empty-access badge |

---

## 2. Wire contract — per-staff customer scoping (`msp_staff_customer_scopes`)

**GET `/api/msp/settings/users/:userId/customer-scopes`** (`msp-settings.ts:587-621`). Auth
`requireRole("MSPAdmin")`. 400 on invalid `mspId`/`userId`. 404 `{ error: "User not found in
this MSP" }` if the target isn't a `users` row with this `mspId` (`:592-597`).

Response:

| Field | Type | Source |
|---|---|---|
| `mspRole` | real `mspRole` enum value | target's own row |
| `scopable` | `boolean` | `true` only if `mspRole` is `"MSPAdmin"` or `"MSPOperator"` (`:617`) — the UI hides the picker for every other role |
| `allCustomers` | `Array<{ id, name, status }>` | every `tenants` row for this `mspId` (`:601-604`) |
| `assignedCustomerIds` | `number[]` | this staff member's current `msp_staff_customer_scopes` rows (`:606-611`) — empty array = unrestricted |

**PUT `/api/msp/settings/users/:userId/customer-scopes`** (`:627-696`). Body:
`{ customerIds: number[] }` (`updateScopesSchema`, `:623-625`, positive ints, de-duped
`:638`). 404 if target isn't in this MSP (`:641-646`). **400** `"Customer scoping applies only
to MSP staff (MSPAdmin/MSPOperator)"` if the target's role isn't scopable (`:647-650`) — this
is a hard server-side guard, not just a UI hint. 400 `"One or more customers do not belong to
this MSP"` if any requested id isn't a `tenants` row under this `mspId` (`:654-662`) —
IDOR-safe: a caller cannot grant access to another MSP's customer even by ID-guessing.

Write is a full replace, atomic (`:667-684`): delete every existing scope row for this
`(staffUserId, mspId)`, then insert the new set (`createdByUserId: req.user!.id`). An empty
`customerIds` array is a real, valid request — it clears all scope rows, returning the staff
member to unrestricted. Response: `{ ok: true, assignedCustomerIds: <the request's own set>,
unrestricted: <customerIds.length === 0> }`.

---

## 3. Wire contract — role, purchase-approval, removal

**PATCH `/api/msp/settings/users/:userId/role`** (`:702-731`). Body: `{ mspRole: "MSPAdmin" |
"MSPOperator" }` (`updateRoleSchema`, `:698-700`) — **only these two values are ever
accepted**; a request naming any other role (including the caller trying to hand out
`PlatformAdmin`) fails Zod validation before the handler runs. 404 if target isn't in this
MSP. Writes `mspRole` + `updatedAt` (`:713-717`). Response: `{ ok: true }` — the route does not
echo the new role back.

**PATCH `/api/msp/settings/users/:userId/approve-purchases`** (`:737-766`). Body:
`{ canApprovePurchases: boolean }`. 404 if target isn't in this MSP. Writes the flag +
`updatedAt`. Response: `{ ok: true }`.

**DELETE `/api/msp/settings/users/:userId`** (`:768-796`). **400** `"Cannot remove your own
account from the MSP"` if `userId === req.user!.id` (`:774-777`) — self-removal is blocked at
this route regardless of role. Not a hard delete: sets `isActive = false` (`:779-783`) — same
soft-remove pattern as §4's `/status` route, just with a fixed target value and the extra
self-guard. 404 if target isn't in this MSP.

---

## 4. Wire contract — credential resets, MFA, status, sessions

**POST `/api/msp/settings/users/:userId/reset-password`** (`:803-838`). Real implementation —
issues a `passwordResetTokensTable` row (1-hour TTL, `MSP_RESET_TOKEN_TTL_MS`, `:801`), same
mechanism as self-service `/auth/forgot-password`, and emails the target a reset link
(`sendEmailFromTemplate`, fire-and-forget, failure logged non-fatally, `:821-827`). Response:
`{ ok: true, message: "Password reset email sent" }`.

**POST `/api/msp/settings/users/:userId/temp-password`** (`:840-866`). Generates a real
temp password (`Temp-<12 random hex>!9`, `:853`), bcrypt-hashes it (`cost 12`) and writes it
directly to `users.password_hash` (`:854-855`) — **no email sent**; the plaintext temp
password is returned once in the response (`:865`) for the MSPAdmin to relay out-of-band.
Response: `{ ok: true, tempPassword: <plaintext>, requireChange: true }` — `requireChange` is
returned but nothing in this route (or elsewhere found in this pack) enforces a forced
password change on next login; it is advisory only in the payload today.

**POST `/api/msp/settings/users/:userId/reset-mfa`** (`:868-921`). Reads the target's current
`mfaEnrollmentsTable` methods + `webauthnCredentialsTable` rows to build a human-readable
`clearedMethods` list (`:881-891`), then **deletes** all four: `mfa_enrollments`,
`mfa_challenges`, `webauthn_credentials`, `webauthn_challenges` for that user (`:893-896`) —
a real, hard clear, not a soft flag. Emails the target a plain-HTML notice (not a
`sendEmailFromTemplate` call like the others — inline HTML string, `:898-909`). Response:
`{ ok: true, message: "MFA credentials cleared for re-enrollment" }`.

**PATCH `/api/msp/settings/users/:userId/mfa-enforcement`** (`:923-940`) — **does not persist
anything.** Reads `{ enforced }` off the body, writes only an audit-log row, and returns
`{ ok: true, enforced: !!enforced }` — **no `db.update(usersTable)` call exists in this
handler at all.** `users.mfa_enforced` (`index.ts:117`) is the real, load-bearing column —
`auth.ts` and `msp-onboarding.ts:634` both gate `mfaSetupPending` on it via
`mfaEnforcementActive(user.mfaEnforced)` — but this route never writes it, so toggling
"require MFA" for a staff member here is a complete no-op against that gate. The
customer-facing analog of this exact route, `portal-team.ts:337`
(`await db.update(usersTable).set({ mfaEnforced: enforced })...`), *does* persist the flag —
confirming this is a real, missing line in the staff-side route, not an intentional
tri-state. **Filed as #2723** (see header). §8.

**PATCH `/api/msp/settings/users/:userId/status`** (`:942-969`). Body: `{ isActive: boolean }`
— 400 if not boolean. **400** `"Cannot suspend your own account"` if `isActive === false` and
`userId === req.user!.id` (`:950-953`) — same self-protection pattern as §3's delete route.
Writes `isActive` + `updatedAt`. Response: `{ ok: true, isActive }`.

**DELETE `/api/msp/settings/users/:userId/sessions`** (`:971-993`) — **also does not do what
its response claims.** Confirms the target belongs to this MSP, writes an audit-log row
(`"user.sessions.revoke_all"`), and returns `{ ok: true, message: "All sessions revoked" }` —
**no `mspRefreshTokensTable` update, no call to any revoke helper, exists in this handler.**
Contrast the MSP-wide session routes at §5b (`:1591-1594`, a real
`UPDATE mspRefreshTokensTable SET revokedAt = now() WHERE tokenHash = ...`) and the
customer-side analog `portal-team.ts:57-82`, which calls the real
`revokeAllOtherSessions(targetUserId, null)` helper and returns an honest `revokedCount`. This
route's sessions are never actually touched — a staff member forcibly logged out here keeps
every one of their active refresh tokens valid. **Filed as #2723** (see header). §8.

## 5. Wire contract — MSP-wide sessions, invites (create/list/revoke), and accept

**5a. GET `/api/msp/settings/sessions`** (`:1526-1565`) — MSP-wide, not per-user: every
non-revoked `msp_refresh_tokens` row (`:1541-1562`) for every `isActive` user in this MSP,
joined to `email`/`name`, newest first, capped at 100. This is the real session list; §4's
per-user `DELETE .../sessions` above has no matching per-user GET (a design gap the
MSP-console UI will need to work around by filtering this MSP-wide list client-side, or by
using this route as the only real session source).

**5b. DELETE `/api/msp/settings/sessions/:tokenHash`** (`:1567-1605`) — real, working single-
session revoke. Verifies the token belongs to an active user in this MSP (`:1573-1589`), then
sets `revokedAt = now()` on that exact `mspRefreshTokensTable` row (`:1591-1594`). 404 if the
token doesn't exist or belongs to a different MSP's user.

**5c. POST `/api/msp/settings/invites`** (`:1622-1718`). Body: `{ email, mspRole: "MSPAdmin" |
"MSPOperator" }` (`createInviteSchema`, `:1617-1620`). **409** `"This user is already an
active member of your MSP"` if the email already resolves to an active `users` row with this
`mspId` (`:1634-1651`). **409** `"An unexpired invite already exists for this email. Revoke it
first if you need to resend."` if a non-expired, unused `msp_invites` row already exists for
`(mspId, email)` (`:1655-1671`) — no silent resend; the caller must explicitly revoke (§5e)
first. On success: inserts an `msp_invites` row (72-hour `expiresAt`, `:1679-1692`) and emails
the invite link (fire-and-forget, `:1705`). Response: the full inserted `MspInvite` row
(`res.status(201).json(invite)`, `:1717`) — includes the raw `token` field verbatim in the
JSON response (not redacted), since the creating MSPAdmin is the one who needs it to confirm
the send.

**5d. GET `/api/msp/settings/invites`** (`:1720-1747`). Lists only **still-pending** invites
for this MSP — `isNull(usedAt) AND expiresAt >= now()` (`:1737-1743`); a used or expired
invite silently drops off this list (it is never deleted, just filtered out — see §6). Fields:
`id`, `invitedEmail`, `mspRole`, `expiresAt`, `createdAt`, plus `inviterEmail`/`inviterName`
via a left join on `invitedByUserId` (`null` if the inviter's own account was later removed).

**5e. DELETE `/api/msp/settings/invites/:inviteId`** (`:1749-1770`). Hard `DELETE`, not a
soft revoke — but scoped `WHERE id = :inviteId AND mspId = mspId AND usedAt IS NULL`
(`:1754-1757`): **an already-used invite cannot be deleted through this route** (404 `"Invite
not found or already used"`), so accepted-invite history is retained by omission, not by a
status flag (see §6).

**5f. GET `/api/public/msp-invite/:token`** (`msp-onboarding.ts:369-425`). Public, no auth —
rate-limited (`inviteAcceptLimiter`, 30 req/15min prod, 500 dev, `:358-364`). Validates the
token and returns display info for the accept page: `invitedEmail`, `mspRole`, `expiresAt`,
and the `msp` object (`id`, `name`, `slug`, `logoUrl`, `primaryColor`) — **no auth performed,
this is intentionally the public pre-login screen**. 404 nonexistent token, 410 already-used
(`row.usedAt`), 410 expired, 403 if the owning MSP's `status === "suspended"`.

**5g. POST `/api/public/msp-invite/:token/accept`** (`:436-672`). Body:
`{ name?, password? }` (`acceptInviteSchema`, `:431-434` — `password` min 8 chars). Same
404/410/410/403 validation as §5f, then branches on whether `invitedEmail` already has a
`users` row (`:486-490`):

- **Existing account** (`:496-526`): the request MUST carry a valid `Authorization: Bearer`
  JWT whose `email` claim matches the invited email exactly — 401
  `{ error: "...Please sign in to accept...", requiresSignIn: true }` if unauthenticated, 403
  if signed in as a *different* email. **A bare possession of the invite token is never
  sufficient to reassign an existing account's MSP membership** — this is a deliberate
  anti-hijack guard (comment `:492-495`).
- **New account** (`:527-537`): `name` and `password` become required (400 if either is
  missing) — the invite-accept path is also the account-creation path for a brand-new staff
  member.

Both branches run inside one transaction (`:542-601`): the invite is burned with a
`WHERE usedAt IS NULL` guard (`:545-553`, throws `ALREADY_USED` → 410 on a concurrent double-
accept race — real, tested protection, not just a comment) before either branch writes to
`users`. Existing-account branch re-points `mspId`/`mspRole`/`isActive: true` onto the existing
row **only if it isn't already exactly that** (`:578-583`) — a no-op-safe upsert, not an
unconditional overwrite. New-account branch inserts a fresh `users` row with `mspId`/`mspRole`
inline (**required** — the schema default `mspRole: "Free"` combined with the
`users_role_scope_check` constraint would reject a bare insert with no `tenantId` and no
`mspId`; comment `:560-564` states this explicitly).

On success, if `JWT_SECRET` is configured, the route auto-logs the accepting user in
(`:613-670`): issues a 15-minute access token and a 7-day refresh token (real
`mspRefreshTokensTable` insert, `:652-658`), gated by the same `mfaEnforcementActive()` /
`mfaSetupPending` check every other login path in `auth.ts` uses (`:634` — Git #439 parity,
comment cites it explicitly) so a brand-new staff account with zero MFA methods enrolled comes
back restricted to the enrollment endpoints rather than a fully open session. Response:
`{ ok: true, mspSlug, accessToken, refreshToken, refreshExpiresAt }` on the auto-login path,
or the bare `{ ok: true, mspSlug }` if token issuance fails or `JWT_SECRET` is absent
(`:614`, `:672`) — auto-login failure is caught and logged, never blocks the accept itself.

---

## 6. Real enum unions

- **MSP role hierarchy** — `MSP_ROLES` (`index.ts:37`): `["PlatformAdmin", "MSPAdmin",
  "MSPOperator", "CustomerUser", "ServiceAccount", "Free", "Assessment"]` — declared order is
  NOT privilege order. Real privilege order is `ROLE_ORDER` (`requireAuth.ts:80-88`), lowest
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
  this one's — the header correction, restated with the actual content.** `msp-staff.ts`'s
  `POST /api/msp/:mspId/customers/:customerId/impersonate` issues a time-boxed customer-
  impersonation token for an MSP staff member acting *as* a customer login — orthogonal to
  this pack's staff-roster/RBAC scope, though it does share `mspAuditLogsTable` and the same
  `requireRole`/`requireMspScope` middleware pair. Its `GET
  /api/msp/:mspId/fulfillment-queue` is unrelated to staff at all — a delivery-SLA triage
  list — and is itself doubly orphaned: not just unconsumed by any MSP-console UI, but a
  *different* route (`GET /api/admin/fulfillment-queue`, `admin-fulfillment.ts`, confirmed
  live via `FulfillmentQueue.tsx` / `fulfillmentApi.ts:61` in `admin-panel`) already serves the
  real fulfillment-queue UI that exists today. `msp-staff-search.ts`'s
  `GET /api/msp/staff-search` is the Cmd+K palette's cross-tenant alerts/documents search —
  real, tested, reuses `resolveStaffScopedCustomerIds` (the same helper §2's scoping feeds),
  but has nothing to do with roster management or onboarding either.
- **`resolveStaffScopedCustomerIds` is the one real enforcement consumer of §2's data.**
  `requireAuth.ts:349-370` reads `msp_staff_customer_scopes` to narrow a scoped staff member's
  access on cross-customer list/aggregate routes MSP-wide (including `msp-staff-search.ts`,
  above) — this pack's §2 PUT is the only route in the whole codebase that ever writes that
  table; every other consumer only reads it.
- **`users.mfa_enforced` is shared with the customer-facing team surface**, and that surface's
  own toggle route (`portal-team.ts:337`) is the one that correctly persists it — direct proof
  this pack's §4 `/mfa-enforcement` route is missing a line, not a deliberately different
  contract (§8).
- **`mspRefreshTokensTable` is written by three different flows in this pack alone**: login-
  equivalent issuance at invite-accept (§5g), single-session revoke at §5b, and the no-op §4
  per-user revoke that should be writing here but doesn't (§8).
- **`msp_audit_logs` is the one audit trail for every write in this pack** — `writeAuditLog()`
  (`msp-settings.ts:101-`) is called on every mutating route in §1-§5 without exception,
  including both routes that don't otherwise persist anything (§4's mfa-enforcement and
  sessions-revoke) — the audit trail itself is real even where the underlying effect is not,
  which is part of why the gap in §8 is easy to miss from the audit log alone.

---

## 8. The forbidden list — declared, not merely absent

1. **§4's `/mfa-enforcement` route does not persist `enforced` anywhere.** No
   `db.update(usersTable)` call in the handler (`msp-settings.ts:923-940`); confirmed against
   the real, persisting customer-side analog `portal-team.ts:337`. Filed as **#2723**.
2. **§4's per-user `/sessions` route does not revoke any session.** No
   `mspRefreshTokensTable` write, no revoke-helper call, in the handler
   (`msp-settings.ts:971-993`); confirmed against the real, working MSP-wide single-session
   revoke at §5b (`:1591-1594`) and the customer-side analog `portal-team.ts:81`
   (`revokeAllOtherSessions`). Filed as **#2723**.
3. **No route in this pack can assign, invite, or promote to `PlatformAdmin`.** Both
   Zod schemas that accept an `mspRole` hard-restrict to `["MSPAdmin", "MSPOperator"]`
   (§6) — confirmed, not merely absent from a spot-check.
4. **`/msp/settings/users` (§1) does not filter to staff roles.** It returns every `users`
   row carrying the caller's `mspId`, including `PlatformAdmin`/`CustomerUser`/`Assessment`
   accounts that happen to share it (real, in the header's own live data) — Design should
   decide whether the MSP-console roster view needs a client-side role filter, since the
   backend does not apply one.
5. **`requireChange: true` on the temp-password response (§4) is not enforced anywhere found
   in this pack or a forward grep of `requireChange`** — it is returned but nothing forces the
   temp-password holder to change it before continuing to use it.
6. **A deleted invite (§5e) can only ever be a still-pending one.** The `WHERE usedAt IS NULL`
   clause makes an accepted invite structurally undeletable through this route — by design
   (retained history), not an oversight, but worth Design knowing before building a generic
   "delete" affordance on an accepted-invite row.

---

## 9. Open gaps — NOT decided (do not resolve; flag)

1. **All 19 routes are orphaned today** (§0.1) — no UI or tool caller exists yet, and
   `artifacts/msp-console` itself doesn't exist. Expected pre-Design/pre-scaffolding state;
   #2662 (wire, blocked on #2661, blocked on this pack) is the first thing that will ever call
   any of them from outside a test file.
2. **§8.1/§8.2's two real persistence bugs (filed as #2723)** will need a real fix — either in
   this Feature's own build phase or a small standalone follow-up — before the MSP-console
   UI's MFA-enforcement toggle and per-user "revoke sessions" action can be trusted to do what
   their own response payloads already claim they do today.
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

Extracted 2026-09-03 against branch `agent/2660-q1418`, a new pack (no prior version of this
surface existed). Full read of all 14 `msp-settings.ts` staff/invites routes
(`msp-settings.ts:535-993`, `:1526-1770`), the accept-side public routes
(`msp-onboarding.ts:356-672`), the Drizzle schema (`msp.ts:564-644`, `index.ts:37-117`), auth
middleware (`requireAuth.ts:80-93, 205-221, 349-370`), and the customer-side analogs
(`portal-team.ts:57-82, 337-348`) cited as direct proof of the two persistence gaps in §8.
Live DB state confirmed via direct `psql` against local `DATABASE_URL`: 2 real `msps` rows, 9
real users carrying `mspId`, 0 of them `MSPAdmin`/`MSPOperator`, 0 `msp_invites` rows, 0
`msp_staff_customer_scopes` rows. Consumer sweep: `grep -rn` across `artifacts/portal/src`,
`artifacts/msp-website`, `artifacts/shane-mccaw-consulting`, `artifacts/admin-panel/src` found
zero callers of any route in this pack, and confirmed `artifacts/msp-console` does not exist.
Also swept `msp-staff.ts`'s `fulfillment-queue` route against `admin-panel`'s real
`FulfillmentQueue.tsx`/`fulfillmentApi.ts` — confirmed that UI calls a different route
(`/api/admin/fulfillment-queue`), so `msp-staff.ts`'s own route is independently orphaned too.
Two real findings filed as **#2723** (persistence gaps, §8.1/§8.2) and the file-identification
correction is recorded in this pack's own header rather than filed separately (it's a scoping
note for #2661/#2662, not a code defect). No new sub-issue filed for §9's remaining open gaps
— all are expected pre-Design/pre-scaffolding state, not newly confirmed defects meeting this
project's finding bar. Read-only pass: no product code, schema, or UI was changed.

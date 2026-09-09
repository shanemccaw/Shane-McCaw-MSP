# Account Security (MSP Console) — contract extraction pack

**#2622**, step 3 of **#2562** (Feature: Account Security, MSP Console), under **#1571**
(EPIC: Portal Admin — MSP-side operator surface). Sibling sub-issues: **#2623** (Claude
Design export), **#2624** (wire), both blocked on this pack. Follows the **#1642 pattern**:
per-surface wire contracts extracted verbatim and cited to file:line, CURRENT vs DECIDED
marked on every field, real enum unions only, cross-surface edges, honest tri-state,
forbidden list, orphaned endpoints listed explicitly. Read-only — no product code, schema,
or UI changed by this session.

**#2562's own scope statement:** "Support-scoped ability to assist a customer with their
own security settings — never a shared/bypass credential, real audit trail on every
action." Its body also states it is "the operator/write counterpart to Portal (#1485),
derived from #1595" — i.e. the write-side mirror of `docs/portal/account-security-contract-pack.md`
(the customer's own read-only Account Security page: MFA state, active sessions, login
history — see that pack for the read side; not re-extracted here).

---

## 0. What this surface genuinely is — and the real scope collision with #2574

**There is no dedicated, tenant/customer-scoped "support assists a customer" backend.**
The only real, callable implementations of password-reset / MFA-reset / MFA-enforcement /
session-revoke actions anywhere in `artifacts/api-server/src/routes/` are five routes in
`msp-settings.ts`, and **those same five routes are already the ones documented as
MSP-staff-roster management in `docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md` §4**,
under Feature #2574 (MSP Staff Roles and Onboarding). This pack does not introduce a second
set of routes — it re-reads the same five against #2562's own framing and states plainly
where that framing does and doesn't hold up against the real code.

**A repo-wide sweep confirmed no other candidate exists.** Searched
`msp-staff.ts`, `msp-staff-search.ts`, `msp-support.ts`, `admin-impersonation.ts`, and a
repo-wide grep for any `customers/:customerId` route combined with
`password|mfa|session|reset` — zero matches beyond `msp-settings.ts`'s five routes:

- `msp-staff.ts:11` (`POST /msp/:mspId/customers/:customerId/impersonate`) is real, but it
  issues a **time-boxed impersonation token** — the caller browses the product logged in
  *as* the customer. That is structurally the "shared/bypass credential" #2562's own scope
  line explicitly excludes ("never a shared/bypass credential"), and it never touches a
  password, MFA enrollment, or a session row. **Out of this Feature's scope by #2562's own
  wording**, not merely unrelated code.
- `msp-support.ts` (`GET/POST /msp/support/requests*`) is the #2570 Zoho Desk ticket proxy —
  no `usersTable`/password/MFA/session interaction at all.
- `admin-impersonation.ts` (`POST /admin/impersonate/:userId`, `/admin/msps/:mspId/impersonate`)
  is `requireAdmin` (PlatformAdmin-only "view as" tooling), not an MSP-support-staff surface,
  and — same as `msp-staff.ts`'s impersonate route — a bypass-credential mechanism, not a
  security-settings action.

### The real, load-bearing distinction: `usersTable.mspId` vs `usersTable.tenantId`

`usersTable`'s own CHECK constraint (`users_role_scope_check`, referenced from
`lib/db/src/schema/index.ts`) is an **OR of three clauses**, not a mutually-exclusive
switch:

```
(mspRole IN ('CustomerUser','Free','Assessment') AND tenantId IS NOT NULL)
OR (mspRole IN ('MSPAdmin','MSPOperator','ServiceAccount') AND mspId IS NOT NULL)
OR (mspRole = 'PlatformAdmin')
```

It only *requires* `tenantId` on a `CustomerUser` row — it never *forbids* that same row
from also carrying `mspId`. Confirmed live (`docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md`
header dump, re-verified this session against local `DATABASE_URL`): 4 of the 9 `mspId=1`
rows are real `CustomerUser` accounts (ids 39, 42, 57, 103), each with both a real `tenantId`
(their genuine, correct scope — the `tenants` row for the customer org they belong to,
`tenantsTable`, itself FK'd to `mspsTable`) **and** a legacy `mspId=1` carried over from
before the `msp_users`→`users` merge. `index.ts`'s own column comment on `mspId` reads
"absorbed from msp_users (Phase 0)" — this is a leftover artifact of that merge, not an
intentional "these are the MSP's direct customers" design.

**`tenants` is the real customer-org scoping table.** `msp-settings.ts`'s own
`GET .../customer-scopes` route (§2 of the #2574 pack) queries `tenantsTable WHERE mspId =
:mspId` for "this MSP's customer list" — the product's own code already treats `tenants`,
not `users.mspId`-carrying rows, as "the MSP's customers." The five routes this pack is
about never touch `tenantsTable` at all; they resolve their target purely via
`usersTable.id` + `usersTable.mspId`.

**What this means for #2562's framing:** "assist a customer with their own security
settings" cannot currently mean "reset a tenant-scoped portal customer's password by
`tenantId`/`customerId`" — no such route exists. The only sense in which these five routes
touch a "customer" today is the accidental one: a `CustomerUser` row that *also* happens to
carry a legacy `mspId` gets caught by the same `WHERE mspId = :mspId` filter that reaches
real MSP staff. The backend applies **zero role-aware distinction** between "resetting a
fellow staff member's credentials" (#2574's scope) and "resetting a customer's credentials"
(#2562's stated scope) — same five routes, same filter, no `mspRole` check on the target at
all (see §4).

---

## 0.1 The five routes, and the real finding this produced

| Route | Method | file:line | Target check |
|---|---|---|---|
| `/msp/settings/users/:userId/reset-password` | POST | `msp-settings.ts:804-839` | `id = :userId AND mspId = :mspId` only |
| `/msp/settings/users/:userId/temp-password` | POST | `msp-settings.ts:841-867` | same |
| `/msp/settings/users/:userId/reset-mfa` | POST | `msp-settings.ts:869-922` | same |
| `/msp/settings/users/:userId/mfa-enforcement` | PATCH | `msp-settings.ts:924-946` | same (no existence check at all — see §4) |
| `/msp/settings/users/:userId/status` | PATCH | `msp-settings.ts:948-975` | same, plus a self-suspend guard |

**Real finding filed this session: #3032** (`URGENT`, `bug` + `security`, sibling sub-issue
of #2562). None of these five routes compares the target's `mspRole` to the caller's —
`requireRole("MSPAdmin")` (`requireAuth.ts:206-222`) is a **minimum-tier floor on the
caller only** (`roleIndex(caller) >= roleIndex("MSPAdmin")`); `ROLE_ORDER`
(`requireAuth.ts:81-89`) places `PlatformAdmin` *above* `MSPAdmin`. Since the owning
PlatformAdmin's own row (`shane@shanemccaw.com`, id 1) itself carries `mspId = 1`, a real
MSPAdmin at that same MSP could call `POST /msp/settings/users/1/temp-password` today and
receive a plaintext password logging in as the PlatformAdmin — full privilege escalation,
zero interaction with the target required. Not yet exploited (zero real `MSPAdmin`/
`MSPOperator` accounts exist in the live DB, per the #2574 pack's own dump), but live,
deployed, and reachable by direct HTTP call the moment the first real MSPAdmin exists.
**Design must not treat "the caller is MSPAdmin-or-above" as sufficient authorization for
these actions against an arbitrary target** — that premise is false in the current code.

---

## 1. Wire contract — the five routes, re-verified against the current file

**POST `/msp/settings/users/:userId/reset-password`** (`:804-839`). `requireRole("MSPAdmin")`.
Ownership check 404s `{ error: "User not found in this MSP" }` if `(userId, mspId)` doesn't
resolve (`:810-815`). Issues a `passwordResetTokensTable` row (`MSP_RESET_TOKEN_TTL_MS`,
1 hour), emails the target a reset link via `sendEmailFromTemplate("password-reset", ...)`
(fire-and-forget, failure logged non-fatally, `:822-828`) built off `getMspPortalBaseUrl()`
(confirmed by `msp-settings-portal-links.test.ts:165-184` — the one real test touching this
route, link-format only). Audit-logs `user.password.reset_email_sent` (`:830-836`). Response:
`{ ok: true, message: "Password reset email sent" }`.

**POST `/msp/settings/users/:userId/temp-password`** (`:841-867`). Same auth/ownership
pattern. Generates `` `Temp-${randomBytes(6).toString("hex").toUpperCase()}!9` `` (`:854`),
bcrypt-hashes at cost 12, writes directly to `users.password_hash` (`:855-856`) — **no email
sent**; the plaintext is returned once in the response for the caller to relay out-of-band.
Audit-logs `user.password.temp_set`. Response: `{ ok: true, tempPassword: <plaintext>,
requireChange: true }` — `requireChange` is advisory only; no route anywhere in the repo
enforces a forced change on next login (confirmed, same gap the #2574 pack's §8 already
found independently).

**POST `/msp/settings/users/:userId/reset-mfa`** (`:869-922`). Same auth/ownership pattern.
Reads the target's `mfaEnrollmentsTable` methods + `webauthnCredentialsTable` rows to build
a human-readable `clearedMethods` list, then hard-**deletes** all four tables for that user:
`mfa_enrollments`, `mfa_challenges`, `webauthn_credentials`, `webauthn_challenges`
(`:894-897`) — real, irreversible, not a soft flag. Emails the target an inline-HTML notice
(not `sendEmailFromTemplate`, `:899-910`). Audit-logs `user.mfa.reset` with `clearedMethods`
in metadata. Response: `{ ok: true, message: "MFA credentials cleared for re-enrollment" }`.
Link-format-only test coverage, same as reset-password (`msp-settings-portal-links.test.ts:195-215`).

**PATCH `/msp/settings/users/:userId/mfa-enforcement`** (`:924-946`). **No existence check
at all** — unlike the other four routes, this one runs its `UPDATE ... WHERE id = :userId
AND mspId = :mspId` unconditionally and never queries the target first; a non-existent or
wrong-MSP `userId` still returns `{ ok: true, enforced: ... }` (the `UPDATE` simply affects
zero rows). Writes `users.mfa_enforced` (fixed from a no-op by #2723, commit `1f46de6dc`,
per the #2574 pack) and audit-logs `user.mfa.enforcement_toggle`. `users.mfa_enforced` is
the real, load-bearing column both `auth.ts` and `msp-onboarding.ts` gate `mfaSetupPending`
on, and the same column the customer-facing `portal-team.ts:423` analog writes. **Real
test coverage now exists**: `msp-settings-user-security.live-db.test.ts:108-144` (added
2026-09-04, commit `aed211957`, closing #2906's gap for this route specifically) asserts
against a real local-Postgres row, both flip-true and flip-back-false — this pack's
citation of that test is more current than the #2574 pack's own "no test exercises this
route" line, which predates `aed211957`.

**PATCH `/msp/settings/users/:userId/status`** (`:948-975`). Body `{ isActive: boolean }`,
400 if not boolean. **400** `"Cannot suspend your own account"` if `isActive === false` and
`userId === req.user!.id` (`:956-959`) — the one route of the five with any target-aware
guard at all, and it only protects the caller's own id, not a role ceiling. Writes
`isActive` + `updatedAt`, audit-logs `user.activate`/`user.suspend`. Response: `{ ok: true,
isActive }`.

---

## 2. CURRENT / DECIDED

| Action | Status | Note |
|---|---|---|
| Password reset (email link) | **CURRENT** | Real token + real email, orphaned (§5) |
| Temp password (direct set, returned in response) | **CURRENT** | No forced-change enforcement — advisory `requireChange` only |
| MFA reset (hard delete) | **CURRENT** | Irreversible; real email notice |
| MFA enforcement toggle | **CURRENT, and now test-covered** | Fixed by #2723; tested by `aed211957` |
| Session revoke — MSP-wide list + single revoke + per-user "revoke all" | **CURRENT, and now test-covered** | §4 below; MFA-enforcement's sibling fix, same #2723/#2906/`aed211957` |
| Status (suspend/reactivate) | **CURRENT** | Self-suspend blocked; no role ceiling |
| Target-role ceiling (caller cannot act on a higher-privileged target) | **MISSING — filed as #3032** | See §0.1 |
| A tenant/`customerId`-scoped equivalent of any of the above (the literal "assist a
  [managed-tenant] customer" case) | **DOES NOT EXIST** | No route anywhere resolves a
  target by `tenantId`; would be new backend work, not yet architected under #2562 |
| Customer-impersonation ("view as", `msp-staff.ts:11`) | **CURRENT, but explicitly out of
  this Feature's scope** | #2562's own wording rules out shared/bypass-credential
  mechanisms |

---

## 3. Real enum unions

Same source-of-truth as the #2574 pack (not re-derived independently — cited here for this
pack's own field references):

- **MSP role hierarchy** — `MSP_ROLES` (`index.ts:37`):
  `["PlatformAdmin", "MSPAdmin", "MSPOperator", "CustomerUser", "ServiceAccount", "Free",
  "Assessment"]`. Real privilege order is `ROLE_ORDER` (`requireAuth.ts:81-89`), lowest to
  highest: `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin <
  PlatformAdmin`. **None of §1's five routes reads this hierarchy against the target** — the
  gap §0.1/#3032 documents.
- **Session revocation scope** — `DELETE /msp/settings/users/:userId/sessions`
  (`msp-settings.ts:977-1002`) calls the real `revokeAllOtherSessions(userId, null)`
  (`session-tracking.ts:107-134`, fixed by the same #2723 commit) — revokes every
  non-revoked `user_sessions` row and cascades `msp_refresh_tokens` for that user, returns a
  real `revokedCount`. Same helper the customer-facing `portal-team.ts:81` analog and
  §5b/§5a's MSP-wide session routes rely on. **Real, tested**:
  `msp-settings-user-security.live-db.test.ts:146-234` asserts the actual row state
  (session + refresh-token both revoked, a subsequent `/auth/refresh` with the old token
  rejected) and that a wrong-MSP `userId` 404s without revoking a stranger's sessions
  (`:210-233`).
- **`isActive`** — boolean, not a stored status enum. No `"suspended"` string value anywhere
  on `usersTable`; suspension is `isActive = false` (the same soft-remove shape §3 of the
  #2574 pack documents for `DELETE .../users/:userId`, which sets the identical flag with a
  fixed value rather than an explicit caller-supplied one).

---

## 4. The forbidden list — declared, not merely absent

1. **No target-role ceiling on any of the five routes in this pack** (§0.1, filed as
   **#3032**). This is the load-bearing gap for #2562's own scope statement ("support-scoped
   ability... never a shared/bypass credential") — a route with no role-aware target check
   is not genuinely "support-scoped" no matter how the UI built on top of it is labeled.
2. **No `tenantId`/`customerId`-scoped route exists for any of these five actions.** Design
   should not assume a managed-tenant customer's portal account is reachable through this
   surface at all today — only `usersTable.mspId`-carrying rows are, and per §0, that set is
   dominated by a legacy Phase-0 artifact, not a deliberate "these are our customers" list.
3. **`requireChange: true` on the temp-password response is not enforced anywhere in the
   repo** — same gap independently confirmed by the #2574 pack's own §8.
4. **`mfa-enforcement`'s target lookup has no existence check** (§1) — the only one of the
   five routes that will report `{ ok: true }` for a `userId` that doesn't exist or belongs
   to a different MSP, because the `UPDATE` simply matches zero rows.
5. **Customer-impersonation (`msp-staff.ts:11`) is real and already live, but it is not this
   Feature.** #2562's own scope line rules it out by name ("never a shared/bypass
   credential"). Do not let Design fold "log in as the customer to fix things" into this
   Feature — that capability already exists elsewhere and is a different trust model
   entirely (the operator sees everything the customer sees, rather than performing one
   named, audited action on their behalf).

---

## 5. Orphan sweep — same result as #2574's pack, re-confirmed independently

```
grep -rn "msp/settings/users" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src artifacts/msp-console/src
```

returns no matches. `artifacts/msp-console` remains 6-file Vite/React scaffolding
(`App.tsx`, `main.tsx`, `pages/index.tsx`, `pages/not-found.tsx`, `index.css`, `lib/utils.ts`)
with no real page and no reference to any route in this pack. All five routes are real,
partially tested (§1-§3), and currently called by nothing outside a test file. #2624 (wire,
blocked on #2623, blocked on this pack) is still the first thing that will ever call any of
them from a real UI.

---

## 6. Cross-surface edges

- **This pack's five routes and `docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md` §4
  are the literal same five routes**, not parallel implementations. Any future fix to one
  (starting with #3032) changes both Features' real behavior simultaneously — a session
  picking up #2574 work after #3032 lands should re-verify that pack's §4 citations rather
  than assume it's still accurate, the same way this pack re-verified and superseded its
  stale "no test exercises mfa-enforcement/sessions" claim (§1).
- **`docs/portal/account-security-contract-pack.md`** (portal's own customer-facing read side, per
  #1595) documents the *read* half of the identity this pack's routes write to: MFA
  enrollments (`mfa_enrollments`/`webauthn_credentials`), active sessions (`user_sessions`),
  login history. A customer whose MFA this pack's `reset-mfa` route clears would see that
  reflected on their own Account Security page's MFA card on next load — same tables, no
  separate sync needed.
- **`msp_audit_logs` is the one audit trail for every write in this pack**, via
  `writeAuditLog()` (`msp-settings.ts`) — called on all five routes without exception,
  matching #2562's own "real audit trail on every action" requirement for the four routes
  that actually check ownership (§0.1's `mfa-enforcement` row logs even when it silently
  affects zero rows, since the audit write isn't gated on the `UPDATE`'s row count).
- **`msp-staff.ts`'s impersonation route** shares `mspAuditLogsTable` and roughly the same
  `requireRole` middleware family with this pack's routes, but is a structurally different,
  explicitly out-of-scope mechanism (§0, §4.5).

---

## Not covered by this pack

Whether/how to build a genuine `tenantId`-scoped "assist a managed-tenant customer" surface
is an open architecture question for #2562, not resolved here — this pack extracts what
exists (the mspId-scoped roster routes, shared with #2574) and states plainly that it does
not yet match #2562's own stated scope. Fixing #3032's role-ceiling gap is not performed in
this session (read-only per #2622's own dispatch); it is filed and blocking-eligible for
whichever session picks it up next.

---

## Provenance

Extracted 2026-09-06 against `main` (commit `1f46de6dc` is the last commit touching
`msp-settings.ts`; this pack itself was written against that state, before any code
change). Full re-read of all five routes (`msp-settings.ts:804-1002`), `requireAuth.ts`'s
role hierarchy and `requireRole()` (`:81-94`, `:206-222`), the `users_role_scope_check`
CHECK constraint and `usersTable.mspId`/`.tenantId` columns (`index.ts`), and both test
files touching this surface (`msp-settings-portal-links.test.ts`,
`msp-settings-user-security.live-db.test.ts`). Cross-checked against
`docs/msp-console/msp-staff-roles-and-onboarding-contract-pack.md` (§4, §7, §8) to identify genuine
scope overlap rather than re-deriving the same routes independently. Repo-wide greps
confirmed no `tenantId`/`customerId`-scoped equivalent exists anywhere
(`msp-staff.ts`, `msp-staff-search.ts`, `msp-support.ts`, `admin-impersonation.ts`, and a
`customers/:customerId` + `password|mfa|session|reset` sweep, all zero-match beyond the
five routes documented here). Live DB state re-confirmed via direct `psql` against local
`DATABASE_URL`: same 2 `msps` rows, 9 `mspId`-carrying users (1 `PlatformAdmin`, 5
`Assessment`, 4 `CustomerUser`, 0 `MSPAdmin`/`MSPOperator`) as the #2574 pack's own dump.
One real finding filed this pass: **#3032** (`URGENT`, `bug` + `security`, no target-role
ceiling on any of the five routes — a real privilege-escalation path once a real MSPAdmin
account exists), sibling sub-issue of #2562, milestone "v1.1 - Monitoring & Launch Control",
board status "AI Batter Up". Read-only pass: no product code, schema, or UI was changed by
this regeneration.

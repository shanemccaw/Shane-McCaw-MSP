# Auth Core — contract extraction pack

**Issue:** #2441 (Auth Core: generate the contract pack from the real backend), part of
#1648 ("Feature: Auth Core (Portal)"), itself part of #1485 (EPIC: Portal New Design).
Method per the #1642 pattern. Extracted, not authored — every field below traces to one
of the files listed, cited to file:line. READ-ONLY session; no product code changed
producing this pack (schema/route files were only read, not modified).

Design surface: none yet. No `Design/portal/` `.dc.html` export exists for any Auth Core
page — the archived `artifacts/msp-portal` pages this pack cross-references
(`login.tsx`, `reset-password.tsx`, `account-setup.tsx`, `portal-sign-in-help.tsx`, all
631/182/538/912 lines) are **prior art for real request/response shapes and edge cases
only**, per #2441's own body and #1648's "carry forward: endpoint calls, error states,
validation, redirect logic — do not carry forward markup, layout, or any `*Data.ts`
import." They are read from the annotated tag `portal-archive-2026-08-29`, not the live
tree (`artifacts/msp-portal` no longer exists, retired wholesale by `f40438cdc`).

Sources this pack is built against:

- `artifacts/api-server/src/routes/auth.ts` — `/auth/forgot-password`,
  `/auth/reset-password`, `/auth/setup-context`, `/auth/setup-password`, plus
  `/auth/login` (not in #2441's list, but the entry point that issues the `mfaToken`
  every MFA-challenge endpoint below consumes — included as necessary context)
- `artifacts/api-server/src/routes/mfa.ts` — `/auth/mfa/totp/challenge`,
  `/auth/mfa/bypass`, plus `getActiveMfaMethods`, `signMfaToken`/`verifyMfaToken`,
  `issueFullSession` (the shared session-issuing tail both challenge endpoints call)
- `artifacts/api-server/src/routes/msp-custom-domain.ts` — `/portal/branding`
- `artifacts/api-server/src/routes/portal-sign-in-help.ts` — `/portal/sign-in-help/ticket`
- `artifacts/api-server/src/routes/public-status.ts` — `/status`
- `artifacts/api-server/src/routes/index.ts` — router mount confirmation (`/api` prefix)
- `artifacts/api-server/src/lib/zoho-desk.ts` — `raiseSignInHelpTicket()`,
  `SignInHelpTicketResult`
- `artifacts/api-server/src/lib/session-tracking.ts` — `listLoginHistory` (sign-in-help's
  attached history)
- `lib/db/src/schema/index.ts`, `lib/db/src/schema/msp.ts` — `mfa_enrollments`,
  `mfa_challenges`, `mfa_bypass_codes`, `account_setup_tokens`, `password_reset_tokens`,
  `msps`, `users` table definitions (the real enum/nullability sources)
- `git show portal-archive-2026-08-29:artifacts/msp-portal/src/pages/{login,
  reset-password,account-setup,portal-sign-in-help}.tsx` — archived client shapes, for
  §1's "consumed vs. available" columns only
- Live queries against local PostgreSQL (`DATABASE_URL`), 2026-09-03 — real row counts
  cited in §6

---

## Step 1 — endpoint verification (per #2441's own instruction: confirm before extracting)

All 9 endpoints named in #2441 are **real, live, and mounted** in the current
`artifacts/api-server`, post-#1673 restructure. None moved, none orphaned:

| Endpoint | File:line | Mounted via |
|---|---|---|
| `POST /api/auth/forgot-password` | `auth.ts:718` | `routes/index.ts:307` `router.use(authRouter)` |
| `POST /api/auth/mfa/bypass` | `mfa.ts:1052` | `routes/index.ts:380` `router.use(mfaRouter)` |
| `POST /api/auth/mfa/totp/challenge` | `mfa.ts:425` | same |
| `POST /api/auth/reset-password` | `auth.ts:783` | `router.use(authRouter)` |
| `GET /api/auth/setup-context` | `auth.ts:649` | same |
| `POST /api/auth/setup-password` | `auth.ts:547` | same |
| `GET /api/portal/branding` | `msp-custom-domain.ts:40` | `routes/index.ts:547` `router.use(mspCustomDomainRouter)` |
| `POST /api/portal/sign-in-help/ticket` | `portal-sign-in-help.ts:133` | `routes/index.ts:478` `router.use(portalSignInHelpRouter)` |
| `GET /api/status` | `public-status.ts:298` | `routes/index.ts:311` `router.use(publicStatusRouter)` |

`app.ts:115` mounts the whole `routes/index.ts` router at `/api`, confirming the full
paths above. No stale/renamed routes found — the old page's endpoint list held.

---

## 1. Wire contracts

### `POST /api/auth/forgot-password` (`auth.ts:718-780`)

Public, no `requireAuth`. Request: `{ email?: string }`.

**Always responds `200 { ok: true }` immediately** (`auth.ts:721`), before any DB work —
the endpoint never reveals whether an email exists. All real work happens after the
response is sent (fire-and-forget), guarded by early `return` if `email` is missing or
no matching user is found (`auth.ts:723`, `729`).

Two real branches once a matching user is found:

- **No `passwordHash`** (never completed setup) — issues an `account_setup_tokens` row
  (72h TTL, `auth.ts:747`) **only if** `hasRealEntitlement(user.id)` passes
  (`auth.ts:737`, a real `client_services` row check, `auth.ts:111-118`) — refuses
  silently (log-only) otherwise. This is the #656 fix: a consent-time Prospect with no
  purchase must not receive a working setup link through this door either. Sends the
  `account-setup` email template via `sendEmailFromTemplate` (`auth.ts:753-759`),
  `.catch(() => null)`'d so a mail failure never surfaces to the caller.
- **Has `passwordHash`** — issues a `password_reset_tokens` row (1h TTL,
  `RESET_TOKEN_TTL_MS = 60 * 60 * 1000`, `auth.ts:73`, `765`), builds
  `{PORTAL_BASE_URL}/reset-password?token=...` (`auth.ts:769-771`), sends the
  `password-reset` template.

No rate limiter on this specific route (unlike the sibling setup/reset routes below) —
confirmed by re-reading `auth.ts:718`, no limiter middleware in the handler signature.

### `POST /api/auth/reset-password` (`auth.ts:783-819`)

Public. Request: `{ token: string, password: string }`. Validates `password.length >= 8`
(`auth.ts:791`, matches `zodResolver` client-side min-8 in the archived page's schema).
Looks up `password_reset_tokens` by `token`; `400 { error }` if missing, already used
(`usedAt` set), or `expiresAt < now` (`auth.ts:803`) — one generic message covers all
three states, no distinction surfaced to the caller. On success: `bcrypt.hash(password,
12)`, updates `usersTable.passwordHash`, marks the token row `usedAt = now`
(single-use). Response: `200 { ok: true }` (`auth.ts:818`) — **no session issued**, matches
the archived page's own behavior (`reset-password.tsx:31-35` types only `{ ok?, error?
}`, then client-side redirects to `/login` after a 1.5s delay, `reset-password.tsx:59`).

### `GET /api/auth/setup-context?token=...` (`auth.ts:649-715`)

Public, read-only, rate-limited (`setupContextLimiter`, 30/15min prod, `auth.ts:53-58`).
`400` if `token` missing; `404 { error: "This setup link is invalid or has expired." }`
if the `account_setup_tokens` row is missing/used/expired (`auth.ts:662`); `404 { error:
"Account not found." }` if the token's `userId` no longer resolves to a user
(`auth.ts:673`, a real, distinct 404 case the archived client's `SetupContext` type does
not itself branch on beyond a generic error path).

Success response (`auth.ts:704-714`):

| Field | Type | Source |
|---|---|---|
| `clientName` | `string \| null` | `user.name?.trim() \|\| null` |
| `firstName` | `string \| null` | first whitespace-split token of `clientName` |
| `role` | `MspRole \| null` | `claims.mspRole` — `users.mspRole` column, real enum (§3) |
| `slug` | `string \| null` | `claims.mspSlug` — resolved `msps.slug` via `users.mspId` |
| `products` | `{name, tagline, category}[]` | `client_services ⋈ services`, real purchases, most-recent-first, capped at 4 (`auth.ts:683-694`) |

The archived client's own `SetupContext` interface (`account-setup.tsx:60-66`) matches
this shape field-for-field, and its `destinationForRole`/`expectationForRole` helpers
(`account-setup.tsx:69-80`) branch on `role === "Assessment"` / `"CustomerUser"` — both
real `MSP_ROLES` values (§3), not invented labels.

### `POST /api/auth/setup-password` (`auth.ts:547-639`)

Public, rate-limited (`setupPasswordLimiter`, 5/15min prod, `auth.ts:40-46`). Request:
`{ token: string, password: string }`, same 8-char minimum as reset-password.

Same token validity check as `setup-context` (missing/used/expired → `400`,
`auth.ts:573`), **plus a second, independent gate**: re-verifies
`hasRealEntitlement(record.userId)` at the moment the password is actually set
(`auth.ts:584-591`), not just at token-issue time — `409 { error: "account_not_entitled"
}` if it fails. The route's own comment (`auth.ts:578-583`) states why this is
deliberately re-checked here and not trusted from issuance: closes the #656 hole
regardless of how/when the token was minted.

On success: hashes + stores the password, marks the token `usedAt`, then **issues a full
session** — this is the one setup-flow endpoint that logs the user in immediately.
Computes `mfaSetupPending` the same way `/auth/login` does (`auth.ts:616`,
`mfaEnforcementActive()`, §1/login below) since a brand-new account has zero MFA
enrollments by construction. Response (`auth.ts:638`):

```
{ accessToken, refreshToken, refreshExpiresAt: ISOString, user: <buildUserPayload(...)> }
```

`buildUserPayload` (`auth.ts:201-223`) real shape: `id, email, name?, company?, phone?,
address?, addressCity?, addressState?, addressZip?, role, mspRole?, mspId?, customerId?,
mspSlug?, mfaSetupPending?` (only present when true). The archived client's
`SetupResponse` interface (`account-setup.tsx:48-57`) only types `accessToken`,
`refreshToken`, `refreshExpiresAt`, and `user: { mspRole?, mspSlug? }` — **every other
field in the real payload (`id`, `email`, `name`, `company`, `phone`, address fields,
`role`, `mspId`, `customerId`, `mfaSetupPending`) is real and returned but was unused by
this old page.**

### `POST /api/auth/login` (`auth.ts:321-418`) — context only, not in #2441's list

Included because both MFA-challenge endpoints below only make sense downstream of this
call: it is the sole issuer of the `mfaToken` they consume. Public, rate-limited
(`loginLimiter`, 10/15min prod). Real branches: `401` invalid credentials; `401` no
`passwordHash` set; `423 { accountLocked: true, lockedUntil }` on lockout
(`auth.ts:354-361`, `377-384` — a real, distinct locked-account state the archived
`login.tsx` does not appear to special-case beyond generic error display); on valid
password with `getActiveMfaMethods(user.id).length > 0` (`auth.ts:400`): `200 {
mfaRequired: true, mfaToken, methods: string[] }` where `methods` is the real enrolled-method
list (`totp`/`sms`/`passkey`, §3) — no session yet. Otherwise: full session issued
directly, with `mfaSetupPending` set per `mfaEnforcementActive()` (`auth.ts:234-236`,
production-or-per-account-flag) if there are zero enrollments.

### `POST /api/auth/mfa/totp/challenge` (`mfa.ts:425-460`)

Public (no `requireAuth` — the caller isn't authenticated yet, only holds a short-lived
`mfaToken`), rate-limited (`mfaLimiter`). Request: `{ mfaToken: string, code: string }`.
`mfaToken` is `verifyMfaToken()`'d (`mfa.ts:435`, a signed JWT with `{ mfa: true,
userId, methods }`, 10-min TTL, `mfa.ts:131-139`) — `401` if invalid/expired. Looks up
the caller's enabled `totp` enrollment; `400 "TOTP not enrolled"` if none; verifies the
6-digit code (`verifySync`, 30s epoch tolerance) — `401` on mismatch. On success, calls
the shared `issueFullSession(userId, res, req, "totp")` tail (`mfa.ts:1248-1308`).

### `POST /api/auth/mfa/bypass` (`mfa.ts:1052-1130`)

Public, rate-limited (`mfaLimiter`). Request: `{ mfaToken: string, code: string }`. Same
`mfaToken` verification as TOTP challenge. Looks up the caller's own unused, unexpired
`mfa_bypass_codes` row (`mfa.ts:1069-1080`); `401 "Invalid or expired bypass code"` if
none, or if `bcrypt.compare` fails. **Single-use, atomic consumption**: the `usedAt`
update is conditioned on `usedAt IS NULL` (`mfa.ts:1099-1103`) so two concurrent
requests presenting the same code cannot both succeed — real race-safety, not just a
comment claiming it. Writes an audit log (`team_member_emergency_bypass_used`,
`mfa.ts:1118-1128`) before issuing the session via the same `issueFullSession(userId,
res, req, "bypass")` tail. This endpoint never issues bypass codes itself — a code is
minted separately by an MSP admin (route comment cites
`POST /portal/team/:userId/emergency-bypass`, `mfa.ts:1043-1046`; not in #2441's scope,
not verified here).

**`issueFullSession` response shape** (`mfa.ts:1302-1307`, shared by both challenge
endpoints above): `{ accessToken, refreshToken, refreshExpiresAt: ISOString, user:
<payload> }`, where `user` is `buildUserPayload(...)` plus `mspRole`/`mspId`/`customerId`
spread on top (`mfa.ts:1260-1266`) — functionally the same shape as `/auth/setup-password`'s
`user` object, built from the same helper. The archived `login.tsx` only ever types
`{ accessToken?, refreshToken?, refreshExpiresAt?, error? }` for both challenge fetches
(`login.tsx:99-100`ish / `192-193`ish, inline response types) — it reads `accessToken`
and hands off to `completeMfaLogin`, ignoring the returned `user` object entirely on
both paths.

**A real login-method gap in the archived client, worth Design knowing about:** the
archived `MfaChallenge` component only renders a TOTP-entry form when
`methods.includes("totp")` (`login.tsx:127`, `hasTotp`); for an `sms`-only or
`passkey`-only enrolled account it falls straight to a dead-end "contact your
administrator" card (`login.tsx:279-297`) with no call to `/auth/mfa/sms/send` or any
passkey verification endpoint, even though `/auth/mfa/sms/send` is real and live
(`mfa.ts:1133`, confirmed present, not in #2441's endpoint list so not otherwise
extracted here). This is a fact about the **retired page**, not a live bug — no current
page exists to be broken — but a new Auth Core design that intends to support SMS/passkey
login (not just TOTP) needs to actually wire those endpoints, not assume the old page
already did.

### `GET /api/portal/branding` (`msp-custom-domain.ts:40-114`)

Public. Resolves an MSP by `?slug=xxx`, falling back to the `Host` header (excluding
`localhost`/`replit` hosts, `msp-custom-domain.ts:67`) matched against a **verified**
`mfp_custom_domains` row (`verificationStatus = "verified"`, `msp-custom-domain.ts:78`).
`404 { error: "Tenant not found" }` if neither resolves; `403 { error: "This portal is
currently suspended" }` if `msp.status === "suspended"` (`msp-custom-domain.ts:104`) —
note **`"trial"` status is treated identically to `"active"`** here (no distinct
handling), per the real 3-value enum (§3). Success (`msp-custom-domain.ts:108-113`):

```
{ name: string, slug: string, logoUrl: string | null, primaryColor: string | null }
```

Matches the archived `TenantBranding` interface exactly (`login.tsx:41-46`) — no drift.
Client sets `--msp-brand-login-color` from `primaryColor` when present
(`login.tsx:56-58`) and clears it on unmount.

### `POST /api/portal/sign-in-help/ticket` (`portal-sign-in-help.ts:133-168`)

Public, deliberately so (module docblock, `portal-sign-in-help.ts:4-7`: the caller is by
definition locked out, so this cannot require the session it's trying to recover).
Rate-limited per-IP (`signInHelpLimiter`, 6/15min prod, 100/15min dev,
`portal-sign-in-help.ts:39-45`). Request: `{ email: string, issueKey: string }`.
`400` if `email` fails a basic `.+@.+\..+` regex, or if `issueKey` isn't one of 4 real,
**server-side-authoritative** keys (`portal-sign-in-help.ts:54-75`):

| `issueKey` | `priority` | `routingNote` |
|---|---|---|
| `mfa` | `P2` | "Re-enrolment needs an identity check, so we will call the number on your account." |
| `locked` | `P2` | "We will check the sign-in logs for your account and lift the lock manually." |
| `nocode` | `P3` | "We will confirm the address on your account and check delivery on our side." |
| `other` | `P3` | "A human reads this one before it gets routed." |

The module's own docblock (`portal-sign-in-help.ts:9-11`) states this vocabulary is
final, deliberately kept server-side so a caller can't forge a `P1` or rewrite the
routing note by tampering with client state — the client only ever sends `issueKey`.

**"Attach the last ten sign-in attempts" is honestly not what happens** — there is no
per-attempt/failed-login audit table on this platform (only a running counter +
lockout timestamp on `users`, plus `user_sessions` for *successful* sign-ins). The real
`buildSignInContext()` (`portal-sign-in-help.ts:85-131`) attaches:

- `"Sign-in history: no portal account matches this email address."` if no user row
  matches (case-insensitive), or
- the account's real current lockout state (`failedLoginAttempts`, `lastFailedLoginAt`,
  `lockedUntil`) plus its real last-10 **successful** sign-ins via `listLoginHistory`
  (`session-tracking.ts`), each line real (`createdAt`, `loginMethod`, `browser`, `os`,
  `ipAddress`, `revoked`) — never fabricated rows when history is genuinely empty
  (`"Last successful sign-ins: none on record."`, `portal-sign-in-help.ts:115`).

This context string is passed to Zoho Desk as ticket body content
(`portal-sign-in-help.ts:147-154`), **not returned to the caller** — the HTTP response
only ever contains the fields below.

Success (`portal-sign-in-help.ts:156-161`): `{ reference, priority, routingNote, email }`
— sourced from `SignInHelpTicketResult` (`zoho-desk.ts:251-`), whose real shape also
carries `zohoId` and `webUrl` (`zoho-desk.ts:307-313`) that **this route drops before
responding** — available in the ticket-raising library, not on the wire today. `502 {
error: "..." }` on any Zoho Desk failure (`portal-sign-in-help.ts:162-166`), logged
server-side with the real error (`log.error`).

The archived client's `RaisedTicket` interface (`portal-sign-in-help.tsx:127-132`) types
exactly `{ reference, priority, routingNote, email }` — matches the real response
field-for-field, no drift.

### `GET /api/status` (`public-status.ts:298-370`)

Public, unauthenticated. Real response (`public-status.ts:359-365`):

```
{ status: "operational" | "degraded" | "outage", incidents: [...], m365Health, m365Uptime, dailyHistory }
```

- **`status`** — derived, not stored: `"outage"` if the API itself is unhealthy (always
  `true` here, since a live response proves it — `public-status.ts:302`) or any
  unresolved-critical incident exists; else `"degraded"` if cron health is stale (job
  queue delay > 300s, `public-status.ts:314-315`) or any unresolved incident exists at
  all; else `"operational"` (`public-status.ts:337-342`).
- **`incidents`** — real `platform_incidents` rows from the last 90 days, most-recent
  first (`id, title, description, severity, status, startedAt, resolvedAt`).
- **`m365Health`** — a discriminated union: `{ available: true, services:
  {service, status: "healthy"|"degraded"|"interruption"}[] }` or `{ available: false,
  reason }` (`"not_configured"` / `"no_tenant"` / `"fetch_failed"` / `"error"`,
  `public-status.ts:212-218`, `233-`). Read from Shane's own testbed tenant's Graph
  service-health, cached (`M365_HEALTH_CACHE_TTL_MS`).
- **`m365Uptime`** — a second discriminated union, `{ available: true, target:
  SLA_TARGET_UPTIME_PERCENT, services: M365UptimeServiceEntry[], overallUptimePercent }`
  or `{ available: false, reason }` — real rolling 90-day time-weighted uptime per M365
  workload, computed by `computeM365UptimeForTenant()` (`lib/sla-uptime.ts`, not
  reimplemented in this route), measured against Microsoft's own published 99.9% SLA.
- **`dailyHistory`** — a real platform-wide 90-day daily strip derived from the same
  `platform_incidents` rows just read (`computeDailyHistory`, `public-status.ts:348-357`).

**The archived `portal-sign-in-help.tsx` page only ever consumes `status`** — its own
`StatusResponse` interface (`portal-sign-in-help.tsx:134-136`) types just `{ status:
"operational"|"degraded"|"outage" }`, used for a small service-status strip
(`portal-sign-in-help.tsx:758`, citing Git #1350 as the full status page's owner). Every
other field (`incidents`, `m365Health`, `m365Uptime`, `dailyHistory`) is real and live on
this endpoint but unconsumed by this particular old page — they exist to serve the
dedicated Status page (#1350), not this one.

---

## 2. CURRENT / DECIDED

| Field / capability | Status | Issue |
|---|---|---|
| `forgot-password` (both entitled-reset and unentitled-setup branches) | **CURRENT** | #656 (entitlement re-check) |
| `reset-password` | **CURRENT** | — |
| `setup-context` | **CURRENT** | — |
| `setup-password` (incl. double entitlement gate + immediate session) | **CURRENT** | #656, #439 (mfaSetupPending) |
| `login` (context only) — lockout, MFA branch | **CURRENT** | #439 |
| `mfa/totp/challenge` | **CURRENT** | — |
| `mfa/bypass` (incl. atomic single-use consumption + audit log) | **CURRENT** | — |
| `portal/branding` (slug + Host-header + suspended gate) | **CURRENT** | — |
| `portal/sign-in-help/ticket` (incl. honest sign-in-context attach) | **CURRENT** | #1349 |
| `status` (incl. `m365Health`/`m365Uptime`/`dailyHistory`, all unused by the old sign-in-help page) | **CURRENT on the route, only partially drawn by the old page** | #1350 owns the full surface |
| SMS/passkey login-challenge UI (old page never wired it past TOTP) | **Backend real (`/auth/mfa/sms/send` etc.), no UI ever called it — open for the new design** | not filed; see §1 note |
| `SignInHelpTicketResult.zohoId` / `.webUrl` | **Real in the library return, dropped before the HTTP response** | not filed — informational only, no page needs it today |

No gap in this pack rises to the level of a filed finding: every endpoint named in
#2441 is genuinely complete and live, and the SMS/passkey-login note above describes a
retired page's incompleteness, not a defect in current, reachable product code — there
is nothing live for a customer to hit today that is broken.

---

## 3. Real enum unions

- **MFA method** — `mfa_enrollments.method` / `mfa_challenges.method`: `"totp" | "sms" |
  "passkey"` (`lib/db/src/schema/index.ts:1758`, `1772`). `getActiveMfaMethods()`
  (`mfa.ts:31-46`) flattens enrollment rows plus a real `webauthn_credentials` presence
  check into this same three-value list for the `/auth/login` `methods` field.
- **Login method** — `user_sessions.login_method`: `"password" | "totp" | "sms" |
  "passkey" | "impersonation" | "bypass"` (`lib/db/src/schema/msp.ts:577`, per the prior
  Account Security pack, re-confirmed still current). `mfa/bypass` and
  `mfa/totp/challenge` write `"bypass"` / `"totp"` respectively via `issueFullSession`'s
  `loginMethod` parameter.
- **MSP role** (`MSP_ROLES`, `lib/db/src/schema/index.ts:37`): `"PlatformAdmin" |
  "MSPAdmin" | "MSPOperator" | "CustomerUser" | "ServiceAccount" | "Free" | "Assessment"`
  — the real vocabulary behind `setup-context`'s `role` field and `/auth/login`'s /
  `setup-password`'s `user.mspRole`.
- **MSP status** — `msps.status`: `"active" | "suspended" | "trial"`
  (`lib/db/src/schema/msp.ts:41`). `/portal/branding` only branches on `"suspended"` —
  `"trial"` MSPs render identically to `"active"` ones on this endpoint.
- **`users.role`** (distinct from `mspRole`): `"admin" | "client"`
  (`lib/db/src/schema/index.ts:49`) — carried through `buildUserPayload.role`, not
  consumed by any of the archived pages checked in this pack.
- **`sign-in-help` `issueKey`**: not a DB enum — a fixed, server-side literal map of 4
  keys (`mfa`, `locked`, `nocode`, `other`), authoritative in
  `portal-sign-in-help.ts:54-75` (see §1). Client sends only the key.
- **`status` (platform-wide)**: `"operational" | "degraded" | "outage"` — computed, not
  stored (§1's `/status` entry).
- **`m365Health[].status`**: `"healthy" | "degraded" | "interruption"`
  (`public-status.ts:39`), sanitized from raw Graph service-health values via
  `toSanitizedStatus()` (not itself re-verified in this pack — out of #2441's scope).

---

## 4. Honest-empty / tri-state contract

Every endpoint in this pack that can legitimately have "nothing to report" says so
honestly rather than fabricating a plausible-looking substitute:

- **`forgot-password`** — always `200 { ok: true }` regardless of whether an account
  exists, by design (enumeration resistance) — not a data-honesty case, a security one,
  documented here so Design doesn't mistake the unconditional `200` for "email
  definitely sent."
- **`sign-in-help/ticket`**'s attached context — a genuinely unmatched email produces an
  explicit "no portal account matches this email address" line, not a synthetic account
  summary; a matched account with zero login history produces "none on record.", not
  invented rows (`portal-sign-in-help.ts:98-103`, `114-115`).
- **`status`**'s `m365Health` / `m365Uptime` — real discriminated unions
  (`{available:true,...} | {available:false,reason}`), never a value rendered without
  checking `available` first (consistent with the Account Security pack's Graph-signal
  pattern, §8 of `docs/account-security-contract-pack.md`).
- **`setup-context` / `setup-password` / `reset-password`** token validity — each
  collapses missing/used/expired into one generic `400`/`404` message rather than
  leaking which specific state applies (an enumeration-resistance choice, same family as
  `forgot-password`'s unconditional `200`).

---

## 5. Cross-surface edges

- **`/auth/login` → `/auth/mfa/totp/challenge` and `/auth/mfa/bypass`** — both challenge
  endpoints are unreachable without a real `mfaToken` minted by `/auth/login` (or, in
  principle, `/auth/setup-password`'s own MFA-pending path — that endpoint issues a full
  session directly rather than an `mfaToken`, since a brand-new account can go straight
  to MFA-enrollment endpoints under `mfaSetupPending`, not a fresh MFA challenge).
- **`/auth/forgot-password` and `/auth/setup-password`** both gate on the exact same
  `hasRealEntitlement()` check (`auth.ts:111-118`) — the #656 invariant is enforced at
  two independent points (link-issue time and password-set time), not just once.
- **`/portal/sign-in-help/ticket` → `/status`** — the archived page renders both on one
  screen (a service-status strip alongside the ShaneBot ticket flow), but they are
  functionally unrelated calls; no data flows between them.
- **`mfa/bypass`'s consumed code** originates from a real, separate admin-side endpoint
  (`POST /portal/team/:userId/emergency-bypass`, cited at `mfa.ts:1043-1046`) — outside
  #2441's 9-endpoint scope and not independently verified in this pack.

---

## 6. Live-data counts (queried 2026-09-03, local `DATABASE_URL`)

| Table | Real count | Notes |
|---|---:|---|
| `msps` | 2 | 0 suspended, 0 trial |
| `mfa_enrollments` | 1 | 1 totp, 0 sms, 0 passkey |
| `webauthn_credentials` | 0 | no passkeys enrolled anywhere yet |
| `mfa_bypass_codes` | 0 total | 0 active/unused |
| `account_setup_tokens` | 3 total | 0 active/unused (all used or expired) |
| `password_reset_tokens` | 1 total | 0 active/unused |
| `platform_incidents` (last 90d) | 2 | feeds `/status`'s `incidents` + `dailyHistory` |

Confirms these flows are real but lightly exercised in the local dev DB — not a
correctness signal either way, recorded for Design's honest-empty-state awareness (a
`sign-in-help` ticket against most emails today will attach real-but-thin history).

---

## Not covered by this pack

Per #2441's own Step 3 ("Contract pack goes to Design once complete — no page/UI-shape
decisions get made in this issue"): no layout, field grouping, or copy decisions are made
here. Also out of scope, named but not extracted: `/auth/mfa/sms/send` and any
passkey-verification endpoint (real, live, not in #2441's 9-endpoint list — see §1's
SMS/passkey note for why Design should know they exist before assuming TOTP-only is the
whole MFA-challenge surface), and `POST /portal/team/:userId/emergency-bypass` (the
bypass-code issuance side, admin-facing, not customer-facing Auth Core).

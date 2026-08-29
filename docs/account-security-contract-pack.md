# Account Security — contract extraction pack

**Issue:** #1595 (Portal New Design: Account Security), part of #1485 (EPIC: Portal New
Design). Method per #1577. Extracted, not authored — every field below traces to one
of the files listed, cited to file:line. READ-ONLY session; no code changed producing
this pack.

Design surface: `artifacts/msp-portal/src/pages/portal-v2-account-security.tsx` — "Your
login to this portal — not your Microsoft 365 tenant" (page's own subtitle,
`accountSecurityData.ts:23`).

Sources this pack is built against, and nothing else:

- `artifacts/msp-portal/src/components/portal-v2/useAccountSecurityLive.ts` — the live
  data hook (client-side wire contract + normalization)
- `artifacts/msp-portal/src/components/portal-v2/accountSecurityData.ts` — the fixture
  (design copy + fallback shapes)
- `artifacts/msp-portal/src/components/portal-v2/accountSecurityModel.ts` — pure
  derivations (tones, summaries, gates)
- `artifacts/msp-portal/src/pages/portal-v2-account-security.tsx` — the page itself
- `artifacts/api-server/src/routes/mfa.ts` — `GET /api/auth/mfa/enrollments`
- `artifacts/api-server/src/routes/auth.ts` — `/auth/sessions*`, `/auth/login-history`,
  `/auth/change-password`
- `artifacts/api-server/src/lib/session-tracking.ts` — the real session/login-history
  queries backing all of the above
- `lib/db/src/schema/msp.ts`, `lib/db/src/schema/index.ts` — `user_sessions` /
  `mfa_enrollments` table definitions (the real enum sources)
- `artifacts/msp-portal/src/pages/portal-v2-security.tsx`,
  `artifacts/msp-portal/src/components/portal-v2/useMfaRegistrationLive.ts` — the
  Security pillar dashboard, for the overlap check in §7

---

## 1. Wire contract — MFA state and active sessions

### MFA state

`GET /api/auth/mfa/enrollments` (`mfa.ts:350-372`, `requireAuth`). Handler queries
`mfaEnrollmentsTable` filtered to `enabled = true` (`mfa.ts:352-355`) plus
`webauthnCredentialsTable` for the caller (`mfa.ts:357-360`) and returns:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `totp` | `boolean` | not null | `mfa.ts:363` — `enrollments.some(e => e.method === "totp")` |
| `sms` | `boolean` | not null | `mfa.ts:364` — `enrollments.some(e => e.method === "sms")` |
| `smsPhone` | `string \| null` | nullable | `mfa.ts:365` — `enrollments.find(e => e.method === "sms")?.phone ?? null` |
| `passkey` | `boolean` | not null | `mfa.ts:366` — `passkeys.length > 0` |
| `passkeyCount` | `number` | not null | `mfa.ts:367` — `passkeys.length` |
| `gateRequired` | `boolean` | not null | `mfa.ts:370` — `isProductionEnvironment()`. **Emitted by the route but not read anywhere in `useAccountSecurityLive.ts`'s parse (`useAccountSecurityLive.ts:134-140` destructures only `totp/sms/smsPhone/passkey/passkeyCount`). Available, currently unconsumed on this surface.** |

Client normalizes this into `LiveMfaEnrollments` (`useAccountSecurityLive.ts:44-50`) —
same five fields (`totp`, `sms`, `smsPhone`, `passkey`, `passkeyCount`), each coerced
with `??`/`!!` defaults (`useAccountSecurityLive.ts:142-148`).

### Active sessions

`GET /api/auth/sessions` (`auth.ts:869-875`, `requireAuth`) → `listActiveSessions()`
(`session-tracking.ts:146-169`), which selects `user_sessions` rows for the caller
where `sessionType = "standard"`, `revokedAt IS NULL`, `expiresAt > now()`
(`session-tracking.ts:148-154`), ordered by `lastActiveAt DESC`. Server-side return
type `ActiveSessionView` (`session-tracking.ts:136-144`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `session-tracking.ts:137` |
| `browser` | `string` | not null | `session-tracking.ts:138`, `138` — parsed from `userAgent` via `describeUserAgent()` (`session-tracking.ts:208-226`) |
| `os` | `string` | not null | same |
| `ipAddress` | `string \| null` | nullable | `session-tracking.ts:140` |
| `createdAt` | `Date` (ISO string over the wire) | not null | `session-tracking.ts:141` |
| `lastActiveAt` | `Date` (ISO string over the wire) | not null | `session-tracking.ts:142` |
| `isCurrent` | `boolean` | not null | `session-tracking.ts:143`, `166` — `currentTokenHash !== null && row.currentTokenHash === currentTokenHash`, derived per-request, not a stored column |

Client re-declares the same shape as `WireSessionRow` (`useAccountSecurityLive.ts:52-60`,
`createdAt`/`lastActiveAt` typed `string` post-JSON) and normalizes to `LiveSecSession`
via `toSecSession()` (`useAccountSecurityLive.ts:73-85`, extends the fixture's
`SecSession` shape from `accountSecurityData.ts:110-117`, plus a real `id`):

| Field | Derivation |
|---|---|
| `id` | `row.id` |
| `device` | `${row.os} · ${row.browser}` |
| `where` | `row.ipAddress ?? "IP unavailable"` |
| `when` | `"Active now"` if current, else `timeAgo(row.lastActiveAt)` |
| `current` | `row.isCurrent` |
| `since` | `` `Signed in ${timeAgo(row.createdAt)}` `` |
| `compliant` | **hard-coded `""`** — `useAccountSecurityLive.ts:81-84`: *"No device-compliance signal exists for a portal login — left blank rather than claiming 'Compliant'/'Unmanaged' without real data."* See §5. |

### Last sign-in (derived, not a direct field)

`GET /api/auth/login-history` (`auth.ts:909-913`) → `listLoginHistory()`
(`session-tracking.ts:187-205`), `LoginHistoryView` (`session-tracking.ts:171-179`):
`id`, `loginMethod`, `browser`, `os`, `ipAddress`, `createdAt`, `revoked`. The page only
consumes `history[0].createdAt` (`useAccountSecurityLive.ts:173-177`) to set
`lastSignInAt`. **`loginMethod`, `browser`, `os`, `revoked` are real fields the route
returns but this surface draws none of them** — the client's own `WireLoginHistoryRow`
(`useAccountSecurityLive.ts:62-66`) only types `id`, `createdAt`, `ipAddress`.

### Identity (no fetch)

`identityEmail` / `identityRole` come from the decoded JWT via `useAuth().user`
(`useAccountSecurityLive.ts:216-217`), not a page-specific endpoint. Role is passed
through a local label map, `MSP_ROLE_LABELS` (`useAccountSecurityLive.ts:100-108`) —
its keys (`PlatformAdmin`, `MSPAdmin`, `MSPOperator`, `CustomerUser`, `ServiceAccount`,
`Free`, `Assessment`) are the real `mspRole` vocabulary this page renders, falling back
to the raw role string for anything unmapped.

---

## 2. CURRENT / DECIDED

| Field | Status | Issue |
|---|---|---|
| Identity email, role | **CURRENT** | — (JWT, no endpoint) |
| MFA: `totp`, `sms`, `smsPhone`, `passkey`, `passkeyCount` | **CURRENT** | #1235 (live-wiring pass that added this hook) |
| MFA: `gateRequired` | **CURRENT on the route, not drawn by this page** | — |
| Active sessions: `browser`, `os`, `ipAddress`, `createdAt`, `lastActiveAt`, `isCurrent` | **CURRENT** | #1235 |
| Session revoke (single + "sign out everywhere else") | **CURRENT** | #1235 — see §6 |
| Last sign-in timestamp | **CURRENT** (derived from login-history row 0) | #1235 |
| Login history: `loginMethod`, `browser`, `os`, `revoked` | **CURRENT on the route, not drawn by this page** | — |
| Session `compliant` (device compliance) | **DECIDED — forbidden, not buildable from a portal login** | #1593 |
| Password age / last-changed | **DECIDED — no backing column** (`usersTable` has no `passwordChangedAt`) | #1593 |
| Failed login attempts | **DECIDED — column exists, no endpoint exposes it to the owning user** (`users.failedLoginAttempts`) | #1593 |
| Change password action (`POST /api/auth/change-password`, `auth.ts:822`) | **Endpoint CURRENT; button is inert design copy on this page** (`portal-v2-account-security.tsx:431-436`) | not yet assigned — flagged, no wiring issue found |
| Passkey / authenticator "Set up" / "Manage" CTAs | **Inert design copy** — no MFA-enrollment write call wired from this page | not yet assigned — flagged |
| Delete-account submit (`POST /api/portal/deletion-request`, `portal-privacy.ts:272-274`) | **Endpoint CURRENT; button on this page is inert** — only the expand/collapse and type-to-confirm gate are real interactive state (`secDeleteReady`, `accountSecurityModel.ts:47-49`) | not yet assigned — flagged |
| "Your data" export cards (`SEC_DATA`) | **Static fixture copy**, no fetch at all | not yet assigned — flagged |

The page's own header comment (`portal-v2-account-security.tsx:22-28`) already states
that change-password, passkey setup, and deletion-submit wiring is "a later pass" — this
pack confirms all three target endpoints are real and already live in the codebase, just
not called from this page yet. No GitHub issue currently tracks that follow-up wiring;
Design should treat those three CTAs as **DECIDED, backend-ready, unassigned** rather
than architecting new endpoints for them.

---

## 3. Real enum unions

Pulled directly from the Drizzle schema and route code — no invented vocabulary:

- **MFA method** — `mfa_enrollments.method`: `"totp" | "sms" | "passkey"`
  (`lib/db/src/schema/index.ts:1746`). The route never returns this enum directly to
  the client; it flattens it into three independent booleans (`totp`, `sms`, `passkey`)
  plus `smsPhone`/`passkeyCount` (`mfa.ts:363-367`).
- **Login method** — `user_sessions.login_method`:
  `"password" | "totp" | "sms" | "passkey" | "impersonation" | "bypass"`
  (`lib/db/src/schema/msp.ts:577`). Real, but — per §1 — not drawn anywhere on this
  page today (available only via `/auth/login-history`, whose `loginMethod` field this
  hook doesn't parse).
- **Session type** — `user_sessions.session_type`: `"standard" | "impersonation"`
  (`lib/db/src/schema/msp.ts:576`). Both list/revoke queries filter to `"standard"`
  only (`session-tracking.ts:111`, `151`, `189`) — impersonation sessions are
  structurally excluded from this page, not just unlabeled.
- **Session state — no stored enum column.** There is no `status`/`state` field on
  `user_sessions`. "Active" is derived per-query as
  `revokedAt IS NULL AND expiresAt > now()` (`session-tracking.ts:150-154`); "current"
  is a further per-request derivation comparing the row's `currentTokenHash` to the
  caller's own refresh-token hash (`session-tracking.ts:166`), not a persisted value.
  If Design wants a session-state badge vocabulary, the only real states derivable from
  this schema are **active** (returned by `listActiveSessions`) and **revoked/expired**
  (excluded from that query, but visible via `login-history`'s `revoked` boolean,
  `session-tracking.ts:178` — itself unconsumed by this page today, per §1).

---

## 4. Honest-empty contract

`dataState` is computed as `mfa !== null && sessions !== null ? "live" : "fixture"`
(`useAccountSecurityLive.ts:221`, confirmed by #1463's strict pass, referenced in
#1595's own body). This is a **null check, not a length check** — a real,
successfully-fetched empty sessions array (`sessions: []`) sets `sessions` to `[]`
(not `null`), so `dataState` reads `"live"` and the page renders zero session rows
honestly rather than falling back to `SEC_SESSIONS`'s three fixture rows.

Concretely: `loadSessions()` (`useAccountSecurityLive.ts:117-126`) sets
`sessions` to `(body?.sessions ?? []).map(toSecSession)` on any successful response —
including a genuinely empty array — and only sets `sessions` to `null` in the `catch`
block (the fetch itself failed or returned non-OK). Same pattern for `mfa`
(`useAccountSecurityLive.ts:141-152`): a successful-but-empty read still populates a
real (all-false) `LiveMfaEnrollments` object, not `null`.

The page consumes this correctly: `sessionRows = live.sessions ?? SEC_SESSIONS.map(...)`
(`portal-v2-account-security.tsx:228`) only substitutes fixture rows when `sessions` is
`null` — i.e. the read never resolved — never when it resolved to an empty list.

`live.loading` (true until the login-history fetch settles,
`useAccountSecurityLive.ts:115`, `180-182`) gates a separate skeleton state
(`PortalV2LoadingState`, three call sites: `portal-v2-account-security.tsx:316`, `342`,
`374`) shown ahead of both the live and fixture branches — this is the third state of
the honest tri-state (loading / live-including-genuinely-empty / fixture-because-the-
read-failed) that #1463 confirmed is correctly separated here, and that #1595's own
body already credits as "the page is honest today." **Design must preserve this
distinction — do not collapse loading, empty, and fixture into a single visual state.**

---

## 5. The forbidden list (tied to #1593)

Per the hook's own header comment (`useAccountSecurityLive.ts:20-32`) and confirmed
against the actual code, three fields have **no backend today** and must not be drawn
by Design as if they were live:

- **Password age / "last changed"** — `usersTable` has no `passwordChangedAt` column.
  A real prerequisite gap (the column doesn't exist), not a wiring gap.
- **Failed login attempts** — `users.failedLoginAttempts` is a real column, but no
  endpoint exposes it to the owning user yet.
- **Device compliance** ("hybrid joined" / "Intune enrolled" / "unmanaged", as seen in
  the fixture's `SEC_SESSIONS[].compliant` strings, `accountSecurityData.ts:125-127`)
  — Entra/Intune device state, out of scope for a portal-login page by the page's own
  framing. Live session rows carry `compliant: ""` unconditionally
  (`useAccountSecurityLive.ts:83`) rather than a fabricated "Compliant"/"Unmanaged"
  label — the page's own model layer (`sessionIsUnmanaged`,
  `accountSecurityModel.ts:29-31`) only ever fires against the empty string, so it is
  inert on live data, not silently wrong.

This was previously documented **only in the hook's own code comment** — #1593 was
filed to stop that fact from staying comment-only. This pack is that fact's second,
durable home. **Design must not draw password age, failed-attempt counts, or device
compliance badges as if a live value exists** — render them, if at all, as an explicit
"not available" state, or omit them, pending #1593's own decision on whether any of
these three is buildable in v1.1 via Graph.

---

## 6. Sessions revoke — real write capability, already wired

**This surface has real write capability today.** Two endpoints, both already called
from the live page:

- **`DELETE /api/auth/sessions/:id`** (`auth.ts:877-893`, `requireAuth`) →
  `revokeSessionById(userId, sessionId)` (`session-tracking.ts:86-99`) — scoped to the
  calling user (the query joins on both `id` and `userId`, `session-tracking.ts:87-89`,
  so one user cannot revoke another's session by guessing an id), revokes the session
  row and its matching `msp_refresh_tokens` row so the device can't silently refresh.
  Audit-logged as `AUTH_SESSION_REVOKED` (`auth.ts:891`). Wired from the per-row
  "Revoke" button (`portal-v2-account-security.tsx:396-404`) via
  `live.revokeSession(id)` (`useAccountSecurityLive.ts:189-201`).
- **`POST /api/auth/sessions/revoke-others`** (`auth.ts:895-907`, `requireAuth`) →
  `revokeAllOtherSessions(userId, currentTokenHash)` (`session-tracking.ts:107-134`) —
  revokes every other non-revoked `"standard"`-type session for the caller, and their
  matching refresh tokens. Audit-logged as `AUTH_SESSIONS_REVOKED_OTHERS`
  (`auth.ts:901`). Wired from "Sign out everywhere else"
  (`portal-v2-account-security.tsx:364-371`) via `live.signOutOthers()`
  (`useAccountSecurityLive.ts:203-213`).

Both UI actions are correctly gated against the fixture branch: `onClick` is
`live.sessions ? () => void live.revokeSession(s.id) : undefined`
(`portal-v2-account-security.tsx:399`, same pattern at `366`) — so a fixture-backed row
(negative synthetic id, `portal-v2-account-security.tsx:228`) can never fire a revoke
call with a fake id; the buttons are inert until real session data has loaded.

**No CR under #1486 is implicated.** #1595's own architecture question asked whether
this page needs write capability and whether that requires a change-request gate —
this action revokes the customer's own portal login session, not a tenant-affecting
change, and the write path already exists and is already live in the shipped page. This
is a factual finding, not an architecture resolution — #1595 should still record it,
but there is nothing left to decide about *whether* revoke is a read or a write: it is
a write, already built, already wired, already audit-logged.

---

## 7. Overlap with the Security pillar dashboard — flagged, not resolved

Both surfaces expose an "MFA" signal, from genuinely different sources and at
genuinely different scope:

- **Account Security** (`useAccountSecurityLive.ts`) reads **this one user's own
  portal-login MFA enrollment** — `mfa_enrollments` / `webauthn_credentials` rows for
  the authenticated user, via `GET /api/auth/mfa/enrollments` (`mfa.ts:350`).
- **Security pillar dashboard** (`portal-v2-security.tsx`) shows an **"MFA Coverage"**
  card (`portal-v2-security.tsx:114`) driven by `identity:mfa-registration` — a
  tenant-wide Graph check (`useMfaRegistrationLive.ts:8-14`, reading
  `/reports/authenticationMethods/userRegistrationDetails` via
  `GET /api/portal/tenant-check-items`) that reports **every M365 user in the tenant**,
  each with `isMfaRegistered`/`isAdmin` (`useMfaRegistrationLive.ts:32-58`) — this is
  the customer's **Microsoft 365 tenant**, not the customer's own portal login.
  Notably, the pillar page's own code documents that an aggregate coverage
  *percentage* has **no real backing** either (`portal-v2-security.tsx:120-121`,
  `NO-BACKEND-TO-WIRE` comment — only a registered-user numerator exists, no
  denominator).

These do not read the same table and are not in tension technically — Account
Security's subtitle already draws this exact line for a human reader ("Your login to
this portal — not your Microsoft 365 tenant. Tenant findings live under the six
pillars," `accountSecurityData.ts:23`). The overlap is **conceptual**: both pages show
a labeled "MFA" state to the same customer, from different scopes, and nothing in
either surface's copy prevents Design from drawing them so similarly that a customer
reads them as the same fact. **Flagging per #1595's own question — not resolving it.**
No other overlapping field was found: sessions/login-history have no equivalent on
`portal-v2-security.tsx`, `portal-v2-security-mfa.tsx`, or `portal-v2-security-ca.tsx`
(grepped for session/sign-in language, no matches).

---

## Not covered by this pack

Per #1595's own "Not yet architected" framing and the scope of the request this pack
answers: device-compliance/Intune scope-in-v1.1 decision, the MFA-coverage-percentage
gap, and whether/how to wire change-password / passkey-setup / deletion-submit from
this page are **open questions for chat architecture**, not settled here. This pack
extracts what exists; it does not decide what should be built next.

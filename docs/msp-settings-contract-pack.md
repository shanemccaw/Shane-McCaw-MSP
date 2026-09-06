# MSP Console Settings — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Settings (MSP Console)** (leaf issue #2604, Feature #1690, portal-side epic n/a — this
is the MSP-operator console, not the customer portal). This is the **first** contract pack for
this module; there is no prior version to replace.

**The one fact that changes how Design must read every field below:** the entire backend — 39
routes across 11 functional groups, ~1,780 lines — is real, finished, and live on `main`
(`artifacts/api-server/src/routes/msp-settings.ts`), but **`artifacts/msp-console` (the MSP
Console frontend app) is a bare scaffold with zero pages beyond a placeholder** (`App.tsx:16-23`,
`pages/index.tsx:1-20`, both dated #2668). A repo-wide search of every frontend app (`msp-console`,
`msp-portal`, `admin-panel`, `shane-mccaw-consulting`) for any of these 39 paths found **zero**
call sites outside the backend's own route file and its two test files. **Every endpoint in this
pack is orphaned.** That is not a defect this pack should paper over — it is exactly the situation
#2605/#2606 (Design export, then wire) exist to fix, and it is why this pack was written now: the
backend is finished, so the pack is not documenting absence.

---

## 0. The eleven functional groups of this module

All 39 routes live in one file, `artifacts/api-server/src/routes/msp-settings.ts`, registered at
`artifacts/api-server/src/routes/index.ts:153,478`. Every route (except the OAuth callback) is
gated `requireRole("MSPAdmin")` — a **floor**, not an exact match: `requireRole()` does a
`ROLE_ORDER` index comparison (`requireAuth.ts:81-89,206+`), so `PlatformAdmin` (the one role above
`MSPAdmin` in the 7-value hierarchy `Assessment < Free < CustomerUser < ServiceAccount <
MSPOperator < MSPAdmin < PlatformAdmin`) also passes every gate in this module. `MSPOperator` does
**not** pass — every write and every read here is MSPAdmin-or-above only, with the single
documented exception in Group A.

| # | Group | Routes | Writes? |
|---|---|---|---|
| A | Profile | `GET /msp/profile` (alias), `GET/PATCH /msp/settings/profile` | PATCH only |
| B | Connector mode + Exchange Online | `GET/PUT /msp/settings/connector`, `PUT/DELETE /msp/settings/connector/exchange` | yes |
| C | MSP Mailbox (outbound email) | `GET /connector/mailbox`, `POST /connector/mailbox/connect`, `GET /connector/mailbox/callback`, `DELETE /connector/mailbox`, `PATCH /connector/mailbox/automated-emails`, `PATCH /connector/mailbox/write-back` | yes |
| D | Service Accounts (API keys) | `GET/POST /service-accounts`, `DELETE /service-accounts/:id` | yes |
| E | Team / Users | `GET /users` | no |
| F | Per-staff customer scoping | `GET/PUT /users/:userId/customer-scopes` | PUT only |
| G | User admin actions | `PATCH .../role`, `PATCH .../approve-purchases`, `DELETE /users/:userId`, `POST .../reset-password`, `POST .../temp-password`, `POST .../reset-mfa`, `PATCH .../mfa-enforcement`, `PATCH .../status`, `DELETE .../sessions` | yes |
| H | Billing | `GET /billing`, `POST /billing/portal-session` | POST only (Stripe redirect) |
| I | Email Templates | `GET /email-templates`, `PUT/DELETE /email-templates/:key` | PUT/DELETE |
| J | Customer Agreement Template | `GET/PUT /agreement-template` | PUT only |
| K | Sessions + Invites | `GET /sessions`, `DELETE /sessions/:tokenHash`, `POST/GET /invites`, `DELETE /invites/:inviteId` | all but the two GETs |

Every route's `mspId` comes from `resolveMspIdStrict(req)` (`resolve-msp-id.ts:75-77`) — the
caller's own JWT claim, **no `?mspId=`/`?slug=` override, even for PlatformAdmin**. This is a
session-scoped module: there is no cross-MSP view here, by design (`resolve-msp-id.ts:64-74`).

---

## 1. Per-group wire contract

### 1a. Profile (Group A)

**`GET /api/msp/profile`** (`msp-settings.ts:157-180`) — role floor **`Assessment`**, the lowest
in the hierarchy, not `MSPAdmin`. Comment at `:148-155` explains why: this is a thin alias the
frontend's `app-shell.tsx` calls for every authenticated page (white-label branding only — name,
logo, color), so it is deliberately open to every authenticated role. The canonical route,
`GET /api/msp/settings/profile` (`:184-207`), is byte-identical in shape but gated `MSPAdmin`.

Both return one object, straight off `mspsTable`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `number` | never null | `163`/`190` |
| `name` | `string` | never null | `164`/`191` |
| `slug` | `string` | never null | `165`/`192` |
| `domain` | `string \| null` | | `166`/`193` |
| `logoUrl` | `string \| null` | | `167`/`194` |
| `primaryColor` | `string \| null` (hex, `#rrggbb`) | | `168`/`195` |
| `status` | `"active" \| "suspended" \| "trial"` (real enum, `msp.ts:41`) | never null | `169`/`196` |
| `trialEndsAt` | `string \| null` (ISO) | | `170`/`197` |
| `customCustomerAgreement` | `string \| null` | | `171`/`198` |
| `createdAt` | `string` (ISO) | never null | `172`/`199` |

404s `"MSP not found"` if the row is gone (`:178`/`:205`) — dead-tenant defensive, not
presently reachable for a live session.

**`PATCH /api/msp/settings/profile`** (`:217-237`). Body — `updateProfileSchema` (`:209-215`),
all fields optional:

```
{ name?: string(2-120), domain?: string | null, logoUrl?: string(url) | null,
  primaryColor?: string(/^#[0-9a-fA-F]{6}$/) | null, customCustomerAgreement?: string(≤50000) | null }
```

Returns the full updated row (same shape as GET, `:236`). Writes `msp.profile.update` to
`msp_audit_logs` (`:235`, `writeAuditLog` at `:102-124`).

### 1b. Connector mode + Exchange Online (Group B)

**`GET /api/msp/settings/connector`** (`:241-279`) — reads `mspConnectorConfigsTable`.
**No-row-yet default** (`:262-270`, when the MSP has never configured a connector):

```
{ connectorMode: "delegated", exchangeOnlineEnabled: false, exchangeOnlineTenantId: null,
  hasExchangeClientId: false, hasExchangeClientSecret: false, auditLoggingEnabled: true,
  updatedAt: null }
```

Real-row shape (`:245-278`) is the same field set; `hasExchangeClientId`/`hasExchangeClientSecret`
are **booleans coerced from the Key Vault secret-name columns** (`!!config.hasExchangeClientId`,
`:276-277`) — the raw client ID/secret never leave the server. `connectorMode` is the real enum
`"agent" | "api_key" | "delegated"` (`MSP_CONNECTOR_MODES`, `msp.ts:1750`).

**`PUT /api/msp/settings/connector`** (`:287-321`) — body `updateConnectorSchema` (`:281-285`):
`{ connectorMode: "agent"|"api_key"|"delegated", auditLoggingEnabled?: boolean,
customerAgreementTemplate?: string(≤50000)|null }`. Upserts by `mspId` (`onConflictDoUpdate`,
`:306-309`); `auditLoggingEnabled` defaults `true` and `customerAgreementTemplate` defaults `null`
when omitted (`:300-301`) — **a PUT here silently resets `customerAgreementTemplate` to null if
the caller omits it**, since the upsert `set` always includes the key. Design should route the
agreement-template field through §1i's own PUT, not this one, to avoid that silent-null trap.
Returns `{ ok: true, connectorMode }` (`:320`). Audit: `connector.mode.update` (`:311-318`).

**`PUT /api/msp/settings/connector/exchange`** (`:332-390`) — body `exchangeSchema` (`:326-330`):
`{ tenantId: uuid, clientId: string(≥10), clientSecret: string(≥10) }`. Writes the two secrets to
Azure Key Vault under deterministic names `msp-${mspId}-exo-client-id` /
`msp-${mspId}-exo-client-secret` (`:349-360`) **only if** the four `AZURE_*`/`AZURE_KEY_VAULT_URL`
env vars are all present (`:342-347`); otherwise it logs a warning and stores nothing (`:361-363`,
`kvStored: false` in the response) — a **silent-degrade path**, not an error, that Design should
surface honestly if it ever shows connector-save results. Sets `exchangeOnlineEnabled: true`,
`connectorMode: "delegated"` on upsert regardless of the caller's actual saved mode (`:377`).
Returns `{ ok: true, exchangeOnlineEnabled: true, kvStored: boolean }` (`:389`). Audit:
`connector.exchange.configure`, metadata includes `tenantId` and `kvStored` but never the secret
values (`:380-387`).

**`DELETE /api/msp/settings/connector/exchange`** (`:392-416`) — clears
`exchangeOnlineEnabled`/`exchangeOnlineTenantId`/both secret-name columns to
`false`/`null`/`null`/`null` (`:398-404`). **Does not delete the Key Vault secrets themselves** —
only unlinks the DB pointer to them; the secret values remain in Key Vault, orphaned. Returns
`{ ok: true }` (`:415`). Audit: `connector.exchange.remove` (`:407-413`).

### 1c. MSP Mailbox — outbound email connector (Group C)

Five-step OAuth-consent flow documented at `:1243-1254`: MSP admin GETs status → POSTs `/connect`
with `{ mailboxUpn, fromDisplayName }` to get a `consentUrl` → opens it (Microsoft admin-consent
screen) → Microsoft redirects to the `/callback` route (unauthenticated, server-to-server) → MSP
lands back on the portal Settings page. **No client secret is ever stored** — the platform's
multi-tenant app uses `client_credentials` after consent (`:1252-1253`).

**`GET /api/msp/settings/connector/mailbox`** (`:1256-1291`):

| Field | Type | Line |
|---|---|---|
| `connected` | `boolean` (`!!row?.isActive`) | `1285` |
| `mtAppConfigured` | `boolean` (`mtAppCredentialsPresent()`, `graph.ts:167`) | `1286` |
| `connector` | `MailboxConnector \| null` — `{ connectorId, tenantId, mailboxUpn, fromDisplayName, isActive, consentedAt, revokedAt, updatedAt }` | `1287`, cols `1262-1269` |
| `automatedCustomerEmailsEnabled` | `boolean` (from `mspsTable`, default `true` if row missing) | `1288` |
| `writeBackEnabled` | `boolean` (from `mspsTable`, default `false` if row missing) | `1289` |

**`POST /connector/mailbox/connect`** (`:1299-1347`) — body `mailboxConnectSchema` (`:1293-1297`):
`{ mailboxUpn: email, fromDisplayName: string(2-120), returnPath?: string }`. 503s
`"Multi-tenant app credentials not configured..."` if `mtAppCredentialsPresent()` is false
(`:1303-1306`) — a real, reachable degraded state, not hypothetical. Mints a `state` token
(32 random bytes hex), stores it in `mspMailboxConsentStatesTable` with a **10-minute** expiry
(`:1314-1325`), builds the admin-consent URL via `buildAdminConsentUrl("common", state,
callbackUrl, MT_APP_CLIENT_ID)` (`graph.ts:571`, called `:1335`) — **tenant hint is always
`"common"`**, not the MSP's own tenant, so the admin authenticates with whatever tenant they're
signed into. Returns `{ consentUrl, state, expiresAt }` (`:1346`). Audit:
`mailbox_connector.connect.initiated` (`:1337-1344`).

**`GET /connector/mailbox/callback`** (`:1350-1431`) — **the one unauthenticated route in this
module** (no `requireRole`, Microsoft calls it directly). Three real branches:

1. **Declined** (`:1356-1366`) — `error === "access_denied"` or `error_subcode === "cancel"`:
   burns the state row if present, redirects to
   `${portalBase}/settings/connector?mailbox_consent=declined`.
2. **Malformed callback** (`:1369-1373`) — missing `tenant`/`state` or
   `admin_consent !== "true"`: `400` plain-text, no redirect.
3. **Success** (`:1375-1430`) — validates the state token is unused and unexpired
   (`isNull(usedAt)`, `gte(expiresAt, now)`, `:1377-1387`), 400s `"...expired or has already been
   used"` otherwise (`:1389-1393`); burns the token (`:1396-1399`); upserts
   `mspMailboxConnectorsTable` keyed on `mspId` (unique, `:1414-1425`) — a second consent for the
   same MSP **overwrites** the prior mailbox/tenant, it does not add a second connector; redirects
   to `${portalBase}${returnPath}?mailbox_consent=success` (`:1430`), `returnPath` defaulting to
   `/settings/connector` (`:1429`, matching the request-time default at `:1322`).

**`DELETE /connector/mailbox`** (`:1433-1457`) — sets `isActive: false`, `revokedAt: now`
(`:1438-1440`); 404s `"No mailbox connector found for this MSP"` if none exists (`:1443-1446`).
Row is **kept, not deleted** — a reconnect via `/connect` → callback upserts the same row.

**`PATCH /connector/mailbox/automated-emails`** (`:1467-1495`) — body `{ enabled: boolean }`
(`:1465`). Writes `mspsTable.automatedCustomerEmailsEnabled`. Header comment (`:1459-1463`): this
flag is **functionally inert without an active mailbox connector** — every real send path checks
`canSendAutomatedCustomerEmail(mspId)` (`artifacts/api-server/src/lib/mailer.ts:314-330`) before
sending, which is a real, wired enforcement point (not a no-op flag), but the toggle only matters
once Group C's connector is actually connected.

**`PATCH /connector/mailbox/write-back`** (`:1503-1531`) — body `{ enabled: boolean }` (`:1501`).
Writes `mspsTable.writeBackEnabled`. **The route file's own header comment is stale and wrong**
(`:1497-1499`): *"Schema/parameter only — no enforcement logic reads this flag yet."* That was
true when written but is not true on `main` today — `writeBackEnabled` is now the real, **fail-closed
Gate 1** of `graphWriteForTenant()` (`artifacts/api-server/src/lib/graph.ts:1041-1067`), the
function every tenant-scoped Microsoft Graph *write* call goes through: it resolves the MSP from
the target customer row and throws `WriteBackNotEnabledError` if `writeBackEnabled` is false
(`graph.ts:1064-1067`), before a second, independent tenant-write-consent gate even runs
(`graph.ts:1069+`). It is also read (display-only) by AdminV2's Active Directory pane
(`artifacts/admin-panel/src/components/ActiveDirectoryMspPane.tsx:71,163`) and by
`admin-write-permissions.ts:138,273`. **This toggle is load-bearing, not cosmetic** — Design must
render it as a real, consequential control (every AD/Graph write for every one of this MSP's
tenants is gated on it), not as an inert preference. The stale in-code comment itself is filed as
**#3031** (sibling sub-issue of Feature #1690).

### 1d. Service Accounts — API keys (Group D)

**`GET /api/msp/settings/service-accounts`** (`:420-440`) — lists **non-revoked**
(`isNull(revokedAt)`, `:436`) accounts for the MSP, newest first. Fields: `id`, `name`,
`keyPrefix` (first 12 chars of the raw key, `:460`), `scopes: string[]`, `expiresAt: string|null`,
`revokedAt`, `lastUsedAt`, `createdAt` (`:426-433`). **The raw key value is never returned by this
route** — only the 12-char prefix, for display/identification.

**`POST /service-accounts`** (`:448-508`) — body `createServiceAccountSchema` (`:442-446`):
`{ name: string(2-100), scopes?: string[] (default []), expiresInDays?: number(1-365) }`. Mints
`msp_sa_${64 hex chars}` (`:458`), stores its SHA-256 hash (`keyHash`) and 12-char prefix, and —
**if** Key Vault env vars are present (`:466-471`, same four-var check as Group B) — the raw value
under `msp-${mspId}-sa-${Date.now()}` (`:474`); if Key Vault is unavailable the row is still
created but the raw key exists **only** in the response body, never persisted anywhere retrievable
— a genuine one-shot-or-lost secret in the no-Key-Vault case. Response is the created row **plus**
`rawKey` (`:507`) — **the only place the raw key is ever returned**, matching the header comment
`"Return the raw key exactly once — never again"` (`:506`). Audit: `service_account.create`
(`:497-504`).

**`DELETE /service-accounts/:id`** (`:510-532`) — sets `revokedAt: now`, scoped to
`(id, mspId)` (`:515-519`); row is **not deleted**, so a revoked account still appears in raw
table scans (but not in the GET list, which filters `isNull(revokedAt)`). 404s if not found or not
owned (`:521`). Audit: `service_account.revoke` (`:523-529`).

### 1e. Team / Users — the roster (Group E)

**`GET /api/msp/settings/users`** (`:536-579`) — lists every user row for the MSP (`isActive` not
filtered — suspended users still appear), newest-first. Fields (`:548-557`):

| Field | Type | Note | Line |
|---|---|---|---|
| `id` / `userId` | `number` | **same value, twice** — see the code comment (`:542-547`): a pre-refactor artifact from when `msp_users.id` and `users.id` were two different id-spaces; `msp_users` is gone, both keys now alias `users.id`, and the frontend historically read them interchangeably (`u.userId ?? u.id`). Kept as-is rather than collapsed, since a consuming UI could depend on either key. | `548-549` |
| `mspRole` | `"PlatformAdmin"\|"MSPAdmin"\|"MSPOperator"\|"CustomerUser"\|"ServiceAccount"\|"Free"\|"Assessment"` (`MSP_ROLES`, `schema/index.ts:37`) | full 7-value global enum, though only `MSPAdmin`/`MSPOperator` are realistically ever seen on this roster (users table's own check constraint ties `CustomerUser`/`Free`/`Assessment` to `tenantId`, not `mspId`) | `550` |
| `canApprovePurchases` | `boolean` | | `551` |
| `isActive` | `boolean` | | `552` |
| `lastLoginAt` | `string \| null` | | `553` |
| `createdAt` | `string` | | `554` |
| `email` | `string` | | `555` |
| `name` | `string \| null` | | `556` |
| `assignedCustomersCount` | `number` | **added by this route, not a column** — count of `msp_staff_customer_scopes` rows for that `userId` (`:565-570`), `0` meaning **unrestricted / all customers**, not "no access" (`:562-564,575-576`) | computed `:576` |

### 1f. Per-staff customer scoping (Group F)

**`GET /users/:userId/customer-scopes`** (`:588-622`) — 404s if the target isn't a user in the
caller's MSP (`:598`). Returns:

```
{ mspRole: string, scopable: boolean, allCustomers: {id,name,status}[], assignedCustomerIds: number[] }
```

`scopable` (`:618`) is `true` only for `mspRole === "MSPAdmin" || "MSPOperator"` — the UI should
hide the picker for any other role, per the comment at `:617`. `allCustomers` is every tenant
under the MSP (`tenantsTable` where `mspId`, `:602-605`), each carrying the real
`status: "active"|"inactive"|"onboarding"|"archived"` enum (`msp.ts:228`). An **empty**
`assignedCustomerIds` means unrestricted (full MSP access), not zero access — same semantics as
`assignedCustomersCount` in §1e.

**`PUT /users/:userId/customer-scopes`** (`:628-697`) — body `{ customerIds: number[] }`
(`updateScopesSchema`, `:624-626`), de-duped (`:639`). Rejects (400) if the target's role isn't
`MSPAdmin`/`MSPOperator` (`:648-651`), and rejects if **any** requested customer id doesn't belong
to the caller's MSP (`:655-663`) — a real cross-tenant IDOR guard, not cosmetic. Writes are
**atomic replace**: delete all this staff member's scope rows for this MSP, then bulk-insert the
new set inside one `db.transaction` (`:668-685`) — never a partial update. Returns
`{ ok: true, assignedCustomerIds: number[], unrestricted: boolean }` (`:696`). Audit:
`user.customer_scopes.update`, metadata includes the full `customerIds` array and `unrestricted`
(`:687-694`).

### 1g. User admin actions (Group G)

All nine routes here operate on `usersTable`, scoped `(userId, mspId)`, 404ing
`"User not found in this MSP"` when the target isn't in the caller's own MSP — a consistent
cross-tenant guard repeated at every one of these routes (e.g. `:645-647`, `:810-815`, `:847-852`,
`:875-880`, `:983-988`).

| Route | Body | Effect | Self-protection | Response | Audit type | Line |
|---|---|---|---|---|---|---|
| `PATCH .../role` | `{ mspRole: "MSPAdmin"\|"MSPOperator" }` | sets `usersTable.mspRole` | none | `{ ok: true }` | `user.role.update` | `703-732` |
| `PATCH .../approve-purchases` | `{ canApprovePurchases: boolean }` | sets column | none | `{ ok: true }` | `user.approve_purchases.update` | `738-767` |
| `DELETE /users/:userId` | — | `isActive: false` (soft-remove, **not a real delete**) | 400s `"Cannot remove your own account"` (`:775-778`) | `{ ok: true }` | `user.remove` | `769-797` |
| `POST .../reset-password` | — | mints a real `passwordResetTokensTable` row, 1h TTL (`MSP_RESET_TOKEN_TTL_MS`, `:802`), emails the reset link via `sendEmailFromTemplate("password-reset", ...)` | none | `{ ok: true, message }` | `user.password.reset_email_sent` | `804-839` |
| `POST .../temp-password` | — | generates `Temp-${6 hex bytes upper}!9`, bcrypt-hashes it (cost 12) into `passwordHash` directly — **no email sent, no expiry/require-change enforcement beyond the response flag** | none | `{ ok: true, tempPassword, requireChange: true }` — **the plaintext temp password is returned in the API response**, the one place in this module a real credential crosses the wire | `user.password.temp_set` | `841-867` |
| `POST .../reset-mfa` | — | deletes all `mfaEnrollmentsTable`/`mfaChallengesTable`/`webauthnCredentialsTable`/`webauthnChallengesTable` rows for the user, emails a plain-HTML notice (not a template-registry entry) | none | `{ ok: true, message }` | `user.mfa.reset`, metadata `clearedMethods: string[]` | `869-922` |
| `PATCH .../mfa-enforcement` | `{ enforced: boolean }` (untyped `req.body as`, no Zod) | sets `usersTable.mfaEnforced` | none | `{ ok: true, enforced }` | `user.mfa.enforcement_toggle` | `924-946` |
| `PATCH .../status` | `{ isActive: boolean }` (untyped, manually checked `typeof isActive !== "boolean"` → 400) | sets `usersTable.isActive` | 400s `"Cannot suspend your own account"` if `!isActive && userId === self` (`:956-959`) | `{ ok: true, isActive }` | `user.activate` / `user.suspend` (branches on `isActive`) | `948-975` |
| `DELETE .../sessions` | — | `revokeAllOtherSessions(userId, null)` — real, live-DB-tested revoke of every `user_sessions` row **and** its matching `msp_refresh_tokens` row (confirmed by `msp-settings-user-security.live-db.test.ts`, not a documentation claim) | none | `{ ok: true, revokedCount: number }` | `user.sessions.revoke_all`, metadata `revokedCount` | `977-1002` |

`mfa-enforcement` and `status` are the two routes in this module whose request body is read via a
raw `req.body as {...}` cast rather than a Zod schema (`:929`, `:953`) — every other route in the
file validates with `zod`. `status` at least runtime-checks the type (`:954`); `mfa-enforcement`
does not — `PATCH .../mfa-enforcement` with a non-boolean `enforced` coerces via `!!enforced`
(`:933`) rather than rejecting, so `{ enforced: "false" }` (a truthy string) silently sets
`mfaEnforced: true`. Not a crash risk, but a real client-input footgun Design should know about if
it ever renders this as a raw JSON-editable field (it should not — a toggle control avoids the
whole class).

### 1h. Billing (Group H)

**`GET /api/msp/settings/billing`** (`:1006-1027`) — one `mspSubscriptionsTable` row or `null`
(`:1026`, no 404 — absence is a valid, common state). Fields: `status` (real enum
`MSP_SUBSCRIPTION_STATUSES = "trialing"|"active"|"past_due"|"canceled"|"unpaid"`, `msp.ts:1519`),
`dunningState` (`MSP_DUNNING_STATES = "reminder_sent"|"suspended"|"access_revoked"|
"archival_flagged"`, nullable — `null` means fully current, `msp.ts:1525`), `stripeCustomerId`,
`stripeSubscriptionId`, `stripePriceId`, `currentPeriodStart`, `currentPeriodEnd`,
`tenantCountSnapshot`, `contactEmail` (`:1010-1021`). **No raw card data — Stripe IDs only.**

**`POST /billing/portal-session`** (`:1029-1063`) — 404s `"No Stripe subscription found"` if no
`stripeCustomerId` on file (`:1039-1042`); 503s `"Stripe not configured"` if `getStripeKey()`
throws (`:1044-1050`, i.e. no platform Stripe secret key in env — a real, reachable ops-config
gap, not hypothetical). On success, creates a real Stripe Billing Portal session
(`stripe.billingPortal.sessions.create`, `:1057-1060`) and returns `{ url: session.url }`
(`:1062`) for the frontend to redirect to. `returnUrl` defaults to
`https://${REPLIT_DOMAINS[0]}/portal/settings/billing` if not supplied (`:1055`) — note this
default path is `/portal/settings/billing`, the **customer**-portal path convention, not an
`/msp-console/...` one; worth flagging to Design/wiring since this route lives under
`/api/msp/settings`, an MSP-console surface.

### 1i. Email Templates (Group I)

**`GET /api/msp/settings/email-templates`** (`:1067-1102`) — merges MSP-specific overrides
(`mspEmailTemplatesTable` where `mspId` matches) over platform defaults (`mspId IS NULL`,
`:1072-1081`), for the fixed real key list `MSP_EMAIL_TEMPLATE_KEYS` (`msp.ts:1913-1922`):
`onboarding_welcome`, `monitoring_complete`, `offer_available`, `report_ready`,
`invoice_due_reminder`, `password_reset`, `mfa_code`, `consent_revoked` — **8 keys, always all 8
present in the response**, never a subset (`:1087` maps over the full constant, not the DB rows).
Per key:

| Field | Source | Line |
|---|---|---|
| `key` | the constant | `1091` |
| `subject` | override ?? default ?? `""` | `1092` |
| `body` | override ?? default ?? `""` | `1093` |
| `isCustomised` | `!!override` | `1094` |
| `isLocked` | `MSP_LOCKED_EMAIL_KEYS.has(key)` — real 3-value `Set`: `password_reset`, `mfa_code`, `consent_revoked` (`msp.ts:1925-1929`) | `1095` |
| `requiredMergeFields` | `REQUIRED_MERGE_FIELDS[key] ?? []` — a **hardcoded map in this route file** (`:128-137`), not DB-driven; e.g. `onboarding_welcome` requires `{{customerName}}`,`{{portalUrl}}` | `1096`, map `128-137` |
| `updatedAt` | override's `?? default's ?? null` | `1097` |

**`PUT /email-templates/:key`** (`:1109-1164`) — 404s on an unknown key (`:1114-1117`); **403s if
the key is platform-locked** (`:1119-1122`, message names the key) — the three `isLocked` keys can
never be customized via this route regardless of payload; body `emailTemplateSchema`
(`:1104-1107`): `{ subject: string(5-300), body: string(20-50000) }`; **422s if the body is
missing any of that key's `REQUIRED_MERGE_FIELDS`** (`validateMergeFields`, `:139-146`, called
`:1130-1134`) — a real content-shape gate, not cosmetic. Upserts on `(mspId, templateKey)`
(`:1145-1152`), returns the full row. Audit: `email_template.upsert` (`:1154-1161`).

**`DELETE /email-templates/:key`** (`:1166-1189`) — deletes the MSP's override row for that key
(reverting to platform default); **does not check `isLocked`** — deleting a locked key's
(non-existent, since it can never be created) override is a harmless no-op, but the route also
never blocks deleting any override, unlike PUT's explicit lock check. Always `{ ok: true }`
(`:1188`), even if no override existed to delete. Audit: `email_template.delete` (`:1180-1186`).

### 1j. Customer Agreement Template (Group J)

**`GET /api/msp/settings/agreement-template`** (`:1193-1204`) — `{ template: string|null,
updatedAt: string|null }`, sourced from `mspConnectorConfigsTable.customerAgreementTemplate`
(**the same column** Group B's connector PUT can silently null out — see the §1b warning).

**`PUT /agreement-template`** (`:1206-1241`) — body `{ template: string(50-100000) }`. Upserts on
`mspId`, setting **only** `customerAgreementTemplate`/`updatedAt` in the conflict branch
(`:1227-1230`) — unlike Group B's PUT, this one does **not** clobber `connectorMode` or
`auditLoggingEnabled` on update (though the insert branch does default `connectorMode:
"delegated"` for a brand-new row, `:1221`). Returns `{ ok: true }` (`:1240`, **not** the saved
template — a round-trip GET is needed to confirm). Audit: `agreement_template.update`
(`:1232-1238`).

### 1k. Sessions + Invites (Group K)

**`GET /api/msp/settings/sessions`** (`:1535-1574`) — active refresh-token sessions for every
**active** user in the MSP (`isActive: true` filter, `:1542`); returns `[]` immediately if the MSP
has zero active users (`:1545-1548`, avoids an `inArray([])` query). Joins `mspRefreshTokensTable`
to `usersTable` for `email`/`name`, filters `isNull(revokedAt)`, orders newest-first, **capped at
100** (`:1571`) — a real, silent truncation Design should account for if an MSP ever has more than
100 live sessions across its staff.

**`DELETE /sessions/:tokenHash`** (`:1576-1614`) — re-derives the caller's MSP's active user-id
set and 404s `"Session not found"` if the token doesn't belong to one of them (`:1595-1598`) — the
same cross-tenant IDOR pattern as Group G. Sets `revokedAt: now` (`:1600-1603`). Audit:
`session.revoke`, `entityId` is the **first 12 chars** of the token hash, not the full hash
(`:1609`).

**`POST /invites`** (`:1631-1727`) — body `createInviteSchema` (`:1626-1629`): `{ email: string,
mspRole: "MSPAdmin"|"MSPOperator" }` — note this is the **narrower, invite-local** 2-value role
enum (`msp.ts:647`), distinct from the 7-value global `MSP_ROLES`; you cannot invite a
`CustomerUser`/`ServiceAccount`/etc. through this route by construction. 409s if the email is
already an **active** member of this MSP (`:1650-1659`, a suspended member can still be
re-invited); 409s if an unexpired, unused invite already exists for the same email
(`:1663-1680`, message: `"...Revoke it first if you need to resend."`). Mints a 32-byte-hex token,
**72-hour** expiry (`:1688-1689`), sends the invite email (fire-and-forget, `void
sendEmailForMsp(...)`, `:1714` — a send failure is not surfaced to the caller), returns the full
inserted invite row (`:1726`, `201`). Audit: `invite.create` (`:1716-1723`).

**`GET /invites`** (`:1729-1756`) — every **unused, unexpired** invite for the MSP
(`isNull(usedAt)`, `gte(expiresAt, now)`, `:1746-1751`) — a used or expired invite silently drops
off this list with no "expired" state surfaced; the caller has no way to distinguish "never
existed" from "expired" from this endpoint alone. Includes `inviterEmail`/`inviterName` via a left
join (`:1741-1745`, so a deleted inviter user still leaves the invite listed with null inviter
fields).

**`DELETE /invites/:inviteId`** (`:1758-1779`) — deletes (real delete, not soft) an invite scoped
`(id, mspId, isNull(usedAt))` — **an already-used invite cannot be revoked via this route** (it
404s, `"Invite not found or already used"`, `:1768`), which is correct (nothing to revoke once
accepted) but worth Design knowing the delete button should disable/hide once an invite shows as
used.

---

## 2. Real enum unions (no invented vocabularies)

| Enum | Values | Source |
|---|---|---|
| MSP role hierarchy (7-value, global) | `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin` | `requireAuth.ts:81-89` |
| Invite-local `mspRole` (2-value) | `MSPAdmin`, `MSPOperator` | `msp.ts:647` |
| `msps.status` | `active`, `suspended`, `trial` | `msp.ts:41` |
| `msps.offboardingState` | `cancellation_requested`, `export_ready`, `archival_flagged` | `msp.ts:31` |
| `tenants.status` | `active`, `inactive`, `onboarding`, `archived` | `msp.ts:228` |
| `MspConnectorMode` | `agent`, `api_key`, `delegated` | `msp.ts:1750` |
| `msp_subscriptions.status` | `trialing`, `active`, `past_due`, `canceled`, `unpaid` | `msp.ts:1519` |
| `msp_subscriptions.dunningState` | `null` (current), `reminder_sent`, `suspended`, `access_revoked`, `archival_flagged` | `msp.ts:1525` |
| `msp_audit_logs.outcome` | `success`, `failure`, `partial` — this module only ever writes `success` (`writeAuditLog`, `:121`); `failure`/`partial` exist in the schema but no route in this file produces them | `msp.ts:942` |
| Email template keys (8) | `onboarding_welcome`, `monitoring_complete`, `offer_available`, `report_ready`, `invoice_due_reminder`, `password_reset`, `mfa_code`, `consent_revoked` | `msp.ts:1913-1922` |
| Locked (platform-only) template keys (3) | `password_reset`, `mfa_code`, `consent_revoked` | `msp.ts:1925-1929` |

---

## 3. Cross-surface edges

- **Group B's connector PUT and Group J's agreement-template PUT share one column**
  (`mspConnectorConfigsTable.customerAgreementTemplate`) with asymmetric upsert behavior — Group
  B's PUT always overwrites it (defaulting to `null` if omitted from the request body); Group J's
  PUT never touches unrelated connector fields. A UI that lets an admin edit connector mode and
  the agreement template on the same screen must write them through Group J's endpoint for the
  template, never round-trip it through Group B's.
- **Both toggles Group C's mailbox-status GET reports are load-bearing, not one of them.**
  `automatedCustomerEmailsEnabled` gates outbound customer email at send time
  (`canSendAutomatedCustomerEmail()`, `lib/mailer.ts:314`); `writeBackEnabled` gates every
  tenant-scoped Microsoft Graph *write* at call time (`graphWriteForTenant()` Gate 1,
  `graph.ts:1041-1067`) — a materially higher-stakes gate than the route file's own comment
  implies (see §1c and finding #3031). Both live on the same `mspsTable`
  row and surface through the same GET, but they gate two entirely different subsystems (email
  send vs. Graph write) with no code path connecting them to each other.
- **Group D (service accounts) and Group B (Exchange connector) both gate their Key Vault write on
  the identical four-env-var check** (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/
  `AZURE_KEY_VAULT_URL`), duplicated verbatim at `:342-347` and `:466-471` rather than factored
  into one helper — a real, harmless duplication, not a contract gap.
- **Group G's password-reset (`.../reset-password`) and Group G's temp-password
  (`.../temp-password`) are two independent flows for the same goal** (getting a user back into
  their account) with very different security postures: reset-password emails a time-boxed link
  and never exposes a credential over the wire; temp-password fabricates and returns a plaintext
  password directly in the JSON response with no forced-expiry mechanism beyond the advisory
  `requireChange: true` flag (nothing server-side enforces that flag). Design should treat these
  as two distinct actions with distinct framing, not variants of one "reset password" button.
- **Group K's invites and Group E's roster are not merged anywhere** — a pending invite and an
  active user are two disjoint lists (`GET /users` vs `GET /invites`); a Team page showing "who's
  on the team, who's pending" must call both endpoints and merge client-side; there is no single
  endpoint that returns "roster + pending invites" together.

---

## 4. Honest tri-state / empty states

- **Group B connector, no row yet** → real, documented defaults (`connectorMode: "delegated"`,
  everything else off/null) — not an error, the common first-visit state for any MSP that hasn't
  configured a connector (§1b).
- **Group C mailbox, `mtAppConfigured: false`** → `POST /connect` 503s outright; `GET /mailbox`
  still returns a valid (all-false) status object — the UI should distinguish "not configured
  platform-wide" (mtAppConfigured false, nothing an MSP admin can do) from "not yet connected by
  this MSP" (mtAppConfigured true, connector null).
- **Group H billing, no subscription row** → `null`, not a 404 — genuinely valid for an MSP that
  predates Stripe billing or is on a manually-managed plan.
- **Group H billing, no Stripe key configured platform-wide** → `503` from the portal-session
  route — an ops-config gap that is real and reachable (`getStripeKey()` throwing is not
  hypothetical dead code; it is the platform-Stripe-key-missing case).
- **Group K invites, expired-vs-never-existed** → indistinguishable from `GET /invites` alone
  (§1k) — genuinely unresolvable from the wire contract as built; Design should not imply the UI
  can show "this invite expired 2 days ago" without a separate lookup this route doesn't offer.
- **Live-DB fact** (queried this session against the local `DATABASE_URL`, 2026-09-06): every
  write-target table in this module is **currently empty** on the real dev database except audit
  logs and refresh tokens —

  | Table | Row count |
  |---|---|
  | `msp_connector_configs` | 0 |
  | `msp_email_templates` (incl. platform defaults) | 0 |
  | `msp_invites` | 0 |
  | `msp_mailbox_connectors` | 0 |
  | `msp_service_accounts` | 0 |
  | `msp_staff_customer_scopes` | 0 |
  | `msp_refresh_tokens` (unrevoked) | 309 |
  | `msp_subscriptions` | 1 |
  | `msp_audit_logs` | 486 |
  | `msps` | 2 |
  | `users` with an `mspId` | 9 |

  So today, every group in this pack **except** Group A (profile — real rows on both real MSPs),
  Group E/G (real users), Group H (one real subscription) and Group K's sessions list renders its
  honest-empty state for real, not as a placeholder. `msp_email_templates` being **zero rows total,
  including the `mspId IS NULL` platform-default rows**, means Group I's GET currently returns all
  8 keys with `subject: ""`, `body: ""`, `isCustomised: false` — there are no seeded platform
  defaults on this database at all. Design must draw the populated state from the wire contract in
  §1i, not from a live screenshot, since there is currently nothing populated to screenshot.

---

## 5. CURRENT vs DECIDED

Everything in §1 is **CURRENT** — built, wired, and reachable via HTTP right now, verified against
the route file on `main` as of this pack, and cross-checked against every real reader/writer of
each field outside the route file itself (not just the route file's own comments — see §1c/§3 for
the one place that check mattered: `writeBackEnabled`'s in-code comment claims no enforcement,
`graph.ts` proves otherwise). There is no interpretation layer, routing gate, or async-resolution
pipeline in this module the way Microsoft Changes has (#1642) — every group here is a direct
CRUD-shaped surface over its own table(s), so there is no genuine DECIDED-but-not-built category to
call out.

---

## 6. Forbidden list — what this pack found that a UI must never do

- **Never render `PATCH .../mfa-enforcement`'s `enforced` field as free-text/JSON input.** The
  route coerces any truthy value via `!!enforced` rather than validating a strict boolean (§1g) —
  a toggle control is the only safe UI for this field.
- **Never wire the customer-agreement-template textarea to Group B's `PUT /connector`.** Any
  request to that route that omits `customerAgreementTemplate` sets it to `null` (§1b, §3) — use
  Group J's dedicated PUT.
- **Never surface Group G's `POST .../temp-password` as a casual "reset" action next to
  `reset-password`.** It returns a real plaintext credential in the response body with no
  server-enforced expiry (§1g, §3) — it needs its own explicit, higher-friction confirmation
  affordance, not to sit as a peer button to the safe email-link flow.
- **Never assume `GET /invites` tells you why an invite is missing.** It cannot distinguish
  "never existed" from "expired" from "already accepted" (§1k, §4) — do not build copy that claims
  otherwise.
- **Never show more than the real 100-row cap on the sessions list as if it were the true total**
  (§1k) — if an MSP's active-session count could plausibly exceed 100, the UI needs its own
  "showing the 100 most recent" disclosure, because the API gives no total count to compare
  against.
- **Never present the `write-back` toggle as a minor/inert preference.** It is the real,
  fail-closed gate on every Graph write for every one of this MSP's tenants (§1c, §3) — copy and
  placement should match a control of that consequence, not the "Schema/parameter only" framing
  the (stale) in-code comment still carries.

---

## 7. Orphaned endpoints — all 39

Confirmed by a repo-wide search of every frontend app (`artifacts/msp-console`,
`artifacts/msp-portal`, `artifacts/admin-panel`, `artifacts/shane-mccaw-consulting`) for every path
in this module: **zero call sites** outside `msp-settings.ts` itself and its two test files
(`msp-settings-portal-links.test.ts`, `msp-settings-user-security.live-db.test.ts`).
`artifacts/msp-console/src` is a 6-file scaffold — `App.tsx`, `pages/index.tsx`,
`pages/not-found.tsx`, plus `lib/utils.ts`/`main.tsx`/`index.css` — with an explicit placeholder
docstring (`pages/index.tsx:1-8`) naming Feature #2667 (MSP Console Shell) as where real chrome
lands. Every route below is orphaned for that one structural reason, not 39 individual defects:

```
GET    /api/msp/profile
GET    /api/msp/settings/profile
PATCH  /api/msp/settings/profile
GET    /api/msp/settings/connector
PUT    /api/msp/settings/connector
PUT    /api/msp/settings/connector/exchange
DELETE /api/msp/settings/connector/exchange
GET    /api/msp/settings/connector/mailbox
POST   /api/msp/settings/connector/mailbox/connect
GET    /api/msp/settings/connector/mailbox/callback
DELETE /api/msp/settings/connector/mailbox
PATCH  /api/msp/settings/connector/mailbox/automated-emails
PATCH  /api/msp/settings/connector/mailbox/write-back
GET    /api/msp/settings/service-accounts
POST   /api/msp/settings/service-accounts
DELETE /api/msp/settings/service-accounts/:id
GET    /api/msp/settings/users
GET    /api/msp/settings/users/:userId/customer-scopes
PUT    /api/msp/settings/users/:userId/customer-scopes
PATCH  /api/msp/settings/users/:userId/role
PATCH  /api/msp/settings/users/:userId/approve-purchases
DELETE /api/msp/settings/users/:userId
POST   /api/msp/settings/users/:userId/reset-password
POST   /api/msp/settings/users/:userId/temp-password
POST   /api/msp/settings/users/:userId/reset-mfa
PATCH  /api/msp/settings/users/:userId/mfa-enforcement
PATCH  /api/msp/settings/users/:userId/status
DELETE /api/msp/settings/users/:userId/sessions
GET    /api/msp/settings/billing
POST   /api/msp/settings/billing/portal-session
GET    /api/msp/settings/email-templates
PUT    /api/msp/settings/email-templates/:key
DELETE /api/msp/settings/email-templates/:key
GET    /api/msp/settings/agreement-template
PUT    /api/msp/settings/agreement-template
GET    /api/msp/settings/sessions
DELETE /api/msp/settings/sessions/:tokenHash
POST   /api/msp/settings/invites
GET    /api/msp/settings/invites
DELETE /api/msp/settings/invites/:inviteId
```

---

*Pack generated 2026-09-06, session for #2604 (Feature #1690: Settings (MSP Console)). Read-only:
no product code, schema or UI changed. Next step per #1690's fixed ordering is #2605 (Claude
Design export into `Design/msp-console/`), then #2606 (wire).*

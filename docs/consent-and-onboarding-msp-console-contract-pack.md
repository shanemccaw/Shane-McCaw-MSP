# Consent and Onboarding — MSP Console contract extraction pack

**#2625**, the Document step for **#2563** (Feature: Consent and Onboarding, MSP Console — the
operator half of #1650), under #1571 (EPIC: Portal Admin) and its fixed order: API build-out →
**Document (this pack)** → Design → Implement & wire. `artifacts/msp-console` itself does not
exist yet (per #2563's own "Status" section, its scaffolding is separate follow-on work) —
that is a blocker for the eventual wire step, not for this step: the backend this pack documents
is real, audited, and already mounted (#2674, commit `1555aab4`, merged to `origin/main`).

Read-only. Every field below is extracted verbatim from the route's own response construction
(neither route file in this pack defines a curated `Wire*` interface — see §0.2) and the Drizzle
schema, cited to file:line, and cross-checked live against local PostgreSQL. **Nothing here is
authored or invented.**

This is a **separate module** from `docs/consent-and-onboarding-contract-pack.md` (the
customer-portal pack, #2758) — that pack documents the OAuth callback and the customer-facing
checkout/contract/onboarding endpoints, and explicitly scopes the admin tier of `consent.ts` as
"documented ... only to the extent needed to establish the callback's own behavior ... out of
scope for Design under this Feature." This pack is the MSP-operator-facing counterpart to that
admin tier — extracted to the same standard, for the surface #2674 actually built.

Backend routes (all live, all mounted — `artifacts/api-server/src/routes/index.ts:128-129,
460-461`):
- `artifacts/api-server/src/routes/msp-consent.ts` — list, detail, invite-link, revoke (4 routes)
- `artifacts/api-server/src/routes/msp-onboarding.ts` — the one new route in scope,
  `GET /api/msp/onboarding/links` (`:153-188`); its sibling `POST
  /api/msp/onboarding/generate-link` (`:86-146`) pre-existed #2674 and is pulled in as a direct
  producer of the rows this pack's new list route reads (§3)

Schema: `lib/db/src/schema/msp.ts:199-205` (`tenantsTable.consent`, jsonb `TenantConsentMap`),
`:84-92` (`TenantConsentRecord`), `:144-149` (`TenantConsentMap`), `:1014-1032`
(`consentInviteTokensTable`), `:1145-1163` (`mspOnboardingLinksTable`). Verified live against
local PostgreSQL (`psql "$DATABASE_URL" -c '\d tenants'` / `'\d msp_onboarding_links'`) — the
`consent` jsonb column and every `msp_onboarding_links` column cited below are confirmed present
on the running schema, matching the Drizzle source exactly.

---

## 0. The surfaces and their consumers

### 0.1 Consumer map

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/consent` | GET | `msp-consent.ts:59-90` | none | live, genuinely unconsumed today — staged for a future MSP Console wire step, `artifacts/msp-console` has no pages beyond scaffolding |
| `/api/msp/customers/:customerId/consent` | GET | `msp-consent.ts:94-135` | none | live, staged |
| `/api/msp/customers/:customerId/consent/invite-link` | POST | `msp-consent.ts:144-207` | none | live, staged |
| `/api/msp/customers/:customerId/consent/revoke` | PATCH | `msp-consent.ts:211-258` | none | live, staged |
| `/api/msp/onboarding/links` | GET | `msp-onboarding.ts:153-188` | none | live, staged — the one new route #2674 added |
| `/api/msp/onboarding/generate-link` | POST | `msp-onboarding.ts:86-146` | none directly, but is the sole writer of the rows §3 lists — pre-existing, pulled in for context | live, pre-existing (not part of #2674's own diff) |

**No orphaned-endpoint sub-issue filed for the "staged" rows.** This is the expected
pre-Design/pre-wire state, same threshold the sibling `risk-register-msp-console-contract-pack.md`
(#2580) pack uses: every one of these is real, live, mounted, and has zero consumers only because
`artifacts/msp-console` is still just scaffolding — not because anything is broken.

Orphaned-endpoint check, run against the current tree:

```
grep -rn "msp/consent\|msp/customers/.*consent\|msp/onboarding/links" artifacts/msp-console artifacts/admin-panel artifacts/portal
```

Real result: zero hits anywhere in the tree. Confirmed, not assumed.

### 0.2 No curated `Wire*` interface in either route file — every field is a bare `db.select()` projection

Unlike the sibling RBD MSP-console pack's `msp-rbd-instances.ts`/`msp-rbd-versions.ts` (which
define real `Wire*` TypeScript interfaces), neither `msp-consent.ts` nor the new
`GET /api/msp/onboarding/links` route defines one. Both build their response directly off an
explicit `db.select({...})` column projection (not a bare `select()` of the whole row — so no
column this pack doesn't list is ever shipped), then map over it inline. The field tables in §1–§3
below are extracted from those inline `.map()`/`res.json()` calls, not from a named interface,
because no named interface exists to cite.

---

## 1. Wire contract — `msp-consent.ts` list & detail

### 1.1 List — `GET /api/msp/consent`

`requireRole("MSPOperator")`. `403 { error: "No MSP scope on this token" }` if the JWT carries no
`mspId` (`resolveMspIdStrict`, `:60-64`). Scoped to `mspId` only (`eq(tenantsTable.mspId, mspId)`,
`:75`) — every tenant in the caller's own MSP book, no further filter.

**Filtered in JS to only tenants that have been through at least one of the three consent flows**
(`:78-79`, `r.consent?.graph != null || r.consent?.writeBack != null || r.consent?.sharepoint !=
null`) — a tenant that has never started any consent flow is silently absent from this list, not
returned with three `null` grants. This is a real, deliberate difference from the admin-tier
`GET /api/admin/consent` (`consent.ts:1129-1153`), which filters on `graph` alone (`:1143`) — the
MSP-scoped list is explicitly widened to all three keys per `msp-consent.ts`'s own header comment
(`:25-26`, "extended to all three keys per #2563's stated scope ... not just `graph`").

| Wire field | Source | Notes |
|---|---|---|
| `customerId` | `tenantsTable.id` | |
| `tenantId` | `tenantsTable.tenantId` | the Microsoft GUID |
| `customerName` | `tenantsTable.customerName` | |
| `updatedAt` | `tenantsTable.updatedAt` | the whole `tenants` row's `updatedAt`, not a per-grant timestamp — three independent grants can each have their own `consentedAt`/`revokedAt` (§1.3) while sharing one `updatedAt` |
| `graph` | `consentRow(consent.graph)` (`consent.ts:167-175`) | §1.3 |
| `writeBack` | `consentRow(consent.writeBack)` | §1.3 |
| `sharepoint` | `consentRow(consent.sharepoint)` | §1.3 |

### 1.2 Detail — `GET /api/msp/customers/:customerId/consent`

`requireRole("MSPOperator")`. `400 { error: "Invalid customerId" }` for a non-numeric
`:customerId`. **Ownership-checked via `assertCustomerAccess(req.user!, customerId)`
(`requireAuth.ts:295-324`) before any row read** — `404 { error: "Customer not found in your
book" }` on failure (`:104-107`), same no-existence-leak pattern the sibling RBD pack documents
for its own container-scoped routes. A second `404 { error: "Customer not found" }` (`:120-123`)
covers the (should-not-happen-in-practice) case where `assertCustomerAccess` passed but the row
vanished between the check and the read — two different 404 messages for two different failure
points, real but not distinguishable to the caller by status code alone.

Response shape identical to one row of the list above, minus the array wrapper: `{customerId,
tenantId, customerName, updatedAt, graph, writeBack, sharepoint}` (`:125-133`). **Not filtered** —
unlike the list route, a customer that has never been through any consent flow still returns
`200` with all three keys `null`, not a `404`.

### 1.3 `consentRow()` — the shared projection both routes above use

`consent.ts:167-175`, imported into `msp-consent.ts:50`. Projects one
`TenantConsentRecord | undefined` into:

```ts
// consent.ts:167-175 — consentRow() (verbatim)
{
  consentStatus: record.status,
  consentedAt: record.consentedAt ?? null,
  revokedAt: record.revokedAt ?? null,
  grants: record.grants ?? [],
}
```

`null` (not the object above) if the input is `undefined` — "an absent key means this tenant has
never been through that flow," per the function's own comment (`:163-165`).

**`consentStatus` enum** (`TenantConsentRecord.status`, `lib/db/src/schema/msp.ts:85`): `"pending"
| "granted" | "declined" | "revoked"` — a real, fixed TS union, not DB-CHECK-enforced (the column
is plain `jsonb`, no Postgres CHECK constraint on its nested `status` key).

**Fields on `TenantConsentRecord` that `consentRow()` does NOT project — `adminEmail` and
`adminDisplayName`** (`msp.ts:88-89`). Both are real, stored fields (the admin-tier `GET
/api/admin/consent` knows this and manually splices `adminEmail` back onto its own response,
`consent.ts:1148`) — but `msp-consent.ts`'s two routes above never do the same splice, so
`adminEmail`/`adminDisplayName` are silently absent from every MSP-scope response for all three
grant keys. **Filed as #2818** (Finding 1, §7).

### 1.4 Invite-link — `POST /api/msp/customers/:customerId/consent/invite-link`

`requireRole("MSPOperator")`. `503 { error: "Multi-tenant app credentials not configured
(MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET)" }` if `mtAppCredentialsPresent()` is false — checked
**before** the ownership check, so this specific 503 can fire even for a `:customerId` outside the
caller's own book (a real, minor ordering quirk, not filed — the caller learns nothing about the
target tenant from it, just that the app isn't configured at all). Then `400 { error: "Invalid
customerId" }`, then `404 { error: "Customer not found in your book" }` via `assertCustomerAccess`
(`:161-164`), same pattern as §1.2.

Body: `{ ttlHours?: number }` (default `72`, clamped `1–168` via `Math.min(Math.max(...), ...)`,
`:175`) — **no other field accepted**; unlike the admin-tier `POST /consent/invite-link`
(`consent.ts:346-391`), which takes `tenantId`/`customerId`/`clientUserId` all from the body, this
MSP-scoped route derives `customerId` from the URL param (already ownership-verified) and
`tenantId` itself from the row (`customer.tenantId`, `:168-172`) — never trusted from the client.

**Mints a `graph` (read) consent invite only** — same single-use `consent_invite_tokens` +
`buildAdminConsentUrl()` mechanism as every other consent-invite path in the repo (no second
consent mechanism introduced), targeting `MT_APP_CLIENT_ID` (the read app registration). **There
is no MSP-scoped route to mint a `writeBack` or `sharepoint` invite** — those two flows' only
mint routes are the PlatformAdmin-only `GET /api/admin/customers/:customerId/write-consent/start`
(`consent.ts:1286-1341`) and the SharePoint equivalent (`consent.ts:1663+`), targeting
`MT_APP_WRITE_CLIENT_ID` and the SharePoint app registration respectively. **Filed as #2818**
(Finding 2, §7).

Response `200`: `{ consentUrl: string, token: string, expiresAt: Date, scopes: string[] }`
(`:200-205`, `scopes` is `REQUIRED_MT_SCOPES` verbatim — the same manifest constant
`docs/consent-and-onboarding-contract-pack.md` §1b already documents as the real source of truth
for what this flow requests). Side effects: one `consent_invite_tokens` row inserted
(`tenantId`/`customerId` set, `clientUserId` always `null` — this route has no notion of a
specific portal user, unlike the admin route's optional `clientUserId`), one `createAuditLog`
call (`actionType: "consent_invite_created"`, `actorRole: "client"` — a literal string, not
`"msp-operator"`, matching the admin route's own `actorRole: "admin"` convention of a fixed
role-family string rather than the actual role name).

**No `msp.status === "suspended"` gate on this route**, unlike `POST
/api/msp/onboarding/generate-link` (`msp-onboarding.ts:120-123`, `403 { error: "MSP is not
active" }`) — an MSP whose own account is suspended can still mint a customer consent invite link
through this route. Not filed: a suspended MSP minting an invite for its own already-onboarded
customer is a narrower, lower-consequence gap than a suspended MSP originating brand-new customer
signups (what `generate-link`'s gate actually guards against), and the invite still requires a
live `assertCustomerAccess` pass — flagged here for Design/QA awareness, same "flag, don't file"
threshold the sibling packs use for asymmetries below the bug-filing bar.

### 1.5 Revoke — `PATCH /api/msp/customers/:customerId/consent/revoke`

`requireRole("MSPOperator")`. Same `400`/`404`-via-`assertCustomerAccess` ordering as §1.2/§1.4.

Body: `{ key?: "graph" | "writeBack" | "sharepoint" }`, defaulting to `"graph"`
(`CONSENT_REVOKE_KEYS`, imported from `consent.ts:1162` — the same canonical array the admin-tier
revoke route uses, no independent duplication). `400 { error: "key must be one of: graph,
writeBack, sharepoint" }` for any other value.

Write: `stampConsent(and(eq(tenants.id, customerId), eq(tenants.mspId, req.user!.mspId ?? -1)),
key, { status: "revoked", revokedAt: <server ISO now> })` (`:233-237`) — **the `mspId` filter here
is a second, belt-and-suspenders ownership check** on top of the already-passed
`assertCustomerAccess`, using `?? -1` as a sentinel so an (unreachable in practice, since
`requireRole` already guarantees a role but not necessarily an `mspId`) missing `mspId` can never
match any real row rather than being coerced into a wildcard. `404 { error: "Tenant consent
record not found" }` if `stampConsent` matches zero rows (`stampConsent`'s own contract,
`consent.ts:99-104`: "a grant that lands nowhere is exactly the kind of silent hole this refactor
must not introduce").

**Addressing-scheme asymmetry vs. the admin-tier revoke route, worth Design/QA knowing about
explicitly:** `PATCH /api/admin/consent/:tenantId/revoke` (`consent.ts:1164-1195`) takes the
Microsoft **GUID** (`tenantsTable.tenantId`) in its URL param and matches on
`eq(tenantsTable.tenantId, tenantId)`. This MSP-scoped route instead takes the internal integer
**`customerId`** (`tenantsTable.id`) in its URL param — consistent with every other route in this
pack and with `assertCustomerAccess`'s own signature (which takes `customerId: number`, not a
GUID), but a genuinely different addressing scheme from its admin-tier counterpart of the same
underlying action. Not filed: both are internally consistent within their own tier, and this
mirrors the same kind of "real, deliberate asymmetry" the sibling RBD pack's §1.4 already
documents for a different route pair in this same module family.

Success `200`: `{ ok: true, customerId, key }` (`:256`) — **not** the full updated row, unlike
`stampConsent`'s own `{id}`-only `.returning()`. Side effect: one `createAuditLog` call
(`actionType: "tenant_consent_revoked"`, same as the admin tier's own action type — a shared
audit-log vocabulary between the two tiers, not a per-tier duplicate).

---

## 2. Wire contract — `msp-onboarding.ts`, `GET /api/msp/onboarding/links`

The one route #2674 added to this file (`:153-188`). `requireRole("MSPOperator")`. `403 { error:
"No MSP scope on this token" }` if `req.user!.mspId` is falsy (`:157-161`) — note this route reads
`req.user!.mspId` directly rather than going through `resolveMspIdStrict()` the way `msp-consent.ts`
does; both resolve to the exact same value (`resolveMspIdStrict` is a one-line `req.user?.mspId ??
null` wrapper, `resolve-msp-id.ts:75-77`) so this is a stylistic inconsistency within the same
build, not a behavioral one — not filed.

Scoped to the caller's own `mspId` (`eq(mspOnboardingLinksTable.mspId, mspId)`, `:176`), newest
`createdAt` first, **capped at 200 rows, no further pagination** (`:177-178`) — same cap and same
"no pagination beyond it" honest-limit the sibling RBD pack documents for its own list routes.

| Wire field | DB column | Type | Notes |
|---|---|---|---|
| `token` | `msp_onboarding_links.token` | text, PK | the bare token value is returned on the list — the same value that appears in the `link` URL §3 mints; whoever wires this must decide whether to re-derive/display the full link or just the token (open note, not a gap — no consumer exists yet to force the decision, same shape as the sibling RBD pack's §7.2 note) |
| `customerEmail` | `.customer_email` | text | |
| `serviceId` | `.service_id` | integer, nullable | raw id only — **no joined service name/slug** on this wire; a caller wanting the service's display name must fetch `GET /api/services` (customer-portal pack §5) separately and join client-side |
| `note` | `.note` | text, nullable | |
| `redirectPortalUrl` | `.redirect_portal_url` | text, nullable | populated post-checkout only (per the column's own schema comment, `msp.ts:1154`) — always `null` for a link nobody has completed yet |
| `expiresAt` | `.expires_at` | timestamptz | |
| `usedAt` | `.used_at` | timestamptz, nullable | |
| `createdByUserId` | `.created_by_user_id` | integer, nullable | raw id only — no joined staff name |
| `createdAt` | `.created_at` | timestamptz | |
| `status` | — (derived) | `"used" \| "expired" \| "pending"` | computed in-route (`:184`): `usedAt ? "used" : expiresAt < now ? "expired" : "pending"` — **there is no stored status column**, matching this same route's own header comment (`:12`) and the exact same derivation pattern `GET /api/public/onboarding/link/:token` (`msp-onboarding.ts:192-256`) already uses for the same table |

### 2a. Honest-empty contract

Zero links for an MSP is a real `[]` (`:181`, the same 200-row-cap honest-limit as above, no
error branch) — no fixture, no synthetic row.

---

## 3. Cross-surface edges

| Edge | Column | Points at | Served on this pack's wire? | Notes |
|---|---|---|---|---|
| Consent invite → tenant | `consent_invite_tokens.customerId` | `tenants.id` | Not directly — the invite-link route (§1.4) writes this row but never reads it back on this pack's wire | The read-consent OAuth callback (customer-portal pack §1) is the actual consumer of this row, on a completely separate request |
| Onboarding link → MSP | `msp_onboarding_links.mspId` | `msps.id` | Yes, implicit (the scoping predicate for §2, never a returned field — the caller already knows their own `mspId` from their session) | |
| Onboarding link → service | `msp_onboarding_links.serviceId` | `services.id`, no FK | Raw id only, §2 | No hard FK — same no-FK addressing convention `docs/consent-and-onboarding-contract-pack.md` §6a documents for the same column, read from the other side |
| `POST generate-link` → `GET links` | `msp_onboarding_links` (same table, same rows) | — | Yes — `GET /api/msp/onboarding/links` is a straight read of exactly what `POST /api/msp/onboarding/generate-link` (pre-existing, `:86-146`) writes | This pack's one new route has no write path of its own; it is a pure reader added alongside an existing writer |
| Consent grant → who approved | `tenants.consent.<key>.adminEmail` / `.adminDisplayName` | — (jsonb, no join) | **No** — stored, never on this pack's wire (§1.3) | §7 Finding 1 |

---

## 4. Real enum unions (and where each is actually enforced)

| Vocabulary | Values | Where fixed | Enforced by |
|---|---|---|---|
| Consent `status` | `pending`, `granted`, `declined`, `revoked` | `TenantConsentRecord.status`, `msp.ts:85` | TS type only — the column is plain `jsonb`, **no Postgres CHECK constraint** on the nested key. `msp-consent.ts`'s revoke route only ever writes `"revoked"`; the other three values are written exclusively by `consent.ts`'s own OAuth-callback/decline/write-back/SharePoint flows, none of which this pack's routes touch |
| Consent `key` (revoke selector) | `graph`, `writeBack`, `sharepoint` | `CONSENT_REVOKE_KEYS`, `consent.ts:1162` | `msp-consent.ts:228` — imports the canonical const, no independent duplication (contrast the sibling RBD pack's §6 finding, where a stale duplicate WAS a live bug — no equivalent issue exists in this module) |
| Onboarding link `status` (derived) | `used`, `expired`, `pending` | Computed inline, `msp-onboarding.ts:184` and `:192-256`'s own equivalent logic | Not a stored value anywhere — pure derivation from `usedAt`/`expiresAt`, computed identically in both places that need it (no drift risk since there is only one derivation site per route, not a shared duplicated constant) |

---

## 5. The forbidden list — declared, not merely absent

1. **No cross-MSP read.** `GET /api/msp/consent` and `GET /api/msp/onboarding/links` both scope by
   `mspId` off the JWT (`resolveMspIdStrict`/`req.user!.mspId`), never the request body or a query
   param — verified on both list routes, no exception.
2. **Every `:customerId` route re-verifies ownership.** All three of `msp-consent.ts`'s
   `:customerId` routes call `assertCustomerAccess(req.user!, customerId)` before touching the
   `tenants` row — confirmed on all three (§1.2, §1.4, §1.5), not just the read path.
3. **Revoke has a second, redundant ownership check.** `PATCH .../revoke`'s own `stampConsent`
   call additionally filters `eq(tenants.mspId, req.user!.mspId ?? -1)` on top of the
   already-passed `assertCustomerAccess` (§1.5) — belt-and-suspenders, same discipline the sibling
   RBD pack documents for its own library-layer re-checks.
4. **`consentInviteTokensTable.clientUserId` is never set by the MSP-scoped invite-link route.**
   Always `null` (§1.4) — this route mints an invite for a customer admin, never attributes it to
   a specific portal user, unlike the admin-tier route's optional `clientUserId`.
5. **`stampConsent` never silently no-ops.** Returns `false` (→ this pack's `404`) rather than a
   silent `200` when zero rows match — verified this pack's revoke route surfaces that `false`
   correctly (§1.5), not swallowed.

---

## 6. Honest-empty / partial-data contract

- **`GET /api/msp/consent`**: a tenant with no consent activity at all is **filtered out of the
  array entirely** (§1.1) — this is a real, load-bearing difference from the detail route (§1.2),
  which returns the same tenant with three explicit `null` grants. A caller cannot tell "this
  tenant doesn't exist in my book" from "this tenant exists but has never consented" using the
  list route alone; the detail route is required to distinguish the two.
- **`GET /api/msp/customers/:customerId/consent`**: no genuinely-empty success state beyond
  three independently-`null` grant keys — the row itself either resolves (ownership-checked) or
  404s.
- **`GET /api/msp/onboarding/links`**: zero links for an MSP is `[]` (§2a), not an error.
- **`POST .../consent/invite-link`**: no partial-success shape — either the token is minted and
  the full `{consentUrl, token, expiresAt, scopes}` returned, or one of the documented error
  statuses fires; no `207`-style partial response exists on this route.

---

## 7. Findings — filed

**#2818**, parented to #2563 (this Feature) per this build's standing rules, labeled `bug`:

1. **`adminEmail`/`adminDisplayName` silently dropped from every MSP-scope consent response**
   (§1.3) — real, stored `TenantConsentRecord` fields the admin tier already knows to splice back
   in for its own response but the MSP tier never does, for any of the three grant keys.
2. **No MSP-scoped route to initiate `writeBack` or `sharepoint` consent** (§1.4) — only the
   `graph` (read) invite-link flow was ported to MSP scope; an MSP operator can see and revoke all
   three grants but can only ever originate the first one. A real gap against #2563's own stated
   scope ("visibility **and management**"), not a hypothetical — the admin-only mint routes
   (`write-consent/start`, `sharepoint-consent/start`) exist and work, they simply have no
   MSP-scoped counterpart.

Both are real product gaps for the eventual MSP Console wire step to account for, not active
incidents — neither is `URGENT`.

---

## 8. Provenance

Written 2026-09-04 against `main` (branch `agent/2625-q1521`), for #2625 (Document step of #2563,
the Consent and Onboarding MSP Console Feature under #1571). Read in full, not sampled:
`msp-consent.ts` (260 lines), `msp-onboarding.ts` (724 lines, all 7 routes read to establish which
one is new and which are pre-existing context), plus the shared `consent.ts` helpers
(`stampConsent`, `consentRow`, `getCallbackUrl`, `CONSENT_REVOKE_KEYS`, `mergeConsentKey`) and the
admin-tier routes it's compared against throughout (`GET /admin/consent`, `PATCH
/admin/consent/:tenantId/revoke`, `POST /consent/invite-link`, `GET
.../write-consent/start`, `GET .../sharepoint-consent/start`), and `requireAuth.ts`'s
`assertCustomerAccess`/`requireRole`. Cross-referenced against the sibling customer-portal pack
(`docs/consent-and-onboarding-contract-pack.md`, #2758) and the sibling MSP-console pack
(`docs/risk-register-msp-console-contract-pack.md`, #2580) for format and cross-tier comparison.
Verified live against local PostgreSQL — `tenants.consent` and every `msp_onboarding_links` column
cited above confirmed to match the Drizzle source exactly.

Two real gaps found and filed as #2818 (§7). No orphaned-endpoint sub-issue filed — every
unconsumed endpoint is the expected pre-wire state (§0.1), confirmed by a real grep against the
current tree, not assumed. No product code, schema, or UI was changed by this pass.

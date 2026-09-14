# Azure Tenant Credential Self-Service (Portal) — contract extraction pack

**Issue:** #3962 (Phase 2: Contract pack), part of #3960 (Feature: Azure Tenant
Credential Self-Service (Portal)), part of #1485 (EPIC: Portal). Extracted, not
authored — every field below traces to one of the files listed, cited to file:line.
READ-ONLY session; no code changed producing this pack. #3961 (Phase 1: the real
endpoints) is closed and merged before this pack was written, per #1485's fixed order
(architect → build the endpoints → regenerate the contract pack → Design → wire).

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-azure-credential.ts` — the two real
  customer-facing endpoints this pack documents
- `artifacts/api-server/src/routes/admin-azure-credentials.ts` — the client-scoped
  admin pattern this route reuses (secret-naming convention, Key Vault write path);
  cited for context, not itself in scope for this Feature
- `artifacts/api-server/src/lib/azure-credential-expiry.ts` — `safeGetExpiry()`
- `artifacts/api-server/src/lib/azure-keyvault.ts` — `setSecretValue()`,
  `getSecretMetadata()`
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveSiblingUserIds()`
- `artifacts/api-server/src/middlewares/requireAuth.ts` — the auth gate both routes use
- `artifacts/api-server/src/routes/index.ts` (`portalAzureCredentialRouter`
  import/mount) and `artifacts/api-server/src/app.ts:127` (`app.use("/api",
  subscriptionGate, router)`) — real mount path
- `lib/db/src/schema/index.ts:1915-1933` — `azure_tenant_credentials` table
  definition (the real enum source)
- `lib/db/migrations/manual/0047_add_azure_tenant_credentials.sql` — the migration
  that added `client_user_id`, per #3960's own audit findings

No `artifacts/msp-portal` page or hook references this feature today — grepped for
`azure-credential`/`azureCredential`/`AzureCredential` across `artifacts/msp-portal/src`,
zero matches. This is genuinely new UI surface, not a wiring gap in something already
built — consistent with #3960's own "No customer-facing (Portal) route or UI exists for
this today" framing.

---

## 1. Wire contract

### `GET /api/portal/azure-credential`

`portal-azure-credential.ts:57-77`, gated by `requireAuth` (any authenticated portal
session — not role-restricted the way the admin route is `requireAdmin`-gated,
`admin-azure-credentials.ts:18` etc. — see §3 on auth scope). Resolves the caller's
full sibling-login set via `resolveSiblingUserIds(req.user!.id)`
(`portal-azure-credential.ts:59`, `tenant-signals.ts:174-183` — walks
`users.tenantId` to the shared customer/tenant, then every user row sharing it), then
selects the first `azure_tenant_credentials` row whose `clientUserId` is in that set
(`portal-azure-credential.ts:61-65`).

- **No credential registered:** `res.json(null)` — literal JSON `null`, HTTP 200
  (`portal-azure-credential.ts:67-70`). Not a 404.
- **Credential found:** returns the metadata-only view below, HTTP 200.
- **Failure (query or Key Vault expiry lookup throws):** HTTP 500,
  `{ "error": "Failed to fetch Azure credential" }` (`portal-azure-credential.ts:73-76`).

Response shape — `toPortalCredentialView()` (`portal-azure-credential.ts:36-50`), a
**deliberate explicit allow-list, never `...row`**, so no future schema column (and
never the Key Vault secret *name*, let alone its value) can leak into this
customer-facing response by accident:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `azure_tenant_credentials.id` (`index.ts:1916`) |
| `displayName` | `string` | not null | `azure_tenant_credentials.display_name` (`index.ts:1918`) |
| `tenantId` | `string` | not null | `azure_tenant_credentials.tenant_id` (`index.ts:1919`) — the customer's M365 tenant GUID, not this platform's own tenant concept |
| `clientId` | `string` | not null | `azure_tenant_credentials.client_id` (`index.ts:1920`) — the Azure AD **app registration's** client id, not a portal user id |
| `credentialType` | `"secret" \| "certificate"` | not null, defaults `"secret"` | `azure_tenant_credentials.credential_type` (`index.ts:1921`) |
| `expiresOn` | `string \| null` (ISO 8601) | nullable | `safeGetExpiry(row.keyVaultSecretName, log)` (`portal-azure-credential.ts:40`, `azure-credential-expiry.ts:34-45`) — live Key Vault secret-metadata read, **not a stored column**; returns `null` both when Key Vault reports no expiry set AND when the metadata fetch itself throws (logged as a `warn`, swallowed, never surfaces as a request failure) |
| `updatedAt` | `string` (ISO 8601, `Date` serialized over JSON) | not null | `azure_tenant_credentials.updated_at` (`index.ts:1927`) |

**Never returned, by design:** `keyVaultSecretName` (the row column that names the
Key Vault secret) and — always — the secret *value* itself, which never enters this
route at all; it lives only in Key Vault (`portal-azure-credential.ts:11-13`, doc
comment). `clientUserId`/`createdAt`/`lastExpiryAlertSentAt` are real columns on the
table (`index.ts:1917,1923,1926`) but are not part of this allow-list either — not
because they're sensitive, just not selected for this view.

### `POST /api/portal/azure-credential/rotate`

`portal-azure-credential.ts:87-141`, same `requireAuth` gate, same
`resolveSiblingUserIds` scoping. Request body:

| Field | Type | Required | Validation |
|---|---|---|---|
| `clientSecretValue` | `string` | yes | Rejected if missing or empty/whitespace-only after `.trim()` (`portal-azure-credential.ts:90`) |

Handler flow and every real response shape it can return:

1. **Missing/empty `clientSecretValue`** → HTTP 400,
   `{ "error": "clientSecretValue is required" }` (`portal-azure-credential.ts:90-93`).
2. **No credential row for any of the caller's sibling ids** → HTTP 404,
   `{ "error": "No Azure credential is registered for this account" }`
   (`portal-azure-credential.ts:103-106`).
3. **`existing.credentialType !== "secret"`** (i.e. the row is a `"certificate"`
   credential) → HTTP 400,
   `{ "error": "Only secret credentials can be rotated" }`
   (`portal-azure-credential.ts:108-111`). **Certificate credentials have no portal
   rotation path at all** — this is the only place that distinction surfaces to the
   caller.
4. **Key Vault write fails** (`setSecretValue` throws) → HTTP 502,
   `{ "error": "Failed to write secret to Key Vault — credential not rotated" }`
   (`portal-azure-credential.ts:118-128`). The row is **not** touched in this branch —
   rotation is Key-Vault-write-then-row-touch, not the reverse, so a failed KV write
   never leaves the row's `updatedAt` claiming a rotation that didn't happen.
5. **Success** → writes the new secret value **in place**, to the row's *existing*
   `keyVaultSecretName` (`portal-azure-credential.ts:117`, reusing the name the admin
   client-scoped route originally derived under the `client-${clientId}-appreg`
   convention — `admin-azure-credentials.ts:220` — never re-deriving, so rotation can
   never orphan the old secret under a different name), tagged
   `{ clientId: String(existing.clientUserId ?? existing.id), appClientId:
   existing.clientId, rotatedVia: "portal-self-service" }` (`portal-azure-credential.ts:119-123`,
   `azure-keyvault.ts:79-92` — merged with the fixed `managedBy: "shane-admin"` tag
   every `setSecretValue` call carries). Then updates only `updatedAt = new Date()`
   on the row (`portal-azure-credential.ts:130-134` — `displayName`/`tenantId`/`clientId`
   are untouched by rotation) and returns the same `toPortalCredentialView()` shape as
   the GET above, HTTP 200. **The new secret value is never echoed back.**
6. **Unhandled error anywhere else in the handler** → HTTP 500,
   `{ "error": "Failed to rotate Azure credential" }` (`portal-azure-credential.ts:137-140`).

---

## 2. CURRENT / DECIDED

| Field / capability | Status | Issue |
|---|---|---|
| `GET /api/portal/azure-credential` (view own metadata) | **CURRENT** | #3961 |
| `POST /api/portal/azure-credential/rotate` (rotate own secret) | **CURRENT** | #3961 |
| Metadata fields: `id`, `displayName`, `tenantId`, `clientId`, `credentialType`, `expiresOn`, `updatedAt` | **CURRENT** | #3961 |
| Secret value (view or echo-back) | **DECIDED — never exposed, by design.** Not a gap; #3960's own scope decision (Key Vault write-only, "Never displays the current secret value") | #3960 |
| Certificate-type credential rotation | **DECIDED — out of scope.** Route explicitly 400s; no certificate-rotation endpoint exists anywhere in this codebase today | — |
| Portal UI page/component | **MISSING — genuinely new work, not a wiring gap.** Zero references in `artifacts/msp-portal/src` (§0 above) | #3960 Phase 4 (UI build + wire), not yet filed with a real number as of this pack |
| Create/register a *new* credential from Portal (vs. admin creating the initial row) | **NOT BUILT.** No `POST /api/portal/azure-credential` (create) exists — only GET (read) and `/rotate` (update-in-place on an already-admin-created row). #3960's own body scopes Portal to "view status and rotate their own secret" only; creation stays admin-only (`admin-azure-credentials.ts:196`, `requireAdmin`) | #3960 (scope as written; flagged here as a real absence, not assumed) |
| Delete/unregister own credential from Portal | **NOT BUILT.** No portal-facing DELETE exists — only the admin route (`admin-azure-credentials.ts:278`, `requireAdmin`) | #3960 (out of stated scope; flagged) |

---

## 3. Auth scope — a real, notable difference from the admin route

The admin client-scoped routes are gated `requireAdmin`
(`admin-azure-credentials.ts:18,38,73,135,152,178,196,278`) — platform/MSP staff only.
The two portal routes documented here are gated only `requireAuth`
(`portal-azure-credential.ts:57,87`) — **any authenticated portal session**, admin or
client role alike; there is no `requireRole`/customer-tier check in either handler.
Access is scoped **by data, not by role**: both handlers filter to rows whose
`clientUserId` is in the caller's own `resolveSiblingUserIds()` set
(`tenant-signals.ts:174-183`), so an authenticated user literally cannot reach another
customer's row by id-guessing — the query itself never returns it — but nothing here
restricts *which* authenticated roles may call these two routes. This matches the
admin route's own equivalent read (`GET /admin/clients/:id/azure-credential`,
`admin-azure-credentials.ts:152`) in shape but not in gate.

Both routes also sit behind `subscriptionGate` at the app-mount level
(`app.ts:127` — `app.use("/api", subscriptionGate, router)`), same as every other
`/api/*` route; this pack does not re-derive `subscriptionGate`'s own rules, which are
out of scope for this Feature.

---

## 4. Real enum unions

Pulled directly from the Drizzle schema — no invented vocabulary:

- **`credentialType`** — `azure_tenant_credentials.credential_type`:
  `"secret" | "certificate"` (`lib/db/src/schema/index.ts:1921`), not-null, defaults
  `"secret"`. The portal `/rotate` route only accepts `"secret"` (§1, case 3); there is
  no code path anywhere that rotates a `"certificate"` credential value — Design
  should treat a `"certificate"` row as **view-only** on this surface, with no rotate
  affordance rendered, rather than a disabled/greyed rotate button (there is nothing
  behind it to eventually enable without new backend work).
- **No status/health enum on the row itself.** `expiresOn` is the only
  time-based signal (§1), and it's a live Key Vault read, not a stored column —
  "expiring soon" / "expired" / "healthy" is not a value the backend returns; any such
  badge Design wants would need to be derived client-side from `expiresOn` vs. `now()`,
  the same way the existing admin-side expiry-alert logic derives it
  (`azure-credential-expiry.ts:53-83`, `getExpiringAzureCredentials()` — not itself
  called by this portal route, cited only as the closest real precedent for how
  "expiring" is defined elsewhere: `EXPIRY_WARN_DAYS` cutoff, including already-expired
  as `daysLeft <= 0`).

---

## 5. Honest-empty contract

`GET /api/portal/azure-credential` returns literal JSON `null` (HTTP 200, not a 404 or
an empty object) when the customer has no credential registered yet
(`portal-azure-credential.ts:67-70`). A future UI wiring this endpoint must treat
`null` as its own real, distinct state — "no credential registered" — not conflate it
with a failed fetch (which is a thrown/non-200 response, handled separately by
whatever client-side fetch wrapper is written in Phase 4) or with a loading state.
There is no fixture/demo-data concept anywhere in this route; every field is a live DB
or Key Vault read, or explicitly absent as documented in §2.

---

## 6. Not covered by this pack

No `.dc.html` design export exists yet in `Design/portal/` for this Feature as of this
pack (checked; none found matching an azure-credential/self-service name) — per
#1485's own rule, Design is Phase 3, next in the fixed order, and this pack is its
input. This pack does not draw a page, and does not decide the create/delete gaps
noted in §2 beyond flagging them as real absences against #3960's stated scope.

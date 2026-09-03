# Data Rights and Privacy (MSP Console) — contract extraction pack

**#2631**, step 3 of **#2565** (Feature: Data Rights and Privacy (MSP Console)), under
**#1571** (EPIC: Portal Admin). Follows the **#1642 pattern**: per-surface wire contracts
extracted verbatim and cited to file:line, CURRENT vs DECIDED marked on every field, real
enum unions only, cross-surface edges, honest tri-state, forbidden list, orphaned endpoints
listed explicitly. Read-only — no product code, schema, or UI changed producing this pack.

**This is a different surface from `docs/data-rights-and-privacy-contract-pack.md`, not a
re-run of it.** That pack (#2549, under #1652) is scoped to the **customer-facing**
`artifacts/portal`'s `GET /api/portal/data-export` and `POST /api/portal/deletion-request`.
This pack is the **MSP-operator** counterpart #2565 asked for: the three real routes in
`msp-data-rights.ts` that read the same underlying `audit_logs` activity and let an MSP
admin file a deletion request on a customer's behalf. Both packs cite the shared
`lib/data-rights.ts` module; neither duplicates the other's field-by-field extraction of it.

Backend route file: `artifacts/api-server/src/routes/msp-data-rights.ts` (246 lines, all
three routes real).
Shared write logic (never duplicated, called by both this surface and the portal one):
`artifacts/api-server/src/lib/data-rights.ts` (170 lines).
Auth helpers: `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole`,
`assertCustomerAccess`, `resolveStaffScopedCustomerIds`.
Schema: `lib/db/src/schema/index.ts` (`audit_logs`, `users`), `lib/db/src/schema/msp.ts`
(`tenants`, `msp_staff_customer_scopes`).
Tests (real request/response fixtures, used to confirm shapes and status codes below):
`artifacts/api-server/src/routes/msp-data-rights.test.ts`.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03): `audit_logs` has
**1** row matching `action_type IN ('deletion_request_submitted','data_export_downloaded')`
— `data_export_downloaded`, `actor_role = 'client'` — and **0** `deletion_request_submitted`
rows, so `GET /msp/data-rights` returns one real activity row today, never a deletion
request, for the one real testbed MSP (`msp_id = 1`, 2 tenants). `msp_staff_customer_scopes`
has **0** rows — every MSP admin/operator today is unrestricted (`resolveStaffScopedCustomerIds`
returns `null`), so the staff-scoping narrowing in §1 and §5 is real, built code with no live
data yet exercising it.

---

## 0. What this surface is, and what it is not

**There is no dedicated "deletion-request queue" table.** Per `msp-data-rights.ts`'s own
header comment (`msp-data-rights.ts:9-15`), both the self-service portal flow and this
MSP-admin-initiated flow only ever write a fire-and-forget `audit_logs` row plus a one-time
admin notification email — there is no status/lifecycle field anywhere. This surface reads
that same `audit_logs` stream (bridged into the MSP's book) rather than inventing a parallel
table, and its one write action goes through the exact same `lib/data-rights.ts` helper the
customer-facing route uses — never a second, divergent code path.

**Not a general-purpose audit log viewer.** `GET /msp/data-rights` filters to exactly two
`action_type` values (`DATA_RIGHTS_ACTION_TYPES`, `msp-data-rights.ts:57`) — it is scoped
narrowly to data-export and deletion-request activity, nothing else in `audit_logs`.

**Not built yet, on the frontend.** `artifacts/msp-console` — the app these routes are meant
to serve — does not exist (confirmed via direct `ls artifacts/`: `admin-panel`, `api-server`,
`mcp-server`, `msp-website`, `portal`, `shane-mccaw-consulting` — no `msp-console`). No
`.dc.html` export exists under `Design/msp-console/` for this surface either (checked
2026-09-03, directory itself is absent). §0.1 below is the honest orphaned-consumer picture
for that reason — matching the same state `docs/sops-msp-console-contract-pack.md` (#2595)
found for its own MSP-console routes.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/data-rights` | GET | `msp-data-rights.ts:94-151` | **Nothing found** — no route, test, mcp-server tool, or frontend calls it besides its own test file | **Yes** |
| `/api/msp/data-rights/customers/:customerId/users` | GET | `msp-data-rights.ts:157-181` | **Nothing found** | **Yes** |
| `/api/msp/data-rights/customers/:customerId/deletion-request` | POST | `msp-data-rights.ts:189-243` | **Nothing found** | **Yes** |

**Root cause, same one already tracked project-wide:** no `msp-console` frontend and no
`Design/msp-console/` export exist yet to wire against (#1680, closed as superseded —
scaffolding is itself the first real piece of work needed before any of these three routes
gets a real caller). All three routes are otherwise finished, tested (`msp-data-rights.test.ts`,
11 passing cases across both endpoints' auth/scoping/validation paths), and mounted
(`routes/index.ts:214,550`) — genuinely CURRENT backend, zero live UI traffic.

---

## 1. Wire contract

### `GET /api/msp/data-rights` (`msp-data-rights.ts:94-151`, `requireRole("MSPAdmin")`)

Query param: `limit` (optional, integer, clamped `[1, 200]`, default `50` —
`msp-data-rights.ts:114`, `DEFAULT_LIMIT`/`MAX_LIMIT` at `:58-59`). No body.

**Auth failure** — no/invalid/expired token: `401` shapes from `requireAuth` (see
`requireAuth.ts:102`, `152`), before the handler runs. **Below `MSPAdmin`** (including
`MSPOperator`, confirmed by `msp-data-rights.test.ts:140-145` — this route is one of the few
gated stricter than the `MSPOperator+` default): `403 { "error": "Insufficient privileges —
MSPAdmin or above required" }` (`requireAuth.ts:215-217`).

**403** — `resolveMspIdStrict(req)` returns `null` (no MSP context on the JWT):
`{ "error": "MSP context required" }` (`msp-data-rights.ts:98`).

**500** — any query throws: `{ "error": "Unable to load data-rights activity right now.
Please try again shortly." }` (`msp-data-rights.ts:149`), logged via `log.error` on channel
`tenant.portal` (`msp-data-rights.ts:53` — see §7 for why this channel, not a
`tenant.*`/`msp.*` leaf specific to this route, is a finding).

**200**: `{ "requests": [...] }`. **Empty array, not an error**, whenever the caller's MSP
has zero users bridged into a customer tenant (`msp-data-rights.ts:109-112`) — no query is
even issued in that case.

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `audit_logs.id` |
| `actionType` | `"deletion_request_submitted" \| "data_export_downloaded"` | `audit_logs.action_type`, filtered to exactly these two values |
| `submittedByAdmin` | `boolean` | `audit_logs.actor_role === "admin"` |
| `submittedByName` | `string \| null` | `audit_logs.actor_name` |
| `customerId` | `number \| null` | bridged via `loadCustomerBridge` (below) from `audit_logs.client_id` |
| `customerName` | `string \| null` | same bridge, `tenants.customer_name` |
| `currentSchema` | `object \| null` | for `deletion_request_submitted` rows only: `metadata.currentSchema` off `audit_logs.metadata` (jsonb); **always `null` for `data_export_downloaded` rows**, even if the metadata happened to carry one (`msp-data-rights.ts:141`) |
| `createdAt` | `string` (ISO) | `audit_logs.created_at.toISOString()` |

**The customer bridge** (`loadCustomerBridge`, `msp-data-rights.ts:74-90`): `users.id ->
{ customerId: users.tenant_id, customerName: tenants.customer_name }`, inner-joined to
`tenants` and filtered to `tenants.msp_id = mspId`. Deliberately an **inner** join, not
`leftJoin` — a user with no `tenant_id` bridges to nothing and is correctly excluded, not
surfaced with a null customer (the function's own comment at `msp-data-rights.ts:61-73`
explains why: `audit_logs` is keyed by `users.id`/`client_id`, which carries no `msp_id` of
its own since #92, so the MSP scope has to come off the tenant row via this bridge, not off
`users.mspId` directly).

**Staff scoping**: `resolveStaffScopedCustomerIds(req.user!)` — `null` means unrestricted
(every bridged customer eligible); a non-null array narrows `eligibleUserIds` to only users
whose bridged `customerId` is in that set (`msp-data-rights.ts:105-107`). Confirmed real
today: `msp_staff_customer_scopes` has 0 rows for this environment, so every MSPAdmin caller
is currently unrestricted — the scoped path (`msp-data-rights.test.ts:185-198`) is real,
tested code with no live row exercising it yet.

### `GET /api/msp/data-rights/customers/:customerId/users` (`msp-data-rights.ts:157-181`, `requireRole("MSPAdmin")`)

Path param `customerId` (integer). No query params, no body.

**400** — `customerId` isn't a valid integer: `{ "error": "Invalid customerId" }`
(`msp-data-rights.ts:161`).

**403** — `assertCustomerAccess(req.user!, customerId)` returns `false` (customer not in the
caller's MSP book, or the caller is a staff-scoped admin without that customer assigned):
`{ "error": "Not authorized for this customer" }` (`msp-data-rights.ts:167`).

**500** — any query throws: `{ "error": "Unable to load customer users right now. Please try
again shortly." }` (`msp-data-rights.ts:179`).

**200**: `{ "users": [{ "userId": number, "name": string | null, "email": string, "isActive":
boolean }] }` — every row in `users` with `tenant_id = customerId` (`msp-data-rights.ts:171-176`),
no filtering by active/inactive; a caller must apply that filter itself if it only wants
active users. Purpose stated in the route's own comment (`msp-data-rights.ts:154-155`): lets
an admin pick which of a customer's (possibly multiple) team members a deletion request
applies to.

### `POST /api/msp/data-rights/customers/:customerId/deletion-request` (`msp-data-rights.ts:189-243`, `requireRole("MSPAdmin")`)

Path param `customerId` (integer). Body: `{ "userId": number }`.

**400** — invalid `customerId`: `{ "error": "Invalid customerId" }` (`msp-data-rights.ts:193`).
**400** — `body.userId` missing or not an integer: `{ "error": "userId is required" }`
(`msp-data-rights.ts:205`) — checked **after** the `assertCustomerAccess` check below, so a
caller without access to the customer gets 403 even with a malformed body
(`msp-data-rights.test.ts:224-232`'s own mock ordering confirms this: the assertCustomerAccess
lookup runs before the 400).

**403** — `assertCustomerAccess` false: `{ "error": "Not authorized for this customer" }`
(`msp-data-rights.ts:199`).

**404** — the target `userId` exists but is not linked to `customerId` (i.e. no row in
`users` with both `id = userId` AND `tenant_id = customerId`, `msp-data-rights.ts:212-216`):
`{ "error": "That user is not linked to this customer" }` (`msp-data-rights.ts:218`). This is
a genuinely distinct guard from `assertCustomerAccess` — it prevents an admin who has access
to customer A from filing a deletion request against some arbitrary `userId` that actually
belongs to a *different* customer, even one inside the same MSP (`msp-data-rights.ts:209-211`'s
own comment states this explicitly).

**404 (second, different body)** — the shared helper itself can't find the user by the time
it runs (a genuine TOCTOU race, since the link-check above and the helper's own lookup are two
separate queries): `{ "error": "Target user not found" }` (`msp-data-rights.ts:230`, when
`submitAdminInitiatedDeletionRequest` returns `{ error: "user_not_found" }`,
`data-rights.ts:164`).

**500** — any other thrown error: `{ "error": "Failed to submit deletion request" }`
(`msp-data-rights.ts:241`).

**200**: `{ "ok": true, "message": "Deletion request recorded on the customer's behalf. It
will be processed within 30 days per the standard retention policy; signed contracts and
invoices are retained for 7 years as required by law.", "currentSchemaSummary": <object> |
null }` — the literal, final response string (`msp-data-rights.ts:234-238`). **This message
text differs from the customer self-service route's own 200 message** (§5 below) — both say
"30 days" and "7 years" but are worded differently; not a drift bug, since one is written to
an MSP admin and the other to the customer directly, but worth knowing if a future UI ever
shows both side by side.

The handler calls `submitAdminInitiatedDeletionRequest(targetUserId, customerId, { actorRole:
"admin", actorUserId: actorUser.id, actorName: actorUser.name ?? actorUser.email ?? \`user
${actorUser.id}\` })` (`msp-data-rights.ts:223-227`), which is the exact same
`lib/data-rights.ts` code path documented in full by §1 of the portal-side pack
(`docs/data-rights-and-privacy-contract-pack.md:111-146`) — repeated here only at the level
of what this route's own response surfaces, not re-extracted field-by-field.

---

## 2. CURRENT / DECIDED

| Field / action | Status | Issue |
|---|---|---|
| `GET /msp/data-rights` — activity feed (all 7 response fields) | **CURRENT** | — |
| `GET /msp/data-rights/customers/:customerId/users` | **CURRENT** | — |
| `POST /msp/data-rights/customers/:customerId/deletion-request` | **CURRENT** | — |
| Staff-scoped-admin narrowing (`resolveStaffScopedCustomerIds`) on all three routes | **CURRENT**, built and tested, but **no live scope rows exist** in this environment today (0 rows in `msp_staff_customer_scopes`) | — |
| Deletion-request lifecycle / status tracking on this surface | **DOES NOT EXIST BY DESIGN** — same as the portal-side pack's finding; `audit_logs` is the only record, fulfillment is manual (`msp-data-rights.ts:9-15`) | see §6 |
| `docs/runbooks/data-subject-rights.md` (cited by `msp-data-rights.ts:15` and by the admin email `data-rights.ts:129` builds) | **File does not exist in this repo** — same stale reference already filed against #1652 (see §7) | already filed, not re-filed here |
| An `artifacts/msp-console` frontend page consuming any of these three routes | **DOES NOT EXIST** | tracked at the Feature level (#2565), blocked on the MSP-console scaffolding (#1680, closed as superseded) |

---

## 3. Real enum unions

- **`audit_logs.action_type`** — plain `text`, no DB enum constraint. This surface's own
  code enumerates the only two values it ever filters on or writes:
  `DATA_RIGHTS_ACTION_TYPES = ["deletion_request_submitted", "data_export_downloaded"]`
  (`msp-data-rights.ts:57`) — identical vocabulary to the one already documented in
  `docs/data-rights-and-privacy-contract-pack.md:180-185`.
- **`audit_logs.actor_role`** — `"admin" | "client"` (`lib/db/src/schema/index.ts:1394`).
  This route's `submittedByAdmin` boolean is a direct derivation of this field
  (`actorRole === "admin"`), not a separate stored value.
- **`DeletionRequestActor.actorRole`** (`lib/data-rights.ts:34`) — the same `"client" | "admin"`
  union, at the TypeScript call-site level; this route always passes `"admin"`
  (`msp-data-rights.ts:225`), never `"client"`.

No other enum-shaped field is exposed by this surface — `customerId`/`customerName`/
`userId`/`name`/`email`/`isActive`/`createdAt` are all plain scalar columns, not
vocabularies.

---

## 4. Honest-empty contract

**No fixture fallback anywhere in this backend surface.** `GET /msp/data-rights` returns a
genuinely empty `requests: []` in two distinct real cases, not one: (a) the caller's MSP has
zero users bridged into any tenant (`msp-data-rights.ts:109-112`, no query even runs), and
(b) the caller's MSP has bridged users but none of them have a matching `audit_logs` row yet
— true for this very environment today (1 real row total, for a different customer than most
of this MSP's book). Both are real `200 { requests: [] }`, never a placeholder row.
`GET .../users` returns a genuinely empty `users: []` for a customer with zero linked portal
accounts — no query short-circuit, the `WHERE tenant_id = customerId` simply matches nothing.

---

## 5. Cross-surface: shared deletion-request logic

Restated from the portal-side pack (`docs/data-rights-and-privacy-contract-pack.md:213-243`)
at the level this pack's own routes touch it, not re-derived:

`lib/data-rights.ts` is the single place the `audit_logs` write + admin notification email
are built, called from two entry points that must never drift from each other:

- `submitSelfServiceDeletionRequest` — the customer-facing `POST /api/portal/deletion-request`,
  actor is the customer themselves (`actorRole: "client"`).
- `submitAdminInitiatedDeletionRequest` — **this pack's**
  `POST /api/msp/data-rights/customers/:customerId/deletion-request`, actor is the MSP admin
  (`actorRole: "admin"`), but the audit row's `clientId` still points at the customer's own
  `users.id`, so both paths bridge into `GET /msp/data-rights`'s activity feed identically
  (`msp-data-rights.ts:18-26`'s own header states this explicitly).

`GET /api/msp/data-rights` (this pack's own §1) is therefore the MSP-facing read of the exact
same `audit_logs` rows the portal-side `POST` writes — every deletion request a customer
submits via self-service is visible to their MSP here as a real row, not a private/portal-only
record, and vice versa for an admin-initiated one.

**Real overlap already flagged by the portal-side pack, unaffected by this one:** #1604
(Account Security) covers the same two shared endpoints from a different customer-facing page;
that overlap is between #1652 and #1604, not this MSP-console surface — this pack's three
routes have no equivalent duplicate anywhere else in the codebase.

---

## 6. The forbidden list — what this backend deliberately does not serve

- **No deletion-request status/lifecycle for an MSP admin to track fulfillment.** An admin who
  files a request via this surface's `POST` has no way to mark it "processed" or see how many
  days remain in the 30-day window — the only record is the `audit_logs` row itself, with no
  status column.
- **No pagination beyond `limit`.** `GET /msp/data-rights` has no `offset`/cursor — a caller
  wanting activity older than the newest `limit` (max 200) rows genuinely cannot page further
  back through this endpoint.
- **No filtering by customer, action type, or date range on `GET /msp/data-rights`.** The
  route accepts exactly one query param (`limit`); an admin wanting "just this customer's
  activity" must filter the returned array client-side.
- **No bulk deletion-request action.** `POST .../deletion-request` accepts exactly one
  `userId` per call — there is no way to file requests for a customer's entire user base in
  one request.
- **No automatic data erasure**, same as the portal-side surface — this route only records
  that a request happened; erasure remains a manual, out-of-band process per the (missing)
  runbook.

---

## 7. Findings — filed, not fixed in this pack (read-only session)

- **`docs/runbooks/data-subject-rights.md` still does not exist**, and this surface's own
  route file cites it a second time (`msp-data-rights.ts:15`, "the full procedure") beyond the
  citations already filed against #1652. Not re-filed as a new issue — it is the exact same
  gap, already tracked (see the portal-side pack's own §7); noting the second citation here
  only for completeness, since this pack's own audit trail should show it was checked, not
  independently re-discovered.
- **All three routes in this surface are genuinely orphaned** (§0.1) — real, tested,
  finished backend with zero live callers, because the `msp-console` frontend they're built
  for does not exist yet. This is not a code defect to fix; it is the expected, honest state
  for a Feature at the "regenerate the contract pack" step, ahead of a frontend that hasn't
  been scaffolded. No new issue filed for this — it is exactly what #2565's own body already
  states ("Not yet architected... `artifacts/msp-console` doesn't exist yet").
- **`log.error` on this route uses channel `tenant.portal`** (`msp-data-rights.ts:53`), the
  same channel the customer-facing `portal-privacy.ts` uses, even though this route lives
  entirely on the MSP-operator side and has no `tenant.*` reads of its own beyond the bridge
  query. Not filed as a separate finding — flagged here for whoever eventually wires this
  surface, since `logger.child({ channel })` binds once at module scope
  (`msp-data-rights.ts:53`) and a future edit to this file should consider whether
  `tenant.msp` or an `msp.*` leaf channel fits this surface's own logs better than the
  customer-facing one it currently shares.

---

## Not covered by this pack

- The customer-facing `GET /api/portal/data-export` / `POST /api/portal/deletion-request`
  field-by-field extraction — fully covered by `docs/data-rights-and-privacy-contract-pack.md`
  already; not repeated here.
- Any `msp-console` frontend page or Design export for this surface — neither exists yet
  (§0); wiring is out of scope until the scaffolding Feature work happens.
- The manual fulfillment procedure an operator actually runs within the 30-day window — that
  lives in the (missing) runbook, not in any wire contract.

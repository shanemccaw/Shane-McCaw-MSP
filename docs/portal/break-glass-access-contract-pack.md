# Break-glass Access — contract extraction pack

**Issue:** #2628 (Break-glass Access: regenerate the contract pack from the
finished backend), part of Feature #2564 ("Feature: Break-glass Access (MSP
Console)"), under EPIC #1571 (Portal Admin — MSP-side operator surface).
Superseding, wholesale, the previous version of this file (written under
#2443, part of Feature #1651 "Feature: Break-glass Access (Portal)" / EPIC
#1485). Method per #1642. Extracted, not authored — every field below traces
to one of the files listed, cited to file:line. READ-ONLY session; no code
changed producing this pack.

**Why this regeneration exists.** The prior pack (#2443, 2026-09-02ish)
covered only the five customer-facing `/portal` and `/public` endpoints in
`break-glass-verification.ts`. Since then, #2675 built the real MSP-side
(operator) routes — `msp-break-glass.ts`, zero of which existed before —
and, in the same change, extracted the admin-override reset logic out of the
portal route into a shared `performBreakGlassAdminOverride()` so both
surfaces call exactly one implementation of a security-sensitive credential
reset. That refactor moved line numbers for §2.6 below and is the reason
this pack is regenerated rather than merely appended to (the #1642 rule:
prior art is prior art, extract fresh against the current file).

**No design surface exists yet for either side.** No `.dc.html` export for
this Feature is present under `Design/portal/`, and no page in
`artifacts/portal` or `artifacts/msp-console` calls any break-glass endpoint
(confirmed by grep against both trees — see §9). Per the fixed
architect → build → pack → Design → wire order, this pack is the "regenerate
the contract pack" step for both surfaces, extracted purely from the real
backend.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/break-glass-verification.ts` — the five
  customer-facing/public HTTP endpoints, mounted at `/api` via
  `app.use("/api", router)` (`app.ts:112`); also the two exported helpers
  both surfaces now share, `resolvePendingContext()` (`:163-191`) and
  `performBreakGlassAdminOverride()` (`:784-906`)
- `artifacts/api-server/src/routes/msp-break-glass.ts` — the four MSP
  operator-side HTTP endpoints (#2675), registered in
  `routes/index.ts:131,463`
- `artifacts/api-server/src/lib/workflow-executor.ts` — the
  `break_glass_verification_gate` node handler (creates the pending secret,
  pauses the run) and the `purge_orphaned_generated_secrets` backstop node
- `artifacts/api-server/src/lib/config-pack-graph.ts` — how a gated Config
  Pack template splices this gate into a run's node graph
- `artifacts/api-server/src/lib/config-pack-orchestrator.ts` — how a pack run
  seeds the gate's input payload (`GATE_SECRET_FIELD`,
  `generateStrongPassword()`)
- `artifacts/api-server/src/lib/generated-secret-store.ts` — Key Vault store
  the plaintext actually lives in (#1911); `secretRef` on the pending-secret
  row is the pointer, not the value
- `artifacts/api-server/src/lib/secret-crypto.ts` — the gate's own encrypted
  fallback copy (`encryptedValue`), for rows predating #1911
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireAuth`,
  `requireRole`, `assertCustomerAccess`, `resolveStaffScopedCustomerIds`,
  the `ROLE_ORDER` hierarchy (`:80-93`)
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict`
  (`:75-77`)
- `lib/db/src/schema/msp.ts:3999-4088` — the three real tables
  (`break_glass_pending_secrets`, `break_glass_verification_attempts`,
  `break_glass_override_audit`) and their real enum unions

---

## 1. What "break-glass access" actually is on this platform

Not a standing emergency-admin account a customer manages themselves. It is a
**one-time credential handoff gate inside the Workflow Engine**: a Config Pack
(or any workflow) that needs to write a break-glass admin account's password
pauses at a `break_glass_verification_gate` node until a real, tenant-proven
human on the *customer's own* Microsoft 365 tenant claims it — proven live via
a Microsoft OAuth sign-in that must resolve to an ACTIVE Global Administrator
directory role (or that role's PIM-eligible-but-not-active state), not by
anything the caller's browser session types in. The plaintext credential is
revealed exactly once, server-rendered, and purged from storage the moment the
winning recipient acknowledges it.

Two distinct consumers of this same backend exist:

- **Customer/portal side** (§2) — the recipient invite flow, a status read for
  whoever kicked off the Config Pack run, and the public OAuth reveal itself.
- **MSP console/operator side** (§3, new in this pack) — an MSP staff member's
  cross-tenant view of pending secrets across their whole book, per-customer
  history/detail/audit, and the same admin-override escape hatch, gated by a
  stricter role floor.

Neither side has a UI yet — both are backend the Feature can be designed
against.

---

## 2. Wire contract — customer/portal + public endpoints

### 2.1 `POST /api/portal/break-glass/:pendingSecretId/invite` (`requireAuth`)

`break-glass-verification.ts:383-407`. Customer-side "send verification
invites" action — the entry point a portal page would call.

Request body (`z.object({ emails: z.array(z.string().email()).min(1).max(5) })`,
`:387`):

| Field | Type | Constraint |
|---|---|---|
| `emails` | `string[]` | 1–5 valid email addresses |

Auth: `assertCustomerAccess(req.user!, ctx.secret.customerId)` (`:394`) — any
role with access to that customer (PlatformAdmin, or MSPAdmin/MSPOperator
scoped to the tenant's own MSP; see §5). **Both "not found" and "not yours"
return a bare 404** (`:393`, `:395`) — the route never confirms a
`pendingSecretId` exists to a caller who shouldn't see it.

Preconditions enforced server-side, not just documented: `ctx.secret.status`
must be `"pending_delivery"` (`:397-399`), else `409`. And (Git #4041)
`credential_uncertain_at` must be null, else `409` with
`{ error: CREDENTIAL_UNCERTAIN_ERROR, detail: "credential_uncertain" }` — the last
admin-override on this row may have changed the tenant credential without
recording a replacement (§2.6), so the operator is told to run the admin-override
again before inviting anyone. No attempt row is written and no email is sent.

Response (`:402`):

| Field | Type | Source |
|---|---|---|
| `ok` | `true` | literal |
| `invited` | `number` | `body.data.emails.length` — how many were requested |
| `sent` | `number` | how many actually succeeded (`sendBreakGlassInvites`'s return; see §4) |

`invited` and `sent` can legitimately differ — a per-recipient mail failure is
logged and skipped, not fatal to the request (`sendBreakGlassInvites`,
`:199-231`).

### 2.2 `GET /api/portal/break-glass/by-run/:runId` (`requireAuth`)

`break-glass-verification.ts:416-471`. Status read for the Portal's
pack-execution surface — scoped by `runId`, not `customerId` (the caller is
already looking at one specific run). **Never returns `linkToken` or the
encrypted secret** — a status read for the initiator, not a delivery surface
(`:409-415`).

Auth: resolves `customerId` from `wfRunsTable.payload.customerId` (the gate
preserves this field — see §5), then `assertCustomerAccess` (`:430`). 404 for
both "run not found" and "not yours" (`:429-431`).

Response — one of two shapes:

- **Not currently at a live break-glass pause** (`:445-447`): `{ "pending":
  false }`. This covers three real, distinct states collapsed into one
  boolean: the run never reached this gate, the run is paused for a
  *different* reason, or the secret has already reached a terminal status
  (`delivered_purged` / `superseded_by_reset`). The route does not
  distinguish these for the caller — a design surface wanting to tell them
  apart needs a different read.
- **Pending** (`:461-466`):

| Field | Type | Source |
|---|---|---|
| `pending` | `true` | literal |
| `pendingSecretId` | `number` | `secret.id` |
| `status` | `"pending_delivery"` | `secret.status` (only value reachable here — see §6 enum) |
| `credentialUncertainAt` | `Date` (ISO string over the wire) `| null` | `secret.credentialUncertainAt` (Git #4041) — non-null while invites and reveals refuse pending a re-run admin-override (§2.6). Also served on `GET /api/portal/break-glass` handoffs and on the MSP console list/detail reads (§3.1, §3.3) |
| `attempts` | array | see below |

Each `attempts[]` row (`:451-456`):

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `breakGlassVerificationAttemptsTable.id` |
| `invitedEmail` | `string` | the recipient this attempt was issued to |
| `linkStatus` | `"pending" \| "consumed" \| "expired" \| "superseded"` | real enum, §6 |
| `verificationOutcome` | `"success" \| "role_not_active_pim_eligible" \| "role_absent" \| "expired" \| "superseded" \| null` | real enum, §6; `null` until the recipient has actually attempted the link |
| `attemptedAt` | `Date` (ISO string over the wire) `\| null` | set only once an attempt is made |

Ordered `desc(createdAt)` (`:459`) — most recent invite first.

### 2.3 `GET /api/public/break-glass/verify/:token` (public, rate-limited)

`break-glass-verification.ts:476-529`. Not a JSON API — a server-rendered HTML
redirect page the invited recipient's browser lands on from the emailed link.
Validates link status/TTL, then 302-redirects into a tenant-scoped Microsoft
OAuth authorize URL (`:517-524`) built with `MT_APP_WRITE_CLIENT_ID` and a
signed `state` (HMAC-tied back to the link token, `:89-92`) so the callback
can't be replayed against a different attempt. No portal-facing JSON contract
to design against here — this is the OAuth hop, not a UI surface.

Git #4041: when the link's pending secret carries `credential_uncertain_at`, the
page answers `409` ("This credential cannot be delivered right now") **before**
any redirect to Microsoft, and the link is set `superseded`. Retiring it is
deliberate: a pending or consumed link counts as live to admin-override's
precondition (§2.6), so leaving it would block the one action that resolves the
uncertainty. The recovery override re-invites every prior recipient.

Rate-limited: 60 requests / 15 min per the shared `publicLimiter`
(`:105-111`).

### 2.4 `GET /api/public/break-glass/verify/callback` (public, rate-limited)

`break-glass-verification.ts:534-693`. The OAuth callback. Exchanges the auth
code exactly once (`:564`), reads `/me` and `/me/transitiveMemberOf` via the
delegated token, and checks for an ACTIVE eligible directory role
(`ELIGIBLE_ROLE_TEMPLATE_IDS`, currently only Global Administrator's template
id `62e90394-69f5-4237-9190-012177145e10`, `:70-72`). Also server-rendered
HTML, not JSON — same "no portal contract" note as §2.3. The reveal-once
credential page this produces on success (`:638-647`) is a plain HTML form
POSTing to §2.5; it is not meant to be embedded in the portal SPA.

Routing (Git #4076, fixed with #4041): §2.3's `verify/:token` route is registered first,
so until the fix Microsoft's redirect to `verify/callback` was answered by it as token
`"callback"` with a 410. Nothing below this line had ever run. `:token` now passes
`"callback"` through with `next()`. A real Global Administrator sign-in through this
handler is still unverified; see #4076.

Git #4041: a pending secret carrying `credential_uncertain_at` is refused with the
same `409` page as §2.3, checked **before** the code exchange (no sign-in is spent,
the link is not consumed) and retired to `superseded`. The check is repeated after
the claim, on the re-read secret row; if an override marked the row in between, the
claimed link is retired the same way and nothing is revealed.

Race handling for two simultaneous winners: an atomic conditional UPDATE
(`WHERE linkStatus = 'pending'`, `:589-592`) inside a transaction claims the
attempt; a second concurrent callback sees 0 rows affected and is told (409)
someone else already won (`:605-608`).

### 2.5 `POST /api/public/break-glass/:pendingSecretId/acknowledge` (public, rate-limited)

`break-glass-verification.ts:698-772`. The winning recipient's explicit "I
have saved it" click. Body: `{ linkToken: string }` (form-encoded, from the
reveal page's hidden field, `:645`). Also HTML, not JSON — a form POST target,
not a portal API call.

On success: purges the Key Vault copy (`:740`), sets `status:
"delivered_purged"`, empties `encryptedValue`, stamps `deliveredAt` /
`deliveredToEmail` (`:741-743`), and fires `resumeWorkflowRun` for the paused
run via `setImmediate` (fire-and-forget, non-fatal on failure — `:750-759`).

### 2.6 `POST /api/portal/break-glass/:pendingSecretId/admin-override` (`requireAuth`)

Two parts now, since #2675's refactor split them:

- **Route handler**, `break-glass-verification.ts:911-947` — validates the
  request, resolves auth, then delegates the actual reset.
- **Shared implementation**, `performBreakGlassAdminOverride()`,
  `break-glass-verification.ts:796-906` — the ONE implementation of this
  security-sensitive flow, exported specifically so `msp-break-glass.ts` can
  call the exact same code path (§3.4) rather than a second copy.

The "every link is dead-ended, force a reset" escape hatch a portal admin
surface would call.

Request body (`:915-918`, unchanged from before the refactor):

| Field | Type | Constraint |
|---|---|---|
| `reason` | `string` | required, non-empty (audit trail — see §6) |
| `emails` | `string[]` | optional, 1–5; if omitted, re-invites the prior recipient set (`:900-901` in the shared function) |

Auth (still enforced only by the **route handler**, not the shared function —
see §5's "callers own their own auth" note): role must be `PlatformAdmin`,
`MSPAdmin`, or `MSPOperator` (`:926-927`, via `effectiveRoleOf`) *and*
`assertCustomerAccess`, else 404 (`:928-930`).

Preconditions, enforced inside `performBreakGlassAdminOverride()` — identical
regardless of which caller invokes it:

- `ctx.tenantId` must be configured else 409 (checked before the claim)
- **the claim** (Git #4040) — a conditional
  `UPDATE break_glass_pending_secrets SET status = 'reset_in_progress',
  reset_claim_token = <random>, reset_claimed_at = now() WHERE id = :id AND
  status = 'pending_delivery' RETURNING id`. Zero rows → 409 before the store or
  the tenant is touched: `detail: "override_in_progress"` when another override
  holds the row, otherwise `"This secret is not awaiting delivery"`. This is the
  mutual exclusion: before it, the status was checked on the row read before the
  call, so two concurrent overrides (a double-click, or the portal and MSP
  console routes together) both reset the tenant and both inserted a deliverable
  replacement. Live-reproduced and live-verified closed on
  `zz-test-graphwrite-01`. A `reset_in_progress` claim older than
  `BREAK_GLASS_OVERRIDE_CLAIM_STALE_MS` (15 min) was left by a process that died
  mid-override and may be taken over. **Every refusal below hands the claim back**
  (`reset_in_progress` → `pending_delivery`, conditional on the claim token).
  Git #4041: the same claim statement sets
  `credential_uncertain_at = coalesce(credential_uncertain_at, now())`. From the
  claim until a replacement is recorded, the credential on this row may stop being
  the tenant's password, and only a marker written before the reset survives a
  process that dies between the reset and the record (its stale claim is then taken
  over with the marker still set). A definite hand-back restores the marker to its
  value before the claim; an uncertain one (`outcome_unknown`,
  `replacement_unrecorded`) keeps it. While it is set, invite (§2.1) and reveal
  (§2.3, §2.4) refuse.
- **every existing verification attempt for this secret must be terminal**
  (`expired` or `superseded`), read under the claim — an admin cannot override
  while a link is still live, and the invite route refuses a row that is not
  `pending_delivery`, so no new link can appear after this check
- the pending-secret row must record the account to reset —
  `break_glass_pending_secrets.break_glass_account_id`, written by the gate at
  insert (§4) — else 409. Until #4015 this was read from
  `wf_runs.payload.breakGlassAccountId`, which persistence redaction had turned
  into `"[redacted]"`, so every override reset `/users/[redacted]` and failed 502.
  The replacement row the override inserts carries the same account id forward.

In order (Git #4029 — everything that can refuse runs **before** the one
irreversible step, the tenant reset):

1. **Store configured?** `generatedSecretStoreConfigured()` false → `503`, the
   tenant credential is not changed (fail-closed, no DB-only fallback).
2. **Store the replacement first** via `storeGeneratedSecret()`. A store that
   throws (vault unreachable, RBAC, throttling) → `503`, tenant not changed.
   Key Vault has no rename and none is needed: the secret name is random, and
   the binding is the DB row written in step 4.
3. **Reset** the tenant account's password via `graphWriteForTenant` PATCH
   (real write-back gate).
   - Definite refusal (any 4xx result, or a thrown write-back/consent gate
     error) → the provisional vault copy is purged; `502` with `errorType` in
     `detail` (gate errors still propagate as thrown errors, see below).
   - No definite answer (a 5xx, or a transport error after the request may
     have left) → the vault copy is **kept** (it may be the only copy of a live
     password; it expires with the store TTL), the old row is left
     overridable **and keeps `credential_uncertain_at`** (Git #4041), so it cannot
     be invited or revealed until the override is run again; `502` with
     `detail: "outcome_unknown"`.
4. **Record**: supersede the old pending-secret row, insert the new one plus an
   audit row, in one transaction. The supersede is conditional on this call's
   claim (`status = 'reset_in_progress' AND reset_claim_token = <its token>`);
   if a stale takeover means the claim is gone, the transaction rolls back and
   the answer is `500` with `detail: "claim_lost"` (vault copy kept). On any
   other failure it is retried once (after checking
   the failed attempt did not in fact commit, by `secret_ref->>'secretName'`).
   If the retry fails too → `500` with `detail: "replacement_unrecorded"`; the
   vault copy is **not** purged and the claim is handed back so the old row is
   overridable, so running the override again issues a recorded credential. The
   hand-back keeps `credential_uncertain_at` (Git #4041). A successful record
   clears it on the superseded row in the same transaction; the replacement row
   starts unmarked.
5. Purges the old row's now-orphaned vault copy, fires the repeated-override
   alert if this is the 2nd+ override in 24h (see §7), and re-issues invites.
   **Does not resume the run** — it stays paused until the new secret is
   separately acknowledged.

Live-verified on `zz-test-graphwrite-01` by
`break-glass-admin-override.live-verify.ts`; branch-by-branch ordering is pinned
by `break-glass-admin-override-ordering-4029.test.ts`.

Response — `AdminOverrideResult` (`:784-786`):

| Field | Type | Source |
|---|---|---|
| `ok` | `true` | literal |
| `newPendingSecretId` | `number` | the freshly inserted pending-secret row's id |
| `reissued` | `number` | `emails.length` actually targeted |
| `sent` | `number` | how many invite emails actually succeeded |

Failure shape (`ok: false`): `{ ok: false, status: 409 \| 500 \| 502 \| 503, error: string, detail?: string }`.
The portal route JSONs this through unchanged (`:933-935`); §3.4 shows the MSP
route doing the same.

Write-back gate refusals (`WriteBackNotEnabledError`,
`WriteBackCustomerNotFoundError`, `WriteConsentRequiredError`) are the one
exception — they still propagate as **thrown** errors rather than living in
`AdminOverrideResult`, so both callers keep catching them the same way
(`:939-943` portal, §3.4 MSP) and surface `409` with `{ error, blockedBy:
err.reason }` — a real, actionable state a design surface should render
distinctly, not a generic 500.

---

## 3. Wire contract — MSP console (operator) routes (new, #2675)

`artifacts/api-server/src/routes/msp-break-glass.ts`, registered in
`routes/index.ts:131,463` (mounted the same way as every other route file,
under `app.use("/api", router)`). Before #2675, **zero** `requireRole`-gated
routes existed for this domain anywhere in the repo — an MSP operator had no
way to see a pending break-glass credential, its verification attempts, or
its override history without going through the customer-scoped portal path.
Same 3 tables as §2, no new schema.

Auth floor on every route: `requireRole("MSPOperator")` (`msp-break-glass.ts`
throughout) — per `ROLE_ORDER` (`requireAuth.ts:80-88`), this admits
`MSPOperator`, `MSPAdmin`, and `PlatformAdmin` (anything at or above that
index), same floor §2.6's admin-override enforces manually on the portal
side. Every `:customerId`-scoped route additionally calls
`assertCustomerAccess` — the same MSP-ownership check pattern every other
MSP-scoped route in this repo uses (e.g. `msp-diagnostics.ts`,
`msp-alerts.ts`). Both "not found" and "not yours" return a bare 404 on the
`:pendingSecretId` routes (`:209,213-214,219-220`), same non-confirming
discipline as §2.

### 3.1 `GET /api/msp/break-glass`

`msp-break-glass.ts:81-157`. Cross-tenant list of every currently
`pending_delivery` secret across the caller's own MSP book.

- `mspId` resolved via `resolveMspIdStrict(req)` (`:83`, `req.user?.mspId ??
  null`) — **not** from a route param. If the JWT carries no `mspId`, the
  route 403s with `{ error: "MSP context required" }` (`:84-86`) rather than
  falling through to `assertCustomerAccess`. See §5 for the real, honest
  consequence of this for the `PlatformAdmin` role.
- Per-staff customer scoping via `resolveStaffScopedCustomerIds(req.user!)`
  (`:89`) — `null` means unrestricted (full MSP access); a non-null array
  narrows to that staff member's assigned customers only.
- Returns `{ pending: [] }` immediately if the caller's MSP has zero
  customers, or zero customers have a `pending_delivery` secret (`:99-101`,
  `:120-122`) — genuinely empty, not a fixture fallback.

Response (`:141-152`):

| Field | Type | Source |
|---|---|---|
| `pending` | array | see below |

Each `pending[]` row:

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `breakGlassPendingSecretsTable.id` |
| `runId` | `number` | `breakGlassPendingSecretsTable.runId` |
| `customerId` | `number` | `breakGlassPendingSecretsTable.customerId` |
| `customerName` | `string \| null` | `tenantsTable.customerName`, looked up by id (`:145`) |
| `status` | `"pending_delivery" \| "reset_in_progress"` | the query filters on these two (#4040 — a secret an override is resetting stays listed) |
| `createdAt` | `string` (ISO) | `.toISOString()` |
| `liveInviteCount` | `number` | attempts for this secret with `linkStatus === "pending"` (`:132-139`) — **not** persisted on the row, computed per-request |
| `totalInviteCount` | `number` | all attempts for this secret, any `linkStatus` |

Ordered `desc(createdAt)` (`:118`) — most recent pending secret first.

### 3.2 `GET /api/msp/customers/:customerId/break-glass`

`msp-break-glass.ts:162-198`. Full pending-secret history (any status, not
just `pending_delivery`) for one customer — the per-customer counterpart to
§3.1's cross-tenant list.

Response (`:184-193`):

| Field | Type | Source |
|---|---|---|
| `secrets` | array | see below |

Each `secrets[]` row:

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `id` |
| `runId` | `number` | `runId` |
| `status` | `"pending_delivery" \| "reset_in_progress" \| "delivered_purged" \| "superseded_by_reset"` | real enum, §5 — **unlike §3.1, every value is reachable here** |
| `createdAt` | `string` (ISO) | |
| `deliveredAt` | `string` (ISO) `\| null` | |
| `deliveredToEmail` | `string \| null` | |

Ordered `desc(createdAt)`.

### 3.3 `GET /api/msp/customers/:customerId/break-glass/:pendingSecretId`

`msp-break-glass.ts:203-262`. Detail + verification attempts for one secret —
the MSP-side counterpart to §2.2's by-run read, but keyed by
`pendingSecretId` (an operator browsing a customer's history, not a caller
already anchored to one run) and unrestricted to `status ===
"pending_delivery"` (any terminal-status secret is visible too).

Resolution: `resolvePendingContext(pendingSecretId)` — the same shared helper
§2's routes use (`:216`) — then `ctx.secret.customerId !== customerId` is
checked explicitly (`:219`) so a `pendingSecretId` from a different customer
404s rather than leaking cross-customer, even though the caller already
passed `assertCustomerAccess` for the `:customerId` in the URL.

**Never returns `linkToken` or the encrypted/vault-referenced secret value**
— same status-read contract as §2.2 (comment, `:27-29`).

Response (`:238-256`):

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `secret.id` |
| `runId` | `number` | `secret.runId` |
| `customerId` | `number` | `secret.customerId` |
| `status` | full enum | `secret.status` |
| `createdAt` | `string` (ISO) | |
| `deliveredAt` | `string \| null` (ISO) | |
| `deliveredToEmail` | `string \| null` | |
| `attempts` | array | see below |

Each `attempts[]` row (`:246-255`) — a superset of §2.2's `attempts[]` shape,
adding two operator-facing fields §2.2 does not expose:

| Field | Type | Source |
|---|---|---|
| `id` | `number` | |
| `invitedEmail` | `string` | |
| `linkStatus` | real enum, §6 | |
| `verificationOutcome` | real enum \| `null`, §6 | |
| `entraUserPrincipalName` | `string \| null` | **new vs §2.2** — the Entra UPN the recipient's OAuth sign-in actually resolved to, once attempted |
| `failedAttemptCount` | `number \| null` | **new vs §2.2** — count of `role_absent` outcomes against this specific link before it burns |
| `attemptedAt` | `string \| null` (ISO) | |
| `createdAt` | `string` (ISO) | |

Ordered `desc(createdAt)` on attempts (`:236`).

### 3.4 `POST /api/msp/customers/:customerId/break-glass/:pendingSecretId/admin-override`

`msp-break-glass.ts:267-305`. The MSP operator's own "force a reset" action —
functionally identical outcome to §2.6, different auth path and no separate
manual role check (the route-level `requireRole("MSPOperator")` already
covers the `PlatformAdmin`/`MSPAdmin`/`MSPOperator` floor §2.6 checks
explicitly, so there is nothing extra to re-derive here).

Request body — same shape and validation as §2.6 (`:275-279`):

| Field | Type | Constraint |
|---|---|---|
| `reason` | `string` | required, non-empty |
| `emails` | `string[]` | optional, 1–5 |

Flow (`:281-303`): `assertCustomerAccess` → `resolvePendingContext` +
cross-customer check (identical to §3.3) → calls the **same**
`performBreakGlassAdminOverride()` as §2.6 (`:291`) → JSONs `result` straight
through on success, or `{ error, detail? }` at `result.status` on the
`ok: false` shape, or `{ error, blockedBy }` at 409 on a caught
`WriteBack*`/`WriteConsentRequiredError` (`:296-299`) — the exact same
response contract as §2.6, because it is the exact same function.

### 3.5 `GET /api/msp/customers/:customerId/break-glass/audit`

`msp-break-glass.ts:310-354`. Override audit trail for one customer — reads
`break_glass_override_audit` directly (no shared helper; this table has no
portal-side equivalent read, so this endpoint is genuinely new surface, not a
reuse). Left-joins `usersTable` to resolve the acting admin's display name.

Response (`:338-347`):

| Field | Type | Source |
|---|---|---|
| `audit` | array | see below |

Each `audit[]` row:

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `breakGlassOverrideAuditTable.id` |
| `adminUserId` | `number` | |
| `adminName` | `string` | `usersTable.name ?? usersTable.email ?? \`user #${adminUserId}\`` (`:342`) — always a displayable string, never `null`, via a three-way fallback |
| `reason` | `string` | the operator-entered override reason (§2.6/§3.4 request body) |
| `oldPendingSecretId` | `number \| null` | |
| `newPendingSecretId` | `number` | |
| `createdAt` | `string` (ISO) | |

Ordered `desc(createdAt)`.

---

## 4. What the gate node actually creates (not a portal call, upstream context)

`break_glass_verification_gate` (`workflow-executor.ts:7488-7607`) fires the
first time a run reaches this node type. It is **not itself invoked by
either portal or MSP console** — it's how a pending secret row and its
"awaiting tenant-admin verification" pause come to exist in the first place,
upstream of every endpoint in §2 and §3.

- Resolves the plaintext from the run payload via a configurable
  `secretField`/`secretTemplate` (`:7515-7518`) and the customer id via
  `customerIdField` (default `payload.customerId`, `:7520-7522`). Fails the
  node (`nodeError = true`) if either is missing (`:7533-7537`).
- Inserts one `break_glass_pending_secrets` row: `encryptedValue` (always,
  `encryptSecret(plaintext)`), `secretRef` (the Key Vault pointer if the
  payload already carries one for that field — `:7547`), `gateNodeId:
  node.id`, `breakGlassAccountId` (the account resolved from
  `accountIdField`, #4015), `status: "pending_delivery"` (`:7540-7550`).
- **Deep-redacts the plaintext before it can reach `wf_runs.payload`** —
  strips the configured `secretField`/`secretTemplate`-referenced keys from
  the top-level payload AND from the accumulated `steps.<nodeId>` /
  `nodes.<nodeId>` echoes the engine builds (`redactForPersistence`,
  `:7561-7582`) — the comment at `:7576-7580` documents this as a real,
  previously-missed leak class (#1911): a top-level `delete` alone was not
  sufficient.
- Stamps the resolved break-glass account identity onto the (non-secret)
  payload under the canonical key `breakGlassAccountId` (`:7570-7574`),
  regardless of which source field it was configured to read. The identity is
  **not** redacted at rest (#4015 removed it from `SENSITIVE_PAYLOAD_KEYS`): it
  is an Entra object id, not a credential, and the resumed run needs it —
  `quickstart-v1.assign-global-admin-role` posts `{{breakGlassUserId}}` as
  `principalId`. §2.6 and §3.4's admin-override read the copy on the
  pending-secret row (`break_glass_account_id`), not this payload key.
- Sets `wf_runs.status = "awaiting_approval"` and returns `pauseForApproval:
  true` (`:7582`, `:7606`) — same pause mechanism the ordinary approval gate
  uses; a design surface treating "awaiting a human" states uniformly across
  gate types can reuse that vocabulary here.
- Never writes the plaintext to `wf_run_node_outputs`, `wf_node_output_samples`,
  or the run-log stream — the node output recorded is `{ pendingSecretId,
  status: "pending_delivery" }` only (`:7586`), and the shared output/sample
  tail is explicitly skipped via early return (`:7603-7606`) so nothing
  downstream can capture it either. `dryRun` mode short-circuits to `{
  dryRun: true, revealed: false }` before touching the database at all
  (`:7489-7492`).

### 4.1 Config Pack integration — how a run gets to this gate at all

`config-pack-graph.ts:380-417` splices exactly this node type into a pack's
generated run graph, for any template flagged `requiresVerificationGate`,
wired with fixed field names (`secretField: GATE_SECRET_FIELD,
customerIdField: "customerId"`, `accountIdField: GATE_ACCOUNT_ID_FIELD`) so
the orchestrator's seeded payload and the gate's reads can never drift apart
(comment, `config-pack-graph.ts:408-410`). `config-pack-orchestrator.ts:393-402`
is what actually populates `payload[GATE_SECRET_FIELD]` at run start, calling
the platform's single password generator, `generateStrongPassword()`
(`break-glass-verification.ts:291-295`, exported specifically for this
reuse) — the *only* two call sites for that generator on the whole platform
are this pack seed and the shared admin-override reset (§2.6/§3.4) (comment,
`config-pack-orchestrator.ts:65-69`). `GATE_SECRET_FIELD` itself is the
string literal `"generatedPassword"` (`config-pack-graph.ts:44`) — not
`"breakGlassSecret"`, the gate handler's own hardcoded fallback default
(`workflow-executor.ts:7515`); the pack path always sets `secretField`
explicitly so the fallback is never actually reached from this integration.

---

## 5. Real enum unions

Pulled directly from the Drizzle schema (`lib/db/src/schema/msp.ts:3999-4088`)
and route code — no invented vocabulary:

- **Pending-secret status** — `break_glass_pending_secrets.status`:
  `"pending_delivery" | "reset_in_progress" | "delivered_purged" | "superseded_by_reset"`.
  `"superseded_by_reset"` means an admin-override replaced it —
  nothing was ever delivered from that row. `"reset_in_progress"` (Git #4040)
  means an admin-override has claimed the row and is resetting the tenant; it is
  never deliverable, and every portal read that filters on `pending_delivery`
  (invite, by-run, the handoff list, reveal, acknowledge) treats it as not
  pending. Companion columns `reset_claim_token` / `reset_claimed_at` identify
  the claim holder.
- **Verification link status** — `break_glass_verification_attempts.link_status`:
  `"pending" | "consumed" | "expired" | "superseded"` (`:4052`).
  `"consumed"` = the winning attempt claimed the reveal; `"superseded"` = a
  losing simultaneous attempt for the same secret; `"expired"` = TTL passed
  or the failed-attempt cap was hit.
- **Verification outcome** —
  `break_glass_verification_attempts.verification_outcome`: `"success" |
  "role_not_active_pim_eligible" | "role_absent" | "expired" | "superseded" |
  null` (`:4053`). `null` until an attempt is actually made. Distinct from
  `link_status` — a link can be `"pending"` (not yet burned) with outcome
  `"role_not_active_pim_eligible"` from a prior try, because that specific
  outcome deliberately does NOT consume/expire the link — the same recipient
  can activate PIM and reopen the same link to finish.
- **Eligible directory role** — `ELIGIBLE_ROLE_TEMPLATE_IDS`
  (`break-glass-verification.ts:70-72`): a single hardcoded id,
  `62e90394-69f5-4237-9190-012177145e10` (Global Administrator). Not a DB
  enum — a code constant, extensible by editing the array. **Any Design
  vocabulary for "which roles qualify" should say "Global Administrator"
  specifically, not "an administrator role"** — this is the only value in
  the list today.

No `status`/state enum exists on `break_glass_override_audit` — it is a pure
append-only audit log (`msp.ts:4074-4084`), one row per override, no
lifecycle.

---

## 6. Auth model — two floors on the portal side, one uniform floor on the MSP side

- **Portal invite** (§2.1) and **portal by-run status** (§2.2): any role
  `assertCustomerAccess` admits for that customer — PlatformAdmin
  unconditionally, or MSPAdmin/MSPOperator scoped to their own MSP's tenants
  (`requireAuth.ts:295-310`).
- **Portal admin-override** (§2.6): the same `assertCustomerAccess` check,
  **plus** an additional role floor checked manually in the route handler —
  `PlatformAdmin`, `MSPAdmin`, or `MSPOperator` only (`:926-927`), explicitly
  excluding lower roles that might otherwise pass `assertCustomerAccess` for
  a customer. Comment states the reasoning plainly: "More powerful than
  invite."
- **Every MSP console route** (§3): `requireRole("MSPOperator")` at the route
  level already enforces that same floor uniformly, for all five endpoints —
  not just admin-override — so there is no separate manual role check to
  write on the MSP side; the floor is structural, not per-route logic.
- **Public endpoints** (§2.3–§2.5): no portal auth at all — control is proven
  entirely by the Microsoft OAuth round-trip against the customer's own
  tenant (§2.4), not by anything the caller's browser session claims.

**A real, honest edge case worth calling out for Design:** §3.1
(`GET /msp/break-glass`) resolves its MSP scope via `resolveMspIdStrict(req)`
— `req.user?.mspId ?? null` — not a route param, and 403s with "MSP context
required" if that claim is absent (`msp-break-glass.ts:83-86`). A
`PlatformAdmin` session is cross-MSP by definition and is not guaranteed to
carry an `mspId` claim at all (`requireAuth.ts:340-342`,
`resolveStaffScopedCustomerIds`'s own comment: "PlatformAdmin is cross-MSP
and is never scoped here"). So a `PlatformAdmin` calling the cross-tenant
list (§3.1) can 403 depending on whether their session happens to carry an
`mspId`, even though `requireRole("MSPOperator")` itself admits
`PlatformAdmin`. This is not unique to this route — the doc comment at
`msp-break-glass.ts:88` cites `msp-alerts.ts` as the same established
pattern, so it's existing platform behavior, not a defect introduced here —
but Design should know a "view across the whole book" surface may not
resolve for every role `requireRole` nominally admits. Every `:customerId`
-scoped MSP route (§3.2–§3.5) does not have this gap, since it resolves scope
from `assertCustomerAccess` on the explicit `customerId` in the URL instead.

---

## 7. Honest-empty / not-yet-wired contract

**There is no fixture, no client hook, and no page for this Feature on
either side** — unlike the account-security pack's tri-state (live /
genuinely-empty / read-failed) client contract, there is nothing here to
describe on the client side yet. Every field in §2 and §3 is honest by
construction:

- Portal's by-run status read (§2.2) either reports a real `pending: true`
  row with real attempt rows, or the literal `{ pending: false }`.
- MSP's cross-tenant list (§3.1) and per-customer history (§3.2) both return
  a real, possibly-empty array (`{ pending: [] }` / `{ secrets: [] }`) when
  the caller's book/customer genuinely has no rows — not a fixture fallback.

There is no fixture fallback path anywhere in either route file, because no
client currently calls any of these endpoints.

**Repeated-override alert (§2.6/§3.4's shared side effect) is a real, gated
notification, not a customer-facing signal.** `maybeFireOverrideAlert`
(`break-glass-verification.ts:242-286`) fires only past a 2-in-24h threshold
(`BREAK_GLASS_OVERRIDE_ALERT_THRESHOLD`, `:65`), to the platform mailbox
(`GRAPH_MAIL_USER_ID`) — silently skipped (logged, not thrown) if that env
var or Graph credentials aren't configured (`:261-264`). This is
platform-internal signal, not something either a customer-facing or
MSP-operator-facing Design surface would render.

---

## 8. Cross-surface edges

- §2 and §3 read/write the identical 3 tables — there is exactly one data
  model, viewed from two different auth contexts. No duplication of rows or
  meaning between portal and MSP.
- §2.6 and §3.4 are the exact same function call
  (`performBreakGlassAdminOverride()`) — same preconditions, same side
  effects, same response shape, same failure modes. A Design pass should
  treat these as one control with two entry points, not two features to
  design separately.
- §3.3's `attempts[]` is a superset of §2.2's `attempts[]` (adds
  `entraUserPrincipalName`, `failedAttemptCount`) — both read the same
  `break_glass_verification_attempts` rows; the MSP route simply selects two
  more columns. A shared list-item component could read either shape safely
  by treating the two extra fields as optional.
- `resolvePendingContext()` is the shared row-plus-ownership resolver behind
  §2.2, §2.6, §3.3, and §3.4 — the "not found vs not yours → same 404"
  discipline is therefore structurally identical across all four, not
  independently re-implemented per route.

---

## 9. Not covered by this pack

What either a portal break-glass-access page or an MSP console break-glass
operator page should actually show (a request-status view? a cross-tenant
watchlist? an admin-override control, and where it lives in MSP console's
nav) — no page in `artifacts/portal/src` or `artifacts/msp-console/src`
calls any break-glass endpoint (`grep -rln "break-glass\|breakGlass"` against
both trees: the only hit is prose copy about break-glass accounts as a
security concept in `artifacts/portal/src/components/copilot-journey/previewRemediationGuide.ts`,
not an endpoint call or a page) — whether/how the
public OAuth-driven reveal pages (§2.3–§2.5, currently plain server-rendered
HTML with MSP white-label branding) should be redesigned rather than left
as-is, and whether `ELIGIBLE_ROLE_TEMPLATE_IDS` should ever be
customer-configurable, are open questions for Design/chat architecture, not
settled here. This pack extracts what exists; it does not decide what should
be built next.

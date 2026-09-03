# Break-glass Access — contract extraction pack

**Issue:** #2443 (Break-glass Access: generate the contract pack from the real
backend), part of Feature #1651 ("Feature: Break-glass Access (Portal)"), under
EPIC #1485 (Portal New Design). Method per #1642. Extracted, not authored — every
field below traces to one of the files listed, cited to file:line. READ-ONLY
session; no code changed producing this pack.

**No design surface exists yet.** No `.dc.html` export for this Feature is present
under `Design/portal/`, and no page in `artifacts/portal` calls any break-glass
endpoint. Per #1485's fixed order (architect → build the endpoints → regenerate
the contract pack → Design → wire), this pack is the "regenerate the contract
pack" step, extracted purely from the real backend — there is nothing to reconcile
against an existing page, and no page/UI-shape decision is made here.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/break-glass-verification.ts` — all five HTTP
  endpoints, mounted at `/api` (`artifacts/api-server/src/app.ts:115`)
- `artifacts/api-server/src/lib/workflow-executor.ts` — the
  `break_glass_verification_gate` node handler (creates the pending secret, pauses
  the run) and the `purge_orphaned_generated_secrets` backstop node
- `artifacts/api-server/src/lib/config-pack-graph.ts` — how a gated Config Pack
  template splices this gate into a run's node graph
- `artifacts/api-server/src/lib/config-pack-orchestrator.ts` — how a pack run
  seeds the gate's input payload (`GATE_SECRET_FIELD`, `generateStrongPassword()`)
- `artifacts/api-server/src/lib/generated-secret-store.ts` — Key Vault store the
  plaintext actually lives in (#1911); `secretRef` on the pending-secret row is
  the pointer, not the value
- `artifacts/api-server/src/lib/secret-crypto.ts` — the gate's own encrypted
  fallback copy (`encryptedValue`), for rows predating #1911
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireAuth`,
  `assertCustomerAccess`
- `lib/db/src/schema/msp.ts:3933-4020` — the three real tables
  (`break_glass_pending_secrets`, `break_glass_verification_attempts`,
  `break_glass_override_audit`) and their real enum unions

---

## 1. What "break-glass access" actually is on this platform

Not a standing emergency-admin account a customer manages themselves. It is a
**one-time credential handoff gate inside the Workflow Engine**: a Config Pack (or
any workflow) that needs to write a break-glass admin account's password pauses at
a `break_glass_verification_gate` node until a real, tenant-proven human on the
*customer's own* Microsoft 365 tenant claims it — proven live via a Microsoft
OAuth sign-in that must resolve to an ACTIVE Global Administrator directory role
(or that role's PIM-eligible-but-not-active state), not by anything the portal
user types in. The plaintext credential is revealed exactly once, server-rendered,
and purged from storage the moment the winning recipient acknowledges it.

There is no portal page for this yet. Everything below is backend the Feature can
be designed against.

---

## 2. Wire contract — the five endpoints

### 2.1 `POST /api/portal/break-glass/:pendingSecretId/invite` (`requireAuth`)

`break-glass-verification.ts:383-407`. Customer-side "send verification invites"
action — the entry point a portal page would call.

Request body (`z.object({ emails: z.array(z.string().email()).min(1).max(5) })`,
`:387`):

| Field | Type | Constraint |
|---|---|---|
| `emails` | `string[]` | 1–5 valid email addresses |

Auth: `assertCustomerAccess(req.user!, ctx.secret.customerId)` (`:394`) — any role
with access to that customer (PlatformAdmin, or MSPAdmin/MSPOperator scoped to the
tenant's own MSP; see §5). **Both "not found" and "not yours" return a bare 404**
(`:393`, `:395`) — the route never confirms a `pendingSecretId` exists to a caller
who shouldn't see it.

Preconditions enforced server-side, not just documented: `ctx.secret.status` must
be `"pending_delivery"` (`:397-399`), else `409`.

Response (`:402`):

| Field | Type | Source |
|---|---|---|
| `ok` | `true` | literal |
| `invited` | `number` | `body.data.emails.length` — how many were requested |
| `sent` | `number` | how many actually succeeded (`sendBreakGlassInvites`'s return; see §3) |

`invited` and `sent` can legitimately differ — a per-recipient mail failure is
logged and skipped, not fatal to the request (`sendBreakGlassInvites`,
`:226-231`).

### 2.2 `GET /api/portal/break-glass/by-run/:runId` (`requireAuth`)

`break-glass-verification.ts:416-471`. Status read for the Portal's pack-execution
surface — scoped by `runId`, not `customerId` (the caller is already looking at
one specific run). **Never returns `linkToken` or the encrypted secret** — a
status read for the initiator, not a delivery surface (`:410-415`).

Auth: resolves `customerId` from `wfRunsTable.payload.customerId` (the gate
preserves this field — see §4), then `assertCustomerAccess` (`:430`). 404 for both
"run not found" and "not yours" (`:429-431`).

Response — one of two shapes:

- **Not currently at a live break-glass pause** (`:445-447`): `{ "pending": false }`.
  This covers three real, distinct states collapsed into one boolean: the run
  never reached this gate, the run is paused for a *different* reason, or the
  secret has already reached a terminal status (`delivered_purged` /
  `superseded_by_reset`). The route does not distinguish these for the caller —
  a design surface wanting to tell them apart needs a different read.
- **Pending** (`:461-466`):

| Field | Type | Source |
|---|---|---|
| `pending` | `true` | literal |
| `pendingSecretId` | `number` | `secret.id` |
| `status` | `"pending_delivery"` | `secret.status` (only value reachable here — see §6 enum) |
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
OAuth authorize URL (`:517-524`) built with `MT_APP_WRITE_CLIENT_ID` and a signed
`state` (HMAC-tied back to the link token, `:89-92`) so the callback can't be
replayed against a different attempt. No portal-facing JSON contract to design
against here — this is the OAuth hop, not a UI surface.

Rate-limited: 60 requests / 15 min per the shared `publicLimiter`
(`:105-111`).

### 2.4 `GET /api/public/break-glass/verify/callback` (public, rate-limited)

`break-glass-verification.ts:534-693`. The OAuth callback. Exchanges the auth
code exactly once (`:564`), reads `/me` and `/me/transitiveMemberOf` via the
delegated token, and checks for an ACTIVE eligible directory role
(`ELIGIBLE_ROLE_TEMPLATE_IDS`, currently only Global Administrator's template id
`62e90394-69f5-4237-9190-012177145e10`, `:70-72`). Also server-rendered HTML, not
JSON — same "no portal contract" note as §2.3. The reveal-once credential page
this produces on success (`:638-647`) is a plain HTML form POSTing to §2.5; it is
not meant to be embedded in the portal SPA.

Race handling for two simultaneous winners: an atomic conditional UPDATE
(`WHERE linkStatus = 'pending'`, `:589-592`) inside a transaction claims the
attempt; a second concurrent callback sees 0 rows affected and is told (409)
someone else already won (`:605-608`).

### 2.5 `POST /api/public/break-glass/:pendingSecretId/acknowledge` (public, rate-limited)

`break-glass-verification.ts:698-772`. The winning recipient's explicit "I have
saved it" click. Body: `{ linkToken: string }` (form-encoded, from the reveal
page's hidden field, `:645`). Also HTML, not JSON — a form POST target, not a
portal API call.

On success: purges the Key Vault copy (`:740`), sets
`status: "delivered_purged"`, empties `encryptedValue`, stamps `deliveredAt` /
`deliveredToEmail` (`:741-743`), and fires `resumeWorkflowRun` for the paused run
via `setImmediate` (fire-and-forget, non-fatal on failure — `:750-759`).

### 2.6 `POST /api/portal/break-glass/:pendingSecretId/admin-override` (`requireAuth`)

`break-glass-verification.ts:777-911`. The "every link is dead-ended, force a
reset" escape hatch a portal admin surface would call.

Request body (`:781-784`):

| Field | Type | Constraint |
|---|---|---|
| `reason` | `string` | required, non-empty (audit trail — see §6) |
| `emails` | `string[]` | optional, 1–5; if omitted, re-invites the prior recipient set (`:895-896`) |

Auth: **stricter than invite** — role must be `PlatformAdmin`, `MSPAdmin`, or
`MSPOperator` (`:792-793`, via `effectiveRoleOf`, `:344`) *and*
`assertCustomerAccess`, else 404. Preconditions, each its own real check, not
just documented:

- `ctx.secret.status === "pending_delivery"` (`:798-800`) else 409
- `ctx.tenantId` must be configured (`:801-803`) else 409
- **every existing verification attempt for this secret must be terminal**
  (`expired` or `superseded` — `:806-811`) — an admin cannot override while a link
  is still live
- the paused run's payload must carry `breakGlassAccountId` (`:814-821`) — no
  identity to reset without it, 409 if missing

On success, in order: resets the tenant account's password via
`graphWriteForTenant` PATCH (`:826-836`, real write-back gate — 502 with
`errorType` on Graph failure), stores the new plaintext to Key Vault
**fail-closed** if the store isn't configured (`:846-856`, 503 rather than
falling back to DB-only storage), supersedes the old pending-secret row and
inserts a new one plus an audit row in one transaction (`:861-883`), purges the
old row's now-orphaned vault copy (`:889`), fires the repeated-override alert if
this is the 2nd+ override in 24h (`:892`, see §7), and re-issues invites
(`:895-897`). **Does not resume the run** — it stays paused until the new secret
is separately acknowledged (`:899`).

Response (`:900`):

| Field | Type | Source |
|---|---|---|
| `ok` | `true` | literal |
| `newPendingSecretId` | `number` | the freshly inserted pending-secret row's id |
| `reissued` | `number` | `emails.length` actually targeted |
| `sent` | `number` | how many invite emails actually succeeded |

Write-back gate refusals (`WriteBackNotEnabledError`,
`WriteBackCustomerNotFoundError`, `WriteConsentRequiredError`) surface as `409`
with `{ error, blockedBy: err.reason }` (`:904-906`) rather than a generic 500 —
a real, actionable state a design surface should render distinctly.

---

## 3. What the gate node actually creates (not a portal call, upstream context)

`break_glass_verification_gate` (`workflow-executor.ts:7488-7607`) fires the
first time a run reaches this node type. It is **not itself invoked by the
portal** — it's how a pending secret row and its "awaiting tenant-admin
verification" pause come to exist in the first place, upstream of every endpoint
in §2.

- Resolves the plaintext from the run payload via a configurable
  `secretField`/`secretTemplate` (`:7515-7518`) and the customer id via
  `customerIdField` (default `payload.customerId`, `:7520-7522`). Fails the node
  (`nodeError = true`) if either is missing (`:7533-7537`).
- Inserts one `break_glass_pending_secrets` row: `encryptedValue` (always,
  `encryptSecret(plaintext)`), `secretRef` (the Key Vault pointer if the payload
  already carries one for that field — `:7547`), `gateNodeId: node.id`,
  `status: "pending_delivery"` (`:7540-7550`).
- **Deep-redacts the plaintext before it can reach `wf_runs.payload`** — strips
  the configured `secretField`/`secretTemplate`-referenced keys from the
  top-level payload AND from the accumulated `steps.<nodeId>` / `nodes.<nodeId>`
  echoes the engine builds (`redactForPersistence`, `:7561-7582`) — the comment
  at `:7576-7580` documents this as a real, previously-missed leak class (#1911):
  a top-level `delete` alone was not sufficient.
- Stamps the resolved break-glass account identity onto the (non-secret) payload
  under the canonical key `breakGlassAccountId` (`:7570-7574`), regardless of
  which source field it was configured to read — this is the key §2.6's
  admin-override reads (`runPayload.breakGlassAccountId`, route `:819`).
- Sets `wf_runs.status = "awaiting_approval"` and returns
  `pauseForApproval: true` (`:7582`, `:7606`) — same pause mechanism the ordinary
  approval gate uses; a design surface treating "awaiting a human" states
  uniformly across gate types can reuse that vocabulary here.
- Never writes the plaintext to `wf_run_node_outputs`, `wf_node_output_samples`,
  or the run-log stream — the node output recorded is `{ pendingSecretId,
  status: "pending_delivery" }` only (`:7586`), and the shared output/sample tail
  is explicitly skipped via early return (`:7603-7606`) so nothing downstream can
  capture it either. `dryRun` mode short-circuits to `{ dryRun: true, revealed:
  false }` before touching the database at all (`:7489-7492`).

### 3.1 Config Pack integration — how a run gets to this gate at all

`config-pack-graph.ts:380-417` splices exactly this node type into a pack's
generated run graph, for any template flagged `requiresVerificationGate`, wired
with fixed field names (`secretField: GATE_SECRET_FIELD`, `customerIdField:
"customerId"`, `accountIdField: GATE_ACCOUNT_ID_FIELD`) so the orchestrator's
seeded payload and the gate's reads can never drift apart (comment,
`config-pack-graph.ts:408-410`). `config-pack-orchestrator.ts:393-402` is what
actually populates `payload[GATE_SECRET_FIELD]` at run start, calling the
platform's single password generator, `generateStrongPassword()`
(`break-glass-verification.ts:291-295`, exported specifically for this reuse) —
the *only* two call sites for that generator on the whole platform are this pack
seed and §2.6's admin-override reset (comment,
`config-pack-orchestrator.ts:65-69`). `GATE_SECRET_FIELD` itself is the string
literal `"generatedPassword"` (`config-pack-graph.ts:44`) — not
`"breakGlassSecret"`, the gate handler's own hardcoded fallback default
(`workflow-executor.ts:7515`); the pack path always sets `secretField` explicitly
so the fallback is never actually reached from this integration.

---

## 4. Real enum unions

Pulled directly from the Drizzle schema (`lib/db/src/schema/msp.ts`) and route
code — no invented vocabulary:

- **Pending-secret status** — `break_glass_pending_secrets.status`:
  `"pending_delivery" | "delivered_purged" | "superseded_by_reset"`
  (`msp.ts:3963`). `"superseded_by_reset"` means an admin-override replaced it —
  nothing was ever delivered from that row (schema comment, `msp.ts:3961-3962`).
- **Verification link status** — `break_glass_verification_attempts.link_status`:
  `"pending" | "consumed" | "expired" | "superseded"` (`msp.ts:3984`).
  `"consumed"` = the winning attempt claimed the reveal; `"superseded"` = a
  losing simultaneous attempt for the same secret; `"expired"` = TTL passed
  (`:499-505`) or the failed-attempt cap was hit (`:672-680`).
- **Verification outcome** —
  `break_glass_verification_attempts.verification_outcome`: `"success" |
  "role_not_active_pim_eligible" | "role_absent" | "expired" | "superseded" |
  null` (`msp.ts:3985`). `null` until an attempt is actually made. Distinct from
  `link_status` — a link can be `"pending"` (not yet burned) with outcome
  `"role_not_active_pim_eligible"` from a prior try, because that specific
  outcome deliberately does NOT consume/expire the link (comment,
  `:661-662`) — the same recipient can activate PIM and reopen the same link to
  finish.
- **Eligible directory role** — `ELIGIBLE_ROLE_TEMPLATE_IDS` (`:70-72`): a single
  hardcoded id, `62e90394-69f5-4237-9190-012177145e10` (Global Administrator).
  Not a DB enum — a code constant, extensible by editing the array (comment,
  `:66-69`). **Any Design vocabulary for "which roles qualify" should say
  "Global Administrator" specifically, not "an administrator role"** — this is
  the only value in the list today.

No `status`/state enum exists on `break_glass_override_audit` — it is a pure
append-only audit log (`msp.ts:4006-4016`), one row per override, no lifecycle.

---

## 5. Auth model — two different bars, by design

Two distinct authorization checks across these six endpoints, not one:

- **Invite** (§2.1) and **by-run status** (§2.2): any role `assertCustomerAccess`
  admits for that customer — PlatformAdmin unconditionally, or
  MSPAdmin/MSPOperator scoped to their own MSP's tenants
  (`requireAuth.ts:295-310`).
- **Admin-override** (§2.6): the same `assertCustomerAccess` check, **plus** an
  additional role floor — `PlatformAdmin`, `MSPAdmin`, or `MSPOperator` only
  (`:792-793`), explicitly excluding lower roles that might otherwise pass
  `assertCustomerAccess` for a customer. Comment at `:791` states the reasoning
  plainly: "More powerful than invite."
- **Public endpoints** (§2.3–§2.5): no portal auth at all — control is proven
  entirely by the Microsoft OAuth round-trip against the customer's own tenant
  (§2.4), not by anything the caller's browser session claims.

---

## 6. Honest-empty / not-yet-wired contract

**There is no fixture, no client hook, and no page for this Feature at all** —
unlike the account-security pack's tri-state (live / genuinely-empty / read-
failed) client contract, there is nothing here to describe on the client side
yet. Every field in §2 is honest by construction: the by-run status read
(§2.2) either reports a real `pending: true` row with real attempt rows, or the
literal `{ pending: false }` — there is no fixture fallback path anywhere in this
route file to fall back to, because no client currently calls it.

**Repeated-override alert (§2.6's side effect) is a real, gated notification, not
a customer-facing signal.** `maybeFireOverrideAlert` (`:242-286`) fires only past
a 2-in-24h threshold (`BREAK_GLASS_OVERRIDE_ALERT_THRESHOLD`, `:65`), to the
platform mailbox (`GRAPH_MAIL_USER_ID`) — silently skipped (logged, not thrown)
if that env var or Graph credentials aren't configured (`:261-264`). This is
platform-internal signal, not something a customer-facing Design surface would
render.

---

## 7. Not covered by this pack

Per #2443's own scope (Step 2 of #1651 — extract the contract, no page/UI-shape
decisions here): what a break-glass-access page in the portal should actually
show (a request-status view? an admin-override control?), whether/how the public
OAuth-driven reveal pages (§2.3–§2.5, currently plain server-rendered HTML with
MSP white-label branding, `:114-156`) should be redesigned rather than
left as-is, and whether `ELIGIBLE_ROLE_TEMPLATE_IDS` should ever be
customer-configurable are open questions for Design/chat architecture, not
settled here. This pack extracts what exists; it does not decide what should be
built next.

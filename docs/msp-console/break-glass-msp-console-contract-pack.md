# Break-glass — MSP Console contract extraction pack

**#3668**, found during the #3665 design freshness audit (rows 2 and 17 of
`docs/msp-console-design-audit-3665.md`), under Feature #2564 ("Feature: Break-glass
Access (MSP Console)"), Epic #1571 (Portal Admin) / Epic #1485 (Portal)'s standing
sequence: **architect → build the endpoints → regenerate the contract pack from the
real code → Design → wire.** The backend this pack documents was built under **#2675**
and is real, live, and already fully correct — confirmed independently against the
route file, not assumed from the issue body.

Method per #1642. Read-only. Every field below is extracted verbatim from the route's
own logic and the Drizzle schema, cited to file:line, cross-checked live against local
PostgreSQL. **Nothing here is authored or invented.** No product code, schema, or UI
was touched to produce this document.

## 0. This is a narrower pack than it looks — read this first

**The backend was never actually undocumented.** `docs/portal/break-glass-access-
contract-pack.md` (#2628, written under this exact same Feature #2564) already
documents this module in full — both the customer/portal side (its §2) **and** the
MSP-console/operator side (its §3, all 5 routes in `msp-break-glass.ts`) — and it is
current: read in full for this pack, then cross-checked line-by-line against the live
route file (§1 below), every citation matches exactly. So #3668's own title
("undocumented") overstates the gap by one word. What is real: **no pack exists
anywhere under `docs/msp-console/`** — the one-pack-per-MSP-Console-module directory
the #3665 design audit checks screens against — so a process that only looks in this
directory (as the audit does, by design) finds nothing for this module. That is the
actual, narrow gap this pack closes.

Consistent with the #1642/tenant-scores precedent of not duplicating a route that's
already documented elsewhere, **this pack does not re-derive the shared backend
pieces** — `resolvePendingContext()`, `performBreakGlassAdminOverride()`, the
`break_glass_verification_gate` workflow node, the Config Pack integration, or the
customer/portal-side endpoints. Those are cited by reference to the existing portal
pack's own section numbers throughout. This pack's own content is: the MSP-console
wire contract re-verified against current code (§1), the real enums (§2), the
MSP-console auth model (§3), the honest live-data state (§4), a direct cross-check of
the design's own `wire:` claims for this screen against the real routes (§5, and it
surfaces one real, worth-recording mismatch), cross-surface edges (§6), and the
forbidden list (§7).

Backend route (one file, five routes — all real, all reachable):

- `msp-break-glass.ts` (356 lines) — the five MSP operator routes, registered
  `routes/index.ts:131,463` (mounted the same `app.use("/api", subscriptionGate,
  router)` chokepoint, `app.ts:127`, every other route in this codebase mounts
  through)

Schema: `lib/db/src/schema/msp.ts:4338-4427` (`breakGlassPendingSecretsTable` /
`break_glass_pending_secrets`, `breakGlassVerificationAttemptsTable` /
`break_glass_verification_attempts`, `breakGlassOverrideAuditTable` /
`break_glass_override_audit`) — **line numbers moved since the portal pack's own
citation** (it cites `msp.ts:3999-4088`; the file has grown ~340 lines since #2628).
Re-verified live against local PostgreSQL: all three tables exist and match the
Drizzle source exactly (`psql "$DATABASE_URL" -c '\d break_glass_pending_secrets'`
etc.).

---

## 1. Wire contract — the five MSP-console routes, re-verified against current code

Source: `msp-break-glass.ts`. Every line cited below was read directly against the
file on `main` at pack time (2026-09-11), not copied from the portal pack — they
happen to match exactly, which is itself the confirmation that pack is still current
for this module.

Auth floor on **every** route: `requireCapability("ladder.msp-operator")` — per
`legacy-ladder.ts:243`, this is the same capability `msp-remediation-tracker-
scores.ts` and `msp-engine-history.ts` gate on; role-order semantics admit
`MSPOperator`, `MSPAdmin`, and `PlatformAdmin`. Every `:customerId`-scoped route
additionally calls `assertCustomerAccess` — the identical MSP-ownership chokepoint
every other MSP-scoped route in this repo uses (`msp-diagnostics.ts`,
`msp-alerts.ts`, `msp-customer-scores.ts`). Both "not found" and "not yours" return a
bare 404 on the `:pendingSecretId` routes — never a distinguishable 403, never
confirming a secret belonging to another customer exists.

### 1.1 `GET /msp/break-glass` — cross-tenant pending list

`:81-157`. `mspId` resolved via `resolveMspIdStrict(req)` (`:83`) — **not** a route
param; 403s `{ error: "MSP context required" }` (`:84-86`) if the JWT carries no
`mspId` claim, rather than falling through to a customer check. Per-staff scoping via
`resolveStaffScopedCustomerIds(req.user!)` (`:89`, `null` = unrestricted). Returns
`{ pending: [] }` immediately if the caller's book has zero customers or zero
`pending_delivery` secrets (`:99-101`, `:120-122`) — a real empty array, not a
fixture fallback.

Response (`:141-152`):

| Field | Type | Source |
|---|---|---|
| `pending` | array | see below |

Each `pending[]` row:

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `breakGlassPendingSecretsTable.id` |
| `runId` | `number` | `.runId` |
| `customerId` | `number` | `.customerId` |
| `customerName` | `string \| null` | `tenantsTable.customerName`, looked up by id (`:145`) |
| `status` | `"pending_delivery"` | the only value reachable here — the query filters on it (`:115`) |
| `createdAt` | `string` (ISO) | `.toISOString()` |
| `liveInviteCount` | `number` | attempts for this secret with `linkStatus === "pending"` (`:132-139`) — computed per-request, not persisted |
| `totalInviteCount` | `number` | all attempts for this secret, any `linkStatus` |

Ordered `desc(createdAt)` (`:118`).

### 1.2 `GET /msp/customers/:customerId/break-glass` — per-customer history

`:162-198`. Full history (any status, not just `pending_delivery`) for one customer.

Response (`:184-193`), each `secrets[]` row:

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `id` |
| `runId` | `number` | `runId` |
| `status` | `"pending_delivery" \| "delivered_purged" \| "superseded_by_reset"` | real enum, §2 — all three values reachable here |
| `createdAt` | `string` (ISO) | |
| `deliveredAt` | `string` (ISO) `\| null` | |
| `deliveredToEmail` | `string \| null` | |

Ordered `desc(createdAt)`.

### 1.3 `GET /msp/customers/:customerId/break-glass/:pendingSecretId` — detail + attempts

`:203-262`. Resolution via `resolvePendingContext(pendingSecretId)` (`:216`) — the
shared helper the portal pack's §2.2/§2.6 also use — then `ctx.secret.customerId !==
customerId` is checked explicitly (`:219`) so a `pendingSecretId` belonging to a
different customer 404s even though the caller already passed `assertCustomerAccess`
for the URL's `:customerId`. **Never returns `linkToken` or the encrypted/
vault-referenced secret value** — a status read, not a delivery surface (file header
comment, `:27-29`).

Response (`:238-256`):

| Field | Type | Source |
|---|---|---|
| `pendingSecretId` | `number` | `secret.id` |
| `runId` | `number` | `secret.runId` |
| `customerId` | `number` | `secret.customerId` |
| `status` | full enum, §2 | `secret.status` |
| `createdAt` | `string` (ISO) | |
| `deliveredAt` | `string \| null` (ISO) | |
| `deliveredToEmail` | `string \| null` | |
| `attempts` | array | see below |

Each `attempts[]` row (`:246-255`):

| Field | Type | Source |
|---|---|---|
| `id` | `number` | |
| `invitedEmail` | `string` | |
| `linkStatus` | real enum, §2 | |
| `verificationOutcome` | real enum \| `null`, §2 | |
| `entraUserPrincipalName` | `string \| null` | the Entra UPN the recipient's OAuth sign-in resolved to, once attempted |
| `failedAttemptCount` | `number \| null` | count of `role_absent` outcomes against this link before it burns |
| `attemptedAt` | `string \| null` (ISO) | |
| `createdAt` | `string` (ISO) | |

Ordered `desc(createdAt)` on attempts (`:236`).

### 1.4 `POST /msp/customers/:customerId/break-glass/:pendingSecretId/admin-override`

`:267-305`. The operator's "force a reset" action. Body (`:275-279`,
`z.object({ reason: z.string().trim().min(1), emails: z.array(z.string().email())
.min(1).max(5).optional() })`):

| Field | Type | Constraint |
|---|---|---|
| `reason` | `string` | required, non-empty — written to the audit row |
| `emails` | `string[]` | optional, 1–5; if omitted, re-invites the prior recipient set |

Flow (`:281-303`): `assertCustomerAccess` → `resolvePendingContext` + the same
cross-customer check as §1.3 → delegates to `performBreakGlassAdminOverride(ctx,
pendingSecretId, req.user!.id, body.data.reason, body.data.emails)` (`:291`) — **the
one, shared implementation** of this security-sensitive flow; this route does not
re-implement any part of the reset logic, preconditions, or side effects. Full
precondition/side-effect/failure-shape detail lives in the portal pack's §2.6
(`break-glass-verification.ts:784-906`) and is not repeated here — it is identical
regardless of which of the two routes calls it.

Response on success: `AdminOverrideResult` — `{ ok: true, newPendingSecretId,
reissued, sent }`, JSONed straight through (`:295`). On `{ ok: false, status: 409 |
502 | 503, error, detail? }`, this route mirrors that status (`:293`). Write-back gate
errors (`WriteBackNotEnabledError`, `WriteBackCustomerNotFoundError`,
`WriteConsentRequiredError`) are caught explicitly (`:297-299`) and surfaced as `409
{ error, blockedBy: err.reason }` — a real, distinct state, not a generic 500.

### 1.5 `GET /msp/customers/:customerId/break-glass/audit`

`:310-354`. Override audit trail for one customer — reads
`break_glass_override_audit` directly; no shared helper, because this table has no
portal-side read at all (genuinely new surface, not a reuse). Left-joins `usersTable`
to resolve the acting admin's display name.

Response (`:338-347`), each `audit[]` row:

| Field | Type | Source |
|---|---|---|
| `id` | `number` | |
| `adminUserId` | `number` | |
| `adminName` | `string` | `usersTable.name ?? usersTable.email ?? \`user #${adminUserId}\`` (`:342`) — a three-way fallback, always a displayable string, never `null` |
| `reason` | `string` | the operator-entered override reason |
| `oldPendingSecretId` | `number \| null` | |
| `newPendingSecretId` | `number` | |
| `createdAt` | `string` (ISO) | |

Ordered `desc(createdAt)`.

---

## 2. Real enum unions

Pulled verbatim from the schema (`lib/db/src/schema/msp.ts:4338-4427`), verified live.

```ts
// msp.ts:4370 — break_glass_pending_secrets.status
BREAK_GLASS_STATUS = ["pending_delivery", "delivered_purged", "superseded_by_reset"]
// "superseded_by_reset" = an admin-override replaced this row; nothing was ever
// delivered from it (schema comment, :4368-4369).

// msp.ts:4391 — break_glass_verification_attempts.link_status
LINK_STATUS = ["pending", "consumed", "expired", "superseded"]

// msp.ts:4392 — break_glass_verification_attempts.verification_outcome
VERIFICATION_OUTCOME = ["success", "role_not_active_pim_eligible", "role_absent", "expired", "superseded"]
// | null until an attempt is actually made. A link can be "pending" (not burned)
// with a prior outcome of "role_not_active_pim_eligible" — that specific outcome
// deliberately does not consume/expire the link, so the same recipient can
// activate PIM and reopen it to finish (break-glass-verification.ts logic, cited
// in the portal pack §5).
```

`ELIGIBLE_ROLE_TEMPLATE_IDS` (`break-glass-verification.ts:71-73`, re-read directly
for this pack) is a single hardcoded GUID, `62e90394-69f5-4237-9190-012177145e10`
(Global Administrator) — a code constant, not a DB enum. Every MSP-console
precondition check that cites "an eligible role" means specifically this one value
today.

No status/lifecycle enum on `break_glass_override_audit` — pure append-only, one row
per override.

---

## 3. MSP-console auth model — one uniform floor, no per-route variation

Every route in §1 shares one floor: `requireCapability("ladder.msp-operator")` at the
route level. Unlike the portal side (where the admin-override route needs an
additional manual role check on top of `assertCustomerAccess` — portal pack §6), the
MSP console needs no separate manual check anywhere — the capability gate already
covers the same `MSPOperator`/`MSPAdmin`/`PlatformAdmin` floor for all five endpoints,
uniformly, admin-override included.

**One real, honest edge case, re-verified for this pack (portal pack §5 already
called this out; confirmed still true):** §1.1's cross-tenant list resolves scope via
`resolveMspIdStrict(req)` — `req.user?.mspId ?? null` — not a route param, and 403s
if that claim is absent. A `PlatformAdmin` session is cross-MSP by definition and is
not guaranteed to carry an `mspId` claim, so a `PlatformAdmin` calling §1.1 specifically
can 403 depending on session shape, even though `requireCapability("ladder.msp-
operator")` itself admits `PlatformAdmin`. Every `:customerId`-scoped route (§1.2–§1.5)
does not have this gap — those resolve scope from `assertCustomerAccess` on the
explicit `customerId` in the URL instead. Not a defect introduced by this module —
the same pattern `msp-alerts.ts` already has, per the file's own doc comment (`:88`).

---

## 4. Live-data state — honest, confirmed empty, and why

```
psql "$DATABASE_URL" -c "SELECT count(*) FROM break_glass_pending_secrets;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM break_glass_verification_attempts;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM break_glass_override_audit;"
```

All three: **0 rows**, confirmed live 2026-09-11. This is a true, honest "never
happened" state, not a bug and not something this pack can show populated without
inventing a row, which it will not do — and it has one clear, structural cause: a
`break_glass_pending_secrets` row is created **only** by the
`break_glass_verification_gate` workflow node firing inside a running Config Pack
(portal pack §4), and no design export nor any page in `artifacts/msp-console/src` or
`artifacts/portal/src` calls any break-glass endpoint yet (confirmed by grep against
both trees — the only hit anywhere is unrelated prose copy in
`artifacts/portal/src/components/copilot-journey/previewRemediationGuide.ts`, not an
endpoint call). No Config Pack run configured with `requiresVerificationGate` has
executed against local dev data, so every route in §1 reads as genuinely, honestly
empty for every real tenant in this database today (`{ pending: [] }` / `{ secrets:
[] }`) — not a fixture fallback, the real query result.

---

## 5. Design cross-check — the dc.html Break-glass screen's own `wire:` claims

`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`, `page === "bg"`
(`:2838-2905` for the list/audit views, `:4075-4110` for the detail-view facts/
attempts/precondition checklist, `:4395-4446` for the two action drawers). The #3665
audit (row 17) already confirmed this screen's claims are real and accurate; this
pack re-verifies the specific `wire:`/`eyebrow:` strings directly against §1, and
surfaces one real, worth-recording observation the #3665 audit's screen-level pass
didn't drill into.

**Confirmed accurate, verbatim:**
- List view `emptyWire: "GET /api/msp/customers/:customerId/break-glass →
  { secrets: [] }"` (`:2882`) — matches §1.2 exactly, honest-empty shape included.
- Audit tab `emptyWire: "GET /api/msp/customers/:customerId/break-glass/audit"`
  (`:2865`) — matches §1.5.
- The three screen-level `notes[]` (`:2895-2897`) — the OAuth/`ELIGIBLE_ROLE_
  TEMPLATE_IDS` note, the "plaintext never reaches this console" note, and the
  409/502/503 override failure-mode note — all three check out verbatim against §1.4
  and §2.
- Tenant Overview's `bgSecrets`-sourced tile and row (`:3151,3167`, per #3665 row 2)
  correctly derive `pendingBg` by filtering local `bgSecrets` for `status ===
  "pending_delivery"` — the identical filter §1.1's real query applies server-side.
- The `override` drawer's precondition checklist (`bgPre`, `:4098-4103`) — pending
  status, all-terminal links, `breakGlassAccountId` present, Global Administrator
  only, run stays paused — matches §1.4's real preconditions (via
  `performBreakGlassAdminOverride`, portal pack §2.6) field for field.

**One real observation, not previously surfaced by #3665:** the `bginvite` drawer
(`:4435-4446`, the screen's own "Send invites" action, reachable from the detail
view) cites `eyebrow: "POST /portal/break-glass/:id/invite"` (`:4436`) — that is the
**customer/portal-side** route (portal pack §2.1,
`POST /api/portal/break-glass/:pendingSecretId/invite`), not an MSP-console route.
**There is no invite endpoint anywhere in `msp-break-glass.ts`** — confirmed by the
full read for §1: the file's own header (`:17-47`) enumerates exactly the five routes
in §1, and no sixth "invite" route exists. This is not a functional bug: the portal
invite route's own auth (`assertCustomerAccess`, portal pack §2.1) admits
MSPAdmin/MSPOperator scoped to their own MSP identically to every MSP-console route
in §1, so an MSP operator's session can legitimately call it and it will behave
correctly. But it is a real architectural inconsistency worth recording for whoever
wires this screen: every other action on this same screen (list, detail, audit,
override) is designed against a dedicated `/msp/...`-prefixed route, while this one
action reuses the customer-facing route directly — there is no MSP-scoped invite
endpoint to point at instead, by design (§2675's own scope explicitly built override,
list, detail, and audit, not a second invite route). Not filed as a new issue: nothing
is broken, and building a redundant MSP-scoped invite endpoint that would do exactly
what the shared portal one already does is not a real product gap — it's a
same-endpoint-reuse decision a wiring session should simply be aware of rather than
assume is a design error to "fix" by inventing a parallel route.

The `override` drawer's own `eyebrow: "POST /break-glass/:id/admin-override"`
(`:4422`) is a shortened path (missing `/msp/customers/:customerId/` from the
middle) — consistent with this file's general convention of abbreviating eyebrow
strings for display elsewhere (e.g. `:4448`'s `"PATCH /msp/change-requests/:id"` also
drops `/api`), not a distinct route reference the way the invite one is. No finding.

---

## 6. Cross-surface edges

- **§1.4 and the portal's admin-override are the exact same function call**
  (`performBreakGlassAdminOverride()`) — same preconditions, same side effects, same
  response shape, same failure modes, per portal pack §8. A Design pass should treat
  override as one control with two entry points (customer-initiated vs
  operator-initiated), not two separate features.
- **§1.3's `attempts[]` is a superset of the portal's by-run `attempts[]`** — adds
  `entraUserPrincipalName` and `failedAttemptCount`, both real operator-facing fields
  the customer-side read does not expose (portal pack §8).
- **`resolvePendingContext()`** is the shared row-plus-ownership resolver behind
  §1.3, §1.4, and both portal-side equivalents — the "not found vs not yours → same
  404" discipline is structurally identical across all four call sites, not
  independently re-implemented here.
- **Same three tables, same write path as the portal side** — this module writes
  nothing on its own read routes (§1.1–§1.3, §1.5); only §1.4 writes, and only via the
  shared function. The `break_glass_verification_gate` workflow node (portal pack §4)
  is the only writer of `break_glass_pending_secrets` outside an override.

---

## 7. The forbidden list — declared, not merely absent

1. **No cross-customer read.** Every `:customerId`-scoped route resolves through
   `assertCustomerAccess` before any query runs; §1.3/§1.4 additionally re-check
   `ctx.secret.customerId !== customerId` explicitly. An MSP staff member scoped away
   from a tenant, or whose MSP doesn't own it, gets 404, never a distinguishable 403.
2. **No route in this module ever returns `linkToken` or the encrypted/vault-
   referenced secret value.** Confirmed by direct read of every response shape in
   §1 — the credential plaintext structurally cannot reach this console.
3. **No route in this module fabricates a pending secret, an attempt, or an audit
   row.** Every read is a real, derived query; a customer with zero break-glass
   activity returns an honest empty array (§4), never a fixture.
4. **Only one route in this module writes anything** (§1.4), and it writes through
   exactly one shared, already-audited implementation — there is no second,
   independently-implemented reset path to declare forbidden.

---

## 8. Provenance

Written 2026-09-11 against `main` (branch `agent/3668-q2340`), for #3668 (the
`docs/msp-console/`-specific contract-pack gap surfaced by the #3665 audit, rows 2 and
17), under Feature #2564. Read in full, not sampled: `msp-break-glass.ts` (356
lines), `docs/portal/break-glass-access-contract-pack.md` (666 lines, the existing
comprehensive pack this one deliberately does not duplicate), the relevant exported
surface of `break-glass-verification.ts` (`resolvePendingContext`,
`performBreakGlassAdminOverride`, `ELIGIBLE_ROLE_TEMPLATE_IDS`), the three-table
schema block in `lib/db/src/schema/msp.ts:4338-4427`, and the Break-glass screen's
full render block in `Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`
(list/detail/audit views and both action drawers). Verified live against local
PostgreSQL: all three tables' schemas confirmed to match the Drizzle source exactly,
and all three confirmed to hold 0 rows (§4). `artifacts/msp-console/src` and
`artifacts/portal/src` both grepped directly and confirmed to have zero real callers
of any break-glass endpoint today (expected pre-Design/pre-wire state, not a gap this
pack invents). One real, non-blocking observation recorded (§5's invite-route note) —
not filed as a new issue, because nothing is broken; documented here so a future
wiring session doesn't mistake it for a design defect. No product code, schema, or UI
was changed by this pass.

# Offboarding (MSP Console) — contract extraction pack for Claude Design

**#2634**, step 3 of **#2566** (Feature: Offboarding, MSP Console — the operator half of
#1653), under **#1571** (EPIC: Portal Admin — MSP-side operator surface). Follows the
**#1642 pattern**: per-surface wire contracts extracted verbatim and cited to file:line,
CURRENT vs DECIDED marked on every field, real enum unions only, cross-surface edges,
honest tri-state, forbidden list, orphaned endpoints listed explicitly. Read-only — no
product code, schema, or UI changed.

**This is a different surface from `docs/offboarding-contract-pack.md`, not a re-run of
it.** That pack (#2444, part of #1653 "Feature: Offboarding (Portal)") is scoped to the
**customer-facing** half of the same offboarding-adjacent surface —
`POST /api/portal/customer/offboard` and `GET /api/portal/customer/export`
(`portal-customer-engines.ts`) — where a customer cancels/exports their own account
directly. #2566 is the other half: the **MSP-console operator** surface that drives the
3-step `null → cancellation_requested → export_ready → archival_flagged` lifecycle for an
*entire MSP*. Both halves happen to share one route file (`msp-portal.ts`) and one
`msps.offboarding_state` column, but they are two different Features with two different
actors (MSPAdmin/PlatformAdmin here vs. CustomerUser there) — same split pattern as
`docs/sops-msp-console-contract-pack.md` vs `docs/sops-contract-pack.md`.

Backend route file: `artifacts/api-server/src/routes/msp-portal.ts` (all 3 routes real,
confirmed live and under test before any of this was written).

- `POST /api/msp/offboarding/request` — `msp-portal.ts:378-452`
- `POST /api/msp/offboarding/export` — `msp-portal.ts:459-595`
- `POST /api/msp/offboarding/archive` — `msp-portal.ts:601-681`

One read surface is in scope alongside them — the field the MSP-console UI will need to
render *current* offboarding state before offering the next action:

- `GET /api/msp/dashboard` — `msp-portal.ts:127-373`, `msp.offboardingState` /
  `offboardingRequestedAt` / `exportReadyAt` fields only (§1); the rest of that route's
  payload is a separate MSP-KPI-dashboard Feature, cited here only far enough to be
  honest about the field's real source, not analyzed field-by-field (same scope line
  `docs/offboarding-contract-pack.md` §1 already drew).

Schema: `lib/db/src/schema/msp.ts:31-32` (`MSP_OFFBOARDING_STATES`), `:37-68`
(`mspsTable`), `lib/db/src/schema/index.ts:37` (`MSP_ROLES`).
Auth: `artifacts/api-server/src/middlewares/requireAuth.ts:80-93` (`ROLE_ORDER`,
`roleIndex`), `:205-221` (`requireRole`).
`resolveMspIdStrict()`: `artifacts/api-server/src/lib/resolve-msp-id.ts`.
Tests confirming this is under real coverage, not just read from source:
`artifacts/api-server/src/routes/msp-portal.test.ts`.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03):

```
 id  |                    name                    | status | offboarding_state | offboarding_requested_at | export_ready_at | suspended_at
------+--------------------------------------------+--------+-------------------+--------------------------+-----------------+--------------
    1 | Shane McCaw Consulting                     | active |                   |                          |                 |
 1626 | Regression Testbed MSP (billing lifecycle) | active |                   |                          |                 |
```

Both real MSP rows in this environment carry `offboarding_state = null` — nobody has ever
exercised this state machine against local data. Every route below is real and tested,
but Design should know the pack's own example values are all `null`/pre-offboarding, not
a live mid-lifecycle sample.

---

## 0. What this surface is, and what it is not

**One MSP-scoped state machine, forward-only.** `msps.offboarding_state` — nullable,
3 named values, `null` is the real pre-offboarding default, not a 4th state. Three routes,
three role tiers, one direction:

```
null ──(MSPAdmin, §1)──▶ cancellation_requested ──(MSPAdmin, §2)──▶ export_ready ──(PlatformAdmin, §3)──▶ archival_flagged
```

There is no route anywhere in this codebase that resets `offboardingState` back to `null`
once set (confirmed by grep — `offboardingState:` is only ever assigned one of the 3
non-null values across the whole `artifacts/api-server` tree). This is the entire
operator-facing lifecycle; there is no "cancel the cancellation" action.

**Whole-MSP, not per-customer.** This is the MSP itself exiting the platform — every
customer under it, not one customer being offboarded from an MSP (that's the *other*
pack's `POST /api/portal/customer/offboard`, a CustomerUser self-service action scoped to
`mspId === 1` only). Confusing the two is the single easiest mistake Design could make
reading this pack alongside its sibling — they share vocabulary ("offboard") but operate
on different rows, at different scopes, for different actors.

**Not built yet, on the frontend.** `artifacts/msp-console` — the app these routes are
meant to serve — does not exist yet (confirmed via direct `ls artifacts/`: `admin-panel`,
`api-server`, `mcp-server`, `msp-website`, `portal`, `shane-mccaw-consulting` — no
`msp-console`). §0.1 below is the honest orphaned-consumer picture for that reason; this
is the same expected pre-scaffolding state `docs/sops-msp-console-contract-pack.md` §0
already documented for its own Feature.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/offboarding/request` | POST | `msp-portal.ts:378-452` | **Nothing found** | **Yes** |
| `/api/msp/offboarding/export` | POST | `msp-portal.ts:459-595` | **Nothing found** | **Yes** |
| `/api/msp/offboarding/archive` | POST | `msp-portal.ts:601-681` | **Nothing found** | **Yes** |

```
grep -rn "msp/offboarding" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src
```

returns no matches. All three are real, live, and covered by
`msp-portal.test.ts` — none is exercised by any current surface. **One real, read-only
consumer of the underlying column exists today, on a different route than this pack's
three writes**: `GET /api/admin/msps` (`msp-admin-settings.ts:86-135`, `offboardingState`
selected at `:123`) feeds the PlatformAdmin admin-panel's own MSP list/detail views
(`artifacts/admin-panel/src/pages/MspAdmin.tsx:395-398`,
`artifacts/admin-panel/src/components/ActiveDirectoryMspPane.tsx:167`) — both render the
value as a plain read-only badge, neither calls any of this pack's 3 write routes. Design
should know a PlatformAdmin already has a place to *see* `offboardingState` today, just
not to *act* on it — the MSP-console UI this Feature is building is the first surface
that will call `/request`, `/export`, or `/archive`.

Root cause, same one already tracked project-wide: `Design/msp-console/` has no export yet
(#2635, this pack's own sibling sub-issue, blocked on this pack landing first) and
`artifacts/msp-console` has no scaffolding. Expected state ahead of #2566's own
architect → build → pack → Design → wire sequence, not a bug — not filed as a new finding.

---

## 1. Wire contract — current-state read, `GET /api/msp/dashboard` (fields in scope only)

Auth: `requireRole("MSPOperator")` (`:129`) — MSPOperator or above passes (MSPAdmin,
PlatformAdmin too, per `ROLE_ORDER`, `requireAuth.ts:80-88`). No query params —
`resolveMspIdStrict(req)` (`:132`) reads `mspId` straight off the session, no
`?mspId=`/`?slug=` override even for PlatformAdmin. 403
`{ error: "MSP context required" }` if the session carries no `mspId` (`:133-136`).

The `msp` object on the response (`:224-234`), fields in this Feature's scope only:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `offboardingState` | `"cancellation_requested" \| "export_ready" \| "archival_flagged" \| null` | nullable — `null` is the real, pre-offboarding default | `msps.offboarding_state` |
| `offboardingRequestedAt` | `Date \| null` (serialises ISO) | nullable | `msps.offboarding_requested_at` |
| `exportReadyAt` | `Date \| null` (serialises ISO) | nullable | `msps.export_ready_at` |
| `status` | `"active" \| "suspended" \| "trial"` | not null | `msps.status` — read-only context; §3 is the one route in this pack that writes it |

This is the field set the MSP-console UI needs to decide which of the 3 actions below to
offer next (`null` → offer §1 request; `cancellation_requested` → offer §2 export;
`export_ready` → offer §3 archive; `archival_flagged` → terminal, offer nothing). The rest
of `/msp/dashboard`'s payload (customer counts, revenue, telemetry, idle bundles, AI
usage) is a separate MSP-KPI-dashboard Feature, out of scope here — cited only far enough
to be honest that `offboardingState` is one field on a much broader response, not its own
endpoint.

---

## 2. Wire contract — `POST /api/msp/offboarding/request` (`msp-portal.ts:378-452`)

Auth: `requireRole("MSPAdmin")` (`:380`) — MSPAdmin or PlatformAdmin only, one tier above
the dashboard read. No body params (handler ignores the body entirely).

State transition: `null → cancellation_requested`. 400 `{ error: "mspId required" }` if no
session `mspId` (`:384-387`). 404 `{ error: "MSP not found" }` if the `msps` row is gone
(`:395-398`). **409** `{ error: "Offboarding already in progress (state: <state>)",
offboardingState: <state> }` if `offboardingState` is already non-null (`:400-406`) — a
hard guard, not idempotent; calling it twice is a real 409, unlike §3.

On success (`:408-446`): sets `offboardingState = "cancellation_requested"`,
`offboardingRequestedAt = now`; inserts an `msp_event_store` row
(`eventType: "msp.cancellation_requested"`, `source: "msp-portal"`, `ownerType: "msp"`,
`:419-430`, actor role `req.user!.mspRole ?? "MSPAdmin"`); inserts an `msp_audit_logs` row
(`actionType: "msp.offboarding.request"`, `:433-443`). Response: `{ ok: true,
offboardingState: "cancellation_requested", requestedAt: <ISO> }`.

---

## 3. Wire contract — `POST /api/msp/offboarding/export` (`msp-portal.ts:459-595`)

Auth: `requireRole("MSPAdmin")` (`:461`). No body params.

State transition: `cancellation_requested → export_ready` (**not** gated on the caller
having actually called §2 first — see §6 honest-state note). 400
`{ error: "mspId required" }` (`:465-468`). 404 `{ error: "MSP not found" }`
(`:476-479`). 409 `{ error: "MSP is already archived" }` if `offboardingState ===
"archival_flagged"` (`:481-484`) — the only state this route refuses to run against;
every other state (including `null`) proceeds.

Builds a full customer data export package (`:486-547`) — every `tenants` row for this
`mspId`, plus per-customer `msp_event_store` event counts:

| Field | Type | Source |
|---|---|---|
| `exportedAt` | `string` (ISO) | generation time |
| `exportVersion` | `string` | hardcoded `"1.0"` |
| `msp.id`, `.name`, `.slug`, `.domain`, `.status`, `.createdAt` | — | `msps` row |
| `customers[]` | `Array<{ id, name, domain, industry, tenantId, status, tenantUrl, createdAt, eventCount }>` | `tenants` rows for this `mspId`, `name` = `tenants.customerName`; `eventCount` = per-customer `msp_event_store` row count (`:507-521`), `0` for a customer with no events |
| `summary.totalCustomers` | `number` | `customers.length` |
| `summary.activeCustomers` | `number` | count where `status === "active"` |
| `summary.totalEvents` | `number` | sum of all `eventCount` values |
| `notice` | `string` | fixed disclosure text: customer owns the data, re-onboard under a new MSP independently, "Direct MSP-to-MSP transfer is not supported in v1." (`:543-546`) |

`customers[]` deliberately omits an `ownerType` field the pre-restructure `msp_customers`
table carried — dropped, not synthesised, per the code comment (`:495-498`): `tenants`
has no successor column, and every `tenants` row already IS a customer, so the field
carries no information here.

State advance is **idempotent by design** (`:550`, comment: "idempotent — ok if already
`export_ready`") — re-calling `/export` while already `export_ready` regenerates and
returns a fresh export package (current data, not a cached one) but does **not**
re-write `exportReadyAt`, re-insert the `msp.export_ready` event, or re-insert the audit
log row (`:550-586` only runs `if (msp.offboardingState !== "export_ready")`). Response:
`{ ok: true, offboardingState: "export_ready", export: <package above> }` on every
successful call, cached-timestamp or not.

---

## 4. Wire contract — `POST /api/msp/offboarding/archive` (`msp-portal.ts:601-681`)

Auth: `requireRole("PlatformAdmin")` (`:603`) — the one route in this pack no MSPAdmin,
however privileged, can call; only the platform side confirms archival. **Not
`mspId`-scoped from session** — takes `mspId` as a request-body parameter (`:606-611`),
since a PlatformAdmin is confirming archival for a specific MSP, not their own. 400
`{ error: "mspId required in request body" }` if missing or non-numeric.

State transition: `export_ready → archival_flagged`. 404 `{ error: "MSP not found" }`
(`:619-622`). **Genuinely idempotent** (unlike §2/§3): if already `archival_flagged`,
returns `200 { ok: true, offboardingState: "archival_flagged", alreadyArchived: true }`
(`:624-627`) rather than an error. 409 `{ error: "Cannot archive — expected state
export_ready, got: <state>", offboardingState: <state> }` for every other state,
including `null` and `cancellation_requested` (`:629-635`) — this route cannot be used to
skip the export step.

On success (`:637-675`): sets `offboardingState = "archival_flagged"`, **also sets
`msps.status = "suspended"` and `suspendedAt = now`** (`:641-645`) — archival is not
purely an offboarding-state change, it also suspends the MSP record itself, the same
`status` field §1 and `GET /api/admin/msps` (§0.1) both read/surface. Inserts an
`msp_event_store` row (`eventType: "msp.archival_flagged"`, `ownerType: "platform"`, actor
role hardcoded `"PlatformAdmin"` rather than read off `req.user!.mspRole`, `:648-659`);
inserts an `msp_audit_logs` row (`actionType: "msp.offboarding.archive"`, `entityLabel:
msp.name`, `:661-672`). Response: `{ ok: true, offboardingState: "archival_flagged",
archivedAt: <ISO> }`.

The MSP record is **retained, never deleted** — the route comment says so explicitly
(`:598-599`), and the code confirms it: no `DELETE` anywhere in this pack, only `UPDATE`.

---

## 5. Real enum unions

- **Offboarding state** — `msps.offboarding_state` (`MSP_OFFBOARDING_STATES`,
  `msp.ts:31`): `"cancellation_requested" | "export_ready" | "archival_flagged"`,
  nullable — `null` is the real pre-offboarding default, not a 4th named state.
  Forward-only (§0) — no route resets it.
- **MSP status** — `msps.status` (`msp.ts:41`): `"active" | "suspended" | "trial"`. §4 is
  the only route in this pack that writes it (`→ "suspended"`).
- **MSP role hierarchy** — `MSP_ROLES` (`index.ts:37`): `["PlatformAdmin", "MSPAdmin",
  "MSPOperator", "CustomerUser", "ServiceAccount", "Free", "Assessment"]` — the array's
  declared order is NOT the privilege order used for gating. The real privilege order is
  `ROLE_ORDER` (`requireAuth.ts:80-88`), lowest to highest: `Assessment < Free <
  CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`. Every
  `requireRole(x)` call in this pack is a minimum-tier gate against `ROLE_ORDER`, not
  `MSP_ROLES`.

---

## 6. Honest-empty / partial-data contract

- **§2 (`/request`)**: the 409-on-already-in-progress is itself the honest signal — a
  caller cannot double-request by accident and get a silently-ignored no-op; it gets a
  real, distinguishable error naming the current state.
- **§3 (`/export`)**: genuinely idempotent-feeling but not fully idempotent — every call
  regenerates a real, current-data export package (never a stale cached one), but only
  the *first* call while `cancellation_requested` writes the state-advance
  event/audit rows. A caller re-exporting after `export_ready` gets a real package every
  time, just without a second audit-trail entry — an honest trade-off (avoids
  audit-log spam from repeated downloads), not a fixture.
- **§4 (`/archive`)**: `null → archival_flagged` cannot happen — the route hard-refuses
  every state except `export_ready` (or a no-op replay of `archival_flagged` itself). A
  PlatformAdmin cannot skip the export step by design, even by calling this route
  directly with the right `mspId`.
- **Local DB state (header)**: both real `msps` rows are currently `offboarding_state =
  null` — an honest zero-state, not a fixture. The MSP-console UI's very first real user
  action against this environment will be a genuine `null → cancellation_requested`
  transition, not a replay of pre-seeded data.

---

## 7. Cross-surface edges

- **`msps.status` is shared, not offboarding-exclusive.** §4 writes `status =
  "suspended"` — the exact same field/value the 7-day suspended-banner threshold (schema
  comment, `msp.ts:43-44`) reads, and the exact field `GET /api/admin/msps` (§0.1) already
  surfaces read-only in the PlatformAdmin admin-panel today. Archiving an MSP and
  suspending it for non-payment are two different real code paths that land on the
  identical `status` value; Design should know an `archival_flagged` MSP is
  indistinguishable from a suspended-for-other-reasons MSP by `status` alone —
  `offboardingState` is the field that actually disambiguates.
- **`GET /api/admin/msps` already reads the same column, on a different route, for a
  different UI.** (§0.1) — the admin-panel's MSP list/detail already renders
  `offboardingState` as a plain badge. This pack's 3 routes are the first surface that
  will ever *write* to it from a UI action; the admin-panel's read predates this
  Feature's own write path and is not built by, or dependent on, this pack.
- **`msp_event_store` write pattern.** All three of §2/§3/§4's lifecycle events
  (`msp.cancellation_requested`, `msp.export_ready`, `msp.archival_flagged`) land in the
  same table `GET /api/msp/events` reads (`msp-portal.ts:687-`). That route's own
  severity-derivation branch (`:729`) checks
  `r.eventType.startsWith("msp.offboarding")` — a prefix **none** of the three real event
  types above actually match (`msp.cancellation_requested` matches the *other* branch,
  `startsWith("msp.cancellation")`, at `:727`, and correctly gets `severity: "critical"`;
  `msp.export_ready` and `msp.archival_flagged` match neither branch and silently render
  at the default `severity: "info"`). This is a real, live bug in shipped code — already
  filed as **#2510** (sibling of #1653, the Portal-side Feature this event-severity code
  also affects); not re-filed here, just cited since it directly affects how a
  MSP-console UI's own events/audit view would render these lifecycle transitions if it
  ever surfaces severity.
- **`msp_audit_logs` is the one audit trail for this surface.** Unlike the customer-side
  pack's §5 (`POST /portal/customer/offboard`, which writes both a legacy
  `createAuditLog()` row and an `msp_audit_logs` row for the same action), all three
  routes here write **only** `msp_audit_logs` — no legacy audit-log call anywhere in
  `msp-portal.ts`'s offboarding block.

---

## 8. The forbidden list — declared, not merely absent

1. **No route resets `offboardingState` back to `null`.** Confirmed by grep — every
   assignment across `artifacts/api-server` writes one of the 3 non-null values. There is
   no "undo" action in this Feature's real backend today.
2. **No route can skip a step.** §3 refuses only `archival_flagged`; §4 refuses every
   state except `export_ready`. A PlatformAdmin cannot archive an MSP that never went
   through export, and an MSPAdmin re-requesting after `cancellation_requested` gets a
   409, not a silent re-trigger.
3. **§4 never deletes the MSP record.** Retained, `status → "suspended"` only — the route
   comment says so explicitly (`:598-599`) and no `DELETE` exists anywhere in this pack.
4. **§4 is not `mspId`-scoped from session, unlike §2/§3.** A PlatformAdmin names the
   target `mspId` in the request body — this is intentional (confirming archival for a
   *specific* MSP, not the caller's own), not a scoping bug; Design should build the
   MSP-console archival action to pass the specific MSP being reviewed, not assume the
   session's own `mspId`.

---

## 9. Open gaps — NOT decided (do not resolve; flag)

1. **All 3 routes are orphaned today** (§0.1) — no UI or tool caller exists yet. Expected
   pre-Design/pre-scaffolding state, not a defect, but the MSP-console UI (#2636, blocked
   on Design #2635, blocked on this pack) is the very first thing that will ever call
   them from outside a test file.
2. **§8's already-filed #2510** (event-severity misclassification) will affect this
   Feature's own future events view the same way it affects the Portal-side one — not a
   new finding, restated here so whoever builds the MSP-console events UI (if one is in
   scope for #2566) knows the severity field is unreliable for `msp.export_ready` /
   `msp.archival_flagged` today.
3. **Local DB has zero MSPs anywhere past `null` state** (header) — nobody has manually
   exercised `cancellation_requested`, `export_ready`, or `archival_flagged` against this
   environment. Design/QA will need to actually drive the state machine once through the
   real routes (or via direct SQL) to see the MSP-console UI's later states populated
   with anything but a fresh `null`.

---

## 10. Provenance

Extracted 2026-09-03 against branch `agent/2634-q1413`, a new pack (no prior version of
this MSP-console-scoped surface existed — `docs/offboarding-contract-pack.md`, part of
#1653/#2444, is the sibling customer-facing pack, not superseded or replaced by this one).
Full read of the 3 offboarding routes in `msp-portal.ts` (lines 375-681), the
`GET /msp/dashboard` fields in scope (`:127-373`), the `GET /msp/events` severity
derivation (`:687-737`), the Drizzle schema (`lib/db/src/schema/msp.ts:31-68`), auth
middleware (`requireAuth.ts:80-93, 205-221`). Live DB state confirmed via direct `psql`
against local `DATABASE_URL`: 2 real `msps` rows, both `offboarding_state = null`.
Consumer sweep: `grep -rn "msp/offboarding"` across `artifacts/portal/src`,
`artifacts/msp-website`, `artifacts/shane-mccaw-consulting`, `artifacts/admin-panel/src`
found zero write-route callers and one real read-only consumer of the underlying column
on a different route (`GET /api/admin/msps` → admin-panel's `MspAdmin.tsx` /
`ActiveDirectoryMspPane.tsx`), and confirmed `artifacts/msp-console` does not exist.
Architecture deltas cited to #1653, #2444, #2510, under Feature #2566 and epic #1571. No
new sub-issue filed — every gap in §9 either restates an already-filed finding (#2510) or
is an expected pre-Design/pre-scaffolding state, not a newly confirmed defect meeting this
project's finding bar. Read-only pass: no product code, schema, or UI was changed.

# Ownership / RACI — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Ownership / RACI**, two Features off one epic — **#1491** (Feature: Ownership / RACI
(Portal), the customer-facing matrix) and **#1686** (Feature: Ownership / RACI (MSP Console), the
operator half). Both sit under **#1485** (EPIC: Portal). Leaf issue: **#2592** (the #1642 pattern).
`msp-ownership.ts` was confirmed real and mature during #1519/#2523; this pack is the first
line-by-line audit of the whole module, not a re-read of that confirmation.

**Read this before drawing anything: only #1491's half is buildable as a page today.** #1491's own
structured index lists `#1726 — Claude Design export into Design/portal/` and `#1727 — wire the
portal UI` as still open, and `Design/portal/` carries **no** Ownership `.dc.html` export yet.
**#1686 (the MSP Console operator half) is explicitly `Status: NOT ARCHITECTED`** — its own issue
body says "Do not build from it in this state," blocked on the `artifacts/msp-console` scaffolding
(#1680). The backend for BOTH sides is real and finished (this pack proves it below), but only
#1491's side has a Feature ready to receive a design. **Do not draw an MSP-console-side page from
this pack** — its shape is real (§1b) but its screen does not exist as a spec yet.

---

## 0. The four surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/portal/ownership` | `artifacts/api-server/src/routes/portal-ownership.ts:420-543` | Customer (the page — #1491) | no |
| B | `POST /api/portal/ownership/*` (assign, reorder, accept, decline, delegations, delegations/end, rows) + `GET /api/portal/ownership/events` | same file, `:603-1191` | Customer (the page's own writes) | yes |
| C | `GET /api/msp/ownership/mine` | `artifacts/api-server/src/routes/msp-ownership.ts:71-173` | MSP operator (cross-customer — #1686, not yet architected) | no |
| D | `POST /api/msp/ownership/:customerId/*` (assign, accept, decline) | same file, `:230-500` | MSP operator (per-customer, cross-tenant-boundary — #1686) | yes |

Plus two settings-page surfaces that gate A–D rather than serving the matrix itself:

| # | Surface | File | Writes? |
|---|---|---|---|
| E | `GET/PUT /api/portal/settings/ownership(/policy)` | `artifacts/api-server/src/routes/portal-settings-ownership.ts:54-110` | yes (PUT) |
| F | `GET/PUT /api/portal/settings/ownership/workloads(/:key)` | same file, `:120-181` | yes (PUT) |

A/B is what #1491 draws. C/D is what #1686 will draw once architected. E/F are Settings-page
inputs both A/B and C/D read at request time — no design surface named in this pack owns them
directly; they exist today only as wire contract, matching the scope-stop every route header in
this module already states (`Design/portal/` has no Ownership export; `artifacts/portal` has no
page for it).

---

## 1. Per-surface wire contract

### 1a. `GET /api/portal/ownership` — the customer surface (A)

Source: `artifacts/api-server/src/routes/portal-ownership.ts:420-543`, assembled by
`gatherOwnershipObjects` (`:203-388`) and `lib/portal-ownership.ts`'s pure mappers. Customer-scoped:
`requireRole("CustomerUser")` (`:422`) — a **higher floor** than the neighbouring
`portal-change-control.ts`/`portal-remediation-tracker.ts`, which floor at `Assessment`; not a
security difference, a product one (`:69-77`). Customer is `resolveCustomerId(req)` off the JWT
(`:424`), never a request param.

**`WireOwnershipPayload`** (`:390-418`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `customer` | `{ id: number, name: string }` | never null | `391`, `504-505` |
| `sides` | `readonly string[]` — `[customerName, "MSP", "External"]` (`sidesFor`, `lib/portal-ownership.ts:134-137`) | never null, always 3 entries | `392` |
| `people` | `WireOwnPerson[]` — the tenant's own active users + the MSP's staff (§"the MSP is available") | never null, may be `[]` | `393`, `250-253` |
| `objects` | `WireOwnObject[]` — every real row across 5 live types | never null, may be `[]` | `394` |
| `sources` | `WireOwnSource[]` — one entry per of 8 object types, live/not | never null, fixed 8 entries | `395`, `509` |
| `currentUserId` | `string` — caller's own `people` id, or `""` if not on the roster | never null | `396-397`, `447` |
| `currentUserName` | `string` | never null, may be `""` | `398`, `511` |
| `tenantScoped` | `boolean` — see "fail closed, partially" below | never null | `399-404`, `512` |
| `overlay` | `WireOwnershipOverlay` (§1b) — this customer's saved edits | never null; empty arrays for a customer who never wrote | `405-411`, `513` |
| `gateMode` | `"strict" \| "loose"` (§3) — read-only here; written via surface E | never null | `412-417`, `514` |

**`WireOwnPerson`** (`lib/portal-ownership.ts:88-99`, built by `toWirePerson` `:199-209`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `string` — `personIdForUser(userId)` = `"u" + id` | never null | `89`, `144-146` |
| `name` | `string` — `users.name` trimmed, falls back to email | never null | `90`, `202` |
| `role` | `string` — `personRoleLabel`: jobTitle → department → mspRole-derived label → `"Team member"` | never null | `91`, `156-181` |
| `side` | `string` — the customer's own name, `"MSP"`, or `"External"` | never null | `93`, `199-209` |
| `kind` | `"Person" \| "Group" \| "Vendor"` — **always `"Person"` today**, nothing produces the other two | never null | `94`, `205` |
| `away` | `string` — a return date | **always `""`** — no column records it (§6) | `96`, `206` |
| `deputy` | `string` — another person's id, standing cover | **always `""`** — no column records it (§6) | `98`, `207` |

**`WireOwnObject`** (`:101-114`) — one per matrix row:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `type` | `OwnObjectType` (§3) | never null | `102` |
| `id` | `string` — opaque wire id, scheme differs per type (§2) | never null | `103` |
| `name` | `string` | never null | `104` |
| `sub` | `string` | never null, may be `""` | `105` |
| `r`, `a`, `c`, `i` | `string` — a `people[].id`, or `""` for a gap | never null; `c`/`i` are `""` for every object type today (§2) | `106-109` |
| `svc` | `string?` | absent on every mapper below — never populated | `110` |
| `when` | `string?` — a formatted date, `change` objects only | absent for other types | `111`, `335` |
| `over` | `boolean?` | absent on every mapper below — never populated | `112` |
| `link` | `string` — a fixed per-type copy string (`OWN_LINK_LABEL`, `:74-83`) | never null | `113` |

**`WireOwnSource`** (`:121-126`, built by `buildSources` `:435-448`) — exactly 8 entries, one per
`OwnObjectType`, always in this order: `workload`, `service`, `change`, `cr`, `freeze` (`live:
true`), then `control`, `incident`, `announce` (`live: false`, fixed `note` text, `count: 0`
always). This is the wire statement of §6's forbidden-object-types list — sent so the page can
state the limit rather than silently omit a group.

**Fail closed, partially, not totally** (`:60-67`): `resolveTenantScope` (`lib/portal-customer-
scope.ts`) returns `null` when the tenant row is missing, carries no `mspId`, or carries a **blank**
`tenantId` (an empty string would otherwise match every other blank-tenantId row — a real
cross-tenant leak avoided). When it returns `null`, `tenantScoped: false` and the two MSP-era
object groups (`change`, `cr`) — plus `workload`, which is *also* scoped through the same pair
(`:292-306`) — are simply omitted; the customer-id-keyed halves (`service`, `freeze`, `people`)
still serve. An unresolvable M365 identifier is a reason to serve less, never a reason to fail the
whole page.

### 1b. The write overlay (B) — `WireOwnershipOverlay` and its five write routes

`WireOwnershipOverlay` (`lib/portal-ownership.ts:563-567`): `{ assignments, delegations, rows }` —
the customer's saved edits, seeded into the client on every load of surface A so a reload shows real
state, not memory.

**`WireOwnAssignment`** (`:505-538`) — one row per `(customerId, objectId, roleKey, ownerPersonId)`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `objectId`, `roleKey`, `ownerPersonId` | `string` | never null | `506-508` |
| `acceptance` | `string` — `"" \| "pending" \| "accepted" \| "declined"` (§3) | never null, `""` default | `509` |
| `setBy` | `string` — display name/email of whoever assigned this holder | never null, may be `""` | `510` |
| `setAt` | `string` — `formatOwnDate` ("6 November 2026") | never null, may be `""` | `511` |
| `setWhy` | `string` — always the literal `"Changed on the ownership page"` (`WRITE_WHY`, `:555`) today; no UI passes a custom reason | never null | `512` |
| `order` | `number` — precedence within the cell, 0 = primary (§4 "multi-holder") | never null, `0` default | `513-520` |
| `respondedBy` | `string` — who actually accepted/declined, a **different party** from `setBy` | never null, `""` until responded | `522-527` |
| `respondedAt` | `string` | never null, `""` until responded | `528` |
| `declineReason` | `string` | never null, `""` unless `acceptance === "declined"` | `530-537` |

**`WireOwnDelegation`** (`:541-547`): `{ fromPersonId, toPersonId, until, scope, done }` — a dated
handover. `until` is **free text** ("22 September"), not a parsed date (`:753`). `scope` is `"all"`
or an object-type key, default `"all"` (`:755`, `:1010`).

**`WireOwnRow`** (`:550-556`): `{ rowId, source, objType, name, sub }` — a customer-added row.
`source` is `"custom"` (add-a-row) or `"coverage"` (promote a known-missing object); a coverage row
carries `objType`/`name`/`sub` as `""` because those come from a client-side fixture entry, not this
table (`:1080` — the one place in this whole module a client-side fixture is load-bearing, and
it is explicitly typed and named as such, not silently assumed).

**The five write routes** (all `requireRole("CustomerUser")`, all scoped by `scopedCustomerId` off
the JWT — never a body-supplied customer id):

| Route | Purpose | Notable behaviour | Line |
|---|---|---|---|
| `POST /portal/ownership/assign` | Set or clear one cell holder | Upserts on the 4-col unique key (§4); new holder appended to precedence, existing holder's rank untouched; appends one `portal_ownership_events` row in the same transaction | `603-709` |
| `POST /portal/ownership/reorder` | Reorder one cell's holders | Requires the **full** current holder set, no more/fewer — a partial list corrupts the omitted rows' relative rank; changes nothing about who MAY act | `721-788` |
| `POST /portal/ownership/accept` | Mark pending accepted | Update-only (no invented owner on a miss); `ownerPersonId` optional — omitted = every holder in the cell; strict-mode actor-must-equal-owner gate (§3) | `803-879` |
| `POST /portal/ownership/decline` | Mark pending declined | Same shape as accept; `reason` is **optional** here (customer-side — §3 "by-side asymmetry"); fires `notifyOwnershipDeclined` escalation to the assigner for r/a cells | `896-992` |
| `POST /portal/ownership/delegations` | Start a handover | `fromPersonId` is the **selected** person, not necessarily the caller — comes from the body | `999-1031` |
| `POST /portal/ownership/delegations/end` | End a handover | Flips `done`, never deletes — the record that a handover happened survives | `1038-1074` |
| `POST /portal/ownership/rows` | Add a row | Upserts on `(customerId, rowId)` — a coverage id promoted twice does not duplicate | `1083-1131` |
| `GET /portal/ownership/events` | One cell's append-only history | `objectId`+`roleKey` required query params, `ownerPersonId` optional narrowing (§4 "event log") | `1141-1191` |

### 1c. `GET /api/msp/ownership/mine` — the MSP cross-customer view (C, #1686/#1491-note-7)

Source: `artifacts/api-server/src/routes/msp-ownership.ts:71-173`. `requireRole("MSPOperator")`
(admits MSPOperator, MSPAdmin, PlatformAdmin — role hierarchy). `mspId` from
`resolveMspIdStrict(req)` — `req.user.mspId`, never a `?mspId=` override (`resolve-msp-id.ts:75-77`)
— 403s if null (`:77-80`).

**`WireMspOwnershipBook`** (`lib/msp-ownership-book.ts:62-67`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `mspPersonCount` | `number` — count of active MSP-side users on the caller's own MSP (§4 "who counts as me") | never null | `63`, `156` |
| `customerCount` | `number` — customers in the caller's scoped book | never null | `64`, `157` |
| `holdings` | `WireMspOwnHolding[]` — every resolved cell an MSP-side person holds, across every in-scope customer | never null, may be `[]` | `65`, `109-110` |
| `byCustomer` | `WireMspOwnCustomerCoverage[]` — **every** in-scope customer, including zero-count ones | never null, never a partial list | `66`, `110` |

**`WireMspOwnHolding`** (`:39-53`): `customerId`, `customerName`, `objectType`, `objectId`,
`objectName`, `sub`, `link` (the object's own real fields, resolved via `gatherOwnershipObjects` —
the *same* assembly surface A uses for itself, §4), `roleKey`, `holderPersonId`, `acceptance`,
`order`, `declineReason`.

**`WireMspOwnCustomerCoverage`** (`:56-60`): `{ customerId, customerName, count }` — present for
every customer whether or not the MSP holds anything there (`:134-137`, `:145-152`), because the
sparseness itself is real information (#1491 note 7).

Scoping mirrors `msp-executive.ts` exactly (`msp-ownership.ts:17-20`):
`resolveStaffScopedCustomerIds(req.user!)` folds any per-staff customer restriction into the book at
the DB level (`:98`), so a scoped MSPOperator never even sees a row for an out-of-scope customer,
let alone its ownership data. "MSP-side person" is exactly `MSP_SCOPED_ROLES = ["MSPAdmin",
"MSPOperator", "ServiceAccount"]` (`:69`) carrying the caller's own `mspId`, **plus**
`PlatformAdmin` (which carries none) — the identical set `users_role_scope_check` already
enforces (`:22-28`), nothing invented for this route.

### 1d. `POST /api/msp/ownership/:customerId/*` — the symmetric MSP-side writes (D, #2162/#1519)

Source: same file, `:175-500`. Exists because the customer-side write routes (§1b) are scoped by
`resolveCustomerId` off a **customer JWT** — an MSP staff member crossing the tenant boundary
carries no such token, so cannot reach them. These three routes are the missing set, scoped instead
by `requireCustomerScope("params")` — verifies `:customerId` belongs to the caller's own MSP,
honouring per-staff customer scoping (`middlewares/requireAuth.ts:374-`). Same tables, same
gate-mode lookup, same actor-must-equal-owner rule in strict mode as the customer-side routes.

| Route | Purpose | Notable difference from the customer-side twin | Line |
|---|---|---|---|
| `POST /msp/ownership/:customerId/assign` | Propose an MSP-side holder into a customer's cell | `ownerPersonId`, if given, **must** name an active MSPAdmin/MSPOperator of the caller's own MSP (`isMspPersonOfThisMsp`, `:212-228`) — this route can only place an MSP holder, never a customer's own user (that stays the customer-side `/assign`'s job) and never another MSP's staff | `230-334` |
| `POST /msp/ownership/:customerId/accept` | Accept a pending cell | Identical logic to the customer-side accept | `356-416` |
| `POST /msp/ownership/:customerId/decline` | Decline a pending cell | **`reason` is REQUIRED** here (400 if blank, `:441-444`) — the by-side asymmetry §3 documents: the MSP proposing itself and then declining means the scope conversation already happened before the click, so the reason box is the durable record | `429-500` |

---

## 2. Object-type sources, scoping, and wire id schemes (§the five/eight types)

| Type | Source table(s) | Scoped by | Wire id scheme | Gated on purchase? | Line (mapper) |
|---|---|---|---|---|---|
| `workload` | `tenant_service_plans` (Git #2008 real enabled M365 workloads, grouped) | `(mspId, tenantId)` via `resolveTenantScope`; further filtered by `resolveUntrackedWorkloadKeys` (§7, #1933) | `"wl-" + key` | **No** — #1523 settled RACI attaches to what the tenant *runs*, not what was bought | `portal-ownership.ts:386-398` |
| `service` | `client_services` ⋈ `services`, reached through `clientServicesTable.clientUserId → users.tenantId` | `tenants.id` (customerId) | `"svc-" + id` | implicitly yes (a `client_services` row is a purchase) | `:352-369` |
| `change` | `msp_message_center_items` where `actionRequiredByDateTime > now()` | `(mspId, tenantId)` | `graphMessageId` verbatim | n/a (Microsoft notices) | `:324-342` |
| `cr` | `msp_change_requests` | `(mspId, tenantId)` | `formatChangeRequestCode(id)` (e.g. `CR-2026-0148`) | n/a | `:285-304` |
| `freeze` | `portal_hold_windows` where `closedAt IS NULL` | `tenants.id` (customerId) | `holdKey` verbatim | n/a | `:417-429` |
| `control`, `incident`, `announce` | **none** | — | — | — | absent from `objects[]`; `sources[]` states `live: false` |

**The only two cells anywhere in the schema that resolve to a real name are on `cr` objects**
(`portal-ownership.ts` header, `lib/portal-ownership.ts:9-31`): `msp_change_requests.requested_by`
→ `r`, `msp_change_requests.approved_by` → `a` (`resolvePersonId`, `:228-240`; `null` until signed,
a real gap not a missing feature). **Every other cell of every other object type — all of
`workload`/`service`/`change`/`freeze`, and `c`/`i` on `cr` — is served as `""`**, an explicit gap,
until a customer or MSP staff member writes an overlay assignment over it (§1b). `resolvePersonId`
matches by email first, then display name, and resolves to `""` (a gap, not an invented person) for
any stored name/email that matches nobody currently on the roster.

**`c`/`i` are never guessed** (`lib/portal-ownership.ts:33-37`) — no row anywhere states who was
Consulted or Informed on anything; filling them with "the MSP"/"everyone" would invent an agreement
nobody made.

---

## 3. Real enum unions only

All verbatim, cited to line.

```ts
// portal-ownership.ts:57 (lib) — the matrix's own column order
OwnRoleKey = "r" | "a" | "c" | "i"

// portal-ownership.ts:60-68 (lib) — the eight object types the matrix groups by
OwnObjectType = "service" | "change" | "cr" | "control" | "freeze" | "incident" | "announce" | "workload"

// portal-ownership.ts:88-99, 92 (lib) — a person's side (computed by sidesFor, not stored)
side: string  // exactly [customerName, "MSP", "External"] — "External" is offered but nothing
              // currently produces a person with that side; no vendor/contractor table exists

// portal-ownership.ts:94 (lib) — kind
kind: "Person" | "Group" | "Vendor"  // ALWAYS "Person" today — "Group"/"Vendor" are typed,
                                      // never produced by any mapper in this file

// msp.ts:7690 — the five things that can happen to one cell holder (#1522, append-only log)
OWN_EVENT_TYPES = ["assigned", "accepted", "declined", "cleared", "reassigned"]

// portal-ownership.ts:477-485 (lib) — acceptance, application-layer text, no DB CHECK
acceptance: "" | "pending" | "accepted" | "declined"
  // "" and c/i cells never carry acceptance at all — only r/a, and only in "strict" gate mode

// msp.ts:7876 (portalOwnershipPolicyTable.gateMode) — the acceptance-gate enforcement level (#2162)
OWNERSHIP_GATE_MODES = ["strict", "loose"]   // no row for a customer = "loose" (the default)
```

**By-side decline-reason asymmetry (#1519), a genuine product rule, not an oversight:** customer-
side decline (`routes/portal-ownership.ts:896-992`) leaves `reason` optional and instead escalates
to the assigner (`notifyOwnershipDeclined`); MSP-side decline (`routes/msp-ownership.ts:429-500`)
requires `reason` and records no escalation notification of its own. Both write the same
`declineReason` column and the same `declined` event type — the difference is entirely in what each
route *requires* and what each route *notifies*, not in the schema.

---

## 4. Cross-surface edges and structural facts

- **Multi-holder cells, not single-A (#1515).** The unique index is
  `(customerId, objectId, roleKey, ownerPersonId)` — 4 columns, not 3 (`msp.ts:7678-7683`). All
  four RACI letters, not only A, permit multiple simultaneous holders; the textbook single-A rule
  "does not survive practice" (the schema's own comment cites NASA running three A's). `""` (a
  gap) is itself a valid distinct holder under this key.
- **Precedence is informational only (#1517).** `orderRank` (`msp.ts:7654-7667`) has **no**
  succession/activation/timeout logic reading it anywhere in the codebase — every holder in a cell
  carries identical authority regardless of rank. It exists solely so the UI can render "primary /
  second / third" and so `POST /portal/ownership/reorder` can change display order without a
  delete-and-reinsert that would lose a holder's acceptance/provenance.
- **Current state vs. append-only log (#1522).** `portal_ownership_assignments` is overwritten in
  place on every re-assert; `portal_ownership_events` (`msp.ts:7708-7734`) is the record that
  survives the overwrite — every write route inserts one event row in the *same transaction* as its
  current-state write, and nothing ever updates or deletes an event row. "Who held A when this RBD
  was signed" is a replay of the log as of a date, not a question the current-state table alone can
  answer.
- **The MSP is available to every cell, assigned to none, by default (#1520).** `people` on surface
  A includes the customer's MSP staff (`side: "MSP"`, resolved via `resolveCustomerMspId` —
  `tenants.mspId`, a *looser* pair than `resolveTenantScope`'s `(mspId, tenantId)`, because "who is
  our MSP" needs neither the M365 tenant GUID nor a live message-centre/CR row). There is no
  separate "the MSP" pseudo-person and no default placement — a customer places (or doesn't place)
  a named MSP staff member exactly like any other roster entry.
- **The two read surfaces share one object-assembly function.** `gatherOwnershipObjects`
  (`portal-ownership.ts:203-388`) is called by both surface A (for the customer's own page) and
  surface C (`msp-ownership.ts:140`, once per in-scope customer with any MSP-held rows) — so an
  MSP-side reader's resolved object name/type/sub/link is guaranteed identical to what that
  customer's own page would show, not a second parallel derivation.
- **An MSP-held assignment naming a stale object id resolves to nothing, not an invented row**
  (`msp-ownership-book.ts:86-114`, `resolveHoldingsForCustomer`) — a deleted CR or a since-reopened
  freeze window under a new key is silently skipped, the same "unresolvable → gap" discipline
  `resolvePersonId` applies on the customer side.
- **Settings→matrix edges.** Surface E's `gateMode` gates `initialAcceptance` (whether a fresh r/a
  assignment starts `"pending"` or takes effect immediately) and `actorMayRespond` (whether accept/
  decline is restricted to the named holder) on **both** A/B and C/D — one lookup
  (`lib/portal-ownership-policy.ts:23-30`), read fresh per request, no caching. Surface F's
  per-workload `tracked` flag is consulted **only** inside `gatherOwnershipObjects` (`:307-315`) to
  omit an untracked-but-still-enabled workload from `objects[]` entirely — it touches nothing else
  (not scanning, not `tenant_service_plans`, not alerting) and untracking a still-enabled workload
  writes its own `msp_diagnostic_findings` row (`ownership-workload-membership.ts:155-212`,
  `checkKey: "governance:untracked-workload:<key>"`) rather than silently suppressing anything.
- **Notification edges are all best-effort, never block the write.** `notifyOwnershipPending`
  (fires on a fresh strict-mode `pending` r/a assignment) and `notifyOwnershipDeclined` (fires on a
  customer-side r/a decline, escalating to `setByPersonId`, the assigner's own captured id — §7 "the
  escalation stops at the assigner, no management-hierarchy column exists to climb further") both
  swallow their own errors (`notification-center.ts:295-297`, `:361-363`) and route to either
  `customer_user` or `msp_user` recipient shape depending on which side of the tenant boundary the
  resolved `users` row sits on — dual-side by construction, not two separate notify functions.

---

## 5. The honest-empty contract

Two distinct honest-empty mechanisms; Design must render them distinctly:

1. **`tenantScoped: false`** (surface A, `:399-404`) — `resolveTenantScope` failed closed. `change`,
   `cr` and `workload` are absent **for that reason**, not because the tenant genuinely has none;
   `service`/`freeze`/`people` still serve. The page must distinguish "no resolvable M365 tenant"
   from "resolved, and genuinely zero."
2. **A gap cell (`r`/`a`/`c`/`i` === `""`)** — the matrix's own stated word for "nobody has ever
   assigned this," not a loading or error state. This is the **default, universal** state for
   almost every cell on a fresh tenant: only `cr.r`/`cr.a` can ever be non-empty without an overlay
   write, and only once a CR has been requested/approved.

**Live-DB honest-empty, confirmed this session** (queried against local `DATABASE_URL`, then the
connection became unreachable — see the caveat at the end of this section):
`portal_ownership_assignments` = **0** rows, `portal_ownership_events` = **0**,
`portal_ownership_delegations` = **0**, `portal_ownership_rows` = **0**,
`portal_ownership_policy` = **0** (every customer today is in the default `"loose"` gate mode),
`portal_ownership_workload_membership` = **0** (every enabled workload is tracked by default),
`tenants` = **2**. This corroborates #2523's own count from the same day (0 assignment rows,
`holdings: []`) — **the overlay has never been written to in local dev**, so surface A and C's
overlay/holdings fields are honest empties on every real request today, not a placeholder being
hidden. **Caveat:** the local Postgres connection went unreachable partway through this session's
own verification pass (repeated `psql` timeouts after this first successful batch) — the counts
above are real, queried values from before that point, not fabricated; no further live counts
(e.g. exact MSP-staff user count) were obtained after the connection dropped.

---

## 6. The forbidden list — what the module deliberately does NOT serve

Swept from the route/lib headers and named as forbidden, not merely absent:

- **`away` / `deputy` on a person.** Always `""` (`lib/portal-ownership.ts:206-207`). No column
  anywhere records a return date or a standing deputy; the design's "away" chip and cover-arrow
  have no backing data today.
- **`kind: "Group"` / `kind: "Vendor"`.** Typed in the wire shape, **never produced** — every
  mapper always emits `"Person"`. There is no group-roster or vendor-roster table.
- **`side: "External"` with a real person behind it.** `sidesFor` offers the label; nothing
  populates a person with that side — `people` is exactly the tenant's own active users plus its
  MSP's staff, nothing else.
- **`svc` / `over` on any `WireOwnObject`.** Both typed optional fields, **never set** by any of the
  five object mappers (`serviceObject`, `messageCentreObject`, `crObject`, `workloadObject`,
  `holdWindowObject`) — dead wire fields today.
- **`control`, `incident`, `announce` objects.** No table backs any of the three; `sources[]`
  states this explicitly (`live: false`, a fixed note) rather than the page silently showing an
  empty group with no explanation.
- **A guessed `c`/`i`.** Never inferred from "the MSP" or "everyone" — stays `""` until an overlay
  write names someone (`lib/portal-ownership.ts:33-37`).
- **A default MSP placement.** No template, no standard position — the MSP is available to every
  cell and assigned to none until a customer places a named MSP staff member (#1520).
- **"Accept it unowned" (the risk-toggle) as a persisted value.** Explicitly session-only
  (`portal-ownership.ts:95-98`) — recording that a gap is knowingly accepted is not one of the
  assign/handover/add-row flows this module's overlay wired, and the route header says so plainly
  rather than half-persisting it.
- **A `setWhy` other than the fixed literal.** Every write from both the customer and MSP sides
  writes the exact same `"Changed on the ownership page"` string (`WRITE_WHY`, both route files) —
  no UI passes a custom reason for an *assignment* (contrast `declineReason`, which is genuinely
  free text).
- **A management-hierarchy escalation beyond the direct assigner.** #1519's "escalates ... up their
  chain" language is only partially built: `notifyOwnershipDeclined` stops at `setByPersonId` (the
  direct assigner) because no reports-to/manager column exists anywhere in this schema to climb
  further — a real, already-filed gap (#2527, parented to #1491), not something this pack invents a
  fix for.
- **A `PortalOwnershipRow` id scheme cross-referencing `Design/portal_ownership_data.ts`-style
  fixtures.** There is no fixture module behind this route at all (unlike the old portal-v2 pattern)
  — `source: "coverage"` rows' `objType`/`name`/`sub` genuinely are `null` in this table
  (`portal-ownership.ts:1080`); the client is expected to carry the coverage fixture's descriptive
  text itself, and this pack states that as a real, named limit rather than treating it as an
  oversight.

---

## 7. Open questions and genuine gaps — not extraction gaps, and not built here

- **#1686 (MSP Console operator Feature) is NOT ARCHITECTED.** Surfaces C/D are real, finished,
  tested-by-inspection code — but the *screen* that would consume them has no architecture pass yet
  and is explicitly blocked on the `artifacts/msp-console` scaffolding (#1680). Building a page
  against §1c/§1d today would be building ahead of that Feature's own architecture conversation,
  which its own issue body forbids.
- **#1518/#1524 — "decide the fate of `portal_ownership_delegations`"** remains open on #1491's own
  structured index. The table and its two routes (§1b) are real and wired; whether its long-term
  shape changes is a decision this pack does not pre-empt.
- **#1521 — "cross-customer MSP view"** is the issue this pack's §1c documents; it and its successor
  #2523 are both closed/verified — no further gap there, listed here only so a reader tracing the
  issue numbers in this pack's own citations does not mistake it for still-open.
- **#2527 (open, parented #1491)** — the escalation-chain gap named in §6, already filed; this pack
  does not refile it, only cites it as the honest limit of `notifyOwnershipDeclined`.
- **No genuinely new gap was found during this pack's own audit** beyond what #1519/#2523's own
  sessions already surfaced and filed. This pack is extraction, not discovery — the module's real
  gaps (delegations' fate, #1686's architecture, the escalation chain) were already on record before
  this session started.

# Ownership / RACI — contract extraction pack

Step 3 of the per-module build sequence (`#1578`: schema → honest read → contract
pack → Design → wire), scoped to this one module per `#1577`'s scoping correction.
Everything below is **extracted, not authored** — every field is cited to its real
`file:line`. Where the architecture chat (`#1491` comment, 2026-08-28) has settled
something the code does not yet do, the field is marked `DECIDED` with the issue
that settled it. Anything with no issue number is an **OPEN GAP**, not a decision —
called out explicitly rather than silently treated as settled.

Sources:
- `artifacts/api-server/src/lib/portal-ownership.ts` — pure mapping layer (no db, no express)
- `artifacts/api-server/src/routes/portal-ownership.ts` — the route (`GET`/5×`POST`)
- `lib/db/src/schema/msp.ts:4681-4797` — the three `portal_ownership_*` tables
- `lib/db/src/schema/index.ts:622-646` — `client_services`
- `artifacts/msp-portal/src/components/portal-v2/{ownershipWire,ownershipModel,ownershipPersist}.ts`, `OwnershipMatrix.tsx`, `portalV2People.ts`
- `artifacts/msp-portal/src/pages/portal-v2-ownership.tsx`

## 1. Wire contract — `GET /api/portal/ownership`

`WireOwnershipPayload`, `artifacts/api-server/src/routes/portal-ownership.ts:149`:

| Field | Type | CURRENT / DECIDED |
|---|---|---|
| `customer.id` | `number` | CURRENT — `tenants.id` off the JWT |
| `customer.name` | `string` | CURRENT — `resolveTenantScope(customerId).tenantName`, falls back to `"Your organisation"` |
| `sides` | `string[]` | CURRENT shape, `sidesFor()` (`lib/portal-ownership.ts:116`) always returns `[customerName, "MSP", "External"]"`. `"MSP"` is now reachable — real MSP staff are returned with that side (`#1520`, built). `"External"` is still never emitted — no source for it exists. |
| `people` | `WireOwnPerson[]` | CURRENT — the customer's own tenant users **plus** the customer's MSP staff (`#1520`, built) — see below |
| `objects` | `WireOwnObject[]` | CURRENT for 4 of 7 declared types — see §4 |
| `sources` | `WireOwnSource[]` | CURRENT, `buildSources()` (`lib/portal-ownership.ts:384`) |
| `currentUserId` / `currentUserName` | `string` | CURRENT — resolved from the JWT email against the people list |
| `tenantScoped` | `boolean` | CURRENT — `false` means `resolveTenantScope` failed closed and `change`/`cr` were omitted, not that the tenant has none |
| `overlay` | `WireOwnershipOverlay` | CURRENT — the customer's own saved edits, see §3 |

### `WireOwnPerson` (`lib/portal-ownership.ts:70`)

Source: `users WHERE tenant_id = customerId AND is_active = true` (`routes/portal-ownership.ts:190-201`), **plus** `users WHERE msp_id = resolveCustomerMspId(customerId) AND msp_role IN ('MSPAdmin','MSPOperator') AND is_active = true` (`routes/portal-ownership.ts`, `#1520`, built). Same table, same `personIdForUser` id space — one query per side, concatenated.

| Field | Type | CURRENT / DECIDED |
|---|---|---|
| `id` | `string` | CURRENT — `"u" + users.id` (`personIdForUser`, `lib/portal-ownership.ts:126`) |
| `name` | `string` | CURRENT — `users.name`, falls back to `users.email` |
| `role` | `string` | CURRENT — `personRoleLabel()` (`lib/portal-ownership.ts:138`): `job_title` → `department` → an `mspRole`-keyed label (`"MSP Admin"` / `"MSP Operator"` added for `#1520`) → `"Team member"` |
| `side` | `string` | CURRENT — the customer's own name (`sides[0]`) for tenant users; `"MSP"` for MSP staff (`#1520`, built). No row is ever labelled `"External"` — no source for it exists. |
| `kind` | `"Person" \| "Group" \| "Vendor"` | Type is CURRENT (all three named on the wire); **every real row is hardcoded `"Person"`** (`toWirePerson`, `lib/portal-ownership.ts:183`). `"Group"` and `"Vendor"` never appear on live data — DECIDED to need real production, `#1516` (C/I holding groups) |
| `away` | `string` | Field exists and is read client-side (`OwnershipMatrix.tsx:1583`, `settingsModel.ts:61`), but **no column anywhere stores it** — always `""` on live data. Not partial-built: `#1517` records OOO/absence tracking as an explicit **non-goal**, so this field has no path to becoming real, not merely an unfinished one |
| `deputy` | `string` | Same as `away` — always `""` on live data, read by the same client panels. Distinct from the delegation *table* (§3), which does model a handover; this per-person field is not fed by it |

### `WireOwnObject` (`lib/portal-ownership.ts:83`)

| Field | Type | CURRENT / DECIDED |
|---|---|---|
| `type` | `OwnObjectType` (7-value union, see §5) | CURRENT for 4, unbacked for 3 |
| `id` | `string` | CURRENT — `"svc-" + id`, a Graph message id, `formatChangeRequestCode(id)`, or `holdKey` per type |
| `name` | `string` | CURRENT |
| `sub` | `string` | CURRENT — composed per type (status+milestone, service+category, status+window, gates prose) |
| `r`, `a`, `c`, `i` | `string` (person id or `""`) | CURRENT **only for `cr`** — `r` = `requestedBy` resolved, `a` = `approvedBy` resolved (the only two real stored names in the whole schema, per the route's own header, `routes/portal-ownership.ts:14-21`). All four are `""` on every `service`, `change`, and `freeze` row — a real gap, not a missing feature |
| `svc` | `string?` | **Declared, never emitted.** No real mapper (`serviceObject`, `crObject`, `messageCentreObject`, `holdWindowObject`) sets it. It is exactly the "which service this row belongs to" pointer `#1523`'s second comment describes for finding-inherits-from-service resolution — the wire shape already anticipates it; nothing populates it yet. DECIDED shape, unbuilt, `#1523` |
| `when` | `string?` | CURRENT — only `change` sets it (`formatOwnDate`) |
| `over` | `boolean?` | **Declared, never emitted.** Design fixture uses it as an overdue flag on a `change` row (`ownershipData.ts:157-158`); no real mapper sets it. OPEN GAP — no issue currently owns this specifically |
| `link` | `string` | CURRENT — `OWN_LINK_LABEL` per type (`lib/portal-ownership.ts:57`), copy from design |

### `WireOwnSource` (`lib/portal-ownership.ts:103`, built by `buildSources()` at `:384`)

CURRENT in full. One row per `OwnObjectType`, `live: true/false` + a `note` explaining an unbacked type — the honest-empty mechanism for the 3 declared-but-absent object types (see §6).

## 2. Write endpoints — 5×`POST`, all CURRENT, all consumed

Every write endpoint is scoped by `resolveCustomerId(req)` off the JWT
(`routes/portal-ownership.ts:419`); the object/person ids in request bodies are
opaque UI strings, never trusted to name a customer.

| Endpoint | Body | Behavior | UI caller |
|---|---|---|---|
| `POST /portal/ownership/assign` (`:445`) | `{objectId, roleKey: r\|a\|c\|i, ownerPersonId}` | Upsert on `(customer_id, object_id, role_key)`. `ownerPersonId: ""` is a real "cleared to a gap" value, accepted not rejected. `acceptance` set via `initialAcceptance()` | `OwnershipMatrix.tsx:583` |
| `POST /portal/ownership/accept` (`:498`) | `{objectId, roleKey}` | Update-only; flips `acceptance` to `"accepted"`. A miss returns `matched: false` rather than inventing a row | `OwnershipMatrix.tsx:593` |
| `POST /portal/ownership/delegations` (`:542`) | `{fromPersonId, toPersonId, until, scope}` | Insert. `scope` defaults to `"all"` | `OwnershipMatrix.tsx:620` |
| `POST /portal/ownership/delegations/end` (`:581`) | `{fromPersonId}` | Flips `done: true` on the active row(s); does not delete — "it ends by itself" without erasing that it happened | `OwnershipMatrix.tsx:628` |
| `POST /portal/ownership/rows` (`:626`) | `{rowId, source: custom\|coverage, objType, name, sub}` | Upsert on `(customer_id, row_id)`. `custom` requires `objType`+`name`; `coverage` rows may arrive blank (details come from the fixture entry being promoted) | `OwnershipMatrix.tsx:608` (custom) / `:1187` (coverage) |

**Endpoint-consumer audit result: all 2 read + 5 write endpoints have a real UI
caller.** No orphaned live endpoint found on this module — the standing rule
(file a sub-issue for a live-but-uncalled endpoint, `#1485` comment 2026-08-29) has
nothing to trigger on here.

**`initialAcceptance()` — `lib/portal-ownership.ts:421`** (cited exactly, matches
the architecture comment's own citation): `""` if no owner, `""` for `c`/`i`
always, `"pending"` otherwise. Acceptance is a closed 3-value set on real data
today: `"" | "pending" | "accepted"`. There is **no `"declined"` value anywhere in
the schema or either client model** (`ownershipModel.ts` / `ownershipWire.ts`) —
decline-as-a-resting-state is DECIDED (`#1519`) but entirely unbuilt.

## 3. The write overlay tables (all CURRENT, all per-customer, no FKs)

`lib/db/src/schema/msp.ts:4681-4797`. All three key on `customer_id` = `tenants.id`
with **no foreign keys**, matching every `portal_*` table in this era — the object
ids (`"svc-12"`, a change-request code, a Graph message id, a hold key, a
hand-added `"own-…"`) and person ids (`"u39"`) are opaque wire identifiers the read
layer assembles, not rows a constraint could point at.

- **`portal_ownership_assignments`** (`:4714`) — `customerId, objectId, roleKey, ownerPersonId, acceptance, setBy, setAt, setWhy`. **`uniqueIndex portal_ownership_assignments_customer_object_role_idx` on `(customer_id, object_id, role_key)` (`:4734`) — one holder per role per object, full stop.** Confirmed exactly as `#1515` describes: this caps **every** RACI letter at one holder, not just A. DECIDED to fix (allow multiple holders on all four, ordered on A), `#1515` — **not built**.
- **`portal_ownership_delegations`** (`:4750`) — `fromPersonId → toPersonId, until (free text), scope ("all" or an object-type key), done`. Models a reactive person-to-person handover with automatic revert (`done` flips, row never deletes). Its continued existence at all is an **OPEN GAP with an issue but no decision** — `#1524` records the case for dropping it (multi-holder A + no absence tracking make most of it structural) *and* the case for keeping it (customer-side dated cover is genuinely used) without resolving either way.
- **`portal_ownership_rows`** (`:4778`) — hand-added matrix rows, `source: "custom" | "coverage"`.

## 4. The MSP-as-holder gap — CLOSED for `#1520`, still open for `#1521`

**Built (`#1520`).** The people list is no longer built exclusively from `users
WHERE tenant_id = customerId AND is_active = true`. It is now that query **plus**
a second one — `users WHERE msp_id = resolveCustomerMspId(customerId) AND
msp_role IN ('MSPAdmin','MSPOperator') AND is_active = true`
(`routes/portal-ownership.ts`) — concatenated into one `people` array, MSP rows
carrying `side: "MSP"`. `resolveCustomerMspId` (`lib/portal-customer-scope.ts`)
resolves `tenants.mspId` directly rather than through `resolveTenantScope`,
because the owning MSP needs neither the M365 tenant GUID nor a live MSP-era row
to be known. A stored name/email still resolves to `""` when it matches nobody
on the now-merged roster (`resolvePersonId`, `lib/portal-ownership.ts:206-218`)
— the "no minted person" guard is unchanged, it now just checks a wider real
roster. MSP staff start on no cell; the customer places them like anyone else.
There is no MSP template and no default — that is `#1520`'s own settled
decision, restated in `lib/portal-ownership.ts`'s header.

`#1521` (cross-customer "what do I hold everywhere" MSP view) remains DECIDED
architecture with **no code yet** — `portal_ownership_assignments` is still
customer-keyed with no cross-tenant read path, and this pass did not add one.

## 5. Object-type scope — `OwnObjectType` (`lib/portal-ownership.ts:44`)

Real union, 7 values: `service | change | cr | control | freeze | incident |
announce`.

| Type | Live? | Source | Notes |
|---|---|---|---|
| `service` | ✅ live | `client_services ⋈ services`, reached through `client_services.client_user_id = users.id` on the customer's own tenant (`routes/portal-ownership.ts:211-222`) | **What the customer PURCHASED, not their M365 estate.** DECIDED to be wrong for RACI purposes, `#1523`: findings need workload rows (Exchange, SharePoint, Security, ICAM…) independent of what was bought — a customer who purchased only Monitoring still has Exchange findings needing an owner. Not built. |
| `change` | ✅ live | `msp_message_center_items` with `action_required_by_date_time` still in the future, capped at `MAX_CHANGES = 25` soonest-first (`routes/portal-ownership.ts:147, 244-264`) | Only served when `resolveTenantScope` succeeds |
| `cr` | ✅ live | `msp_change_requests`, same register as `portal-change-control.ts` | Only served when `resolveTenantScope` succeeds. The only type with real `r`/`a` |
| `freeze` | ✅ live | `portal_hold_windows` with `closed_at IS NULL` | |
| `control` | ❌ unbacked | — | `live: false`, note: `"No control register is stored yet."` |
| `incident` | ❌ unbacked | — | `live: false`, note: `"No incident record is stored yet."` |
| `announce` | ❌ unbacked | — | `live: false`, note: `"No announcement record is stored yet."` |

**DECIDED, not yet reflected in this list at all (`#1523`, resolved 2026-08-28,
then corrected same day):** governance artifacts (risks/RBDs, runbooks, SOPs) and
M365-estate objects both belong on the matrix — but **findings do NOT get their
own RACI row.** A finding inherits ownership from the service it belongs to
(*"who owns this finding" resolves through the service, not a cell someone
filled in*), which is exactly what the never-populated `svc` field on
`WireOwnObject` (§1) already has a slot for. Real tables this eventually reaches
into: `msp_risk_decisions` (`lib/db/src/schema/msp.ts:3928`), `msp_sops`
(`:3840`), `portal_runbooks` (`:4362`), `msp_diagnostic_findings` (`:2922`) — none
of them are touched by `portal-ownership.ts` today. Whether runbooks/SOPs/RBDs get
their **own** direct RACI rows or also just inherit from a service is explicitly
left open by the same comment.

## 6. Honest-empty / tri-state contract

The client's `OwnDataState = "loading" | "live" | "fixture"`
(`ownershipWire.ts:49`) is presented as three states, and the page's own comments
describe it that way (`portal-v2-ownership.tsx:64-92`). **On inspection it is
structurally two, not three**, worth stating plainly because the standing
convention here calls for `loading / live-genuinely-empty / read-failed` as
distinct states:

- `loading` — real, shown while the fetch is in flight (`portalV2People.ts:100`).
- `live` — real, shown only when `toOwnershipData()` (`ownershipWire.ts:261`)
  parses **at least one object AND at least one person**.
- `fixture` — set identically by three different causes, with **no field
  distinguishing which one happened**: an HTTP error (`res.ok === false`), a
  thrown exception (network/parse failure), and a successful response that
  parses to zero objects or zero people (`portalV2People.ts:178-198`). All three
  render the exact same `NoScanDataState`: *"We couldn't load your ownership
  matrix, or nothing has been assigned yet."* (`portal-v2-ownership.tsx:76-80`) —
  the copy itself admits the ambiguity rather than hiding it.

This is a genuine, honest state today — the UI never fabricates data on any of
the three causes — but it does not yet let a customer (or Shane) tell "your
matrix is really empty" apart from "the read broke." No issue currently owns
closing this gap; flagged here as an OPEN GAP, not filed as a new sub-issue
since it is a UI/observability refinement rather than a live-endpoint-with-no-
caller (the trigger condition for auto-filing per the `#1485` convention).

Also note: `dataState === "fixture"` no longer renders the design's fictional
Halden Materials fixture data on a real customer's screen — that was fixed
(Git #1342/#1343, cited in `ownershipWire.ts:9-17` and
`portal-v2-ownership.tsx:65-80`) specifically because doing so leaked invented
people as fact. `OWNERSHIP_FIXTURE` (`ownershipWire.ts:240`) survives only as the
module's standalone-mount default and as test data.

## 7. The forbidden list — swept from the route/lib headers

Declarations of things this module **deliberately does not serve**, named as
forbidden rather than left as silent absence (per the precedent set by
`portal-pii-governance.ts:1-42`, which documents an entire prior Design pass that
invented five sections — per-document findings, named sources, matched patterns,
an access matrix, a drift feed — none backed by any real content-inspection scan;
included here as the clearest existing statement of the failure this pack exists
to prevent):

- **No RACI table exists.** The schema answers at most 2 of the 4 RACI questions,
  and only for `cr` (`requested_by`/`approved_by`) — everything else is a
  structural gap, not a missing value (`lib/portal-ownership.ts:9-31`).
- **Consulted and Informed are never guessed.** No row records who was asked or
  told; filling `c`/`i` with an assumption ("the MSP", "everyone else") would
  invent an agreement nobody made (`lib/portal-ownership.ts:33-37`).
- **`"Accept it unowned"` (the risk toggle) is NOT persisted, deliberately** —
  session-only, not one of the assign/handover/add flows this pass wired
  (`routes/portal-ownership.ts:83-86`).
- **No person absent from the tenant's own roster is ever minted** into a matrix
  cell — an unmatched stored name/email resolves to `""`, not a synthetic person
  (`lib/portal-ownership.ts:196-204`).
- **No OOO/absence detection, no succession/activation logic, no timeout, no
  escalation routing, no justification field on a non-primary A signature** — all
  explicit non-goals, not gaps (`#1517`). The tool stores who is authorised and in
  what order; humans decide who acts.
- **No MSP template/default cell propagates to a customer's matrix** — the MSP is
  available to every matrix by virtue of being the MSP, never assigned by default
  (`#1520`, built — MSP staff now appear as real candidate holders, seeded into
  no cell).

## 8. Cross-surface edges touching this module

Per `#1577`'s incremental cross-surface map (built as each module's pack lands):

- **A → risk-acceptance authority.** `#1511`: whoever holds `a` on a risk-bearing
  object may sign that risk's RBD; because `a` can be multiple and any holder can
  act at any time, an RBD signature never waits on one specific individual. This
  was blocked on whether risks are even RACI'd objects — settled yes by `#1523`,
  then refined same-day to "risk acceptance is authorised by whoever holds A on
  the *service* the risk's finding belongs to," not a per-risk assignment. `#1520`
  (MSP holders not appearing on the matrix at all) is now built, so an MSP staffer
  can be the A this depends on; this edge is otherwise unchanged by this pass.
- **`msp_change_requests.requested_by` / `.approved_by`** are the only two real
  stored RACI names anywhere in the schema, shared with
  `portal-change-control.ts`'s own change-request register.
- **Shared `psa_ticket_id`** on `msp_change_requests` — the general cross-module
  ticket-linking key other modules also carry, not specific to this one.

## 9. CURRENT vs DECIDED — master table

| # | Statement | Status | Issue |
|---|---|---|---|
| 1 | 2 GET + 5 POST endpoints, all live, all consumed by real UI | CURRENT | — |
| 2 | `portal_ownership_assignments` unique on `(customer, object, role)` — one holder per role | CURRENT (and wrong) | `#1515` (fix DECIDED, not built) |
| 3 | All four RACI letters should allow multiple holders; A ordered, informational only | DECIDED, not built | `#1515`, `#1517` |
| 4 | Role = group of people; job role = individual; A/R must be individuals, C/I may be groups | DECIDED, not built (`kind` always `"Person"` on real data) | `#1516` |
| 5 | Acceptance gate is universal + symmetric across the tenant boundary (MSP included) | DECIDED, partially built (gate logic for r/a exists; cross-boundary + notification do not) | `#1518` |
| 6 | Whether C also carries the acceptance gate | **OPEN, undecided** | `#1518` (open sub-thread) |
| 7 | Decline is a resting state with a required reason field, separate from `setWhy` | DECIDED, not built (no `"declined"` value exists anywhere) | `#1519` |
| 8 | MSP available to every matrix, assigned to none, no default template | DECIDED, **built** — MSP staff merged into `people` with `side: "MSP"`, no default assignment | `#1520` |
| 9 | Cross-customer "what do I hold everywhere" MSP view | DECIDED, not built (`portal_ownership_assignments` is customer-keyed with no cross-tenant read path) | `#1521` |
| 10 | Per-cell append-only event log (assigned/accepted/declined/cleared/reassigned); current state becomes derived, not stored | DECIDED, not built (current tables ARE the record today) | `#1522` |
| 11 | Governance artifacts + M365 estate objects both belong on the matrix | DECIDED | `#1523` |
| 12 | Findings do NOT get their own RACI row — they inherit from the service | DECIDED (corrects an earlier same-day "yes, individually" answer) | `#1523` |
| 13 | `service` rows must become M365 workloads, not `client_services × services` purchases | DECIDED, not built | `#1523` |
| 14 | Whether runbooks/SOPs/RBDs are RACI'd directly or also inherit from a service | **OPEN, undecided** | `#1523` (trailing question) |
| 15 | Fate of `portal_ownership_delegations` — drop, keep customer-side only, or fold into holder membership | **OPEN, undecided** | `#1524` |
| 16 | OOO/absence management | Recorded **non-goal**, not a gap | `#1517` |

## 10. Recorded non-goal

**OOO / absence management (`#1517`).** The tool stores who is authorised and in
what order they are listed; it does not detect availability, time out, escalate,
or route. A senior handing work to a junior ("Rodney, go sign that RBD") is a
normal event under this model, not an exception path requiring succession logic.

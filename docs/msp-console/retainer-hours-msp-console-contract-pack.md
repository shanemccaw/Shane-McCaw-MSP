# Retainer Hours (MSP Console) — Contract Extraction Pack

**Module:** Retainer hours — MSP Console operator surface (`#2616`, part of `#2560` Feature: My
Architect (MSP Console), itself part of `#1571` EPIC: Portal Admin). Sibling surfaces: AdminV2
(`admin-retainer.ts`, platform-admin) and the customer-facing Portal read (`portal-retainer.ts`,
`#1285`/`#1569`).
**Method:** the `#1642` pattern — per-surface wire contracts extracted verbatim and cited to
file:line, CURRENT vs DECIDED marked on every field, real enum unions only, cross-surface edges,
honest tri-state, forbidden list, orphaned endpoints listed explicitly.
**Status of this document:** extracted, not authored. Every field below is cited to `file:line`.
Nothing here is invented; where a value does not exist in code it is marked **OPEN GAP**, not
filled in.
**Governing issue:** `#2616`, dispatched once the real backend landed on `#4020` (MSP Console
retainer-hours route, verified and closed) — the first, and to date only, real MSP-console-operator
route for this domain. `#2560`'s own body ("Not yet architected, no sub-issues filed") predates
this build; `#4020` is the actual first sub-issue.

---

## 0. How to read this pack

| Marker | Meaning |
|---|---|
| **CURRENT** | The field/behaviour exists and serves real data today. Design draws against it as-is. |
| **DECIDED** | The architecture is settled in an issue but **not built on this surface**. Design may draw the target, but must know it is unwired. Every DECIDED row carries its issue number. |
| **OPEN GAP** | Wanted, but **no issue decides it yet** for the MSP console specifically. Do not design a finished answer for it. |

**Source of truth for shapes:** `routes/admin-retainer.ts` exports the one real `Wire*` mapping
pair (`entryToWire`, `bucketToWire`) plus `SettingsWire`/`DEFAULT_RETAINED_MINUTES`/
`DEFAULT_RATE_CENTS` (`admin-retainer.ts:52-104`). `msp-retainer.ts` imports every one of these
verbatim (`msp-retainer.ts:76-82`) rather than re-deriving them — **one wire mapping across all
three surfaces** (AdminV2, MSP Console, customer Portal), not three that can drift apart. The one
addition this route makes is `closeToWire` for the period-close snapshot (`msp-retainer.ts:163-174`),
which has no AdminV2 or Portal counterpart — see §7.

**Live-data counts, queried against the local database at pack time** (2026-09-14, `psql
"$DATABASE_URL"`): all three retainer tables read **zero rows** — `retainer_settings`,
`retainer_work_log`, `retainer_period_closes`. This is a genuinely empty local dev database, not a
read failure — every table and route below is real, migrated, mounted schema with nothing in it
yet.

---

## 1. The live surface — one router, mounted, zero UI consumers

`msp-retainer.ts` is imported and `router.use()`-mounted in
`artifacts/api-server/src/routes/index.ts` (import `:99`, `router.use` `:436`):

| Route | Behaviour |
|---|---|
| `GET /api/msp/:mspId/retainer/customers` | This MSP's customers, each with its current-period bucket |
| `GET /api/msp/:mspId/customers/:customerId/retainer` | Settings, per-period summary list, full ledger, for one customer |
| `POST /api/msp/:mspId/customers/:customerId/retainer/entries` | Log hours |
| `PATCH /api/msp/:mspId/customers/:customerId/retainer/entries/:entryId` | Adjust one entry |
| `DELETE /api/msp/:mspId/customers/:customerId/retainer/entries/:entryId` | Remove one entry |
| `POST /api/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/close` | Close an ended period, freezing a bucket snapshot |
| `POST /api/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/reopen` | Reopen a closed period |

**Called from zero UI.** `artifacts/msp-console/src/api/` has no `retainer-api.ts` (confirmed by
directory listing at pack time — 33 other `*-api.ts` files exist, retainer is not among them), and
no `.tsx` under `artifacts/msp-console/src` references `/retainer`. This is the expected state for
this Feature at this point in its build order (architect → build the endpoints `#4020` → **this
pack** → Design → wire), not a defect — see §11.

**Auth, every route:** `requireCapability("ladder.msp-operator")` + `requireMspScope("params")`
(`msp-retainer.ts:218-219` and identically on every other route), **except reopen, which floors at
`requireCapability("ladder.msp-admin")`** (`:692`) — "undoes a lock another operator set" (route
header comment, `:18`). `requireMspScope("params")` (`requireAuth.ts:333-360+`) reads `:mspId` from
the URL, matches it against the caller's session `mspId`, and lets a `PlatformAdmin` bypass the
match entirely (`:343-346`) — there is no `?mspId=` override for a non-admin, session-scoped only.
Every route additionally calls `findMspCustomer`/`resolveCustomerOrRespond`
(`msp-retainer.ts:114-138`), a real IDOR guard: `404 { error: "Customer not found" }` unless
`tenants.id = :customerId AND tenants.mspId = :mspId` both hold — the same discipline
`msp-staff.ts` uses (route header, `:19`).

**Error envelope: uniformly `{ error: string }`, no `ApiErrorCode`, on every route in this file.**
A `LedgerConflict` thrown inside a ledger transaction is caught by `sendLedgerError`
(`:206-213`) and answers its own `status`/`message` verbatim; anything else is a generic `500`. This
matches the bare-`{error}` half of Change Control's already-documented envelope split (see that
pack's §1) — Design/wire must not assume a `code` field exists on this surface.

**Deliberately not on this surface:** writing `retainer_settings` (allotment, hourly rate,
architect name). That stays AdminV2-only (`PUT /admin/retainer/:customerId/settings`,
`admin-retainer.ts:248-297`) — route header, `:22-23`. An MSP operator reads the current settings
(§3) but cannot change them from this router.

---

## 2. `GET /msp/:mspId/retainer/customers` (`:216-310`)

Every tenant of `:mspId`, each with its current-period bucket, ordered by name
(`orderBy(tenantsTable.customerName)`, `:232`). No pagination, no filters.

Four bulk reads in one `Promise.all` (`:239-263`) — `retainer_settings`, `retainer_work_log`
(id/period/minutes only), `tenant_subscriptions` (most-recent-first per tenant, the same ordering
`anchorDayFromRows` requires), and `retainer_period_closes` (id/period only) — then joined in memory
per tenant, avoiding N+1 the same way `admin-retainer.ts`'s own customers-list route does
(`admin-retainer.ts:137-141`, cited there as Git #3473).

**Response `200`:**
```
{ customers: [{
    customerId: number, name: string,
    onRetainer: boolean,        // !!settings && settings.active
    configured: boolean,        // !!settings
    architectName: string | null,
    entryCount: number,
    latestClosedPeriod: string | null,   // NEW vs admin-retainer.ts — the newest closed periodKey, or null
    bucket: WireBucket,          // §5
}] }
```
`latestClosedPeriod` (`:299`) has **no AdminV2 counterpart** — AdminV2's own
`GET /admin/retainer/customers` (`admin-retainer.ts:109-183`) has no concept of a close at all,
since `retainer_period_closes` didn't exist when that route was written. This is a genuine,
one-directional shape divergence between the two "customers list" endpoints, not a bug — AdminV2
predates `#4020`.

---

## 3. `GET /msp/:mspId/customers/:customerId/retainer` (`:312-385`)

One customer's full picture: settings, every period worth summarising, the whole ledger.

**Response `200`:**
```
{
  customer: { customerId: number, name: string },
  settings: SettingsWire,          // §4, imported verbatim from admin-retainer.ts
  anchorDay: number,                // NOT on AdminV2's or Portal's own GET — see below
  currentPeriod: string,            // NOT on AdminV2's or Portal's own GET
  bucket: WireBucket,                // this period's live bucket
  periods: [{                        // NEW — no AdminV2 or Portal counterpart at all
    periodKey: string, endsAt: string, isCurrent: boolean, hasEnded: boolean,
    entryCount: number, bucket: WireBucket, closed: boolean, close: WireClose | null,
  }],
  entries: (WireEntry & { periodClosed: boolean })[],   // periodClosed is NEW per-entry
}
```
`periods` (`summaryPeriodKeys`, `retainer-period-close.ts:46-52`) is every period worth showing:
the current one, every period with ledger activity, and every closed period — newest first, no
duplicates. **For a closed period, `periods[].bucket` is always the LIVE bucket recomputed from
today's ledger** (`:356`, `computeMonthBucket` against `usedByPeriod`), while `periods[].close.bucket`
(`closeToWire`, §7) is the FROZEN snapshot taken at close time. These can differ only if a write
slipped past the lock — which is exactly `#4026`'s finding (§10) — so on this surface itself the two
should always agree; a UI comparing them is a real signal something bypassed the lock.

Neither AdminV2's nor Portal's own `GET` returns `anchorDay`, `currentPeriod`, `periods`, or
per-entry `periodClosed` — all four are genuinely new to this route, driven by period-close
existing only here.

---

## 4. `SettingsWire` and `WireEntry` — imported, not reshaped

**`SettingsWire`** (`admin-retainer.ts:60-67`, imported `msp-retainer.ts:81`): `customerId,
retainedHours (decimal, from minutesToHours), hourlyRateCents, architectName, active, configured`.
Built inline at `msp-retainer.ts:362-369` from the same `settings` row every other surface reads.

**`WireEntry`** (`entryToWire`, `admin-retainer.ts:69-87`, imported `msp-retainer.ts:79`): `id,
periodMonth, week, item, hours (decimal), minutes (raw int), pillar, pillarColor, finding, outcome,
state (display string, e.g. "In progress"), stateStored (raw enum value), source, sourceRefId,
occurredAt (ISO)`. `pillarColor` (`retainer-hours.ts:60-63`) maps a free-text `pillar` string
against a fixed 5-entry palette (`RETAINER_PILLAR_COLORS`, `:52-58`) with `"#E2E8F0"` as the
fallback for `null`/unrecognised — **`pillar` itself is free text on the wire, not a closed
enum**, matching the DB column (`pgTable`, no `{ enum: [...] }` on `pillar`).

`state` display strings (`RETAINER_STATE_DISPLAY`, `retainer-hours.ts:40-45`): `"In progress" |
"Closed" | "In review" | "Scheduled"` for the four real stored values `RETAINER_WORK_STATES =
["in_progress", "closed", "in_review", "scheduled"]` (`lib/db/src/schema/msp.ts:9145`). This is a
**real, closed enum** — `entryToWire` falls back to the raw stored value only if a row somehow
carries something outside the four (`?? row.state`, `admin-retainer.ts:81`), which the DB's own
`text(..., { enum: RETAINER_WORK_STATES })` column type makes unreachable in practice.

`source` (`RETAINER_WORK_SOURCES = ["change_control", "remediation_tracker", "unscoped"]`,
`msp.ts:9138`) is a real, closed 3-value enum, **never reshaped for display** — the wire carries
the raw value verbatim.

---

## 5. `WireBucket` (`bucketToWire`, `admin-retainer.ts:89-104`)

```
{ period: string,                    // this period's own anniversary-start ISO date
  retainedHours: number, rolledHours: number, usedHours: number, remainingHours: number,
  overHours: number, isOverMonth: boolean }
```
All five hour fields are `minutesToHours` (round to 1 decimal) of the underlying `MonthBucket`
(`retainer-hours.ts:149-168`) minute fields. **`overHours`/`isOverMonth` is the honest, UNCAPPED
over-allotment signal** — the route header's own comment (`admin-retainer.ts:96-102`) is explicit
that a consumer must render it from `isOverMonth`, never inferred from `remainingHours === 0`
(which is also true for a customer who used exactly their allotment). `remainingHours` is a floor-
at-0 balance, never negative — over-month lives entirely in the separate `overHours` field.

The rollover model (`computeMonthBucket`, `retainer-hours.ts:170-243`) is ROLLED-FIRST: unused
RETAINED minutes carry one period forward then expire; a customer's `retainedMinutes` is held
constant across periods (no per-period allotment history) — "a customer who changes bands
mid-history is a rare enough case that per-period allotment history is deliberately out of scope
here" (`:181-184`). Bounded to 240 periods of forward-walk as a safety valve (`:230`, "unreachable
in practice, a safety valve, not a real path").

**Periods are anniversary-anchored, not calendar-month (Git #3473).** `anchorDay` (1-31) resolves
per customer via `resolveRetainerAnchorDay`/`anchorDayFromRows`
(`retainer-period-anchor.ts:56-102`), in strict priority: (1) the active `tenant_subscriptions`
row's real `currentPeriodStart` day-of-month; (2) the most recent subscription row of ANY status
with a real `currentPeriodStart`; (3) `retainer_settings.createdAt`; (4) absolute fallback, day 1.
A short month clamps the anchor day to that month's real last day (`anchorDateInMonth`,
`retainer-hours.ts:94-98`) — day 31 in February lands on the 28th/29th, matching Stripe's own
anchoring. **Flagged, not solved:** if a customer's anchor day changes mid-history (a plan swap
shifting `currentPeriodStart`'s day-of-month), period keys logged under the OLD anchor won't line
up with keys computed under the NEW one (`retainer-hours.ts:29-36`) — no present impact (Shane
confirmed the ledger was agent-test data only, cleared as part of #3473) but a real, documented
edge case for Design to know about, not an OPEN GAP to redesign around yet.

---

## 6. Write routes — `entries` (create / adjust / delete)

### 6.1 `POST .../retainer/entries` (`:398-451`)

`createEntrySchema` (`:388-396`): `item` (1-1000 chars, required), `hours` (0-1000, required),
`pillar`/`finding` (≤100, nullable, optional), `outcome` (≤4000, nullable, optional), `state` (one
of `RETAINER_WORK_STATES`, optional — defaults `"in_progress"`, `:431`), `occurredAt` (ISO
datetime, optional — defaults `new Date()`, `:413`).

`periodMonth` is computed from `occurredAt` against the customer's own `anchorDay`
(`periodKeyOf`, `:414-415`) — **a back-dated `occurredAt` can log directly into a past period**,
gated only by that period's own close-lock check (§8), not by any "no back-dating" rule. `source`
is hardcoded `"unscoped"`, `sourceRefId: null` — this route only ever writes the lightweight
ad-hoc path; the two tracker-derived sources (`change_control`, `remediation_tracker`) come only
from the byproduct hook (§9), never from a direct MSP-console POST.

Success `201 { entry: { ...WireEntry, periodClosed: false } }` — `periodClosed` is hardcoded
`false` here (`:446`) because a just-created entry can only exist in an OPEN period (the lock
already rejected a closed one, §8).

### 6.2 `PATCH .../retainer/entries/:entryId` (`:453-544`)

`patchEntrySchema` (`:454-465`): every field from create, all optional, plus `week` (≤20, nullable)
— and a `.refine` requiring **at least one** field present (`"No fields to update"`). Undefined vs
explicit `null` is honoured field-by-field (`:503-518`) — `undefined` leaves a field untouched,
`null` clears it.

**Moving `occurredAt` can move an entry into a different period, and that TARGET period must also
be open** (`:509-517`) — not just the entry's current/origin period. If `targetPeriod !==
existing.periodMonth`, `assertPeriodOpen` is called a second time against the target before the
move is allowed (`:513`). A move between two open periods succeeds; a move INTO a closed period —
even from an open one — is rejected.

`404 { error: "Entry not found" }` when the entry doesn't match `id AND customerId AND mspId` all
three (`:498`) — the third leg (`mspId`) is what stops one MSP editing another's ledger row even if
somehow given a raw entry id, on top of the customer-scoping IDOR guard already applied upstream.

### 6.3 `DELETE .../retainer/entries/:entryId` (`:546-590`)

Same three-column lookup, same period-open gate on the entry's OWN period (deleting doesn't move
periods, so only one check). Success `200 { ok: true, id: entryId }`.

**All three of §6.1-6.3 run inside `withLedgerLock`** (`:141-146`) — a Postgres
`pg_advisory_xact_lock(4020, customerId)` held for the transaction's life, so a write can never
slip between the closed-period check and a concurrent close/reopen for the SAME customer. Different
customers never contend (the lock key is `(4020, customerId)`, not a global lock).

---

## 7. Period close / reopen

### 7.1 `POST .../periods/:periodKey/close` (`:597-687`)

`closeSchema` (`:593-595`): `note` (≤4000, nullable, optional). Preconditions, in order:

1. `retainer_settings` row must exist — `409 "This customer has no retainer configured, so there
   is no period to close."` (`:618-622`) — "a close snapshot of a default allotment the customer
   never bought would be invented figures" (inline comment, `:619`).
2. `periodKey` must be a genuine anniversary boundary for this customer's `anchorDay`
   (`isPeriodKeyForAnchor`, `retainer-period-close.ts:25-30`) — `400` with the real anchor day
   quoted back (`:626-629`) if not.
3. The period must have fully ended — `periodHasEnded` (`retainer-period-close.ts:38-40`) compares
   `now` against the period's own end instant; `409` quoting exactly when it CAN be closed
   (`:632-636`) if not — never mid-period, never in the future.
4. Inside the ledger lock: not already closed (`409`, `:641`).

On success, snapshots the bucket computed from every current ledger row filtered to that period
(`computeMonthBucket`, `:647-652`) into `retainer_period_closes`, including `hourlyRateCents` from
the LIVE settings row at close time (`:665`) — a later rate change does not retroactively alter an
already-closed period's frozen rate. `entryCount` (`:666`) counts only rows whose `periodMonth ===
periodKey` — a real count, not `entries.length` (which would be the customer's WHOLE ledger).
`closedByUserId` (`:668`) is `req.user?.id ?? null` — no session, no attribution, rather than a
fabricated actor.

Success `201 { close: WireClose }`.

### 7.2 `WireClose` (`closeToWire`, `:163-174`)

```
{ periodKey, anchorDay, hourlyRateCents, entryCount, note, closedByUserId,
  closedAt (ISO), bucket: WireBucket }
```
`bucket` runs the frozen snapshot columns back through `bucketFromCloseSnapshot`
(`retainer-period-close.ts:64-74`) then the same `bucketToWire` §5 uses — **one wire shape for a
live bucket and a frozen one**, not two.

### 7.3 `POST .../periods/:periodKey/reopen` (`:689-725`)

**Floors at `ladder.msp-admin`**, not `ladder.msp-operator` (`:692`) — the only route on this
surface with a stricter auth requirement than the rest. Deletes the `retainer_period_closes` row
(`:701-711`) — `404 "Period ... is not closed."` if none exists. Reopening has **no bucket-recompute
side effect**: the live bucket for that period simply becomes visible again on the next `GET`,
computed fresh from whatever the ledger holds at read time. Success `{ ok: true, periodKey }`.

**Reopen is destructive of the audit trail in one specific sense:** the frozen snapshot
(`retainer_period_closes` row, including who closed it and when) is hard-deleted, not archived —
there is no `retainer_period_close_history` or soft-delete column. The `audit`
(§8.1) call records the deleted row's values into `msp_audit_logs.metadata` (`:714-717`) as the
only surviving trace once the row itself is gone.

---

## 8. Cross-cutting mechanics

### 8.1 Audit logging (`audit`, `:176-204`)

Every write route calls `audit(...)` after its own DB transaction commits, inserting into
`msp_audit_logs` with `actionType` one of `RETAINER_HOURS_LOGGED | RETAINER_HOURS_ADJUSTED |
RETAINER_HOURS_DELETED | RETAINER_PERIOD_CLOSED | RETAINER_PERIOD_REOPENED`, `entityType` `
"retainer_work_log" | "retainer_period"`. **Non-fatal by design** — a `catch` logs the failure and
swallows it (`:201-203`), because "the ledger write already committed" (comment, `:176`); an audit
failure never rolls back or 500s a ledger write that already succeeded.

### 8.2 The ledger lock (§6, `withLedgerLock`, `:141-146`)

`SELECT pg_advisory_xact_lock(4020, customerId)` — `4020` (the governing Git issue number) is the
lock namespace constant (`LEDGER_LOCK_NAMESPACE`, `:89`), paired with `customerId` as the second
key. Held for the whole transaction, released automatically on commit/rollback (Postgres
transaction-scoped advisory lock semantics) — no explicit unlock call needed or present.

### 8.3 Period-close enforcement, on THIS router only

`assertPeriodOpen` (`:157-161`) is called inside the lock on every write (§6, §7) and throws
`LedgerConflict(409, ...)` if `retainer_period_closes` already carries a row for
`(customerId, periodKey)`. **This is the only place in the codebase this check happens** — see §10.

---

## 9. Cross-surface edges

| Edge | Mechanism | Marker |
|---|---|---|
| Wire shape sharing (settings/entry/bucket) | `msp-retainer.ts` imports `entryToWire`, `bucketToWire`, `SettingsWire`, `DEFAULT_RETAINED_MINUTES`, `DEFAULT_RATE_CENTS` from `admin-retainer.ts` verbatim (`:76-82`) — one mapping across AdminV2, MSP Console, and (via the same import chain) Portal | **CURRENT** |
| Anchor-day resolution sharing | `resolveRetainerAnchorDay`/`anchorDayFromRows` (`retainer-period-anchor.ts`) is the one resolution all 4 real consumers use — `portal-retainer.ts`, `admin-retainer.ts`, `retainer-work-logger.ts`, and this router (module doc, `retainer-period-anchor.ts:9-12`) | **CURRENT** |
| Tracker byproduct → ledger | `logRetainerWorkFromTracker` (`retainer-work-logger.ts:63-106`), called from `msp-changes.ts:556` (a CR reaching `completed`), `msp-remediation-checklist.ts:179`, `msp-remediation-tracker.ts:334`, `portal-remediation-checklist.ts:193`, `portal-remediation-tracker.ts:322` — a tracked item closing anywhere (MSP console OR customer portal) inserts a 0-minute `closed`-state ledger row, idempotent on `(source, sourceRefId)` | **CURRENT** |
| Tracker byproduct → period-close lock | **NOT wired.** `logRetainerWorkFromTracker` inserts unconditionally, with no `retainer_period_closes` check — confirmed by `#4026` (filed against `#4020`, parented `#2560`): "a back-dated `occurredAt`, or a period closed early, puts a row inside a closed period." Minutes are 0 at insert time so totals don't move immediately, but a later AdminV2 hours edit on that same row would | **NOT CURRENT — real gap, see §10; do not re-investigate, cited from `#4026`** |
| AdminV2 writes → period-close lock | **NOT wired.** `admin-retainer.ts`'s `POST .../unscoped`, `PATCH .../entry/:id`, `DELETE .../entry/:id` (`:311-431`) have no `retainerPeriodClosesTable` reference anywhere in the file — confirmed by the same `#4026` grep evidence (`grep -n "retainerPeriodClosesTable" artifacts/api-server/src` matches only `msp-retainer.ts` and its test) | **NOT CURRENT — real gap, see §10; do not re-investigate, cited from `#4026`** |
| Settings (allotment/rate/architect) | Written only by AdminV2 `PUT /admin/retainer/:customerId/settings` (`admin-retainer.ts:248-297`); read (never written) by this router and by Portal | **CURRENT**, `#1293` |
| Portal read → this router's writes | `portal-retainer.ts` reads the same `retainer_settings`/`retainer_work_log` rows this router writes, through the same `entryToWire`/`bucketToWire`. It has **no awareness of `retainer_period_closes`** at all — no `closed`/`periodClosed` flag on its own response shape (`portal-retainer.ts:102-116`) — because it is read-only and the close lock only gates writes; a closed period's entries still read normally there | **CURRENT (asymmetric by design — read-only surface has nothing to gate)** |

---

## 10. Findings surfaced while extracting this pack

**None new.** The one real gap on this surface — the period-close lock enforced only in
`msp-retainer.ts` and bypassable through AdminV2's three retainer-entry routes or the tracker
byproduct hook — was already found and filed during `#4020`'s own build, as `#4026` (parented
`#2560`, labelled `bug`). Per this issue's own dispatch instructions, it is cited here (§9) rather
than re-investigated or re-filed. `#4026` itself notes a real open product question ahead of a fix:
whether AdminV2 (platform admin) should honour the lock or deliberately override it, and what the
byproduct hook should do with a period closed out from under it (move the entry to the next open
period, or skip it) — both are decisions for `#4026`'s own resolution, not this pack's to make.

No other wire-shape inconsistency, orphaned live endpoint, or fixture-fallback risk was found on
this surface beyond what §1-§9 already document as CURRENT-but-unconsumed (expected, per the
build-order note in §1).

---

## 11. The honest tri-state, and the orphan-check discipline

Per `#1485`'s standing convention: *"a contract pack that finds a real, live endpoint the page does
not call is a sub-issue, filed at pack time."* **Every endpoint in this pack is currently
unconsumed** — but this is the expected, correct state for this Feature at this point in its build
order (architect → endpoint `#4020` → **this pack** → Design → wire), not a defect to file. No
Design or wire issue number exists yet for this Feature's MSP-console UI (unlike Change Control's
`#2578`/`#2579`) — that is the next real step this pack hands forward, not something to invent a
number for here.

There is no tri-state (loading/live-empty/read-failed) fixture-fallback question to raise for this
surface — there is no UI at all yet to have gotten that wrong. When a wire step eventually lands,
the same HARD RULE applies: no fixture fallback on a read failure or an unscoped MSP context.

---

## Appendix — source index

| Concern | File |
|---|---|
| MSP Console operator route (this pack's primary subject) | `artifacts/api-server/src/routes/msp-retainer.ts` |
| AdminV2 route (settings write, sibling ledger writes, no close-lock awareness) | `artifacts/api-server/src/routes/admin-retainer.ts` |
| Customer Portal read | `artifacts/api-server/src/routes/portal-retainer.ts` |
| Portal retainer billing (separate concern, not read for this pack) | `artifacts/api-server/src/routes/portal-retainer-billing.ts` |
| Pure ledger math (periods, buckets, rollover) | `artifacts/api-server/src/lib/retainer-hours.ts` |
| Anniversary anchor-day resolution | `artifacts/api-server/src/lib/retainer-period-anchor.ts` |
| Period-close pure rules (this router's own, Git #4020) | `artifacts/api-server/src/lib/retainer-period-close.ts` |
| Tracker byproduct hook (NOT close-lock-aware — `#4026`) | `artifacts/api-server/src/lib/retainer-work-logger.ts` |
| Byproduct hook call sites | `artifacts/api-server/src/routes/msp-changes.ts:556`, `msp-remediation-checklist.ts:179`, `msp-remediation-tracker.ts:334`, `portal-remediation-checklist.ts:193`, `portal-remediation-tracker.ts:322` |
| Stored rows + column enums | `lib/db/src/schema/msp.ts` (`:9105` `retainer_settings` onward) |
| Period-close table migration | `lib/db/migrations/manual/2026-09-14-retainer-period-closes-4020.sql` |
| Auth (capability gate, MSP scope guard) | `artifacts/api-server/src/middlewares/requireAuth.ts` (`:271-307` `requireCapability`, `:333-360+` `requireMspScope`) |
| Mount point | `artifacts/api-server/src/routes/index.ts` (`:99` import, `:436` `router.use`) |
| The real gap on this surface (cited, not re-investigated) | `#4026` — "Retainer period-close lock not honoured by AdminV2 retainer routes or the tracker byproduct hook", parented `#2560` |

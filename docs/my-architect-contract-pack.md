# My Architect (retainer) — contract extraction pack for Claude Design

**#1581**, following the method fixed by **#1577** (contract extraction pack, run per module),
under **#1569** ("Feature: My Architect" — the retainer surface) and **#1485** (EPIC: Portal New
Design). #1581 was gated behind #1588, #1590, #1582 and #1583 (all closed) precisely so this pack
would not document a fixture leak or an orphaned field as though it were real (see #1581's own
2026-08-30 comment) — that gate has now cleared.

Read-only. Every field below is extracted verbatim from the route's own wire mapper and the
Drizzle schema, cited to file:line. **Nothing here is authored or invented.** No product code, no
schema changes, no UI, no `drizzle-kit push`.

**Money fields are forbidden on this surface and are excluded even though the backend technically
serves one.** `retainerSettingsTable.hourlyRateCents` / `SettingsWire.hourlyRateCents` /
`entryToWire`'s absence of a rate are all real, live fields on the admin and portal routes below —
none of them appear in §1 or anywhere else in this pack as a field Design may render. See §6.

Backend routes:
`artifacts/api-server/src/routes/portal-retainer.ts` (customer-scoped, GET only — the one route
this pack is a contract for) and `artifacts/api-server/src/routes/admin-retainer.ts` (MSP-side
read/write; its `entryToWire`/`bucketToWire` mappers are re-exported and reused verbatim by the
portal route, §1).
Schema: `lib/db/src/schema/msp.ts:8537-8618` (`retainer_settings`, `retainer_work_log`);
`lib/db/src/schema/index.ts:1331-1350` (`status_reports`, borrowed — §5.3).
Domain logic: `artifacts/api-server/src/lib/retainer-hours.ts` (pure, unit-tested arithmetic).
Byproduct hook: `artifacts/api-server/src/lib/retainer-work-logger.ts`.
Seed migration: `lib/db/migrations/manual/2026-08-25-retainer-hours-1293.sql` (Git #1293).
Portal consumer: **none exists.** `artifacts/msp-portal` (the old portal-v2 codebase whose
`retainerModel.ts` / `useRetainerLive.ts` / `retainerData.ts` used to render this) was retired
wholesale on 2026-08-29 (`f40438cdc`, preserved at tag `portal-archive-2026-08-29`); the
replacement `artifacts/portal` scaffold under #1485 has exactly three real routes (`/`, `/support`,
`/coming-soon`, `App.tsx:56-58`) and no My Architect page, and no `Design/portal/` export exists
for it yet (`find Design -iname '*architect*' -o -iname '*retainer*'` → nothing). This module has
not been "not yet architected" since #1569 — it now has one, real, fully-formed backend contract
(this pack) and zero frontend debt to carry over, the same clean state `documents-contract-pack.md`
found for its own module.

---

## 0. The surface and its (absent) consumer

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/retainer` | GET | `portal-retainer.ts:56-117` | **nothing** — no live frontend route calls it | Yes, but see below |

**Not filed as a finding.** #1577/#1485's standing convention files a sub-issue for an orphaned
*live* endpoint a page should be calling and isn't. This orphaning is the opposite case: the
consumer was deleted along with all of `msp-portal`, and #1569 itself states the module is "not
yet architected" and holds sub-issues to be filed after the architecture conversation — i.e. the
page this route is *for* has not been built yet, on purpose, per the fixed build order
(architect → build the endpoints → regenerate the contract pack → Design → wire). This pack is
that third step; wiring is the fifth. Nothing to file.

The **admin** counterpart is fully live and consumed: `GET/PUT/POST/PATCH/DELETE
/api/admin/retainer/*` (`admin-retainer.ts:107-401`) is read/written by
`artifacts/admin-panel/src/adminv2/screens/retainer/{RetainerBody,RetainerFetchBridge,
retainerStore}.tsx` — Shane's own ledger-entry console. It is named here because `portal-retainer
.ts` re-exports and reuses its wire mappers (`entryToWire`, `bucketToWire`, `admin-retainer.ts:67-
102`) rather than duplicating them — one mapping shape for both sides, not two that can drift
apart (the same discipline noted in the admin route's own header comment, `admin-retainer.ts:53-
56`). The admin route's own write surface (settings PUT, unscoped-hours POST, entry PATCH/DELETE)
is out of this pack's scope — it is MSP-only, not something Design renders on the customer portal.

---

## 1. Wire contract — what exists today (CURRENT)

`GET /api/portal/retainer` reads `retainer_settings` and `retainer_work_log` (`msp.ts:8537-8618`),
scoped to the caller's own `customerId` (`resolveCustomerId`, a direct `tenants.id` equality —
`portal-retainer.ts:58-62`, no `(mspId, tenantId)` pair), plus a second, independently-scoped read
of `status_reports` (§5.3). There is no `Wire*`-named interface in this file — the response body
is built inline (`portal-retainer.ts:98-112`) from three reused/local mappers. Extracted verbatim
below in the same field-table shape the other packs use.

```ts
// portal-retainer.ts:98-112 — the route's actual response shape (verbatim, field names as sent)
{
  configured: boolean,
  settings: { retainedHours, hourlyRateCents, architectName, active } | null,
  bucket: ReturnType<typeof bucketToWire>,
  months: string[],                 // "YYYY-MM", newest first
  entries: ReturnType<typeof entryToWire>[],
  statusReports: ReturnType<typeof statusReportToWire>[],
}
```

### 1.1 `settings` — per-customer retainer configuration

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `retainedHours` | `retained_minutes_per_month` (`msp.ts:8542`), via `minutesToHours` (`retainer-hours.ts:44-46`) | integer, notNull, default 480 | no (whole object is `null` if unconfigured) | CURRENT — displayed in decimal hours, stored as integer minutes |
| `hourlyRateCents` | `hourly_rate_cents` (`msp.ts:8544`) | integer, notNull, default 30000 | no | **FORBIDDEN — see §6. Live on the route (`portal-retainer.ts:104`), never to be rendered.** |
| `architectName` | `architect_name` (`msp.ts:8546`) | text, nullable | yes | CURRENT — e.g. `"Priya Raman · M365 Architect"`; per-customer so the surface is parameterised rather than hardcoded to Shane, per #1569's own body. **#1588 (closed): a real fixture leak had `retainerModel.ts:168` hardcoding a person's name on this exact real data path — fixed before this pack was written; Design must render this field live, never a hardcoded name.** |
| `active` | `active` (`msp.ts:8547`), notNull default `true` | boolean | no | CURRENT |

`settings` is `null` (not an object with zeroed fields) when the customer has no
`retainer_settings` row at all — the honest-empty case, §7. Note `configured` is **not**
`settings !== null`; it is `!!settings && settings.active` (`portal-retainer.ts:99`) — an
inactive-but-configured retainer must not present as configured (proven by test,
`portal-retainer.test.ts:166-175`).

### 1.2 `bucket` — the current month's hour bucket, `bucketToWire` (`admin-retainer.ts:87-102`)

```ts
// admin-retainer.ts:87-102 — verbatim, shared by both admin and portal routes
{
  period: string,          // "YYYY-MM"
  retainedHours: number,
  rolledHours: number,
  usedHours: number,
  remainingHours: number,
  overHours: number,
  isOverMonth: boolean,
}
```

| Wire field | Source | Status |
|---|---|---|
| `period` | `MonthBucket.period`, the current calendar month (`periodMonthOf(new Date())`, `portal-retainer.ts:78`) | CURRENT |
| `retainedHours` | `MonthBucket.retainedMinutes` → hours | CURRENT — this month's allotment |
| `rolledHours` | `MonthBucket.rolledMinutes` → hours | CURRENT — unused **retained** minutes carried from last month once, then they expire (`retainer-hours.ts:106-124`; the rollover model this pack's §7 flags against #1569/#1590's "How the retainer works" copy) |
| `usedHours` | `MonthBucket.usedMinutes` → hours | CURRENT — honest, **uncapped** sum of this month's ledger |
| `remainingHours` | `MonthBucket.remainingMinutes` → hours | CURRENT — `max(0, retained + rolled − used)`, never negative |
| `overHours` | `MonthBucket.overMinutes` → hours | CURRENT — `max(0, used − (retained + rolled))`. **Over-month is a normal, explicit state, not an error** (`retainer-hours.ts:96-101`) |
| `isOverMonth` | `overMinutes > 0` | CURRENT — the flag Design must key its "Xh over" treatment off, never off `remainingHours === 0` (which is also true for exact-allotment usage, `admin-retainer.ts:94-101`) |

`months` (`portal-retainer.ts:109`) is the distinct set of `periodMonth` values present in the
customer's own ledger, sorted descending — the month-picker's real backing list, not every
calendar month since signup.

### 1.3 `entries` — the work-log ledger, `entryToWire` (`admin-retainer.ts:67-85`)

```ts
// admin-retainer.ts:67-85 — verbatim, shared by both admin and portal routes
{
  id: number,
  periodMonth: string,       // "YYYY-MM"
  week: string | null,
  item: string,
  hours: number,              // display, from `minutes`
  minutes: number,            // raw, integer
  pillar: string | null,
  pillarColor: string,        // derived, never null (falls back to a grey default)
  finding: string | null,
  outcome: string | null,
  state: string,               // display label, e.g. "In progress"
  stateStored: string,          // the raw enum value, e.g. "in_progress"
  source: string,               // enum, §3
  sourceRefId: number | null,
  occurredAt: string,           // ISO 8601
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `id` | `id` (`msp.ts:8581`) | serial | CURRENT |
| `periodMonth` | `period_month` (`msp.ts:8585`) | text, notNull | CURRENT |
| `week` | `week_label` (`msp.ts:8587`) | text, nullable | CURRENT — defaults from `occurredAt` at write time but is independently editable in AdminV2 |
| `item` | `item` (`msp.ts:8589`) | text, notNull | CURRENT — the work-item description |
| `hours` / `minutes` | `minutes` (`msp.ts:8591`) | integer, notNull, default 0 | CURRENT — hours is `minutesToHours(minutes)`, rounded to 0.5h granularity (`retainer-hours.ts:44-46`); the raw integer minutes travel alongside it, unrounded |
| `pillar` | `pillar` (`msp.ts:8593`) | text, nullable, **free text, no enum** | CURRENT — "Health / Compliance / Governance / Security / Adoption" by convention, not enforced |
| `pillarColor` | derived, `pillarColor()` (`retainer-hours.ts:38-41`) against `RETAINER_PILLAR_COLORS` (`retainer-hours.ts:30-36`) | — | CURRENT — a fixed 5-pillar palette; unrecognised/null pillar falls back to `#E2E8F0`, never omitted |
| `finding` | `finding` (`msp.ts:8595`) | text, nullable | CURRENT — e.g. `"HLT-02"`; the finding code this entry closed, if any |
| `outcome` | `outcome` (`msp.ts:8597`) | text, nullable | CURRENT — the result text shown on the customer's log |
| `state` / `stateStored` | `state` (`msp.ts:8598`), enum `RETAINER_WORK_STATES` | text, notNull, default `"in_progress"` | CURRENT — `state` is the display label (`RETAINER_STATE_DISPLAY`, §3), `stateStored` is the raw value |
| `source` | `source` (`msp.ts:8599`), enum `RETAINER_WORK_SOURCES` | text, notNull | CURRENT — §3, §4 |
| `sourceRefId` | `source_ref_id` (`msp.ts:8601`) | integer, nullable | CURRENT — a `msp_change_requests.id` or `remediation_tracker_steps.id`; `null` only for `source: "unscoped"` |
| `occurredAt` | `occurred_at` (`msp.ts:8605`) | timestamptz, notNull, default now | CURRENT |

### 1.4 `statusReports` — sent status reports for the caller's own tenant

```ts
// portal-retainer.ts:119-135 — statusReportToWire, verbatim
{
  id: number,
  title: string,
  period: string,                       // enum, §3
  executiveSummary: string | null,
  completedActivities: Array<{ title: string; description: string }>,
  keyOutcomes: string | null,
  reportDate: string | null,             // ISO 8601
  sentAt: string | null,                 // ISO 8601
  clientStatus: string,                  // enum, §3
  clientQuestion: string | null,
  adminReply: string | null,
  replyThread: Array<{ sender: "client" | "admin"; content: string; timestamp: string }>,
}
```

| Wire field | Source column | Status |
|---|---|---|
| `id`, `title` | `id`, `title` (`index.ts:1332,1335`) | CURRENT |
| `period` | `period` (`index.ts:1336`) | CURRENT — enum, §3 |
| `executiveSummary` | `executive_summary` (`index.ts:1338`) | CURRENT |
| `completedActivities` | `completed_activities`, jsonb (`index.ts:1339`) | CURRENT |
| `keyOutcomes` | `key_outcomes` (`index.ts:1340`) | CURRENT |
| `reportDate`, `sentAt` | `report_date`, `sent_at` (`index.ts:1342-1343`) | CURRENT |
| `clientStatus` | `client_status` (`index.ts:1344`) | CURRENT — enum, §3 |
| `clientQuestion` | `client_question` (`index.ts:1345`) | CURRENT — **read-only on this route; see §6, no portal write path exists** |
| `adminReply` | `admin_reply` (`index.ts:1346`) | CURRENT — same read-only note |
| `replyThread` | `reply_thread`, jsonb (`index.ts:1347`) | CURRENT — same read-only note |

`nextSteps` (`index.ts:1341`) and `projectId` (`index.ts:1333`) exist on the table but are **not**
in `statusReportToWire` — not served on this route (they belong to the admin
`status-reports`/kanban surface). Do not hand Design fields this route does not send.

Only rows with `reportStatus: "sent"` are returned — a draft the architect hasn't published yet is
never the customer's to see (`portal-retainer.ts:29-31, 94`), the same rule `portal-projects.ts`
already applies. Scoped through `resolveCustomerUserIds(customerId)` — the caller's `tenants.id`
fanned out to every `users.id` linked to that tenant (Git #1589, `tenant-signals.ts`), not a second
independent tenant resolution off the caller's own `req.user!.id` (§4).

---

## 2. Architecture: an assembled ledger, not a hand-typed one

Per #1569's own "architectural observation to start from": `retainer_work_log.source` /
`.source_ref_id` (`msp.ts:8599-8601`) mean the ledger was **built expecting derived entries**, not
only hand-typed ones — and that is exactly what shipped, unlike Security Plan's rows (which are
100% hand-typed with no FK to any owning module, `security-plan-contract-pack.md §2`).

`RETAINER_WORK_SOURCES = ["change_control", "remediation_tracker", "unscoped"]`
(`msp.ts:8570-8571`) is real and wired to two live byproduct call sites, both firing the shared
hook `logRetainerWorkFromTracker` (`retainer-work-logger.ts:62-104`):

| Trigger | Call site | Fires when |
|---|---|---|
| A change request closes | `msp-changes.ts:427-437` (hook block `:412-441`) | Transition **into** `completed` only (not a re-save of an already-completed CR); resolves the CR's free-text `tenantId` to a real `tenants.id` first, and skips (logged, not thrown) if no tenant row matches |
| A remediation checklist item completes | `portal-remediation-checklist.ts:162-171` (hook block `:157-171`) | `status === "completed"` **and** the actor role is in `RETAINER_MSP_ACTOR_ROLES` (`portal-remediation-checklist.ts:49`: `admin`, `PlatformAdmin`, `MSPOperator`, `MSPAdmin`) — never on a customer's own tick |
| A remediation tracker step completes | `portal-remediation-tracker.ts:333-342` (hook block `:322-342`) | Same actor-role gate (`portal-remediation-tracker.ts:86`), same idempotency |

Idempotent by design: `(source, source_ref_id)` carries a unique index
(`retainer_work_log_source_ref_uidx`, `msp.ts:8611-8614`) and every insert uses
`onConflictDoNothing` against it (`retainer-work-logger.ts:86-88`) — closing/re-completing the
same tracked item twice never double-logs. A byproduct row is written with `minutes: 0` and
`state: "closed"` (`retainer-work-logger.ts:73,80`) — **hours are the one thing nothing can
detect automatically**; Shane sets them afterward in AdminV2. `pillar` is pre-filled from a loose
category→pillar hint for change requests (`CATEGORY_PILLAR_HINT`, `retainer-work-logger.ts:30-39`
— an M365 workload category is not a true 1:1 with the five health pillars, so an unmapped
category stays `null` rather than guessing) and is otherwise left for Shane to assign.

**A known gap in the assembly, honestly carried forward, not fixed here:** the remediation-tracker
hook's own comment says "The step title/pillar catalogue lives in msp-portal, not reachable here"
(`portal-remediation-tracker.ts:329-330`) — written before `msp-portal` was deleted wholesale
(`f40438cdc`), so that catalogue no longer exists anywhere reachable. Both remediation-derived
entries land with a generic `item` label (`"Remediation step {stepId} completed"`,
`portal-remediation-tracker.ts:336`; `"Remediation item {checkKey} completed"`,
`portal-remediation-checklist.ts:165`) rather than the step's real human title. This is a real,
current authoring gap in the ledger's content, not a wire-contract gap — noted here because
Design should not assume every derived `item` string is as descriptive as the change-control-
derived ones (which carry the CR's real `title`, `msp-changes.ts:430`).

---

## 3. Real enum unions

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Ledger entry state | `in_progress`, `closed`, `in_review`, `scheduled` | `RETAINER_WORK_STATES`, `msp.ts:8577-8578`; Drizzle `text(...,{enum})`, not a Postgres `pgEnum`/CHECK (deliberate, so it can widen without a migration) | CURRENT — display labels in `RETAINER_STATE_DISPLAY` (`retainer-hours.ts:18-23`): "In progress" / "Closed" / "In review" / "Scheduled" |
| Ledger entry source | `change_control`, `remediation_tracker`, `unscoped` | `RETAINER_WORK_SOURCES`, `msp.ts:8570-8571` | CURRENT — §2 |
| Status report period | `weekly`, `monthly`, `executive_summary`, `other` | `index.ts:1336` | CURRENT |
| Status report status (draft/sent) | `draft`, `sent` | `index.ts:1337` | CURRENT — only `sent` reaches this route (§1.4) |
| Status report client status | `pending`, `accepted`, `has_questions` | `index.ts:1344` | CURRENT |

**Not an enum, deliberately free text:** `pillar` on `retainer_work_log` (§1.3) — "Health /
Compliance / Governance / Security / Adoption" is a documented convention, not a constrained
vocabulary; a fifth, sixth, or misspelled pillar string is not rejected by the schema. Design
should treat the known five (with their fixed colours, `retainer-hours.ts:30-36`) as the expected
set and must not invent a badge/state vocabulary beyond what is listed above — the same discipline
`security-plan-contract-pack.md` and `change-control-contract-pack.md` already establish.

---

## 4. Cross-surface edges — borrowed fields, named to their owning module

Per #1569's own body — "status reports and progress," "a timeline of architecture activity"
assembled from change control / remediation / SOP records, "a conversation channel," and
"documents" — My Architect is explicitly meant to be a view that draws from several other owned
modules, the same shape #1561 settled for Security Plan. Named here against each owning module's
own current state, not invented for this pack.

### 4.1 Change Control (#1486) — closed CRs that produced a ledger entry

**Status: contract pack shipped** (`docs/change-control-contract-pack.md`, DONE). The byproduct
hook (§2) reads `existing.title`, `.category`, `.linkedFinding`, `.description`
(`msp-changes.ts:428-434`) at close time and copies them into the ledger row — a one-time copy,
not a live join. A CR's title changing after close does **not** retroactively update the ledger
entry's `item`. If Design wants a live link back to the CR record (not just the copied text), that
join does not exist today — `retainer_work_log` carries only `source_ref_id`, an untyped integer,
with no FK constraint to `msp_change_requests.id` (compare to Security Plan's own `cr` field,
which has the identical gap, `security-plan-contract-pack.md §1.4`).

### 4.2 Remediation Tracking (#1489) — completed steps that produced a ledger entry

**Status: contract pack in flight** (`build-journal/1489.md`, not yet shipped as of this pack).
Same shape as §4.1: `source_ref_id` points at a `remediation_tracker_steps.id` with no FK, and the
copied `item`/`finding` text is a snapshot at completion time, degraded per §2's own noted gap
(generic label, real step title unreachable since `msp-portal`'s catalogue was deleted).

### 4.3 Status Reports / progress narrative — owned by this route directly, not borrowed

Unlike every other field in this section, `statusReports` (§1.4) is not a borrow from another
*module's* contract pack — `status_reports` has no separate portal-facing contract pack of its
own; it is only ever read here and written by the admin console (`admin-status-reports.ts`). It is
listed in this section anyway because it is **user-scoped** (`clientUserId` is a `users.id`), a
genuinely different id space from every other table this route reads (`customerId`, a
`tenants.id`) — Git #1589 is the fix that makes both halves of this one route resolve from a
single tenant claim instead of two independent resolutions that could disagree (§1.4, tested at
`portal-retainer.test.ts:178-259`). Design should treat `statusReports` as this route's own field,
governed by this route's own scope guard, not as an external join.

**The `clientQuestion` / `adminReply` / `replyThread` fields ARE the "conversation channel ('ask
box')" #1569's body describes** — not a separate module. There is a real, distinct **other**
conversation surface on the portal — Requests and Support Chat (#1659/#2450,
`docs/requests-and-support-chat-contract-pack.md`, ticket-based, its own `zoho-desk.ts` escalation
path) — and My Architect's ask box must not be conflated with it. They are two different
mechanisms: a status report's own threaded Q&A vs. a general support ticket. See §6 — this route
serves the thread read-only; there is no customer write path into it yet (§7).

### 4.4 Documents (#1658) — architecture documents referenced by the plan

**Status: contract pack shipped** (`docs/documents-contract-pack.md`, describing
`portal-documents.ts`'s 8 routes). #1569's body lists "Documents" as one of the five things this
surface contains. **Zero fields, links or references to any Documents-owned table exist anywhere
in `portal-retainer.ts` or the schema it reads.** This is a real, named, open gap — not filed as a
new finding because it already reads as exactly the same shape #1569's own body flags as unbuilt
("Not yet architected... Sub-issues to be filed after the architecture conversation"); recorded
here so Design is not handed an assumption that a document list rides along with this payload.

| Field it would need | Owning field (documents-contract-pack.md) | Status |
|---|---|---|
| A document/report associated with the architecture narrative | `WireInsightsDocument` / `WireReport` shapes (documents-contract-pack.md §1) | CURRENT there; **not consumed here — no wiring of any kind** |

---

## 5. Honest-empty contract & the tri-state

| State | Wire behaviour | Signal |
|---|---|---|
| No `retainer_settings` row for this customer | `configured: false`, `settings: null`, `bucket` computed against the **default** allotment (`DEFAULT_RETAINED_MINUTES = 480`, `admin-retainer.ts:50`) with `usedHours: 0`, `entries: []`, `months: []` (`portal-retainer.ts:76-77, 108-110`; proven by test, `portal-retainer.test.ts:116-127`) | `configured: false` |
| `retainer_settings` row exists but `active: false` | Same `configured: false` shape as above, **even though `settings` itself is non-null internally** — the route still reports `configured: false` (`portal-retainer.ts:99`, tested `portal-retainer.test.ts:166-175`) — Design must key off `configured`, never off `settings !== null` |
| Configured and active, zero ledger entries this month | `configured: true`, `bucket.usedHours: 0`, `bucket.remainingHours === bucket.retainedHours + bucket.rolledHours`, `entries: []` for the current month (other months may still have entries) | `configured: true`, real zero, not a fabricated placeholder |
| Read failed | Non-2xx; `500 { error: "Failed to load your retainer" }` (`portal-retainer.ts:114-115`) on any thrown error | HTTP 500 |
| No `customerId` claim on the session | `400 { error: "No customer scope on this session" }` (`portal-retainer.ts:59-61`) — never a DB read for someone else's ledger | HTTP 400 |

**`statusReports` is independent of `configured`** — a customer can have sent status reports with
no active retainer row, or vice versa (`portal-retainer.ts:38-39`, tested
`portal-retainer.test.ts:217-242`). An **unclaimed customer** (a `tenants.id` with zero linked
`users.id` rows) skips the `status_reports` query entirely rather than running an `inArray` against
an empty set — `resolveCustomerUserIds` returning `[]` short-circuits to `[]` with no DB read
(`portal-retainer.ts:86-88`, tested `portal-retainer.test.ts:244-258`), the fail-closed pattern
this pack's siblings also require.

There is no "coverage" block on this route (contrast Security Plan / Risk Register's `coverage`
shape) — nothing here is scan-derived, so there is no completeness ratio to report.

---

## 6. The forbidden list — declared, not merely absent

1. **Money fields are forbidden on this surface, full stop — per #1581's own dispatch
   instruction.** `hourlyRateCents` is a real, live field on `settings`
   (`portal-retainer.ts:104`, `msp.ts:8544`) — it must never be rendered, never surfaced in any
   derived total, and never used to compute a dollar figure client-side. This is a stronger rule
   than "not served today": it is served today, and Design must drop it, not merely decline to ask
   for more of it. (The customer's separate billing-plan surface — monthly⟷yearly interval
   switching, Stripe subscription schedules — lives entirely on
   `artifacts/api-server/src/routes/portal-retainer-billing.ts`, a different route this pack does
   not extract from at all; do not conflate the two.)
2. **No customer write path of any kind on this route.** `portal-retainer.ts` is GET-only — no
   POST/PATCH/DELETE exists. Every write (settings, unscoped hours, entry edits) is
   `requireAdmin`-gated on `admin-retainer.ts`. A customer reads their own ledger; they do not log
   hours, edit entries, or configure their own allotment.
3. **No customer write into the ask box.** `clientQuestion` / `adminReply` / `replyThread` are
   served read-only (§1.4, §4.3); the only writers are `admin-status-reports.ts`'s
   `POST /admin/status-reports/:id/reply` and `/:id/thread` (both `requireAdmin`). If a customer-
   side reply is wanted, that is a new write endpoint to build, not something this pack should
   pretend already exists.
4. **No server-side re-derivation beyond what `computeMonthBucket` already provides.** The
   rolled/used/remaining/over arithmetic is computed once, server-side, from the ledger
   (`retainer-hours.ts:125-172`) — there is no separate client-side recomputation path to keep in
   sync (contrast Security Plan, where the derived figures are deliberately client-side only,
   `security-plan-contract-pack.md §1`). Design should treat `bucket` as the single source of
   truth for the month's numbers, not re-derive them from `entries`.
5. **No fixture fallback on this route.** There is no `retainerData.ts`-equivalent file left
   anywhere in `artifacts/api-server`; the empty/unconfigured case renders the real
   `DEFAULT_RETAINED_MINUTES` default, not a fabricated customer's worth of demo rows. (The old
   `msp-portal retainerData.ts` fixture no longer exists at all — deleted with the rest of
   `msp-portal`, not merely unused.)
6. **`RET_TERMS` / "how the retainer works" copy is static per-account policy prose, not a
   database-backed field — carried forward from #1590's own note (added to #1581 2026-08-31,
   quoted in full since its own target file no longer exists to read):** *"How the retainer works"
   / terms is static per-account policy copy, not a per-customer DB-backed field... mark it
   `DECIDED: static copy, no backend table` rather than treating an empty array as evidence nothing
   exists to build.* Nothing in `retainer_settings` or `retainer_work_log` carries a terms/policy
   text column, and none should be added for this — Design should render fixed prose (or omit the
   section) here, not a served field.

---

## 7. Open, flagged — not resolved

1. **Customer-side ask-box replies are unbuilt.** §6.3. If My Architect's design wants the
   customer to actually type into the thread (not just read it), that write endpoint does not
   exist on any portal route today. Not filed as a new sub-issue — this is exactly the shape of
   "not yet architected" #1569's own body already names, deferred to the sub-issues #1569 says
   will be filed after the architecture conversation.
2. **Whether hours are logged manually, derived from linked records, or both — #1569's own stated
   open question.** §2 shows the real answer as built: **both**, already live (`unscoped` for
   manual, `change_control`/`remediation_tracker` for derived) — this pack settles what is *built*,
   not what Design should *decide*; #1569 may still want to state this as policy explicitly.
3. **Documents integration, §4.4.** No wiring exists. Left open rather than built, per the fixed
   Portal build order (architect → endpoints → contract pack → Design → wire) — a contract pack is
   not the step that adds a new join.
4. **Whether the derived-entry `item` label should carry the real remediation step title.** §2's
   noted degradation (`msp-portal`'s step catalogue no longer reachable) is a real, current gap in
   ledger *content* quality, not a wire-contract defect — flagged here, not fixed, since fixing it
   is a remediation-tracker-side catalogue problem, out of this pack's read-only scope.

---

## 8. Provenance

Extracted 2026-09-03 against branch `agent/1581-q1393`. Sources cited inline by file:line:
`artifacts/api-server/src/routes/portal-retainer.ts`, `admin-retainer.ts`,
`portal-retainer-billing.ts` (named only to exclude it, §6.1), `msp-changes.ts`,
`portal-remediation-checklist.ts`, `portal-remediation-tracker.ts`, `admin-status-reports.ts`;
`artifacts/api-server/src/lib/retainer-hours.ts`, `retainer-work-logger.ts`;
`lib/db/src/schema/msp.ts:8537-8618`, `lib/db/src/schema/index.ts:1331-1350`;
`lib/db/migrations/manual/2026-08-25-retainer-hours-1293.sql`;
`artifacts/api-server/src/routes/portal-retainer.test.ts`. Confirmed no live frontend consumer via
`artifacts/portal/src/App.tsx:56-58` and a repo-wide search for `*retainer*`/`*architect*` under
`artifacts/portal` and `Design/portal` (neither exists). Architecture context cited to GitHub
issues #1569, #1577, #1581 (and its four now-closed blockers #1582, #1583, #1588, #1590), #1485.
Sibling contract packs cited: `docs/security-plan-contract-pack.md` (method precedent),
`docs/change-control-contract-pack.md`, `docs/documents-contract-pack.md`,
`docs/requests-and-support-chat-contract-pack.md`. Read-only pass: no product code, schema, or UI
was changed.

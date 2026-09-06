# Change Control — Contract Extraction Pack

**Module:** Change Control (`#1486`, part of `#1485` EPIC: Portal New Design)
**Method:** step 3 of `#1578` (schema → honest read → **contract pack** → Design → wire), run per `#1577`.
**Status of this document:** extracted, not authored. Every field below is cited to `file:line`.
Nothing here is invented; where a value does not exist in code it is marked **OPEN GAP**, not filled in.

> **Why this pack is not a straight `Wire*` dump (`#1577`).** Five existing contracts are now known
> to be wrong, and Change Control owns one of them: it has **no approve / reject / rollback** — five
> dead buttons in the prototype (proto 1513–1524, no `onClick`), tracked as `#1496`. Handing Design
> the current contract as-is would hand it a spec already decided broken. Every row is therefore
> marked **CURRENT** (serves real data today) or **DECIDED** (architecture settled, not built — with
> its issue number). A DECIDED row with no issue number is an **OPEN GAP**, and says so.

---

## 0. How to read this pack

| Marker | Meaning |
|---|---|
| **CURRENT** | The field/behaviour exists and serves real data today. Design draws against it as-is. |
| **DECIDED** | The architecture is settled in an issue but **not built**. Design may draw the target, but must know it is not wired. Every DECIDED row carries its issue number. |
| **OPEN GAP** | Wanted, but **no issue decides it yet**. Not decided. Do not design a finished answer for it. |

**Source of truth for shapes:** the route's own `Wire*` interfaces, not the design fixtures.
Primary sources:
- Route: `artifacts/api-server/src/routes/portal-change-control.ts` (`WireChangeRequest` at **:157**).
- Pure derivations: `artifacts/api-server/src/lib/portal-change-control.ts`.
- Stored row + enums: `lib/db/src/schema/msp.ts` (`mspChangeRequestsTable` at **:3767**).
- Client seam: `artifacts/msp-portal/src/components/portal-v2/ccChangeControlWire.ts` and
  `useChangeControl.ts`.

---

## 1. The live surface

Two endpoints, both wired to the page today (`useChangeControl.ts:53`, `CHANGE_CONTROL_URL`):

| Method | Path | Role floor | Entitlement | State |
|---|---|---|---|---|
| `GET` | `/api/portal/change-control` | `CustomerUser` (`portal-change-control.ts:308`) | `change_control` add-on (`:309`) | **CURRENT** |
| `POST` | `/api/portal/change-control` | `Assessment` (`:409`), **no** entitlement check | — | **CURRENT** |

**Scoping (CURRENT, `portal-change-control.ts:17–47`).** The JWT `customerId` claim is a `tenants.id`.
It is resolved to `(tenants.mspId, tenants.tenantId)` and the query filters on **both**
(`:352–357`). Either predicate alone is unsafe — `mspId` alone is MSP-wide; `tenantId` alone trusts
an unconstrained free-text column (`msp_change_requests.tenant_id` has no FK, no unique constraint).
A **blank** tenant identifier **fails closed** to an empty register rather than matching every other
blank-identifier row (`:41–47`, `:319–326`) — the single most important line in the file, per its
own header.

**Entitlement gate (CURRENT, `#1173`/`#1168`).** The read requires an active `change_control`
add-on; an Assessment-tier (free) account does not see Change Control at all. The write is
deliberately left ungated ("creation unconditional, gate visibility only") — every real change must
produce a real CR regardless of whether the tenant bought the add-on (`:67–82`).

---

## 2. `GET /api/portal/change-control` — response contract

### 2.1 Envelope — `WireChangeControlPayload`

Route emits `{ requests, stats, scoped }` (`portal-change-control.ts:361`; mirror interface at
`ccChangeControlWire.ts:113`).

| Field | Type | Null? | Marker | Source |
|---|---|---|---|---|
| `requests` | `WireChangeRequest[]` | no | **CURRENT** | `portal-change-control.ts:360–361` |
| `stats` | `WireChangeControlStats` | no | **CURRENT** | `:361`, `buildStats` `:256` |
| `scoped` | `boolean` | no | **CURRENT** | `:324` (`false` = unresolvable tenant), `:361` (`true`) |

### 2.2 `WireChangeRequest` — one change request as the page consumes it

Declared verbatim at `portal-change-control.ts:157–186`. "Marker" is CURRENT/DECIDED for whether the
field carries **real, complete** data today.

| Field | Type | Null? | Marker | Notes / source |
|---|---|---|---|---|
| `code` | `string` | no | **CURRENT** | `CR-2026-${100+id}` (`lib/portal-change-control.ts:286`). Format shared with MSP console on purpose. |
| `title` | `string` | no | **CURRENT** | straight off `title` (`:214` map / row `:3773`). |
| `changeClass` | `"Standard" \| "Normal" \| "Emergency"` | no | **CURRENT** | `displayChangeClass` (`lib/…:176`). Stored `standard\|normal\|emergency`. See §4 for the standard-vs-normal behaviour delta. |
| `status` | `ChangeRequestDisplayStatus` (7 labels) | no | **CURRENT** | `displayStatus` (`lib/…:147`). 7 labels over 6 stored values; `Approved` is **derived** (`pending_approval` + non-null `approvedBy`), not stored (`lib/…:21–33`, `:152–153`). |
| `workload` | `string` (8-value union) | no | **CURRENT** | `workloadForCategory` (`lib/…:134`). |
| `target` | `string` | no | **CURRENT** | `targetResource` (`:216` / row `:3792`). |
| `ticket` | `string` | no | **CURRENT** | `psaTicketId` (`:217`). Default `"No ticket reference"` on create (`:461`). |
| `requester` | `string` | no | **CURRENT** | `requestedBy` = `req.user.email` on portal creates (`:440`). |
| `window` | `string` | no | **CURRENT (free text)** | `scheduledFor`. Free text, **not** a timestamp — cannot be date-ordered (`:246–255`). Schema gap, see §4. |
| `risk` | `"Low"\|"Medium"\|"High"\|"Critical"` | no | **CURRENT** | `displayRiskLevel` (`lib/…:211`). Server recomputes risk on create; client value ignored (`lib/…:12–19`). |
| `impactedUsersCount` | `number` | no | **CURRENT** | `impacted_users_count` (row `:3797`). |
| `rationale` | `string` | no | **CURRENT** | `description` (`:220`). Portal creates write a fixed string (`:452`). |
| `pre` | `string` | no | **CURRENT (may be `{}`)** | `formatSnapshotJson(preChangeSnapshot)` (`:221`). `"{}"` when empty. |
| `post` | `string` | no | **CURRENT (may be `{}`)** | `formatSnapshotJson(proposedPayload)` (`:222`). |
| `approvals` | `readonly string[]` | no | **CURRENT (partial)** | `approvalLines` (`lib/…:312`). Reconstructed from ONE `approvedBy` column — no multi-approver history. Multi-stage/quorum is **DECIDED `#1496`**. |
| `canApprove` | `boolean` | no | **CURRENT flag, DECIDED action** | `status === "Pending approval"` (`lib/…:360`). Controls whether the affordance is **shown**; **no mutation exists** (`lib/…:350–358`). Approve action **DECIDED `#1496`/`#1499`**. |
| `canRollback` | `boolean` | no | **CURRENT flag, DECIDED action** | `status === "Implemented"` (`lib/…:364`). Same: shown-only. Rollback action **DECIDED `#1499`**. |
| `executedAt` | `string \| null` | **yes** | **CURRENT (free text)** | `executed_at` is nullable free `text` (row `:3804`). No implementer, no planned-vs-actual — **DECIDED `#1499`**. |
| `backupVerified` | `boolean` | no | **CURRENT** | Portal creates write `false` (not the MSP route's fabricated hash) (`:469`, header `:104–110`). |
| `linkedFinding` | `string \| null` | **yes** | **CURRENT (free text)** | `linked_finding` free text (row `:3823`). `null` = raised directly. Real FK edges are **DECIDED `#1505`**; see §7. |
| `createdAt` | `string` (ISO) | no | **CURRENT** | `created_at.toISOString()` (`:234`). The only real `timestamptz` on the row. |

**Absent from the wire on purpose** — not fields, do not add them: `rollbackScriptSnippet` (stored,
never serialised — `portal-change-control.ts:83–102`, `:473`). See §6.

### 2.3 `WireChangeControlStats` — the four stat cards

`buildStats` (`portal-change-control.ts:256–300`); interface `ccChangeControlWire.ts:102`.

| Field | Type | Marker | Source |
|---|---|---|---|
| `open` | `number` | **CURRENT** | count of open display statuses (`:257`, `isOpenStatus` `lib/…:346`). |
| `awaitingApproval` | `number` | **CURRENT** | count `status === "Pending approval"` (`:258`). |
| `nextWindowCount` | `number` | **CURRENT (substitute metric)** | largest same-window group of open changes — **not** date-ordered, because `scheduled_for` is prose (`:246–273`). |
| `nextWindowLabel` | `string` | **CURRENT** | that group's real window text (`:266–273`). |
| `emergencyCount` | `number` | **CURRENT** | Emergency changes within `emergencyLookbackDays` — measured off `createdAt`, not `executedAt` (`:275–288`). |
| `emergencyLookbackDays` | `number` (=90) | **CURRENT const** | `EMERGENCY_LOOKBACK_DAYS` (`lib/…:336`). |
| `snapshotsHeld` | `number` | **CURRENT (substitute metric)** | executed rows within retention; retention measured from `createdAt` because `executedAt` is free text (`:280–288`). |
| `snapshotRetentionDays` | `number` (=90) | **CURRENT const** | `SNAPSHOT_RETENTION_DAYS` (`lib/…:333`). |

---

## 3. `POST /api/portal/change-control` — request contract

Zod schema `createSchema` (`portal-change-control.ts:376–385`). The client sends **only** what the
customer typed; nothing that decides authority.

| Field | Type | Required | Source |
|---|---|---|---|
| `title` | `string` 1–200 | yes | `:377` |
| `target` | `string` 1–500 | yes | `:378` |
| `ticket` | `string` ≤120 | no | `:379` |
| `pre` | `string` ≤20000 | no | `:380` |
| `post` | `string` 1–20000 | yes | `:381` |
| `changeClass` | `"Standard"\|"Normal"\|"Emergency"` | yes | `:382` (`CHANGE_CLASSES`) |
| `impactedUsersCount` | `int` 0–10_000_000 | yes | `:383` |
| `window` | `string` 1–200 | yes | `:384` |

**Computed server-side, never accepted from the body** (`:432–441`): `risk` (`computeRiskLevel`,
`lib/…:244`), `workload` (`deriveWorkload`, `lib/…:267` — **order is load-bearing**), `status` always
`pending_approval` (`:466`), `tenantId`/`tenantName`/`primaryDomain` from resolved scope,
`requestedBy` from JWT email, `backupVerified: false` + empty `backupHash` (`:469–470`),
`rollbackScriptSnippet: ""` (`:473`).

**Response:** `201 { code, risk, workload }` (`:483`). `409` when the account has no connected M365
tenant (`:425–430`). `400` on validation failure.

---

## 4. Real enum unions (from the Drizzle schema ONLY)

Design invents status vocabularies constantly; these are the only legal sets. Stored enums are
TypeScript-level (the columns are plain `text` with **no CHECK constraint** — verified in the schema
headers), but they are the contract.

**`msp_change_requests` stored columns** (`lib/db/src/schema/msp.ts`):

| Column | Union | Line |
|---|---|---|
| `change_class` | `standard \| normal \| emergency` | `:3775` |
| `risk_level` | `critical \| high \| medium \| low` | `:3776` |
| `category` | `ConditionalAccess \| Exchange \| Identity \| Intune \| Defender \| SharePoint \| Purview \| Teams` | `:3791` |
| `status` | `pending_approval \| scheduled \| in_progress \| completed \| rolled_back \| rejected` | `:3798` |

**Derived display vocabularies** (`lib/portal-change-control.ts`) — these are what the wire carries:

| Union | Values | Line |
|---|---|---|
| `ChangeRequestDisplayStatus` | `Pending approval \| Approved \| Scheduled \| In window \| Implemented \| Rejected \| Rolled back` | `:62–71` |
| `ChangeClass` | `Standard \| Normal \| Emergency` | `:173` |
| `RiskLevel` | `Low \| Medium \| High \| Critical` | `:208` |
| `ChangeRequestWorkload` (8) | `Conditional Access \| Exchange / mail \| Identity \| Intune \| Defender \| SharePoint \| Purview \| Teams` | `:74–83` |

**Cross-surface unions referenced by Change Control edges** (§7):

| Union | Values | Line |
|---|---|---|
| `PortalHoldEventKind` | `extended \| closed_early \| released \| cr_prepared` | `msp.ts:4512–4518` |
| `DriftEventVerdict` | `approved \| attributed_unapproved \| unattributed \| informational` | `msp.ts:4830–4835` |
| `DriftEventStatus` | `open \| resolved \| reopened` | `msp.ts:4849` |

> **Note the two vocabulary mismatches the client mapper already bridges** (`ccChangeControlWire.ts:12–39`):
> the module's own State filter uses `Draft \| Awaiting approval \| In test \| Rolled back \| Emergency · retro approval due`
> and its Workload filter uses `Exchange Online \| Microsoft Teams \| SharePoint \| Entra ID` — **neither is the
> wire vocabulary.** `STATE_BY_WIRE_STATUS` (`:132`) and `WORKLOAD_BY_WIRE` (`:143`) are the only sanctioned
> translations. Design must not introduce a third spelling.

---

## 5. CURRENT vs DECIDED — the module map

Every DECIDED row carries an issue number. Rows without one are **OPEN GAP** and labelled so.

| Capability | CURRENT reality | Target | Marker |
|---|---|---|---|
| Approve a change | Affordance shown (`canApprove`), **no mutation on the wire** | `cr_approvals` rows, `canApproveChanges` capability flag, SLA, delegation, separation of duties | **DECIDED `#1496`** |
| Reject a change | none | Two terminal states: customer-reject → risk acceptance; MSP-reject → finding stays open | **DECIDED `#1496`** (+ `#1487` for the risk) |
| Roll back | Affordance shown (`canRollback`), no mutation | Rollback is itself an inverse CR with its own approval + `rollbackVerifiedAt` | **DECIDED `#1499`** |
| CR as write gate | `execute_write_pack` fires with no CR (`#1497`) | No approved CR → no tenant write (fail-closed) | **DECIDED `#1497`** |
| `crRef` populated on execution | Nothing populates it → every legit change reads as drift (see §6) | `crRef` written on execution | **DECIDED `#1497`/`#1499`** |
| Execution record | `executedAt` free text only | `cr_executions` → `wf_runs.id`, implementer, planned-vs-actual | **DECIDED `#1499`** |
| Standard change catalog | No catalogue table (`useChangeControl.ts:22`) | `change_catalog_items` → `packKey`; a governed, revocable object | **DECIDED `#1498`** |
| Standard = permanent-until-revoked | `standard` stored but behaviourally identical to `normal` (`#1555`) | Standard flows unattended; revocation is the control | **DECIDED `#1555`** |
| Runbook standard/non-standard purity | not enforced | Whole-runbook property, checked at authoring time | **DECIDED `#1554`** |
| Freeze / blackout windows | `freezeException`/`freezeOpen`/`freezesOv` are client stubs = `false`/`null` (`#1500`) | `change_freeze_windows`, server-side enforcement at submit | **DECIDED `#1500`** |
| CAB / ECAB | No CAB tables (`useChangeControl.ts:22`) | `cab_members`/`cab_meetings`/`cab_agenda_items`, ECAB retro approval | **DECIDED `#1501`** |
| Post-implementation review | `status` only | Close codes `successful\|successful_with_issues\|failed\|rolled_back`, PIR, drift re-scan | **DECIDED `#1502`** |
| CR timeline / comments / attachments | "Add a comment" is a dead button; no per-CR history | `cr_comments`, append-only `cr_events`, `cr_attachments`; immutable after close | **DECIDED `#1503`** |
| Scheduling / collision / dependencies | `scheduledFor` single free-text column | maintenance windows, collision on `targetResource`, `blocked_by` | **DECIDED `#1504`** |
| Linked records (real FKs) | `linkedFinding` free text | proper FKs for the five edges + risk↔CR back-pointers | **DECIDED `#1505`** |
| Change metrics | none | success rate, emergency ratio, lead time (off `cr_events`) | **DECIDED `#1506`** |
| Notification rules | `notifOv` client stub (`useChangeControl.ts:22,26`) | a real notification-rule table | **OPEN GAP** — no sub-issue decides this yet. Do not design it as finished. |
| `scheduled_for` as a real timestamp | free `text`, cannot be date-ordered (route `:246–255`) | a `timestamptz` window | **OPEN GAP** — flagged repeatedly in code, no schema issue owns it. |
| `separation of duties` "peer review" | client emits "peer not started" sentinel (`ccChangeControlWire.ts:322–329`) | a real second-approver stage | **DECIDED `#1496`** (multi-stage) |

---

## 6. The live bug carried into this pack (extracted exactly)

**File:** `artifacts/api-server/src/lib/drift-collector.ts`
**Line 77–81** — `deriveVerdict`:

```ts
export function deriveVerdict(attr: DriftAttribution | undefined): DriftEventVerdict {
  if (attr?.crRef) return "approved";              // :78
  if (attr?.changedBy) return "attributed_unapproved";
  return "unattributed";
}
```

**Asserted by** `artifacts/api-server/src/lib/drift-collector.test.ts:21–25`:

```ts
it("a linked CR makes the change approved", () => {
  expect(deriveVerdict({ crRef: "CR-1042" })).toBe("approved");        // :22
  expect(deriveVerdict({ crRef: "CR-1042", changedBy: "admin@contoso" })).toBe("approved");
});
```

**The mechanism, stated exactly.** `crRef` lands on a `drift_events` row via `planDriftEvents`
(`drift-collector.ts:109–128`), which copies `attr.crRef` (`:125`) supplied by the caller's
`attributionFor(setting)` lookup. The stored column is `drift_events.cr_ref` (`msp.ts:4898`).
**Nothing populates it**, because CRs never execute — there is no write path that stamps a CR
reference onto the change it authorised. So `attr?.crRef` is always falsy, `deriveVerdict` never
returns `approved` from a real CR, and **every legitimate change reads as `unattributed`
(the riskiest state) or `attributed_unapproved`** — i.e. as unauthorized drift.

**The fix is a consequence, not a task.** Making the CR the authorization gate (`#1497`) and writing
`crRef` back on execution (`#1499`) populates `cr_ref` by construction, and the verdict stops lying.
The half of the mechanism that already ships — a drift event with no `crRef` being an unauthorized
change — is the module's differentiator (`#1486`: *"ServiceNow cannot tell you whether an M365
change was authorized. This platform can."*).

---

## 7. Cross-surface edges touching Change Control

Per `#1577`, each module's pack carries the edges that touch it; the map accumulates as modules land.
The five edges below are verified in code (also enumerated on `#1505`). **All are free-text /
loose-integer today — no real FK exists on any of them.** Turning them into real FKs is **DECIDED
`#1505`**.

| Edge | From → To | Column(s) today | Marker |
|---|---|---|---|
| Finding → CR | `msp_change_requests.linkedFinding` | free `text`, nullable (`msp.ts:3823`) | **CURRENT (free text)** → FK **DECIDED `#1505`** |
| Hold window → CR | `portal_hold_window_events.changeRequestId` | `integer`, **no FK** (`msp.ts:4536`); set when a hold decision escalates via `kind = 'cr_prepared'` (`msp.ts:4512–4518`) | **CURRENT (loose int)** → FK **DECIDED `#1505`** |
| Drift → CR | `drift_events.crRef` (+ `baselineSnapshotId`) | `cr_ref` free `text` (`msp.ts:4898`), `baseline_snapshot_id` loose `integer` (`:4900`) | **CURRENT but never populated** (see §6) → **DECIDED `#1497`/`#1499`/`#1505`** |
| Risk ↔ CR | `msp_risk_decisions.checkKey` / `registerRef` | `check_key` nullable `text` (`msp.ts:3947`), `register_ref` nullable `text` (`:4002`) | **CURRENT (free text)**; forward/back risk↔CR pointers do **not** exist → **DECIDED `#1505`** |
| SOP run ↔ CR | `msp_sop_runs.psaTicketId` ↔ CR `psaTicketId` | both `psa_ticket_id` `text` (`msp.ts:3889`, `:3793`) — a shared PSA ticket, not a key | **CURRENT (soft join)** → **DECIDED `#1505`** |

> Message Center actions (snooze, record a decision, brief the wave) write into change control and
> hold windows rather than a table of their own (`#1505`).

---

## 8. The honest tri-state, and where the current build violates it

`#1485`/CLAUDE.md require a real tri-state: **loading / live-genuinely-empty / read-failed**, and a
**hard rule** against silent fixture fallback.

**What the route already does honestly** (`portal-change-control.ts:319–326`, `useChangeControl.ts:253–286`):
- `scoped: false` (unresolvable tenant) → fail-closed empty register. This is *not* the tenant's own
  answer, so it is **not** "genuinely empty".
- `scoped: true` with zero rows → a **real, honest empty** — "this tenant genuinely has no change
  requests" — and is treated as **live-empty**, not papered over (`useChangeControl.ts:262–273`).

**Where it violates the hard rule — flag for Design, do not reproduce.** The current client collapses
the tri-state into `CcDataState = "loading" | "live" | "fixture"` (`useChangeControl.ts:56`), and on
**both** a read failure (`catch`, `:276–281`) **and** an unscoped tenant (`:269–272`) it falls back to
the design's five fixture change requests (`CC_CRS`, via `crs()` `:289–295`). Per CLAUDE.md's HARD
RULE ("never fall back to fixture/demo content"), the correct target is:

| State | Correct behaviour | Current behaviour | Marker |
|---|---|---|---|
| `loading` | skeleton, no data claim | `dataState = "loading"` ✓ | **CURRENT** |
| live, rows present | render real rows | `dataState = "live"` ✓ | **CURRENT** |
| live-genuinely-empty (`scoped:true`, 0 rows) | honest empty state | treated as `live` with empty set ✓ | **CURRENT** |
| read-failed / unscoped | honest "couldn't load" / "no connected M365 tenant" state | **falls back to fixtures** ✗ | **OPEN GAP** — the fixture fallback must be replaced with honest read-failed / no-tenant states. No issue owns this yet; **file/flag before wire.** |

The register, record and calendar's CR markers are the live-backed surfaces
(`useChangeControl.ts:11–18`). The **catalogue, freeze windows, CAB agenda and notification rules**
have no table and stay on fixtures today (`useChangeControl.ts:19–26`) — those are the DECIDED items
`#1498`/`#1500`/`#1501` and the OPEN GAP notification rules in §5, and Design must render them as
honest "no backend yet" states, not as the fixtures.

---

## 9. Honest-empty contract per surface

What the route serves with no data:

- **Unresolvable tenant:** `{ requests: [], stats: <all-zero stats>, scoped: false }`
  (`portal-change-control.ts:324`). `buildStats([], now)` yields `open:0, awaitingApproval:0,
  nextWindowCount:0, nextWindowLabel:"No window booked", emergencyCount:0, snapshotsHeld:0` with the
  two constant `*Days:90` fields (`:256–299`, `:266`). Design must render this envelope — a real page
  state, not a skip.
- **Scoped, zero rows:** identical envelope but `scoped: true`. This is the live-empty state; render
  "this tenant has no change requests yet", not fixtures.
- **Read error:** `500 { error: "Failed to load change control register" }` (`:364`). Client must
  show an honest failure state (§8).

There is **no `coverage` block** on this surface (unlike the drift-collection status surface, which
carries one — `drift_collection_status.coverage`, `msp.ts:4968`). Do not invent one for Change
Control; its per-surface honesty signal is `scoped` + the zero-stats envelope above.

---

## 10. The forbidden list — "deliberately does NOT serve"

Swept from the route headers. Named as forbidden, not merely absent. Design must not draw these as
wired against this route:

1. **`rollbackScriptSnippet` on the wire** — stored on the row, deliberately never serialised; "a
   stored rollback command is the last field to ship to a browser out of habit"
   (`portal-change-control.ts:83–102`, omitted at `:100–102`).
2. **Approve / Reject / Rollback mutations** — no endpoint exists; the prototype's five buttons carry
   no `onClick` (proto 1513–1524). `canApprove`/`canRollback` are **show-flags only**
   (`lib/portal-change-control.ts:350–366`, route header `:83–98`). DECIDED under `#1496`/`#1499`.
2b. **"Change window" and "Add a comment" buttons** — also `onClick`-less in the prototype; only
    "Ask ShaneBot to explain the diff" is wired (route header `:88–91`). Comments are DECIDED `#1503`.
3. **A fabricated `backupHash` / `backupVerified: true` on create** — the MSP route's inherited bug,
   explicitly **not** carried over; portal creates write `false` + empty hash (`:104–110`, `:469–470`).
4. **The prototype's second "Second admin — awaiting" approval line** — not invented for a row that
   has no second approver recorded (`lib/portal-change-control.ts:304–324`).
5. **Client-named risk** — any `risk` in the POST body is ignored; risk is recomputed server-side
   (`lib/portal-change-control.ts:12–19`).
6. **Cross-tenant reads via a blank tenant id** — structurally refused (`:41–47`).

---

## 11. Orphaned-endpoint check (the `#1485` standing convention)

> "A contract pack that finds a real, live endpoint the page does not call is a sub-issue, filed at
> pack time." (`#1485`, 2026-08-29)

**Result for this module: no customer-facing orphan found — no sub-issue filed.** The Change Control
page calls **both** of its live endpoints — `GET` and `POST /api/portal/change-control`
(`useChangeControl.ts:53,257`; `POST` via the CR wizard). There is no third customer-scoped
Change Control endpoint left unwired.

**Noted, deliberately not filed:** a live **MSP-scoped** mutation exists —
`PATCH /api/msp/change-requests/:id` (`artifacts/api-server/src/routes/msp-changes.ts:154`,
`requireRole("MSPOperator")`), which updates `status` / `approvedBy` / `executedAt`. This is the
**only** path by which a CR's approval/execution state can change at all today, and it is an
**MSP/admin-console** endpoint — out of scope for this customer-portal module, and correctly **not**
called by the customer page (calling it would grant the customer MSP authority). The customer-facing
approve/reject/execute path genuinely does not exist and is DECIDED under `#1496`/`#1497`/`#1499` —
so there is nothing here to file as a new sub-issue; the capability is already tracked.

> Separately observed while checking: no `artifacts/admin-panel/` file references
> `/msp/change-requests`, so the MSP-side GET/POST/PATCH trio may itself be unconsumed by any admin
> page. That belongs to the **MSP/admin console**, not this module, and is left as an observation for
> the admin-side pass rather than filed under `#1486`.

---

## 12. The precedent this pack exists to prevent (`#1577` requires including it)

`artifacts/api-server/src/routes/portal-pii-governance.ts:32` is the clearest statement of the
failure mode. A prior Design pass invented, with **no backing data**: per-document findings, named
sources, matched patterns, an access matrix, and a drift feed — and somebody then had to **write a
route whose job is to explain why the page cannot serve them**. PII Governance has since been moved
out of this epic to v1.2 (`#1485`, 2026-08-28) precisely because its automated half has nothing live
to design against.

The lesson for Change Control: every field above is either **CURRENT** (real, cite it), **DECIDED**
(settled in a numbered issue, draw the target but know it is unwired), or **OPEN GAP** (undecided —
do not draw a finished answer). Anything not on one of those three lists is invention, and invention
is exactly what produced the PII route.

---

## Appendix — source index

| Concern | File | Key lines |
|---|---|---|
| Route (GET/POST), header, scoping, forbidden list | `artifacts/api-server/src/routes/portal-change-control.ts` | `:157` (Wire), `:256` (stats), `:306`/`:407` (handlers), `:83–110` (forbidden) |
| Pure derivations, enums, show-flags | `artifacts/api-server/src/lib/portal-change-control.ts` | `:48–104` (enums), `:147`/`:176`/`:211` (display maps), `:244`/`:267` (compute), `:350–366` (flags) |
| Stored row + column enums | `lib/db/src/schema/msp.ts` | `:3767` (table), `:3775`/`:3776`/`:3791`/`:3798` (enums), `:3823` (linkedFinding) |
| Drift verdict bug | `artifacts/api-server/src/lib/drift-collector.ts` | `:77–81` (`deriveVerdict`), `:109–128` (`planDriftEvents`) |
| Drift bug test | `artifacts/api-server/src/lib/drift-collector.test.ts` | `:21–25` |
| Cross-surface edge tables | `lib/db/src/schema/msp.ts` | `:4520` (hold events), `:4877` (drift events), `:3928` (risk decisions), `:3873` (SOP runs) |
| Client seam, tri-state, vocab maps | `artifacts/msp-portal/src/components/portal-v2/ccChangeControlWire.ts`, `useChangeControl.ts` | wire `:113`, maps `:132`/`:143`, tri-state `useChangeControl.ts:56`/`:253–286` |
| MSP-side mutation (out of module scope) | `artifacts/api-server/src/routes/msp-changes.ts` | `:154` (PATCH) |

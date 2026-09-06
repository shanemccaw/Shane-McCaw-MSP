# Change Control (MSP Console) — Contract Extraction Pack

**Module:** Change Control — MSP Console operator half (`#1681`, part of `#1571` EPIC: Portal
Admin). Sibling of `#1486` Feature: Change Control (Portal), the customer-facing half.
**Method:** the `#1642` pattern — per-surface wire contracts extracted verbatim and cited to
file:line, CURRENT vs DECIDED marked on every field, real enum unions only, cross-surface edges,
honest tri-state, forbidden list, orphaned endpoints listed explicitly.
**Status of this document:** extracted, not authored. Every field below is cited to `file:line`.
Nothing here is invented; where a value does not exist in code it is marked **OPEN GAP**, not
filled in.
**Governing issue:** `#2577`, dispatched once both real blockers were closed — `#2664` (the
generic PATCH never checked `cr_approvals` before allowing a status transition) and `#2665` (the
MSP create route fabricated a `backupHash`, the same bug already fixed on the customer side). Both
fixes are already live in the code this pack was extracted from.

> **A prior pack for this Feature (`020d46dcb`, 2026-08-xx) was removed** (`9f24302c0`) because it
> was written from the **customer-portal** side (`#1486`) before the #1496–#1503 backend wave
> landed, and described dead architecture. This is not a re-run of that pack — it is a **new
> surface**: the MSP operator side, which is a different set of routers, a different auth floor,
> and in several places a materially different (and less finished) wire contract than the
> customer side.

---

## 0. How to read this pack

| Marker | Meaning |
|---|---|
| **CURRENT** | The field/behaviour exists and serves real data today. Design draws against it as-is. |
| **DECIDED** | The architecture is settled in an issue but **not built on this surface**. Design may draw the target, but must know it is unwired. Every DECIDED row carries its issue number. |
| **OPEN GAP** | Wanted, but **no issue decides it yet** for the MSP console specifically. Do not design a finished answer for it. |

**Source of truth for shapes:** each route's own inline logic and any named `Wire*` interface —
most of these routes have none, and return the raw Drizzle row instead (flagged explicitly per
route below, since that is a real, load-bearing difference from the customer-portal pattern).

**Live-data counts, queried against the local database at pack time** (2026-09-06, `psql
"$DATABASE_URL"`): every one of the fourteen Change-Control-family tables reads **zero rows** —
`msp_change_requests`, `cr_approvals`, `cr_executions`, `cr_pirs`, `change_catalog_items`,
`cab_members`, `cab_meetings`, `cab_agenda_items`, `cr_events`, `cr_comments`, `cr_attachments`,
`change_freeze_windows`, `change_maintenance_windows`, `change_request_dependencies`. This is a
genuinely empty local dev database, not a read failure — every table and route below is real,
migrated, mounted schema with nothing in it yet.

---

## 1. The live surface — eight routers, all mounted, none consumed

All eight are imported and `router.use()`-mounted in `artifacts/api-server/src/routes/index.ts`
(imports `:267-281`, `router.use` calls `:553-567`):

| Router file | Base path(s) | Feature |
|---|---|---|
| `msp-changes.ts` | `/msp/change-requests` | CR CRUD, generic status PATCH, timeline (events/comments/attachments) — `#1496`/`#1503` |
| `msp-change-catalog.ts` | `/msp/change-catalog` | Standard Change Catalog authoring/governance — `#1498`/`#1554`/`#1555` |
| `msp-change-control-cab.ts` | `/msp/change-control/cab/*` | CAB — membership, meetings, agenda, ECAB — `#1501` |
| `msp-change-freeze-windows.ts` | `/msp/change-freeze-windows` | Freeze/blackout calendar — `#1500` |
| `msp-change-maintenance-windows.ts` | `/msp/change-maintenance-windows` | Maintenance-window calendar — `#1504` |
| `msp-change-dependencies.ts` | `/msp/change-requests/:id/dependencies` | `blocked_by` edges between CRs — `#1504` |
| `msp-change-executions.ts` | `/msp/change-control/executions`, `/msp/change-control/change-requests/:id/rollback` | Execution record, planned-vs-actual, rollback-as-inverse-CR — `#1499` |
| `msp-change-pir.ts` | `/msp/change-control/executions/:id/pir`, `/msp/change-control/pirs` | Post-Implementation Review + drift re-scan — `#1502` |

**Every route on all eight is called from zero UI.** `artifacts/msp-console/src` contains exactly
three files — `App.tsx`, `main.tsx`, `pages/index.tsx`, `pages/not-found.tsx` — no Change Control
page exists yet (confirmed by directory listing at pack time). `artifacts/admin-panel/src` and
`artifacts/portal/src` were also grepped for `msp/change-requests`/`msp-change` and neither
references any of these eight routers. This is the **expected state**, not a defect: `#1681`'s own
fixed ordering is architect → build the endpoints → **this pack** → Design (`#2578`) → wire
(`#2579`), and neither of the last two has run yet. See §11 for the orphan-check discipline this
satisfies.

**Shared scoping pattern, all eight routers, every route:** `requireAuth` + `requireRole` (floor
check, not exact match — see `#middlewares/requireAuth.ts:81-89` `ROLE_ORDER =
["Assessment","Free","CustomerUser","ServiceAccount","MSPOperator","MSPAdmin","PlatformAdmin"]`,
`:215` `roleIndex(effectiveRole) < roleIndex(minimumRole)` is the only rejection test) then
`resolveMspIdStrict(req)` (`lib/resolve-msp-id.ts:75-77`: `req.user?.mspId ?? null`, **session-only
— no `?mspId=`/`?slug=` override, even for PlatformAdmin**) → `403 { error: "MSP context
required" }` if null. Every route floors at `MSPOperator` **except** the two Standard Change
Catalog governance actions, which floor at `MSPAdmin` (§3). There is no `:mspId` in any URL on any
of these eight routers — every one is session-scoped to the caller's own MSP.

**Error-envelope shape is inconsistent across the surface — a real, current fact, not a
recommendation.** `msp-changes.ts` and `msp-change-catalog.ts` and the three calendar/dependency
routers use the structured `apiError(res, status, ApiErrorCode.X, message, detail?)` helper
(`lib/api-helpers.ts`). `msp-change-control-cab.ts`, `msp-change-executions.ts` and
`msp-change-pir.ts` use raw `res.status(n).json({ error: "..." })` throughout, with **no
`ApiErrorCode` anywhere on those three files**. A UI built against one error shape will not
correctly parse the other; Design/wire must handle both `{ error, code, details? }` and a bare
`{ error: string }`.

---

## 2. `msp-changes.ts` — the CR register itself

### 2.1 `GET /api/msp/change-requests` (`:90-120`)

Auth: `requireAuth`, `requireRole("MSPOperator")` (`:92-93`).

**No query params, no filtering, no pagination.** Returns every CR for the caller's MSP,
`orderBy(desc(id))` (`:102-106`).

**Response `200`: an array of the raw `mspChangeRequestsTable` row, with `id` overridden to the
formatted code** — `rows.map((r) => ({ ...r, id: formatCrId(r.id) }))` (`:108-111`). **This is not
a curated `Wire*` shape** — unlike every customer-portal Change Control response, and unlike this
same file's own timeline routes (§2.4), the list endpoint leaks the entire internal row verbatim:
`preChangeSnapshot`/`proposedPayload` (raw jsonb), `rollbackScriptSnippet`, `backupHash`,
`authorizedTargetKey`, `executorRunId`, `sourceInterpretationId`, `sourceResolutionId`,
`linkedHoldWindowId`, `catalogItemId`, `rollbackOfChangeRequestId`, `remediationCheckKey` — every
column in §"Backing schema" below, verbatim, camelCase, Drizzle's own names. `id` is the only
field reshaped (string code, not the numeric PK). Design must decide what subset of this a console
list page actually shows; nothing here curates it for them.

**Errors:** `403` (no MSP context, bare `{error}}` — inconsistent with this same route's own
`500` below); `500 ApiErrorCode.INTERNAL` with the real error message (`:114-118`).

### 2.2 `POST /api/msp/change-requests` (`:124-337`)

Auth: same floor.

**Request body** — `createChangeRequestSchema` (`:31-68`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `tenantId`, `tenantName`, `primaryDomain` | string | yes | — |
| `title`, `description` | string | yes | — |
| `changeClass` | enum | yes | `standard \| normal \| emergency` |
| `riskLevel` | enum | yes | `critical \| high \| medium \| low` |
| `category` | enum | yes | the 8-value `CHANGE_REQUEST_CATEGORIES` (widened under `#1764` to match the portal wizard and the column itself) |
| `targetResource`, `psaTicketId`, `scheduledFor` | string | yes | — |
| `scheduledStart`, `scheduledEnd` | ISO datetime (offset) | optional | `#1762` — a real booked instant, additive alongside the free-text `scheduledFor` label; end must be after start if both given |
| `impactedUsersCount` | int ≥ 0 | yes | — |
| `preChangeSnapshot`, `proposedPayload` | object | yes | raw jsonb |
| `rollbackScriptSnippet` | string | yes | — |
| `freezeException` | `{ justification: string, 1–2000 chars }` | optional | `#1500` — the only way through an active freeze |
| `authorizedTargetKey` | string | optional | `#1773` — `pack:<packKey>` or `sop:<sopId>`, pins this CR to one authorized target |

**Unlike the customer-portal create route, `risk` is NOT recomputed server-side here** — the MSP
console door accepts `riskLevel` verbatim from the caller. There is no `computeRiskLevel`
equivalent gate on this door (contrast §6, cross-surface).

**Real, load-bearing gating before insert** (all three independently policy/enforcement-gated,
same as the customer wizard's create route):
1. **Freeze-calendar enforcement** (`:145-198`, `#1500`) — only when
   `portal_change_control_policy.enabled && enforceFreezeCalendar` for the resolved tenant. Checks
   both an active freeze at submit time and (if `scheduledStart` given) a freeze over the booked
   window. A blocking freeze with no `freezeException` → `409 CONFLICT`.
2. **Maintenance-window enforcement** (`:200-211`, `#1504`) — only when `enforceMaintenanceWindows`
   is on and `scheduledStart` given. Booked span not covered by any active maintenance window →
   `409 CONFLICT`.
3. **Collision detection** (`:213-228`, `#1504`) — unconditional (not policy-gated). An overlapping
   open CR on the same `targetResource` → `409 CONFLICT` naming the colliding CR's code.

**Insert** (`:230-263`): `status: "pending_approval"` always; **`backupVerified: false`,
`backupHash: ""`** (the `#2665` fix — matches the customer-side create route's pattern, no
fabricated hash); `scheduledStart`/`scheduledEnd` as real `Date | null`, never guessed.

**Side effects, all non-fatal to the CR's own creation (each independently try/caught)**:
- `recordCrEvent({eventType:"raised", ...})` (`:266-277`) — opens the CR's timeline.
- `materializeApprovalsForChange(...)` (`:286-304`, `#1775` fix) — seeds real `cr_approvals` rows
  (or the one pre-approved row for a `standard` change) honouring the tenant's policy floor
  (`#1759`). **Before `#1775` this door never called this function at all** — a CR raised via the
  MSP console had zero approval rows and its approve/reject affordance never activated. Confirmed
  fixed in the code this pack reads.
- `recordFreezeException(...)` (`:309-322`) — only if a freeze exception was given; materialises
  the higher-bar MSP-signoff approval stage `#1500` promises.

**Response `201`**: `{ id: string (formatted code), message: string, freezeException: boolean }`
(`:326-330`) — **note: does NOT return the created row**, unlike a typical create-and-return
pattern; the caller must `GET` to see the full CR.

**Errors:** `403` MSP-context; `400 VALIDATION` (bad body); `409 CONFLICT` (freeze/maintenance/
collision); `500 INTERNAL`.

### 2.3 `PATCH /api/msp/change-requests/:id` (`:339-512`) — the one status-mutation route

Auth: same floor. `:id` parsed via inline `parseCrId` (`:82-86`, `CR-2026-(\d+)` minus 100 — must
round-trip exactly with `formatCrId`/`formatChangeRequestCode`, verified identical across both).

**Request body** — `patchChangeRequestSchema` (`:70-74`): all optional — `status` (the six stored
values), `approvedBy` (string, nullable), `executedAt` (string, nullable). **This is the entire
mutation surface for approve/reject/schedule/execute/complete/rollback-flag on this router** —
there is no dedicated `/approve` or `/reject` sub-route here (contrast the Standard Change
Catalog's dedicated `/approve`/`/revoke`, and the CAB's dedicated `/decision`).

**Approval gate (`#2664` fix, `:378-429`)** — before allowing a transition **into**
`scheduled`/`in_progress`/`completed` (the `APPROVAL_GATED_STATUSES` set, `:389`): loads
`cr_approvals` rows for the CR, resolves the tenant's policy (`loadApprovalPolicy`, falling back to
`NO_POLICY`), computes `requiredStages` + `summarizeApprovals` — **the exact same derivation the
customer portal's own approve flow uses** (reused, not reinvented) — and `409 CONFLICT`s with the
required/approved/pending/rejected counts in the body if incomplete. **`rejected` and
`rolled_back` are deliberately NOT gated** — rejecting never required an approval, and a rollback
is reversing a change that already had to clear this gate to reach `completed`.

**A REAL, CONFIRMED GAP this pack surfaces (not yet filed — see §12): rejecting a CR through this
route never touches the approval ledger or the routing ledger at all.** Setting `status:
"rejected"` here goes through the exact same generic `updateData` path as every other status value
(`:431-440`) — it does **not** call `recordRejection` (`lib/portal-change-rejection.ts`), which on
every other rejection path (the customer register, the CAB's `/decision` reject branch) marks the
pending `cr_approvals` row(s) `rejected`/`superseded`, and — for a routed Microsoft change — flips
`m365_change_routings.decision` to `declined_risk` (`lib/m365-change-router.ts:702-710`). Rejecting
via this route leaves any still-`pending` `cr_approvals` rows dangling forever, which the SLA
breach sweep (`escalateBreachedApprovals`, `portal-change-approvals-store.ts:358-383`) has **no CR-
status filter at all** and will eventually escalate as a breached approval on an already-terminal,
rejected CR. For a routed Microsoft change it also means `m365_change_routings` never learns the
change was declined via this door. `CR_STATUS_EVENT_TYPES` (`:448`) does correctly emit a `rejected`
`cr_events` row either way, so the timeline itself is not silently wrong — only the approval ledger
and (for routed changes) the routing ledger are left stale.

**Retainer byproduct hook (Git #1293, `:467-500`)** — on a genuine transition **into** `completed`
only (never a re-save), logs a `retainer_work_log` entry via `logRetainerWorkFromTracker`, resolved
to the tenant's `tenants.id`. Non-fatal — a hook failure never breaks the CR update.

**Response `200`**: `{ id: string, message: string }` (`:502-505`).

**Errors:** `403`, `400` (bad id / bad body), `404 NOT_FOUND` (CR not found or not this MSP's),
`409 CONFLICT` (approval incomplete), `500 INTERNAL`.

### 2.4 CR timeline — events, comments, attachments (`:514-748`, `#1503`)

Three routes, mirroring the customer-portal timeline routes over the SAME three tables
(`cr_events`/`cr_comments`/`cr_attachments`), scoped by `mspId` the same way every route in this
file is. **`cr_events` is read-only here too** — an operator posts a COMMENT, never an event
directly; events are appended exclusively from the transitions in §2.2/§2.3 and the approval model.

| Route | Method | Response |
|---|---|---|
| `/msp/change-requests/:id/timeline` | GET | `{ id, events: WireCrEvent[], comments: WireCrComment[], attachments: WireCrAttachment[] }` (`:584-612`) — **the one place in this file that DOES curate a `Wire*` shape**, narrower than the raw row |
| `/msp/change-requests/:id/comments` | POST | `{ id, comment: WireCrComment }`, `201` (`:664-667`) |
| `/msp/change-requests/:id/attachments` | POST | `{ id, attachment: WireCrAttachment }`, `201` (`:729-741`) |

`WireCrEvent` (`:522-531`): `eventType, fromValue, toValue, stage, actorRole, actorName, reason,
occurredAt` — all from the real `cr_events` vocabulary (§3). `WireCrComment` (`:533-538`):
`authorRole, authorName, body, createdAt`. `WireCrAttachment` (`:540-549`): `kind, label,
externalUrl, mimeType, sizeBytes, uploadedByRole, uploadedByName, createdAt`. Comment body:
`z.string().trim().min(1).max(4_000)` (`:621`). Attachment: `kind` enum (`evidence | test_result |
approval_email | other`, default `other`), `label` required ≤200 chars, `externalUrl` optional URL
≤2000, `mimeType` optional ≤120, `sizeBytes` optional int 0–1,000,000,000 (`:676-682`) — **no file
upload is implemented; `externalUrl` points at wherever the real artifact already lives**
(SharePoint/Graph/etc.), same discipline the schema comment for `cr_attachments` states.

All three: `404 NOT_FOUND "Change request not found"` if the CR doesn't exist/isn't this MSP's;
`500 INTERNAL` on failure.

---

## 3. Real enum unions — from the Drizzle schema only

**`msp_change_requests` stored columns** (`lib/db/src/schema/msp.ts`):

| Column | Union | Line |
|---|---|---|
| `change_class` | `standard \| normal \| emergency` | `:4609` |
| `risk_level` | `critical \| high \| medium \| low` | `:4610` |
| `category` | `ConditionalAccess \| Exchange \| Identity \| Intune \| Defender \| SharePoint \| Purview \| Teams` (widened `#1764`; **TypeScript-level only — no DB CHECK constraint**, verified live) | `:4625` |
| `status` | `pending_approval \| scheduled \| in_progress \| completed \| rolled_back \| rejected` | `:4654` |
| `intake` (nullable) | `informed \| approval \| advisory` — Microsoft-routing intake axis, `#1534` | `:4767` |
| `implementer` (nullable) | `microsoft \| customer \| msp` | `:4768` |
| `source_kind` (nullable) | `microsoft_change` | `:4769` |

**`cr_approvals`** (`:5036-5131`, `#1496`): `decision`: `pending \| approved \| rejected \|
superseded` (`:5058-5060`). `approverRole`: `customer \| msp \| catalog_inherited \|
microsoft_forced` — **never "the system"** (`:5076-5078`).

**`cr_executions`** (`:5157-5251`, `#1499`): `executorKind`: `runbook_run \| write_action \|
human_action` (`:5157`). `outcome`: `pending \| succeeded \| failed \| rolled_back` (`:5161`).
`rollbackOutcome` (nullable, only on an inverse/rollback execution): `pending \| verified \| failed`
(`:5165`).

**`cr_pirs`** (`:5278-5343`, `#1502`): `closeCode`: `successful \| successful_with_issues \| failed
\| rolled_back` (`:5278`). `driftRescanStatus`: `not_applicable \| ran \| error` (`:5290`).

**`change_catalog_items`** (`:5369-5410`, `#1498`/`#1554`/`#1555`): `status`: `draft \| approved \|
revoked` (`:5369`) — covers the WHOLE item, never a subset; no expiry/review-cycle field exists on
purpose.

**`change_freeze_windows` / `change_maintenance_windows`** (`:4892-4972`, `#1500`/`#1504`): both
`scope`: `global \| tenant \| workload` and `recurrence`: `none \| weekly \| monthly \| quarterly \|
annually` — **identical string values, distinct TypeScript types per table** (`ChangeFreezeScope` /
`ChangeMaintenanceScope`, etc.) — do not merge into one shared enum in a UI schema.

**`change_request_dependencies`** (`:4997-5016`, `#1504`): no enum column — a directed
`(changeRequestId, blocksChangeRequestId)` edge, unique per pair.

**`cab_members`** (`:5658-5699`, `#1501`): `role`: `chair \| voting \| advisory \| secretary`
(`:5658`). `side`: `msp \| customer` (`:5662`).

**`cab_meetings`** (`:5701-5741`): `meetingType`: `cab \| ecab` (`:5701`). `status`: `scheduled \|
in_progress \| completed \| cancelled` (`:5704`).

**`cab_agenda_items`** (`:5747-5780`): `recommendation` (nullable): `approve \| reject \| defer`
(`:5744`) — **the board's own determination, distinct from the real `cr_approvals` decision it
produces once recorded** (see §5).

**`cr_events`** (`:5823-5900`, `#1503`): the fullest vocabulary in the module — `raised, approved,
rejected, superseded, scheduled, in_progress, completed, rolled_back, script_revealed,
pir_recorded` (`:5823-5852`). `actorRole`: `customer \| msp \| microsoft \| system` (`:5856`).

**`cr_comments` / `cr_attachments`** (`:5910-5967`): `authorRole`/`uploadedByRole`: `customer \|
msp` (`:5907`) — narrower than `cr_events.actorRole`, a comment/upload is always human.
`cr_attachments.kind`: `evidence \| test_result \| approval_email \| other` (`:5932`).

**MSP role tier order** (`middlewares/requireAuth.ts:81-89`, used by `requireRole`'s floor check):
`Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`.

---

## 4. `msp-change-catalog.ts` — Standard Change Catalog authoring/governance (`#1498`/`#1554`/`#1555`)

"Approve once, execute many": a catalog item points at a real `config_packs.pack_key`. Once
`status = "approved"`, any change request raised from it **inherits that approval and skips
CAB** — `requiredStages()` is 0 for a `standard` change class regardless of risk. **The MSP console
authors and governs the catalog here. Raising a CR FROM an approved catalog item (the "execute"
action) is NOT a route on this file — it lives on the customer-portal side
(`routes/portal-change-catalog.ts`, not read for this pack).** This is a real, deliberate split:
MSP governs, customer (or its own automation) triggers.

| Route | Auth floor | Notes |
|---|---|---|
| `GET /msp/change-catalog` | `MSPOperator` | `200 { items: WireChangeCatalogItem[] }`, left-joined to `configPacksTable` for `packLabel`/`packStatus` |
| `POST /msp/change-catalog` | `MSPOperator` | Authors a `draft` item; `packKey` must reference a real, existing config pack (else `400`) |
| `POST /msp/change-catalog/:id/approve` | **`MSPAdmin`** | Signed/dated — a higher bar than authoring. Config pack must be `status === "active"` (else `409`). A fresh approval clears any prior revocation fields |
| `POST /msp/change-catalog/:id/revoke` | **`MSPAdmin`** | `reason` required, 1–2000 chars. Item's current status must be exactly `"approved"` (else `409`) — the one genuinely source-state-gated transition in this file |

`WireChangeCatalogItem` (verbatim, `:59-77`): `id, packKey, packLabel, packStatus, title,
description, category, riskLevel, status, approvedByName, approvedAt, revokedByName, revokedAt,
revokedReason, createdByName, createdAt, updatedAt`. `approvedByName`/`revokedByName` are always a
real person's name/email (`actorIdentity(req)`, `:51-57`) — **never "the system"**, matching every
other approval-authority column in this module.

**Note the approve route has no source-state check** (unlike revoke) — approving an already-
`approved` or already-`revoked` item is not blocked; it simply re-writes the approval fields and
clears the revocation. Design should not assume approve is a one-shot action.

---

## 5. `msp-change-control-cab.ts` — Change Advisory Board (`#1501`)

**One approval model, not two.** A CAB agenda item's `recommendation` (approve/reject/defer) is
the board's own determination for the record; the thing that actually authorizes or blocks the
change is a real `cr_approvals` row, written by the **same** `recordApproval`/`recordRejection` the
customer register uses. There is no bespoke CAB decision state.

**Standard changes structurally cannot reach an agenda** — `requiredStages("standard", …)` is 0, so
a standard change never has a pending `cr_approvals` row, and agenda eligibility is defined
exactly as "has a pending approval slot." Confirmed enforced defensively too:
`POST .../agenda` explicitly 400s a `standard`-class CR (`portal-cab-store.ts:308-310`) even though
it could never pass the eligibility check anyway.

| Group | Routes |
|---|---|
| Membership | `GET/POST /msp/change-control/cab/members`, `DELETE /msp/change-control/cab/members/:id` |
| Meetings | `GET/POST /msp/change-control/cab/meetings`, `GET /msp/change-control/cab/meetings/:id`, `POST .../start`, `POST .../close`, `POST .../cancel` |
| Agenda | `GET /msp/change-control/cab/meetings/:id/eligible-changes`, `POST .../agenda`, `PATCH /msp/change-control/cab/agenda/:id`, `POST .../decision`, `POST .../defer` |

**Key business rules, all in `lib/portal-cab.ts` / `lib/portal-cab-store.ts`:**
- Membership is an **idempotent upsert** keyed on `(mspId, personId)` — re-adding someone active
  edits them in place rather than erroring. Removal is a soft-delete (`active: false, removedAt`)
  — full history preserved, no hard delete.
- An `msp`-side member attends board-wide and **cannot** carry a `tenantId` (`400` if both given,
  enforced in the route, not the schema).
- `meetingTypeForChangeClass`: `emergency → ecab`, everything else `→ cab`. `isRetroactiveForMeetingType`:
  true only for `ecab` — every ECAB agenda item is retroactive by definition (the emergency change
  already executed; the board reviews it after the fact).
- A meeting accepts new agenda items/decisions only while `status` is `scheduled` or
  `in_progress` (`isMeetingOpen`). It may close once **every** agenda item has a non-null
  `recommendation` — an empty agenda closes trivially.
- Closing compiles real, deterministic **minutes** (`buildMinutes`, `portal-cab.ts:127-153`) — board
  name, scheduled-for, chair, location, then each agenda line: ordinal, change code + title,
  `[retroactive]` flag, presenter, discussion notes, and the recommendation in caps (or
  `UNDECIDED`).
- `eligibleChangesForAgenda` returns CRs of the matching class that have a pending `cr_approvals`
  row, are not already rejected, and are not already on another currently-open meeting's agenda.
- `POST .../decision` is **the only place a real approval-ledger decision is recorded from the CAB**
  — it calls `recordApproval`/`recordRejection` directly (the operator's identity always carries
  `role: "msp"`, `customerId: 0` as the "no customer/delegation context" sentinel) and backfills
  `crApprovalId` on the agenda item from the row just written. **One-shot** — an item that already
  carries a `recommendation` cannot be decided again (`409`).
- `POST .../defer` decides nothing about the change — `cr_approvals` is untouched; the item is
  simply rolled to a (must-be-open) future meeting.

**A real, current wire-shape inconsistency:** only `GET /meetings/:id` shapes its agenda through
`toWireCabAgendaItem` (giving `changeCode`/`changeTitle`). Every mutation route on an agenda item
(`POST .../agenda`, `PATCH .../agenda/:id`, `POST .../decision`, `POST .../defer`) returns the
**raw `CabAgendaItem` DB row** instead — no `changeCode`/`changeTitle` on those responses. Design
must not assume every agenda-item response carries the same shape.

`WireCabMember` / `WireCabAgendaItem` / `WireCabMeeting` / `AgendaSummary` — verbatim in
`lib/portal-cab.ts:70-77, 156-235`; see the appendix for full field lists.

---

## 6. Freeze / maintenance windows and CR dependencies (`#1500`/`#1504`)

`msp-change-freeze-windows.ts` and `msp-change-maintenance-windows.ts` are **structurally identical
files** (the maintenance file's own header says so verbatim) — same CRUD shape (`GET`/`POST`/
`PATCH /:id`), same scoping, same **retire-not-delete** discipline: there is no `DELETE` route for
either table; `PATCH { active: false }` is how a window is retired, because `cr_approvals
.freeze_window_id` may still point at a retired freeze row for an already-decided exception, and
losing that audit trail to a hard delete would be worse than an inactive row nobody matches
against.

`createSchema` (both files): `scope` (enum, required), `tenantId` (required iff
`scope==="tenant"`), `workload` (enum `CHANGE_REQUEST_WORKLOADS`, required iff
`scope==="workload"`), `name` (required, ≤200), `reason` (optional, ≤2000), `startsAt`/`endsAt`
(ISO datetime, `endsAt` strictly after `startsAt`), `recurrence` (enum, default `none`),
`recurrenceUntil` (optional ISO, only meaningful when `recurrence !== "none"`). `PATCH` re-validates
the same `endsAt > startsAt` invariant against whichever half is being changed, distinguishes
`undefined` (untouched) from explicit `null` (clears the field) for `reason`/`recurrenceUntil`.

`WireFreezeWindow` / `WireMaintenanceWindow`: `id, scope, tenantId, workload, name, reason,
startsAt, endsAt, recurrence, recurrenceUntil, active, createdBy, createdAt` — **note `updatedAt`
exists on the DB row but is not on either wire shape.**

`msp-change-dependencies.ts` — `GET/POST /msp/change-requests/:id/dependencies`,
`DELETE .../dependencies/:depId`. This router is **CRUD on the edges only**; the real enforcement
— a CR with an open blocker cannot be claimed to authorize a write — lives entirely in
`change-control-write-gate.ts`, not here. `POST` rejects a self-edge, requires both CRs exist and
belong to the caller's MSP, and rejects a **direct reverse-cycle** (A blocks B, then B blocks A) —
explicitly documented as a partial mitigation, not full graph cycle detection (Postgres cannot
express that declaratively, and a full transitive walk is out of scope for a two-CR edge). A
duplicate edge is caught on the DB's own unique-index collision, not pre-checked (avoids a TOCTOU
race). `WireDependencyEdge`: `id, otherChangeRequestCode, otherStatus, note, createdBy, createdAt`
— `otherStatus` is **free text with an explicit `"unknown"` fallback**, not a typed enum on the
wire. `rejected`/`rolled_back` blockers do **not** auto-release the edge — the blocking change
never actually landed, so clearing it is a deliberate MSP action (delete the edge).

---

## 7. `msp-change-executions.ts` — the execution record (`#1499`)

"A CR authorizes; it does not execute." One row per time an authorized change is actually carried
out, binding the CR to whichever of three executors did the work.

| Route | Behaviour |
|---|---|
| `GET /msp/change-control/executions?changeRequestId=<n>` | Executions for one change, or the MSP's 100 most recent when no id given |
| `POST /msp/change-control/executions/human-action` | Records **and immediately attests** a human action (a change only a person can make — Graph cannot reach a tenant admin's manual toggle) |
| `POST /msp/change-control/executions/:id/attest` | Attests a previously-recorded, still-unattested human action — `409` if not found, not a `human_action`, or already attested (three conditions collapsed into one message) |
| `POST /msp/change-control/executions/:id/reconcile-plan` | Diffs the captured `planOnly` plan against the run's real node outputs, persists the diff |
| `POST /msp/change-control/change-requests/:id/rollback` | Raises the INVERSE CR a rollback is — does **not** revert the tenant itself |
| `POST /msp/change-control/executions/:id/verify-rollback` | Records verification; on `outcome: "verified"` flips the **original** CR to `rolled_back` and its own forward execution's outcome to `rolled_back` |

**`recordExecution`'s crRef-writeback timing (`msp-change-execution-store.ts:68-101`):** a
`runbook_run`/`write_action` starts `pending`, `crRef` null — written back only once its bound
`wf_run` settles (`settleChangeExecutions`, the background reconciliation sweep, **not called from
any route in this pack** — it is a separate scheduled job). A `human_action` supplied with an
attestation at record time is `succeeded`/`crRef`-stamped immediately; one with none stays `pending`
until `/attest` is called.

**Rollback raise gate** (`raiseRollbackChangeRequest`, `msp-change-execution-store.ts:330-408`), in
order: original CR must exist; must not itself already be a rollback
(`rollbackOfChangeRequestId !== null` → 409); must be `status === "completed"`; must carry a
non-empty `rollbackScriptSnippet`. The inverse CR **swaps** `preChangeSnapshot`/`proposedPayload`
(the original's proposed payload becomes the inverse's pre-change snapshot and vice versa) so it
restores the prior state, copies the rollback snippet verbatim, sets
`linkedFinding: "Rollback of CR-..."` and `rollbackOfChangeRequestId`, and seeds its own
`cr_approvals` via the same `materializeApprovalsForChange` every forward change uses — **the
original CR is NOT flipped to `rolled_back` at raise time; that only happens once the inverse
execution is verified.** A pure predicate for this same eligibility exists
(`canRaiseRollback`, `msp-change-execution.ts:278-286`) but the store re-implements the same three
checks inline rather than calling it — same rules, two places, not a contradiction, worth flagging
as duplication.

`WireCrExecution` (verbatim, `msp-change-execution.ts:291-318`): `id, changeRequestId, changeCode,
tenantId, executorKind, wfRunId, packKey, implementer, outcome, confirmed, plannedPlan,
actualOutcome, planMatched, planDiff, crRef, writtenBackAt, attestedBy, attestedByPersonId,
attestedAt, attestationNote, rollbackVerifiedAt, rollbackOutcome, executedAt, createdAt`.
`confirmed` (`isExecutionConfirmed`): a `human_action` is confirmed only by a non-null
`attestedAt`; any other executor kind is confirmed once `outcome === "succeeded"` — the entire
reason the attestation columns exist ("an unattested human action is indistinguishable from
unattributed drift").

**409 reason strings on this router are free text, not a closed enum** (e.g. `` `only a completed
change can be rolled back (this one is '${status}')` ``) — Design must render these as opaque
server messages, not map them to fixed icon/state per value.

---

## 8. `msp-change-pir.ts` — Post-Implementation Review (`#1502`)

A close code a human types is a status field, not a review. A PIR **attaches** to the execution it
reviews (real FK, `UNIQUE` on `executionId`) and is never edited — a second PIR against an
already-reviewed execution is rejected (`409`); a correction is a new execution + a new PIR.

| Route | Behaviour |
|---|---|
| `POST /msp/change-control/executions/:id/pir` | Records close code, summary (required, 1–4000 chars), optional issues-noted, **and runs a real drift re-scan in the same call** |
| `GET /msp/change-control/executions/:id/pir` | The PIR for one execution — `{ pir: WireCrPir \| null }`; **null is a valid `200`, not a `404`** |
| `GET /msp/change-control/pirs?changeRequestId=<n>` | PIRs for one change, or the MSP's 100 most recent |

**The drift re-scan is real, and honestly bounded (`runDriftRescanForChange`,
`msp-change-pir-store.ts:70-212`):** only fires for `category === "ConditionalAccess"`
(`categoryHasDriftRescanPath`) — every other category records `driftRescanStatus:
"not_applicable"` with a note explaining why, rather than a fabricated clean result. When it does
run, it calls `executeMonitorCheck` — **the same real Graph-fetch + drift-collection path a
scheduled scan runs, not a second engine** — with `skipIdempotency: true` (a PIR re-scan must
observe the tenant NOW) and `persistProfile: false` (this must not become the tenant's live
per-check signal). The note text is explicit about what the re-scan can and cannot confirm — e.g.
a first-run baseline "reports zero drift by construction... does not by itself confirm the change
landed as intended," and even a full comparison "does not prove every individual setting this CR
intended to change, specifically." Never throws into the caller — a re-scan failure is recorded as
`status: "error"` with the real message, not silently swallowed or faked clean.

`recordPir` also appends a `pir_recorded` `cr_events` row in the same call (`toValue`: the close
code, `reason`: the summary) — the timeline and the PIR record can never diverge.

`WireCrPir` (verbatim, `msp-change-pir.ts:41-65`): `id, executionId, changeRequestId, changeCode,
tenantId, closeCode, summary, issuesNoted, reviewedBy, reviewedByPersonId, reviewedAt, driftRescan:
{ applicable, domainKey, checkKey, status, eventsInsertedCount, attributedCount,
otherOpenDriftCount, note, ranAt }, createdAt`.

---

## 9. CURRENT vs DECIDED vs OPEN GAP — the module map

| Capability | CURRENT on the MSP console | Marker |
|---|---|---|
| Create a CR | Full create door with freeze/maintenance/collision enforcement, approval seeding | **CURRENT** |
| List CRs | Raw row dump, no pagination, no filters (§2.1) | **CURRENT (unshaped)** |
| Approve / reject / schedule / execute / complete | One generic `PATCH`, gated on approval-completeness for the forward three transitions only | **CURRENT**, reject path has a real ledger gap — §12 |
| CR timeline (events/comments/attachments) | Full, curated `Wire*` shapes | **CURRENT** |
| Standard Change Catalog (author/approve/revoke) | Full; execute-from-catalog lives on the customer side | **CURRENT (governance only)** |
| CAB (membership/meetings/agenda/decision/ECAB) | Full; the only real approval decision point for a normal/emergency change that reaches a board | **CURRENT**, zero UI consumer |
| Freeze / maintenance calendars | Full CRUD, retire-not-delete | **CURRENT**, zero UI consumer |
| CR dependencies (`blocked_by`) | Full CRUD on edges; enforcement lives in the write gate | **CURRENT**, zero UI consumer |
| Execution record, planned-vs-actual, rollback-as-inverse-CR | Full | **CURRENT**, zero UI consumer |
| Post-Implementation Review + drift re-scan | Full, CA-only re-scan path | **CURRENT**, zero UI consumer |
| Change metrics (success rate, lead time, emergency ratio, CAB throughput) | `computeChangeMetrics` (`lib/portal-change-metrics.ts`) exists and is real, but is called **only** from the customer-portal route (`routes/portal-change-control.ts:1461`) | **OPEN GAP for MSP console** — no `/msp/change-control/metrics` (or equivalent fleet/tenant-scoped) endpoint exists; no MSP-side issue currently owns building one |
| MSP console UI itself | Does not exist — `artifacts/msp-console/src` is an empty scaffold | **DECIDED `#2578`/`#2579`** |

---

## 10. Cross-surface edges

| Edge | Mechanism | Marker |
|---|---|---|
| CR → tenant write authorization | `change-control-write-gate.ts` — `evaluateChangeRequestAuthorization` (pure) + `claimChangeRequestForWrite` (atomic `pending_approval`/`scheduled` → `in_progress` claim) + `settleAuthorizedChangeRequests` (reconciliation sweep). Fail-closed: no approved, unconsumed CR for the target tenant, no write. `#1773` narrows this further — a CR carrying `authorizedTargetKey` can only authorize that exact `pack:<packKey>`/`sop:<sopId>`. `#1504` folds `unresolvedBlockersFor` in — an open `blocked_by` edge blocks the claim too | **CURRENT**, `#1497`/`#1773`/`#1504` |
| CR → drift attribution | `monitor-executor.ts:buildCaChangeRequestAttribution` (`:135-165`) — **Conditional Access only**, looks back `CA_CR_ATTRIBUTION_WINDOW_DAYS = 30` days (`:119`) for a `completed` CR on the same tenant/category. A drift event carrying a real `crRef` reads as `approved`; nothing else does. Deliberately not widened — `cr_pirs`'s own drift-rescan honesty rule (§8) restates this same 30-day/CA-only boundary | **CURRENT (narrow)**, `#1497` |
| Rejection → risk register | `lib/portal-change-rejection.ts:recordRejection` — a **customer** rejection produces an accepted-risk row (`mspRiskDecisionsTable`, `riskStatus: "Accepted"`, 90-day review); an **MSP** rejection of its own proposed change produces **no** risk record — the finding stays open, unremediated, unaccepted. **Not reached from this MSP console's own generic `PATCH`** (§2.3's gap) | **CURRENT for customer/CAB rejection paths**, **NOT wired from `msp-changes.ts` PATCH** |
| CR completion → retainer billing | `logRetainerWorkFromTracker` (Git #1293), fired on the `PATCH`'s genuine transition into `completed` (§2.3) | **CURRENT** |
| Catalog item → CR | `changeCatalogItemsTable.status === "approved"` → any CR raised from it (customer-side execute route) is `standard`, inherits the catalog's approval as a real `cr_approvals` row with `approverRole: "catalog_inherited"`, `approverName` = the real human who approved the catalog item | **CURRENT** |
| Original CR ↔ rollback CR | `rollbackOfChangeRequestId` (self-FK, `set null` on delete) — see §7 | **CURRENT** |
| CR ↔ CAB agenda item | `cab_agenda_items.crApprovalId` → the real `cr_approvals` row a board decision produced (null for a `defer`, which decides nothing) | **CURRENT** |

---

## 11. The honest tri-state, and the orphan-check discipline

Per `#1485`'s standing convention: *"a contract pack that finds a real, live endpoint the page does
not call is a sub-issue, filed at pack time."* **Every endpoint in this pack is currently
unconsumed** — but this is the expected, correct state for this Feature at this point in its build
order (architect → endpoints → **this pack** → Design `#2578` → wire `#2579`), not a defect to file.
Filing "nothing calls any of these 25 endpoints" as a finding would misread the ordering rule this
project runs on. The two immediately-next issues (`#2578`, `#2579`) are exactly what closes this
gap.

There is no tri-state (loading/live-empty/read-failed) fixture-fallback question to raise here,
unlike the customer-portal pack's own §8 — there is no UI at all yet to have gotten that wrong.
When `#2579` wires this surface, the same HARD RULE applies: no fixture fallback on a read failure
or an unscoped MSP context.

---

## 12. Findings surfaced while extracting this pack

One real, confirmed gap was found reading `msp-changes.ts`'s `PATCH` route against the shared
approval/rejection library it partially, not fully, reuses (§2.3): **rejecting a CR through the MSP
console's generic status `PATCH` never calls `recordRejection`, so it never marks the pending
`cr_approvals` row(s) `rejected`/`superseded` and never flips a routed Microsoft change's
`m365_change_routings.decision`.** This is filed as its own issue, parented as a sibling of this
Feature (`#1681`), per the project's filing convention — see the completion comment on `#2577` for
the issue number.

The `#1506` change-metrics gap (§9) and the two wire-shape inconsistencies (raw-row `GET
/msp/change-requests`, §2.1; the CAB's inconsistent agenda-item shaping, §5) are recorded here as
**documentation for the Design/wire steps**, not filed as separate issues — none of them is a
defect against a spec; they are real, current facts about a surface that has not yet had a Design
pass, which is exactly what this pack exists to hand forward accurately.

---

## Appendix — source index

| Concern | File |
|---|---|
| CR CRUD, generic PATCH, timeline | `artifacts/api-server/src/routes/msp-changes.ts` |
| Standard Change Catalog | `artifacts/api-server/src/routes/msp-change-catalog.ts` |
| CAB | `artifacts/api-server/src/routes/msp-change-control-cab.ts`, `artifacts/api-server/src/lib/portal-cab.ts`, `artifacts/api-server/src/lib/portal-cab-store.ts` |
| Freeze / maintenance calendars | `artifacts/api-server/src/routes/msp-change-freeze-windows.ts`, `artifacts/api-server/src/routes/msp-change-maintenance-windows.ts`, `artifacts/api-server/src/lib/portal-change-freeze(-store).ts`, `artifacts/api-server/src/lib/portal-change-maintenance(-store).ts` |
| CR dependencies | `artifacts/api-server/src/routes/msp-change-dependencies.ts`, `artifacts/api-server/src/lib/portal-change-dependencies-store.ts` |
| Execution record, rollback | `artifacts/api-server/src/routes/msp-change-executions.ts`, `artifacts/api-server/src/lib/msp-change-execution(-store).ts` |
| Post-Implementation Review | `artifacts/api-server/src/routes/msp-change-pir.ts`, `artifacts/api-server/src/lib/msp-change-pir(-store).ts` |
| Approval model (shared with customer portal) | `artifacts/api-server/src/lib/portal-change-approvals(-store).ts` |
| Rejection model (shared, NOT reached from MSP `PATCH`) | `artifacts/api-server/src/lib/portal-change-rejection.ts` |
| Timeline store (shared) | `artifacts/api-server/src/lib/portal-change-timeline-store.ts` |
| Write gate / authorization | `artifacts/api-server/src/lib/change-control-write-gate.ts` |
| Drift attribution boundary | `artifacts/api-server/src/lib/monitor-executor.ts` (`:119`, `:135-165`) |
| Change metrics (customer-portal only) | `artifacts/api-server/src/lib/portal-change-metrics.ts` |
| Shared enums, category/workload/class/risk display maps | `artifacts/api-server/src/lib/portal-change-control.ts` |
| Stored rows + column enums | `lib/db/src/schema/msp.ts` (`:4601` CR table onward) |
| Role tiering | `artifacts/api-server/src/middlewares/requireAuth.ts` (`:81-89`, `:206-222`) |
| MSP context resolution | `artifacts/api-server/src/lib/resolve-msp-id.ts` |
| Mount points | `artifacts/api-server/src/routes/index.ts` (`:267-281` imports, `:553-567` `router.use`) |

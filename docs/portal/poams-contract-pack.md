# POA&Ms (Portal) — customer-Portal contract extraction pack for Claude Design

**#4021**, step 3 of **#1578** (contract extraction pack, run per module as step 3 of the
architect → build → document → Design → wire order), for **#1935** ("Feature: POA&Ms (Portal)"),
under **#1485** (EPIC: Portal New Design). Real backend: `portal-poams.ts` (749 lines, 6 routes
— see §0.3, this is more than the "569 lines, 4 routes" #4021/#1935 both describe; two routes
(`DELETE`, `request-acceleration`) landed under Git #3451 after those issues were last edited).

Read-only. Every field below is extracted verbatim from the route file, its `Wire*` interfaces,
and the Drizzle schema, cited to file:line, and cross-checked live against local PostgreSQL.
**Nothing here is authored or invented.** Do not re-derive the shared `msp_poams`/
`msp_poam_milestones` schema from scratch — the sibling MSP-console pack
(`docs/msp-console/poams-msp-console-contract-pack.md`, **#3373**, under #1571) already
extracted it in full; this pack cross-checks against that one rather than duplicating its own
§2/§3 work, and states only where the two packs now disagree (§8 — the sibling pack is stale
against the live schema in three respects).

Backend: `artifacts/api-server/src/routes/portal-poams.ts` — 749 lines, 6 routes, all live, all
mounted (`artifacts/api-server/src/routes/index.ts:185`):

- `GET    /api/portal/poams`                              — this customer's POA&Ms
- `GET    /api/portal/poams/:poamId`                       — one, with its milestones
- `POST   /api/portal/poams`                               — customer raises a new plan (#1933)
- `POST   /api/portal/poams/:poamId/sign`                  — the real customer signature
- `DELETE /api/portal/poams/:poamId`                       — soft-delete (Git #3451)
- `POST   /api/portal/poams/:poamId/request-acceleration`  — ask the MSP to purge early (Git #3451)

Schema: `lib/db/src/schema/msp.ts:7329` (`mspPoamsTable`), `:7453` (`mspPoamMilestonesTable`),
`:7255-7326` (the table's own header — settled #1935 architecture, restated where relevant
below). Verified live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d msp_poams'` /
`'\d msp_poam_milestones'` / a full `pg_constraint` dump) — every column, index and FK cited
below is confirmed present on the running schema exactly as the Drizzle source declares it, and
**neither table carries a `CHECK` constraint** (both `status` columns are plain `text`,
confirmed live — same as the sibling MSP-console pack found for its own read of the same
tables).

---

## 0. The surface and its consumers

### 0.1 Consumer map — genuinely zero, and this is expected, not a gap

`grep -rn "portal/poams|portal-poams" artifacts/ lib/ --include=*.ts --include=*.tsx` returns
hits only inside `portal-poams.ts` itself, its own route registration
(`routes/index.ts:185`), a live-DB test (`msp-retention-queue-poam-producer.live-db.test.ts`),
the retention wiring module's own header comment, and two **display-only tooltip strings** in
`artifacts/msp-console/src/modules/retention/RetentionQueue.tsx:218-219` that name
`portal-poams.ts` as one of the two real callers of `softDelete()`/`requestAcceleration()` for
an MSP-console operator's own information — not a caller of any `/api/portal/poams*` route.

**No frontend anywhere in this repository calls any of the 6 routes below.** Confirmed by the
same grep against `artifacts/portal` (the live customer-Portal app; there is no
`artifacts/msp-portal` in this tree — that name only ever referred to the retired `portal-v2`)
— zero matches for `poam` in any form. `Design/portal/` carries no `.dc.html` export for this
module either.

**This is the exact same expected pre-Design/pre-wire state the Risk Register pack's own §
"Portal consumer status" documents for its sibling module** (`docs/portal/risk-register-contract-
pack.md:36-44`) and the same state the MSP-console POA&Ms pack documents for its own 8 routes
(§0.1 there). Per this repo's own fixed order — architect → build the endpoints → regenerate
the contract pack (this document) → Design → wire — an unconsumed route at this exact step is
the process working as intended, not an orphaned-endpoint finding. **No sub-issue is filed for
it**, matching both cited packs' own precedent; the Design/wire steps remain tracked on #1935
itself.

| Endpoint | Method | Route file:line | Consumer today |
|---|---|---|---|
| `/api/portal/poams` | GET | `portal-poams.ts:225-276` | none |
| `/api/portal/poams/:poamId` | GET | `portal-poams.ts:279-325` | none |
| `/api/portal/poams` | POST | `portal-poams.ts:349-404` | none |
| `/api/portal/poams/:poamId/sign` | POST | `portal-poams.ts:417-590` | none |
| `/api/portal/poams/:poamId` | DELETE | `portal-poams.ts:614-661` | none |
| `/api/portal/poams/:poamId/request-acceleration` | POST | `portal-poams.ts:680-746` | none |

### 0.2 Role floor and gating — three independent axes, not one

Every route is gated `requireCapability("ladder.customer-user")` (`:227`, `:281`, `:351`,
`:419`, `:616`, `:682`) — the `Customer` capability rung (`middlewares/requireAuth.ts`'s
`#2460` capability model), matching the header's own stated reasoning (`:27-31`): a POA&M
carries the same governance/evidentiary weight as an RBD, so it uses the Risk Register's higher
floor rather than the lower `Free` floor some other customer-scoped routes use.

**A second, independent axis gates only the two READ routes.** `requireTierFeature
(PORTAL_TIER_MODULE_KEYS.poams)` (`:230`, `:282`) checks the customer's *purchased Monitoring
tier* bundles the `poams` module key (`portal-tier-features.ts:57`) — **creation, signing,
delete and request-acceleration are never gated by tier** (`:34-41`'s own header states this
explicitly, and it is true on inspection: none of the four write routes import or call
`requireTierFeature`). This is #1168's rule applied here exactly as it already is for
`riskRegister`/`policyDecisions` on the sibling module.

**Real, live, current fact: `poams` is in nobody's `includedFeatures` today.** Queried live
against local PostgreSQL:

```sql
select name, type_attributes->'includedFeatures' from services where service_type='monitoring_tier';
```

Every real tier row — all four Foundation, all four Growth, all four Premier/Enterprise
variants — carries an `includedFeatures` array with no `"poams"` entry (Foundation:
`policy_decisions, risk_register` only; Growth adds `message_center, remediation_tracking,
runbooks, sops_runbooks`; Premier/Enterprise adds `change_control, ownership, pii_governance,
security_plan` and reporting keys — `poams` is in none of them). **Both customer-facing READ
routes 402 for every real tenant on the platform today**, exactly matching the route header's
own stated expectation (`:38-41`: "until that's decided nothing resolves `includedFeatures` to
contain `poams`, so this fails closed"). This is a real pricing decision this pack does not
invent (same as the sibling pack states for its own analogous gaps) — Design/wire needs to know
the READ surface is currently unreachable behind a real 402 for every tenant, not a theoretical
edge case.

### 0.3 Route count is CURRENT as of Git #3451, not the "569 lines, 4 routes" both parent issues describe

Both #4021's own body and #1935's real status comment describe `portal-poams.ts` as "569 lines,
4 routes." **That was accurate when #3080 (Phase 1a) landed and is stale now.** Git #3451 (the
retention/soft-delete epic, #1944) added two more routes to this same file — `DELETE
/api/portal/poams/:poamId` and `POST /api/portal/poams/:poamId/request-acceleration` — bringing
it to 749 lines / 6 routes, confirmed by reading the file in full and by its own header
(`:1-48`) which documents all 6. This pack extracts the file as it stands today; §8 flags the
two stale line/route counts in the parent issues themselves as a documentation gap, not a code
gap.

---

## 1. Wire contract — `portal-poams.ts`

Unlike `msp-poams.ts` (no `Wire*` shape at all — bare rows, per the sibling pack's own §0.2),
**`portal-poams.ts` defines real, curated `Wire*` interfaces** for every read (`:102-168`):
`WirePoamAuthorityHolder`, `WirePoamAuthority`, `WirePoamMilestone`, `WirePoamSignature`,
`WirePoam`. Two fields are computed server-side, never stored: `isOverdue` and `isSigned`.

### 1.1 `WirePoam` — the shape both GET routes and the create/sign routes' own literal echoes approximate

| Wire field | Source | Type | Notes |
|---|---|---|---|
| `id` | `row.poamId` | string | the human code, e.g. `POAM-2026-014` — **not** the serial `id` |
| `title` | `row.title` | string | |
| `weakness` | `row.weaknessDescription` | string | |
| `checkKey` | `row.checkKey ?? null` | string \| null | |
| `status` | `row.status` | string | raw `PoamStatus` value, including `converted_to_risk_acceptance` (§8.1) — no client-side mapping applied |
| `isOverdue` | `computeOverdue(scheduledCompletionDate, status === "active")` | boolean | **derived, never stored** — see §1.4; only ever `true` for a currently-`active` plan whose live target date has passed |
| `scheduledCompletionDate` | `row.scheduledCompletionDate` | string (`YYYY-MM-DD`) | current, live target — may move |
| `originalScheduledCompletionDate` | `row.originalScheduledCompletionDate` | string (`YYYY-MM-DD`) | set once at creation, never rewritten (schema comment, `msp.ts:7351-7353`; confirmed no route in `portal-poams.ts` or `msp-poams.ts` ever writes it after insert) |
| `interimCompensatingControl` | `row.interimCompensatingControl` | string | |
| `resourcesRequired` | `row.resourcesRequired` | string | |
| `sowId` | `row.sowId ?? null` | string (uuid) \| null | |
| `authority` | `resolveRiskAuthority(customerId, checkKey)` → `toWirePoamAuthority` | object \| null | **CURRENT** A-holder picture — who holds Accountable on the resolved workload *right now*, not at signature time (§1.3, §7.1 — a real, live gap versus the signature block below) |
| `signed` | present only when `signedAt` and `signedBy.name` are both set (`:180-188`) | `WirePoamSignature` \| omitted | see §1.2 |
| `isSigned` | `signed !== undefined` | boolean | derived from the same guard, never a separate stored flag |
| `milestones` | `mspPoamMilestonesTable` rows for this parent, mapped through `toWireMilestone` | array | ordered `sortOrder` then `id` ascending, matching the MSP-console pack's own §1.3 note for the identical query shape |

### 1.2 `WirePoamSignature` — the block, and its real, confirmed gap

```
{ by: string; on: string; statement: string | null; authorizedBy: WirePoamAuthority | null }
```

`by`/`on`/`statement` come straight off `row.signedBy.name` / `row.signedAt` / `row.
signedStatement` (`:181-185`). **`authorizedBy` is hard-coded `null` in `toWirePoam` itself**
(`:186`, comment: *"point-in-time authority attached by the caller when available (see routes
below)"*) — **but no caller ever attaches it.** Traced both GET routes end to end (§1.3, §1.4):
neither one computes a point-in-time authority and neither overwrites `signed.authorizedBy`
after calling `toWirePoam`. See §7.1 — a real, live, confirmed gap, filed.

### 1.3 List — `GET /api/portal/poams`

`requireCapability("ladder.customer-user")`, `requireTierFeature(poams)` (`:227-230`, §0.2).
`scopeOrEmpty` (`:209-222`) resolves `customerId` (403 if absent) then `resolveTenantScope`
(serves `{poams: []}`, not an error, if the tenant scope can't resolve — matching the
`portal-risk-register.ts` convention for the same MSP-era-table scoping shape).

Query: every `msp_poams` row for `(mspId, tenantId)` **excluding soft-deleted** (`isNull
(deletedAt)`, `:245` — Git #3451; confirmed the sibling MSP-console pack's own extraction
predates this filter, since `msp-poams.ts`'s own list route was never touched by #3451 and has
no such filter, §8.2), newest-`id`-first. Milestones batched via one `inArray` query
(`:252-262`), grouped in memory. **Authority is resolved per-row via `Promise.all(rows.map(r =>
resolveRiskAuthority(...)))`** (`:264-266`) — CURRENT authority only, exactly the gap in §1.2:
there is no equivalent `resolveAuthorizedByAsOf`/`resolveRiskAuthoritiesBatch` call the way
`portal-risk-register.ts`'s own list route (`:453-458`) makes for its `authorizedBy` field on an
already-accepted risk.

### 1.4 Get one — `GET /api/portal/poams/:poamId`

Same two gates. Scoped lookup inline (`:296-306`, not a shared `loadOwnScoped` helper the way
the milestone routes' MSP-console-side siblings use — this file defines its own
`loadOwnScopedPoam` at `:593-606`, but only the DELETE/request-acceleration routes below call
it; this GET route re-implements the identical `(poamId, mspId, tenantId)` triple-match query
inline instead, §7.2). 404 if not found (cross-tenant probing reads as not-found, same
anti-probing discipline the sibling packs document elsewhere). Milestones ordered the same way
as the list route. Authority resolved via a single `resolveRiskAuthority` call (`:318`) — same
CURRENT-only gap as §1.3/§1.2, on this route too.

**`computeOverdue`** (`:98-100`): `isLive && dueDate < todayIso()`. `todayIso()` (`:92-94`) is a
plain UTC `YYYY-MM-DD` slice, directly comparable to the `date`-typed column with no timezone
parsing. For the parent POA&M, `isLive` is `status === "active"` (`:196`) — a `draft`/
`pending_signature`/`completed`/`cancelled`/`converted_to_risk_acceptance` plan is never
"overdue" by this computation, only an active one whose live target has passed. For a
milestone, `isLive` is `status === "pending"` (`:140`) — the same shape one level down.

### 1.5 Create — `POST /api/portal/poams`

`requireCapability("ladder.customer-user")` only — **no tier gate** (§0.2). Body
(`createPoamSchema`, `:338-347`):

| Field | Rule |
|---|---|
| `title` | `z.string().trim().min(1).max(300)` |
| `weaknessDescription`, `interimCompensatingControl`, `resourcesRequired` | `z.string().trim().min(1).max(4000)` |
| `checkKey` | `z.string().nullable().optional()` |
| `additionalCheckKeys` | `z.array(z.string()).nullable().optional()` |
| `scheduledCompletionDate` | `isoDate` (`^\d{4}-\d{2}-\d{2}$`, `:327`), required |
| `sowId` | `z.string().uuid().nullable().optional()` |

`tenantId`/`tenantName`/`primaryDomain`/`mspId` are **always** server-derived from
`resolveTenantScope`, never taken from the request body (`:376-380`) — same discipline the
Risk Register's own accept route applies to every server-set fact. `status` is **always**
`"pending_signature"` on insert (`:389`) — a customer-authored plan still goes through the real
signature ceremony below; there is no bypass. `originalScheduledCompletionDate` is set
identical to `scheduledCompletionDate` at creation (`:386`), matching the write-once contract.
`poamId` is never client-supplied: `randomPlaceholder()` reserves a collision-safe value, then
`assignPoamId` (`poam-ref.ts:32-39`) swaps in the real `POAM-2026-<n>` code guarded on the
placeholder still matching — the identical mechanism `msp-poams.ts`'s own create route uses
(sibling pack §1.2), confirmed shared via the same `poam-ref.ts` import on both sides.

Success `201`: `{id: poamId, message}` (`:398`) — the real assigned code.

### 1.6 Sign — `POST /api/portal/poams/:poamId/sign`

The real customer signature ceremony (#1935: "needs real customer signature, mirror #1510's own
trigger rule"). Body (`signSchema`, `:411-415`):

| Field | Rule |
|---|---|
| `fullName` | `z.string().trim().min(2).max(200)` |
| `confirmed` | `z.literal(true)` — the checkbox IS the consent, not a boolean the server merely checks truthy |
| `statement` | `z.string().trim().min(1).max(2000)` |

Guards, in order (`:443-469`):
1. Scoped lookup — 404 if not found in this tenant (same anti-probing shape as §1.4).
2. `existing.signedAt !== null` → `409 CONFLICT`, "This POA&M has already been signed and cannot
   be changed" — the pre-check half of write-once.
3. `existing.status === "cancelled" || "completed"` → `409 CONFLICT`, "This POA&M is {status}
   and cannot be signed".

**Role-based signature authority (#1491, reusing #1511's exact mechanism, imported verbatim
from `risk-authority.ts` — never re-implemented for POA&Ms):**

- `resolveRiskWorkload(existing.checkKey)` (`:476`) resolves the check to a workload, or `null`
  for a `checkKey` outside the resolvable map.
- **If a workload resolves:** `currentAHolderPersonIds` (`:481`) must return at least one
  holder (409 "No one currently holds Accountable authority for {label}..." if empty, `:483-
  489`), and the signer's own `personIdForUser(req.user.id)` must be among them (403 "Only an
  Accountable holder for {label} can sign this plan," with the real holder names attached,
  `:491-500`, if not).
- **If no workload resolves** (`checkKey` null or unmapped): **any** `Customer`-floor caller may
  sign — the honest fallback the header states (`:475-476`).

On success, one guarded `UPDATE ... WHERE id = existing.id AND signed_at IS NULL` (`:524-545`)
sets `signedAt`, `signedStatement`, `signedBy` (a `ClientApprover`: name, blank title/email,
formatted UTC timestamp string, `req.ip` trimmed-or-null, a SHA-256 `signatureHash` over
`poamId|fullName|signedAt ISO|statement`), `status → "active"`, and the four #1511-shaped
accountability columns (`authorizingWorkloadId`/`_Label`, `authorizingHolderPersonIds`,
`signedByPersonId`) — **the only writer of any of these four anywhere in either route file**
(confirmed, matching the sibling pack's own §2 cross-surface-edges row for this exact fact). A
`0`-row update result (a genuine concurrent-signature race — two requests both passing the
pre-check) re-reports the identical 409 (`:547-550`), not a silent success.

**Real, known limitation carried over from the Risk Register's own accept route, restated
here rather than re-derived:** `req.ip` reads the proxy's loopback hop until Express `trust
proxy` is configured app-wide (`:508-510`'s own comment) — a platform-wide gap, not specific to
this route, and not this pack's to fix.

The success response (`201`, `:576-584`) is a **hand-built object, not `toWirePoam`** — it
separately computes a real `authorizedBy` from `authorizingHolderIds`/`namesForPersonIds` when a
workload resolved. This is the **only** place in the entire route file where a real, non-null
`authorizedBy` is ever produced — see §1.2/§7.1: the GET routes' `WirePoam.signed.authorizedBy`
never carries this same data back out on a later read.

### 1.7 Delete — `DELETE /api/portal/poams/:poamId` (Git #3451)

Scoped via `loadOwnScopedPoam` (`:593-606`, the one route pair that does use the shared
helper). Body (`deletePoamReasonSchema`, `:608-610`): `reason: z.string().trim().min(1)` —
**required on every delete, no exception for an empty/never-active plan** (contrast #1935's own
architecture comment D, which describes escalating friction "only when the POA&M has content" —
this route does not distinguish; every delete requires a reason regardless of plan state, a real
fact for Design to know before building the friction ladder #1935's architecture comment
describes, §7.3).

Delegates to the shared `softDelete()` (`lib/retention/lifecycle.ts`), passing `recordType:
"msp_poams"`, `recordId: String(existing.id)`, the reason, and an actor block with `side:
"customer"`. A `RetentionError` maps to its own `httpStatus`/`message` (`:653-656`) rather than
a generic 500. Success: `{poamId, deletion, message}` (`:651`) — `deletion` is whatever shape
`softDelete()` itself returns (retention-lifecycle's own contract, not re-derived here).

**No RBAC restriction to a "customer admin" role at this route** — every `Customer`-floor
caller who owns the plan can soft-delete it today. #1935's own architecture comment (2026-08-30,
"Delete — restricted, deliberately hostile, and soft") states delete should be reserved for
"Shane, and a customer admin role… That role does not exist yet… This depends on #1696 (role
model) and #1704 (`can(principal, action, resource)`)." **That dependency is still real and
unmet on this route** — `requireCapability("ladder.customer-user")` is the same floor every
other route in this file uses, with no additional restriction. Not filed as a bug (the
architecture comment itself frames this as blocked on #1696/#1704, not a defect in this build),
but stated plainly for Design/wire: the UI-side friction ladder (warn → stronger warn → type-
exact-name → final confirm) the architecture settled on has **no matching server-side role
restriction yet** — the friction is UI-only unless/until #1696/#1704 land.

### 1.8 Request acceleration — `POST /api/portal/poams/:poamId/request-acceleration` (Git #3451)

Only reachable once the plan is already soft-deleted (`findOpenDeletion("msp_poams",
String(existing.id))`, 409 "This POA&M is not currently deleted, so there is nothing to
accelerate" otherwise, `:703-711`). Body (`requestAccelerationSchema`, `:663-669`):
`reasonKind: z.enum(["superseded_by", "no_longer_needed"])`, `reason` (required string),
optional `supersededByRecordType`/`supersededByRecordId` pair (both required together when
`reasonKind === "superseded_by"`, enforced by `requestAcceleration()` itself per this route's
own header comment, not re-validated here). **Does not execute the purge itself** — produces a
`record_deletions.acceleration_state = 'pending'` row for the #1571 MSP-console review queue; an
operator still has to decide via `POST /api/msp/retention/queue/:id/decide` (confirmed live —
`RetentionQueue.tsx:219` names this exact route as the real producer). Success: `{poamId,
deletion, message: "Acceleration requested — awaiting operator review"}` (`:732-736`).

---

## 2. Cross-surface edges — restated from the sibling pack, plus what's changed since

The sibling MSP-console pack's own §2 table is the accurate map for everything that predates
Git #3081/#3451. Restated here only where this pack's own read confirms or extends it:

| Edge | Column(s) | Written by | Read by |
|---|---|---|---|
| POA&M identity | `poam_id` | either side, via the shared `poam-ref.ts` pair — confirmed both `msp-poams.ts:136` and `portal-poams.ts:377` import the identical `randomPlaceholder`/`assignPoamId` functions | both |
| Real customer signature | `signed_at`, `signed_by`, `signed_statement`, `status → "active"` | **`portal-poams.ts` only** (§1.6) | `msp-poams.ts`'s list/get read them back raw (sibling pack §0.2); `portal-poams.ts`'s own GET routes read them back through `toWirePoam` but never re-attach `authorizedBy` (§1.2/§7.1) |
| Role-based accountability audit (#1511-shape) | `authorizing_workload_id/_label`, `authorizing_holder_person_ids`, `signed_by_person_id` | **`portal-poams.ts` only** (§1.6) | same gap as above |
| Cancel (`status → "cancelled"`) | — | `msp-poams.ts` only (both its dedicated cancel route and, per the sibling pack's own §4.1 finding #3452, its under-gated generic PATCH) | — **no route in `portal-poams.ts` can cancel a plan**; the customer-facing terminal action is delete (§1.7), a structurally different operation (soft-delete + retention lifecycle, not a status flip) |
| Bidirectional risk ⟷ POA&M conversion (`spawned_by_risk_decision_id`, `converted_to_risk_decision_id`, `conversion_reason`, `status → "converted_to_risk_acceptance"`) | **`msp-poams.ts`/`msp-rbd.ts` only** — `POST /api/msp/poams/:poamId/convert-to-risk-acceptance` (`msp-poams.ts:443`) and `PATCH /api/msp/rbd/:rbdId/convert-to-poam` (`msp-rbd.ts:466`), both `MSPAdmin`-gated, confirmed live via grep | `portal-poams.ts`'s own GET routes surface the resulting raw `status` value with no special-casing (§8.1) — **the customer-Portal side has no conversion route of its own**; a customer cannot convert their own risk/plan, only MSP staff can, on either surface |
| Milestone container | `msp_poam_milestones.poam_id → msp_poams.id`, `ON DELETE CASCADE` | real hard FK, confirmed live (`msp_poam_milestones_poam_id_fkey`) | both route files |
| Soft-delete triple (`deleted_at`, `deleted_by`, `delete_reason`) | **`portal-poams.ts`'s own DELETE route, or `msp-poams.ts`'s own DELETE route** (both call the shared `softDelete()` — confirmed, `msp-console/.../RetentionQueue.tsx:218` names both files as the real callers) | `portal-poams.ts`'s two GET routes filter `isNull(deletedAt)` (§1.3) — **confirmed `msp-poams.ts`'s own list/get routes do NOT apply this filter** (its own file has no `deletedAt` reference in either read route, checked directly); a soft-deleted POA&M disappears from the customer's own list but would still appear on the MSP-console list today, a real cross-surface asymmetry, §8.2 |
| SOW tie-in | `sow_id → msp_sows.sow_id` | both sides' create/edit | both |

---

## 3. Real enum unions

`POAM_STATUSES` (`msp.ts:7326`) — **six** values, not five: `draft`, `pending_signature`,
`active`, `completed`, `cancelled`, **`converted_to_risk_acceptance`**. The sibling MSP-console
pack's own §3 lists only the first five — see §8.1, that pack predates #3081 landing the sixth.

`portal-poams.ts` never validates an incoming `status` against this enum at all — it only ever
*writes* two literal values itself (`"pending_signature"` at create, `:389`; `"active"` at sign,
`:530`), and only ever *reads* the column back verbatim (§1.1's `status` row) with no
client-side re-validation or mapping. A Design/wire consumer reading `WirePoam.status` needs to
handle all six real values, including the two this route file never itself produces
(`cancelled` — MSP-console only; `completed` — no route anywhere writes it yet, per the sibling
pack's own §4.1 finding; `converted_to_risk_acceptance` — MSP-console-only conversion route).

`POAM_MILESTONE_STATUSES` (`msp.ts:7451`) — unchanged from the sibling pack: `pending`,
`completed`.

Neither table carries a Postgres `CHECK` constraint (confirmed live, §above) — both `status`
columns are plain `text`, enforced only by whichever zod schema happens to validate a given
write. `portal-poams.ts`'s own milestone-status enum is never referenced at all — this route
file has no milestone-mutation routes of any kind; all milestone create/edit/delete lives
exclusively on the MSP-console side (sibling pack §1.6). A customer viewing their own POA&M's
milestones (§1.4's `milestones` array) has no way to add, edit, or complete one through this
surface — read-only for the customer, by design (matches the module header's own framing:
"MSP staff author and manage the plan itself... milestones" — `msp-poams.ts:5-6`).

---

## 4. Completeness audit

All 6 routes read in full. Result: **5 of 6 are complete and internally consistent with their
own stated intent. One (§1.2/§7.1) has a real, live gap.**

- Create (§1.5), sign (§1.6), delete (§1.7), and request-acceleration (§1.8) all correctly
  server-derive every fact they must (scope, `poamId`, `originalScheduledCompletionDate`,
  signature fields, retention actor) and correctly guard every terminal/race state a plausible
  concurrent caller could hit (write-once signature, already-deleted-vs-not-yet-deleted for
  acceleration).
- Both GET routes correctly scope every query and correctly exclude soft-deleted rows.
- The one incomplete piece is `WirePoam.signed.authorizedBy` (§7.1) — real, live, filed.

---

## 5. The forbidden list — declared, not merely absent

1. **No cross-tenant read.** Every route resolves scope via `resolveCustomerId`/
   `resolveTenantScope` (session-derived only) and both GET routes' underlying queries filter on
   the resulting `(mspId, tenantId)` pair — verified on every route, no exception.
2. **`tenantId`/`tenantName`/`primaryDomain`/`mspId` are never client-suppliable.** True on the
   one route that could plausibly accept them (create, §1.5) — confirmed `createPoamSchema` has
   no fields for any of the four.
3. **`poamId` is never client-suppliable at creation.** True — `createPoamSchema` has no
   `poamId` field; the server-generated placeholder/assign pair is the only path (§1.5).
4. **`originalScheduledCompletionDate` never moves after creation.** True — no schema in this
   file accepts it on any route past create.
5. **A signature, once set, is never editable.** True — the guarded `UPDATE ... WHERE signed_at
   IS NULL` plus the pre-check 409 are belt-and-suspenders (§1.6), matching the sibling pack's
   own milestone write-once discipline one level up.
6. **A customer cannot cancel, complete, or convert a plan through this surface.** True — no
   route in this file writes any of those three transitions; all three are MSP-console-only
   (§2).

---

## 6. Tri-state read honesty

- **Loading**: not this pack's concern (client-side state, no server contract).
- **Live, genuinely empty**: `GET /api/portal/poams` returns `{poams: []}` both when the tenant
  scope resolves to zero real rows AND when the tenant scope itself fails to resolve at all
  (`scopeOrEmpty`, `:216-220`) — **these are the same wire shape**, a real, honest fact Design
  needs: a customer with a broken/unresolvable tenant scope sees an identical empty list to one
  who genuinely has no POA&Ms, with no way to distinguish the two from the response body alone
  (the difference is only visible server-side, in the `log.info` call at `:217`). Not filed —
  matches `portal-risk-register.ts`'s own documented convention for the identical MSP-era
  scoping shape, not a defect specific to this module.
- **Read failed**: any route's `catch` block returns a real `500`/`ApiErrorCode.INTERNAL` with
  the actual error message (never swallowed to an empty success shape) — confirmed on every one
  of the 6 routes.
- **Tier-gated closed**: the two READ routes 402 today for every real tenant (§0.2) — a fourth,
  real state beyond loading/empty/failed that Design must account for, since it is not
  hypothetical, it is the *current* state for 100% of live tenants.

---

## 7. Open gaps and notes

### 7.1 `WirePoam.signed.authorizedBy` is always `null` on every read — real, live, filed

Restated from §1.2/§1.3/§1.6: `toWirePoam` (`:186`) hard-codes `signed.authorizedBy: null` with
a comment promising the caller attaches it "when available." **No caller ever does.** Traced
both GET routes end to end: `GET /api/portal/poams` (`:264-269`) and `GET /api/portal/poams/
:poamId` (`:318-319`) both call only `resolveRiskAuthority` (CURRENT state) and pass its result
as the *top-level* `authority` argument to `toWirePoam` — neither route calls
`resolveAuthorizedByAsOf` (the point-in-time replay function `risk-authority.ts:177-188` already
exports and already uses correctly on `portal-risk-register.ts`'s own equivalent field, confirmed
by reading that file: `:342`, fed by `:453-458`'s `resolveRiskAuthoritiesBatch`) and neither
route ever overwrites `signed.authorizedBy` after calling `toWirePoam`.

**Concrete effect:** an already-signed POA&M, read back through either GET route, always shows
`signed.authorizedBy: null` — even though the exact point-in-time data (`authorizing_workload_id
`/`_label`/`authorizing_holder_person_ids`) is sitting on the row, was written by the sign route
itself (§1.6), and is only ever surfaced once, transiently, in that route's own `201` response
body. A customer who reloads the page, or views a plan someone else signed, permanently loses
the "who backed this signature" evidence the Risk Register's own equivalent field
(`WireAcceptance.authorizedBy`) correctly preserves for the identical concept on the sibling
module. This is exactly the kind of evidentiary gap #1935's own architecture settled the whole
signature ceremony to prevent ("the same class of governance/compliance weight" the module
header cites for its elevated role floor) — real, live, confirmed by reading both GET routes to
their end.

**Filed as a new sub-issue, parented to #1935** (this Feature) per the standing rule — see
Provenance.

### 7.2 `GET /portal/poams/:poamId` re-implements the scoped lookup inline instead of using the file's own `loadOwnScopedPoam`

`loadOwnScopedPoam` (`:593-606`) is defined in this same file and is the exact
`(poamId, mspId, tenantId)` triple-match query `GET /portal/poams/:poamId` (`:296-306`)
duplicates by hand — only the DELETE and request-acceleration routes (added later, under
#3451) actually call the shared helper. Not a behavior bug (both queries are identical in
effect, confirmed by reading both) — flagged as a real, live inconsistency for whoever next
touches this file, not filed as its own issue (same "flag, don't file" threshold the sibling
packs apply to their own cosmetic-but-real findings).

### 7.3 The delete-friction ladder #1935's architecture describes is not implemented server-side, and the reason field has no "only when the plan has content" carve-out

Restated from §1.7: #1935's own 2026-08-30 architecture comment (part 4) describes escalating
UI friction "only when the POA&M has content" and reserves delete for Shane plus a not-yet-built
customer-admin role. As implemented today, `DELETE /portal/poams/:poamId` requires a
non-empty `reason` unconditionally (no content-based carve-out) and enforces no role beyond the
baseline `Customer` capability. Both are real, current facts about the server contract — stated
for Design/wire, not filed, since the architecture comment itself already names #1696/#1704 as
the blocking dependency for the role half, and the reason-required-always behavior is a
reasonable, defensible implementation choice the architecture comment doesn't explicitly forbid.

### 7.4 `additionalCheckKeys` is writable here too (matches the MSP-console side, unlike the Risk Register's own version of this column)

Same fact the sibling pack's own §5.3 states for its side: `createPoamSchema` (`:342`) accepts
`additionalCheckKeys`, matching `msp-poams.ts`'s create/edit schemas. Stated for completeness,
not a gap on either side.

---

## 8. Where this pack corrects the sibling MSP-console pack (extracted 2026-09-10, now stale in three respects)

The sibling pack (`docs/msp-console/poams-msp-console-contract-pack.md`) is dated/extracted
2026-09-10 and reflects the schema/route state as of Git #3080/#3081's earliest landing. Real
commits have landed on the shared table since. Stated here rather than silently worked around,
since a Design/wire session reading both packs needs to know which one is current for each
fact:

### 8.1 `POAM_STATUSES` now has six values, not five

The sibling pack's own §3 table lists `draft, pending_signature, active, completed, cancelled`
— five values. The live schema (`msp.ts:7326`, confirmed live) carries a sixth:
`converted_to_risk_acceptance`, added by Git #3081 (Phase 1b, the bidirectional risk⟷POA&M
conversion) after the sibling pack's own extraction date. This pack's §3 carries the corrected,
current six-value list.

### 8.2 `msp-poams.ts`'s own list/get routes do not filter soft-deleted rows — a real, live cross-surface asymmetry the sibling pack couldn't have found

Git #3451 (soft-delete/retention) landed after the sibling pack's 2026-09-10 extraction date, so
that pack's own read of `msp-poams.ts` predates the column existing at all. Confirmed by reading
`msp-poams.ts` directly, today: its list route (`:66-90`) and get route (`:160-190`) both query
`mspPoamsTable` with no `isNull(deletedAt)` predicate anywhere — contrast `portal-poams.ts`'s
own list route, which does filter (§1.3). **A POA&M a customer soft-deletes through the Portal
disappears from their own list but keeps appearing on the MSP-console list**, and the reverse is
also true for an MSP-authored delete. This is a real, live, current gap — filed as a new
sub-issue, parented to #1571 (the fallback area epic for the MSP-console side, since this is an
`msp-poams.ts` defect, not a `portal-poams.ts` one) per the Feature-first rule — see Provenance.

### 8.3 `msp-poams.ts` now has 10 routes, not 8

Restated from §2/§0.3: Git #3081 added `POST /api/msp/poams/:poamId/convert-to-risk-acceptance`
and Git #3451 added `DELETE /api/msp/poams/:poamId`, both confirmed live by reading the file's
own current header (`msp-poams.ts:13-35`) and both routes' implementations directly. The sibling
pack's own §0.1/Provenance describe "462 lines, 8 routes" — accurate as of its own extraction
date, stale now. Not separately filed (this pack's own §0.3 already states the analogous fact
for `portal-poams.ts`, and a stale line/route count in a contract pack is a documentation
staleness fact, not a code defect) — noted here so a reader of both packs isn't misled by the
mismatch.

---

## 9. Provenance

Extracted 2026-09-14 for **#4021**, under **#1935** ("Feature: POA&Ms (Portal)"), itself under
**#1485** (EPIC: Portal New Design). Read in full, not sampled: `portal-poams.ts` (749 lines, all
6 routes), `poam-ref.ts` (40 lines), `risk-authority.ts` (262 lines, for the §1.2/§7.1 gap and
its correctly-working analogue on `portal-risk-register.ts`), `portal-customer-scope.ts` (for
the `resolveCustomerId`/`resolveTenantScope` scoping shapes), `portal-tier-features.ts` (for the
real `poams` module key and its current, live non-inclusion in any tier), the retention wiring
module (`lib/retention/wiring/msp-poams.ts`), and the `msp_poams`/`msp_poam_milestones` Drizzle
schema and its own header comment (`lib/db/src/schema/msp.ts:7255-7474`). Cross-read
`msp-poams.ts` (current, 10-route state) and `msp-rbd.ts` (for the reverse conversion route) to
confirm the §2 cross-surface edges and §8's corrections to the sibling pack. Verified live
against local PostgreSQL — both tables' full column/index/FK list re-confirmed to match the
Drizzle source exactly, confirmed neither table carries a `CHECK` constraint, and confirmed via
a live query against `services.type_attributes` that no real Monitoring tier currently includes
`poams` in `includedFeatures`. Confirmed via repo-wide grep that zero consumers exist for any
`/api/portal/poams*` route, matching the expected pre-Design/pre-wire state the Risk Register
pack's own precedent already established for not filing that absence as a finding.

**Two real, live findings — filed, not merely noted:**
- §7.1 — `WirePoam.signed.authorizedBy` is always `null` on every read (`GET /api/portal/poams`,
  `GET /api/portal/poams/:poamId`), despite the point-in-time authority data existing on the row
  and the identical concept working correctly on `portal-risk-register.ts`. Filed as a new
  issue, `bug`, parented to **#1935** (this Feature).
- §8.2 — `msp-poams.ts`'s list/get routes do not exclude soft-deleted rows, so a POA&M deleted on
  one surface keeps appearing on the other. Filed as a new issue, `bug`, parented to **#1571**
  (the MSP-console area epic — the defect is in `msp-poams.ts`, not this pack's own subject
  file, per the Feature-first rule's own fallback logic).

No product code, schema, or UI was changed by this pass.

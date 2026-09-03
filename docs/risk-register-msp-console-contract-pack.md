# Risk Register / RBD — MSP Console contract extraction pack

**#2580**, the Document step for **#1682** (Feature: Risk Register / RBD, MSP Console — the
operator half of #1487), under the reset #1571 (EPIC: Portal Admin) and its fixed 4-step order:
API build-out → **Document (this pack)** → Design → Implement & wire. `artifacts/msp-console`
itself does not exist yet (#1680 was closed `NOT_PLANNED` 2026-09-03 as part of #1571's reset —
the artifact not existing is a blocker for #2582 (wire), not for this step: the backend this pack
documents is real, audited, and already mounted).

Read-only. Every field below is extracted verbatim from the route's own `Wire*` interfaces (where
one exists — see §0.2, not every route here has one) and the Drizzle schema, cited to file:line,
and cross-checked live against local PostgreSQL. **Nothing here is authored or invented.**

This is a **separate module** from `docs/risk-register-contract-pack.md` (the customer-portal
pack, #1712). That pack explicitly scopes the MSP-side routes as "context only, not portal
surfaces." This pack is the operator-facing wire contract those routes actually need, extracted to
the same standard.

Backend routes (all live, all mounted — `artifacts/api-server/src/routes/index.ts:266-269,
535-538`):
- `artifacts/api-server/src/routes/msp-rbd.ts` — catalogs, list, create, sign, revoke (6 routes)
- `artifacts/api-server/src/routes/msp-rbd-instances.ts` — line items: list/add/accept/resolve
  (4 routes)
- `artifacts/api-server/src/routes/msp-rbd-versions.ts` — document versioning: list/current/
  capture/sign/render/share/narrative-audit (7 routes)

**17 routes total, not 16** (the dispatch comment's spot-check count) — the extra is
`available-obligations` (`msp-rbd.ts:109`), a real, live, mounted route the spot-check missed.
Recounted directly from the route files, not from the dispatch estimate.

Schema: `lib/db/src/schema/msp.ts:5945` (`mspRiskDecisionsTable`), `:6258`
(`mspRbdVersionsTable`), `:6368` (`mspRbdNarrativeAuditTable`), `:6738` (`riskInstancesTable`).
Verified live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d msp_risk_decisions'` /
`'\d risk_instances'` / `'\d msp_rbd_versions'`) — every column cited below is confirmed present
on the running schema, not just in the Drizzle source.

---

## 0. The surfaces and their consumers

### 0.1 Consumer map

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/rbd/available-checks` | GET | `msp-rbd.ts:79-101` | **AdminV2** Risk-Based Decisions screen (`riskDecisionsStore.ts:170`, #1294) | live, cross-surface reuse |
| `/api/msp/rbd/available-obligations` | GET | `msp-rbd.ts:109-148` | none | live, genuinely unconsumed today — staged for #2582 |
| `/api/msp/rbd` | GET | `msp-rbd.ts:152-177` | **MCP server** `get_risk_register` tool (`get-risk-register.ts:54`) | live, cross-surface reuse |
| `/api/msp/rbd` | POST | `msp-rbd.ts:181-246` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/sign` | PATCH | `msp-rbd.ts:250-316` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/revoke` | PATCH | `msp-rbd.ts:320-368` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/instances` | GET | `msp-rbd-instances.ts:94-116` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/instances` | POST | `msp-rbd-instances.ts:126-167` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/instances/:instanceId/accept` | PATCH | `msp-rbd-instances.ts:172-206` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/instances/:instanceId/resolve` | PATCH | `msp-rbd-instances.ts:217-262` | Shadow IT governance path adds instances directly via the shared `addRiskInstance` lib call, not this route — see §4 | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions` | GET | `msp-rbd-versions.ts:146-165` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions/current` | GET | `msp-rbd-versions.ts:169-192` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions` | POST | `msp-rbd-versions.ts:243-297` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions/narrative-audit` | GET | `msp-rbd-versions.ts:303-322` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions/:versionUid/sign` | PATCH | `msp-rbd-versions.ts:339-391` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions/:versionUid/document` | POST | `msp-rbd-versions.ts:407-442` | none | live, staged for #2582 |
| `/api/msp/rbd/:rbdId/versions/:versionUid/share` | POST | `msp-rbd-versions.ts:447-474` | none | live, staged for #2582 |

**No orphaned-endpoint sub-issue filed for the 14 "staged for #2582" rows.** This is the expected
pre-Design/pre-wire state, exactly like the customer-portal pack's §0 — every one of these is
already tracked, has a real Design step (#2581) and wire step (#2582) ahead of it, and the backend
was audited (this pack) before either. `available-obligations` is the same case — real, live,
mounted, zero consumers, explicitly staged, not a gap.

### 0.2 Two of three route files use a real `Wire*` shape. One does not.

**`msp-rbd-instances.ts` and `msp-rbd-versions.ts` both define and return curated `Wire*`
interfaces** (`WireRiskInstance`, `WireRbdVersion`, `WireRbdNarrativeAudit`, `WireRbdDocument` —
§§2–3). **`msp-rbd.ts` does not.** `GET /api/msp/rbd` (`:164-170`) and the sign/revoke PATCH
responses' `existing`/`updatedApprover` reads are all bare `db.select()` / `db.update().returning()`
calls against `mspRiskDecisionsTable` — every column on the table (§1.1) is on the wire, verbatim,
with no filtering and no derived fields. This is real, live behavior, not a gap this pack invents:
`get-risk-register.ts:25-40`'s own `RiskDecision` interface documents the fact by only cherry-
picking the fields it cares about behind a `[k: string]: unknown` index signature — it already
treats the wire as effectively untyped.

**Concretely, this means `GET /api/msp/rbd` does NOT carry the derived/formatted fields the
customer-portal pack's `WireRisk` does** — no `obligationType` (join), no
`spawnedByChangeRequestCode`/`dischargedByChangeRequestCode` (formatted `CR-2026-<n>` strings —
only the raw integer FK ids `spawnedByChangeRequestId`/`dischargedByChangeRequestId` are present),
no `authority`/`authorizedBy` (role-based authority resolution, §4). Whoever builds #2582 needs to
either add a curated `Wire*` shape to `msp-rbd.ts` (matching the discipline its two sibling files
already use) or have the MSP Console UI do its own client-side joins/formatting against the raw
row — this pack states the fact, the choice is #2582's to make, not this pack's.

---

## 1. Wire contract — `msp-rbd.ts`

### 1.1 List — `GET /api/msp/rbd`

Returns a bare array of `mspRiskDecisionsTable.$inferSelect` rows (`:164-170`), newest-id first,
scoped to `mspId` only (`resolveMspIdStrict`, never the request body). No customer/tenant filter —
this is the cross-customer register for one MSP, matching the MCP tool's own description
(`get-risk-register.ts:45`, "across their customers").

Every DB column is on the wire (camelCased by Drizzle), verified live:

| Wire field | DB column | Type | Nullable | Notes |
|---|---|---|---|---|
| `id` | `id` | serial | no | |
| `mspId` | `msp_id` | integer, FK → `msps.id` cascade | no | |
| `rbdId` | `rbd_id` | text | no | unique with `mspId` (`msp_risk_decisions_msp_id_rbd_id_uidx`) |
| `tenantId` | `tenant_id` | text | no | |
| `tenantName` | `tenant_name` | text | no | |
| `primaryDomain` | `primary_domain` | text | no | |
| `title` | `title` | text | no | |
| `controlViolated` | `control_violated` | text | no | |
| `framework` | `framework` | text | no | |
| `checkKey` | `check_key` | text | yes | `monitor_checks.key`, deliberately no hard FK — see §4 |
| `additionalCheckKeys` | `additional_check_keys` | jsonb `string[]` | yes | #1957/#1489 multi-check suppression; not written by any MSP-side route in this pack — see §7.1 |
| `rawRiskLevel` | `raw_risk_level` | text | no | enum §5, `critical\|high\|medium` |
| `residualRiskLevel` | `residual_risk_level` | text | no | enum §5, `high\|medium\|low` |
| `rawRiskScore` | `raw_risk_score` | integer | no | client-supplied on create (§1.3) — see §7.2 |
| `residualRiskScore` | `residual_risk_score` | integer | no | client-supplied on create — see §7.2 |
| `liabilityValueUsd` | `liability_value_usd` | integer | no | |
| `hazardDescription` | `hazard_description` | text | no | |
| `graphEndpoint` | `graph_endpoint` | text | no | |
| `compensatingControls` | `compensating_controls` | jsonb `CompensatingControl[]` | no, default `[]` | `{type, description}`, type enum §5 |
| `mspAssessor` | `msp_assessor` | jsonb `{name, upn, timestamp}` | no | server-set from `req.user` on create, never client-supplied |
| `clientApprover` | `client_approver` | jsonb `ClientApprover` | no | client-supplied at create (pre-signature shell), server-overwritten on sign (§1.4) |
| `expirationDate` | `expiration_date` | text | no | free-text date; not the review clock (`reviewDueAt` below) |
| `status` | `status` | text | no | **enum §5 — `pending_signature\|active\|revoked`, `expired` removed #1507.** See §6 for a live violation of this |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | timestamptz | no | |
| `pillar`, `owner`, `ownerId`, `riskStatus`, `reviewDate`, `weight`, `likelihood`, `impact`, `outcome`, `evidence`, `plan`, `registerRef`, `rationale`, `obligation`, `verificationNote`, `decisionState` | — | mixed, all nullable | yes | customer-register-extension columns (§1.1 note below) — present on the raw row but **no MSP-side route in this pack writes any of them** |
| `accepted_at`/`acceptedAt`, `acceptedStatement` | `accepted_at`, `accepted_statement` | timestamptz / text | yes | **not** written by `msp-rbd.ts` — this is the customer-accept path's own column (`portal-risk-register.ts`, see the customer pack §1.2). MSP-side `sign` (§1.4) writes `status`+`clientApprover` only, never these two |
| `reviewDueAt`, `reviewState` | `review_due_at`, `review_state` | timestamptz / text | yes | the review clock (#1507) — not written by any route in this pack; advanced only by `alert-engine.ts`'s `advanceRiskReviewClock` |
| `spawnedByChangeRequestId`, `dischargedByChangeRequestId` | integer, FK → `msp_change_requests.id` set-null | | yes | raw FK ids only — **no formatted `CR-2026-<n>` code on this wire**, unlike the customer pack's `WireRisk.spawnedByChangeRequestCode` (§0.2) |
| `spawnedByRemediationStepId` | integer, no FK | | yes | same "not on the wire as a formatted/joined field" note |
| `obligationId` | integer, FK → `compliance_obligations.id` set-null | | yes | raw id only — **no `obligationType` join**, unlike the customer pack (§0.2) |
| `authorizingWorkloadId`, `authorizingWorkloadLabel`, `authorizingHolderPersonIds`, `signedByPersonId` | text / text / jsonb / text | | yes | the customer-accept path's role-based-authority audit trail (#1511) — **written only by `portal-risk-register.ts`'s accept route, never by any route in this pack.** Present on the raw row (§0.2) but always null for an MSP-authored/-signed decision, since `msp-rbd.ts`'s sign path doesn't run the authority resolver at all — see §4 |

**Note on the customer-register-extension columns:** every column in that row above ("customer-
register-extension columns") exists because the customer portal's Risk Register page needed it
(see `msp.ts:6009-6013`'s own header comment). They are real, live, and on this wire because this
route returns the whole row — but `msp-rbd.ts`, `msp-rbd-instances.ts`, and `msp-rbd-versions.ts`
never populate any of them. A decision authored purely through this pack's routes will show these
as `null` when read back on the customer portal side, exactly as the customer pack's §8 "null is
served as null" rule says it should.

### 1.2 A pre-existing, separate, deliberate AdminV2 surface reads/writes the SAME table

**Flagging this clearly so #2582 does not conflate the two.** `admin-rbd.ts`
(`artifacts/api-server/src/routes/admin-rbd.ts`) is a full second CRUD surface over
`mspRiskDecisionsTable` — `GET /api/admin/rbd/customers`, `GET /api/admin/rbd/:customerId`,
`POST /api/admin/rbd/:customerId`, `PATCH /api/admin/rbd/entry/:id` — gated `requireAdmin`
(PlatformAdmin), not `requireRole("MSPOperator"/"MSPAdmin")`. Its own header (`:1-27`) states why
it exists: #1294 rebuilt the old msp-portal `RiskBasedDecisionConsole.tsx`'s create/edit flow as a
**fresh AdminV2 surface** rather than relocating it, specifically so Shane's platform-admin console
keeps a working create/edit flow (and the `available-checks` picker that makes #1279's
alert-suppression reachable) independent of whenever the MSP Console itself gets built. This is a
real, deliberate, already-issue-tracked (#1294) decision — not a bug, and not this pack's finding
to raise on its own terms. It is documented here only because §6 below is a live bug found IN
`admin-rbd.ts`, and because `admin-rbd.ts`'s own `rbdToWire()` (`:49-71`) is a **third**, narrower
curated shape over the same table (deliberately excludes the customer-register-extension columns,
per its own comment `:46-48`) — a third data shape for whoever eventually reconciles all of AdminV2
Risk Decisions, the MCP tool, and the MSP Console into one picture should know all three exist.

### 1.3 Create — `POST /api/msp/rbd`

Request body (`createRbdSchema`, `:35-63`) — **the caller must supply `rbdId` itself** (no
server-side generation, unlike `admin-rbd.ts`'s `POST` which mints `RBD-${Date.now()...}` at
`:207`). See §7.2 — flagged as an open design note for #2582, not a bug: this route was built
programmatically-only to date (no consumer), so there was nothing to decide this against yet.

| Field | Rule | Notes |
|---|---|---|
| `rbdId`, `tenantId`, `tenantName`, `primaryDomain`, `title`, `controlViolated`, `framework`, `hazardDescription`, `graphEndpoint` | `z.string()` | all required, no length caps (unlike `admin-rbd.ts`'s `createSchema` which caps every string field) |
| `rawRiskLevel` | `z.enum(["critical","high","medium"])` | |
| `residualRiskLevel` | `z.enum(["high","medium","low"])` | |
| `rawRiskScore`, `residualRiskScore` | `z.number().int()` | **client-supplied, no range validation** (unlike `admin-rbd.ts`'s `min(0).max(100)`) — see §7.2 |
| `liabilityValueUsd` | `z.number().int()` | |
| `compensatingControls` | `z.array({type: enum, description: string})` | type enum §5 |
| `clientApprover` | `{name, title, email, signedAt?, ipAddress?, signatureHash?}` | the pre-signature shell — this route can create an already-populated approver record, unlike `admin-rbd.ts` which always starts blank (`:237`) |
| `expirationDate` | `z.string()` | required here (vs. optional+defaulted in `admin-rbd.ts`) |
| `status` | `z.enum(RISK_ACCEPTANCE_STATUSES)` | **correctly uses the canonical enum** (`:2,55`) — contrast §6 |
| `checkKey`, `obligationId` | optional/nullable | §4 edges |

Server-derived (`:199-232`): `mspId` (from session), `mspAssessor` (`{name, upn, timestamp}` from
`req.user`, never client-supplied). Success `201`: `{id, rbdId, message}` (`:235-239`) — **not**
the full row, unlike every other create/mutate route in this module.

No conflict handling for a duplicate `(mspId, rbdId)` — the DB's own unique constraint
(`msp_risk_decisions_msp_id_rbd_id_uidx`) will reject a repeat insert with a raw Postgres error,
caught by the generic `catch` block and surfaced as a 500 `INTERNAL`, not a `409 CONFLICT` — see
§7.3.

### 1.4 Sign — `PATCH /api/msp/rbd/:rbdId/sign`

`requireRole("MSPAdmin")`. Body (`signRbdSchema`, `:65-71`): `name`, `title`, `email`, `ipAddress`,
`signatureHash` — all plain `z.string()`, **all required, all client-supplied** (contrast the
customer-facing sign paths, which derive `ipAddress`/`signatureHash` server-side — see §7.4).

Guaranteed only-if-`pending_signature` (`:282-285`, `409 CONFLICT` otherwise). On success
(`:298-304`): sets `status = "active"` and overwrites `clientApprover` wholesale with
`{name, title, email, signedAt: <server-set>, ipAddress, signatureHash}` — `signedAt` is the one
server-derived field; everything else in the approver record is exactly what the client sent, with
no cross-check against the authenticated MSP user's own identity (this is expected — the person
being recorded as "who approved" here is the customer contact the MSP staff member is capturing
the signature on behalf of, not the MSP staff member themself). Response: `{rbdId, message}`
(`:306-309`) — again not the full row.

**No role-based authority check runs on this path at all** — contrast the customer-portal accept
route (#1511, customer pack §1.4), which resolves whether the signer currently holds Accountable
on the `checkKey`'s workload before allowing accept. This MSP-side sign path's only gate is the
static `requireRole("MSPAdmin")` role floor. This is a real, deliberate asymmetry, not an
oversight to fix here: #1511's authority model governs who may accept *on the customer's behalf*;
an MSP staff member recording a decision is a different act under a different, role-based
authorization the module already has. Flagged so Design does not assume the two sign UIs need
identical authority-affordance treatment.

### 1.5 Revoke — `PATCH /api/msp/rbd/:rbdId/revoke`

`requireRole("MSPAdmin")`. No body. Guarded to only `active`/`pending_signature` →
`409 CONFLICT` otherwise (`:346-349`). Sets `status = "revoked"` only — leaves `clientApprover`,
`acceptedAt`, everything else untouched. Response: `{rbdId, message}` (`:358-361`).

### 1.6 Catalogs — `available-checks` / `available-obligations`

`GET /api/msp/rbd/available-checks` (`:79-101`) — `requireRole("MSPOperator")`, no `mspId` scoping
at all (the catalog itself, `monitor_checks.key/label/description`, carries no MSP ownership).
Returns a bare array `{key, label, description}[]`, alphabetical by label.

`GET /api/msp/rbd/available-obligations` (`:109-148`) — `requireRole("MSPOperator")`, scoped: the
global/seeded catalog (`compliance_frameworks.mspId IS NULL`) UNION this MSP's own authored
authorities (`compliance_frameworks.mspId = <this mspId>`), joined to `compliance_obligations`,
both `active = true`. Returns `{obligationId, citation, requires, frameworkName, authorityType,
tenantId}[]`, ordered by framework/obligation sort order. **`tenantId` here is
`compliance_frameworks.tenantId`** (which tenant a customer-specific authority belongs to, null
for global ones) — do not confuse with `msp_risk_decisions.tenantId`, a different table's column
entirely with a different meaning.

---

## 2. Wire contract — `msp-rbd-instances.ts`

Real `WireRiskInstance` (`:49-59`), returned by all 4 routes:

```ts
// msp-rbd-instances.ts:49-59 — WireRiskInstance (verbatim)
interface WireRiskInstance {
  readonly id: number;
  readonly rbdId: string;
  readonly label: string;
  readonly objectId: string | null;
  readonly foundAt: string;
  readonly acceptedAt: string | null;
  readonly status: string;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
}
```

| Wire field | Source column | Status |
|---|---|---|
| `id` | `risk_instances.id` | CURRENT |
| `rbdId` | `.rbd_id` (denormalized, matches container's own) | CURRENT |
| `label` | `.label` | CURRENT |
| `objectId` | `.object_id` | CURRENT |
| `foundAt` | `.found_at`, ISO | CURRENT — notNull column |
| `acceptedAt` | `.accepted_at`, ISO | CURRENT — null until accepted, never editable after (guarded `UPDATE ... WHERE accepted_at IS NULL`, `rbd-instances.ts:108-121`) |
| `status` | `.status` | CURRENT · enum §5, **the only DB-CHECK-enforced vocabulary in this whole module** |
| `resolvedAt` | `.resolved_at`, ISO | CURRENT |
| `resolutionNote` | `.resolution_note` | CURRENT |

**Field on the DB, NOT on this wire shape:** `driftEventId` (`risk_instances.drift_event_id`,
`msp.ts:6778`) — the `drift_events.id` a line item was raised from when it was added by the Shadow
IT governance accumulation path (`shadow-it-governance.ts:218`, the only caller of
`addRiskInstance` outside this route file's own `POST`). `WireRiskInstance` has no field for it, so
an automatically-raised line item is indistinguishable, on the wire, from one an operator typed in
by hand via `POST .../instances`. Same shape of gap as the customer pack's §1.1/§7.3 finding on
`spawnedByRemediationStepId` — narrower than the orphaned-endpoint trigger, flagged rather than
filed.

`GET /:rbdId/instances` response: `{rbdId, instances: WireRiskInstance[]}` (`:110`). `POST` success
`201`: `{instance: WireRiskInstance}` (`:161`). Both PATCH routes: `{instance: WireRiskInstance}`
on success, `409 CONFLICT` (`"Instance not found or already accepted"` / `"...or not active"`) on a
repeat/invalid-state attempt — never a distinct 404 for "doesn't exist" vs. "wrong state," the
caller can't tell which from the response alone (`:194-197`, `:250-253`).

Container resolution (`resolveContainerOrNotFound`, `:80-91`) runs on every route in this file
before touching `risk_instances` — `404 NOT_FOUND` if `(mspId, rbdId)` doesn't resolve to a
`msp_risk_decisions` row. `addRiskInstance` (`rbd-instances.ts:41-63`) independently re-checks the
container belongs to `mspId` before inserting — belt-and-suspenders, not a gap.

---

## 3. Wire contract — `msp-rbd-versions.ts`

### 3.1 `WireRbdVersion` (`:65-92`)

```ts
// msp-rbd-versions.ts:65-92 — WireRbdVersion (verbatim)
interface WireRbdVersion {
  readonly versionUid: string;
  readonly rbdId: string;
  readonly versionNumber: number;
  readonly content: unknown;
  readonly createdBy: unknown;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedBy: unknown;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
  readonly scopeInstanceIds: number[];
  readonly scopeAddedInstanceIds: number[];
  readonly scopeRemovedInstanceIds: number[];
  readonly requiresSignature: boolean;
  readonly signatureInherited: boolean;
  readonly signatureInheritedFromVersionUid: string | null;
  readonly narrativeSnapshot: unknown;
}
```

| Wire field | Source column | Status |
|---|---|---|
| `versionUid` | `msp_rbd_versions.version_uid` (uuid) | CURRENT — unique |
| `rbdId` | `.rbd_id` | CURRENT — no hard FK to the container (deliberate, §4) |
| `versionNumber` | `.version_number` | CURRENT — 1-based per `(mspId, rbdId)` |
| `content` | `.content` (jsonb) | CURRENT — **untyped `unknown` on purpose**, #1509 has not formalized the document shape yet (`createVersionSchema` comment `:140-142`) |
| `createdBy` | `.created_by` (jsonb `MspAssessor`) | CURRENT — typed `unknown` on the wire despite a real `MspAssessor` shape server-side |
| `createdAt` | `.created_at`, ISO | CURRENT |
| `signed` | `.signed` | CURRENT |
| `signedBy` | `.signed_by` (jsonb `ClientApprover`) | CURRENT — also `unknown` on the wire |
| `signedAt` | `.signed_at`, ISO | CURRENT |
| `isCurrent` | `supersededAt === null` (derived) | CURRENT |
| `scopeInstanceIds` / `Added` / `Removed` | `.scope_instance_ids` / `.scope_added_instance_ids` / `.scope_removed_instance_ids` (integer arrays) | CURRENT — server-derived from live `risk_instances`, never client-supplied (§3.3) |
| `requiresSignature` | `.requires_signature` | CURRENT |
| `signatureInherited` | `.signature_inherited` | CURRENT |
| `signatureInheritedFromVersionUid` | `.signature_inherited_from_version_uid` (uuid, no FK) | CURRENT |
| `narrativeSnapshot` | `.narrative_snapshot` (jsonb `RbdNarrativeSnapshot`) | CURRENT — `unknown` on the wire; real shape is `{hazardDescription, compensatingControls, residualRiskScore, residualRiskLevel}` |

**`content`, `createdBy`, `signedBy`, `narrativeSnapshot` are all typed `unknown` on the wire
interface itself**, not just loosely typed internally — a real, stated gap for whoever wires
#2582: the client receives these as opaque JSON with no compile-time shape to code against, even
though `createdBy`/`signedBy`/`narrativeSnapshot` all have real, known TS shapes server-side
(`MspAssessor`, `ClientApprover`, `RbdNarrativeSnapshot`). `content` is the one that's genuinely
undecided (#1509).

`GET .../versions` → `{rbdId, versions: WireRbdVersion[]}`, newest-`versionNumber`-first
(`:159`, `listRbdVersions` orders `desc`). `GET .../versions/current` → `{version}` or
`404 NOT_FOUND` (`"No version has been captured for this RBD"`) if none exists yet — note this
route runs no container-existence check independent of that; an `rbdId` that never had a container
row and one that had a container but no version yet look identical (both 404, same message).

### 3.2 `WireRbdNarrativeAudit` (`:121-126`)

```ts
// msp-rbd-versions.ts:121-126 — WireRbdNarrativeAudit (verbatim)
interface WireRbdNarrativeAudit {
  readonly fromVersionUid: string | null;
  readonly toVersionUid: string;
  readonly changedFields: unknown;
  readonly createdAt: string;
}
```

`changedFields` is real shape `Array<{field, previousValue, newValue}>` server-side
(`msp.ts:6380`) but `unknown` on the wire, same pattern as §3.1. `GET .../narrative-audit` →
`{rbdId, audit: WireRbdNarrativeAudit[]}`, newest first (`:316`). One row is written per version
transition that changed a narrative/score field; **zero rows exist for a container whose scope-only
or first-ever version never touched hazard/controls/score** — an empty array here is a genuinely
ambiguous "nothing has ever drifted" vs. "this rbdId has fewer than 2 versions," same shape of
honest-ambiguity the customer pack's §8 already documents for a different route.

### 3.3 Capture — `POST /api/msp/rbd/:rbdId/versions`

`requireRole("MSPOperator")`. Body (`createVersionSchema`, `:137-143`): `tenantId`, `tenantName`
(both required strings), `content` (`z.unknown()`, genuinely no shape enforced). **Requires a
`msp_risk_decisions` row to already exist for `(mspId, rbdId)`** (`deriveScopeAndNarrative`,
`:203-235`) — `404 NOT_FOUND` if not. This is a real, stated behavior change from `msp_rbd_versions`
itself, which carries no FK to the container: the row-level FK absence is about the table's own
addressing scheme (§4), not about whether a container must exist before version 1 can be captured
— it must.

`scopeInstanceIds` (every currently-`active` `risk_instances.id`) and `narrativeSnapshot`
(`hazardDescription`/`compensatingControls`/`residualRiskScore`/`residualRiskLevel`, live-read from
the container row) are both derived server-side inside this same request, **never from the request
body** — the scope-expansion signature requirement (§5) is undgameable by construction: a caller
can only change what's in scope by actually adding/accepting/resolving instances through §2's own
routes first, never by shaping this POST's payload.

Success `201`: `{version: WireRbdVersion}` (`:291`). Always succeeds if the container exists —
version 1 if nothing was captured before, and the resulting `requiresSignature`/`signatureInherited`
are computed, never client-set (§5).

### 3.4 Sign — `PATCH /api/msp/rbd/:rbdId/versions/:versionUid/sign`

`requireRole("MSPAdmin")`. Body (`signVersionSchema`, `:324-335`): `name`, `title`, `email`,
`ipAddress`, `signatureHash` all required strings, plus **`signatureData` optional** (base64 PNG) —
"an MSP operator recording an off-platform signature... may attach the image" (`:330-333`), the
one place in this whole module where a drawn-signature image is optional rather than required
(contrast the customer-facing `portal-rbd-document.ts` sign path, where it's mandatory — customer
pack §1.5). Only the current, unsigned version may be signed — `409 CONFLICT` ("Version not found,
not current, or already signed") otherwise, one guarded `UPDATE` (`rbd-versioning.ts:220-233`), no
way to distinguish "wrong version" from "already signed" from the response.

### 3.5 Render — `POST /api/msp/rbd/:rbdId/versions/:versionUid/document`

`requireRole("MSPOperator")`. No body. `WireRbdDocument` (`:394-400`):

```ts
// msp-rbd-versions.ts:394-400 — WireRbdDocument (verbatim)
interface WireRbdDocument {
  readonly runId: string;
  readonly htmlContent: string;
  readonly pdfBase64: string;
  readonly pdfSizeBytes: number;
  readonly generatedAt: string;
}
```

Backed by `msp_report_runs` (`rbd-document-render.ts:184-236`) — one row per version, **UPDATEd in
place on re-render**, not appended, so calling this again after signing reflects the version's
current `signed`/`signedBy`/`signatureData` rather than a stale pre-signature snapshot
(`rbd-document-render.ts:170-177`). Requires a real authenticated MSP `userId`
(`req.user?.id`, `:427-431`) — never renders attributed to nobody. **Any version, current or
superseded, signed or not, may be rendered** — the render is a pure function of that version's own
stored columns, never a re-read of live rows (§0.2's "no derived edges served" caveat does not
apply here — this route's whole job is to snapshot exactly what's already on the version row).

### 3.6 Share — `POST /api/msp/rbd/:rbdId/versions/:versionUid/share`

`requireRole("MSPOperator")`. No body. Only the **current, unsigned** version can get a share link
— same guarded-`UPDATE` pattern as sign (`generateRbdShareLink`, `rbd-versioning.ts:244-265`),
`409 CONFLICT` otherwise. 30-day expiry (`Date.now() + 30*24*60*60*1000`), matching `msp_sows`'
convention. Response: `{shareToken, shareTokenExpiresAt}` (`:468`) — the token itself, not a full
URL; whoever builds #2582 constructs the actual share link client-side, same as the SOW flow does.

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served on this pack's wire? | Notes |
|---|---|---|---|---|
| Check key | `check_key` | `monitor_checks.key` | Raw string, `GET /msp/rbd` only (§0.2 — no `Wire*` filtering) | No authority resolution runs on the MSP-side sign path (§1.4) — `risk-authority.ts` is never imported by any file in this pack |
| Container ↔ line items | `risk_instances.risk_decision_id` | `msp_risk_decisions.id` | Yes, real FK `ON DELETE CASCADE` | The one hard-FK'd relationship in this whole module |
| Container ↔ versions | `msp_rbd_versions.rbd_id` | `msp_risk_decisions.rbd_id` | Yes, on §3, but **no DB FK** — resolved by `(mspId, rbdId)` lookup at the route layer, matching the container's own addressing scheme, not a constraint | `POST .../versions` (§3.3) DOES require the container to already exist, despite no FK enforcing it |
| Line-item scope ↔ versions | `msp_rbd_versions.scope_instance_ids` | `risk_instances.id[]` | Yes, §3.1 | Server-derived at capture time, never client-supplied (§3.3) |
| Drift-governance ↔ line items | `risk_instances.drift_event_id` | `drift_events.id`, FK set-null | **No** — not on `WireRiskInstance` (§2) | Only writer is `shadow-it-governance.ts:218`, not any route in this pack |
| Change-Control provenance | `spawned_by_change_request_id` / `discharged_by_change_request_id` | `msp_change_requests.id` | Raw ids only, `GET /msp/rbd` (§0.2 — no formatted code) | Formatted `CR-2026-<n>` code exists only on the customer pack's `WireRisk` |
| Remediation provenance | `spawned_by_remediation_step_id` | `remediation_tracker_steps.id`, no FK | Raw id only, `GET /msp/rbd` | Same gap the customer pack already flagged (its §7.3), inherited here since it's the same column |
| Obligation | `obligation_id` | `compliance_obligations.id` | Raw id only, `GET /msp/rbd` — no `obligationType` join | The join exists in `msp-rbd.ts`'s own `available-obligations` route (§1.6) but is not applied to the `msp_risk_decisions` row read |
| Acceptance authority audit | `authorizing_workload_id` / `_label` / `authorizing_holder_person_ids` / `signed_by_person_id` | `portal_ownership_assignments` / `portal_ownership_events` (indirectly, via the customer accept path) | Raw columns only, always null for an MSP-signed decision | Written exclusively by `portal-risk-register.ts`'s customer accept route (#1511) — never by any route in this pack |

---

## 5. Real enum unions (and where each is actually enforced)

None of these are Postgres `pgEnum` types except `risk_instances.status`, which is the only one
with a real DB CHECK constraint (confirmed live: `risk_instances_status_check`). Every other one is
plain `text`, enforced only by whichever zod schema happens to validate the write.

| Vocabulary | Values | Where fixed | Enforced by |
|---|---|---|---|
| Acceptance `status` | `pending_signature`, `active`, `revoked` | `RISK_ACCEPTANCE_STATUSES`, `msp.ts:5920` | **`msp-rbd.ts:55` — correct.** `admin-rbd.ts:43` and `get-risk-register.ts:17` both independently hand-duplicate a STALE copy that still contains `expired` — §6, live bug filed |
| Raw risk level | `critical`, `high`, `medium` | `msp-rbd.ts:43` (`z.enum`) | `msp-rbd.ts` only; `admin-rbd.ts:41` duplicates the same three values independently (harmless — this one wasn't changed by #1507) |
| Residual risk level | `high`, `medium`, `low` | `msp-rbd.ts:44` (`z.enum`) | same duplication note as above, also harmless |
| Compensating control `type` | `technical`, `administrative`, `operational` | `msp-rbd.ts:16` (`z.enum`) | `msp-rbd.ts` only |
| Risk instance exit reason | `remediated`, `object_removed` | `RISK_INSTANCE_EXIT_REASONS`, `msp.ts:6732` | `msp-rbd-instances.ts:210` — imports the canonical const correctly |
| Risk instance `status` | `active`, `remediated`, `object_removed` | `RISK_INSTANCE_STATUS`, `msp.ts:6735` | **DB CHECK `risk_instances_status_check`, confirmed live** — the one hard-enforced vocabulary in this module |

---

## 6. Live bug found by this audit — filed

**`admin-rbd.ts` can still write `status = "expired"` onto `msp_risk_decisions`, undoing #1507.**
`admin-rbd.ts:43` defines its own stale `RBD_STATUSES = ["active", "pending_signature", "expired",
"revoked"]` instead of importing the canonical `RISK_ACCEPTANCE_STATUSES` (which `msp-rbd.ts`
imports and uses correctly, `:2,55`), and applies it to both `POST /api/admin/rbd/:customerId`
(`:177`) and `PATCH /api/admin/rbd/entry/:id` (`:268`) — both live, both reachable by any
PlatformAdmin session today. A PlatformAdmin can PATCH a live decision to `status: "expired"`
right now, resurrecting the exact value `#1507`/`#1527` shipped a fix to eliminate everywhere else,
directly contradicting `docs/risk-register-contract-pack.md` §5's claim that the fix is "shipped,
not merely settled" module-wide.

Same root cause, lower severity, filed together: `get-risk-register.ts:17` independently
duplicates the identical stale array for its read-only `status` filter parameter.

**Filed as its own issue, parented under #1682 (this Feature) per this build's standing rules —
see the DONE bookend for the issue number.** Not filed `URGENT` — real but not actively causing
incident-level harm; the fix is a one-line import swap in each file.

---

## 7. Open gaps and notes — NOT decided, flagged for #2582

### 7.1 `additionalCheckKeys` has no writer anywhere in this pack

`msp_risk_decisions.additional_check_keys` (#1957/#1489's multi-check alert-suppression array) is
on the raw wire (§1.1) but neither `msp-rbd.ts`'s `createRbdSchema` nor `admin-rbd.ts`'s
`createSchema`/`patchSchema` accept it. Its only writer, per the schema's own comment, is the
Remediation Tracker's decline-to-risk path (`remediation-tracker-risk-decline.ts`), outside this
pack's scope. Not a gap in this pack's own routes — noted so #2582 doesn't assume this pack's
create/edit flow can set it.

### 7.2 `POST /api/msp/rbd` requires the caller to compute `rbdId`, `rawRiskScore`, `residualRiskScore`

Unlike `admin-rbd.ts` (auto-generates `rbdId`, defaults both scores to `0` if omitted, caps them
`0-100`), `msp-rbd.ts`'s create route takes all three as required, unranged client input. This
route has had no consumer to date (§0.1), so nothing has forced a decision on whether the MSP
Console should generate/compute these client-side, ask the operator to enter them by hand, or the
route should grow the same defaults/validation `admin-rbd.ts` already has. A real, open design
question for #2582 — not a backend defect, since the route was never wrong for the "no consumer
yet" state it's been in.

### 7.3 No `409 CONFLICT` on a duplicate `(mspId, rbdId)` create

`POST /api/msp/rbd` has no pre-check for the unique constraint it will hit
(`msp_risk_decisions_msp_id_rbd_id_uidx`) — a repeat `rbdId` surfaces as a generic `500 INTERNAL`
from the catch-all error handler, not a `409 CONFLICT` a UI could message meaningfully. Concrete
because §7.2 already means the caller supplies `rbdId` by hand — a real collision is reachable, not
theoretical. Worth a small fix whenever #2582 starts building against this route; not filed as its
own issue since it's a minor error-shape gap on a not-yet-wired route, same threshold the customer
pack uses for "flag, don't file."

### 7.4 Client-trusted audit fields on the MSP-side sign path

`PATCH /api/msp/rbd/:rbdId/sign` (§1.4) takes `ipAddress` and `signatureHash` as plain client
input, never server-derived — a real, live difference from the customer-facing sign paths (customer
pack §1.4/§1.5, both server-derive these) and from this pack's own §9 forbidden-list precedent.
This is very likely intentional (an MSP staff member is often recording a decision made in a
meeting or over the phone, not literally clicking "sign" from the browser whose IP would be
theirs, not the customer's) but it is a real, live asymmetry worth Design/QA knowing about
explicitly rather than assuming uniform treatment across every sign surface in this module — same
spirit as the customer pack's §1.6 note on `public-rbd-document.ts`'s own IP-capture exception.

---

## 8. The forbidden list — declared, not merely absent

1. **No cross-tenant/cross-MSP read.** Every route in this pack scopes by `resolveMspIdStrict(req)`
   (session-derived, never the request body) — verified on all 17 routes, no exception.
2. **Container-scoped mutations re-verify ownership.** `msp-rbd-instances.ts` and
   `msp-rbd-versions.ts` both resolve `(mspId, rbdId)` before touching any child row; the library
   functions underneath (`rbd-instances.ts`, `rbd-versioning.ts`) independently re-check `mspId` on
   every read/write rather than trusting the route layer alone.
3. **No second signature.** Per-line accept (`acceptRiskInstance`, guarded
   `WHERE accepted_at IS NULL`) and per-version sign (`signRbdVersion`, guarded
   `WHERE supersededAt IS NULL AND signed = false`) both enforce write-once via a guarded `UPDATE`,
   not a DB constraint — same pattern the customer pack documents for its own two signature paths.
4. **Scope expansion cannot be gamed.** `scopeInstanceIds`/`scopeAddedInstanceIds`/
   `scopeRemovedInstanceIds` are always server-derived from live `risk_instances` rows inside the
   same transaction as version capture (§3.3) — no route in this pack accepts them as client input.
5. **`status = "expired"` must not be writable.** Declared here as a forbidden-list item precisely
   because §6 found it IS currently writable through `admin-rbd.ts` — the fix (§6) closes this.

---

## 9. Provenance

Written 2026-09-03 against `main` (branch `agent/2580-q1404`), for #2580 (Document step of #1682,
the reset #1571 Epic's Risk Register / RBD MSP Console Feature). Read in full, not sampled:
`msp-rbd.ts` (370 lines), `msp-rbd-instances.ts` (264 lines), `msp-rbd-versions.ts` (476 lines),
plus their supporting libs `rbd-instances.ts`, `rbd-versioning.ts`, `rbd-document-render.ts`, and
the cross-referenced `admin-rbd.ts` (320 lines) and `riskDecisionsStore.ts`/`get-risk-register.ts`
consumers. Verified live against local PostgreSQL — `msp_risk_decisions`, `risk_instances`,
`msp_rbd_versions` schemas all confirmed to match the Drizzle source exactly, including the one
real CHECK constraint (§5) and every FK/unique constraint cited above.

One real bug found and filed (§6). No orphaned-endpoint sub-issues filed — every unconsumed
endpoint is already staged for #2582 (§0.1). No product code, schema, or UI was changed by this
pass.

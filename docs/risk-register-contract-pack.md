# Risk Register / RBD — contract extraction pack for Claude Design

**#1487** (Portal New Design: Risk Register / RBD), following the method fixed by **#1577**
(contract extraction pack, run per module as step 3 of **#1578**), under **#1485**
(EPIC: Portal New Design). Sub-issues **#1507–#1514**. Regenerated per **#1712** — the
2026-08-29 pack (`ef0e50dad`) predated eight commits that have since landed; every DECIDED row
that pack carried against those issues is now CURRENT.

Read-only. Every field below is extracted verbatim from the route's own `Wire*` interfaces,
the acceptance/signature write paths, and the Drizzle schema — cited to file:line. **Nothing
here is authored or invented.** Where a value set is documented in a comment rather than
enforced by a validator, that is stated as such rather than presented as a hard enum.

**The known-wrong contract from the 2026-08-29 pack is now fixed, not merely decided.**
`status = "expired"` and `decision_state = "expired"` have been **removed from the
vocabulary entirely** (#1507, #1527) — `RISK_ACCEPTANCE_STATUSES` and `POLICY_DECISION_STATES`
no longer contain the value at all (`lib/db/src/schema/msp.ts:5587-5588`,
`:5609-5610`). There is nothing left for Design to avoid carrying forward; the fix has
already shipped.

Backend routes (all live, all mounted — `artifacts/api-server/src/routes/index.ts:166-169`):
- `artifacts/api-server/src/routes/portal-risk-register.ts` — customer register + accept (per-line)
- `artifacts/api-server/src/routes/portal-rbd-document.ts` — customer whole-document read + sign (#1512)
- `artifacts/api-server/src/routes/public-rbd-document.ts` — unauthenticated share-link read + sign (#1512)
- `artifacts/api-server/src/routes/portal-policy-decisions.ts` — **a separate, own-table
  surface (#1528) — see §0.1, do not conflate with `WirePolicyDecision` below**

MSP-side (context only, not portal surfaces):
`msp-rbd.ts`, `msp-rbd-versions.ts` (#1508), `msp-rbd-instances.ts` (#1509)

Schema: `lib/db/src/schema/msp.ts:5612-5828` (`mspRiskDecisionsTable`),
`:6341-6344`+ (`risk_instances`, `RISK_INSTANCE_EXIT_REASONS`/`STATUS`),
`:8270+` (`policyDecisionsTable`, separate table, §0.1),
new manual migrations under `lib/db/migrations/manual/2026-08-2{1,9,30,31}-*.sql`

**Portal consumer status: NONE today, and this is expected, not a gap.** `artifacts/msp-portal`
(`portal-v2`) has been fully retired from this repository — there is no
`riskRegisterWire.ts`/`riskRegisterLive.ts`/`riskRegisterModel.ts` anywhere in the tree anymore
(confirmed: zero matches repo-wide). `Design/portal/` (the live #1485 design-export directory)
is empty — no `.dc.html` export exists for this module yet. Per the fixed order in this repo's
CLAUDE.md ("architect → build the endpoints → regenerate the contract pack → Design → wire"),
**this pack is written for exactly that gap** — after the backend, before Design. The Design/wire
steps remain tracked on **#1487** itself; this is not a new orphaned-endpoint finding, and no
sub-issue is filed for it.

---

## 0. The surfaces and their consumers

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/portal/risk-register` | GET | `portal-risk-register.ts:409-443` | none (pre-Design, §above) | live |
| `/api/portal/policy-decisions` | GET | `portal-risk-register.ts:453-484` | none | live — legacy shape, §0.1 |
| `/api/portal/risk-register/:rbdId/accept` | POST | `portal-risk-register.ts:505-713` | none | live |
| `/api/portal/risk-register/rbd/:rbdId/versions` | GET | `portal-rbd-document.ts:123-140` | none | live, new (#1512) |
| `/api/portal/risk-register/rbd/:rbdId/versions/current` | GET | `portal-rbd-document.ts:143-163` | none | live, new (#1512) |
| `/api/portal/risk-register/rbd/:rbdId/versions/:versionUid/document` | GET | `portal-rbd-document.ts:167-194` | none | live, new (#1512) |
| `/api/portal/risk-register/rbd/:rbdId/versions/:versionUid/sign` | POST | `portal-rbd-document.ts:208-277` | none | live, new (#1512) |
| `/api/public/rbd/:shareToken` | GET | `public-rbd-document.ts:37-72` | none (unauthenticated, share-link only) | live, new (#1512) |
| `/api/public/rbd/:shareToken/sign` | POST | `public-rbd-document.ts:90-150` | none | live, new (#1512) |

**No orphaned-endpoint sub-issue filed.** Every one of the above genuinely has no page consumer,
but that is the expected pre-Design state described above, not a gap this pack's "file a
sub-issue" trigger is for — that trigger is for a live endpoint quietly built with no plan to
ever call it. All nine of these are explicitly staged for #1487's own Design/wire step.

MSP-side, for context (not portal surfaces, not part of "no consumer" above — these are consumed
by MSP staff via `msp-rbd.ts`'s siblings once a Design/wire pass reaches them, same "no
`artifacts/portal` page exists yet" scope-stop each landing commit states explicitly):
`msp-rbd-versions.ts` (7 endpoints, #1508/#1510/#1512), `msp-rbd-instances.ts` (4 endpoints,
#1509). **`admin-panel` does not call either** — grepped for `rbd-versions`/`rbd-instances`
usage under `artifacts/admin-panel/src`, zero matches. `admin-rbd.ts` (the existing admin
surface) is unchanged and still only serves the base `msp_risk_decisions` shape.

### 0.1 A second, separate "Policy Decisions" surface now exists — do not conflate

**This is the single most important thing to flag in this regeneration.** On #1528
(2026-08-31, landed, closed), Shane decided the risk-derived `decision_state` model on
`msp_risk_decisions` does not generalize — a policy decision needed to be creatable with no risk
finding required first, which the discriminator-on-a-shared-table design could not support. The
result is a **second, independent table and route**, not a rename or migration of the first:

| | `GET /portal/policy-decisions` (this pack, §1.3) | `GET /portal/policy-register` (separate) |
|---|---|---|
| Table | `msp_risk_decisions`, filtered `decision_state IS NOT NULL` | `policy_decisions` (own PK, own rows) — `msp.ts:8270+` |
| Route file | `portal-risk-register.ts:453-484` | `portal-policy-decisions.ts:158-195` |
| Created via | Only ever a side-effect of a risk being raised against a check | `POST /portal/policy-register` — a direct, standalone create+sign act, no risk required |
| Review model | `reviewDueAt`/`reviewState` only (date clock) | date clock **or** dependency-based clearance (#1526) — mutually exclusive per row, `policy_decisions_review_xor_clearance_chk` |
| Status today | Legacy shape, still live, still correct for what it covers | The real "create a policy decision on its own" path #1528 asked for |

Both are real and both are mounted (`routes/index.ts:166,169`). §1.3 below documents the first
because it is what #1712's scope (the `msp_risk_decisions` table) and the original #1487 pack
cover. **The `policy_decisions` (#2024) table is a related but architecturally distinct object
and is out of this pack's scope** — it belongs to whatever pack eventually covers #1490 ("Policy
Decisions shares this exact model"). Naming these two things identically ("Policy Decisions") in
Design without this distinction would silently merge two different data sources into one screen.

---

## 1. Wire contract — `portal-risk-register.ts`

All reads in this section go through `mspRiskDecisionsTable` (`msp.ts:5612-5828`), scoped to the
caller's own tenant by the `(mspId, tenantId)` predicate pair (`portal-risk-register.ts:417-426`,
header rationale `:18-34` — unchanged from the prior pack, re-verified against current code).

`CURRENT` = the field serves real data from this table today.
`DECIDED` = architecture is settled but not built; the issue number is given.
There are no `DECIDED-wrong` rows left in this pack — the one that existed (`expired`) is fixed.

### 1.1 Risk — `GET /api/portal/risk-register`

Returns `{ risks: WireRisk[] }` (`portal-risk-register.ts:435-437`), newest-id first (`:426`).
`WireRisk` is defined at `:176-235`, built by `toWireRisk` (`:302-358`).

```ts
// portal-risk-register.ts:176-235 — WireRisk (verbatim)
interface WireRisk {
  readonly id: string;
  readonly title: string;
  readonly pillar: string | null;
  readonly inherent: string | null;
  readonly residual: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  readonly review: string | null;
  readonly reviewDueAt: string | null;          // NEW since 2026-08-29 (#1507)
  readonly reviewState: string | null;           // NEW since 2026-08-29 (#1507)
  readonly weight: number | null;
  readonly likelihood: number | null;
  readonly impact: number | null;
  readonly what: string;
  readonly outcome: string | null;
  readonly evidence: string | null;
  readonly controls: readonly string[];
  readonly plan: string | null;
  readonly accepted?: WireAcceptance;
  readonly isAccepted: boolean;
  readonly liabilityValueUsd: number;
  readonly framework: string;
  readonly controlViolated: string;
  readonly obligationId: string | null;          // NEW since 2026-08-29 (#1525)
  readonly obligationType: string | null;        // NEW since 2026-08-29 (#1525)
  readonly spawnedByChangeRequestCode: string | null;      // NEW since 2026-08-29 (#1514)
  readonly dischargedByChangeRequestCode: string | null;   // NEW since 2026-08-29 (#1514)
  readonly authority: WireRiskAuthority | null;             // NEW since 2026-08-29 (#1511)
}
```

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `rbd_id` (`msp.ts:5615`) | text, notNull | no | CURRENT |
| `title` | `title` (`:5619`) | text, notNull | no | CURRENT |
| `pillar` | `pillar` (`:5669`) | text, nullable | yes | CURRENT — populated by the customer-fields migration; still never written by `msp-rbd.ts` |
| `inherent` | `raw_risk_level` (`:5632`), title-cased (`:332`, `titleCaseSeverity` `:116-121`) | text, notNull | yes¹ | CURRENT · enum §3 |
| `residual` | `residual_risk_level` (`:5633`), title-cased (`:333`) | text, notNull | yes¹ | CURRENT · enum §3 |
| `status` | `risk_status` (`:5673`) | text, nullable | yes | CURRENT · enum §3 (the **risk's** state, not the acceptance's) |
| `owner` | `owner` (`:5670`) | text, nullable | yes | CURRENT — RACI edge, §4; `owner_id` (below) is the structured pointer, this is display |
| `review` | `review_date` (`:5677`) — display string | text, nullable | yes | CURRENT — display copy only; the machine clock is `reviewDueAt` |
| `reviewDueAt` | `review_due_at` (`:5688`), ISO | timestamptz, nullable | yes | **CURRENT — #1507, was absent in the 2026-08-29 pack** |
| `reviewState` | `review_state` (`:5689`) | text, nullable | yes | **CURRENT — #1507 · enum: `on_track \| due \| overdue`, `RISK_REVIEW_STATES` `msp.ts:5598`** |
| `weight` | `weight` (`:5691`) | integer, nullable | yes | CURRENT |
| `likelihood` | `likelihood` (`:5693`) — 1–5 | integer, nullable | yes | CURRENT — heat-map coordinate |
| `impact` | `impact` (`:5695`) — 1–5 | integer, nullable | yes | CURRENT — heat-map coordinate |
| `what` | `hazard_description` (`:5637`) | text, notNull | no | CURRENT |
| `outcome` | `outcome` (`:5697`) | text, nullable | yes | CURRENT |
| `evidence` | `evidence` (`:5699`) | text, nullable | yes | CURRENT |
| `controls` | `compensating_controls[].description` (`:5639`), via `controlDescriptions` (`:274-277`) | jsonb, notNull default `[]` | no (array, may be empty) | CURRENT |
| `plan` | `plan` (`:5701`) | text, nullable | yes | CURRENT |
| `accepted?` | derived — see §1.2 | — | absent unless accepted | CURRENT |
| `isAccepted` | `accepted !== undefined` (`:349`) | derived boolean | no | CURRENT |
| `liabilityValueUsd` | `liability_value_usd` (`:5636`) — whole USD | integer, notNull | no | CURRENT |
| `framework` | `framework` (`:5621`) | text, notNull | no | CURRENT |
| `controlViolated` | `control_violated` (`:5620`) | text, notNull | no | CURRENT |
| `obligationId` | `obligation_id` (`:5715`), stringified | integer FK → `compliance_obligations.id`, nullable | yes | **CURRENT — #1525, was absent in the 2026-08-29 pack.** Null on every row predating #1525 and any row whose free-text `obligation` has no catalog match. |
| `obligationType` | `compliance_frameworks.authority_type` via `obligationId` (`loadObligationTypes` `:289-300`) | text (join), derived | yes | **CURRENT — #1525.** Null unless `obligationId` is set |
| `spawnedByChangeRequestCode` | `spawned_by_change_request_id` (`:5799`), formatted `CR-2026-<100+id>` (`formatChangeRequestCode`, `portal-change-control.ts:368-370`) | integer, nullable | yes | **CURRENT — #1514.** Null for every risk not raised from a rejected CR |
| `dischargedByChangeRequestCode` | `discharged_by_change_request_id` (`:5800`), same formatter | integer, nullable | yes | **CURRENT — #1514.** Null while the risk still stands (the common case) |
| `authority` | derived — `resolveRiskAuthoritiesBatch` (`risk-authority.ts:212-261`), §4 | — | null when `check_key` resolves to no workload | **CURRENT — #1511.** *CURRENT* authority (who may sign **right now**), independent of whether the risk has been accepted |

¹ The **column** is `notNull`, but `titleCaseSeverity` returns `null` for a blank/whitespace
value (`:118-120`), so the wire field is typed `string | null`.

**Field genuinely on the DB but NOT on this wire shape (open gap, §7.3):**
`spawned_by_remediation_step_id` (`msp.ts:5817`, added under #1542/#1489 — the Remediation
Tracker's own rejection-to-risk path, the identical lifecycle to #1514's Change-Control path)
has **no corresponding `WireRisk` field**. A risk spawned from a declined remediation step is
indistinguishable, on the wire, from one authored directly by `msp-rbd.ts` — `WireRisk` only
ever exposes the Change-Control pointer pair, never this one. `dischargedByChangeRequestId`
(shared with #1514's lifecycle per the schema comment `:5812-5815`) IS exposed and covers the
discharge side for both spawn paths; only the **spawn provenance** for the remediation path is
missing.

### 1.2 Acceptance block — `WireRisk.accepted`

Defined at `portal-risk-register.ts:124-149`, built at `:315-326`. Emitted only when the write
path actually ran — `acceptedAt !== null && clientApprover.name` (`:315-316`), unchanged rule
from the prior pack.

```ts
// portal-risk-register.ts:124-149 — WireAcceptance (verbatim)
interface WireAcceptance {
  readonly by: string;
  readonly on: string;
  // NO `until`. Removed on #1507 — see §5.
  readonly register: string | null;
  readonly why: string | null;
  readonly compensating: string | null;
  readonly statement: string | null;
  readonly authorizedBy: WireRiskAuthority | null;    // NEW since 2026-08-29 (#1511)
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `by` | `client_approver.name` (`msp.ts:5641`) | jsonb, notNull | CURRENT |
| `on` | `accepted_at` (`:5742`), ISO | timestamptz, nullable | CURRENT — proof-of-when; server-set, never rewritten |
| `register` | `register_ref` (`:5703`) | text, nullable | CURRENT |
| `why` | `rationale` (`:5705`) | text, nullable | CURRENT |
| `compensating` | `compensating_controls` joined to one sentence (`compensatingSentence` `:284-287`) | jsonb | CURRENT |
| `statement` | `accepted_statement` (`:5745`) | text, nullable | CURRENT — snapshotted |
| `authorizedBy` | derived — `resolveAuthorizedByAsOf`, point-in-time replay (`risk-authority.ts:177-188`), §4 | — | **CURRENT — #1511.** Who backed the signature **at the moment it was signed**, replayed from the append-only `portal_ownership_events` log, never re-read from current state. Null when `checkKey` resolved to no workload at accept time. |

`until` (`expiration_date`) is **gone from the wire entirely** — not deprecated, not marked
wrong, simply no longer a field on `WireAcceptance` (`portal-risk-register.ts:129-134` records
why, verbatim in the source). The underlying `expiration_date` DB column still exists
(`msp.ts` — `notNull`, still written by `msp-rbd.ts`) but is dead to this wire shape.

### 1.3 Policy decision — `GET /api/portal/policy-decisions`

**See §0.1 first — this is the risk-derived legacy shape, not the newer `policy_decisions`
table.** Returns `{ decisions: WirePolicyDecision[] }` (`portal-risk-register.ts:476-478`). Same
rows, same query as §1.1, filtered to `decision_state` non-empty (`:472`). `WirePolicyDecision`
defined at `:238-264`, built by `toWirePolicyDecision` (`:360-383`).

```ts
// portal-risk-register.ts:238-264 — WirePolicyDecision (verbatim)
interface WirePolicyDecision {
  readonly id: string;
  readonly state: string | null;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string | null;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly approved: string | null;
  readonly review: string | null;
  readonly reviewDueAt: string | null;      // NEW since 2026-08-29 (#1507/#1527)
  readonly reviewState: string | null;       // NEW since 2026-08-29 (#1507/#1527)
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
  readonly obligationId: string | null;      // NEW since 2026-08-29 (#1525)
  readonly obligationType: string | null;    // NEW since 2026-08-29 (#1525)
}
```

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `rbd_id` (`msp.ts:5615`) | text, notNull | no | CURRENT |
| `state` | `decision_state` (`:5724`) | text, nullable | yes | **CURRENT — `expired` removed, enum §3 (#1527)** |
| `pillar` | `pillar` (`:5669`) | text, nullable | yes | CURRENT |
| `title` | `title` (`:5619`) | text, notNull | no | CURRENT |
| `obligation` | `obligation` (`:5710`) — free-text citation | text, nullable | yes | CURRENT — back-compat display when `obligationId` is null |
| `owner` | `owner` (`:5670`) | text, nullable | yes | CURRENT |
| `ownerId` | `owner_id` (`:5672`) — RACI person key | text, nullable | yes | CURRENT — RACI edge, §4 |
| `approved` | `accepted_at` ISO, else `client_approver.signedAt` (`:372`) | timestamptz / jsonb | yes | CURRENT |
| `review` | `review_date` (`:5677`) | text, nullable | yes | CURRENT — display copy |
| `reviewDueAt` | `review_due_at` (`:5688`), ISO | timestamptz, nullable | yes | **CURRENT — #1507** |
| `reviewState` | `review_state` (`:5689`) | text, nullable | yes | **CURRENT — #1507/#1527.** A past-due review is a flag on a decision that stays `live`; `expired` does not exist as a `decisionState` value anymore |
| `register` | `register_ref` (`:5703`) | text, nullable | yes | CURRENT |
| `rationale` | `rationale` (`:5705`) | text, nullable | yes | CURRENT |
| `compensating` | `compensating_controls` → sentence (`:378`) | jsonb | yes | CURRENT |
| `check` | `verification_note` (`:5717`) | text, nullable | yes | CURRENT |
| `obligationId` | `obligation_id` (`:5715`), stringified | integer FK, nullable | yes | **CURRENT — #1525** |
| `obligationType` | via `obligationId` join | text (join), derived | yes | **CURRENT — #1525** |

### 1.4 Accept (per-line) — `POST /api/portal/risk-register/:rbdId/accept`

**Request body** (`acceptSchema`, `portal-risk-register.ts:499-503`) — unchanged shape from the
2026-08-29 pack:

| Field | Rule | Notes |
|---|---|---|
| `fullName` | `z.string().trim().min(2).max(200)` | Not checked against the account name |
| `confirmed` | `z.literal(true)` | The checkbox *is* the consent |
| `statement` | `z.string().trim().min(1).max(2000)` | Snapshotted into `accepted_statement` |

**Success response `201`** (`:694-707`): `{ rbdId, accepted: { by, on, register, why,
compensating, statement, authorizedBy } }` — same shape as §1.2, **including the new
`authorizedBy` block**, no `until`.

**Guarantees & error contract** — the four rows from the prior pack are unchanged, plus two new
ones for role-based authority (#1511):

| Condition | Status | Code | Source |
|---|---|---|---|
| No customer context / unresolvable scope | 403 | `FORBIDDEN` | `:512-520` |
| Body fails `acceptSchema` | 400 | `VALIDATION` | `:522-526` |
| RBD not found for this tenant (scoped read, 404s exactly like nonexistent) | 404 | `NOT_FOUND` | `:531-546` |
| Already accepted — permanent, guarded `UPDATE ... WHERE accepted_at IS NULL` | 409 | `CONFLICT` | `:551-554`, `:665-668` |
| Decision was revoked (`status = "revoked"`) | 409 | `CONFLICT` | `:555-558` |
| **`checkKey` resolves to a real workload AND nobody currently holds Accountable on it** | **409** | **`CONFLICT`** | **`:574-584` — NEW (#1511). Message names the workload; tells the caller to assign an owner on the Ownership page first** |
| **`checkKey` resolves to a workload, and the signer is authenticated but is NOT a current Accountable holder on it** | **403** | **`FORBIDDEN`** | **`:585-595` — NEW (#1511). Response body includes `{ workload, holders: [names] }` so the UI can say who CAN sign** |

When `checkKey` resolves to **no** workload (free-standing liability record, or a
cross-cutting check category — `cost:*`, `appgov:*`, `governance:*`, etc.), the pre-#1511
behaviour is unchanged: any `CustomerUser` may sign (`:570-597`) — the honest unresolved case,
not a security hole.

Server-derived on accept (`:599-663`): `acceptedAt`, `signatureHash`, `ipAddress`
(known `127.0.0.1`-behind-proxy limitation, unchanged — `:607-618`), plus (#1511)
`authorizingWorkloadId`, `authorizingWorkloadLabel`, `authorizingHolderPersonIds` (the full
point-in-time holder set), `signedByPersonId` (the actual signer). Sets `status = "active"`,
`riskStatus = "Accepted"`.

### 1.5 Whole-document signature — `portal-rbd-document.ts` (#1512)

**Genuinely new since the 2026-08-29 pack — a second, distinct signature surface.** Signs the
whole **versioned document** (`msp_rbd_versions`, #1508) as one act, separate from §1.4's
per-line accept. Both flows can coexist during the #1509 transition per the route's own header
(`portal-rbd-document.ts:14-20`).

**`GET /portal/risk-register/rbd/:rbdId/versions`** (`:123-140`) → `{ rbdId, versions:
WireRbdVersionSummary[] }`, scoped by `versionInScope` (`:118-120`, both `mspId` AND `tenantId`
predicates, same pairing discipline as §1.1).

**`GET /portal/risk-register/rbd/:rbdId/versions/current`** (`:143-163`) → `{ version:
WireRbdVersionSummary }`, or `404 NOT_FOUND` if none captured yet.

**`GET /portal/risk-register/rbd/:rbdId/versions/:versionUid/document`** (`:167-194`) → `{
document: WireRbdDocument }` (see §1.6). **Never renders on demand** — 404 `"This document has
not been prepared yet"` if the MSP side hasn't rendered it (`:183-187`); rendering needs a real
MSP `createdByUserId`, so a customer's own session can never trigger an attribution it doesn't
own.

```ts
// portal-rbd-document.ts:62-78 — WireRbdVersionSummary (verbatim)
interface WireRbdVersionSummary {
  readonly versionUid: string;
  readonly rbdId: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
  readonly requiresSignature: boolean;      // #1510
  readonly signatureInherited: boolean;     // #1510
}
```

| Wire field | Source column | Status |
|---|---|---|
| `versionUid` | `msp_rbd_versions.version_uid` (uuid) | CURRENT |
| `rbdId` | `.rbd_id` | CURRENT |
| `versionNumber` | `.version_number` | CURRENT — 1-based, per (mspId, rbdId) |
| `createdAt` | `.created_at`, ISO | CURRENT |
| `signed` | `.signed` | CURRENT |
| `signedAt` | `.signed_at`, ISO | CURRENT |
| `isCurrent` | `supersededAt === null` (derived) | CURRENT |
| `requiresSignature` | `.requires_signature` (§6.1) | CURRENT — #1510 |
| `signatureInherited` | `.signature_inherited` (§6.1) | CURRENT — #1510 |

**`POST /portal/risk-register/rbd/:rbdId/versions/:versionUid/sign`** (`:208-277`) — request
body:

| Field | Rule |
|---|---|
| `signerName` | `z.string().trim().min(2).max(200)` |
| `signerTitle` | optional, `max(200)` |
| `signatureData` | `z.string().min(10)` — **required** here, unlike the MSP-side sign path where it is optional (this is the SOW-flow drawn-signature parity #1512 exists to add, `:196-201`) |

Errors: `404 NOT_FOUND` (version not in scope), `409 CONFLICT` (superseded, or already signed).
Success `201` returns `{ version: WireRbdVersionSummary }`. `ipAddress`/`signatureHash` are
server-derived, same discipline as §1.4 (`:241-249`).

### 1.6 Public share-link read + sign — `public-rbd-document.ts` (#1512)

Unauthenticated. `GET /api/public/rbd/:shareToken` (`:37-72`) → `{ rbdId, versionNumber,
tenantName, htmlContent, signed, signedAt, signerName }` — **does not expose `pdfBase64` or the
signature image**, same rule `msp-sow.ts`'s public viewer follows (`:56-57`).

`POST /api/public/rbd/:shareToken/sign` (`:90-150`), rate-limited (10/15min in production,
`:74-80`) — same `signerName`/`signerTitle`/`signerEmail`/`signatureData` shape as §1.5.

**Honesty note — IP capture differs from every other signature path in this module.**
§1.4/§1.5 both derive `ipAddress` from `req.ip` (respects Express `trust proxy`, currently
misconfigured per the known limitation). This route instead parses `x-forwarded-for` directly
(`public-rbd-document.ts:117-119`) — the exact pattern `portal-risk-register.ts`'s own header
calls out as forbidden for a session-authenticated route ("must not be 'fixed' by reading
`x-forwarded-for` directly, which is client-spoofable"). It is a defensible difference here
(there is no session to trust either way on a public link — the header value is no less
trustworthy than `req.ip` would be pre-`trust proxy`), and it mirrors `msp-sow.ts`'s existing
public flow (`:2-3`) rather than inventing a new pattern. Flagged so Design/QA does not read this
as an inconsistency bug — it is a deliberate, precedented choice on the one unauthenticated path
in the module, but it is real and worth knowing before treating "IP capture" as one uniform
mechanism across every signature surface here.

---

## 2. Three lifecycles — do not merge them (was "two", #1507 added the third)

`portal-risk-register.ts:67-79` states this explicitly:

- **`status`** — the **acceptance's** state. `RISK_ACCEPTANCE_STATUSES`:
  `pending_signature | active | revoked`. `expired` **removed** (#1507).
- **`riskStatus`** (→ `WireRisk.status`) — the **risk's** own state:
  `Open | Mitigating | Accepted | Closed | Expired`.
- **`reviewState`** (→ `WireRisk.reviewState` / `WirePolicyDecision.reviewState`) — the
  **review's** own state, split out of `status` on #1507: `RISK_REVIEW_STATES`:
  `on_track | due | overdue`. An overdue review is a flag on a still-`active` acceptance; it
  never lapses the acceptance.

A risk can be `Mitigating` with no acceptance at all; an acceptance can be `revoked` while the
risk stays `Open`; an `active` acceptance can carry an `overdue` review and remain `active`. The
register page shows `risk_status`; the acceptance panel acts on `status`; a review-due badge
reads `reviewState`.

**Note:** `riskStatus`'s own vocabulary (`Open | Mitigating | Accepted | Closed | Expired`) still
carries an `Expired` value (§3) — this is a DIFFERENT field from `status`/`decisionState` and
#1507/#1527 did not touch it. Whether a risk's own `Expired` state should also be reconsidered is
genuinely open and not addressed by any landed issue; flagged here rather than silently assumed
fixed by association.

---

## 3. Real enum unions (and where each is actually enforced)

None of these are Postgres `pgEnum` types — every one is plain `text`. Value sets come from
zod validators in the MSP-side writer(s) and, for two unvalidated columns, documented comments.

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Acceptance `status` | `pending_signature`, `active`, `revoked` | `RISK_ACCEPTANCE_STATUSES`, `msp.ts:5587`; validated `msp-rbd.ts:55` | **CURRENT — `expired` removed, #1507** |
| Review state (`reviewState`) | `on_track`, `due`, `overdue` | `RISK_REVIEW_STATES`, `msp.ts:5598`; written by `advanceRiskReviewClock` in `alert-engine.ts:173-223` | **CURRENT — #1507/#1513** |
| Raw risk level (`inherent`) | `critical`, `high`, `medium` | `msp-rbd.ts:43` (`z.enum`) | CURRENT (title-cased on the wire) |
| Residual risk level (`residual`) | `high`, `medium`, `low` | `msp-rbd.ts:44` (`z.enum`) | CURRENT (title-cased on the wire) |
| Risk status (`WireRisk.status`) | `Open`, `Mitigating`, `Accepted`, `Closed`, `Expired` | comment only — `portal-risk-register.ts:69`, `msp.ts:5663-5664` | CURRENT; no validator enforces it. `Expired` here is unrelated to the removed acceptance `expired` — see §2 note |
| Policy `decision_state` | `proposed`, `live`, `due` | `POLICY_DECISION_STATES`, `msp.ts:5609`; synced by `advanceRiskReviewClock` (`alert-engine.ts:201-216`) | **CURRENT — `expired` removed, #1527** |
| Compensating control `type` | `technical`, `administrative`, `operational` | `msp.ts:3909`(ish); `msp-rbd.ts:16` (`z.enum`) | CURRENT |
| Risk instance `status` (#1509) | `active`, `remediated`, `object_removed` | `RISK_INSTANCE_STATUS`/`RISK_INSTANCE_EXIT_REASONS`, `msp.ts:6341-6344`; **DB CHECK constraint** `risk_instances_status_check` — the first hard-enforced vocabulary in this whole module | **CURRENT — #1509, DB-enforced, not just convention** |

**Client-side fallback behaviour, unverified against current portal code (no consuming portal
exists — §0).** The 2026-08-29 pack cited `riskRegisterWire.ts` normaliser behaviour
(unrecognised `decision_state` → `proposed`, unrecognised severity → no accent colour). That file
no longer exists in this repository. Any equivalent normalisation will need to be re-authored
when this module is wired to Design; it is not carried forward as a current fact here.

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Check key | `check_key` (`msp.ts:5631`) | `monitor_checks.key` | **Partially.** The raw string is still not on either wire shape directly, but it now DRIVES `WireRisk.authority` / `WireAcceptance.authorizedBy` via `resolveRiskWorkload` (`risk-authority.ts:48-53`) → `resolveWorkloadForCheckKey` (`tenant-workloads.ts:138-141`, prefix match on `checkKey.split(":")[0]`) | Powers #1279 alert-suppression (`status='active'` + populated) AND, since #1511, resolves which workload/holders may sign. `WORKLOAD_BY_CHECK_CATEGORY` (`tenant-workloads.ts:119-130`) covers `exchange, sharepoint, onedrive→sharepoint, teams, security→Defender, identity→icam, devices→endpoint`; categories like `cost`, `appgov`, `governance`, `compliance`, `copilot`, `license`, `m365`, `platform`, `diagnostics` deliberately resolve to null (cross-cutting, no single workload owner) |
| Register ref | `register_ref` | internal register entry id (e.g. `RR-2026-014`) | Yes — `WireRisk.accepted.register`, `WirePolicyDecision.register` | — |
| Owner / RACI | `owner_id` (`msp.ts:5672`) | RACI person key in `portal_ownership_assignments` | Partly — `WirePolicyDecision.ownerId` only; **not** on `WireRisk` (unchanged from prior pack — still open, §7.1) | The Accountable-holder resolution (below) is a SEPARATE, now-built mechanism that does not read `owner_id` at all — it resolves through the workload, not this column |
| Acceptance authority | derived, not a column | `portal_ownership_assignments` (current) / `portal_ownership_events` (point-in-time replay) | **Yes — CURRENT, #1511.** `WireRisk.authority` (current holders who MAY sign) and `WireAcceptance.authorizedBy` (holders who DID back an already-signed acceptance, replayed as of `acceptedAt`) | This is the mechanism the old pack's "§4 DECIDED authority edge" described as not-yet-built. It is now the resolved reality: acceptance authority is role-based via the workload the risk's `checkKey` resolves to, never a per-risk assignment (#1523's rule) |
| Obligation | `obligation` / `obligation_id` | `compliance_obligations.id` (catalog) via `compliance_frameworks.authority_type` join | Yes — `WireRisk.obligationId`/`obligationType`, `WirePolicyDecision.obligationId`/`obligationType` (§1.1, §1.3) | **CURRENT — #1525, was a plan-only edge in the prior pack.** `obligation` (free text) stays authoritative for display whenever `obligationId` is null |
| Liability | `liability_value_usd` | — | Yes — `WireRisk.liabilityValueUsd` | The exposure a signature transfers |
| Change-Control provenance | `spawned_by_change_request_id` / `discharged_by_change_request_id` | `change_requests.id` (formatted `CR-2026-<100+id>`) | Yes — `WireRisk.spawnedByChangeRequestCode` / `dischargedByChangeRequestCode` | **CURRENT — #1514, was DECIDED in the prior pack.** A customer's CR rejection becomes an accepted risk; a later CR can discharge it |
| Remediation provenance | `spawned_by_remediation_step_id` (`msp.ts:5817`) | `remediation_tracker_steps.id` (no FK, matches that table's own no-FK convention) | **No — real gap, §1.1/§7.3.** Column exists, is written (#1542/#1489's `remediation-tracker-risk-decline.ts`), never reaches `WireRisk` | Same lifecycle as the Change-Control pointer above, discharge shares the same `dischargedByChangeRequestId` column — only the spawn side for THIS path is unserved |
| RBD document versioning | `msp_rbd_versions.rbd_id` | `msp_risk_decisions.rbd_id` (no FK — matches the container's own addressing scheme, resolved by rbdId+mspId lookup, not a DB constraint) | Yes, on the separate §1.5/§1.6 surface | See §6.1 |
| Risk instance line items | `risk_instances.risk_decision_id` | `msp_risk_decisions.id` — **real FK**, `ON DELETE CASCADE` | MSP-side only today (`msp-rbd-instances.ts`), no customer wire yet | See §6.2 |

---

## 5. The `expired` fix — shipped, not merely settled (was §5 "known-wrong" in the prior pack)

The prior pack's whole §5 was a warning: two clocks were collapsed into one field, and Design
must not carry `EXPIRED` into the acceptance or Policy Decisions UI. That fix has now shipped in
full:

1. `RISK_ACCEPTANCE_STATUSES` (`msp.ts:5587`) is `["pending_signature", "active", "revoked"]` —
   `expired` is not a member of the type, not just avoided by convention.
2. `POLICY_DECISION_STATES` (`msp.ts:5609`) is `["proposed", "live", "due"]` — same.
3. `WireAcceptance.until` (the old `expiration_date`-backed field) **no longer exists on the
   wire type at all** (§1.2) — there is nothing to omit; it was removed at the source.
4. The review clock now exists and is populated: `reviewDueAt`/`reviewState` on both `WireRisk`
   and `WirePolicyDecision` (§1.1, §1.3), maintained by `advanceRiskReviewClock`
   (`alert-engine.ts:173-223`, wired to the `risk_review_overdue` alert type, `:389`) — the
   "operational writer" the 2026-08-29 pack noted was explicitly left unbuilt is now built
   (#1513).
5. MSP "renewal on the customer's behalf" was never built, per #1507's own instruction — grepped
   `msp-rbd.ts` for any renew/reissue path: none exists.

**Nothing here for Design to avoid.** The old §5 was written as a warning about a live footgun;
that footgun has been removed from the vocabulary itself, not papered over at the read layer.

---

## 6. Settled architecture, now built (was §6 "not yet built" in the prior pack)

Every row the 2026-08-29 pack listed as DECIDED-not-built has landed. Restated here as CURRENT,
with what actually shipped:

### 6.1 RBD versioning and the supersession chain (#1508, #1510, #1512)

`msp_rbd_versions` (`msp.ts`, migration `2026-08-30-rbd-document-versioning-1508.sql`, extended
by `2026-08-31-...-1512.sql` for `signatureData`/`shareToken`/`shareTokenExpiresAt`). One
container (`rbdId`) has a chain of versions; exactly one has `supersededAt IS NULL` at a time,
enforced by a transaction that supersedes-then-inserts (`rbd-versioning.ts:81-147`), never two
current versions observable at once.

**Signature required on scope expansion, never on contraction (#1510).** `createRbdVersion`
diffs the new version's `scopeInstanceIds` (derived server-side from live, `active`
`risk_instances` rows — never client-supplied, `msp-rbd-versions.ts:203-235`) against the
superseded version's own scope. An addition (or the first version ever) sets
`requiresSignature = true` and starts unsigned; a subtraction-only or unchanged scope
**inherits** the prior version's signature (`signed`/`signedBy`/`signedAt`/`signatureData`
copied forward, `signatureInherited = true`, `signatureInheritedFromVersionUid` set) —
`rbd-versioning.ts:103-126`. Narrative/score drift (hazard text, compensating controls, residual
score) is diffed independently and recorded to `msp_rbd_narrative_audit` **without ever gating
capture or requiring a signature** (`:131-143`) — this is the resolution to the prior pack's
§7.2 open gap ("narrative-only revisions moving the residual score under an old signature"); it
is no longer open, see §7.

**Document render + signature capture (#1512).** `msp_rbd_versions` gained `signatureData`
(base64 PNG), `shareToken`/`shareTokenExpiresAt`. Rendering (`rbd-document-render.ts`,
`renderAndPersistRbdVersionDocument`) is a **deterministic template render of the version's own
stored columns** — never AI generation, never a re-read of live rows — so a superseded version
renders identically to how it looked the day it was captured. Persisted via `msp_report_runs`
gaining `rbdVersionUid` (a "risk_decision_document" run type reusing the existing
`insight-pdf.ts` Chromium pipeline) rather than a parallel storage table.

### 6.2 `risk_instances` as line items (#1509)

`risk_instances` (real FK-child of `msp_risk_decisions`, `ON DELETE CASCADE`). The RBD is a
container; one MFA risk with 22 accounts is 22 rows here, not 22 `msp_risk_decisions` rows. Each
line carries its own `foundAt`/`acceptedAt` clock and a **DB-CHECK-enforced** status
(`active | remediated | object_removed`, §3) — the only hard-enforced vocabulary in this module.
MSP-side only (`msp-rbd-instances.ts`, 4 endpoints, §0). Feeds `msp_rbd_versions.scopeInstanceIds`
(§6.1) as its sole current consumer.

### 6.3 Role-based acceptance authority (#1511)

Fully described in §1.1/§1.2/§1.4/§4. Resolves through `portal_ownership_assignments` /
`portal_ownership_events` via the workload the risk's `checkKey` maps to
(`resolveWorkloadForCheckKey`) — never a per-risk assignment. Multiple holders can carry
Accountable simultaneously, all with identical authority, order informational only
(`risk-authority.ts:11-15`). Point-in-time replay for an already-signed risk uses the append-only
event log, never current state, so a later roster change cannot rewrite who actually had
authority at sign time.

### 6.4 Rejection-to-risk discharge (#1514)

`spawned_by_change_request_id` / `discharged_by_change_request_id` (§1.1, §4). A customer
rejecting a Change Request IS the acceptance of the underlying risk; the rejected CR stays
immutable and is never resurrected, and the risk persists until a fresh CR discharges it.

### 6.5 Overdue review alerting (#1513) and its Policy Decisions extension (#1527/#2024's writer)

`advanceRiskReviewClock` (`alert-engine.ts:173-223`) is the operational writer both `msp_risk_decisions.reviewState`
and (where set) `.decisionState` advance through, feeding the `risk_review_overdue` alert type.
A separate `advancePolicyReviewClock` (`alert-engine.ts:322+`) does the same for the **new,
separate** `policy_decisions` table (§0.1) — noted here only to flag that it exists; it is out
of this pack's scope.

---

## 7. Open gaps — NOT decided (do not resolve; flag)

### 7.1 Carried forward, unchanged, still open

**Do SOPs / RBDs inherit RACI from a service, or carry their own rows?** Still open (#1523).
`owner`/`owner_id` sourcing for the register is still gated on this. Unaffected by any commit in
this regeneration.

### 7.2 Resolved since the prior pack (no longer open)

The prior pack's §7.2 ("narrative-only revisions moving the residual score under an old
signature... not yet decided") **is now resolved** by #1510's scope-diff design (§6.1): a
narrative/score change alone never requires a fresh signature, but it IS captured — every such
change produces a real `msp_rbd_narrative_audit` row (`GET
.../versions/narrative-audit`, `msp-rbd-versions.ts:299-322`), which is the audit trail the prior
pack said was missing. This is a real product decision (§6.1), not silence.

### 7.3 New, discovered by this regeneration

1. **`spawned_by_remediation_step_id` is on the DB and written, but absent from `WireRisk`**
   (§1.1, §4). A risk spawned from a declined Remediation Tracker item cannot be distinguished,
   on the wire, from one authored directly via `msp-rbd.ts` — only the Change-Control spawn path
   (#1514) reached the wire. Not filed as a sub-issue (this pack's trigger is an orphaned live
   *endpoint*, not an unserved *field*) but flagged here as a real, concrete gap for whoever
   designs the register's "where did this come from" affordance.
2. **Two "Policy Decisions" data sources now exist and share a display name** (§0.1) —
   `GET /portal/policy-decisions` (this table) and `GET /portal/policy-register` (the new
   `policy_decisions` table, #1528). Design needs to pick one, or explicitly show both as
   distinct sections, before any screen can safely be titled "Policy Decisions."
3. **No admin-panel or portal consumer for `risk_instances` or `msp_rbd_versions` on the MSP
   side either** — `admin-rbd.ts` (the one live admin surface for this table) is unchanged and
   still only serves the base row shape. This is the same expected pre-Design/wire state as §0,
   not a defect, but worth naming since it means the versioning/instances mechanism, while fully
   built and DB-verified (§ Provenance), has never yet been exercised through any UI, admin or
   customer.

---

## 8. Honest-empty contract & the tri-state

Unchanged mechanism from the prior pack, re-verified against current code:

| State | Wire behaviour | Source |
|---|---|---|
| Loading | — | client concern, no portal consumer exists to cite today (§0) |
| Live, genuinely empty | `200` with `{ risks: [] }` / `{ decisions: [] }` | `portal-risk-register.ts:437, 478` |
| Read failed | non-2xx or thrown | every route's `catch` block, `apiError(..., 500, ApiErrorCode.INTERNAL, ...)` |

**Two honest-empty nuances, unchanged and re-verified:**

1. **Unresolvable tenant scope also returns `200` with an empty array** (`scopeOrEmpty`,
   `portal-risk-register.ts:393-406`), deliberately — a customer whose tenant row carries no
   M365 identifier has no risks, which is true; `403` would wrongly read as "you may not see
   your own register." **`portal-rbd-document.ts` (§1.5) makes the opposite choice on purpose**
   (`requireScope`, `:98-114`) — a real `403`, not an empty list, because every route there acts
   on one specific container, not a list that can legitimately be empty.
2. **`null` is served as `null`.** No portal normaliser exists in this repository today (§3) to
   cite for the "Not recorded" / zeroed-heat-map-coordinate display behaviour the prior pack
   documented — that logic lived in the now-retired `riskRegisterWire.ts`. The **server-side**
   contract is unchanged: every nullable column above is served as `null`, never a fabricated
   default (`portal-risk-register.ts:61-65` states this as a design rule, still true). Whatever
   consumes this wire next must re-implement the same discipline; it cannot be assumed inherited
   from dead code.

The `policy-decisions` list still additionally hides rows with an empty `decision_state`
(`portal-risk-register.ts:472`).

---

## 9. The forbidden list — declared, not merely absent

Swept fresh from every route header now in this module (six files, up from two):

1. **No cross-tenant read.** Unchanged, `portal-risk-register.ts:9-16, 18-34`. Also enforced
   identically in `portal-rbd-document.ts` (`versionInScope`, `:118-120`) and MSP-side by
   `resolveMspIdStrict`, never the request body, in every `msp-rbd-*.ts` route.
2. **No fabricated register values.** Unchanged, `:61-65`.
3. **No second signature — per line (§1.4) and per document (§1.5/§1.6).** The per-line accept
   is a guarded `UPDATE ... WHERE accepted_at IS NULL` (`:660-668`). The whole-document sign is
   guarded identically: `WHERE ... supersededAt IS NULL AND signed = false`
   (`rbd-versioning.ts:220-233`) — the same "write-once enforced by a guarded UPDATE, not a DB
   constraint" pattern, now applied to a second signature surface.
4. **The customer-facing signature does not trust the client for audit fields** — `ipAddress`/
   `signatureHash` derived server-side in `portal-risk-register.ts` (`:619-622`) AND
   `portal-rbd-document.ts` (`:246-249`). **Exception, flagged not papered over:**
   `public-rbd-document.ts` reads `x-forwarded-for` directly (§1.6) — a deliberate, precedented
   difference on the one unauthenticated path, not an oversight.
5. **`fullName`/`signerName` is not matched against the account name**, same reasoning, in both
   `portal-risk-register.ts:492-497` and `portal-rbd-document.ts` (no such check exists there
   either — verified, not merely assumed by pattern-matching the sibling route).
6. **MSP renewal-on-the-customer's-behalf must not exist** (#1507) — confirmed absent, `msp-rbd.ts`
   grepped for any renew/reissue handler: none.
7. **Insider-risk detection remains a recorded non-goal** for the shadow-IT path (#1489,
   unaffected by this regeneration).
8. **New, #1511:** Acceptance authority checks (§1.4) run **only** when `checkKey` resolves to a
   real workload. This is a deliberate scope limit, not an oversight to "fix" by inventing an
   authority model for cross-cutting categories (`cost:*`, `governance:*`, etc.) that the
   Ownership/RACI matrix (#1491) does not itself model per-workload.
9. **New, #1512:** A document is never rendered on a customer's or the public's own request —
   only the MSP-side `POST .../document` endpoint persists a render, because that write needs a
   real MSP staff `createdByUserId` (`portal-rbd-document.ts:22-28`, `public-rbd-document.ts:15-19`).
   A read before the MSP has rendered gets a clear 404, never a render attributed to nobody.

---

## 10. Provenance

Regenerated 2026-09-01 against branch `agent/1712-q1112`, superseding the 2026-08-29 pack
(`ef0e50dad`, branch `agent/1487-q783`). Verified live against local PostgreSQL
(`psql "$DATABASE_URL" -c '\d msp_risk_decisions'` / `'\d risk_instances'` /
`'\d msp_rbd_versions'`) — every column cited above was confirmed present on the running schema,
not just in the Drizzle source.

Sources cited inline by file:line: `portal-risk-register.ts`, `portal-rbd-document.ts`,
`public-rbd-document.ts`, `portal-policy-decisions.ts` (§0.1 only), `msp-rbd.ts`,
`msp-rbd-versions.ts`, `msp-rbd-instances.ts`, `risk-authority.ts`, `rbd-versioning.ts`,
`tenant-workloads.ts`, `alert-engine.ts`, `lib/db/src/schema/msp.ts`. Nine commits landed against
this module since the prior pack: #1507 (`33f8b5a34`), #1508 (`c1eaf649c`), #1509 (`66bedb976`),
#1510 (`ae6101d1d`), #1511 (`3773a97ca`), #1512 (`647dede362`), #1513 (`f256f5176`), #1514
(`279a85fbb`), plus the adjacent #1527 (`cf241ab48`) which extends #1513's writer to
`policy_decisions` and is disambiguated in §0.1 rather than folded into the main contract.

**Confirmed retired, not carried forward:** `artifacts/msp-portal` (`portal-v2`) and every
`riskRegister*.ts`/`policyDecisionsData.ts` file the prior pack cited as a consumer — zero matches
repo-wide. `Design/portal/` carries no export for this module. Both facts recorded in §0 rather
than silently dropped.

**No sub-issue filed by this pass.** Every candidate this regeneration found either (a) is the
expected pre-Design state already tracked on #1487 (§0), (b) is a field-level gap too narrow for
the orphaned-endpoint trigger and is instead recorded honestly in §7.3, or (c) is the pre-existing
#1523 gap already carried forward unchanged (§7.1). Read-only pass: no product code, schema, or
UI was changed.

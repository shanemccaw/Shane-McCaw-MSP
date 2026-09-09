# Policy Decisions + Policy Engine — contract extraction pack for Claude Design (customer portal)

**Regenerated for #1722**, the #1642 pattern, under **#1490** (Feature: Policy Decisions,
Portal) / **#1485** (EPIC: Portal). Full line-by-line audit against the real, finished code —
this pack **replaces the 2026-08-29 pack wholesale**, per #1642's own instruction ("treat the
existing pack as prior art to be replaced, not edited"). Read-only — no product code, schema
or UI changes; no `drizzle-kit push`. Every field below is extracted verbatim from the routes'
own `Wire*` interfaces and the Drizzle schema, cited to file:line, and cross-checked live
against the local Postgres instance (`shanemccawmsp`), 2026-09-06.

## Why the 2026-08-29 pack is obsolete, not merely stale

The old pack's own §1 described Policy Decisions as reading `msp_risk_decisions` rows filtered
to a non-blank `decision_state` — true on 2026-08-29, **no longer the primary model**. Git
#2024 (2026-08-31, deciding #1528's own open question) gave Policy Decisions **its own table**,
`policy_decisions`, with its own create/sign-off path. The old pack's §4 also carried Policy
Engine as "Fully unbuilt. No table, no route, no wire type" — also true on 2026-08-29, also no
longer true: #1547–#1553 all shipped real, mounted code in the roughly one week since (verified
`gh issue view` on all seven: `state: CLOSED`). **That build landed on the MSP Console side,
not this one** — see §4 below for why nothing changes on the customer-portal surface as a
result.

Backend routes (customer portal, all live, all mounted — imports at
`artifacts/api-server/src/routes/index.ts:178,181,182`, mounted at `:503,506,507`):
- `artifacts/api-server/src/routes/portal-policy-decisions.ts` — Policy Decisions' own table:
  read, create/sign, manual clearance-resolve (3 routes)
- `artifacts/api-server/src/routes/portal-risk-register.ts` — the risk-derived `GET
  /portal/policy-decisions` view (1 of its 3 routes; the other 2 are Risk Register's own scope,
  out of this pack)
- `artifacts/api-server/src/routes/portal-compliance-obligations.ts` — the obligation catalog,
  the adjacent surface this module's own obligation reference (#1525) resolves against (1 route)

Schema: `lib/db/src/schema/msp.ts` — `policyDecisionsTable` (`:8994-9096`, #2024),
`complianceFrameworksTable` (`:371-395`, #1525), `complianceObligationsTable` (`:403-415`),
`tenantComplianceScopeTable` (`:423-431`+), `mspRiskDecisionsTable` (unchanged shape, old pack's
§1 citations still accurate for its own fields).

**Sibling pack:** `docs/policy-decisions-msp-console-contract-pack.md` (#2589, MSP Console /
operator side, DONE 2026-09-06) documents the Policy Engine object (`standing_policies`,
`policy_evaluation_runs`) and the MSP-side read of `policy_decisions`. This pack does not
re-extract that ground; §4 below states plainly what that pack already established and why it
does not change anything here.

---

## 0. The two objects, restated for 2026-09-06

1. **Policy Decisions** — reactive, obligation-bound, signed. **Real, own table since #2024.**
   No unsigned intermediate state: a row is a signed decision from the moment it exists.
2. **Policy Engine** — proactive, declarative, no obligation, no signature. **Real and built —
   but MSP-console-only.** Zero customer-facing route or page reads `standing_policies`,
   `policy_evaluation_runs`, or the tenant opt-in column anywhere in `artifacts/portal`
   (confirmed by repo-wide grep, §4). #1490's own sub-issues #1547–#1553 (Policy Engine) are
   closed and shipped code, but every route that code lives behind is `requireRole("MSPOperator")`
   under `/api/msp/*` — this pack's own module (the customer side of #1490) has nothing new to
   extract as a result.

### 0.1 The table-name error this pack's predecessor corrected (#1529, closed)

#1490's original issue body listed `policy_rules`/`policy_rule_firings`/`policy_rule_audit_log`/
`policy_rule_suppressions`/`policy_rule_incidents` as this module's backing tables — confirmed
wrong (alert-engine machinery, `lib/db/src/schema/index.ts`, coincidental name collision). #1529
closed 2026-09-03 correcting this across tooling/docs. Restated here only so a reader who has
not seen the old pack does not rediscover the same wrong turn. The real table is
`policyDecisionsTable` → `policy_decisions` (own table, #2024) for the reactive object described
in §1, plus the pre-existing `mspRiskDecisionsTable` → `msp_risk_decisions` for the risk-derived
view in §2.

---

## 1. Wire contract — Policy Decisions, own table (`portal-policy-decisions.ts`)

### 1.1 `WirePolicyRegisterEntry` (`portal-policy-decisions.ts:79-116`)

```ts
// portal-policy-decisions.ts:79-116 — WirePolicyRegisterEntry (verbatim)
interface WirePolicyRegisterEntry {
  readonly id: string;
  readonly state: string;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string;
  readonly obligationId: string | null;
  readonly obligationType: string | null;
  readonly owner: string;
  readonly ownerId: string | null;
  readonly reviewCadence: string | null;
  readonly reviewDueAt: string | null;
  readonly reviewState: string | null;
  readonly compensatingControl: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly statement: string;
  readonly clearanceCondition: string | null;
  readonly clearanceTriggerType: string | null;
  readonly clearanceTriggerSkuPartNumber: string | null;
  readonly clearanceResolvedAt: string | null;
  readonly clearanceResolvedNote: string | null;
  readonly isCleared: boolean;
}
```

**This is a byte-for-byte duplicate** of `msp-policy-decisions.ts:88-111`'s own
`WirePolicyRegisterEntry` (the MSP-console read of the same table, #2589 §2.1) — same field
names, same nullability, hand-duplicated rather than shared. Flagged there, restated here: a
future field addition to one that is not mirrored to the other will silently drift the two
surfaces apart. Not a bug today — both are identical, verified by direct comparison.

Built by `toWirePolicyRegisterEntry` (`:131-156`) from the real `policyDecisionsTable` row:

| Wire field | DB column | Type | Nullable | Notes |
|---|---|---|---|---|
| `id` | `id` (serial) | `string` (stringified) | no | |
| `state` | `decision_state` | `string` | no | default `'live'` — real values §5 |
| `pillar` | `pillar` | `string \| null` | yes | free text |
| `title` | `title` | `string` | no | |
| `obligation` | `obligation` | `string` | no | free-text citation, kept even once `obligationId` resolves |
| `obligationId` | `obligation_id` | `string \| null` (stringified) | yes | FK → `compliance_obligations.id`, set-null (#1525) |
| `obligationType` | derived, joined | `string \| null` | — | resolved via `loadObligationTypes` (`:118-129`), one batched query joining `compliance_obligations` → `compliance_frameworks.authority_type`; null unless `obligationId` is set AND the join resolves |
| `owner` | `owner` | `string` | no | |
| `ownerId` | `owner_id` | `string \| null` | yes | RACI person key |
| `reviewCadence` | `review_cadence` | `string \| null`, enum §5 | yes | NULL for a dependency-based row — the DATE clock (#2518) |
| `reviewDueAt` | `review_due_at` | ISO string or `null` | yes | computed at create time from `reviewCadence` + `createdAt` (`computeReviewDueAt`, `:294-298`) — not stored raw as entered |
| `reviewState` | `review_state` | `string \| null` | yes | NULL for a dependency-based row — no on_track/due/overdue reading for a dependency |
| `compensatingControl` | `compensating_control` | `string` | no | |
| `signedBy` | `signed_by` | `string` | no | the typed name at sign-off |
| `signedAt` | `signed_at`, ISO | `string` | no | server clock, never the client's |
| `statement` | `statement` | `string` | no | the exact confirmation sentence, snapshotted |
| `clearanceCondition` | `clearance_condition` | `string \| null` | yes | non-null is what makes a row dependency-based — the THIRD clock (#1526) |
| `clearanceTriggerType` | `clearance_trigger_type` | `string \| null`, enum §5 | yes | `license_sku` (platform-observable) \| `manual` (only this route's PATCH can clear it) |
| `clearanceTriggerSkuPartNumber` | `clearance_trigger_sku_part_number` | `string \| null` | yes | the SKU `advancePolicyClearances()` (`alert-engine.ts:243-302`) watches for |
| `clearanceResolvedAt` | `clearance_resolved_at`, ISO | `string \| null` | yes | non-null = actionable immediately, no scheduled review to wait for |
| `clearanceResolvedNote` | `clearance_resolved_note` | `string \| null` | yes | auto-detect message or the human's own note |
| `isCleared` | derived — `clearanceResolvedAt !== null` | `boolean` | — | computed on every read, never stored |

**Not on this wire at all**, present on the raw row: `mspId`, `tenantId`, `ipAddress`,
`signatureHash`, `createdAt`, `updatedAt` — real internal/audit columns kept off the wire by
construction (`msp.ts:9083-9084,9086-9087`).

### 1.2 Read — `GET /api/portal/policy-register` (`:159-199`)

`requireRole("CustomerUser")` — matches Risk Register's own floor (§2), not the lower
`Assessment` floor Compliance Obligations uses (§3), because the underlying row carries a
signature surface. `requireTierFeature(PORTAL_TIER_MODULE_KEYS.policyDecisions)` (`:164`) gates
this read only — per #1168's rule, creation below is unconditional. Scoped `(mspId, tenantId)`
via `resolveTenantScope` (`:172`); an unresolvable scope serves `{ decisions: [] }` rather than
403 (`:173-177`) — a customer whose tenant carries no M365 identifier genuinely has no
decisions, which is a true statement, not a permission failure. Response: `{ decisions:
WirePolicyRegisterEntry[] }` (`:193`), newest-id-first (`:188`).

### 1.3 Create/sign — `POST /api/portal/policy-register` (`:300-429`)

`requireRole("CustomerUser")`. **No `requireTierFeature` call** — deliberate, per #1168's own
rule restated in this route's neighbour (`portal-risk-register.ts:413-414`'s comment): creation
and tracking are always unconditional; only the customer-facing READ layer gates on the
purchased Monitoring tier. A customer whose tier does not bundle Policy Decisions can still
create/sign a decision through this route today — real, current, matches the platform-wide
#1168 rule, not a gap.

```ts
// portal-policy-decisions.ts:217-277 — createSchema (verbatim shape, zod refinements condensed)
{
  title: string (2-300 chars, trimmed),
  obligation: string (2-300 chars, trimmed),
  obligationId: number | null,       // optional — verified server-side, §1.3.1
  pillar: string (max 100),          // optional
  owner: string (1-200 chars),
  ownerId: string (max 200),         // optional
  reviewCadence: enum REVIEW_CADENCES,      // optional — exactly one of this/clearanceCondition
  clearanceCondition: string (1-500 chars), // optional
  clearanceTriggerType: enum CLEARANCE_TRIGGER_TYPES, // required iff clearanceCondition set
  clearanceTriggerSkuPartNumber: string (1-100), // required iff clearanceTriggerType === 'license_sku', forbidden otherwise
  compensatingControl: string (1-2000 chars),
  signerName: string (2-200 chars),  // the typed signature name
  confirmed: true,                   // z.literal(true) — the checkbox IS the consent
  statement: string (1-2000 chars),
}
```

The `superRefine` (`:241-277`) enforces **exactly one** of `reviewCadence` /
`clearanceCondition` at the application layer — see §5's note on how this compares to the DB's
own weaker CHECK.

#### 1.3.1 Obligation FK resolution — never trusted as-is from the client (`:326-348`)

A client-supplied `obligationId` is verified against a real, active catalog entry that is
**either global (`complianceFrameworksTable.mspId IS NULL`) or authored for this tenant's own
MSP** (`or(isNull(...mspId), eq(...mspId, scope.mspId))`, `:337`) — the exact join shape #1525's
own schema decision (§6) anticipates. A mismatch is **dropped to `null` rather than failing the
whole request** (`:340-347`) — the free-text `obligation` citation stays valid on its own even
when the FK does not resolve.

#### 1.3.2 Server-derived fields (`:350-407`)

`signedAt` (server clock), `ipAddress` (same known limitation as `portal-risk-register.ts`'s
accept endpoint — behind Replit's proxy with no `trust proxy` configured, this records the
proxy's loopback hop today, not the customer's real address; recorded anyway, `:352-356`),
`signatureHash` (`sha256` over tenantId/title/signerName/signedAt/statement, `:357-365`),
`reviewDueAt` (computed via `computeReviewDueAt`, `:294-298`, `signedAt` as the anchor — never
DB `defaultNow()`, so the anchor exactly matches the row's own `createdAt`, `:371-378`'s own
comment on why), `reviewState` (`"on_track"` for a date-based row, `null` for dependency-based,
`:395`). Response `201`: `{ decision: WirePolicyRegisterEntry }` (`:423`).

### 1.4 Manual clearance resolve — `PATCH /api/portal/policy-register/:id/clearance/resolve` (`:443-543`)

`requireRole("CustomerUser")`. Body: `{ note: string, 1-2000 chars }` (`:439-441`). Four guarded
states in order, identical business rules to the MSP-console's own equivalent
(`msp-policy-decisions.ts:223-322`, #2589 §2.3):

1. `404` if the decision doesn't resolve to `(mspId, tenantId, id)` (`:485-488`).
2. `409 CONFLICT` if `clearanceCondition IS NULL` — nothing to resolve (`:489-492`).
3. `409 CONFLICT` if `clearanceTriggerType !== 'manual'` — a `license_sku` row is the platform's
   own to resolve via `advancePolicyClearances()`; a human cannot force it (`:493-501`).
4. `409 CONFLICT` if already resolved (`:502-505`), **plus** a real race guard: the `UPDATE`
   itself is `WHERE id = ? AND clearance_resolved_at IS NULL` (`:515-522`) — a second concurrent
   resolve loses the race at the DB level, not just the earlier read-check.

Response: `{ decision: WirePolicyRegisterEntry }` (`:537`). **Any `CustomerUser` on this tenant
may resolve any decision** — no check that the resolving user is the original signer, matching
the MSP-console equivalent's own stated rationale: this records an observed operational fact,
not a policy position.

---

## 2. Wire contract — Policy Decisions, risk-derived view (`portal-risk-register.ts`)

### 2.1 `GET /api/portal/policy-decisions` (`portal-risk-register.ts:457-491`)

**Coexists with §1 by design, not by oversight.** The route file's own header states this
plainly (`:1-18`): this view reads `msp_risk_decisions` rows that already carry a non-blank
`decision_state` — i.e. a policy position recorded against a risk that was already raised.
#2024/#1528 (§6) decided that model does not generalize (no way to start from "we've decided X"
with no risk first), and built the own-table path in §1 as a result — **without retiring this
one**. The two serve genuinely different provenance: this route's decisions are "attached to
actual risk decisions"; §1's are freestanding. Both are real, live, and — per §7 — currently
unconsumed by any page.

`requireRole("CustomerUser")`, `requireTierFeature(PORTAL_TIER_MODULE_KEYS.policyDecisions)`
(`:462`, same module key §1's read uses — both views are gated by the same tier feature).
Scoped via `scopeOrEmpty(req, res, "decisions")` (`:394-407`), same fail-to-empty-not-403
pattern as §1.2. Filtered server-side to rows where `decision_state` is non-blank after
trimming (`:479`) — a raw liability acceptance with no policy position recorded is a risk, not a
documented decision.

```ts
// portal-risk-register.ts:239-265 — WirePolicyDecision (verbatim)
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
  readonly reviewDueAt: string | null;
  readonly reviewState: string | null;
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
  readonly obligationId: string | null;
  readonly obligationType: string | null;
}
```

Built by `toWirePolicyDecision` (`:361-384`) from `mspRiskDecisionsTable`:

| Wire field | DB column | Type | Nullable | Notes |
|---|---|---|---|---|
| `id` | `rbd_id` | `string` | no | |
| `state` | `decision_state` | `string \| null` | yes | real values §5 (a DIFFERENT vocabulary from §1's `policy_decisions.decision_state`) |
| `pillar` | `pillar` | `string \| null` | yes | free text |
| `title` | `title` | `string` | no | |
| `obligation` | `obligation` | `string \| null` | yes | free text |
| `owner` / `ownerId` | `owner` / `owner_id` | `string \| null` | yes | |
| `approved` | derived | ISO or `null` | — | `acceptedAt` if set, else `clientApprover.signedAt` (`:373`) |
| `review` | `review_date` | `string \| null` | yes | display copy, not a real date type |
| `reviewDueAt` | `review_due_at`, ISO | `string \| null` | yes | machine date (#1507) |
| `reviewState` | `review_state` | `string \| null` | yes | RISK_REVIEW_STATES |
| `register` | `register_ref` | `string \| null` | yes | e.g. `RR-2026-014` |
| `rationale` | `rationale` | `string \| null` | yes | |
| `compensating` | derived | `string \| null` | — | joined sentence, `compensatingSentence` (`:285-288`) |
| `check` | `verification_note` | `string \| null` | yes | |
| `obligationId` / `obligationType` | `obligation_id` / joined | `string \| null` | yes | same `loadObligationTypes` batched-join pattern as §1 |

**`EXPIRED` no longer applies to `decisionState` here** — #1507/#1527 (closed) removed the
expiry semantics from the acceptance lifecycle; a past-due review surfaces as `reviewState =
"overdue"` on a `decisionState` that stays whatever it was, never itself as `expired`. The old
pack's §4 flagged `EXPIRED` as "CURRENT but WRONG — must be removed"; **verified fixed** — no
code path in this file writes or reads an `expired` `decisionState` value today.

---

## 3. Wire contract — Compliance Obligations (`portal-compliance-obligations.ts`)

Unchanged in shape from the old pack; row counts and one schema-level extension (§6) are new.

### 3.1 `GET /api/portal/compliance-obligations` (`:73-184`)

`requireRole("Assessment")` — lower than §1/§2's `CustomerUser` floor, since this page carries
no liability dollar figure (`:35-38`).

```ts
// portal-compliance-obligations.ts:61-67 — WireObligation (verbatim)
interface WireObligation {
  readonly framework: string;         // the obligation's OWN citation, not the framework name
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;             // derived, human-readable
  readonly tone: "red" | "amber" | "green" | "slate";
}
```

**State/tone are computed live at read time, never stored** (`:8-14`, #1256 sign-off option A):
the route joins the tenant's in-scope catalog obligations (`:84-101`) to its own open
`msp_risk_decisions` findings (`:103-142`, `OPEN_RISK_STATUSES = Open | Mitigating | Expired`,
`:55`), matched by a case-insensitive trimmed string match between
`compliance_obligations.citation` and `msp_risk_decisions.obligation` (`normalizeKey`, `:69-71`,
applied at `:135,157`). Response: `{ obligations: WireObligation[] }` (`:178`).

**§3's catalog query does NOT scope by `mspId`/`tenantId`** (`:84-96`) — it selects every
`active` obligation joined to every `active` framework, full stop. §6 below states plainly what
this means now that `complianceFrameworksTable` supports MSP/tenant-authored rows.

### 3.2 The real catalog, verified live (2026-09-06)

```sql
-- lib/db/src/schema/msp.ts:371-431
complianceFrameworksTable   -- global OR MSP/tenant-authored (#1525) catalog — see §6
complianceObligationsTable  -- specific clause/citation within a framework, FK -> framework
tenantComplianceScopeTable  -- per-(tenant,framework) in/out-of-scope decision + audit
```

| Table | Real row count | Notes |
|---|---|---|
| `compliance_frameworks` | **6** (up from the old pack's 5 — `iso-27001 · ISO 27001 A.5.18` added, resolving one of #1525's four originally-flagged sample obligations) | all 6 have `msp_id IS NULL` — every live row today is global, verified directly (§6) |
| `compliance_obligations` | **8** (up from 7, same addition) | |
| `tenant_compliance_scope` | **0** — unchanged | every tenant still on the `default_in_scope` fallback |

```
sox         · SOX §802 · 17 CFR 210.2-06                         · regulation
sec-finra   · SEC 17a-4(f) · FINRA 4511                          · regulation
gdpr        · GDPR Art. 5(1)(e) · Art. 32                        · regulation
gdpr        · GDPR Art. 15 · subject access                      · regulation
gdpr        · GDPR Art. 30 · records of processing                · regulation
hipaa       · HIPAA §164.316(b)(2)(i)                             · regulation
pci-dss-v4  · PCI DSS v4.0                                        · certification
iso-27001   · ISO 27001 A.5.18                                    · certification
```

---

## 4. Policy Engine — nothing to extract on this pack's own surface

**Restated plainly, because the old pack's "fully unbuilt" claim would otherwise mislead a
reader who has not also opened #2589's pack:** Policy Engine (`standing_policies`,
`policy_evaluation_runs`, the compliance evaluator, the Workflow Engine node) is real, mounted,
and shipped — #1547–#1553 all closed. **None of it is reachable from the customer portal.**
Verified by repo-wide grep, this pack's own pass, 2026-09-06:

```
grep -rn "standing_polic\|standingPolic\|policy_evaluation_run\|policyEvaluationRun\|policyEngineOptIn" artifacts/portal/src
# zero matches
```

Every route behind this object is `artifacts/api-server/src/routes/msp-standing-policies.ts` /
`msp-policy-engine-settings.ts`, both `requireRole("MSPOperator")`, mounted under `/api/msp/*`
(`routes/index.ts`) — the MSP Console's own scope, not the customer portal's. That module's own
route file states this explicitly: `msp-policy-engine-settings.ts`'s header (per #2589 §3.7):
**"SCOPE STOP: artifacts/portal has no page for this module."** #1685's own body states the
intended eventual architecture ("Customer reads standing policy and the deviation decisions on
their tenant") — not built, and correctly out of both this pack's and #2589's scope. See
`docs/policy-decisions-msp-console-contract-pack.md` for the full Policy Engine wire contract,
enum unions, and cross-surface edges — none of it is duplicated here because none of it has a
customer-facing counterpart to extract.

---

## 5. Real enum unions

```
policy_decisions.decisionState:       free text, default 'live'
  (policyDecisionsTable, msp.ts:9028 comment — POLICY_DECISION_STATES reuses
   msp_risk_decisions' own vocabulary conceptually, but is NOT DB-enforced —
   only NOT NULL, no CHECK constraint on this column, confirmed live via
   \d policy_decisions, §5.1)

policy_decisions.reviewCadence:       Monthly | Quarterly | Semi-Annual | Annual | Biennial
  (REVIEW_CADENCES, msp.ts:8991 — #2518, Shane decided Option A, fixed enum,
   superseding the free-text state #2092 left open. Enforced ONLY by
   portal-policy-decisions.ts's createSchema z.enum at create time — plain
   `text` column, no CHECK.)

policy_decisions.clearanceTriggerType: license_sku | manual
  (CLEARANCE_TRIGGER_TYPES, msp.ts:8983 — plain text, no CHECK, enforced only
   at create time)

msp_risk_decisions.decisionState:     proposed | live | due | expired
  (mspRiskDecisionsTable — DIFFERENT column, same name, on the risk-derived
   view §2; enforced client-side only, riskRegisterWire.ts, out of scope for
   this pack per the old pack's own appendix — that consumer file's real
   current path could not be verified this pass, see §7)

msp_risk_decisions.status:            pending_signature | active | expired | revoked
msp_risk_decisions.riskStatus:        Open | Mitigating | Accepted | Closed | Expired
  (unchanged from the old pack — Risk Register's own scope, cited here only
   because §3's join reads riskStatus directly, portal-compliance-obligations.ts:55)

complianceObligationsWire.tone:       red | amber | green | slate
  (OBLIGATION_TONES, portal-compliance-obligations.ts:57)

complianceFrameworksTable.authorityType: regulation | certification | contract | insurance | internal_schedule
  (AUTHORITY_TYPES, msp.ts:357 — plain text, default 'regulation', no CHECK)

tenantComplianceScopeTable.source:    onboarding | manual | advisor
  (msp.ts:429)
```

### 5.1 The DB CHECK is weaker than the code comment claims — flagged, not filed

`portal-policy-decisions.ts:44-46`'s own header states the create schema matches "the DB's own
`policy_decisions_review_xor_clearance_chk` CHECK... never both, never neither." **Verified
against the live constraint** (`pg_get_constraintdef`):

```sql
CHECK ((NOT ((review_cadence IS NOT NULL) AND (clearance_condition IS NOT NULL))))
```

This forbids **both set**, but does **not** forbid **neither set** — a true XOR would need an OR
clause the CHECK does not have. "Never neither" is enforced today only by the app-layer
`superRefine` (`:241-250`) on this route's own create path, and — per #2589 §2.4 — there is
currently no other write path into `policy_decisions` at all (an MSP-side create was
deliberately not built). No live consequence today. Worth #1723/#1724 knowing before any second
write path (e.g. a future MSP-side create, #2589's own #3035 finding) is built assuming the DB
enforces what the comment claims it does.

---

## 6. #1525's own open question — now answered by the schema, still has a real gap

The old pack's §5.1 flagged, unresolved: "is the obligation source platform-seeded,
customer-specific, or both?" **The schema now answers this — both** — but a real gap remains in
how it is reached.

`complianceFrameworksTable` (`msp.ts:360-370`'s own comment, added by
`lib/db/migrations/manual/2026-08-31-obligation-register-authority-type-1525.sql`) now carries
nullable `mspId`/`tenantId` columns: a global/seeded row has both null; an MSP/tenant-authored
row (a customer's own insurance schedule or records policy — #1525's own motivating examples)
has both set, scoped by the same `(mspId, tenantId)` pair `resolveTenantScope` produces, and is
visible only to that pair. `portal-policy-decisions.ts:337`'s obligation-FK resolution already
respects this (`isNull(mspId) OR eq(mspId, scope.mspId)`, §1.3.1).

**The real gap: there is no route anywhere in the codebase that creates one.** Confirmed by
repo-wide grep for `insert(complianceFrameworksTable` / `insert(complianceObligationsTable` and
a route-level grep for `complianceFrameworksTable` across `artifacts/api-server/src/routes` (8
files, all read-only consumers) and `artifacts/admin-panel/src` (zero matches) — the entire
8-row/6-framework catalog is seed data, and #1525's own motivating cases (a specific tenant's
insurance schedule, a specific tenant's internal records schedule) have no path to be entered by
anyone, MSP or customer. **Live evidence this is not hypothetical:** all 6 real
`compliance_frameworks` rows today have `msp_id IS NULL` — zero tenant-authored rows exist,
because nothing can create one.

#1525 is closed (`state_reason: completed`) on the strength of the schema decision; the create
path for the "customer-specific" half of its own answer was never built. Filed as this pack's
own finding — see below — rather than left as a second silent gap next to #2589's own #3034/#3035.

---

## 7. Cross-surface edges

| Edge | Column | Points at | Served on either wire? | Notes |
|---|---|---|---|---|
| Decision (own table) ↔ obligation | `policy_decisions.obligation_id` | `compliance_obligations.id`, FK set-null | Yes — `obligationId` (raw) + `obligationType` (joined), §1.1 | |
| Decision (risk-derived) ↔ obligation | `msp_risk_decisions.obligation_id` | same | Yes, §2.1 | Same batched-join pattern, separate query |
| Compliance Obligations ↔ open findings | `compliance_obligations.citation` ↔ `msp_risk_decisions.obligation` | — | Yes, `state`/`tone`, §3.1 | Case-insensitive string match, not a FK — the one place a free-text field is already treated as a join key against the real catalog |
| Compliance Frameworks ↔ MSP/tenant | `compliance_frameworks.msp_id` / `.tenant_id` | `msps.id` / free-text M365 identifier | Not served — filter is absent, §3.1/§6 | Schema-ready, zero live rows, zero write path (§6) |
| `policy_decisions` ↔ tenant scope | `mspId` + `tenantId` (free text) | same shape as `msp_risk_decisions` | Scoping only, never served | `portal-customer-scope.ts:15-21`'s own header names `msp_change_requests`/`msp_risk_decisions`/`msp_sop_runs` as the MSP-era shape; `policy_decisions` uses the identical pattern but is not named in that list — a minor documentary gap, not filed (no live consequence — the route itself scopes correctly, §1.2/§1.3) |
| `policy_decisions` ↔ Policy Engine | — | — | **None exists** | Confirmed: no column on either table references the other; the two objects (§0) are structurally unrelated today |
| Policy Decisions (both views) ↔ portal UI | — | — | **None — orphaned, §8** | |

---

## 8. Orphaned endpoints — all of this module's own routes today

Repo-wide grep, `artifacts/portal/src`, for every symbol either route file's own consumer would
plausibly use (`policy-register`, `policy-decisions`, `policyDecisions`, `policyRegister`,
`risk-register`, `compliance-obligations`, `riskRegister`, `complianceObligation`, case
-insensitive): **zero matches** except `moduleNav.ts:50` — `{ key: "policy", label: "Policy
Decisions", icon: Scale, builtPath: null }` (`/coming-soon?feature=Policy%20Decisions`, per
`moduleNav.ts:56-58`'s own honest-empty routing, Git #1827) — and one unrelated incidental hit
in `oversharingItemsLive.ts` (a different "compliance" usage, not this module).

**This is the expected, honest pre-wire state, not a surprise finding** — #1724 (wire the
portal UI to the real endpoints) is the very next step in this Feature's own fixed order and is
still open. Restated per this repo's own "orphaned endpoints listed explicitly" requirement:

| Endpoint | Method | Consumer today | Status |
|---|---|---|---|
| `/api/portal/policy-register` | GET | none | live, staged for #1724 |
| `/api/portal/policy-register` | POST | none | live, staged for #1724 |
| `/api/portal/policy-register/:id/clearance/resolve` | PATCH | none | live, staged for #1724 |
| `/api/portal/policy-decisions` | GET | none | live, staged for #1724 (§2's coexistence question, §9) |
| `/api/portal/compliance-obligations` | GET | none — the design's page for it (`portal-v2-compliance-obligations.tsx`) does not exist in `artifacts/portal` (retired with `artifacts/msp-portal`, #1921) | live, staged for #1724 |

Zero cross-surface reuse in `admin-panel` or `mcp-server` either (grepped `policy_decisions`,
`standing_policies`, `policy-register` across both — zero matches), matching the sibling pack's
own §1 precedent.

---

## 9. What #1724 (wire) will need to decide, not this pack's job to resolve

Per this module's standing instruction: an open question gets a table row and real evidence,
not an invented answer.

**§1 (own table) and §2 (risk-derived view) both surface as "Policy Decisions" to a customer,
from two different tables, via two different endpoints, with near-identical but not identical
wire shapes** (§2's `WirePolicyDecision` has no `compensatingControl`/`signedBy`/`signedAt`/
`statement`/clearance fields; §1's `WirePolicyRegisterEntry` has no `outcome`/`framework`/
`controlViolated` risk-liability fields). `portal-risk-register.ts:1-18`'s own header states the
coexistence is intentional, not an oversight to fix — but it does not say whether #1724's single
"Policy Decisions" page should merge both into one list, show them as two tabs, or pick one.
That is a real product-surface decision for #1723 (Design)/#1724 (wire) to make with Shane, not
something this read-only pack can settle.

---

## 10. Field status — CURRENT vs DECIDED

| Surface | Field / behavior | Status | Issue |
|---|---|---|---|
| Policy Decisions (own table) | `WirePolicyRegisterEntry`, read/create/clearance-resolve, scoped, own table | **CURRENT — built** | #2024 |
| Policy Decisions (own table) | `decisionState` starts `live`, no unsigned intermediate state | CURRENT | #2024 |
| Policy Decisions (own table) | Obligation as a first-class reference, verified server-side, dropped to null on mismatch rather than failing | CURRENT | #1525 |
| Policy Decisions (own table) | Dependency-based clearance (third clock), XOR with review cadence at the app layer (DB CHECK weaker, §5.1) | CURRENT | #1526 |
| Policy Decisions (own table) | `reviewDueAt` computed from `reviewCadence` + anchor at create time | CURRENT | #2518 (resolves #2092) |
| Policy Decisions (own table) | Review clock advanced by `alert-engine.ts`'s `advancePolicyReviewClock`, feeding a real, enabled `policy_review_overdue` alert rule (id 93) | CURRENT, verified live | #1527 |
| Policy Decisions (own table) | License-SKU clearance auto-resolved by `advancePolicyClearances`, feeding a real, enabled `policy_clearance_resolved` alert rule (id 94) | CURRENT, verified live | #1526 |
| Policy Decisions (own table) | MSP-side create/author endpoint | **Deliberately NOT built** — a genuine product/trust decision, not a missing-column gap | #2589 §2.4, real finding #3035 already filed under #1685 |
| Policy Decisions (risk-derived view) | `WirePolicyDecision`, read, coexists intentionally with the own-table path | CURRENT | — |
| Policy Decisions (risk-derived view) | `EXPIRED` as a decision state | **Fixed** — verified no code path writes/reads it; review lapses via `reviewState`, not `decisionState` | #1507, #1527 |
| Policy Decisions (risk-derived view) | Table-name correction | DECIDED, verified §0.1 | #1529 |
| Compliance Obligations | `WireObligation`, live join to `msp_risk_decisions`, state/tone computed at read time | CURRENT | #1256 |
| Compliance Obligations | Catalog now supports MSP/tenant-authored rows, not only global | **CURRENT (schema) — no create route exists for either** | #1525, real finding filed this pack (below) |
| Compliance Obligations | `tenant_compliance_scope` per-tenant decisions | CURRENT as a table; zero rows — every tenant on `default_in_scope` | — |
| Policy Engine | Standing policy, continuous evaluation, enactment routing, VIP classification, compliance findings | **CURRENT — built, MSP-console-only** (see #2589) | #1547–#1553 |
| Policy Engine | Customer-facing read of standing policy / deviation decisions | **Not built at all** | #1685's own stated intent |
| Portal UI wiring | Any page reading any of this pack's 3 route files | **Not built at all — this Feature's own next step** | #1724 |
| Portal UI design | A `.dc.html` export for this module in the live `Design/portal/` tree | **Not built at all** — a pre-backend `Design/portal/design_handoff_full_site/screens/Policy Decisions.dc.html` exists (single commit `daed32419`, "Architecture Design"), predating #2024/#1525/#1526's real backend; not the live per-module export this Feature's #1723 will produce | #1723 |

---

## 11. Honest-empty contract

Verified live against the local Postgres instance, 2026-09-06:

| Table | Real row count |
|---|---|
| `policy_decisions` | **0** |
| `standing_policies` (Policy Engine, MSP-side) | **0** |
| `compliance_obligations` | **8** |
| `compliance_frameworks` | **6**, all global (`msp_id IS NULL`) |
| `tenant_compliance_scope` | **0** |
| `msp_risk_decisions` | **1** total (`RBD-2026-575`, `tenant_id = 'contoso-01'`), `decision_state = ''` (blank, not NULL) |

Because §2's read filters to non-blank `decision_state`, and the one live `msp_risk_decisions`
row has a **blank** `decision_state`, **the real, live response for the testbed tenant today is
`{ decisions: [] }` from both §1 and §2** — genuinely empty, not a read failure, and not (yet)
distinguishable from a read failure on the wire itself.

The honest tri-state, as actually implemented (both routes share the shape):

- **loading** — client-side concern; neither route distinguishes it on the wire (matches the
  MSP-console sibling pack's own §9 observation — this is real, current, and consistent
  across every route in both packs, not unique to this one).
- **live-genuinely-empty** — fetch succeeds, `{ decisions: [] }` (or `{ obligations: [...] }`
  with every row `tone: "green"`/`"slate"` and zero findings). This is the testbed tenant's real
  current state, verified above. No error is thrown; no fabricated row is served.
- **read-failed** — every route's `catch` block logs the real error and returns a real
  `apiError(500, ...)` (`portal-policy-decisions.ts:424-427`, `portal-risk-register.ts:486-489`,
  `portal-compliance-obligations.ts:179-182`) — a genuine distinct failure signal on the wire,
  unlike the loading/empty pair. §1.2/§2.1's `scopeOrEmpty` unresolved-tenant case is
  deliberately **not** this bucket — an unresolvable scope is a true empty, not a failure
  (`scopeOrEmpty`'s own header, `portal-risk-register.ts:386-393`).

Since no page in `artifacts/portal` consumes any of this pack's 3 routes yet (§8), **none of
this tri-state has a real rendered UI today** — this section documents what the routes
themselves honestly guarantee, for #1723/#1724 to build a page against, not what a customer
currently sees (nothing, per `builtPath: null`).

---

## 12. Forbidden list

No dedicated `portal-pii-governance.ts`-style "why this can't be served" route comment exists on
any of this pack's 3 route files — none needed one; every field either route serves has a real
column or a real derivation behind it, with nulls served as nulls rather than invented.

The real forbidden-by-construction facts, swept from the route headers directly:

1. **No cross-tenant read.** All 3 routes scope by `(mspId, tenantId)` or `customerId` before
   ever touching a row; an unresolvable/foreign scope serves an honest empty result or 404,
   never another tenant's data (§1.2, §2.1, `scopeOrEmpty`).
2. **No client-supplied signing time or IP.** `portal-policy-decisions.ts:350-356` and
   `portal-risk-register.ts:606-626` both derive `signedAt`/`acceptedAt` and (the known-limited)
   `ipAddress` server-side only — a customer-facing signature route accepting a client-chosen
   timestamp would defeat the point of the record.
3. **No untrusted FK.** `obligationId` is re-verified against a real, accessible catalog row on
   every create; a mismatch silently drops to `null` rather than trusting the client's claim or
   failing the request (§1.3.1).
4. **No forced automatic-clearance override.** `clearanceTriggerType === 'license_sku'` rows
   409 on a manual resolve attempt — only `advancePolicyClearances()` may clear those (§1.4).
5. **No second signature.** The guarded `WHERE clearance_resolved_at IS NULL` / `WHERE
   accepted_at IS NULL` race guards are enforced at the DB level, not just an earlier read-check
   (§1.4, and `portal-risk-register.ts:661-669`).
6. **No plausible-looking default for a null field.** Both `toWirePolicyRegisterEntry` and
   `toWirePolicyDecision` serve every nullable column as `null`, never a fabricated value — the
   client-side "Not recorded" substitution (where it exists) is a display concern, not a wire
   concern, and out of this pack's own scope (§7's note on the un-verifiable current client path).

---

## 13. Real findings filed this pack

Filed as a direct sibling sub-issue of **#1490** (this issue's own Feature — the closest
Feature-tier parent; #1525 and #1490 share the same parent, so the finding parents alongside its
own origin issue rather than #1485 directly), board status set to AI Batter Up:

1. **No route anywhere creates a `compliance_frameworks`/`compliance_obligations` row — global
   or MSP/tenant-authored** (§6). #1525 closed on the strength of a real schema decision
   (`mspId`/`tenantId` columns added, `2026-08-31-obligation-register-authority-type-1525.sql`)
   that makes the catalog **capable** of holding a customer's own insurance schedule or records
   policy — #1525's own motivating examples — but zero route in the codebase (portal, MSP
   console, or admin-panel) can actually write one. All 6 live rows are seed data. Filed with
   real evidence: repo-wide `insert(complianceFrameworksTable`/`insert(complianceObligationsTable`
   grep (zero matches), route-level grep across `artifacts/api-server/src/routes` (8 files, all
   read-only consumers) and `artifacts/admin-panel/src` (zero matches), and the live query
   confirming all 6 `compliance_frameworks` rows carry `msp_id IS NULL`.

---

## Appendix — files read for this pack

- `artifacts/api-server/src/routes/portal-policy-decisions.ts` (full read)
- `artifacts/api-server/src/routes/portal-risk-register.ts` (full read)
- `artifacts/api-server/src/routes/portal-compliance-obligations.ts` (full read)
- `artifacts/api-server/src/lib/portal-customer-scope.ts` (`resolveCustomerId`/`resolveTenantScope`)
- `artifacts/api-server/src/lib/portal-tier-features.ts` (`requireTierFeature`, #1168)
- `artifacts/api-server/src/lib/alert-engine.ts` (header + `advancePolicyClearances`,
  `advancePolicyReviewClock`, `getConditionValue`)
- `artifacts/api-server/src/routes/index.ts` (mount lines only)
- `artifacts/portal/src/components/shell/moduleNav.ts` (full read — `builtPath: null` confirmation)
- `lib/db/src/schema/msp.ts` (`policyDecisionsTable`, `complianceFrameworksTable`,
  `complianceObligationsTable`, `tenantComplianceScopeTable`, `mspRiskDecisionsTable` — unchanged
  fields only re-cited, not re-read in full)
- `lib/db/migrations/manual/2026-08-31-obligation-register-authority-type-1525.sql` (filename only, §6)
- `docs/policy-decisions-msp-console-contract-pack.md` (#2589 — sibling pack, Policy Engine +
  MSP-side read of `policy_decisions`, cross-referenced throughout, not re-extracted)
- `Design/portal/design_handoff_full_site/` (existence check only — §10's design-export row)
- Repo-wide grep: `artifacts/portal/src` for every plausible consumer symbol of this pack's 3
  routes (§8, zero real matches); `artifacts/admin-panel/src`, `artifacts/mcp-server/src` for
  `policy_decisions`/`standing_policies`/`policy-register` (§8, zero matches); `standing_polic`/
  `policyEngineOptIn`/etc. in `artifacts/portal/src` (§4, zero matches); `insert(complianceFrameworksTable`/
  `insert(complianceObligationsTable` repo-wide (§6, zero matches)
- Direct query, local Postgres (`shanemccawmsp`), 2026-09-06: `policy_decisions`,
  `standing_policies`, `compliance_frameworks`, `compliance_obligations`,
  `tenant_compliance_scope`, `msp_risk_decisions` row counts and real values; `\d policy_decisions`
  live CHECK constraints; `msp_alert_rules` rows 92/93/94 (`risk_review_overdue`,
  `policy_review_overdue`, `policy_clearance_resolved`), all `enabled = true`
- GitHub: #1722 (this issue) + its dispatch comment, #1490 (+ structured index), #1485, #1577,
  #1578, #1525–#1529, #1547–#1553, #1618, #1952, #1953, #2024, #2092, #2148, #2163, #2518,
  #1642 (pattern precedent), #2589 (+ full sibling pack read), #1685, #1571

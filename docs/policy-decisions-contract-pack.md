# Policy Decisions + Policy Engine — contract extraction pack for Claude Design

**#1490** (Portal New Design: Policy Decisions + Policy Engine), following the method fixed
by **#1577**, under **#1485** (EPIC: Portal New Design). Read-only — no product code, no
schema changes, no UI, no `drizzle-kit push`. Every field below is extracted verbatim from
the route's own `Wire*` interfaces and the Drizzle schema, cited to file:line — nothing here
is authored or invented. Architecture settled in #1490's own comment thread (2026-08-28,
2026-08-28 correction); real enum values, real table names and real row counts are verified
directly against the local Postgres instance.

**This module is two objects, not one — settle this before reading further.**

1. **Policy Decisions** — reactive, obligation-bound, signed. *"Teams chat retention set to
   1 year rather than the 7-year records period, citing Records schedule §4.2."* **Real
   today.** Rides on `msp_risk_decisions`, the same table and the same rows as the Risk
   Register (#1487). Sub-issues #1525–#1529.
2. **Policy Engine** — proactive, declarative, no obligation, no signature. *"Mailbox size
   150MB." "VIP → extra spam filtering + these groups."* **Fully unbuilt.** No table, no
   route, no wire type, zero references anywhere in `lib/db/src/schema/` or
   `artifacts/api-server/src`. Sub-issues #1547–#1553.

Backend routes: `artifacts/api-server/src/routes/portal-risk-register.ts`,
`artifacts/api-server/src/routes/portal-compliance-obligations.ts`
Portal wire/model files (path stale — `artifacts/msp-portal` was retired for
`artifacts/portal` in `f40438cdc`, #1921; none of these were carried over and none
exist in `artifacts/portal` today): `artifacts/portal/src/components/portal-v2/riskRegisterWire.ts`,
`riskRegisterLive.ts`, `policyDecisionsData.ts`, `policyDecisionsModel.ts`,
`complianceObligationsWire.ts`, `complianceObligationsLive.ts`
Schema: `lib/db/src/schema/msp.ts` (`mspRiskDecisionsTable`, `complianceFrameworksTable`,
`complianceObligationsTable`, `tenantComplianceScopeTable`, `mspSopsTable`,
`mspSopRunsTable`, `monitorChecksTable`)

---

## 0. The table-name error this pack corrects (#1529)

#1490's own original issue body lists `policy_rules`, `policy_rule_firings`,
`policy_rule_audit_log`, `policy_rule_suppressions`, `policy_rule_incidents` as this
module's backing tables. **Verified wrong, by direct schema read.** Those five are defined
at `lib/db/src/schema/index.ts:3682-3763` — `conditionType: "signal" | "score_threshold"`,
`scoreThreshold`, `cooldownMinutes`, `escalationRules` — **alert-engine machinery** (the
customer-tenant alert engine, #1279), keyed to `mspId`/`customerId`/`ruleId`. Nothing in the
portal reads them as a policy decision, and grepping `artifacts/msp-portal/src` (the path
at pack time; retired for `artifacts/portal` in `f40438cdc`, #1921 — re-grepping
`artifacts/portal/src` today still returns zero matches) for any of
those five table names returns zero matches. The name collision is coincidental. Do not
build against these tables for this module.

The real table is `mspRiskDecisionsTable` → `msp_risk_decisions`
(`lib/db/src/schema/msp.ts:3928-4040`).

---

## 1. Wire contract — Policy Decisions (CURRENT, real)

### 1.1 `GET /api/portal/policy-decisions`

Route: `portal-risk-register.ts:314-343`. Scoped `(mspId, tenantId)` pair via
`resolveTenantScope` (`portal-risk-register.ts:263-276`), `requireRole("CustomerUser")`
floor — higher than the epic's usual `Assessment` floor, because the underlying row carries
a dollar liability figure and a signature surface (`portal-risk-register.ts:36-49`).
Filtered server-side to rows that ARE a policy decision — `decision_state` non-empty
(`:334-336`) — because a raw liability acceptance with no policy position recorded is a
risk, not a documented decision (`:306-312`'s own comment).

```ts
// portal-risk-register.ts:148-163 — WirePolicyDecision
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
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
}
```

Built by `toWirePolicyDecision` (`:234-253`) from the real `mspRiskDecisionsTable` row:

| Wire field | DB column | Type | Nullable | Notes |
|---|---|---|---|---|
| `id` | `rbd_id` | `string` | no | |
| `state` | `decision_state` | `string \| null` | yes | real values: see §3 |
| `pillar` | `pillar` | `string \| null` | yes | free text, not an FK |
| `title` | `title` | `string` | no | |
| `obligation` | `obligation` | `string \| null` | yes | free text — see §5's #1525 flag |
| `owner` | `owner` | `string \| null` | yes | display name |
| `ownerId` | `owner_id` | `string \| null` | yes | RACI person key (`msp.ts:3985`) |
| `approved` | derived | ISO string or `null` | — | `acceptedAt` (real signature timestamp) if set, else `clientApprover.signedAt` (MSP-side display string) — `toWirePolicyDecision:246` |
| `review` | `review_date` | `string \| null` | yes | display copy, e.g. "27 Aug 2026" — **not a real date type**, see §5 |
| `register` | `register_ref` | `string \| null` | yes | e.g. `RR-2026-014` |
| `rationale` | `rationale` | `string \| null` | yes | |
| `compensating` | derived | `string \| null` | — | joined sentence from `compensating_controls` jsonb array (`compensatingSentence`, `:183-186`) |
| `check` | `verification_note` | `string \| null` | yes | "Where it stands today" copy |

Response shape: `{ decisions: WirePolicyDecision[] }` (`:333-337`). Nulls are served as
nulls — the route never invents a plausible value (`portal-risk-register.ts:61-65`).

### 1.2 The client-side normalisation

`riskRegisterWire.ts:70-187`. `toPolicyDecision` (`:171-187`) maps `WirePolicyDecision` →
the page's `PolicyDecision` type (`policyDecisionsData.ts:29-42`): every null text field
becomes the literal string `"Not recorded"` (`NOT_RECORDED`, `riskRegisterWire.ts:32,88-91`)
— never a fabricated value. `state` is normalised through `decisionState()`
(`:166-169`), which **falls back to `"proposed"` for any unrecognised value** — a
deliberate choice: dropping the row would hide a real decision because of a bad enum value,
which the comment calls worse than showing it in the lane that claims the least.

### 1.3 `POST /api/portal/risk-register/:rbdId/accept` — real, live, tested, but see §6

`portal-risk-register.ts:364-515`. Typed-name + checkbox acceptance, permanent (409 on
replay, guarded UPDATE on `acceptedAt IS NULL`, `:456-479`). Covered by
`portal-risk-register.test.ts`. This is the **only real write path** on the whole
`msp_risk_decisions` table reachable from the customer portal. **§6 covers why Policy
Decisions' own "Sign it off" button does not call it today.**

```ts
// portal-risk-register.ts:358-362
const acceptSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  confirmed: z.literal(true),
  statement: z.string().trim().min(1).max(2000),
});
```

### 1.4 The three consumers

All three portal-v2 pages read the identical endpoint through the identical hook
(`usePolicyDecisions`, `riskRegisterLive.ts:129-158`) — there is one register, read three
ways:

| Page | What it shows |
|---|---|
| `portal-v2-policy-decisions.tsx` | Operate → Policy Decisions. All decisions, filterable by state, four action buttons (§6). |
| `portal-v2-compliance.tsx:172-182` | The Compliance pillar's "decisions on record" strip — same rows, client-side filtered to `pillar === "compliance"`. `null` (not `0`) while loading/erroring, so the strip never asserts a false count (`:176-182`). |
| `portal-v2-compliance-decisions.tsx:47-51` | The Compliance pillar's full drill-down — same rows, same client-side pillar filter, rendered expanded rather than as a filterable queue. |

---

## 2. Wire contract — Compliance Obligations (CURRENT, real, adjacent surface)

Not named in #1490's issue body, but it is the **only real obligation catalog that exists
in this codebase today** and is directly load-bearing for #1525's open question (§5.1).
Included because Design needs it to answer "which obligations does this tenant know about."

### 2.1 `GET /api/portal/compliance-obligations`

Route: `portal-compliance-obligations.ts:73-184`. `requireRole("Assessment")` floor — lower
than Policy Decisions', because this page carries no liability dollar figure (`:35-38`).

```ts
// portal-compliance-obligations.ts:60-67 — WireObligation
interface WireObligation {
  readonly framework: string;         // the obligation's OWN citation, not the framework name
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;             // derived, human-readable
  readonly tone: "red" | "amber" | "green" | "slate";
}
```

**State/tone are computed live at read time, never stored** (`:9-14`, Git #1256 sign-off
option A): the route joins the tenant's in-scope catalog obligations to its own open
`msp_risk_decisions` findings, matched by a case-insensitive trimmed string match between
`compliance_obligations.citation` and `msp_risk_decisions.obligation` (`:16-23`) — **this is
the one place in the codebase where a policy decision's free-text `obligation` field is
already treated as a join key against a real catalog**, which is exactly what #1525 asks
for structurally, just not yet formalised as a foreign key.

### 2.2 The real catalog, verified live (2026-08-29)

```sql
-- lib/db/src/schema/msp.ts:267-325
complianceFrameworksTable   -- global regime catalog, seeded once, shared across all tenants
complianceObligationsTable  -- specific clause/citation within a framework, FK -> framework
tenantComplianceScopeTable  -- per-(tenant,framework) in/out-of-scope decision + audit
```

Queried directly against the local Postgres instance (`shanemccawmsp`), not asserted from
code:

| Table | Real row count | Notes |
|---|---|---|
| `compliance_frameworks` | 5 | `sox`, `sec-finra`, `gdpr`, `hipaa`, `pci-dss-v4` |
| `compliance_obligations` | 7 | see below |
| `tenant_compliance_scope` | **0** | no tenant has ever made an onboarding scope decision — every framework falls back to `default_in_scope` (`portal-compliance-obligations.ts:145`) |

```
sox         · SOX §802 · 17 CFR 210.2-06
sec-finra   · SEC 17a-4(f) · FINRA 4511
gdpr        · GDPR Art. 5(1)(e) · Art. 32
gdpr        · GDPR Art. 15 · subject access
hipaa       · HIPAA §164.316(b)(2)(i)
gdpr        · GDPR Art. 30 · records of processing
pci-dss-v4  · PCI DSS v4.0
```

**Directly relevant to #1525's open question:** one of the design's four sample obligations
— `GDPR Art. 5(1)(e)` (CMP-A1) — **already exists verbatim in the platform-seeded
catalog.** The other three do not: no ISO 27001 entry, no cyber-insurance-schedule entry, no
internal-records-schedule entry anywhere in `compliance_frameworks`/`compliance_obligations`.
That is real evidence, not a guess, for the shape #1525 is asking about — see §5.1. **This
pack flags it, per this module's standing instruction, and does not resolve it.**

---

## 3. Real enum unions

```
mspRiskDecisionsTable.decisionState:  proposed | live | due | expired
  (lib/db/src/schema/msp.ts:4010 comment: "Policy Decisions' own four-state
   lane: proposed / live / due / expired"; enforced client-side at
   riskRegisterWire.ts:158,166-169; DISPLAY labels differ from the raw value —
   policyDecisionsData.ts:144-149:
     proposed -> "Awaiting sign-off"   ("raised, not yet a decision")
     live     -> "Live"                ("signed, in date, control holding")
     due      -> "Due for review"      ("the date has passed")
     expired  -> "Expired"             ("reads as neglect until renewed")
   An unrecognised raw value falls back to "proposed" — riskRegisterWire.ts:166-169.)

mspRiskDecisionsTable.status:         pending_signature | active | expired | revoked
  (the ACCEPTANCE's own state, portal-risk-register.ts:68-69 — a DIFFERENT
   lifecycle from decisionState above; see §5.2)

mspRiskDecisionsTable.riskStatus:     Open | Mitigating | Accepted | Closed | Expired
  (the RISK's own state, portal-risk-register.ts:70-72 comment; reused verbatim
   by portal-compliance-obligations.ts:55's OPEN_RISK_STATUSES = Open |
   Mitigating | Expired)

complianceObligationsWire.tone:       red | amber | green | slate
  (portal-compliance-obligations.ts:57-58)

tenantComplianceScopeTable.source:    onboarding | manual | advisor
  (lib/db/src/schema/msp.ts:313)
```

**No enum exists anywhere for the Policy Engine object** — no `policy_target_state`, no
`vip_source`, no `enactment_status`. There is nothing to extract because nothing is built;
do not invent one for Design. See §7.

---

## 4. Field status — CURRENT vs DECIDED

Every `DECIDED` row below cites the issue that settled it. A row with no issue number is
not on this table — it would be an invented requirement, which this pack exists to prevent.

| Surface | Field / behavior | Status | Issue |
|---|---|---|---|
| Policy Decisions | `WirePolicyDecision` fields — `id`/`state`/`pillar`/`title`/`obligation`/`owner`/`ownerId`/`approved`/`review`/`register`/`rationale`/`compensating`/`check` | CURRENT | — |
| Policy Decisions | Read endpoint scoped, tested, wired to all 3 consumer pages | CURRENT | — |
| Policy Decisions | `decisionState` real values `proposed \| live \| due \| expired` | CURRENT | — |
| Policy Decisions | `EXPIRED` as a decision state | **CURRENT but WRONG — must be removed.** An acceptance is a signed fact and does not expire; only the review lapses. Replace with a review-state flag on a decision that stays `live`. | #1507, #1527 |
| Policy Decisions | Record / Sign off / Renew / Withdraw actions | **UI-only.** All four open the shared `FormDrawer` and record nothing — `portal-v2-policy-decisions.tsx:20-22` states this in its own header. No backing endpoint exists for record/renew/withdraw at all. | #1528 (blocks the write-path decision) |
| Policy Decisions | "Sign it off" reusing the real, already-built `POST .../accept` endpoint | **Not wired**, though the endpoint exists and is tested. Field-shape mismatch to resolve first. | #1618 (filed this pack, §6), blocked on #1528 |
| Policy Decisions | Shared table (`msp_risk_decisions`) as the permanent model vs. a projection to unwind | **Undecided — blocks the Design requirements doc.** No create path starts from "we decided X" today; only from a raised finding. | #1528 |
| Policy Decisions | Obligation as a typed, first-class reference (type: regulation / certification / contract / insurance / internal schedule + per-tenant applicability) | DECIDED — to build | #1525 (see §5.1: whether the source is platform-seeded, customer-specific, or both is **OPEN, flagged not resolved**) |
| Policy Decisions | Dependency-based clearance (a decision that clears when a condition resolves, not on a date) | DECIDED — to build; a third clock, distinct from the acceptance clock (#1507) and the review clock | #1526 |
| Policy Decisions | Table-name correction (`policy_rules*` is NOT this module) | DECIDED, verified in this pack (§0) | #1529 |
| Compliance Obligations | `WireObligation` fields, live join to `msp_risk_decisions` | CURRENT | — |
| Compliance Obligations | Catalog is real, platform-seeded, 5 frameworks / 7 obligations | CURRENT, verified live (§2.2) | — |
| Compliance Obligations | `tenant_compliance_scope` per-tenant decisions | CURRENT as a table; **zero rows exist** — every tenant is currently on the `default_in_scope` fallback | CURRENT (genuinely empty, not broken) | — |
| Policy Engine | Standing policy as a second, declarative object (no obligation, no finding, no signature) | DECIDED — **fully unbuilt.** No table, no route, no type. | #1547 |
| Policy Engine | SOP is the enactment mechanism; the engine never executes directly | DECIDED — depends on #1493 (SOPs, not yet architected) allowing policy-triggered runs, not only human-triggered ones. `msp_sop_runs.operator` is `text NOT NULL` today (`msp.ts:3882`) with no `origin`/`triggeredBy` column to distinguish a policy-triggered run from a human one. | #1548 |
| Policy Engine | Continuous evaluation (event + divergence triggers), visible Workflow Engine node, opt-in default-off per customer | DECIDED — unbuilt. Real Workflow Engine node precedent exists (`portal-workflow-engine.ts`, `portal-workflow-nodes.ts`) to build against; no policy-specific node exists yet. | #1549 |
| Policy Engine | A policy is a standard-change catalog item; approving the policy approves its enactments; each enactment still produces a real auto-approved CR | DECIDED — depends entirely on Change Control's own unbuilt machinery (#1496, #1497, #1498) | #1550 |
| Policy Engine | Write-consent-denied tenants get a checklist-item enactment shape instead of an auto-approved CR (the NASA case) | DECIDED — the write-consent detection this depends on is CURRENT and real: `tenants.consent.writeBack.status`, enforced fail-closed at `graph.ts:1039-1045` (`WriteConsentRequiredError`), also checked at `config-pack-orchestrator.ts:399-405` (`customer_write_consent_missing`). The Policy Engine's own consumption of it is unbuilt. | #1551, depends on #1539, #1540 |
| Policy Engine | VIP classification — platform is authoritative, not the tenant; tenant-side group/attribute are read-only discovery hints | DECIDED (resolved 2026-08-28, inverting the issue's own original open question) | #1552 |
| Policy Engine | Policy non-compliance as a finding source with no Microsoft baseline behind it | DECIDED — depends on #1538 (checklist items), #1540 | #1553 |
| Policy Engine | OU as the attachment point for a policy (container -> target-state map) | DECIDED, and the scaffolding is **already in the codebase, explicitly reserved for this** — `active-directory.ts:515-520`: "A real, creatable/browsable OU container node — genuinely persisted, but with NO policy enforcement logic. Policy semantics are explicitly undefined per Shane, reserved for a future version." | #1547 |

---

## 5. Two things flagged, not resolved

Per this module's standing instruction: an open architectural question gets a table row and
real evidence, not an invented answer.

### 5.1 #1525 — is the obligation source platform-seeded, customer-specific, or both?

**Flagged, not resolved, per explicit instruction on this pack.** §2.2's live data is the
real evidence for whichever way this goes:

- The existing `compliance_frameworks`/`compliance_obligations` pair is **already
  platform-seeded, global, shared across every tenant** (`lib/db/src/schema/msp.ts:266`:
  "reference data seeded once, shared across all tenants") — and it already covers one of
  the design's four sample obligations verbatim (GDPR Art. 5(1)(e)).
- It does **not** cover the other three: no ISO 27001 control, no cyber-insurance-schedule
  entry, no internal-records-schedule entry. Those three are inherently customer-specific —
  an insurance schedule and a records schedule are documents a specific tenant holds, not a
  universal regime.
- The existing per-tenant layer (`tenant_compliance_scope`) only decides **whether** a
  platform-seeded framework applies to a tenant (`inScope: boolean`) — it has no mechanism
  today for a tenant to hold an obligation the platform never seeded at all.

Whether #1525's answer is "extend the existing global catalog with a `scope: platform |
customer` column" or "keep the global catalog for regulations/certifications and add a
separate customer-obligation table for contracts/insurance/internal schedules" is Shane's
call. This pack states the real shape of what already exists and stops there.

### 5.2 The `status` / `riskStatus` / `decisionState` three-clock problem

Not a numbered sub-issue on its own, but worth stating plainly for Design because all three
independently-nullable text columns live on the same row and none of them agree with each
other by construction:

- `status` — the acceptance's own lifecycle: `pending_signature | active | expired |
  revoked` (`portal-risk-register.ts:68-69`).
- `riskStatus` — the risk's own lifecycle: `Open | Mitigating | Accepted | Closed | Expired`
  (`:70-72`).
- `decisionState` — Policy Decisions' own four-state lane: `proposed | live | due |
  expired` (§3).

A row can be `riskStatus: "Mitigating"` with no acceptance at all, and `status: "revoked"`
while `riskStatus` still reads `"Open"` (`portal-risk-register.ts:70-72`'s own comment).
**Design must not assume these three ever collapse to one state machine** — they are read
independently by three different surfaces (Risk Register renders `status`/`riskStatus`,
Policy Decisions renders only `decisionState`).

---

## 6. The live-endpoint-not-called gap, filed this pack

Per this module's standing sub-issue-at-pack-time convention: **#1618**, filed and linked as
a sub-issue of #1490.

`POST /api/portal/risk-register/:rbdId/accept` is real, live, tested, and is the acceptance
write path for the exact table Policy Decisions renders. The Risk Register page's own
acceptance panel already calls it end to end. **Policy Decisions' "Sign it off" button does
not** — it opens the shared `FormDrawer` and records nothing
(`portal-v2-policy-decisions.tsx:153-166`, header comment `:20-22`). Filed rather than
silently left as a note, per this module's own pack-time convention (the #1601–#1604
precedent on #1485). Its body records the real field-shape mismatch between the accept
endpoint's schema (`fullName`/`confirmed`/`statement`) and the Sign-off form's fields
(`owner`/`review`/`control`), and explicitly blocks the fix on #1528 rather than building
ahead of that open write-path decision.

---

## 7. Forbidden list

There is no dedicated `portal-pii-governance.ts`-style "why this can't be served" route for
either surface in this pack — both routes serve real data with no undeliverable fields. The
one genuine "forbidden" declaration is structural, not a route comment: **Policy Engine has
nothing to be forbidden from serving, because nothing about it exists.** Grepping
`lib/db/src/schema/` and `artifacts/api-server/src` for `vip`, `standing_policy`,
`policy_engine`, or `target_state` returns zero matches. There is no route to write a
"deliberately does NOT serve" comment on. **Every Policy Engine row in §4 is `DECIDED —
unbuilt`, not a forbidden field on a real route** — Design should treat the whole object as
absent, not as a route with gaps.

The one real precedent for this pack's own honesty discipline, per #1577's instruction to
include it: `portal-pii-governance.ts:32` ("What this route deliberately does NOT serve") —
the design fixture's per-document findings, named sources, matched patterns, access matrix
and drift feed have no collected backing, and the route says so explicitly rather than
serving a plausible-looking substitute. This pack's §4 DECIDED-unbuilt rows are this
module's equivalent statement for an object with no route at all.

**One inconsistency worth flagging, not filing:** `complianceObligationsLive.ts:58-64`'s
hook still exposes a `dataState: "fixture"` fallback to `CMP_OBLIGATIONS` on fetch failure —
but the page that consumes it never renders that fallback (`portal-v2-compliance-obligations.tsx:44`:
`rows = dataState === "live" ? obligations : []`). Dead code path, not a user-visible
fixture leak — no sub-issue filed, noted here so a future pass doesn't rediscover it as new.

---

## 8. Honest-empty contract

`msp_risk_decisions` carries exactly **one row today**, verified by direct query against the
local Postgres instance: `rbd_id = RBD-2026-575`, `tenant_id = 'contoso-01'` (a
non-resolvable synthetic tenant id, matching `portal-risk-register.ts:31-34`'s own comment
about this), `decision_state` is **blank**, `status = 'pending_signature'`. Because
`GET /portal/policy-decisions` filters to non-empty `decision_state` (§1.1), **the real,
live response for the testbed tenant today is `{ decisions: [] }`** — genuinely empty, not a
read failure.

The honest tri-state, as actually implemented:

- **loading** — `usePolicyDecisions()`'s `loading: true` until the first response, success
  or failure (`riskRegisterLive.ts:132,149`). The page renders `"Loading your policy
  decisions…"` (`portal-v2-policy-decisions.tsx:292`).
- **live-genuinely-empty** — fetch succeeded, `decisions: []`. The page renders zero rows
  and all-zero counter cards with no error banner. This is the testbed tenant's real
  current state, verified above.
- **read-failed** — fetch threw or returned non-2xx; `error` is set to the real message
  (`riskRegisterLive.ts:145-148`). The page renders `"Your policy decisions could not be
  loaded, so this page is not showing your current positions."`
  (`portal-v2-policy-decisions.tsx:277-294`) — distinct copy from the empty state, so a
  reader cannot mistake "nothing to show" for "we don't know."

Compliance Obligations' hook (`complianceObligationsLive.ts:57-64`) collapses **loading**
and **read-failed** into one `dataState: "fixture"` bucket internally (`obligations ??
CMP_OBLIGATIONS`), which does not match this pack's tri-state — but §7 already establishes
the page itself never renders that fallback, so the tri-state the page actually shows the
user is intact; only the hook's internal naming is imprecise.

---

## 9. Cross-surface edges

- `msp_risk_decisions.obligation` ↔ `compliance_obligations.citation` — case-insensitive
  string match, the live join described in §2.1. The only real cross-table edge on this
  surface today; not a foreign key.
- `msp_risk_decisions.check_key` — the `monitor_checks.key` a decision was raised against,
  when raised from an automated finding rather than authored free-standing
  (`lib/db/src/schema/msp.ts:3938-3946`). NULL is the common case today (nothing sets it
  outside a direct API call). The customer-tenant alert engine (#1279) suppresses re-firing
  for a finding only when this is populated AND `status = 'active'`.
- `msp_risk_decisions.register_ref` — the register entry number (`RR-2026-014` style),
  shared display key between the acceptance record and both pages.
- `msp_risk_decisions.pillar` — free text, client-side filtered by both compliance pillar
  pages (`=== "compliance"`, case-insensitive) and presumably every other pillar page that
  reads this register (Governance/Security drop panels, per `riskRegisterLive.ts:12-18`'s
  header — those still read the design fixture, not this live endpoint, and are out of this
  pack's scope).
- **Policy Engine → SOPs edge, DECIDED not built (#1548):** `msp_sops`/`msp_sop_runs`
  (`lib/db/src/schema/msp.ts:3840-3901`) would become the enactment record for a
  policy-triggered run, distinguished from a human-triggered one only by a not-yet-existing
  `origin`/`triggeredBy` column on `msp_sop_runs` (today `operator: text NOT NULL`, no such
  column).
- **Policy Engine → Change Control edge, DECIDED not built (#1550):** a policy enactment
  would produce "a real auto-approved CR" — Change Control's own catalog-item/approval
  machinery (#1496–#1498) does not exist in code yet either; this pack does not re-extract
  that module's contract, only records the dependency.

---

## Appendix — files read for this pack

- `artifacts/api-server/src/routes/portal-risk-register.ts`
- `artifacts/api-server/src/routes/portal-compliance-obligations.ts`
- `artifacts/api-server/src/routes/msp-rbd.ts`
- `artifacts/api-server/src/routes/portal-pii-governance.ts` (forbidden-list precedent only, §7)
- `artifacts/api-server/src/lib/active-directory.ts` (OU scaffolding, §4)
- `artifacts/api-server/src/lib/graph.ts` (write consent, §4)
- `artifacts/api-server/src/lib/config-pack-orchestrator.ts` (write consent, §4)
- (paths below are as of pack time, under the retired `artifacts/msp-portal` — renamed to
  `artifacts/portal` in `f40438cdc`, #1921; none of these files were carried over and none
  exist in `artifacts/portal` today)
- `artifacts/portal/src/components/portal-v2/riskRegisterLive.ts`
- `artifacts/portal/src/components/portal-v2/riskRegisterWire.ts`
- `artifacts/portal/src/components/portal-v2/policyDecisionsData.ts`
- `artifacts/portal/src/components/portal-v2/policyDecisionsModel.ts`
- `artifacts/portal/src/components/portal-v2/complianceObligationsLive.ts`
- `artifacts/portal/src/components/portal-v2/complianceObligationsWire.ts`
- `artifacts/portal/src/pages/portal-v2-policy-decisions.tsx`
- `artifacts/portal/src/pages/portal-v2-compliance.tsx`
- `artifacts/portal/src/pages/portal-v2-compliance-decisions.tsx`
- `artifacts/portal/src/pages/portal-v2-compliance-obligations.tsx`
- `lib/db/src/schema/msp.ts` (`mspRiskDecisionsTable`, `complianceFrameworksTable`,
  `complianceObligationsTable`, `tenantComplianceScopeTable`, `mspSopsTable`,
  `mspSopRunsTable`, `monitorChecksTable`)
- `lib/db/src/schema/index.ts` (`policyRulesTable` and siblings, verified NOT this module — §0)
- Direct query, local Postgres (`shanemccawmsp`): `msp_risk_decisions`,
  `compliance_frameworks`, `compliance_obligations`, `tenant_compliance_scope`, `msp_sops`,
  `msp_sop_runs`, `policy_rules` row counts and real values, 2026-08-29
- GitHub: #1490 (+ both architecture comments), #1485, #1577, #1578, #1525–#1529,
  #1547–#1553, #1507, #1618 (filed this pack)

# Security Plan — contract extraction pack for Claude Design

**#1495** (Portal New Design: Security Plan), following the method fixed by **#1577**
(contract extraction pack, run per module as step 3 of **#1578**), under **#1485**
(EPIC: Portal New Design). Sub-issues **#1561–#1568**.

Read-only. Every field below is extracted verbatim from the route's own `Wire*` interface and
the Drizzle schema, cited to file:line. **Nothing here is authored or invented.** No product
code, no schema changes, no UI, no `drizzle-kit push`.

**This pack is unlike its five siblings in one important way.** Change Control (#1486), Risk
Register (#1487) and Microsoft Changes (#1494) each extract a contract that is *becoming* more
correct. Security Plan extracts a contract that is **structurally the wrong shape** — a real,
live, admin-authored plan-of-record built *before* the architecture settled underneath it, and
the settled architecture (#1495's 2026-08-28 comment, sub-issues #1561–1567) describes a
**different kind of artifact entirely**: not a hand-typed narrative, but a view **assembled**
from the other eight modules plus authored prose, frozen and sealed as versions. Both are true
at once and neither should be papered over: §1 extracts what exists; §2 states plainly that it
is not the same thing #1561 describes.

Backend route: `artifacts/api-server/src/routes/portal-security-plan.ts` (customer-scoped, GET only)
Schema: `lib/db/src/schema/msp.ts:4545-4684` (`portal_security_plans` + 3 child tables)
Seed migration: `lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql`
Portal wire/model/live files: `artifacts/msp-portal/src/components/portal-v2/securityPlanWire.ts`,
`securityPlanModel.ts`, `securityPlanLive.ts`, `securityPlanData.ts` (design-reference-only fixture)
Page: `artifacts/msp-portal/src/pages/portal-v2-security-plan.tsx`

---

## 0. The one surface and its consumer

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/security-plan` | GET | `portal-security-plan.ts:109-212` | `useSecurityPlan` (`securityPlanLive.ts:104-174`) → `portal-v2-security-plan.tsx` | No |

**No orphaned live endpoint in this module.** The single customer-scoped endpoint is fully
consumed — every field in `WireSecurityPlanPayload` (tenant, env, tier, version, updated,
approver, owner.initials, owner.tone, every section, every row, every history entry) is read and
rendered by the page (`portal-v2-security-plan.tsx:168-625`). Per #1577 / the #1485 standing
convention, **no sub-issue is filed** for this module — there is nothing orphaned to file for.

There is deliberately **no POST/PATCH/DELETE** on this route (`portal-security-plan.ts:16-24`):
the plan is authored by the MSP through the manual migration, not through the portal. This is a
genuine, current product decision, not a gap — see §9.

---

## 1. Wire contract — what exists today (CURRENT)

`GET /api/portal/security-plan` reads `portalSecurityPlansTable` and its three child tables
(`msp.ts:4575-4684`), scoped to the caller's own `customerId` (`portal-security-plan.ts:113,
123`, a direct `tenants.id` equality — no `(mspId, tenantId)` pair, because nothing here reads
an MSP-era table; `:26-30`).

```ts
// portal-security-plan.ts:91-107 — WireSecurityPlan / WireSecurityPlanPayload (verbatim)
interface WireSecurityPlan {
  readonly tenant: string;
  readonly env: string;
  readonly tier: string;
  readonly version: string;
  readonly updated: string;
  readonly approver: string;
  readonly owner: { readonly initials: string; readonly tone: string };
  readonly sections: readonly WireSecPlanSection[];
  readonly history: readonly WireSecPlanVersion[];
}
interface WireSecurityPlanPayload {
  readonly plan: WireSecurityPlan | null;   // null = this customer has none authored yet
}
```

### 1.1 Plan header

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `tenant` | `tenant` (`msp.ts:4580`) | text, notNull | no | CURRENT — authored label, not a live tenant-name join |
| `env` | `env` (`msp.ts:4582`) | text, notNull | no | CURRENT — authored, e.g. "Production" |
| `tier` | `tier` (`msp.ts:4584`) | text, notNull | no | CURRENT — authored, e.g. "Enhanced" |
| `version` | `version` (`msp.ts:4586`) | text, notNull | no | CURRENT — authored string, e.g. "v4.2"; **not** the versioning model #1562 describes (§2) |
| `updated` | `updated_label` (`msp.ts:4588-4592`) | text, notNull | no | CURRENT — a display string typed as authored ("19 August 2026"), not a timestamp |
| `approver` | `approver` (`msp.ts:4594`) | text, notNull | no | CURRENT — authored name + title; **not** the same thing as the signature-to-scope model #1564 leaves open (§2, §7) |
| `owner.initials` | `owner_initials` (`msp.ts:4596`) | text, notNull | no | CURRENT |
| `owner.tone` | `owner_tone` (`msp.ts:4598`) | text, notNull | no | CURRENT — hex colour for the header chip |

### 1.2 Section — `WireSecPlanSection`

```ts
// portal-security-plan.ts:72-79 — verbatim
interface WireSecPlanSection {
  readonly k: string;       // stable key, e.g. "governance"
  readonly n: string;       // two-digit display number, e.g. "02" — a label, not an int
  readonly label: string;
  readonly lead: string;
  readonly rows: readonly WireSecPlanRow[];
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `k` | `section_key` (`msp.ts:4614`) | text, notNull | CURRENT |
| `n` | `number` (`msp.ts:4616`) | text, notNull | CURRENT |
| `label` | `label` (`msp.ts:4619`) | text, notNull | CURRENT |
| `lead` | `lead` (`msp.ts:4620`) | text, notNull | CURRENT |
| `rows` | joined from `portal_security_plan_rows` by `section_id`, ordered by `position` | — | CURRENT |

### 1.3 Requirement row — `WireSecPlanRow`

```ts
// portal-security-plan.ts:64-70 — verbatim
interface WireSecPlanRow {
  readonly req: string;
  readonly state: string;      // met | partial | gap
  readonly detail: string;
  readonly to: string;         // a portal-v2 route path
  readonly toLabel: string;
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `req` | `req` (`msp.ts:4638`) | text, notNull | CURRENT — **hand-typed prose**, not derived from any control/policy/risk row |
| `state` | `state` (`msp.ts:4640`) | text, notNull, enum `met\|partial\|gap` | CURRENT — **hand-typed judgment**, not computed from a real check/finding (see §2, §6) |
| `detail` | `detail` (`msp.ts:4642`) | text, notNull | CURRENT — hand-typed |
| `to` | `to_route` (`msp.ts:4644-4648`) | text, notNull | CURRENT — a **navigation link**, stored verbatim; the page's own `LIVE_ROUTES` set (`portal-v2-security-plan.tsx:60-74`) decides at render time whether it is clickable. This is the only place the row touches another module, and it is a link, not a data join (§2). |
| `toLabel` | `to_label` (`msp.ts:4650`) | text, notNull | CURRENT |

### 1.4 Version history entry — `WireSecPlanVersion`

```ts
// portal-security-plan.ts:82-88 — verbatim
interface WireSecPlanVersion {
  readonly v: string;
  readonly when: string;
  readonly who: string;
  readonly what: string;
  readonly cr: string;
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `v` | `version` (`msp.ts:4668`) | text, notNull | CURRENT — authored version label |
| `when` | `when_label` (`msp.ts:4670`) | text, notNull | CURRENT — display string, not a timestamp |
| `who` | `who` (`msp.ts:4672`) | text, notNull | CURRENT — hand-typed name |
| `what` | `what` (`msp.ts:4674`) | text, notNull | CURRENT — hand-typed change description |
| `cr` | `cr` (`msp.ts:4676`) | text, notNull | CURRENT — a **display string** of a CR code (e.g. "CR-0131"), rendered as a button that navigates to `/portal-v2/change-control` (`portal-v2-security-plan.tsx:603-620`) but **carries no `change_request_id` FK** — it is not joined to `mspChangeRequestsTable`. Compare to the real edge `portal_hold_window_events.change_request_id` the Change Control pack documents; this one is text-only. |

**Derived, not served (client-side only, `securityPlanModel.ts`):** the header verdict
(`spVerdict`), the met percentage (`spPct`), the per-section gap count (`spSectionGaps`), and the
met/partial/gap tallies (`spCounts`) are all computed from `rows` at render time — deliberately
not duplicated server-side, "a plan that could disagree with itself defeats its own claim"
(`portal-security-plan.ts:37-42`). This part of the architecture (derive, don't store a copy) is
consistent with, and should carry forward into, the assembled-view model §2 describes.

---

## 2. What this module actually owns vs. what the settled architecture says it should own

**#1561 (settled 2026-08-28) says:** "This is not a tenth module. It is a VIEW over the other
eight, plus authored prose. It owns almost no data of its own" — contributions come from Policy
Engine (#1490), Risk Register (#1487), Ownership/RACI (#1491), SOPs/Runbooks (#1493),
Remediation (#1489), Change Control (#1486), and Microsoft Changes (#1494); this module owns only
the authored prose and the version records.

**What is actually built today owns 100% of its own data**, not "almost none". Every requirement
row's `req` / `state` / `detail` is typed directly into the four `portal_security_plan*` tables
by the manual migration (`2026-08-21-portal-v2-security-plan.sql`) — there is **no read from any
of the eight modules' own tables anywhere in `portal-security-plan.ts`**. The `to` / `toLabel`
pair on each row is a navigation hint, not a data join: clicking it *sends the reader* to, say,
Ownership, but the row's `state` ("met"/"partial"/"gap") was never computed from an Ownership
row — it was typed by whoever authored the migration, at the same time as the prose.

This is not a bug to fix in this read-only pass — it is the honest gap this pack exists to
surface. The schema/route/page shipped **before** #1495's architecture comment settled (migration
dated 2026-08-21; the comment settling "view, not tenth module" is dated 2026-08-28), so the
current build reflects an earlier, simpler idea of the page ("port the fixture to a real table")
rather than the assembled-view design decided afterward. Concretely:

| What #1561 says this module should do | What is actually built |
|---|---|
| Assemble `state` per requirement from real data in the owning module | `state` is a hand-typed enum value, no computation |
| `req`/`detail` describe a control whose real configuration lives in Policy Engine/Ownership/etc. | `req`/`detail` are free text with no FK to any owning table |
| Version = frozen assembled state + prose, sealed together (#1562) | `version`/`history` are hand-typed strings with no seal, no frozen snapshot, no signature capture |
| Signature attaches to a scope (#1564, open) | `approver`/`updated_label` are a single authored name + date string, not a signature record |
| Scope filtering, never findings filtering (#1563) | No filtering of any kind exists — the page renders the plan's rows unconditionally |
| Filter footprint on every generated artifact (#1565) | No export/generation path exists at all |
| Divergence flagging — data drift only, never prose staleness (#1567) | No comparison against underlying module state exists; nothing is flagged |

**Consequence for Design:** the current wire contract in §1 is real and can be extracted
verbatim, but it must not be presented to Design as "the Security Plan contract" without this
caveat — it is the *previous* model's contract, not the *settled* one's. Design should be handed
this pack expecting a rebuild of the assembly layer, not a wire job over what exists.

---

## 3. Real enum unions

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Requirement row state | `met`, `partial`, `gap` | `PORTAL_SECURITY_PLAN_ROW_STATE`, `msp.ts:4572-4573`; enforced as a Drizzle `text(...,{enum})` column, **not** a Postgres `pgEnum`/CHECK (`msp.ts:4566-4568` convention comment — deliberate, so the vocabulary can widen in code without a migration) | CURRENT, but see §2 — this three-value state is authored judgment, not a state the settled model has said how to derive |

No other enum-shaped field exists on this module's own tables. `tier`, `env`, `version` etc. are
free text, not constrained vocabularies.

---

## 4. Cross-surface edges — borrowed fields, named to their owning module

Per the task instruction, every field this view would need to *borrow* is named here against its
owning module, with that module's own CURRENT/DECIDED state as of this pack (2026-08-29) — not
invented for this pack. Where the owning module has already shipped its own contract pack, the
field names below are drawn from that pack directly (cited); where it has not, the field is named
off the Drizzle schema directly, marked per that module's own build status.

### 4.1 Policy Decisions + Policy Engine (#1490) — control declarations and their configuration

**Status: contract pack shipped while this pack was in flight** (`docs/policy-decisions-contract-pack.md`,
merged to `origin/main` at `d5e12127e`, landing after this pack's own investigation pass started —
its bookend, `build-journal/1490.md`, was still `⏳ IN FLIGHT` at last check). That pack itself
corrects #1490's own original issue body: the module is **two objects**, not one.

1. **Policy Decisions** — reactive, obligation-bound, signed. **Real today.** Rides on the same
   `mspRiskDecisionsTable` rows as Risk Register (#1487), filtered to non-empty `decision_state`
   (`portal-risk-register.ts:306-336`) — not a separate schema.
2. **Policy Engine** — proactive, declarative, no obligation, no signature (e.g. "mailbox size
   150MB", "VIP → extra spam filtering"). **Fully unbuilt** — "no table, no route, no wire type,
   zero references anywhere in `lib/db/src/schema/` or `artifacts/api-server/src`"
   (policy-decisions-contract-pack.md §intro). Also corrects a table-name error in #1490's
   original body: `policy_rules`/`policy_rule_*` are unrelated alert-engine tables (#1279), not
   this module (policy-decisions-contract-pack.md §0).

Security Plan would borrow:

| Field it would need | Owning table.column | Status |
|---|---|---|
| Control identity / obligation cited | `obligation` (`msp.ts:4006`, `WirePolicyDecision.obligation`) | CURRENT on Policy Decisions' own contract (policy-decisions-contract-pack.md §1.1); **not consumed by Security Plan today** |
| Declared configuration / documented deviation | `rationale` (`msp.ts:4004`), `compensating` (`WirePolicyDecision.compensating`) | CURRENT there; not consumed here |
| Decision lifecycle state | `decision_state` → `WirePolicyDecision.state` | **DECIDED-wrong** per Risk Register pack §5 / Policy Decisions pack — carries `expired`, must not be reused verbatim (#1527) |
| Proactive declarative control configuration (mailbox size, VIP routing, etc.) | — | **OPEN GAP / fully unbuilt** — Policy Engine half has no table, route, or wire type at all (#1547–1553); nothing exists yet for Security Plan to borrow from this half |

### 4.2 Risk Register (#1487) — carried risks, acceptances, review state

**Status: contract pack shipped** (`docs/risk-register-contract-pack.md`, DONE, merged
`14b5f2ac7`). Security Plan would borrow, per that pack's own field citations:

| Field it would need | Owning field (risk-register-contract-pack.md §) | Status |
|---|---|---|
| Whether a risk is carried/open | `WireRisk.status` (risk-register pack §1.1) | CURRENT there; not consumed here |
| Acceptance record (who, when, statement) | `WireRisk.accepted` (§1.2) | CURRENT there; not consumed here |
| Review state / overdue flag | `review_date` (§1, marked **DECIDED-wrong** pending the acceptance/review clock split, #1507) | DECIDED — #1507; not built |
| Liability value | `liabilityValueUsd` (§1.1) | CURRENT there; not consumed here |

### 4.3 Ownership / RACI (#1491) — who is accountable for what

**Status: contract pack in flight** (`build-journal/1491.md`, not yet shipped as of this pack).
Named off the Drizzle schema directly since no `docs/ownership-raci-contract-pack.md` exists yet
to cite:

| Field it would need | Owning table.column | Status |
|---|---|---|
| Accountable/Responsible person per object | `portalOwnershipAssignmentsTable.ownerPersonId`, `.roleKey` (`msp.ts:4714-4739`) | CURRENT (schema exists, route serves it per #1491's own in-flight pack); not consumed here |
| Acceptance of an ownership assignment | `portalOwnershipAssignmentsTable.acceptance` (`msp.ts:4725`) | CURRENT; not consumed here |
| Delegated cover during absence | `portalOwnershipDelegationsTable` (`msp.ts:4750-4769`) | CURRENT; not consumed here |
| Role-based acceptance authority as the source for who may sign a scope | — | **DECIDED**, #1511 (Risk Register pack §4) and directly relevant to #1564 (§7 below) — not built |

### 4.4 SOPs / Runbooks (#1493 / #1488) — procedures that maintain each control

**Status: contract pack shipped while this pack was in flight** (`docs/sops-contract-pack.md`,
landed on `origin/main` alongside this pack's own merge). That pack's own §0 finding matters
directly to Security Plan: `msp_sops`/`msp_sop_runs` (definition + execution, correct shape) and
`portal_runbooks`/`portal_runbook_steps` (actually a **recurring review cycle**, not a procedure)
are being **unified** into one procedure-definition + one run-record model (#1556), with
recurrence becoming a schedule property rather than a row that gets wiped on cycle reset (fixing
#1557). Security Plan would borrow:

| Field it would need | Owning table.column | Status |
|---|---|---|
| Active runbook/procedure against a control area | `portalRunbooksTable.runbookKey`, `.pillar`, `.status` (`msp.ts:4362-4387`, enum `PORTAL_RUNBOOK_STATUS`) | CURRENT (schema, route both exist); not consumed here |
| Step completion / cycle progress | `portalRunbookStepsTable.checked`, `.checkedAt` (`msp.ts:4392-4416`) | CURRENT, but **DECIDED-wrong** — no run history; cycle reset wipes last cycle's completion (#1557), resolved by the unification (#1556) |
| SOP catalogue entry (definition, versioned) | `mspSopsTable` (`msp.ts:3840`) | CURRENT, MSP-scoped and versioned; sops-contract-pack.md §0 |
| A run record against a definition, with origin (`policy \| lifecycle \| remediation \| manual`) | `mspSopRunsTable` (`msp.ts:3873`) | **DECIDED, not built** — "no route writes `msp_sop_runs`" today (#1559); the unified run model is #1556 |

### 4.5 Remediation Tracking (#1489) — outstanding findings, verification state

**Status: contract pack in flight** (`build-journal/1489.md`, not yet shipped as of this pack).
Named off the Drizzle schema:

| Field it would need | Owning table.column | Status |
|---|---|---|
| Step status (backlog/in-progress/done/etc.) | `remediationTrackerStepsTable.status` (`msp.ts:4292`, enum `REMEDIATION_TRACKER_STEP_STATUS`) | CURRENT; not consumed here |
| Verification state against a real scan | `.verificationState`, `.verifiedByRunId` (`msp.ts:4311-4322`) | CURRENT; not consumed here |

### 4.6 Change Control (#1486) — change history against controls

**Status: contract pack shipped** (`docs/change-control-contract-pack.md`, DONE, merged
`020d46dcb`). This is the one module Security Plan's current build already links toward, via the
`cr` display string on each history entry (§1.4) — but as a **label**, not a join:

| Field it would need | Owning field (change-control-contract-pack.md) | Status |
|---|---|---|
| Real CR record behind the `cr` label | `WireChangeRequest` (change-control pack §2), keyed by the CR's own id | CURRENT on Change Control's table; **not joined** — Security Plan's `cr` column (`msp.ts:4676`) is free text with no FK, so a renamed/renumbered CR would silently desync from the plan's history row |
| Approve/reject/rollback outcome that produced the change | **DECIDED**, #1496 (change-control-contract-pack.md — five dead buttons, no `onClick` yet) | DECIDED, not built |

### 4.7 Microsoft Changes (#1494) — what is coming that alters posture

**Status: contract pack shipped** (`docs/microsoft-changes-contract-pack.md`, DONE, merged
`42d5bb2ce`). Security Plan's current build has **zero fields, links or references** to this
module anywhere in its schema, route, or page. Per #1561's own description this is a real,
intended future contribution ("what is coming that alters the posture") with no wiring of any
kind today:

| Field it would need | Owning field (microsoft-changes-contract-pack.md) | Status |
|---|---|---|
| Upcoming roadmap items affecting this tenant's posture | `WirePost` / `analysis` fields (microsoft-changes pack §1a) | CURRENT there; **OPEN GAP** here — no issue on #1495's own sub-issue list (#1561-1568) names how/whether Microsoft Changes items should surface on the plan |

---

## 5. Honest-empty contract & the tri-state

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading | — | `dataState: "loading"` until the first response (`securityPlanLive.ts:107, 156-172`) |
| Live, genuinely empty | Not reachable as "empty" in the risk-register sense — a plan either exists (has ≥1 section with ≥1 row) or is treated as `no-plan`. There is no "plan exists but has zero sections" live state; `toSecurityPlan` treats a sectionless or rowless payload as unusable and the caller reports it as `"error"`, not empty (`securityPlanWire.ts:157-165`, `securityPlanLive.ts:131-143`) | `dataState: "live"` |
| No plan authored (this module's actual "genuinely empty") | `200 { plan: null }` (`portal-security-plan.ts:129-133`) — explicit, checked via `isExplicitlyNoPlan` **before** the generic null-collapse so it is never confused with a malformed payload (`securityPlanWire.ts:145-147`) | `dataState: "no-plan"`, distinct from `"error"` |
| Read failed / malformed | Non-2xx, thrown, or a non-null `plan` `toSecurityPlan` cannot use (missing header field, no sections, or every section empty of rows — division-by-zero guard, `securityPlanWire.ts:161-182`) | `dataState: "error"`, and a `SecurityPlanMalformed` client event is reported (`securityPlanLive.ts:134-139`) |

**This module's tri-state is genuinely a four-state**, and that is correct, not an error: unlike
Risk Register/Change Control where "empty" and "unresolvable scope" collapse to the same wire
shape, here "no plan authored yet" is itself a first-class, common, expected case (every real
tenant besides the one seeded testbed customer) that the frontend deliberately keeps separate
from a genuine read failure — Git #1439 fixed exactly the failure mode of collapsing them, per
`securityPlanLive.ts:14-29`'s own header. Design must render **all four** states, not the usual
three, and must not add a fixture-shaped fifth.

**Hard-rule note (already fixed, cited for completeness):** `securityPlanData.ts`'s
`SECURITY_PLAN` / `SECURITY_PLAN_OWNER` constants remain in the codebase as design-reference /
unit-test fixtures only — no runtime code path renders them (`portal-v2-security-plan.tsx:17-28`,
`securityPlanWire.ts:11-25`). This was a real violation of the fixture/real-data hard rule until
Git #1439 fixed it; it is not a live gap today, but Design should not be handed
`securityPlanData.ts` as if it were a live-data reference.

---

## 6. The forbidden list — declared, not merely absent

1. **No customer write path.** The route is GET-only; there is no POST/PATCH/DELETE
   (`portal-security-plan.ts:16-24`). A Security Plan is authored and signed by the MSP for a
   tenant; the customer reads it. If a customer-editable plan is ever wanted, that is a new,
   separate design decision, not an oversight here.
2. **No server-side re-derivation of the header verdict/percentage/gap badge.** These are
   computed once, client-side, from the served rows (`securityPlanModel.ts`) — "a plan that
   could disagree with itself defeats its own claim" (`portal-security-plan.ts:37-42`). A second,
   server-computed copy is deliberately not built.
3. **No fixture fallback on a failed or empty read** (Git #1439, §5). A customer with no plan
   authored, or a malformed response, never renders `SECURITY_PLAN`'s fabricated "Halden
   Materials" content.
4. **No fabricated register/module data anywhere in the current build** — every row's `req` /
   `state` / `detail` is authored text by design (§2); the current build does not pretend a row
   is derived from live module data when it is not. The dishonesty this pack must prevent is not
   in what exists today, it is in what Design might be handed *next* without the caveat in §2.
5. **Prose staleness detection is a recorded non-goal** (#1495's own architecture comment, §1567):
   the platform may flag that a section's underlying module data has changed since a version was
   sealed; it must never claim to know whether the authored prose is still an accurate sentence.
   Nothing in the current build attempts this (there is no sealing/versioning mechanism yet to
   compare against), and nothing planned should attempt the prose half.

---

## 7. Open, flagged — not resolved

Per the task instruction, these stay open exactly as recorded on their own issues. Nothing below
is decided by this pack.

1. **#1564 — who signs a Security Plan.** Settled: signature attaches to a *scope*, not to "the
   plan" unqualified. **Not settled:** the authority itself — either the plan carries no
   signature and is purely informational, or it is signed by whoever holds **A at the tenant
   level** rather than per-object (contrast with RBD acceptance authority, which resolves
   role-by-role through `portal_ownership_assignments`, #1511). The current build's `approver`
   field (§1.1) is a single authored name with no signature-capture mechanism at all — it does
   not implement either resolution of #1564, it precedes the question.

2. **#1568 — is there a cross-customer MSP posture view.** Not decided. If yes, this becomes the
   second deliberately cross-boundary surface in the epic (after the RACI cross-tenant view,
   #1521) and needs the same explicit guard work: every other module here scopes to one customer
   with a fail-closed predicate (`portal-security-plan.ts:113-117` — a missing `customerId`
   claim 403s, it does not silently widen). A cross-customer read would have to be built
   deliberately, for the MSP only, never inherited from the customer-scoped route.

---

## 8. Provenance

Extracted 2026-08-29 against branch `agent/1495-q789`. Sources cited inline by file:line:
`portal-security-plan.ts`, `lib/db/src/schema/msp.ts:4545-4684` (+ the borrowed-module tables at
their own cited line numbers), the portal wire/model/live/page files under
`artifacts/msp-portal/src/components/portal-v2/` and `artifacts/msp-portal/src/pages/`, and the
sibling contract packs `docs/change-control-contract-pack.md`, `docs/risk-register-contract-pack.md`,
`docs/microsoft-changes-contract-pack.md`, `docs/policy-decisions-contract-pack.md`,
`docs/sops-contract-pack.md`, and `docs/runbooks-contract-pack.md` (the last three landed on
`origin/main` while this pack was already in flight; §4.1 and §4.4 were updated against them
before merge — `runbooks-contract-pack.md` restates the same #1557 finding `sops-contract-pack.md`
already gave §4.4, so no further change was needed there). Architecture deltas cited to
GitHub issues #1495, #1561–#1568, under epic #1485 and method issues #1577/#1578. Read-only
pass: no product code, schema, or UI was changed.

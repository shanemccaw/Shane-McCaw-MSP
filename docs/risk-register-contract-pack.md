# Risk Register / RBD — contract extraction pack for Claude Design

**#1487** (Portal New Design: Risk Register / RBD), following the method fixed by **#1577**
(contract extraction pack, run per module as step 3 of **#1578**), under **#1485**
(EPIC: Portal New Design). Sub-issues **#1507–#1514**.

Read-only. Every field below is extracted verbatim from the route's own `Wire*` interfaces,
the acceptance write path, and the Drizzle schema — cited to file:line. **Nothing here is
authored or invented.** Where a value set is documented in a comment rather than enforced by
a validator, that is stated as such rather than presented as a hard enum.

**Known-wrong contract, carried in deliberately and marked:** `msp_risk_decisions.status`
carries `expired`, and `decision_state` carries `expired`. An acceptance is a signed fact and
does not expire — the *review* lapsed. These are marked **DECIDED-wrong** (#1507, #1527)
below. Design must not carry `EXPIRED` into the new UI.

Backend route: `artifacts/api-server/src/routes/portal-risk-register.ts` (customer-scoped)
MSP-side writer (context only, not a portal surface): `artifacts/api-server/src/routes/msp-rbd.ts`
Portal wire/model/live files: `artifacts/msp-portal/src/components/portal-v2/riskRegisterWire.ts`,
`riskRegisterLive.ts`, `riskRegisterModel.ts`, `riskRegisterData.ts`, `policyDecisionsData.ts`
Schema: `lib/db/src/schema/msp.ts:3928-4044` (`mspRiskDecisionsTable`)

---

## 0. The three surfaces and their consumers

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/risk-register` | GET | `portal-risk-register.ts:279-304` | `useRiskRegister` (`riskRegisterLive.ts:57-121`) → Risk Register / Governance / Security pages | No |
| `/api/portal/policy-decisions` | GET | `portal-risk-register.ts:314-343` | `usePolicyDecisions` (`riskRegisterLive.ts:129-158`) → Policy Decisions / Compliance pages | No |
| `/api/portal/risk-register/:rbdId/accept` | POST | `portal-risk-register.ts:364-515` | `accept()` in `useRiskRegister` (`riskRegisterLive.ts:87-115`) | No |

**No orphaned live endpoint in this module.** All three customer-scoped endpoints have a page
consumer today (`riskRegisterLive.ts:39-40, 92`), so per #1577 / the #1485 standing convention
("for every real live endpoint no page currently calls, file a sub-issue under this module")
**no sub-issue is filed** — there is nothing orphaned to file for. `msp-rbd.ts` serves the same
table MSP-side and is deliberately *not* a customer surface (`portal-risk-register.ts:9-16`); it
is out of scope for this portal module.

---

## 1. Wire contract

All three endpoints read `mspRiskDecisionsTable` (`lib/db/src/schema/msp.ts:3928-4044`), scoped
to the caller's own tenant by the `(mspId, tenantId)` predicate pair
(`portal-risk-register.ts:287-296`, header rationale `:18-34`). The tables below map each wire
field to its real DB column, its type, its nullability **on the wire**, and its status.

`CURRENT` = the field serves real data from this table today.
`DECIDED` = architecture is settled but not built; the issue number is given.
`DECIDED-wrong` = the field exists and serves today, but the settled architecture says its
current meaning/vocabulary is wrong and must change.

### 1.1 Risk — `GET /api/portal/risk-register`

Returns `{ risks: WireRisk[] }` (`portal-risk-register.ts:298`), newest-id first
(`:296`). `WireRisk` is defined at `portal-risk-register.ts:120-146`, built by `toWireRisk`
(`:188-232`). The portal normalises it through `toRiskEntry` (`riskRegisterWire.ts:136-156`).

```ts
// portal-risk-register.ts:120-146 — WireRisk (verbatim)
interface WireRisk {
  readonly id: string;
  readonly title: string;
  readonly pillar: string | null;
  readonly inherent: string | null;
  readonly residual: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  readonly review: string | null;
  readonly weight: number | null;
  readonly likelihood: number | null;
  readonly impact: number | null;
  readonly what: string;
  readonly outcome: string | null;
  readonly evidence: string | null;
  readonly controls: readonly string[];
  readonly plan: string | null;
  readonly accepted?: WireAcceptance;   // present only once genuinely accepted
  readonly isAccepted: boolean;
  readonly liabilityValueUsd: number;
  readonly framework: string;
  readonly controlViolated: string;
}
```

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `rbd_id` (`msp.ts:3931`) | text, notNull | no | CURRENT |
| `title` | `title` (`msp.ts:3935`) | text, notNull | no | CURRENT |
| `pillar` | `pillar` (`msp.ts:3982`) | text, nullable | yes | DECIDED — nullable, added by the customer-fields migration; `msp-rbd.ts` never writes it |
| `inherent` | `raw_risk_level` (`msp.ts:3948`), title-cased (`:213`, `titleCaseSeverity` `:98-103`) | text, notNull | yes¹ | CURRENT · enum §3 |
| `residual` | `residual_risk_level` (`msp.ts:3949`), title-cased (`:214`) | text, notNull | yes¹ | CURRENT · enum §3 |
| `status` | `risk_status` (`msp.ts:3986`) | text, nullable | yes | CURRENT · enum §3 (this is the **risk's** state, not the acceptance's) |
| `owner` | `owner` (`msp.ts:3983`) | text, nullable | yes | DECIDED — nullable; RACI edge, see §4 |
| `review` | `review_date` (`msp.ts:3988`) — display string, e.g. "27 Aug 2026" | text, nullable | yes | DECIDED-wrong — the review clock, see §5 (#1507) |
| `weight` | `weight` (`msp.ts:3990`) | integer, nullable | yes | DECIDED — heat-map/stat-card score, nullable |
| `likelihood` | `likelihood` (`msp.ts:3992`) — 1–5 | integer, nullable | yes | DECIDED — heat-map coordinate |
| `impact` | `impact` (`msp.ts:3994`) — 1–5 | integer, nullable | yes | DECIDED — heat-map coordinate |
| `what` | `hazard_description` (`msp.ts:3953`) | text, notNull | no | CURRENT |
| `outcome` | `outcome` (`msp.ts:3996`) | text, nullable | yes | DECIDED |
| `evidence` | `evidence` (`msp.ts:3998`) | text, nullable | yes | DECIDED |
| `controls` | `compensating_controls[].description` (`msp.ts:3955`), via `controlDescriptions` (`:173-176`) | jsonb `CompensatingControl[]`, notNull default `[]` | no (array, may be empty) | CURRENT |
| `plan` | `plan` (`msp.ts:4000`) | text, nullable | yes | DECIDED |
| `accepted?` | derived — see §1.2 | — | absent unless accepted | CURRENT |
| `isAccepted` | `accepted !== undefined` (`:227`) | derived boolean | no | CURRENT |
| `liabilityValueUsd` | `liability_value_usd` (`msp.ts:3952`) — whole USD | integer, notNull | no | CURRENT |
| `framework` | `framework` (`msp.ts:3937`) | text, notNull | no | CURRENT |
| `controlViolated` | `control_violated` (`msp.ts:3936`) | text, notNull | no | CURRENT |

¹ The **column** is `notNull`, but `titleCaseSeverity` returns `null` for a blank/whitespace
value (`:98-102`), so the wire field is typed `string | null`. An unrecognised severity is
returned as-is, not coerced into a bucket (`:90-97` comment).

### 1.2 Acceptance block — `WireRisk.accepted`

Defined at `portal-risk-register.ts:106-118`, built at `:196-207`. **It is emitted only when
the write path actually ran** — the test is `acceptedAt !== null && clientApprover.name`, *not*
`status === "active"` (`:192-207` comment: an MSP-side flip to `active` with no typed name must
not render a false record of consent).

```ts
// portal-risk-register.ts:106-118 — WireAcceptance (verbatim)
interface WireAcceptance {
  readonly by: string;            // the name the customer TYPED at accept time
  readonly on: string;            // server clock, ISO — never the client's
  readonly until: string | null;
  readonly register: string | null;
  readonly why: string | null;
  readonly compensating: string | null;
  readonly statement: string | null;   // exact sentence ticked, snapshotted
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `by` | `client_approver.name` (`msp.ts:3957`, `ClientApprover` `:3919-3926`) | jsonb, notNull | CURRENT |
| `on` | `accepted_at` (`msp.ts:4028`), ISO (`iso()` `:168-171`) | timestamptz, nullable | CURRENT — the proof-of-when; server-set, never rewritten (`:4018-4027`) |
| `until` | `expiration_date` (`msp.ts:3958`) | text, notNull | DECIDED-wrong — an acceptance does not expire (§5, #1507) |
| `register` | `register_ref` (`msp.ts:4002`) | text, nullable | DECIDED |
| `why` | `rationale` (`msp.ts:4004`) | text, nullable | DECIDED |
| `compensating` | `compensating_controls` joined to one sentence (`compensatingSentence` `:183-186`) | jsonb | CURRENT |
| `statement` | `accepted_statement` (`msp.ts:4031`) | text, nullable | CURRENT — snapshotted so a later reword can't rewrite what was agreed (`:4029-4030`) |

### 1.3 Policy decision — `GET /api/portal/policy-decisions`

Returns `{ decisions: WirePolicyDecision[] }` (`portal-risk-register.ts:333-337`). **Same rows,
same query**, filtered to rows whose `decision_state` is non-empty (`:334-336`) — a raw liability
acceptance with no policy position recorded is a risk, not a documented policy decision (`:306-313`
comment). `WirePolicyDecision` is defined at `:148-163`, built by `toWirePolicyDecision` (`:234-253`),
normalised by `toPolicyDecision` (`riskRegisterWire.ts:171-187`).

```ts
// portal-risk-register.ts:148-163 — WirePolicyDecision (verbatim)
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

| Wire field | Source column | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `rbd_id` (`msp.ts:3931`) | text, notNull | no | CURRENT |
| `state` | `decision_state` (`msp.ts:4010`) | text, nullable | yes | DECIDED-wrong — vocabulary carries `expired` (§3, §5; #1527) |
| `pillar` | `pillar` (`msp.ts:3982`) | text, nullable | yes | DECIDED |
| `title` | `title` (`msp.ts:3935`) | text, notNull | no | CURRENT |
| `obligation` | `obligation` (`msp.ts:4006`) — e.g. "GDPR Art. 5(1)(e)" | text, nullable | yes | DECIDED |
| `owner` | `owner` (`msp.ts:3983`) | text, nullable | yes | DECIDED |
| `ownerId` | `owner_id` (`msp.ts:3985`) — RACI person key | text, nullable | yes | DECIDED — RACI edge, §4 (#1511) |
| `approved` | `accepted_at` ISO, else `client_approver.signedAt` (`:246`) | timestamptz / jsonb | yes | CURRENT |
| `review` | `review_date` (`msp.ts:3988`) | text, nullable | yes | DECIDED-wrong — review clock (§5) |
| `register` | `register_ref` (`msp.ts:4002`) | text, nullable | yes | DECIDED |
| `rationale` | `rationale` (`msp.ts:4004`) | text, nullable | yes | DECIDED |
| `compensating` | `compensating_controls` → sentence (`:250`) | jsonb | yes | CURRENT |
| `check` | `verification_note` (`msp.ts:4008`) | text, nullable | yes | DECIDED |

### 1.4 Accept — `POST /api/portal/risk-register/:rbdId/accept`

**Request body** (`acceptSchema`, `portal-risk-register.ts:358-362`):

| Field | Rule | Notes |
|---|---|---|
| `fullName` | `z.string().trim().min(2).max(200)` | Deliberately **not** checked against the account name (`:350-357`); the account that signed is recorded separately as the identity claim |
| `confirmed` | `z.literal(true)` | The checkbox *is* the consent — a request without it is malformed, not merely "not accepted" (`:348-349`) |
| `statement` | `z.string().trim().min(1).max(2000)` | Snapshotted into `accepted_statement` |

**Success response `201`** (`:498-509`): `{ rbdId, accepted: { by, on, until, register, why,
compensating, statement } }` — the same acceptance shape as §1.2.

**Guarantees & error contract:**

| Condition | Status | Code | Source |
|---|---|---|---|
| No customer context / unresolvable scope | 403 | `FORBIDDEN` | `:371-379` |
| Body fails `acceptSchema` | 400 | `VALIDATION` | `:381-385` |
| RBD not found **for this tenant** (scoped read — a foreign RBD 404s exactly like a nonexistent one, so ids can't be probed) | 404 | `NOT_FOUND` | `:387-405` |
| Already accepted (`accepted_at` set) — **permanent, never editable**; also enforced as a guarded `UPDATE ... WHERE accepted_at IS NULL` race guard (`:460-484`) | 409 | `CONFLICT` | `:407-413`, `:481-484` |
| Decision was revoked (`status = "revoked"`) | 409 | `CONFLICT` | `:414-417` |

Server-derived on accept (`:419-454`): `acceptedAt` (server clock), `signatureHash`
(sha256 of `rbdId + fullName + acceptedAt + statement`), `ipAddress`, and it sets
`status = "active"`, `riskStatus = "Accepted"`.

**Known limitation, flagged not papered over (`:427-438`):** on the deployed dev server
`ipAddress` records `127.0.0.1` because Express `trust proxy` is not configured behind Replit's
proxy. The value is recorded but is **not a meaningful audit fact** until that app-wide setting
is made (Shane's call). Design must not present the captured IP as a verified fact today.

---

## 2. Two lifecycles — do not merge them

`portal-risk-register.ts:67-72` and `msp.ts:3976-3981` both state this explicitly, and it is the
spine of the whole module:

- **`status`** — the **acceptance's** state. Where the liability transfer has got to.
  Vocabulary: `pending_signature | active | expired | revoked`. Surfaced on the wire only
  indirectly (drives whether `accepted` appears; `revoked` blocks a new accept).
- **`risk_status`** (→ `WireRisk.status`) — the **risk's** own state. What is happening about it.
  Vocabulary: `Open | Mitigating | Accepted | Closed | Expired`.

A risk can be `Mitigating` with no acceptance at all; an acceptance can be `revoked` while the
risk stays `Open`. The register page shows `risk_status`; the acceptance panel acts on `status`.

---

## 3. Real enum unions (and where each is actually enforced)

**Important honesty note:** none of these are Postgres `pgEnum` types. Every one is a plain `text`
column in `mspRiskDecisionsTable`. The value sets below come from (a) the **zod validators in the
MSP-side writer** `msp-rbd.ts`, and (b) **documented comments** in the schema/route for the two
`text` columns that have no validator (`risk_status`, `decision_state`). This is the real
vocabulary — Design must use exactly these strings and invent none — but it is enforced at the
write path and by convention, not by the database.

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Acceptance `status` | `active`, `pending_signature`, `expired`, `revoked` | `msp-rbd.ts:53` (`z.enum`) | **`expired` is DECIDED-wrong — #1507, #1527** |
| Raw risk level (`inherent`) | `critical`, `high`, `medium` | `msp-rbd.ts:43` (`z.enum`) | CURRENT (title-cased on the wire: `Critical`/`High`/`Medium`) |
| Residual risk level (`residual`) | `high`, `medium`, `low` | `msp-rbd.ts:44` (`z.enum`) | CURRENT (title-cased on the wire) |
| Risk status (`WireRisk.status`) | `Open`, `Mitigating`, `Accepted`, `Closed`, `Expired` | comment only — `portal-risk-register.ts:69`, `msp.ts:3979` | CURRENT; no validator enforces it |
| Policy `decision_state` (`WirePolicyDecision.state`) | `proposed`, `live`, `due`, `expired` | `riskRegisterWire.ts:158`; `PolicyDecisionState` type `policyDecisionsData.ts:23`; comment `msp.ts:4010` | **`expired` is DECIDED-wrong — #1527** |
| Compensating control `type` | `technical`, `administrative`, `operational` | `msp.ts:3909`; `msp-rbd.ts:16` (`z.enum`) | CURRENT |

**Client-side fallback behaviour worth knowing (`riskRegisterWire.ts:166-169`):** an unrecognised
`decision_state` normalises to `proposed` (the least-committed lane) rather than dropping the row.
An unrecognised severity renders with no accent colour rather than borrowing Low's (`:16-25`).

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Check key | `check_key` (`msp.ts:3939-3947`) | `monitor_checks.key` | **No** — not on either wire shape | Powers #1279 alert-suppression when populated **and** `status = 'active'`; never guessed from free-text. A real edge the portal does not currently surface. |
| Register ref | `register_ref` | internal register entry id (e.g. `RR-2026-014`) | Yes — `WireRisk.accepted.register`, `WirePolicyDecision.register` | — |
| Owner / RACI | `owner_id` (`msp.ts:3984-3985`) | RACI person key in `portal_ownership_assignments` | Partly — `WirePolicyDecision.ownerId` only; **not** on `WireRisk` | The DECIDED authority model (below) resolves acceptance authority through this. #1511, #1523. |
| Obligation | `obligation` | cited obligation reference (e.g. "GDPR Art. 5(1)(e)") | Yes — `WirePolicyDecision.obligation` | First-class obligations are a Policy Decisions addition living on #1490, not here. |
| Liability | `liability_value_usd` | — | Yes — `WireRisk.liabilityValueUsd` | The exposure a signature transfers. |

**DECIDED authority edge (the first real cross-module edge, per #1487 body):** acceptance
authority is **role-based, not person-based**. It resolves through `portal_ownership_assignments`
(`objectId`, `roleKey`, `ownerPersonId`) with `portal_ownership_delegations` for cover. The record
captures both the role that authorised and the human who signed on its behalf. **This makes the
RACI module (#1491) the authority source for the Risk module.** Sub-issue: **#1511**.

---

## 5. The known-wrong contract, in full — DECIDED-wrong

Settled on **#1507** and **#1527**, and stated in the #1487 body and #1577's own defect table:

> **An acceptance is a signed fact and does not expire.** A thing that happened does not stop
> having happened. What lapses is the **review**, which is operational and carries no legal weight.

Two clocks were collapsed into one field and must be separated:

- **Acceptance** — signature, signer, date, statement. Permanent, immutable, the legal artifact.
  (`accepted_at`, `client_approver`, `accepted_statement`.)
- **Review** — a due date and a state. Operational. A missed review invalidates nothing; it
  means nobody has looked in longer than they said they would. (`review_date`, plus a new review
  state to be built.)

Consequences Design must honour:

1. `status = "expired"` (`msp-rbd.ts:53`) is **wrong** as an acceptance state — it asserts the
   acceptance lapsed. Drop it. The acceptance stays `active`; the review is overdue.
2. `decision_state = "expired"` (§3) is **wrong** for the same reason. **Claude Design must not
   carry `EXPIRED` into the new Policy Decisions UI** (#1527). The sound states are
   `LIVE / DUE FOR REVIEW / AWAITING SIGN-OFF`; the fourth (`EXPIRED`) is replaced by a review
   state — an overdue review surfaces as an **operational flag on a decision that remains LIVE**.
3. `WireRisk.accepted.until` / `expiration_date` frames the acceptance as time-boxed. Under the
   settled model an acceptance is not time-boxed; the date belongs to the review clock.
4. **MSP "renewal on the customer's behalf" must not be built** (#1507). Nobody re-signs to keep
   an acceptance valid. The MSP marks a review done or notes why it is overdue — an operational
   act carrying none of the liability of signing for a customer.
5. GOV-A4 in the current design renders `EXPIRED` with a review date of 9 May 2026, in the past
   (#1527) — the exact conflation this module exists to fix. Do not reproduce it.

Live example of the failure this pack exists to prevent: `portal-pii-governance.ts` documents a
prior Design pass that invented per-document findings, named sources, matched patterns, an access
matrix and a drift feed with no backing — somebody had to write a route explaining why the page
*cannot* serve them (referenced by #1577 as the clearest statement of what the pack prevents).

---

## 6. Settled architecture not yet built (DECIDED — every row carries an issue)

These are settled in chat and recorded on sub-issues. They are **not** in the current wire
contract; they are what Design draws toward. Each has an issue — anything here without one would
be an OPEN GAP, and those are in §7.

| Decision | Issue |
|---|---|
| Split the acceptance clock from the review clock | **#1507** |
| RBD versioning and the supersession chain (the RBD is the signed artifact and versions as a whole; `drift_baseline_snapshots.supersededAt` is the existing precedent) | **#1508** |
| Risk instances as line items (RBD is a container; one MFA risk with 22 accounts, not 22 records; each line carries its own found/accepted date) | **#1509** |
| Signature required when accepted scope **expands**, never when it contracts — derivable by comparing instance sets, not judged by a human | **#1510** |
| Role-based acceptance authority via `portal_ownership_assignments` (+ delegations) — RACI is the authority source | **#1511** |
| Signed RBD document render and signature capture (one page: this is what was agreed, signed here, on this date) | **#1512** |
| Overdue review alerting to the MSP, on `msp_alert_rules` / `msp_alert_events` with a distinct severity | **#1513** |
| Rejection-to-risk path from Change Control (a rejected CR becomes a carried risk) | **#1514** |
| Shadow IT arrives here as an accumulating governance risk — container + line items, no new path; the risk is the pattern, never the person (insider-risk detection is a recorded non-goal) | **#1489** |
| Policy Decisions shares this exact model, read from the control side — versioning, instances, scope-expansion signature, role authority, clock split all apply unchanged | **#1490** |

---

## 7. Open gaps — NOT decided (do not resolve; flag)

Per the #1487 instruction: every DECIDED row needs an issue number; anything without one is an
OPEN GAP, not decided.

1. **Do SOPs / RBDs inherit RACI from a service, or carry their own rows?** Open and unresolved
   (#1523). Ownership `service` rows currently come from `client_services × services` — that is
   what the customer **purchased**, whereas RACI needs **M365 workloads** (#1577 defect table,
   #1515/#1523). **Flag, do not resolve.** This gates how `owner` / `owner_id` should be sourced
   for the register.

2. **Narrative-only revisions moving the residual score under an old signature.** A hazard-text /
   compensating-control / residual-score edit with the instance set untouched requires no new
   signature by the letter of the scope-expansion rule — meaning a residual score can move under a
   signature given when it read differently. An audit trail on score changes catches this without
   ceremony, but **it is not yet decided** (#1487 body, "Open, deliberately not decided"). No
   issue owns it yet — genuinely open.

---

## 8. Honest-empty contract & the tri-state

Per the fixture/real-data hard rule, Design must render honest empty/failure states, never fall
back to fixture content. The routes and the live hooks give a genuine **tri-state** — loading /
live-genuinely-empty / read-failed:

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading | — | `loading = true` until the first response (`riskRegisterLive.ts:60, 132`) |
| Live, genuinely empty | `200` with `{ risks: [] }` / `{ decisions: [] }` (`portal-risk-register.ts:298, 333`) | `loading = false`, `error = null`, empty array |
| Read failed | non-2xx or thrown | `error` set to the message (`riskRegisterLive.ts:75-77, 145-147`); the page must say so rather than show zero |

**Two honest-empty nuances Design must not paper over:**

1. **Unresolvable tenant scope also returns `200 { risks: [] }`** (`scopeOrEmpty`
   `portal-risk-register.ts:263-276`), deliberately — a customer whose tenant row carries no M365
   identifier has no risks, which is a true statement; `403` would wrongly read as "you may not
   see your own register" (`:255-261` comment). Consequence: at the wire level, *genuinely empty*
   and *no resolvable tenant identifier* are indistinguishable. This is a deliberate CURRENT
   decision, surfaced here so Design knows the empty state has two real causes.

2. **`null` is served as `null` and shown as "Not recorded"** — never a fabricated default. A row
   written by `msp-rbd.ts` (which predates every register column and sets none) comes back with
   the register fields null; `riskRegisterWire.ts` normalises text→"Not recorded"
   (`NOT_RECORDED`, `:32, 88-91`), weight→0, likelihood/impact→0 (so an un-scored risk is simply
   **not plotted** on the 5×5 heat map rather than pinned at 1×1). A missing severity renders
   unset, not as Low (`:9-26`). Design must show "Not recorded", not invent a value.

The `policy-decisions` list additionally hides rows with an empty `decision_state`
(`portal-risk-register.ts:334-336`) — a risk with no policy position recorded is not a blank lane
on the Policy Decisions page.

---

## 9. The forbidden list — declared, not merely absent

Swept from the route/schema headers. These are things the surface **deliberately does not do** —
named as forbidden so Design does not re-introduce them:

1. **No cross-tenant read.** The customer route deliberately does **not** reuse `msp-rbd.ts`
   (which lists every tenant's liability records MSP-side); doing so would leak other customers'
   tenant names, hazards and dollar exposures (`portal-risk-register.ts:9-16`). Scoping is a
   **pair** of predicates (`mspId` **and** `tenantId`), never `tenant_id` alone — that column is
   free `text` with no FK, and the one live row carries `contoso-01`, which matches nothing
   real (`:18-34`).
2. **No fabricated register values.** Null register fields are served null and shown "Not
   recorded"; no plausible-looking default is filled in, because a fabricated likelihood would
   plot a risk at coordinates nobody chose (`:51-65`, `msp.ts:3972-3974`).
3. **No second signature.** An accepted risk is **permanent and never editable** — a second
   accept is `409`, enforced by a guarded `UPDATE ... WHERE accepted_at IS NULL`, not relaxable
   into an upsert (`:407-413`, `:456-484`, `msp.ts:4023-4027`).
4. **The customer-facing signature does not trust the client for audit fields.** `ipAddress` and
   `signatureHash` are derived server-side, unlike `msp-rbd.ts` which takes them from the request
   body — "the whole point of the record is that it was not written by the person it binds"
   (`:421-454`). And the captured IP is **not a meaningful audit fact** until `trust proxy` is
   configured (`:427-438`); it must not be "fixed" by reading `x-forwarded-for` directly.
5. **`fullName` is not matched against the account name** — the signer may legitimately sign in a
   role, and the account that signed is recorded separately as the identity claim (`:350-357`).
6. **MSP renewal-on-the-customer's-behalf must not exist** (#1507) — nobody re-signs to keep an
   acceptance valid.
7. **Insider-risk detection is a recorded non-goal** for the shadow-IT path — the register
   describes a pattern of exposure, never a person's conduct (#1489, #1487 body).

---

## 10. Provenance

Extracted 2026-08-29 against branch `agent/1487-q783`. Sources cited inline by file:line:
`portal-risk-register.ts`, `msp-rbd.ts`, `lib/db/src/schema/msp.ts`, and the portal wire/live/data
files under `artifacts/msp-portal/src/components/portal-v2/`. Architecture deltas cited to
GitHub issues #1487, #1507, #1508–#1514, #1523, #1527, #1489, #1490, under epic #1485 and method
issues #1577 / #1578. Read-only pass: no product code, schema, or UI was changed.

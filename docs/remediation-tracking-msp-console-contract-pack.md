# Remediation Tracking — MSP Console contract extraction pack

**#2586**, Step 3 for **Feature #1684** (Remediation Tracking, MSP Console — the operator
half of #1489), under Epic #1571 (Portal Admin) / Epic #1485 (Portal)'s standing sequence:
**architect → build the endpoints → regenerate the contract pack from the real code → Design
→ wire.** The backend this pack documents was built and merged under **#2670**
(`4651c70e1`/`601d7c74`, `build-journal/2670.md` DONE 2026-09-03).

Read-only. Every field below is extracted verbatim from the route's own logic and the Drizzle
schema, cited to file:line, cross-checked live against local PostgreSQL. **Nothing here is
authored or invented.** No product code, schema or UI was touched to produce this document.

This is a **separate module** from `docs/remediation-tracking-contract-pack.md` (the
customer-portal pack, #1489/#1642 pattern, written 2026-08-29 against `07f169258`). That pack
documents the customer's own `/api/portal/remediation*` surfaces. This pack documents the
operator-facing mirror those same rules now serve under `/api/msp/customers/:customerId/
remediation*` — same table, same business logic, different caller and different auth. **§9
below finds the customer-portal pack itself is now badly stale** — a real discovery of this
audit, not this pack's own subject, filed as its own issue.

Backend routes (all live, all mounted — `artifacts/api-server/src/routes/index.ts:164-170,
485-491`, `app.ts:112` mounts the whole router at `/api`):

- `msp-remediation-tracker.ts` (367 lines) — GET tracker, PUT step, POST verify, GET
  verification-guide (4 routes)
- `msp-remediation-tracker-scores.ts` (135 lines) — GET pillar-scores (1 route)
- `msp-remediation-tracker-export.ts` (366 lines) — GET export.csv/.pdf, evidence-pack.pdf
  (3 routes)
- `msp-remediation-checklist.ts` (207 lines) — GET/PUT checklist, POST raise-change (3 routes)
- `msp-remediation-fix-routes.ts` (140 lines) — GET fix-routes (1 route)
- `msp-remediation-reveal.ts` (124 lines) — POST fix-routes/:checkKey/reveal (1 route)
- `msp-remediation-bypass-resolutions.ts` (57 lines) — GET bypass-resolutions (1 route)

**14 routes total.** Every one is a straight re-resolution of the identical customer-facing
route under `../lib/remediation-*.ts` — see §0.2 for exactly what "identical" means and does
not mean.

Schema: `lib/db/src/schema/msp.ts:7111` (`remediationTrackerStepsTable`). Verified live against
local PostgreSQL (`psql "$DATABASE_URL" -c '\d remediation_tracker_steps'`) — every column
matches the Drizzle source exactly, including the two unique-constraint columns
(`customer_id`, `step_id`) and both enum-typed text columns.

---

## 0. The surfaces, their consumers, and what "MSP-side mirror" actually means

### 0.1 Consumer map — every route here is currently unconsumed, and that is the expected state

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/customers/:customerId/remediation-tracker` | GET | `msp-remediation-tracker.ts:132-161` | none | live, staged |
| `.../remediation-tracker/steps/:stepId` | PUT | `msp-remediation-tracker.ts:164-272` | none | live, staged |
| `.../remediation-tracker/steps/:stepId/verify` | POST | `msp-remediation-tracker.ts:275-325` | none | live, staged |
| `.../remediation-tracker/steps/:stepId/verification-guide` | GET | `msp-remediation-tracker.ts:328-365` | none | live, staged |
| `.../remediation-tracker/pillar-scores` | GET | `msp-remediation-tracker-scores.ts:64-133` | none | live, staged |
| `.../remediation-tracker/export.csv` | GET | `msp-remediation-tracker-export.ts:281-306` | none | live, staged |
| `.../remediation-tracker/export.pdf` | GET | `msp-remediation-tracker-export.ts:308-334` | none | live, staged |
| `.../remediation-tracker/evidence-pack.pdf` | GET | `msp-remediation-tracker-export.ts:336-364` | none | live, staged |
| `.../remediation/checklist` | GET | `msp-remediation-checklist.ts:56-71` | none | live, staged |
| `.../remediation/checklist/:checkKey` | PUT | `msp-remediation-checklist.ts:74-174` | none | live, staged |
| `.../remediation/checklist/:checkKey/raise-change` | POST | `msp-remediation-checklist.ts:177-205` | none | live, staged |
| `.../remediation/fix-routes` | GET | `msp-remediation-fix-routes.ts:58-138` | none | live, staged |
| `.../remediation/fix-routes/:checkKey/reveal` | POST | `msp-remediation-reveal.ts:56-122` | none | live, staged |
| `.../remediation/bypass-resolutions` | GET | `msp-remediation-bypass-resolutions.ts:40-55` | none | live, staged |

**Confirmed against the real consumer, not assumed:** `artifacts/msp-console/src` exists
(#1680, closed 2026-09-03 as part of the #1571 reset) but holds only 6 files today, none of
which reference `remediation` (`grep -rl remediation artifacts/msp-console/src` — zero hits).
**No orphaned-endpoint sub-issue filed for any of the 14 rows above** — this is the expected
pre-Design/pre-wire state, the same posture the Risk Register MSP Console pack (#2580) already
established for its own 14-of-17-unconsumed routes: real, live, mounted, explicitly staged for
this Feature's own Design (next) and wire (after) steps, not a gap this pack invents.

### 0.2 "MSP-side mirror" means identical business logic, different resolution + auth — verified line by line, not assumed

Every one of the 7 new route files' own header comment states it re-uses the customer-facing
route's logic rather than forking it, and this pack verified that claim by reading both files
side by side for all 7 pairs (`msp-remediation-tracker.ts` ↔ `portal-remediation-tracker.ts`,
and so on for all 7). Confirmed: **every DB write, every derived field, every response shape is
byte-identical to its portal counterpart.** The only things that differ are:

1. **Customer-id resolution.** Portal: `resolveCustomerId(req)` reads `req.user.customerId`
   (the JWT claim, `portal-remediation-tracker.ts:156-159`). MSP: `resolveAuthorizedCustomerId
   (req, res)` parses `:customerId` from the URL and calls `assertCustomerAccess` (repeated
   verbatim per file, e.g. `msp-remediation-tracker.ts:118-129`) — 400 on a non-numeric id, 404
   (never a distinguishable error) on a customer outside the caller's book. This is the same
   pattern `msp-diagnostics.ts`/`msp-active-directory.ts` already use for every other
   single-customer MSP route in this repo.
2. **Role floor.** Portal: `requireRole("Assessment")` (the lowest role carrying a
   `customerId` claim). MSP: `requireRole("MSPOperator")` (MSPAdmin/PlatformAdmin clear it too)
   — `requireAuth.ts:205-223`'s `roleIndex()` ordering, confirmed live.
3. **`accepted_risk` handling on the tracker's own PUT** (§4) — the one genuine behavioral
   difference beyond auth, and it is a narrowing, not a new capability.
4. **The retainer-work-logger's actor-role gate is structurally redundant on the MSP side, not
   omitted** (§5) — a real, deliberate simplification, not a missed check.
5. **Decline-to-risk is not mirrored at all** (§4) — the MSP console has zero route for it, by
   design, not by gap.

Everything else — every column read, every column written, every derived field, every response
JSON key, every error message string — is the same code path. This pack therefore does not
re-derive the underlying business rules the customer-portal pack's §1/§3/§4 already extracted;
it cites them by reference and documents only the MSP-side surface + the four differences above.

---

## 1. Wire contract — `msp-remediation-tracker.ts`

### 1a. `GET /api/msp/customers/:customerId/remediation-tracker`

Source: `:132-161`. Identical read/shape to the portal route
(`docs/remediation-tracking-contract-pack.md` §1a) with one addition the customer pack's own
`WireTrackerStep` table does **not** yet document (see §9 — that pack is stale on this exact
field): a computed `terminalState` field.

**`WireTrackerStep`** (`:81-89`, built by `toWire()` `:91-110`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `stepId` | `string` | never null | `82` |
| `status` | `string` (7-value enum, §3 — **the customer pack's §3 lists only 6**) | never null | `83` |
| `completedAt` | `string \| null` (ISO) | null unless `status === "completed"` | `84` |
| `updatedAt` | `string \| null` (ISO) | null only for the synthesized fallback row (`:257-265`) | `85` |
| `verificationState` | `string` (`"unverified"` \| `"verified"` \| `"drift"`) | never null | `86` |
| `verifiedAt` | `string \| null` (ISO) | null while `unverified` | `87` |
| `terminalState` | `"verified" \| "accepted" \| "outstanding"` (derived, `remediationTerminalState()` `:75-79`) | never null | `88` |

`terminalState` is **not** persisted — computed on every read from `status`+`verificationState`:
`verified` wins if `verificationState === "verified"`; else `accepted` if
`status === "accepted_risk"`; else `outstanding`. Response: `{ steps: WireTrackerStep[], pricing:
RemediationTrackerPricing }` (`:155`) — `pricing` is the identical
`computeRemediationTrackerPricing()` call the portal route makes (customer pack §1a), reused
unchanged (`msp-remediation-tracker.ts:55`, `portal-remediation-tracker.ts:70`).

### 1b. `PUT .../remediation-tracker/steps/:stepId`

Source: `:164-272`. Same idempotent-upsert, same `completedAt`-derived-not-accepted rule, same
verification-reset-on-write rule as the customer pack §1b — **with one narrowing**: see §4.

### 1c. `POST .../remediation-tracker/steps/:stepId/verify`

Source: `:275-325`. Byte-identical to the customer pack's §1c "pointed verify" — same
`emitWorkflowEvent("remediation.verify_requested", ...)` fire-and-forget, same 400s ("no
automated check", "nothing to verify yet", "no connected M365 tenant"), same `202` response
shape `{ message, stepId, checkKeys }`.

### 1d. `GET .../remediation-tracker/steps/:stepId/verification-guide`

Source: `:328-365`. Byte-identical to the customer pack's §1e — `fetchPublishedKnowledgeBaseRows`
over the step's mapped check keys, same `{ stepId, checkKeys, guidance }` shape, same 404 for a
step with no mapped check.

---

## 2. Wire contract — `msp-remediation-tracker-scores.ts` / `msp-remediation-tracker-export.ts`

Both are **line-for-line identical logic** to their portal counterparts
(`portal-remediation-tracker-scores.ts`, `portal-remediation-tracker-export.ts`) — confirmed by
direct file comparison, not sampled. Same `PillarScoresResponse` shape (customer pack §1c), same
`ExportRow`/`EvidenceRow` shapes and the same evidence-pack gate (`verificationState ===
"verified"` only — customer pack §1d/§1e). The one MSP-specific line worth citing: the
`MSP_STAFF_ROLES` set used to resolve `verifiedBy` in the evidence pack
(`msp-remediation-tracker-export.ts:35`) is defined **identically** to the portal file's own
copy (`portal-remediation-tracker-export.ts:49`) — both independently hand-duplicate the same
four-role set (`PlatformAdmin`, `MSPAdmin`, `MSPOperator`, `ServiceAccount`) rather than sharing
a constant; a real, small duplication (not a divergence — the two sets are byte-identical today)
worth noting for whoever next touches either file.

---

## 3. Real enum unions — corrections to the customer-portal pack, not new vocabularies

All pulled verbatim from `lib/db/src/schema/msp.ts`, verified live. **This module has grown one
real value since the customer pack's §3 was written; nothing here is invented.**

```ts
// lib/db/src/schema/msp.ts:7072-7080 — the customer's own claim about a step
// SEVEN values today, not six — the customer pack's §3 (written before #1542 landed,
// see §9) lists only the first six.
REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started", "completed", "already_handled",
  "not_applicable", "deferred", "shane_handles",
  "accepted_risk",   // #1542, added 2026-08-30 — see §4 for how this route treats it
]

// lib/db/src/schema/msp.ts:7108 — unchanged from the customer pack's §3
REMEDIATION_TRACKER_VERIFICATION_STATE = ["unverified", "verified", "drift"]

// lib/db/src/schema/msp.ts:6913 — the fix-route dimension (#1539), not in the customer
// pack's §3 at all (that pack predates #1539 landing — see §9)
REMEDIATION_FIX_ROUTE = ["we_can_run", "you_must_run", "admin_center_only"]

// remediation-fix-route.ts:51-55 — rank order the whole min()/max() resolution depends on
FIX_ROUTE_RANK = { we_can_run: 2, you_must_run: 1, admin_center_only: 0 }

// remediation-fix-route.ts:124-128 — the affordance a shape maps to
FIX_ROUTE_AFFORDANCE = { we_can_run: "execute", you_must_run: "copy", admin_center_only: "link" }

// remediation-checklist.ts:74 — the adverse-severity set a checklist item can be
CHECKLIST_FINDING_SEVERITIES = ["critical", "warning"]

// remediation-tracker-catalogue.ts:65-71 — display labels for the s1-s30 world
// SIX entries only — no "accepted_risk" label exists here. See §7.1: a step whose
// status is "accepted_risk" exports with the raw string "accepted_risk" as its
// statusLabel, not a human label, on BOTH the portal and MSP export routes.
REMEDIATION_TRACKER_STATUS_LABELS = {
  not_started: "Not started", completed: "Completed",
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase", shane_handles: "Have Shane do this one",
}
```

Every enum above is **unenforced at the DB level** — `status` and `verification_state` are both
plain `text` columns (`msp.ts:7128`, `:7147`), confirmed live (`psql \d remediation_tracker_steps`
shows no CHECK constraint on either). Validation is Zod-only, at the route layer, per-file.

---

## 4. The one real behavioral difference: `accepted_risk` on the s1–s30 tracker vs. on the checklist

**On `msp-remediation-tracker.ts`'s PUT (§1b), `accepted_risk` is explicitly rejected**
(`:187-190`): `if (status === "accepted_risk") res.status(400).json({ error: "accepted_risk
cannot be set directly — it is only ever set by the customer's own decline-to-risk acceptance"
})`. This is a **narrowing** relative to the customer route, which rejects the same value for the
same reason but with its own decline path available as the alternative
(`portal-remediation-tracker.ts:265-268`, `"...use POST .../decline-to-risk"`). The MSP-side
route has no decline-to-risk equivalent at all (see the file's own header, `:29-39`, and the
Feature #1684/#2670 dispatch note this pack's own header quotes): an MSP operator cannot put a
step into `accepted_risk` through any route in this pack, by design — that status is a SIGNED
customer liability record (`msp_risk_decisions` row + typed full name + explicit confirmation,
`requireRole("CustomerUser")` on the portal side) and misattributing who accepted the risk is a
real product/legal distinction, not a missing feature.

**§7.1 below is the live gap this correctly-designed narrowing exposes**: the sibling
checklist-write route (`msp-remediation-checklist.ts:74-174`, and its portal twin
`portal-remediation-checklist.ts:87-198`) has **no equivalent guard** — both accept
`status: "accepted_risk"` through a bare `PUT`, with nothing behind it. Filed (§7.1).

---

## 5. The retainer-work-logger hook — same mechanism, structurally simplified auth

Every one of the four write-capable MSP routes in this pack (`PUT .../steps/:stepId`,
`PUT .../checklist/:checkKey`) fires the identical `logRetainerWorkFromTracker()` hook
(`retainer-work-logger.ts:62`) the portal routes use, on the identical condition
(`status === "completed"`), with one difference: **the MSP-side hook has no actor-role check**
(`msp-remediation-tracker.ts:241`: `if (status === "completed" && row && actorMspId !== null)`)
where the portal route additionally gates on `RETAINER_MSP_ACTOR_ROLES.has(actorRole)`
(`portal-remediation-tracker.ts:332`). **This is not a gap** — the portal route's own header
explains the check exists because a customer's own tick must never be misattributed to Shane's
retainer hours, and a customer can reach that route. Every route in THIS pack is already gated
`requireRole("MSPOperator")`, so every caller who reaches the write handler is, by construction,
an MSP/admin actor — the additional role-set check would be dead code, and the file's own header
says so explicitly (`msp-remediation-tracker.ts:237-240`: "an MSP operator working the tracker
through this route is, by definition, always the MSP-actor case"). Verified true: no route in
this pack is reachable below `MSPOperator`.

---

## 6. Cross-surface edges — same tables, same functions, MSP-scoped entry points

- **Checklist ↔ Change Control.** `POST .../checklist/:checkKey/raise-change`
  (`msp-remediation-checklist.ts:177-205`) calls the identical `raiseChangeRequest()`
  (`portal-change-control-raise.ts:114`) the portal wizard's own `POST /portal/change-control`
  uses, via the identical `buildRaiseChangeRequestInputForChecklistItem()`
  (`remediation-raise-change.ts`) — same `RaiseChangeRequestResult` shape (`{code, risk, workload,
  freezeException, riskDischarged}`, `portal-change-control-raise.ts:80-93,309`), same
  `msp_change_requests.remediation_check_key` back-pointer (`msp.ts:4456`, indexed `:4551`) a
  raised CR uses to trace back to the finding it came from.
- **Fix-route ↔ reveal gate.** `POST .../fix-routes/:checkKey/reveal`
  (`msp-remediation-reveal.ts:56-122`) requires an already-**approved** CR raised for that exact
  `(mspId, tenantId, checkKey)` via `findRevealCandidates()`/`evaluateRevealAuthorization()`
  (`remediation-reveal-gate.ts:104-123`, `:85-96`) — fail-closed: zero CRs, or every CR
  pending/rejected, withholds the script (403). This is the identical gate the portal's own
  `you_must_run` reveal route enforces; the MSP side reaches the exact same `msp_change_requests`
  rows, not a parallel copy.
- **Verified step ↔ drift event, correlated but never merged.** `GET .../bypass-resolutions`
  (`msp-remediation-bypass-resolutions.ts:40-55`) calls `resolveBypassResolutionsForCustomer()`
  (`remediation-bypass-resolutions.ts:168-259`) — a pure, read-only, same-run-window join between
  a `verified` tracker step and a `drift_events` row with verdict `attributed_unapproved` or
  `unattributed` (never `approved`) on a domain that step's mapped checks drift-track
  (`domainsForStep()`, `:109-118`, via `driftSpecForCheck()`). **Zero writes, zero enforcement,
  zero scoring** — the module's own header is explicit that this states what changed and that it
  fell outside change control, nothing more (`:39-45`).
- **Tenant write-consent → fix-route shape.** `GET .../remediation/fix-routes`
  (`msp-remediation-fix-routes.ts:58-138`) resolves `tenants.consent.writeBack.status` through
  `resolveTenantWriteCeiling()` (`remediation-fix-route.ts:80-82`) — `granted` permits
  `we_can_run`; anything else caps at `you_must_run`, never dropping below it (a denied tenant can
  always run the script themselves). Combined via `resolveFixRoute()`'s
  `min(findingCeiling, tenantCeiling)` (`:105-113`) with the finding-side ceiling from
  `remediation_knowledge_base.fix_route_capability`, raised to `we_can_run` by a live,
  execution-ready `config_pack_templates` row regardless of what the authored column says
  (`resolveFindingCeiling()`, `:90-98`).
- **Checklist item identity ↔ finding identity.** Every checklist item's stable key is
  `checkKey` (`monitor_checks.key`) — the SAME identity `remediation_knowledge_base.check_key`
  and `msp_diagnostic_findings.check_key` already share (`remediation-checklist.ts:14-24`). A
  checklist row's `step_id` column literally holds a `checkKey` string rather than an `s`-id;
  `step_id` has no CHECK constraint so this needed no schema change, and the two id spaces
  (s1-s30 vs. checkKey) coexist in the same table without collision.

---

## 7. Open gaps found by this audit — flagged here, filed where concrete

### 7.1 FILED — `PUT .../checklist/:checkKey` accepts `accepted_risk` directly, with nothing behind it

**Both `msp-remediation-checklist.ts:74-174` and its portal twin
`portal-remediation-checklist.ts:87-198`** validate the write body against the full
`REMEDIATION_TRACKER_STEP_STATUS` enum (`putItemSchema = z.object({ status:
z.enum(REMEDIATION_TRACKER_STEP_STATUS) })`, now 7 values per §3) with **no guard excluding
`accepted_risk`** — unlike the sibling s1–s30 route (§4), which explicitly 400s that exact value
on both the portal and MSP side. A bare `PUT /remediation/checklist/:checkKey { "status":
"accepted_risk" }` — reachable by any `Assessment`-tier customer on the portal side, or any
`MSPOperator` on the MSP side — sets an item's status to `accepted_risk` with **no
`msp_risk_decisions` row, no typed full name, no confirmation, no statement, nothing** the
schema's own comment describes that value as requiring (`msp.ts:7061-7071`: "ONLY ever set by
`remediation-tracker-risk-decline.ts` in the same transaction that creates a SIGNED
`msp_risk_decisions` row... a verifiable fact, not a claim awaiting proof"). This collapses the
exact claim-vs-proof distinction `accepted_risk` exists to preserve, on the newer,
findings-derived half of the same table the s1–s30 route already protects correctly. **Filed as
its own issue, parented under Feature #1684 per this build's standing rules — see the DONE
bookend for the issue number.** Labeled `bug` + `security` (a customer or operator can create an
unsigned liability-adjacent state the product's own schema comment says must be signed).

### 7.2 Noted, not filed — `REMEDIATION_TRACKER_STATUS_LABELS` has no `accepted_risk` entry

Per §3: a step exported via `.../export.csv`/`.../export.pdf` (either the portal or MSP route)
while its status is `accepted_risk` renders `statusLabel` as the raw string `"accepted_risk"`
(the `?? status` fallback, `msp-remediation-tracker-export.ts:88` / `portal-remediation-tracker-
export.ts:100`) rather than a human label like the other six statuses get. Purely cosmetic on an
export document; not filed as its own issue at this pack's threshold (same "flag, don't file" bar
`docs/risk-register-msp-console-contract-pack.md` §7.3 uses for a comparably minor gap) — noted so
whoever next touches either export file adds the missing map entry.

### 7.3 Noted, not filed — duplicated `MSP_STAFF_ROLES` constant (§2)

Two independent, currently-identical copies of the same four-role set. Low risk today (both
copies are byte-identical); worth collapsing into one shared constant the next time either export
file is touched, not urgent enough to file on its own.

---

## 8. The forbidden list — declared, not merely absent

1. **No cross-customer read.** Every route in this pack resolves `customerId` through
   `assertCustomerAccess(req.user!, customerId)` (§0.2) — an MSPAdmin/MSPOperator whose `mspId`
   does not own the target tenant gets 404, never a distinguishable 403 that would disclose the
   tenant exists. Confirmed on all 14 routes, no exception (repeated verbatim per file, not a
   shared middleware — a real, small duplication already accepted for the same reason
   `msp-diagnostics.ts` accepts it).
2. **No route in this pack may set `accepted_risk` on the s1–s30 tracker.** §4 — verified true
   for `msp-remediation-tracker.ts`'s PUT. (§7.1 is the same forbidden state reachable through a
   *different* route this pack also owns — flagged, not contradicted.)
3. **No route in this pack executes a customer-executed (`you_must_run`) fix's script without a
   cleared Change Request.** §6 — `msp-remediation-reveal.ts` enforces the identical fail-closed
   gate the portal route enforces, same underlying `msp_change_requests` rows.
4. **No route in this pack fabricates a checklist item, a pillar score, or a bypass resolution.**
   Every read is a real, derived query — an untouched tenant (no scans, no findings, no drift
   events) returns an empty array/object at every one of these routes, never a fixture or a
   placeholder row (§2, §6).
5. **This pack's own routes never arm or execute a `we_can_run` fix directly** — that write path
   is `change-control-write-gate.ts` (#1497), fail-closed and outside this pack's scope entirely;
   §6's reveal gate only ever discloses PowerShell TEXT for the customer to run themselves.

---

## 9. FINDING — the customer-portal contract pack is now badly stale

**Not this pack's own subject, but a real, concrete finding this audit could not avoid making**
while cross-referencing every enum/route this pack cites against
`docs/remediation-tracking-contract-pack.md` (§1a's `WireTrackerStep`, §2's CURRENT/DECIDED
table, §3's enum list). That pack was written 2026-08-29 against commit `07f169258`. Checked
against `main` today, by issue:

| §2 row | Pack's own claim | Reality |
|---|---|---|
| Checklist derived from findings | **DECIDED, not built** — #1538 | **#1538 CLOSED** — `portal-remediation-checklist.ts` is live, 3 routes |
| Fix route as a first-class dimension | **DECIDED, not built** — #1539 | **#1539 CLOSED** — `portal-remediation-fix-routes.ts` live, `REMEDIATION_FIX_ROUTE` enum exists in schema, absent from the pack's own §3 |
| Pointed re-verification scan, on demand | **DECIDED, not built** — #1540 | **#1540 CLOSED** — `POST .../steps/:stepId/verify` is live on the exact route the pack's own §1b describes as read-only-adjacent |
| CR gate — diff before approval, executable after | **DECIDED, not built** — #1541 | **#1541 CLOSED** — `portal-remediation-reveal.ts` + the checklist's `raise-change` route are both live |
| Items exit to the risk register when declined | **DECIDED, not built** — #1542 | **#1542 CLOSED 2026-08-30**, one day after the pack was written — `POST .../decline-to-risk` is live, `accepted_risk` is a real 7th enum value (§3), and `WireTrackerStep` itself grew a `terminalState` field (§1a) the pack's own §1a table does not list at all |
| Fixed-outside-CR coexistence | **DECIDED, not built** — #1543 | **#1543 CLOSED** — `portal-remediation-bypass-resolutions.ts` live |
| Unauthorized-change notification | **DECIDED, not built** — #1544 | **#1544 CLOSED** — `customer_tenant-alert-engine.ts`'s drift-alert path, per its own commit `390c8c85f` |
| Shadow IT as an accumulating governance risk | **DECIDED, not built** — #1545 | **#1545 CLOSED** — `shadow-it-governance.ts` live, per commit `ca044758e` |

**Eight of the pack's nine §2 "DECIDED, not built" rows are now built and closed** — every one
except #1546 (Insider risk detection, a deliberate non-goal, correctly still not built). The
pack's §1 wire contract is also now incomplete on its own terms: it documents 6 endpoints where
14 now exist on the customer side alone (7 more once this pack's MSP mirror is counted), and its
§3 enum list is short one real, live value (`accepted_risk`) plus an entire enum this pack's own
§3 documents (`REMEDIATION_FIX_ROUTE`) that the customer pack never mentions at all. Handing the
existing customer pack to Design today would produce a design drawn against a module state that
stopped being true within 24 hours of the pack shipping — the same failure mode
`docs/microsoft-changes-contract-pack.md`'s own replacement issue (its dispatch history) exists
to name. **Filed as its own issue, parented under Feature #1684 per this build's standing
rules** (the customer-facing module and the MSP-console mirror are the same Feature's two halves)
**— see the DONE bookend for the issue number.**

---

## 10. Provenance

Written 2026-09-04 against `main` (branch `agent/2586-q1536`), for #2586 (Document step of
Feature #1684, Remediation Tracking MSP Console). Read in full, not sampled: all 7 MSP route
files (1,396 lines total) and all 7 of their portal counterparts, side by side; plus
`remediation-checklist.ts`, `remediation-fix-route.ts`, `remediation-reveal-gate.ts`,
`remediation-bypass-resolutions.ts`, `remediation-tracker-catalogue.ts`,
`retainer-work-logger.ts`, and the relevant sections of `lib/db/src/schema/msp.ts` (enum
definitions and the `remediation_tracker_steps` table). Verified live against local
PostgreSQL — `remediation_tracker_steps` schema confirmed to match the Drizzle source exactly,
including both enum-carrying `text` columns and the one real unique index. `artifacts/msp-console`
confirmed to have zero remediation consumers today (expected pre-Design state). Two real findings
made and filed (§7.1, §9) — issue numbers recorded in `build-journal/2586.md`. No product code,
schema, or UI was changed by this pass.

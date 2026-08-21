# Portal v2 — Wiring Plan

**Status:** Reference doc, written for after the UI-only build waves land.
**Do not start any of this while Parts 0-12 are still in flight** — this plan
assumes the UI exists with fixture data in one module per page, per
`PORTAL_V2_PARALLEL_PLAN.md`'s own discipline. Wiring means swapping each
page's fixture import for a real data source; it does not mean touching layout.

Every claim below was checked against real code before being written down —
none of this is assumed from the README or from memory of an earlier
investigation. Where something wasn't checked, it's marked as such explicitly.

---

## 1. Already real, already correctly customer-scoped — wire the UI, nothing else to build

- **Webhooks.** `webhook-delivery.ts` — genuine outbound delivery engine, real
  tables (`outboundWebhooksTable`, `outboundWebhookDeliveriesTable`),
  HMAC-SHA256 signed payloads, exponential-backoff retry (30s/5min), fed by
  `event-bus.ts`'s canonical `DispatchedEvent` system. Routes at
  `/api/portal/webhooks/*` already distinguish `CustomerUser` (scoped to their
  own `customerId`) from MSP context correctly. **No new backend work** — Part
  12's UI just needs to call these real endpoints instead of its fixture.

- **Document Library.** **Correction — `insightsGeneratedDocumentsTable` /
  `/api/portal/insights-documents` is DEPRECATED. Do not wire anything to it.**
  The real, current system is `document-engine.ts` + `documentTypesTable` (a
  real, DB-driven catalog of document types — not a hardcoded list) served via
  `live-document-pdf.ts` (`GET /portal/live-documents/:docType/pdf`,
  `requireAuth`) and `live-document-shares.ts` (`POST
  /portal/live-documents/share`, real `customerId: userId` scoping, tokens in
  `liveDocumentSharesTable`). Documents are generated **live from real tenant
  data on demand**, not pulled from a pre-stored row — that's the real
  architecture, and it's more current/correct than the deprecated table, not
  less. The SOW is special-cased in `document-engine.ts` as a
  `pipeline_output` type with its own dedicated generation path — explicitly
  NOT to be generated via the generic `generateDocument()` function used for
  the other document types. Per Shane: scope is the 9 real prose documents
  already live on the Copilot Readiness product today, with later expansion
  planned. Wire the UI to `live-documents`/`documentTypesTable`, never to
  `insights-documents`.

## 2. Real backend, wrong role scope — needs new customer-scoped routes only

Same leak-risk pattern established repeatedly tonight: reusing an
MSP-operator-only route directly from a customer page would expose other
tenants' data.

- **SOPs** — `/api/msp/sops`, `requireRole("MSPOperator")` today.
- **Risk Register / Policy Decisions** — MSP-scoped today (exact table TBD,
  confirm against `msp_risk_decisions` or equivalent before building).
- **Change Control** — `msp_change_requests` exists per BUILD_PLAN.md's own
  §3.5 analysis; confirm current route scoping before assuming.
- **Microsoft Changes** — real data source confirmed: `message-center-sync.ts`
  pulls the customer's real Microsoft Message Center via Graph API. Route is
  `/msp/message-center`, `requireRole("MSPOperator")`, filtered by an optional
  `customerId` query param today — **not currently safe for direct customer
  reuse** (query-param scoping, not JWT-derived). Needs a real
  `requireRole("CustomerUser")` route deriving `customerId` from the
  authenticated user, same discipline as everything else tonight.
- **Ownership** — shared people-list contract with Settings already respected
  in the UI pass (`people` prop / `onPeopleChange` callback) — confirm the
  underlying data table's real customer scoping before wiring.

## 3. Real backend, real state machine, genuinely new build

- **Hold Windows.** Zero existing implementation. Build the real state machine
  per the README's hold-window section. **The prototype's own state machine
  has known defects** — a `clear` verdict makes `closing` unreachable; `early`
  fires at the wrong T-minus offset. Fix these, do not port them as-is.

- **The Dev -> Test -> Prod Change Request flow.** Designed at length earlier
  tonight, not yet built anywhere:
  - CR gets a `tenantId` (or ordered list of target tenants) as a first-class
    field — Option B from that conversation: one CR record, multiple
    tenant-scoped approval/execution states underneath it, not separate CRs
    per environment.
  - Two real blocking gates per tenant stage: CAB/Customer approval before
    execution, CAB/Customer approval before the next stage. Everything else
    ("Verified") is informational, not blocking.
  - Verification reuses `simulator-run-store.ts`'s existing real,
    tenant-parameterized single-check execution (`createRun({checkKey,
    tenantId, ...})`, confirmed genuinely tenant-selectable, not hardcoded) —
    build a new trigger that fires it automatically against the CR's target
    tenant right after execution, posts the result back onto the CR record.
    Do not build a second execution engine.
  - The scheduled-Prod-deploy step reuses Hold Windows once that's built —
    same underlying "wait for an approved window, then execute" mechanism,
    not a second scheduling system.
  - Each tenant needs its own separate Microsoft app registration consent —
    hard Graph/Entra constraint, not a design choice. The execution layer
    needs to resolve "which tenant's consent" from the CR's target tenant
    before running anything.

## 4. Real number, must stay in sync both sides

- **Copilot gate.** `COPILOT_GATE_TARGET` in `journeyTokens.ts` (frontend) and
  `copilot-gate.ts` (backend) are already test-locked to agree — each side
  asserted by its own test. Wire the UI to the real value; never hardcode 82
  again once wiring replaces the fixture.

## 5. Genuinely unknown — needs the same investigation discipline as everything
   above before assuming either way

- **PII Governance and Security Plan** — 0% UI coverage, never checked for any
  backend reality. Do not assume greenfield; do not assume it exists. Check
  first.
- **ShaneBot's Active Card taxonomy** — engine currently supports 4 real card
  types (invoice/subscription/score/data-answer); the design wants 5
  (finding/fix/datum/ticket/escalate). Real decision: extend the engine, or
  remap the design's cards onto what exists. Not decided yet.
- **Retainer/hours tracking** — confirmed genuinely greenfield earlier
  tonight, no time field anywhere in the project/kanban data model. Real build.

## 6. Cross-cutting, not a page — the multi-tenant (Dev/Test/Staging/Prod)
   architecture

Designed at length tonight, not started. Touches almost everything above:
pillar scores, findings, drift history, the risk ledger, and now the CR
flow's tenant-scoped gates all currently assume one tenant per customer
account. This needs its own foundational decision (confirmed: one customer
account, multiple linked tenants underneath, tenant switcher, each tenant
billed as an add-on) before any of section 3's CR work can be considered
complete — the CR's `tenantId` field only makes sense once "which tenants does
this account have" is a real, queryable concept.

---

## Suggested order, once UI waves are done

1. Section 1 (Webhooks, Document Library) — zero backend risk, pure wiring,
   good first pass to prove the wiring methodology works before touching
   anything riskier.
2. Section 4 (Copilot gate) — same reasoning, trivially low-risk, already
   test-locked.
3. Section 2 (customer-scoped route builds) — real but well-understood work,
   same pattern proven multiple times tonight.
4. Section 6 (multi-tenant architecture decision) — foundational, needs to
   land before section 3's CR flow can be finished for real, even if section
   3's non-tenant-specific pieces (Hold Windows state machine fixes, the
   verification connector) start earlier.
5. Section 3 (Hold Windows, the full CR flow) — the highest-stakes, most
   novel work in this whole plan.
6. Section 5 (the unknowns) — investigate each properly before scoping,
   same discipline as everything else in this document.

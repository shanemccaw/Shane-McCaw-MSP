# Initiative: AI Cost Governance & Billing Rollup

**Slug:** ai-cost-governance-billing-rollup
**Status:** In Progress
**Iteration:** 1
**Area:** engines
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-28
**Tracker:** #48 (parent)

## Goal
Guarantee every AI call on the platform is logged with full traceability
(who, what, why, cost), and surface that data through a PlatformAdmin
rollup page, live status-bar segments, and a cost-trend/analytics layer —
so Shane can see true AI cost per customer/MSP/document type and never
have an ungated or unattributed AI call again.

## Scope
- Close logging gaps: full per-node isAIDependent/aiCostOwner registry,
  AI Support Assistant attribution, impersonation attribution (GAP-09),
  structural wrapper making it impossible to call the Anthropic API
  without a corresponding ai_usage_events row.
- Expand ai_usage_events schema: customerId, generatedArtifactType/Name/Id,
  triggerSource, correlationId (model column already exists).
- New PlatformAdmin "AI Billing" page at /admin-panel/ai-billing (distinct
  from existing MSP-facing artifacts/msp-portal/src/pages/ai-billing.tsx).
- Two new live segments in the existing global StatusBar
  (artifacts/admin-panel/src/components/shell/StatusBar.tsx, rendered via
  GlobalIDEShell): "Today: $X.XX" and "Month: $X.XX", each with a
  transient delta indicator (SSE-pushed, not polled) and a hover popover
  showing the last 10 transactions, clicking through to the AI Billing page.
- Analytics/trends layer: cost-per-customer, cost-per-MSP,
  cost-per-document-type, cost-per-lead, trend charts, anomaly flagging.
- generateDocument() in document-engine.ts extended to return costCents
  alongside documentId/htmlContent/docTypeKey, sourced from the same
  ai_usage_events row created for that call.

## Dependencies / Prerequisites
None externally — this is foundational. Internally: Phase 1 (the guaranteed
write) and Phase 2 (the traceability columns) are BOTH prerequisites for
Phases 3-5, which read and surface what those two phases produce. Both are
Done, so Phases 4 and 5 are unblocked.

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | Close AI-call logging gaps | Done | #49 |
| 2 | Expand ai_usage_events schema for full traceability | Done | #50 |
| 3 | PlatformAdmin AI Billing page + live StatusBar segments (SSE) | Done | #51 |
| 4 | Analytics/trends layer (cost-per-customer/MSP/doc-type, trend charts, anomaly flagging) | Done | #52 |
| 4.1 | Cost-per-lead analytics (unblocked 2026-07-29 — Zoho CRM #82/#83 closed, `lead_staging` built; live verification #133 still pending but non-blocking) | Done | #81 |
| 5 | Document Engine cost return value | Done | #53 |

## Notes
Phase 3 uses SSE push for the two StatusBar cost segments, not the
15-30s polling pattern used by the existing liveVisitors/campaignBadges
segments — deltas should reflect the instant a call happens.

### Phase 3 — what shipped
New `admin-ai-billing.ts` (requireAdmin) with `/events`, `/summary` and
`/recent`, plus `AiBillingPage.tsx` at `/system/ai-billing` and the two live
StatusBar segments. `recordAiUsage()` gained a broadcast onto a new `ai-cost`
hub channel — reusing `sse-hub.ts` and `useLiveStream.ts` rather than adding a
second transport.

Decisions worth carrying forward:

- **Seed + delta, never replay-as-total.** `broadcastToHubWithReplay` caches
  only the LAST event per channel, which here is one per-call delta. The client
  seeds its totals from `/summary` and adds frames on top. The live-stream route
  must keep NOT enabling replay for channel-firehose subscribers — a replayed
  delta would be counted twice. Noted in the constant's docblock in
  `ai-billing.ts`.
- **The broadcast is passive.** It sits in its own `try/catch` after the insert
  succeeds, so a hub fault can neither skip the MSP ledger debit nor make
  `recordAiUsage` reject; and a failed insert broadcasts nothing, so money never
  appears on the status bar that no ledger query can account for. Both are
  asserted as negative tests in `ai-billing-cost-broadcast.test.ts`.
- **Viewer-local day boundaries.** `/summary` takes a `tzOffsetMinutes` param so
  "Today" rolls over at the admin's midnight, not UTC's (a US-based admin would
  otherwise watch it reset mid-evening). The offset is treated as FIXED for the
  range, so a month straddling a DST change is off by an hour at one edge —
  documented in `resolveRangeBounds`, not hidden.
- **Deltas display at cent precision.** The issue sketched `▲ $0.0034`, but
  `ai_usage_events.cost_cents` is an INTEGER column and `computeTokenCostCents`
  rounds up, so a single call is never finer than $0.01. Showing four decimals
  would imply a precision the ledger does not carry.
- **`engine.ai-cost-governance`** was added to `admin-live-stream.ts`'s
  `CHANNEL_TAXONOMY` — Phase 1 introduced the logger channel but never listed
  it in the picker.

### Phase 4 — what shipped
One new endpoint, `GET /admin/ai-billing/analytics`, and one new section on the
existing AI Billing page (`components/ai-billing/AiCostTrends.tsx`). Two new pure
modules carry the thinking: `lib/ai-billing-analytics.ts` (bucketing + dimension
rollups) and `lib/ai-cost-anomaly.ts` (the rule).

Decisions worth carrying forward:

- **The anomaly rule is data, and so is its direction.** `AI_COST_ANOMALY_DIRECTION
  = "high-is-bad"` is exported next to the rule it governs, and the page prints
  the server's own `rule.description` rather than a hardcoded sentence, so the
  stated threshold cannot drift from the one the data was judged by. A "a large
  DROP never fires" test exists specifically because this repo has shipped
  threshold rules that encoded the wrong direction.
- **Median baseline, not mean.** With a mean, one spike lifts the baseline enough
  to hide the next one — the sustained overrun this initiative exists to catch.
- **A $1.00 floor.** Without it, $0.02 → $0.09 is a 4.5x "spike" and the page
  becomes noise its reader switches off.
- **`partial` means "not fully observed"** and covers two cases: the in-progress
  bucket, and buckets clipped by the 50k row-scan ceiling. Partial buckets are
  neither judged nor used as a baseline. Judging an in-progress period against
  complete ones would systematically UNDER-fire, which for a high-is-bad metric
  means missing real overruns; counting a clipped bucket as low would drag the
  baseline down and manufacture one.
- **The series is gapless.** A quiet day is a real $0.00 bucket. A missing bucket
  both lies about the time axis and removes a genuine zero from the baseline.
- **Unattributed spend is its own field, never a bucket.** NULL `customerId` /
  NULL `mspId` / no artifact type are reported as `unattributed` alongside the
  ranked slices, not folded into one. Note this differs deliberately from Phase
  3's `/summary`, which labels null-mspId as a "Platform (no MSP)" bucket;
  `/summary` was left untouched so the StatusBar seeding is unchanged.
- **recharts, with literal colours.** admin-panel's design tokens are raw HSL
  triples, valid only inside `hsl()`; a chart theme reading `var(--border)` gets
  an invisible grid and black ticks. Colours are passed explicitly as literals
  from index.css's token block, matching the nine recharts pages already here.
  `@workspace/dashboard-canvas` (Nivo) was not used — it is the widget-canvas
  system, and pulling it in would put a second chart runtime on this page.
- **The row ceiling is declared, not silent.** Past 50,000 rows the response says
  `truncated`, names the earliest instant it can speak to, and the page shows a
  banner telling the reader to narrow the filters.
- **Cost per lead is NOT here.** Split to #81, blocked on the Zoho CRM
  lead-integration initiative. Its absence is intentional; do not "complete the
  set" by building it against today's fragmented lead tables.

Open follow-ups: the page has no CSV export, and `/summary`'s breakdowns are
computed in JS over the period's rows (correct and self-reconciling, but it
reads every row in the window — worth moving to SQL `GROUP BY` if the table
grows large enough for that to matter). Not live-verified against a real
database — no `DATABASE_URL` in the Claude Code environment, per repo rule.

Phase 4 inherits that same read-the-window shape deliberately (one read backs the
series, all three rollups and the headline total, so they cannot disagree), and
bounds it with the declared 50k ceiling rather than pretending it scales
unbounded. If `ai_usage_events` grows past that in a normal window, the move is a
SQL `date_trunc` + `GROUP BY` behind the same response shape — the pure modules
take rows, so only the route changes. Phase 4 is likewise not live-verified: the
aggregation and anomaly logic are tested against fixtures, not against a real
database.

### Phase 4.1 — what shipped

New pure module `ai-lead-attribution.ts`, a new `/admin/ai-billing/lead-analytics`
endpoint on the existing Phase 3 router, and a new section on Phase 4's
`AiCostTrends.tsx`. No schema change; every table is read-only.

The audit that preceded it changed the shape of the phase, and the findings are
worth carrying forward:

- **There is no FK between `ai_usage_events` and `lead_staging`, in either
  direction.** `lead_staging` has no tenant/user column at all — its identity
  keys are the normalised `email` and the pre-cutover `legacy_lead_id` /
  `legacy_quiz_lead_id` pointers. `ai_usage_events` has no lead column either.
  So cost-per-lead walks a chain — `customerId` (a `tenants.id`) → `users.tenantId`
  → `users.linkedLeadId` / `lower(users.email)` → `lead_staging` — resolved by the
  route and rolled up by the pure module, rather than a single join.
- **A tenant can resolve to several leads.** The tie-break is stated, not
  implicit: the earliest staged lead wins, because
  `ensureAssessmentFunnelLead()` captures a lead BEFORE consent creates the
  tenant. The number of tenants where it fired ships in the response and is
  printed on the page.
- **`ai_usage_events.runId` never holds an `msp_diagnostic_runs.runId`.** Its
  only writer is `workflow-executor.ts`'s `aiAttributionFor()`, which supplies
  portal WORKFLOW run ids. The two id-spaces are disjoint, so the obvious join
  would have matched nothing and reported a confident $0.00 for every assessment
  run. Cost-per-assessment-run is therefore attributed by customer + run
  interval, which is an UPPER BOUND, and the response says so in a note the page
  prints verbatim.

Two attribution gaps found during the audit and deliberately NOT fixed here
(this phase is read-only analytics; fixing them changes the assessment pipeline):

- **`cio-narrative-generator.ts` is not wrapped in `withAiAttribution()`.** It is
  the AI call an assessment run actually makes, so its events land with a null
  `customerId` and are reported under `unattributed.breakdown.noCustomer`. Until
  that call site is wrapped, cost-per-assessment-run will read near-zero even
  with real assessment traffic.
- **`ai-analyzer.ts` passes a `users.id` as `customerId`,** where every other
  volume call site (`document-engine`, `document-engine-sow`, `workflow-executor`)
  passes a `tenants.id`. The Phase 3/4 routes join `customerId` against
  `tenants`, so those rows resolve against the wrong id-space.

Phase 4.1 is not live-verified either: `lead_staging` may be near-empty until
#133 exercises the Zoho sync end to end. That is handled as a genuine empty
state — a null headline figure renders as "No figure yet", never as `$0.00`.

### Phase 5 — what shipped

The engine-side plumbing (`generateDocument()`/`generateSowDocument()`
returning `costCents`/`costStatus`, already flowing through the generate
route's JSON response) landed earlier in `19339c18` and was left unbookended
until this session; this phase is purely the display half. Two changes: the
Document Generator IDE's generation-success toast now shows the cost
alongside the document id, wording it per `costStatus` ("recorded" → a real
figure via the shared `formatCents()`, "no-ai-call" → "no AI call (reused)",
"unknown" → "cost unknown" — never a bare `$0.00` for either non-recorded
case); and the generation history endpoint (`admin-document-generator.ts`)
gains a `LEFT JOIN ai_usage_events` on `generatedArtifactType = docType` AND
`generatedArtifactId = id::text`, selecting `costCents` (null on no match —
a pre-Phase-2 document or a failed usage recording — rendered in the history
table as "—", not `$0.00`). Not live-verified — no `DATABASE_URL` in this
environment.

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
| 4.1 | Cost-per-lead analytics (unblocked 2026-07-29 — Tenant/User Refactor #92 complete, lead unification landed via Zoho's `lead_staging`) | Not Started | #81 |
| 5 | Document Engine cost return value | Not Started | #53 |

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

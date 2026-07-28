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
| 4 | Analytics/trends layer (cost-per-customer/MSP/doc-type, trend charts, anomaly flagging) | Not Started | #52 |
| 4.1 | Cost-per-lead analytics (BLOCKED — depends on lead-table unification, itself depends on the not-yet-scoped Zoho CRM lead-integration initiative) | Blocked | #81 |
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

Open follow-ups: the page has no CSV export, and `/summary`'s breakdowns are
computed in JS over the period's rows (correct and self-reconciling, but it
reads every row in the window — worth moving to SQL `GROUP BY` if the table
grows large enough for that to matter). Not live-verified against a real
database — no `DATABASE_URL` in the Claude Code environment, per repo rule.

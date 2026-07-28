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
None — this is foundational; Phase 1 blocks Phases 2-5.

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | Close AI-call logging gaps | Done | #49 |
| 2 | Expand ai_usage_events schema for full traceability | Not Started | #50 |
| 3 | PlatformAdmin AI Billing page + live StatusBar segments (SSE) | Not Started | #51 |
| 4 | Analytics/trends layer | Not Started | #52 |
| 5 | Document Engine cost return value | Not Started | #53 |

## Notes
Phase 3 uses SSE push for the two StatusBar cost segments, not the
15-30s polling pattern used by the existing liveVisitors/campaignBadges
segments — deltas should reflect the instant a call happens.

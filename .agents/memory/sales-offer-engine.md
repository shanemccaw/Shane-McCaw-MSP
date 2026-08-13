---
name: Sales Offer Engine architecture
description: Key decisions and gotchas for the Sales Offer Engine — 4 tables, 5 WfNode types, plan-gated routes, engine registry pattern.
---

# Sales Offer Engine

## Rule
The Sales Offer Engine is a first-class EngineDef registered in `engine-registry.ts` alongside SLA, Scope Creep, and Monitoring engines. It uses the same `EnginePanel` generic UI via `ENGINE_NAV_KEYS` in `DeliveryWorkspace.tsx`.

## DB tables (created via executeSql, not drizzle-kit)
- `sales_offers` — offer document with state machine (draft→sent→accepted|rejected|expired), idempotency_key UNIQUE, score [0–100], basePriceCents + adjustedPriceCents
- `sales_offer_events` — append-only audit trail per offer
- `sales_offer_config` — per-MSP engine config (msp_id UNIQUE allowing NULL for platform defaults)
- `sales_offer_rule_groups` — admin-configurable rules (eligibility/bundling/pricing/scoring/expiration)

## Key gotcha: getDisabledSignalKeys source
`getDisabledSignalKeys()` is exported from `./tenant-signals.ts` NOT `./priority-engine.ts`.
`priority-engine.ts` re-exports many things but NOT this function — importing it from priority-engine gives TS2459.

## Plan gating
All API routes use `requirePlanFeature('sales_offers')` from `lib/msp-entitlement.ts`.
Auth middleware is `requireAdmin` from `../middlewares/requireAuth` (not `../middleware/auth`).

## WfNode types (5 new)
`sales_offer_generate | sales_offer_score | sales_offer_violation | sales_offer_escalate | sales_offer_resolve`
Added to WfNode union in `lib/db/src/schema/index.ts`. Both dry-run stubs and live implementations in `workflow-executor.ts`.

## Idempotency
`persistSalesOfferCandidates()` uses ON CONFLICT DO NOTHING on `idempotency_key`.
Key is SHA-256(tenantId:serviceId:sortedSignals).slice(0,32).

**Why:** Signal re-evaluations should never create duplicate offers for the same tenant+service+signal-set combination.

**How to apply:** Any new generate path must pass the same idempotency key derivation or duplicates will appear.

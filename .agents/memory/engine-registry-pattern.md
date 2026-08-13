---
name: Engine registry pattern for intelligence engines
description: How the 7 admin intelligence engines (priority, pricing, health, drift, forecasting, crm, msp) share one test/preview/dashboard contract
---

`artifacts/api-server/src/lib/engine-registry.ts` defines a single `EngineDef` contract (`runForTenant(tenantId)` / `runForPayload(input)`) that every engine implements, so `artifacts/api-server/src/routes/admin-engines.ts` can expose one generic set of routes (`/admin/engines/:key/{dashboard,test,preview,logs,configuration}`) instead of per-engine route files.

**Why:** before this, only the Tenant Signal Engine had a dashboard/testing/preview/configuration UX; the other 6 engines (pricing, health, drift, forecasting, crm, msp) had calculation logic but no admin UX, and duplicating the UX per engine would have meant 7x the surface area to maintain.

**How to apply:**
- New engine calculation logic still lives in its own lib (e.g. `priority-engine.ts`); only add a wrapper to `engine-registry.ts`'s `ENGINE_DEFS` array to get the full admin UX for free.
- `pricing-engine.ts` didn't exist before this — it's a pure sum of `pricingImpact`/`pricingValueContribution` over fired signals, mirroring the other engines' patterns (no engine invents its own formula shape).
- Frontend: `artifacts/admin-panel/src/components/EnginePanel.tsx` is the one shared Dashboard/Testing/Preview/Configuration component, mounted per engine via `<EnginePanel engineKey="priority" />` etc. in `DeliveryWorkspace.tsx` — do not build a bespoke page per engine.
- Rule-group/signal testing endpoints (`/admin/engines/rule-groups/:id/{test,preview,activation-logs}`, `/admin/engines/signals/:key/{test,preview,contribution-preview,logs}`) are generic and engine-agnostic — reuse them rather than adding engine-specific test endpoints.
- `TenantSignals.tsx` (the original, much larger rule-authoring page) was intentionally NOT rewritten to consume `EnginePanel` — it already reused the generic `/admin/signal-rules/{evaluate,preview-projects,dry-run-sow}` endpoints pre-refactor and has rule-authoring UI (add/edit rules, groups, conflicts, publish-to-prod) well beyond the 7 engines' shared testing scope.

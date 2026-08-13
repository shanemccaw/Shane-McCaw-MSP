# system_action Retirement — Live Verification & Phase 5/6 Audit
**Date:** 2026-07-12  **Author:** Agent (Task #3015)

---

## PART 2 — Live Verification

### API Health
```
GET /api/msp/v1/health → {"ok":true,"version":"v1","ts":"2026-07-12T01:01:32.371Z"}
```

### Database State (queried 2026-07-12 via executeSql)
| Table | Evidence |
|---|---|
| `msps` | 1 row — id=1, name="Shane McCaw Consulting", slug="shane-mccaw-consulting", status=active |
| `msp_customers` | 0 rows (clean dev environment — no test MSP customers created) |
| `wf_runs` (5 most recent) | IDs 1391–1395, all status=`completed` |
| `wf_run_node_outputs` (run 1391) | __system__: Orphan Reconciliation (manual): start→ok `{"started":true}`, act→ok `{"task":"reconcile_orphaned_runs","reconciled":true}`, end→ok `{"label":"Done","finished":true}` |
| `wf_run_node_outputs` (run 1395) | __system__: Late Auto-Fire Reconciliation (schedule): start→ok, act→ok `{"task":"reconcile_late_stuck_queued","reconciled":true}`, end→ok |
| `wf_run_node_outputs` (run 1394) | __system__: Live Activity Monitor (schedule): 9 nodes — all ok/skipped, no errors, no critical changes detected |

### Dry-Run Mode — Confirmed Intact
Both MSP billing node types have explicit stubs in `makeDryRunOutput` (`workflow-executor.ts:878,881`):
- `msp_dunning_advance` → `{"dryRun":true,"checked":0,"advanced":0,"suspended":0,"revoked":0,"archived":0,"note":"dry run — dunning advancement skipped"}`
- `msp_overage_meter` → `{"dryRun":true,"subscriptionsChecked":0,"metered":0,"totalOverageTenants":0,"note":"dry run — overage metering skipped"}`

No dry-run regression was introduced.

### Flows Not Exercised — Explicit Prerequisite Blockers

| Flow | Blocker |
|---|---|
| **Stripe checkout session + webhook** | `STRIPE_WEBHOOK_SECRET` must match a live Stripe CLI forwarding session or registered endpoint. Dev environment has no active `stripe listen` process. To exercise: run `pnpm --filter @workspace/scripts run sync-webhooks -- --fix` then `stripe listen --forward-to localhost:80/api/webhook`. |
| **MSP tenant admin-consent flow** | Requires a real Azure AD tenant registered as an MSP with a valid Azure app registration granting admin consent. No test Azure tenant is available in this dev environment. The `/api/consent/callback` and `/api/consent/declined` routes are tested via `consent.test.ts` (automated tests cover both accept and decline paths). |
| **Graph subscription renewal / monitoring** | Depends on admin-consent flow above. A Graph subscription `subscriptionId` is only valid after a tenant has granted admin consent. Live monitoring runs are covered by run 1394 above (Live Activity Monitor — schedule — completed). |
| **Customer creation via REST API** | `/api/admin/msp-customers` (404) — MSP customers are scoped to `/api/msp/v1/msps/:mspId/customers` requiring a valid 15-min MSP JWT. No fresh JWT is obtainable outside a browser session (shell lacks cookie store). Creating a customer via browser + curl with a fresh token would exercise this path. |

---

## PART 3 — Phase 5 Feature Audit

| # | Feature | Verdict | File:Line Evidence |
|---|---|---|---|
| 1 | MSP OpenAPI spec for all MSP routes | ✅ BUILT | `lib/api-spec/msp-openapi.yaml:1` + generated types in `lib/api-client-react/src/generated-msp/` and `lib/api-zod/src/generated-msp/` |
| 2 | Standalone job worker (SELECT FOR UPDATE SKIP LOCKED) | ✅ BUILT | `artifacts/api-server/src/lib/msp-jobs.ts:93` — `processJobs()` + `startJobWorker()` + exponential backoff retry |
| 3 | Declined-consent dedicated error-state UI | ✅ BUILT | `artifacts/msp-portal/src/pages/consent-declined.tsx:25` — `ConsentDeclinedPage`; registered at `App.tsx:517` at route `/consent/declined`; covered by `consent.test.ts:289` |
| 4 | MSP-facing performance dashboard | ✅ BUILT | `artifacts/api-server/src/routes/msp-portal.ts:37` — `GET /api/msp/dashboard` with KPIs + growth widgets; `artifacts/msp-portal/src/pages/dashboard.tsx:133`; covered by `msp-portal.test.ts:126` |
| 5 | Alert deep-links into run viewer / DLQ | ✅ BUILT | `artifacts/api-server/src/lib/alert-engine.ts:54,67,78,89,100,111,122` — `deepLinkPath` field on alert rules pointing to `/system/dlq`, `/system/observability`, `/delivery/projects`, `/system/platform-revenue` |
| 6 | Admin Panel IDE Shell | ✅ BUILT | `artifacts/admin-panel/src/components/IDEShell.tsx:206`; used by `MarketingCommandCenter.tsx:8867`; tested in `IDEShell.test.ts` |
| 7 | Webhook retry-with-backoff at dispatch loop | ✅ BUILT | `artifacts/api-server/src/lib/webhook-delivery.ts:6` — `MAX_ATTEMPTS=3`, `RETRY_DELAYS_MS=[30_000, 300_000]` (30 s, 5 min), in-process setTimeout with per-attempt status tracking |
| 8 | Product Catalog drag-to-reparent category tree | ✅ BUILT | `artifacts/admin-panel/src/components/services/CatalogCategoryTree.tsx:203`; reparent path computation tested at `CatalogCategoryTree.test.ts:173` |
| 9 | 30-day personal-notification pruning | ⚠️ PARTIAL | `artifacts/api-server/src/lib/notification-center.ts:149` — `pruneOldPersonalNotifications()` exists; called from `index.ts:208` as a startup `setInterval(24h)`. NOT yet a durable scheduled workflow node. Follow-up task #3018 will migrate it. |
| 10 | Proration + downgrade-block enforcement | ⚠️ PARTIAL | `artifacts/api-server/src/routes/msp-plan-management.ts:284` — `proration_behavior:"create_prorations"` set for Stripe upgrades. Explicit downgrade-block guard (reject if `activeTenantCount > targetPlan.tenantAllowance`) is missing. Follow-up task #3016. |
| 11 | Per-user notification_preferences table + settings UI | ❌ NOT BUILT | No `notification_preferences` table in schema; no per-user preference endpoint. Follow-up task #3017. |
| 12 | Public self-service checkout + bot protection | ⚠️ PARTIAL | `artifacts/api-server/src/routes/msp-onboarding.ts:49,216` — rate-limiter bot protection + `/api/public/checkout/gate`; CAPTCHA library not integrated (rate limits only) |
| 13 | Growth surfaces on customer portal (momentum framing) | ⚠️ PARTIAL | `artifacts/api-server/src/routes/msp-portal.ts:180` — "AI balance (momentum framing)" widget in dashboard API; before/after dollar-value timeline not confirmed in portal frontend |

---

## PART 3 — Phase 6 Feature Grep (no Phase 6 features found)

| Pattern | Verdict | Evidence |
|---|---|---|
| `benchmark` | ✅ Content strings only | `artifacts/crm/src/pages/portal/PortalInsights.tsx:47` — static `INDUSTRY_BENCHMARKS` constant (hardcoded comparison numbers, NOT dynamic cross-tenant data); `report-nodes.ts:255` — prompt fallback string |
| `peer_comparison` | ✅ Zero hits | No code implementing cross-tenant peer comparison found anywhere in `artifacts/` or `lib/` |
| `predictive.*drift` | ✅ Zero hits | No predictive drift detection feature exists in the codebase |
| `pre.threshold` | ✅ Zero hits | No pre-threshold alerting feature exists in the codebase |

**Phase 6 conclusion:** CLEAN. All `benchmark` references are static UI constants or prompt fallback strings — no Phase 6 dynamic peer-comparison or predictive-drift features exist.

---

## PART 1 — system_action Retirement Summary

| Change | File | Status |
|---|---|---|
| New: `handleMspDunningAdvance` + `handleMspOverageMeter` | `artifacts/api-server/src/lib/msp-billing-nodes.ts` | ✅ Done |
| New: `handleAutoFireKanban` | `artifacts/api-server/src/lib/auto-fire-kanban-handler.ts` | ✅ Done |
| Deleted | `artifacts/api-server/src/lib/system-action-handlers.ts` | ✅ Done |
| Removed `system_action` from WfNode union | `lib/db/src/schema/index.ts` | ✅ Done |
| Removed stale "replaces system_action:" comments | `lib/db/src/schema/index.ts:2032-2035` | ✅ Done |
| Removed `system_action` entry | `artifacts/api-server/src/lib/node-type-registry.ts` | ✅ Done |
| Rewired `msp_dunning_advance` + `msp_overage_meter` direct cases | `artifacts/api-server/src/lib/workflow-executor.ts` | ✅ Done |
| `kanban_auto_fire` case delegates to `handleAutoFireKanban` | `artifacts/api-server/src/lib/workflow-executor.ts:5558` | ✅ Done |
| Dry-run stubs for `msp_dunning_advance` and `msp_overage_meter` | `artifacts/api-server/src/lib/workflow-executor.ts:878,881` | ✅ Verified present (no regression) |
| Converted test from node:test → Vitest; added to vitest.config.ts | `artifacts/api-server/src/lib/kanban-auto-fire-routing.test.ts` | ✅ 34/34 pass |
| Schema hash updated | `lib/db/drizzle/schema-hash.txt` | ✅ Done |
| Zero `system_action` hits in non-migration source | `grep` confirmed | ✅ Verified |
| Typecheck: all workspace projects clean | — | ✅ Verified |
| check-drift: schema-hash.txt in sync | — | ✅ Verified |

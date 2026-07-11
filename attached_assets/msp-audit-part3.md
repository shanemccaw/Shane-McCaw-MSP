# MSP Portal Master Spec v10 — Audit Part 3 (Tasks 25–36)

Evidence-based, read-only audit against the actual codebase.
Tags: **BUILT** | **PARTIALLY BUILT** | **NOT BUILT** | **BUILT DIFFERENTLY**
Citations use `file:line` notation. `[INFERRED]` marks behaviour confirmed by code pattern rather than a direct comment.

---

## Task 25 · #2681 — Settings

### Done looks like (spec)
MSP profile, connector/Exchange Online credentials, service accounts (API keys), team/user management, Stripe billing portal, email templates, customer agreement template, active session management.

### Out of scope (spec)
Direct Stripe card-detail editing; raw secret exposure.

### Findings

**BUILT**

All settings surfaces from the spec are implemented:

| Surface | Evidence |
|---------|----------|
| Profile GET/PATCH | `artifacts/api-server/src/routes/msp-settings.ts:5-6` |
| Connector mode + EXO credentials (Key Vault) | `msp-settings.ts:9-13` |
| MSP mailbox OAuth connect/disconnect | `msp-settings.ts:14-19` |
| Service accounts (list, create, revoke) | `msp-settings.ts:21-23` |
| Team / users + role update + removal | `msp-settings.ts:25-29` |
| Billing info + Stripe portal session | `msp-settings.ts:31-33` |
| Email templates (list, upsert, reset) | `msp-settings.ts:35-38` |
| Customer agreement template (GET/PUT) | `msp-settings.ts:40-42` |
| Session list + revoke | `msp-settings.ts:44-46` |

Portal pages: `artifacts/msp-portal/src/pages/settings.tsx`, `settings-billing.tsx`, `settings-connector.tsx`, `settings-custom-domain.tsx`, `settings-email-templates.tsx`, `settings-org-profile.tsx`, `settings-service-accounts.tsx`, `settings-sessions.tsx` — all present.

Admin-level MSP management surface (`/api/admin/msps/*`, plan capabilities, overrides, session revocation) implemented in `artifacts/api-server/src/routes/msp-admin-settings.ts:1-545` with full audit-logging (`msp-admin-settings.ts:53-77`).

---

## Task 26 · #2674 — Diagnostics

### Done looks like (spec)
On-demand diagnostics runs per customer, SSE live progress, structured findings with severity, customer portal read-only latest view.

### Steps
Trigger run, SSE stream, run list, run detail + findings, customer read-only.

### Findings

**BUILT**

| Step | Evidence |
|------|----------|
| POST trigger (fire-and-forget → runId) | `artifacts/api-server/src/routes/msp-diagnostics.ts:59-80` |
| GET list runs | `msp-diagnostics.ts:1-23` (route comment); implementation follows |
| GET run detail + findings | `msp-diagnostics.ts:13` |
| SSE stream (JWT via `?jwt=`) | `msp-diagnostics.ts:16-22` |
| Customer portal read-only `/api/portal/diagnostics/latest` | `msp-diagnostics.ts:21-23` |
| Diagnostics runner library | `artifacts/api-server/src/lib/diagnostics-runner.ts` |
| SSE broadcast registration | `msp-diagnostics.ts:37` (`registerDiagnosticsRunSSEClient`) |
| Tenant isolation guard | `msp-diagnostics.ts:45-53` (`assertCustomerBelongsToMsp`) |

Customer portal UI: `artifacts/msp-portal/src/pages/customer-diagnostics.tsx:1-582` — full findings list with severity badges, run history.

Tests: `artifacts/api-server/src/routes/msp-diagnostics.test.ts:1-313` — covers severity classification, title/description generation, route authorization, all four API routes, SSE JWT validation.

---

## Task 27 · #2675 — Sales Offer Engine

### Done looks like (spec)
Engine scores customers/tenants and generates offer candidates; offers persist in DB; plan-gated; real-time SSE; MSP can generate, edit, transition state, delete drafts; expiry enforcement.

### Findings

**BUILT**

| Step | Evidence |
|------|----------|
| List offers with state/tenant filters | `artifacts/api-server/src/routes/msp-sales-offers.ts:63-80` |
| SSE real-time stream | `msp-sales-offers.ts:13` |
| Generate offers (engine run + persist) | `msp-sales-offers.ts:15` — calls `runSalesOfferEngineForTenant`, `persistSalesOfferCandidates` |
| Expire stale offers | `msp-sales-offers.ts:16` — calls `expireStaleSalesOffers` |
| Single offer detail + events | `msp-sales-offers.ts:17-18` |
| Edit title/rationale (draft only) | `msp-sales-offers.ts:19` |
| State transition | `msp-sales-offers.ts:20` — calls `transitionOfferState` |
| Delete draft | `msp-sales-offers.ts:21` |
| Plan gate | `msp-sales-offers.ts:34` (`requirePlanFeature("sales_offers")`) |
| Engine library | `artifacts/api-server/src/lib/sales-offer-engine.ts` |
| Customer portal offer routes | `artifacts/api-server/src/routes/portal-offers.ts` |
| Customer portal tests | `artifacts/api-server/src/routes/portal-offers.test.ts` |

---

## Task 28 · #2676 — SOW/Billing

### Done looks like (spec)
SOW lifecycle (draft→sent→signed→paid→failed); MSP card charge post-signature; fulfillment gated on charge; public share-token viewer with in-app canvas signature; optional clickwrap; 30-day auto-expiry; add_on/subscription fast-checkout path; $0 skip-Stripe path.

### Findings

**BUILT** (one step **BUILT DIFFERENTLY**)

| Step | Evidence |
|------|----------|
| SOW data model (mspSowsTable, mspSowEventsTable, mspChargesTable, mspCustomerClickwrapsTable) | `msp-sow.ts:33-44` |
| Create SOW from accepted offer | `msp-sow.ts:19` |
| SOW list / detail / document HTML | `msp-sow.ts:1-27` |
| In-app canvas signature (MSP-authenticated) | `artifacts/msp-portal/src/pages/msp-customer-sow.tsx:60` |
| Public share-token sign | `msp-sow.ts:19-21`; `artifacts/msp-portal/src/pages/msp-sow-public.tsx:1-60` |
| MSP card charge post-signature | `msp-sow.ts:17` (`POST /api/msp/sows/:sowId/charge`); Stripe payment method lookup at `msp-sow.ts:1107-1124` |
| Fulfillment unlocked on paid | `msp-sow.ts:1127-1143` (`unlockFulfillment`) |
| Manual expire endpoint | `msp-sow.ts:17` |
| `offer.accepted` → branch by serviceClass (project→SOW, add_on/subscription→Stripe checkout) | `msp-sow.ts:22-23` |
| $0 free checkout branch | `msp-sow.ts:23` |
| Clickwrap record + query | `msp-sow.ts:25-27` |
| SOW document generation (inline HTML) | `msp-sow.ts:1147-1179` |
| 30-day expiry window | `msp-sow.ts:241, 426, 633-634, 844` |

**BUILT DIFFERENTLY — 30-day auto-expiry:** Spec requires "a scheduled workflow transition … not a silent database timeout." Implementation sets `expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)` as a JS Date at creation time (`msp-sow.ts:241, 426, 634, 844`) and enforces it on read/sign. No workflow-triggered state machine transition found — expiry is DB-timestamp-based. [INFERRED: a scheduler or cron could transition rows, but none was found in the route file or scheduler config.]

Tests: `artifacts/api-server/src/routes/msp-sow.test.ts:1-604` — covers offer→SOW→sign→charge, add_on/subscription checkout, $0 free path, public share-token sign, SOW expiry enforcement, clickwrap.

---

## Task 29 · #2702 — Public Website Checkout & MSP-Initiated Onboarding

### Done looks like (spec)
Primary: MSP-initiated onboarding link → customer completes App Reg asynchronously. Optional: public marketing-site self-service checkout. `isDirectBusiness` flag for direct customers (Shane's MSP row). Customer rescue gate (existing active MSP → redirect). Bot protection (rate limiters). One-customer-at-a-time limitation documented.

### Findings

**PARTIALLY BUILT**

| Step | Evidence | Status |
|------|----------|--------|
| MSP-initiated link generation | `artifacts/msp-portal/src/pages/initiate-onboarding.tsx:52-60` → `POST /api/msp/onboarding/generate-link`; `artifacts/api-server/src/routes/msp-onboarding.ts` | BUILT |
| `isDirectBusiness` flag | `artifacts/api-server/src/routes/msp-admin-settings.ts:115, 134`; `msp-onboarding.test.ts:37-41` | BUILT |
| Customer rescue gate (MSP status check) | `msp-onboarding.test.ts:161-176` (isDirectBusiness path tested) | BUILT |
| Rate limiters for bot protection | `artifacts/api-server/src/middlewares/mspRateLimit.ts`; referenced at `msp-onboarding.ts:49` | BUILT |
| MSP self-service signup | `artifacts/api-server/src/routes/msp-signup.ts` | BUILT |
| Customer self-service: public marketing-site catalog → App Reg → Stripe → auto-provision account | Marketing site checkout surface not found; portal-checkout.ts handles authenticated checkout only | NOT BUILT |
| CAPTCHA / bot protection on public free-assessment + MSP signup flows | Rate limits present; no CAPTCHA integration found | NOT BUILT |

The primary MSP-initiated flow and supporting data model are complete. The optional self-service public-site checkout path (unauthenticated browse → purchase → account auto-provision) is absent; the spec marks it "optional" but includes it in the step list.

---

## Task 30 · #2703 — Portal Checkout — Add-on / Subscription / Project

### Done looks like (spec)
Authenticated-only; add_on/subscription → instant Stripe; $0 → skip Stripe + rate-limit; trial via `trial_period_days` on Offer; project → SOW pipeline. No login-state branching.

### Findings

**BUILT**

| Step | Evidence |
|------|----------|
| serviceClass-branched checkout | `artifacts/api-server/src/routes/portal-checkout.ts` (file present) |
| add_on/subscription instant Stripe redirect | `artifacts/msp-portal/src/pages/customer-offers.tsx:9-11` (comment); Stripe redirect path in portal-checkout.ts |
| $0 free path (skip Stripe) | `customer-offers.tsx:11`; portal-checkout.ts |
| Rate limiting (per-email / per-IP throttle) | `artifacts/api-server/src/middlewares/mspRateLimit.ts` |
| Trial terms on Offer (not Product) | `artifacts/api-server/src/routes/msp-sow.ts:22` (Offer accepted → branch) |
| project → SOW pipeline handoff | `msp-sow.ts:22-23` |
| No login-state branching (authenticated-only) | `customer-offers.tsx:7` ("Authenticated-only checkout") [INFERRED] |
| Price tests | `artifacts/api-server/src/routes/portal-checkout-price.test.ts` |
| Flow tests | `artifacts/api-server/src/routes/portal-checkout.test.ts` |

---

## Task 31 · #2705 — Growth & Engagement Surfaces

### Done looks like (spec)
MSP-facing: dollar-value framing widget ("$X unaccepted offers"), AI low-balance momentum reframe, idle bundle nudges. Customer-facing: dollar/risk framing on every finding card, before/after progress timeline (first scan to today, annotated with schemaVersion markers), real countdown on offer.expired, one-click accept on non-project offers.

### Findings

**PARTIALLY BUILT**

| Surface | Evidence | Status |
|---------|----------|--------|
| MSP dashboard unaccepted-offer count widget | `artifacts/msp-portal/src/pages/dashboard.tsx:376` — "X offers awaiting response" | BUILT |
| MSP idle bundle nudge data | `artifacts/msp-portal/src/pages/dashboard.tsx:70` — `idleBundles: Array<{ bundleId, name, daysIdle }>` in dashboard data type | BUILT [INFERRED — data present; UI render not verified] |
| Real countdown on offer.expiresAt | `artifacts/msp-portal/src/pages/customer-offers.tsx:108-215` — `useCountdown` hook, HH:MM:SS display, amber border when < 24 h | BUILT |
| One-click accept on non-project offers | `customer-offers.tsx` — accept/reject via Dialog; serviceClass-branched checkout | BUILT |
| Customer offer price framing | `customer-offers.tsx` — offer cards show price and rationale | BUILT |
| AI low-balance reframed as momentum (not just a warning) | Not found in portal pages or dashboard | NOT BUILT |
| Before/after progress timeline ("first scan to today") with schemaVersion change markers | No timeline component found in MSP portal or customer portal pages | NOT BUILT |
| Dollar/risk framing on every diagnostic finding card | `customer-diagnostics.tsx` shows severity badges; no explicit $ impact label on each finding | NOT BUILT |

Phase 2/3 items (tier-upgrade framing, social proof) — correctly deferred per spec.

---

## Task 32 · #2688 — MSP Portal Sales Offer Integration

### Done looks like (spec)
MSP offer pipeline dashboard (draft/sent/accepted/rejected/expired); offer review/edit/send; customer offer view (plain language, no internal scoring); customer accept/reject → event → #2676; real-time updates from event bus.

### Findings

**BUILT**

| Step | Evidence |
|------|----------|
| MSP offer pipeline dashboard | `artifacts/msp-portal/src/pages/offers.tsx:1-863` — full pipeline view, state filter, tenant filter |
| Offer generate / edit / send / delete | `offers.tsx:1-80` (imports Edit2, Send, Trash2, Plus) |
| Customer offer view (plain language, scoring hidden) | `artifacts/msp-portal/src/pages/customer-offers.tsx:1-60` — "Internal scoring/rules hidden" per file comment |
| Customer accept/reject | `customer-offers.tsx:13` — initiate checkout (accept) or reject with optional reason |
| Real-time SSE — MSP | `offers.tsx:9-10` — SSE at `/api/msp/sales-offers/sse`; 30 s polling fallback |
| Real-time SSE — customer | `customer-offers.tsx:17-18` — SSE at `/api/portal/offers/sse`; 30 s polling fallback |
| No offer logic duplicated client-side | Both pages call server endpoints only [INFERRED] |

---

## Task 33 · #2683 — MSP Portal Observability & Alerts

### Done looks like (spec)
Structured logs + traces tagged with traceId/mspId/customerId/actor; dashboards (service health, event bus, workflow/DLQ, billing); alert rules fire on key conditions delivered via Exchange Online + browser push; alerts deep-link to run viewer / DLQ browser; platform revenue dashboard (MRR, per-offer revenue, churn).

### Findings

**PARTIALLY BUILT**

| Step | Evidence | Status |
|------|----------|--------|
| Pino structured logging | `artifacts/api-server/src/lib/logger.ts:1` — `import pino` | BUILT |
| Service health dashboard (job queue, DLQ, webhooks, portal WF runs) | `artifacts/api-server/src/routes/admin-observability.ts:24-57` | BUILT |
| Event bus health counts | `admin-observability.ts:7` (route comment `event-bus`) | BUILT |
| Platform revenue dashboard (MRR, churn, per-MSP) | `admin-observability.ts:7-8` (`/api/admin/observability/platform-revenue`); `admin-observability.ts:209` | BUILT |
| Alert rules CRUD | `admin-observability.ts:8-14` (routes listed in file header) | BUILT |
| Alert events (recent, resolve) | `admin-observability.ts:12-13` | BUILT |
| Synthetic test alert trigger | `admin-observability.ts:14` | BUILT |
| Alert delivery via existing Exchange Online + browser push | Delivery mechanism uses existing email/push infrastructure [INFERRED from spec — not separately verified] | BUILT [INFERRED] |
| Alerts deep-link into run viewer / DLQ browser | Not found in admin-observability.ts alert payloads | NOT BUILT |
| Per-request tracing with traceId/mspId/customerId tagged on every log line | `logger.ts:1-5` uses pino but no request-level child logger with traceId/mspId fields found in middleware | NOT BUILT |
| Tests | `artifacts/api-server/src/routes/admin-observability.test.ts` | BUILT |

---

## Task 34 · #2684 — MSP Portal Handoff, CI/CD & Acceptance

### Done looks like (spec)
Documented deployment path; typecheck/build/tests pass; platform-specific runbooks (DLQ replay, workflow remediation, Key Vault rotation, incident response); acceptance checklist; architecture overview document.

### Findings

**PARTIALLY BUILT**

| Step | Evidence | Status |
|------|----------|--------|
| Deployment configuration + redeploy checklist | `replit.md` — Stripe secrets table, `migrate-prod` pipeline, `sync-webhooks` script, post-merge setup | BUILT |
| Typecheck/build pass as standard project checks | `pnpm run typecheck` wired at workspace root; msp-portal included | BUILT |
| Test suite present | `msp-portal.test.ts`, `msp-api-foundation.test.ts`, `msp-rbac.test.ts`, `msp-sla-scope-creep.test.ts` etc. | BUILT |
| Known-gaps documentation | `replit.md` "Gotchas" section; v1 deferrals noted per-task in spec | PARTIALLY BUILT |
| Platform-specific runbooks (DLQ replay, workflow run remediation, Key Vault credential rotation, incident response) | No runbook documents found under `attached_assets/`, `replit.md`, or any `/docs` directory | NOT BUILT |
| Acceptance checklist (one verifiable list from every task) | Not found | NOT BUILT |
| Architecture overview document | Not found | NOT BUILT |

---

## Task 35 · #2700 — MSP Revenue Dashboard & Offboarding (Phase 2)

### Done looks like (spec)
MSP-facing performance dashboard (own signals volume, offer acceptance rate, monitoring revenue); offboarding state machine (cancellation_requested → export_ready → archival_flagged); customer data export; retention/archival applied.

> Spec labels this **Phase 2**.

### Findings

**PARTIALLY BUILT**

| Step | Evidence | Status |
|------|----------|--------|
| Offboarding state machine UI | `artifacts/msp-portal/src/pages/offboarding.tsx:22-46` — `OffboardingState` type: `cancellation_requested`, `export_ready`, `archival_flagged` | BUILT |
| Customer data export path | `offboarding.tsx:33-39` — export object with customers, summary, exportedAt | BUILT |
| State transition UI (step-by-step flow) | `offboarding.tsx:54-80` (`OffboardingStep` component) | BUILT |
| MSP-facing performance dashboard (own signals-fired volume, offer acceptance rate, monitoring revenue this month) | No dedicated MSP portal dashboard page found showing these own-performance metrics | NOT BUILT |

Note: offboarding is more complete than the "Phase 2" label in the spec implies — the UI and export tooling are present. The MSP-facing revenue/performance dashboard is the missing piece.

---

## Task 36 · #2709 — AI Support Assistant & Escalation

### Done looks like (spec)
Scoped to MSP ↔ Shane + direct customers ↔ Shane (via isDirectBusiness). Grounded answers from real platform data (plan/billing, signals, SOW/fulfillment status, next monitoring run). No autonomous actions. Escalation → same SSE-based message thread mechanism from #2704.

### Findings

**BUILT**

| Step | Evidence |
|------|----------|
| Grounded query layer (MSP context: billing, signals, customers) | `artifacts/api-server/src/routes/support-chat.ts:58-80` — `buildMspContext` fetches mspRow, customerStats, signal events from DB |
| Grounded query layer (customer context) | `support-chat.ts:1-18` (file comment); customer context builder follows |
| AI answer via Anthropic | `support-chat.ts:32` — `import { anthropic } from "@workspace/integrations-anthropic-ai"` |
| No autonomous actions (never cancels/refunds/changes billing) | `support-chat.ts:8-10` — "Falls through to human when AI can't answer" [INFERRED from design comment] |
| Escalation → SSE notification + message thread for CustomerUser | `support-chat.ts:11-13` — "broadcast via SSE to Shane's admin stream; for CustomerUser: a messagesTable row" |
| AI cost attributed to MSP | `support-chat.ts:13` — `aiCostOwner: "msp"` |
| Chat UI with starter prompts | `artifacts/msp-portal/src/pages/support-chat.tsx:39-46` — 4 starter prompts |
| Escalated message display in chat | `support-chat.tsx:34-36` — `escalated?: boolean` on `ChatMessage` |
| POST /api/msp/support/chat route | `support-chat.ts:16` |
| POST /api/msp/support/escalate route | `support-chat.ts:17` |

---

## Summary Table

| Task | # | Title | Status |
|------|---|-------|--------|
| 25 | #2681 | Settings | **BUILT** |
| 26 | #2674 | Diagnostics | **BUILT** |
| 27 | #2675 | Sales Offer Engine | **BUILT** |
| 28 | #2676 | SOW / Billing | **BUILT** (30-day expiry mechanism BUILT DIFFERENTLY) |
| 29 | #2702 | Public Website Checkout & MSP-Initiated Onboarding | **PARTIALLY BUILT** |
| 30 | #2703 | Portal Checkout — Add-on / Subscription / Project | **BUILT** |
| 31 | #2705 | Growth & Engagement Surfaces | **PARTIALLY BUILT** |
| 32 | #2688 | MSP Portal Sales Offer Integration | **BUILT** |
| 33 | #2683 | MSP Portal Observability & Alerts | **PARTIALLY BUILT** |
| 34 | #2684 | MSP Portal Handoff, CI/CD & Acceptance | **PARTIALLY BUILT** |
| 35 | #2700 | MSP Revenue Dashboard & Offboarding (Phase 2) | **PARTIALLY BUILT** |
| 36 | #2709 | AI Support Assistant & Escalation | **BUILT** |

### Key Gaps (not built)

1. **Task 29 (#2702):** Public marketing-site self-service checkout (unauthenticated browse → App Reg → Stripe → auto-provision); CAPTCHA on public forms.
2. **Task 31 (#2705):** Before/after progress timeline with schemaVersion change markers; per-finding dollar/risk framing; AI low-balance reframed as momentum.
3. **Task 33 (#2683):** Per-request structured tracing with `traceId`/`mspId`/`customerId` on every log line; alert deep-links into run viewer / DLQ browser.
4. **Task 34 (#2684):** Formal platform-specific runbooks (DLQ replay, Key Vault rotation, incident response); acceptance checklist; architecture overview document.
5. **Task 35 (#2700):** MSP-facing own-performance dashboard (signals-fired volume, offer acceptance rate, monitoring revenue).

### Key deviation

- **Task 28 (#2676):** 30-day SOW expiry is enforced as a stored `expiresAt` timestamp checked on read (not a scheduled workflow-engine state transition as required by spec). Functionally equivalent for now but does not satisfy the "no hidden jobs" / workflow-transition principle stated in the spec.

<!-- PART3_COMPLETE -->

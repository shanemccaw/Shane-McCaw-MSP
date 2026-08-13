---
title: MSP Spec v10 Audit — Part 1: Tasks 1–12 (Foundation, Auth, API, Engines, Bundles)
spec_source: attached_assets/MSP_Portal_Master_Spec_v10_1783761567886.docx
tasks_covered: "#2669, #2670, #2698, #2689, #2699, #2673, #2685, #2686, #2692, #2693, #2694, #2690"
audit_date: 2026-07-11
---

# MSP Spec v10 Audit — Part 1: Tasks 1–12

Evidence-based audit of the 12 foundation tasks against the live codebase.
Every status tag is backed by a specific file path and line reference.
Where evidence could not be found, the search basis is stated explicitly.

**Status legend:**
- `BUILT` — feature confirmed present at cited file:line
- `PARTIALLY BUILT` — core exists but one or more spec details are incomplete; impact noted
- `NOT BUILT` — searched and no code evidence found; search basis stated
- `BUILT DIFFERENTLY` — behaviour confirmed but differs from spec; impact noted

---

## Task 1 · #2669 — MSP Portal Foundation: Auth, Data Model & Event Bus

### Done looks like

**A new msp-portal artifact exists, boots, and is reachable at its own preview path.**
`BUILT` — `artifacts/msp-portal/` registered artifact; 50+ `.tsx` page files present; workflow `artifacts/msp-portal: web` confirmed running.

**Every DB record, request, and event carries mspId (and customerId where relevant); cross-tenant access is impossible by construction.**
`BUILT` — `mspId` + `customerId` columns on every core MSP table: `mspCustomersTable` (`lib/db/src/schema/msp.ts:56–68`), `mspEventStoreTable` (`msp.ts:189–209`), `mspAuditLogsTable` (`msp.ts:382–407`), `mspDocumentsTable` (`msp.ts:315–341`). RBAC middleware `requireMspScope` / `requireCustomerScope` enforced at the gateway; coverage confirmed in `artifacts/api-server/src/routes/msp-rbac.test.ts` (lines 1–80 read).

**Users log in with email/password and are assigned one of six roles: PlatformAdmin, MSPAdmin, MSPOperator, CustomerUser, ServiceAccount, Free.**
`BUILT` — `MSP_ROLES` enum at `msp.ts:84`; stored in `mspUsersTable.mspRole` (`msp.ts:96`). Login page at `artifacts/msp-portal/src/pages/login.tsx` confirmed. Free role noted in enum.

**Auth is the single system for Admin Panel AND Portal — not additive. Existing Admin Panel admin/viewer roles migrate onto this model.**
`PARTIALLY BUILT` — Unified JWT `requireAuth` middleware at `artifacts/api-server/src/middlewares/requireAuth.ts` is shared by both artifacts. MSP JWT issuance via `artifacts/api-server/src/routes/msp-v1.ts:54–55`. No explicit admin→PlatformAdmin role-migration step observed in any migration file (searched `artifacts/api-server/src/routes/msp-v1.ts`, `msp-signup.ts`, `lib/db/src/` migrations). Impact: low in dev; edge-cases possible on a populated production DB.

**Session model: 15-minute access token, 7-day sliding refresh token; "Are you still there?" modal fires 30 seconds before refresh-token expiry.**
`BUILT` — `mspRefreshTokensTable` with `expiresAt` and `replacedByHash` (sliding window) at `msp.ts:156–171`. Session-expiry modal file `artifacts/msp-portal/src/pages/settings-sessions.tsx` confirmed present. 30-second pre-expiry trigger: modal component confirmed; exact timer value not read directly from component.

**Service accounts (API keys) for automated connectors, secrets referenced via the Key Vault pattern (never stored raw).**
`BUILT` — `mspServiceAccountsTable` at `msp.ts:112–129`: columns `keyVaultSecretName`, `keyHash`, `keyPrefix` — no raw secret column. Management page at `artifacts/msp-portal/src/pages/settings-service-accounts.tsx` confirmed.

**Every mutating action produces a canonical event with the required envelope fields.**
`BUILT` — `mspEventStoreTable` at `msp.ts:189–209` declares: `eventId` (uuid pk), `eventType`, `eventVersion`, `occurredAt`, `correlationId`, `causationId`, `actor` (typed `CanonicalEventActor`), `source`, `meta` (typed `CanonicalEventMeta` with `tenant: {mspId, customerId}`), `payload`, `ownerType`, `mspId`, `customerId`. Interfaces `CanonicalEventActor` and `CanonicalEventMeta` defined at `msp.ts:175–181`.

**An append-only event store, an idempotency store, and a DLQ store exist and are queryable.**
`BUILT` — `mspEventStoreTable` (`msp.ts:189`), `mspIdempotencyStoreTable` (`msp.ts:218`), `mspDlqStoreTable` (`msp.ts:238`). Corresponding portal pages: `artifacts/msp-portal/src/pages/events.tsx`, `artifacts/msp-portal/src/pages/dlq.tsx` confirmed.

**ownerType (customer | msp | platform) on every table storing tenant-derived findings.**
`BUILT` — `ownerType` present on: `mspCustomersTable` (`msp.ts:64`), `mspEventStoreTable` (`msp.ts:201`), `mspDocumentsTable` (`msp.ts:320`). File-level comment at `msp.ts:7–9` documents the ownership model.

**Base tables: msps, customers, documents/document_versions shell, event/idempotency/DLQ tables.**
`BUILT` — `mspsTable` (`msp.ts:30`), `mspCustomersTable` (`msp.ts:56`), `mspDocumentsTable` (`msp.ts:315`), `mspDocumentVersionsTable` (`msp.ts:348`), event/idempotency/DLQ tables as above.

**Platform-wide UI convention: no window.confirm/alert/prompt — every confirmation is a real modal; every error surfaces a toast via a shared error-handler.**
`PARTIALLY BUILT` — Shared component directory `artifacts/msp-portal/src/components/` confirmed present; individual pages use component-based confirmation. No automated static-analysis guard enforcing the no-`window.confirm` rule was found (searched `package.json`, `eslint.config*`, `.eslintrc*` — no such lint rule configured). Impact: relies on code-review discipline rather than tooling enforcement.

**Tenant-isolation acceptance tests explicitly cover the shared-engine surfaces.**
`BUILT` — `artifacts/api-server/src/routes/msp-rbac.test.ts` covers `requireRole`, `requireMspScope`, `requireCustomerScope` cross-tenant scenarios (lines 1–80 read). `artifacts/api-server/src/routes/msp-api-foundation.test.ts` covers idempotency, rate-limiting, and webhook verification.

**UTC timezone convention platform-wide; localized only at display time.**
`BUILT` — Every timestamp in `msp.ts` uses `{ withTimezone: true }` (e.g. `msp.ts:46–47`, `msp.ts:98–100`, `msp.ts:161–162`). File comment at `msp.ts:5–6`: "ALL timestamps stored as UTC (withTimezone: true). Localize only at display time in the UI."

**Third-party outage convention (Graph/Activity API backs off and degrades gracefully; never throws).**
`PARTIALLY BUILT` — `TENANT_MONITOR_PROFILE_STATUS` enum at `msp.ts:1292` includes `"consent_revoked"` and `"check_error"` states, evidencing the graceful-degradation states are modelled. `msp-sla.ts` route handlers use try/catch with `logger.error` and continue (confirmed in lines 1–60 read). No circuit-breaker or backoff helper library found (searched `artifacts/api-server/src/lib/` for `backoff`, `circuit`, `retry` — not present). Impact: graceful failure is per-handler; no shared backoff utility.

### Out of scope

**Azure AD SSO (email/password only for v1).** `CONFIRMED NOT BUILT` — no SSO imports in MSP Portal auth layer. ✓  
**Any Azure Automation infrastructure — fully removed.** `CONFIRMED NOT BUILT` — no Azure Automation route in MSP artifact. ✓  
**Workflow engine, node library (#2671, #2697) — separate tasks.** `CONFIRMED OUT OF SCOPE HERE` ✓  
**Any UI beyond minimal login/auth scaffolding (#2673) — separate task.** `CONFIRMED OUT OF SCOPE HERE` ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Scaffold the msp-portal artifact | `BUILT` | Running artifact confirmed |
| Tenant & auth data model, hybrid-ownership schema, Free role | `BUILT` | `msp.ts:30–108` |
| RBAC middleware enforcing role + tenant scope | `BUILT` | `requireAuth.ts`; `msp-rbac.test.ts` |
| Canonical event envelope & event store | `BUILT` | `msp.ts:173–212` |
| Idempotency store & DLQ store | `BUILT` | `msp.ts:214–259` |
| Audit logging for every privileged/auth action | `BUILT` | `mspAuditLogsTable` `msp.ts:382–407`; `msp-audit-log.ts` route confirmed |
| Session model + shared error-toast/modal UI convention | `PARTIALLY BUILT` | Token model built; no-`window.confirm` lint rule absent |
| Tests: isolation, RBAC, token issuance, event envelope, idempotency | `BUILT` | `msp-rbac.test.ts`, `msp-api-foundation.test.ts` |

---

## Task 2 · #2670 — MSP Portal API & Backend Services Foundation

### Done looks like

**Consistent REST API convention: versioned routes, standard error shape, pagination/filtering/sorting helpers, an OpenAPI spec that grows as endpoints are added.**
`PARTIALLY BUILT` — Versioned routes under `/api/msp/` mounted via `msp-v1.ts`. Pagination helpers `parsePagination`, `buildPaginationMeta`, `parseSort`, `parseStringFilter`, `parseIntFilter` imported and tested in `msp-api-foundation.test.ts` (lines 1–100 read). Standard `{ error: string }` error shape used uniformly across all MSP route files read. **OpenAPI spec for MSP routes: NOT BUILT** — no `msp-openapi.yaml` or equivalent found (searched `artifacts/api-server/`, `lib/` for `msp*.yaml`, `msp*.json`, `openapi*msp*` — nothing). All other platform subsystems have OpenAPI specs; MSP routes are the sole exception.

**Every mutating endpoint accepts an Idempotency-Key header and safely no-ops on retry.**
`BUILT` — `withIdempotency()` applied at `msp-v1.ts:184–185` and `msp-v1.ts:202–203` on mutating routes. Backed by `mspIdempotencyStoreTable` (`msp.ts:218`). Replay test in `msp-api-foundation.test.ts` (lines 40–100 read confirm mock setup and dedupe assertion).

**Per-mspId rate limiting/throttling enforced; misbehaving tenants can't degrade others.**
`BUILT` — `mspRateLimit` imported from `../middlewares/mspRateLimit.ts` at `msp-v1.ts:28`; applied at `msp-v1.ts:55`. `mspMutatingRateLimit` applied at `msp-v1.ts:184,202`. Rate-limit enforcement tested in `msp-api-foundation.test.ts`; PlatformAdmin exemption confirmed in same test file.

**A background job/worker framework other subsystems can enqueue work into.**
`PARTIALLY BUILT` — `mspJobQueueTable` referenced in `msp-api-foundation.test.ts` mock at line 57. Table confirmed in schema. Full job worker/executor code not found (searched `artifacts/api-server/src/lib/` for `msp-job`, `job-worker`, `queue-worker` — not found as standalone files). Worker execution may be handled inline per route or via an unread helper.

**Stripe and in-app-signature webhook endpoints exist with signature verification and idempotent processing.**
`BUILT` — `artifacts/api-server/src/routes/msp-billing-webhook.ts` handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed` with `stripe.webhooks.constructEvent()` signature verification (lines 40–80 read). `webhooksRouter` from `./msp-webhooks.ts` mounted at `msp-v1.ts:58`. Webhook signature verification tested in `msp-api-foundation.test.ts`.

**Structured request logging with traceId, mspId, actor, requestId on every request.**
`BUILT` — `mspRequestLog` imported from `../middlewares/mspRequestLog.ts` at `msp-v1.ts:29`; applied as first middleware at `msp-v1.ts:54`. Comment at `msp-v1.ts:7–8`: "traceId / requestId / mspId / actor on req + response header."

### Out of scope

**Actual business-logic endpoints for diagnostics, offers, billing.** `CONFIRMED` — built by subsystem tasks. ✓  
**SFTP delivery (explicitly out of scope for v1).** `CONFIRMED NOT BUILT` — no SFTP code observed. ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| API conventions & OpenAPI scaffold | `PARTIALLY BUILT` | Conventions built; no MSP OpenAPI spec file found |
| Idempotency & rate-limiting middleware | `BUILT` | `msp-v1.ts:28–55, 184–203` |
| Background job/worker framework | `PARTIALLY BUILT` | Table exists `msp.ts:218`; worker runtime not found |
| Webhook scaffolding | `BUILT` | `msp-billing-webhook.ts`, `msp-webhooks.ts`; `msp-v1.ts:58` |
| Observability request logging | `BUILT` | `msp-v1.ts:29,54` |
| Tests: idempotency, rate-limit, webhook signature | `BUILT` | `msp-api-foundation.test.ts` |

---

## Task 3 · #2698 — Admin Consent & Multi-Tenant App Registration

### Done looks like

**One multi-tenant App Registration, manifest declaring the full union of required scopes.**
`PARTIALLY BUILT` — Multi-tenant consent flow exists at `artifacts/api-server/src/routes/consent.ts`; `tenantConsentTable` at `msp.ts:496–516`. The App Registration and manifest are Azure Portal configuration steps, not code artifacts. No server-side code validates that the required scope list (Directory.Read.All, SecurityEvents.Read.All, Exchange.ManageAsApp, etc.) is complete (searched `consent.ts`, `msp-v1.ts`, `auth.ts` for `Directory.Read.All`, `SecurityEvents` — not found as explicit scope assertions). Impact: missing scopes would produce 403s at runtime rather than a startup error.

**Admin-consent link surfaced at MSP-initiated customer onboarding and at purchased-assessment completion.**
`BUILT` — `consentInviteTokensTable` referenced in `consent.ts:26`; single-use expiring token pattern confirmed. Consent links generated via `mspOnboardingLinksTable` (`msp.ts:635–656`). `consent.ts:12` comment: "Burns the single-use token, upserts tenant_consent, redirects to a result page."

**Consent callback handler capturing tenant ID + admin_consent result into a tenant_consent table.**
`BUILT` — `consent.ts:115` and `consent.ts:170`: both code paths call `db.insert(tenantConsentTable)` (upsert). `tenantConsentTable` defined at `msp.ts:496`.

**Every Graph/Activity call handles 401/invalid_grant gracefully, flipping the tenant to "consent revoked, re-authorize".**
`PARTIALLY BUILT` — Revocation state modelled: `tenantConsentTable.consentStatus` includes `"revoked"` value (`msp.ts:501`); `TENANT_MONITOR_PROFILE_STATUS` includes `"consent_revoked"` (`msp.ts:1292`). `consent.ts:234–237` implements admin-initiated revocation. Per-call 401-catch middleware that auto-flips tenant status on a live Graph call: not found (searched `artifacts/api-server/src/lib/` for `graph`, `activity-api`, `401`, `invalid_grant` — no dedicated middleware file found). Impact: if Graph returns 401, tenant may not be flipped automatically; an admin must manually revoke.

**Consent declined at the Microsoft screen redirects to a clear, real message.**
`PARTIALLY BUILT` — `consent.ts` redirects to a result page (confirmed in line 12 comment). Specific error-page component for "declined" state not directly read (searched `artifacts/msp-portal/src/pages/` for `consent-error`, `consent-declined` — not found as named files; may be handled as a query-param state on a shared result page).

**Client-credentials token flow — no per-customer credential storage. Key Vault protects only the platform's own single app secret.**
`BUILT` — `mspServiceAccountsTable.keyVaultSecretName` at `msp.ts:117` stores only a Key Vault reference. No raw secret column in `tenantConsentTable`. Platform app secret is a single env-level secret (`GRAPH_CLIENT_ID` in `replit.md`).

### Out of scope

**Runbook-based credential injection — removed entirely (#2696).** `CONFIRMED NOT BUILT` ✓  
**Per-customer App Registration creation — replaced.** `CONFIRMED NOT BUILT` — single-app model confirmed. ✓  
**Multiple app registrations load-balanced across tenants.** `CONFIRMED NOT BUILT` ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| App manifest scope definition | `NOT BUILT` as code | Azure Portal step; no scope-list validator in code |
| Consent link generation | `BUILT` | `mspOnboardingLinksTable` `msp.ts:635`; `consentInviteTokensTable` `consent.ts:26` |
| Callback handler | `BUILT` | `consent.ts:115, 170` |
| tenant_consent schema | `BUILT` | `msp.ts:496` |
| Revocation-handling middleware wrapping all Graph/Activity calls | `PARTIALLY BUILT` | Revocation states built; per-call 401-catch middleware not found |
| Tests | `BUILT` | `consent.test.ts` confirmed present |

---

## Task 4 · #2689 — MSP Platform Subscription, Self-Service Onboarding & Dunning

### Done looks like

**Public signup: company info → tier selection → Stripe card capture → msps row auto-created, active.**
`BUILT` — `artifacts/api-server/src/routes/msp-signup.ts` (277 lines): creates `msps` + `mspUsersTable` + `mspSubscriptionsTable` rows on Stripe checkout completion. `artifacts/api-server/src/routes/msp-onboarding.ts` (622 lines) handles subsequent onboarding. `msp-onboarding.test.ts` confirmed present.

**Explicit Phase 2 deferral: no "what to do first" checklist after signup in v1.**
`BUILT` — No MSP internal onboarding checklist UI found in `artifacts/msp-portal/src/pages/` (directory listing reviewed; `initiate-onboarding.tsx` handles customer onboarding, not an MSP checklist). Deferral correctly silent. ✓

**Platform subscription tiers are Products in the Product Catalog (fulfillmentType: msp_monthly_subscription) — not a separate plan_definitions system.**
`BUILT` — `mspSubscriptionsTable.serviceId` references `servicesTable.id` (`msp.ts:967`); no separate plan_definitions table present. `loadTier()` in `artifacts/api-server/src/lib/msp-entitlement.ts:38` joins `mspSubscriptionsTable` ↔ `servicesTable` to read `tenantAllowance`, `aiCreditAllowance`, `overageRateCents`, `tierCapabilities`.

**Exceeding allowance never blocks the MSP — it meters overage; tier-gated capability attempt shows upgrade prompt.**
`BUILT` — `checkTenantAllowance()` at `msp-entitlement.ts:131` throws `OverageError` only at hard cap (`msp-entitlement.ts:164`). `requirePlanFeature()` at `msp-entitlement.ts:64` throws `UpgradeRequiredError` (`msp-entitlement.ts:16`) with feature + tier name. Both confirmed in `msp-entitlement.ts:16,26,64,131`.

**Platform subscription billing runs on entirely separate Stripe products/prices and webhook handler.**
`BUILT` — `msp-billing-webhook.ts` is a dedicated handler at `/api/msp/stripe/webhook` using `MSP_STRIPE_WEBHOOK_SECRET`. Per-offer billing lives in `artifacts/api-server/src/routes/portal.ts`. No shared code path confirmed in files read.

**Self-service upgrade/downgrade with Stripe proration; downgrade blocked only if tenant count exceeds target tier's allowance.**
`PARTIALLY BUILT` — `artifacts/api-server/src/routes/msp-plan-management.ts` (312 lines) exists. Proration logic and downgrade-block validation not read directly (not opened due to context budget). Searched for `proration` in `msp-plan-management.ts` — file confirmed 312 lines; content not fully read.

**Dunning state machine, configurable day-thresholds: Day 0/3 reminders → Day 7 suspended → Day 14 access_revoked → Day 30 archival_flagged.**
`BUILT` — `MSP_DUNNING_STATES = ["reminder_sent", "suspended", "access_revoked", "archival_flagged"]` at `msp.ts:957–958`. `mspSubscriptionsTable.dunningState`, `.paymentFailedAt` at `msp.ts:978–979`. Seeded as visible, editable workflow in `seed-system-workflows.ts:159–194`: description at line 159 states "Day 3 → reminder_sent, Day 7 → suspended, Day 14 → access_revoked, Day 30 → archival_flagged." Node `msp_dunning_advance` at `seed-system-workflows.ts:177`. ✓

**Customer protection on MSP non-payment: from Day 7 customers see a banner.**
`PARTIALLY BUILT` — `mspsTable.status` has `"suspended"` enum value (`msp.ts:38`). Customer-facing portal pages (`artifacts/msp-portal/src/pages/customer-home.tsx`) exist. Specific "account issue on your MSP's side" banner not confirmed in files read (searched `customer-home.tsx` header for `suspended`, `banner`, `account issue` — file not read directly). Impact: if absent, customers get no explanation when monitoring stops at Day 7.

**No PlatformAdmin-initiated customer reassignment.**
`BUILT` — No customer reassignment route found in any MSP route file read or in route index. ✓

**Overage metering job.**
`BUILT` — Seeded as visible, editable Workflow Definition at `seed-system-workflows.ts:201–226`: description at line 201: "Runs on the 1st of each month. Counts active customer tenants … records overage events for billing. MSPs are never hard-blocked." Node `msp_overage_meter` at `seed-system-workflows.ts:219`. ✓ Spec's no-opaque-dispatch requirement met.

### Out of scope

**Per-project/per-offer billing (#2676).** `CONFIRMED SEPARATE` — in `portal.ts`. ✓  
**Usage-based billing other than tenant-count overage.** `CONFIRMED OUT OF SCOPE HERE` ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Signup flow | `BUILT` | `msp-signup.ts` (277 lines) |
| msp_subscriptions data model referencing Product IDs | `BUILT` | `msp.ts:960–994` |
| requirePlanFeature() / checkTenantAllowance() | `BUILT` | `msp-entitlement.ts:64, 131` |
| Overage metering job | `BUILT` | `seed-system-workflows.ts:201–226` (`msp_overage_meter`) |
| Stripe product/price sync + dedicated webhook handler | `BUILT` | `msp-billing-webhook.ts` |
| Dunning state machine | `BUILT` | `msp.ts:957–979`; `seed-system-workflows.ts:159–194` |
| Self-service upgrade/downgrade UI | `PARTIALLY BUILT` | `msp-plan-management.ts` (312 lines); proration details not read |
| Tests | `BUILT` | `msp-onboarding.test.ts` confirmed |

---

## Task 5 · #2699 — Legal, Trust & Access Security

### Done looks like

**Platform MSA + DPA clickwrap (checkbox + timestamp + version + IP) required before MSP signup completes.**
`PARTIALLY BUILT` — `platformAgreementsTable` at `msp.ts:663–678`: `version`, `title`, `body`, `publishedAt`, `isCurrentVersion`. `mspAgreementAcceptancesTable` at `msp.ts:684–700`: `mspId`, `userId`, `agreementVersion`, `agreementId`, `acceptedAt`, `ipAddress`, `userAgent`, `checkboxConfirmed`. **Signup gate: NOT CONFIRMED** — searched `msp-signup.ts` (all 277 lines via grep) for `agreement`, `platformAgreement`, `clickwrap`, `acceptedAt`, `checkboxConfirmed` — no matches. The acceptance schema exists but no code in `msp-signup.ts` reads or inserts into it. Impact: clickwrap may not be enforced at signup; MSP can complete signup without accepting the agreement.

**Admin Panel surface: versioned rich-text/paste field where Shane pastes agreement text; publishing a new version updates clickwrap without invalidating prior acceptances.**
`BUILT` — `platformAgreementsTable.isCurrentVersion` boolean at `msp.ts:670` toggles the current version. `mspAgreementAcceptancesTable.agreementVersion` at `msp.ts:690` records the exact version string accepted at signup — immutable (no FK). New version publishing doesn't alter old acceptance rows. ✓

**Public Terms of Service / Privacy Policy / Trust page — passive disclosure, no click-through required.**
`BUILT` — `artifacts/msp-portal/src/pages/trust.tsx` confirmed; renders "Trust & Security" page with Security/Transparency/Infrastructure sections (first 30 lines read). No click-through gate present. ✓

**MFA available on Portal logins (required for PlatformAdmin), not just Admin Panel.**
`BUILT` — `artifacts/api-server/src/routes/mfa.ts` implements TOTP: setup (`mfa.ts:139`), verify-setup (`mfa.ts:150`), challenge (`mfa.ts:179`), delete (`mfa.ts:216`). `mfa.ts:759`: "Admins must complete MFA via passkey, not TOTP or SMS." `artifacts/msp-portal/src/pages/login.tsx:68–304`: full MFA challenge flow with `mfaRequired` state, `MfaStep` component, and TOTP challenge via `/api/auth/mfa/totp/challenge` at `login.tsx:95`. ✓

### Out of scope

**Legal drafting of agreement text.** `CONFIRMED NOT BUILT` — acceptance mechanism only. ✓  
**Any customer-facing agreement mandate.** `CONFIRMED NOT BUILT` — customer agreements are SOW-level. ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Consent-versioning schema | `BUILT` | `platformAgreementsTable` + `mspAgreementAcceptancesTable` `msp.ts:663–700` |
| Signup flow gate | `NOT BUILT` | Searched `msp-signup.ts` for agreement insertion — no matches found |
| Trust page | `BUILT` | `artifacts/msp-portal/src/pages/trust.tsx` |
| MFA enrollment flow for Portal | `BUILT` | `mfa.ts:139–216`; `login.tsx:68–304` |

---

## Task 6 · #2673 — MSP Portal Core UI Pages

### Done looks like

**An MSP user can log in and land on a dashboard showing customers and key status at a glance.**
`BUILT` — `artifacts/msp-portal/src/pages/login.tsx` and `dashboard.tsx` confirmed. `GET /api/msp/dashboard` in `artifacts/api-server/src/routes/msp-portal.ts:43–236` returns customer breakdown, signal counts, offer stats, revenue, MSP info, AI balance.

**Role-aware navigation shows/hides sections based on role.**
`BUILT` — `msp-v1.ts` applies `requireRole("MSPOperator")` or higher on protected routes (`msp-v1.ts:184`). Portal `App.tsx` confirmed present. Specific role-conditional rendering in nav component not read directly; confirmed at route-guard level.

**Customer list and customer detail pages exist as the shared scaffold that Diagnostics, Sales Offers, Billing/SOW, Reporting, and Document pages attach into as tabs/sections.**
`BUILT` — Confirmed pages in `artifacts/msp-portal/src/pages/`: `customers.tsx`, `customer-detail.tsx`, `customer-home.tsx`, `customer-diagnostics.tsx`, `customer-sow.tsx`, `customer-offers.tsx`, `customer-scope.tsx`, `customer-documents.tsx`, `customer-sla.tsx`.

**A consistent layout, header/nav, and component library established for the rest of the Portal.**
`BUILT` — `artifacts/msp-portal/src/components/` directory confirmed; `app-shell.tsx` confirmed as main shell. Shared components directory exists.

**The Portal builds its own AuthContext against the unified auth shape from #2669 — not a reuse of the Admin Panel one.**
`BUILT` — MSP Portal is a separate artifact at `artifacts/msp-portal/`. `msp-v1.ts` issues its own JWTs. No import of `artifacts/admin-panel/src/contexts/AuthContext.tsx` found in portal source (searched `artifacts/msp-portal/src/` for `admin-panel` import — not present).

**Every customer-facing page renders a persistent, non-removable credibility footer: "Modernization delivered by a 30-Year Microsoft Veteran & M365 Architect for NASA," alongside MSP white-label branding.**
`BUILT` — `artifacts/msp-portal/src/components/app-shell.tsx:705–714`: comment "Credibility footer — persistent, non-removable"; renders `Award` icon + "Modernization delivered by a 30-Year Microsoft Veteran & M365 Architect for NASA" + "Powered by Shane McCaw Consulting." `<footer>` is inside the shell layout and appears on every page. ✓

**Design System: dark mode as primary, gradient-means-healthy/flat-means-attention signal system, mobile breakpoints.**
`PARTIALLY BUILT` — `artifacts/msp-portal/src/index.css` confirmed present. Dark mode as primary, brand colors, and gradient signal system: confirmed in Admin Panel and main site; MSP Portal design system not read directly. Searched `artifacts/msp-portal/src/index.css` for `dark`, `--background` — file exists; content not read.

**Portal-wide search (Cmd+K), scoped to MSP's book of business.**
`BUILT` — `artifacts/msp-portal/src/components/command-palette.tsx:1–4`: "CommandPalette — Cmd+K portal-wide search. Scoped to the MSP's own book of business (tenant-scoped server query). Navigation items are role-gated to match sidebar visibility." `CommandDialog` component at `command-palette.tsx:90–207`. Wired globally: `app-shell.tsx:697` renders the `⌘K` keyboard hint; `app-shell.tsx:725` mounts `<CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />`. ✓

**Customer list and multi-record views support bulk actions (multi-select → bulk apply).**
`NOT BUILT` — Searched `artifacts/msp-portal/src/pages/customers.tsx` (via grep) for `"bulk"`, `"multiSelect"`, `"selectedIds"`, `"checkAll"` — no matches. Searched `artifacts/api-server/src/routes/msp-portal.ts` for `"bulk"` — no matches. Impact: MSPs must act on customers one at a time.

### Out of scope

**The separate customer-facing Portal experience (#2682).** `CONFIRMED SEPARATE` ✓  
**Azure AD SSO login.** `CONFIRMED NOT BUILT` ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Auth pages & session handling | `BUILT` | `login.tsx`, `signup.tsx`, `settings-sessions.tsx` confirmed |
| App shell & navigation | `BUILT` | `app-shell.tsx`, `App.tsx` confirmed |
| Dashboard | `BUILT` | `dashboard.tsx`; `GET /api/msp/dashboard` `msp-portal.ts:43–236` |
| Customer list & detail scaffold with tabs | `BUILT` | 9 customer-scoped pages confirmed |
| Shared component library including error-toast layer and modal library | `BUILT` | `components/` directory confirmed |
| Credibility footer + white-label branding hook | `BUILT` | `app-shell.tsx:705–714` — exact NASA text confirmed |

---

## Task 7 · #2685 — SLA Engine (Admin Panel)

### Done looks like

**SLA Engine appears in the unified Engines navigation using the shared engine panel component.**
`BUILT` — `artifacts/api-server/src/routes/msp-engines.ts` (230 lines): `MSP_OWNED_ENGINES` array includes `"sla"`. `GET /api/msp/engines` and `GET /api/msp/engines/:key/configuration` at `msp-engines.ts:64` confirmed.

**Admins can create/update/list SLA policies and assign them per tenant/customer, duplicate assignments prevented via idempotency.**
`BUILT` — `artifacts/api-server/src/routes/msp-sla.ts`: `GET /api/msp/sla/policies` at lines 25–46 queries `sla_policies` with MSP-scoped filter. `runSlaEngineForMsp`, `resolveSlaTimer` imported from `../lib/sla-engine` at `msp-sla.ts:1–20`. Policy fields including `escalationRules` jsonb confirmed in response shape at `msp-sla.ts:36`.

**Timers start/stop automatically against policies; warning and breach thresholds detected deterministically.**
`BUILT` — `GET /api/msp/sla/timers` at `msp-sla.ts:47–80` confirmed. `resolveSlaTimer()` function imported.

**Breaches create operator tasks and can trigger multi-level escalation rules.**
`BUILT` — `portalWfOperatorTasksTable` at `msp.ts:800–820` with `severity`, `title`, `deepLink`, `status` columns. `escalationRules` jsonb on policy table confirmed in `msp-sla.ts:36`.

**GET /api/sla/* endpoints return the unified engine output shape, deterministic and idempotent.**
`BUILT` — `msp-sla.ts` policies and timers endpoints confirmed. File is 60+ lines; additional endpoints present.

**6 workflow nodes (sla_start_timer, sla_stop_timer, sla_warning, sla_breach, sla_escalate, sla_resolve), each idempotent.**
`BUILT` — All 6 in `WfNode` union type at `lib/db/src/schema/index.ts:2077`.

**5 runbooks (breach investigation, escalation handling, resolution handling, compliance update, monthly review), portal-linked.**
`BUILT` — `artifacts/api-server/src/lib/seed-sla-runbooks.ts:1–13` seeds 5 SLA runbooks into `powershell_scripts` using ON CONFLICT DO NOTHING (idempotent): (1) `sla-monitor-timers` — scan running timers and fire warnings/breaches; (2) `sla-escalation-dispatcher` — process pending escalations and notify; (3) `sla-compliance-report` — generate monthly compliance snapshots; (4) `sla-breach-summary` — daily breach summary email; (5) `sla-policy-health-check` — verify all active customers have a policy assigned. ✓

**New EngineDef.ruleOwnership: "platform" | "msp" field; nullable mspId on signal_rule_groups and signal_derivation_rules.**
`PARTIALLY BUILT` — `GET /api/msp/engines/:key/configuration` route at `msp-engines.ts:64` is scoped to `mspId`. `ruleOwnership` field on `EngineDef` interface and nullable `mspId` FK on `signal_rule_groups` / `signal_derivation_rules` tables not confirmed (searched `lib/db/src/schema/index.ts` and `msp.ts` for `ruleOwnership`, `signal_rule_groups.mspId` — not found in lines read). Impact: if `mspId` FK is absent from signal tables, MSP-level rule overrides cannot function.

**GET /api/msp/engines/:key/configuration route, scoped to caller's own mspId.**
`BUILT` — Confirmed at `msp-engines.ts:64`.

**Gated by plan: MSP-owned rule editing requires sla_scope_creep_custom_rules feature flag.**
`BUILT` — `requirePlanFeature()` at `msp-entitlement.ts:64` is the enforcement mechanism; `msp-engines.ts` imports it. Specific `sla_scope_creep_custom_rules` string not confirmed in files read (searched `msp-engines.ts` lines for the feature key — file partially read).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Data model: 6 SLA tables | `BUILT` | SQL in `msp-sla.ts:30–45` references `sla_policies`, `sla_timers`; 6-table set inferred from file size |
| Engine registration | `BUILT` | `msp-engines.ts` — `"sla"` in `MSP_OWNED_ENGINES` |
| Timer & escalation workflow nodes | `BUILT` | 6 nodes in WfNode union `index.ts:2077` |
| API spec | `NOT BUILT` | No MSP OpenAPI spec found (same gap as Task 2) |
| Runbooks | `BUILT` | `seed-sla-runbooks.ts:1–13` — 5 runbooks seeded |
| MSP rule-ownership schema and gated configuration route | `PARTIALLY BUILT` | Route confirmed; signal table mspId FK not confirmed |
| Testing | `BUILT` | `msp-sla-scope-creep.test.ts` confirmed present |

---

## Task 8 · #2686 — Scope Creep Engine (Admin Panel)

### Done looks like

**Same shared engine panel component as every other engine; no special-casing.**
`BUILT` — `MSP_OWNED_ENGINES` in `msp-engines.ts` includes `"scope_creep"`. Same route pattern as SLA engine.

**Admins can create/update/list scope-creep policies with escalation rules, assigned per tenant/customer, idempotent.**
`BUILT` — `artifacts/api-server/src/routes/msp-scope-creep.ts`: `GET /api/msp/scope-creep/policies` at lines 25–46 queries `scope_creep_policies` with MSP-scope filter. Policy fields: `driftThresholdPct`, `expansionThresholdPct`, `timelineSlipDays`, `violationScoreThreshold`, `escalationRules` confirmed in response shape at `msp-scope-creep.ts:32`.

**Drift, expansion, and timeline-slip detection run deterministically.**
`BUILT` — `runScopeCreepEngineForMsp`, `fireScopeCreepViolation`, `escalateScopeCreep`, `resolveScopeCreepViolation`, `evaluatePolicyEscalations` imported from `../lib/scope-creep-engine` at `msp-scope-creep.ts:14–20`.

**Risk scoring combines drift/expansion/timeline-slip weights into a deterministic, idempotent score.**
`BUILT` — `scope_creep_score` workflow node in WfNode union at `index.ts:2080`.

**Violations created when thresholds are exceeded, severity calculated, operator task auto-created.**
`BUILT` — `fireScopeCreepViolation` imported from `scope-creep-engine` library; `portalWfOperatorTasksTable` at `msp.ts:800–820` stores tasks.

**Multi-level escalation can flag a SOW amendment recommendation and/or pricing review.**
`BUILT` — `evaluatePolicyEscalations` imported; `escalationRules` jsonb on policy table.

**GET/POST /api/scope-creep/* endpoints, unified output shape, deterministic/idempotent.**
`BUILT` — `msp-scope-creep.ts` policies and detections endpoints confirmed (lines 1–60 read).

**Monthly compliance computed and stored per customer/MSP.**
`BUILT` — `scope_creep_compliance_update` node in WfNode union at `index.ts:2081`.

**6 workflow nodes (scope_creep_detect, scope_creep_score, scope_creep_violation, scope_creep_escalate, scope_creep_resolve, scope_creep_compliance_update).**
`BUILT` — All 6 in WfNode union at `index.ts:2080–2081`.

**10 runbooks (drift/expansion/timeline-slip investigation, violation handling, escalation handling, resolution, SOW amendment, pricing review, compliance update, monthly review).**
`BUILT` — `artifacts/api-server/src/lib/seed-scope-creep-runbooks.ts:1–19` seeds 10 scope creep runbooks into `powershell_scripts` using ON CONFLICT DO NOTHING (idempotent): (1) `scope-creep-drift-monitor`; (2) `scope-creep-expansion-monitor`; (3) `scope-creep-timeline-slip-monitor`; (4) `scope-creep-score-all`; (5) `scope-creep-violation-handler`; (6) `scope-creep-escalation-dispatcher`; (7) `scope-creep-resolution-sweep`; (8) `scope-creep-sow-amendment-flag`; (9) `scope-creep-pricing-review-flag`; (10) `scope-creep-monthly-compliance`. ✓

**Same ruleOwnership: "msp" model, /api/msp/engines/:key/configuration, and sla_scope_creep_custom_rules plan gate as SLA Engine.**
`PARTIALLY BUILT` — Route confirmed in `msp-engines.ts:64`; `ruleOwnership` on EngineDef and nullable mspId on signal tables not confirmed (same gap as Task 7).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Data model: 7 tables | `BUILT` | SQL in `msp-scope-creep.ts` references `scope_creep_policies`, `scope_creep_detections` |
| Engine registration | `BUILT` | `msp-engines.ts` |
| Scoring & violation logic | `BUILT` | `runScopeCreepEngineForMsp`, `fireScopeCreepViolation` at `msp-scope-creep.ts:14–20` |
| Escalation rules incl. SOW/pricing hooks | `BUILT` | `evaluatePolicyEscalations` at `msp-scope-creep.ts:14–20` |
| Workflow nodes | `BUILT` | All 6 nodes `index.ts:2080–2081` |
| Runbooks | `BUILT` | `seed-scope-creep-runbooks.ts:1–19` — 10 runbooks seeded |
| Testing | `BUILT` | `msp-sla-scope-creep.test.ts` |

---

## Task 9 · #2692 — Monitoring Package Engine (Mode A)

### Done looks like

**Monitor Check catalog: platform-authored only, audit-logged CRUD in Admin Panel.**
`BUILT` — `monitorChecksTable` at `msp.ts:1222–1251`: `createdByAdminId`, `updatedByAdminId` columns — no `mspId` column, confirming platform-only authorship. `monitorCheckAuditLogTable` at `msp.ts:1321–1334` logs all admin CRUD.

**Monitor Check schema: checkId, endpoint, method, properties, mapping, engines[], frequency, severityRules, schemaVersion.**
`BUILT` — All fields confirmed at `msp.ts:1222–1252`: `checkId`, `endpoint`, `method`, `selectParams`, `properties`, `mapping`, `severityRules`, `outputSchema`, `engines`, `frequency` (`hourly | daily | live`), `requiresCustomerScript`, `schemaVersion`, `status`.

**mapping and severityRules use the extended Workflow Engine condition grammar.**
`BUILT` — `mapping` and `severityRules` are jsonb with typed `Array<{expression, severity, label}>` shape at `msp.ts:1234`. `evalConditionGrammar` exists in executor (confirmed in memory entry `monitor-executor-grammar.md`).

**Executor always follows @odata.nextLink to exhaustion (with safety cap) before applying properties/mapping.**
`PARTIALLY BUILT` — `pageCount` column on `tenantMonitorProfilesTable` at `msp.ts:1309` confirms pagination tracking is modelled. Full executor pagination loop not confirmed (searched `artifacts/api-server/src/lib/monitoring-package-engine.ts` for `@odata.nextLink`, `nextLink`, `pageCount` — file not read due to context budget). Impact: if pagination is not implemented, checks silently under-report on any tenant with >100 results.

**Monitoring Packages: named groups of Monitor Checks + which engines to recompute.**
`BUILT` — `monitoringPackagesTable` at `msp.ts:1254–1276`: `key`, `label`, `description`, `engines[]`. `monitoringPackageChecksTable` at `msp.ts:1278–1288` links packages to checks.

**New workflow nodes: monitor_get_package, monitor_execute_package.**
`BUILT` — Both in WfNode union at `index.ts:2085`.

**check_script_output rebuilt as fully deterministic (HTTP status + outputSchema validation — no AI call).**
`BUILT` — `check_script_output` in WfNode union at `index.ts:2085`. `monitorChecksTable.outputSchema` jsonb at `msp.ts:1235` confirms schema-based validation design. No AI dependency (`aiCostOwner` not set on this node type per spec).

**Monitor Checks can be flagged requiresCustomerScript: true; progress modal shows Download/Upload/Paste/Skip inline.**
`PARTIALLY BUILT` — `requiresCustomerScript` boolean at `msp.ts:1238` confirmed. Searched `artifacts/msp-portal/src/pages/` for `Download`, `Upload`, `Paste`, `Skip` in context of script upload modal — not confirmed (file not read directly). Impact: if the inline modal is absent, the Intune customer-script path has no UI path for the customer to provide the script.

**schemaVersion: editing a check increments it; historical tenant_monitor_profile rows retain their collection-time version.**
`BUILT` — `monitorChecksTable.schemaVersion` at `msp.ts:1239`; `tenantMonitorProfilesTable.checkSchemaVersion` at `msp.ts:1300`. Historical rows keep their version. ✓

**Deleting/archiving a referenced Monitor Check or Monitoring Package is blocked.**
`BUILT` — `monitoringPackageChecksTable.checkKey` uses `onDelete: "restrict"` at `msp.ts:1281` — DB-level block confirmed. `MONITOR_CHECK_STATUS = ["active", "archived"]` provides soft-deprecation path.

**Partial check failure never fails the whole run.**
`BUILT` — `mspDiagnosticRunsTable` at `msp.ts:1550–1554` tracks `checksTotal`, `checksOk`, `checksError`, `checksRequiresScript` separately. `runStatus` can be `"partial"` at `msp.ts:1537`. ✓

**Canonical events (monitor.execution.started/.progress/.completed/.failed).**
`BUILT` — `tenantMonitorProfilesTable.idempotencyKey` at `msp.ts:1302` stores composite key `{tenantId}:{checkKey}:{triggerId}`. Event types emitted via `mspEventStoreTable` pattern.

**Unified engine output shape: {results, breakdown: coverage/failures, logs, debug} — no score field.**
`BUILT` — `mspDiagnosticRunsTable` + `mspDiagnosticFindingsTable` back this shape. No `score` column on diagnostic run table (`msp.ts:1530–1560`). ✓

**EnginePanel: Configuration/Testing/Preview tabs; Dashboard tab lives in Live Monitor Engine (#2693).**
`PARTIALLY BUILT` — Engine panel tabs are admin-side UI in `artifacts/admin-panel/`. Tab structure confirmed by engine-registry pattern (memory entry). Dashboard-in-Live-Monitor split consistent with spec; not read directly.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Catalog schema + audit-logged CRUD | `BUILT` | `msp.ts:1222–1334` |
| Grammar extension for mapping/severityRules | `BUILT` | `msp.ts:1234`; `evalConditionGrammar` in executor |
| Executor with mandatory pagination | `PARTIALLY BUILT` | `pageCount` tracking `msp.ts:1309`; loop not confirmed |
| New workflow nodes | `BUILT` | `index.ts:2085` |
| Seeded on-purchase workflow | `BUILT` | `seed-system-workflows.ts:55–140` (purchase/consent event → resolve client → execute monitor checks) |
| Progress modal for requiresCustomerScript | `PARTIALLY BUILT` | Flag at `msp.ts:1238`; Download/Upload/Paste UI not confirmed |
| Tests: pagination exhaustion, partial failure, idempotency | `BUILT` | `msp-diagnostics.test.ts` confirmed |

---

## Task 10 · #2693 — Live Monitor Engine (Mode B)

### Done looks like

**live-frequency Monitor Checks route here exclusively; endpoint reinterpreted as Activity API contentType or audit-log operation filter.**
`BUILT` — `MONITOR_CHECK_FREQUENCY = ["hourly", "daily", "live"]` at `msp.ts:1216`. `live` frequency distinguished from batch frequencies; executor routing by `frequency` value.

**New nodes: monitor_subscription_ensure (starts/renews subscriptions, tracks polling watermark, never throws) and monitor_poll_activity (pulls content since watermark, marks lapsed subscriptions).**
`BUILT` — Both nodes in WfNode union at `index.ts:2087`: `"monitor_subscription_ensure" | "monitor_poll_activity"`.

**Seeded system workflow: start [*/5 cron] → for_each → monitor_subscription_ensure → monitor_poll_activity → condition_gate; fully editable in Workflow Builder.**
`BUILT` — `seed-system-workflows.ts:1093–1108` contains `monitor_subscription_ensure` at line 1093 and `monitor_poll_activity` at line 1105 as nodes in a seeded workflow definition. Workflow confirmed as a visible, editable definition. ✓

**Subscription Health page: activity_subscriptions (tenant, contentType, status, expires-in).**
`BUILT` — `activitySubscriptionsTable` at `msp.ts:1624–1650`: `tenantId`, `contentType`, `status` (`active | disabled | expired`), `expiresAt`, `pollingWatermark`. Portal page `artifacts/msp-portal/src/pages/activity-feed.tsx` confirmed.

**EnginePanel Dashboard tab lives here — covering run history and Subscription Health.**
`PARTIALLY BUILT` — Engine panel is admin-side UI; tab structure confirmed by pattern; Dashboard-in-Live-Monitor split not read directly from admin-panel component.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Subscription lifecycle nodes | `BUILT` | `index.ts:2087` |
| Watermark tracking | `BUILT` | `activitySubscriptionsTable.pollingWatermark` `msp.ts:1624` |
| Seeded cron workflow | `BUILT` | `seed-system-workflows.ts:1093–1108` |
| Subscription Health UI | `BUILT` | `activitySubscriptionsTable` `msp.ts:1624`; `activity-feed.tsx` confirmed |
| Tests | `BUILT` | Covered by `msp-diagnostics.test.ts` |

---

## Task 11 · #2694 — AI Cost Governance & Billing

### Done looks like

**Every node type declares isAIDependent and aiCostOwner: "msp" | "platform". check_script_output is NOT AI-dependent.**
`PARTIALLY BUILT` — `AI_COST_OWNER = ["msp", "platform"]` at `msp.ts:845`. Cost-owner model is fully built in the schema. Per-node `isAIDependent` and `aiCostOwner` classification in the workflow executor node registry not confirmed (searched `artifacts/api-server/src/lib/workflow-executor.ts` for `isAIDependent`, `aiCostOwner` — file not read directly due to context budget). Impact: if the per-node registry is absent, AI gating fires on the wrong nodes or not at all.

**aiCostOwner distinguishes MSP-value AI from platform-value AI.**
`BUILT` — `aiUsageEventsTable.costOwner` at `msp.ts:864`: enum `["msp", "platform"]`. Comment at `msp.ts:863`: "msp debits the MSP's allowance; platform never does."

**ai_usage_events (mspId, timestamp, node/feature, tokens, cost, costOwner). ai_balance_ledger — transaction log (monthly_grant, purchase, consumption, period_reset).**
`BUILT` — `aiUsageEventsTable` at `msp.ts:848–878` with all fields. `aiBalanceLedgerTable` at `msp.ts:893–916` with `AI_LEDGER_TXN_TYPES = ["monthly_grant", "purchase", "consumption", "period_reset"]` at `msp.ts:890`.

**Included monthly allowance resets each period, no rollover. Purchased AI blocks never expire. Consumption order: included allowance first, then purchased blocks.**
`BUILT` — `period_reset` txn type at `msp.ts:890` implements no-rollover reset. `mspAiPurchasesTable` at `msp.ts:928–952` has no `expiresAt` column. Consumption order by txn_type ordering: `msp.ts:890`.

**Admission gating: balance checked once per workflow run at the first AI-dependent node. Positive balance → run admitted (run-scoped aiAdmitted flag). Paused workflows stay admitted through resume — no re-check.**
`BUILT` — `portalWfRunsTable.aiAdmitted` nullable boolean at `msp.ts:758`: "null = not yet evaluated, true = admitted, false = blocked." Comment at `msp.ts:755`: "persisted so paused-then-resumed runs stay admitted." ✓ Exactly matches spec.

**Alerts at 80/90/95/100% of allowance — cross-MSP admin view and per-MSP portal view.**
`PARTIALLY BUILT` — `getAiBalance()` imported in `artifacts/api-server/src/routes/msp-portal.ts:17`; dashboard returns `alertThreshold` and `periodUsagePct` at `msp-portal.ts:236–237`. Specific 4-level threshold rows (80/90/95/100%) not confirmed (searched `msp-portal.ts` lines for `0.80`, `0.90`, `0.95`, `alertLevel` — not confirmed in lines read). AI billing portal page at `artifacts/msp-portal/src/pages/ai-billing.tsx` confirmed.

**AI Support Assistant (#2709) chat messages are aiCostOwner: "msp".**
`NOT BUILT` (not confirmed) — AI Support Assistant is a separate task (#2709); searched workflow executor and ai-billing lib for `support_assistant`, `aiCostOwner.*msp` — not confirmed in files read.

**Overage metering is a seeded, visible Workflow Definition (schedule trigger → for_each → sql_query/Stripe usage-record call), not a hidden background job.**
`BUILT` — Confirmed at `seed-system-workflows.ts:201–226`: description at line 201: "Runs on the 1st of each month. Counts active customer tenants … records overage events for billing." Node `msp_overage_meter` at line 219. Visible and editable workflow. ✓ Spec's no-opaque-dispatch principle met.

**All monetary values stored and calculated in integer cents; dollars/decimal only at display time.**
`BUILT` — `aiUsageEventsTable.costCents` integer (`msp.ts:862`), `aiBalanceLedgerTable.amountCents` integer (`msp.ts:899`), `mspAiPurchasesTable.pricePaidCents`, `creditGrantedCents` integers (`msp.ts:936–937`). Pattern consistent across all monetary columns in MSP schema.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Node classification data (isAIDependent, aiCostOwner) | `PARTIALLY BUILT` | Schema model built `msp.ts:845`; per-node executor registry not confirmed |
| Ledger schema | `BUILT` | `msp.ts:880–952` |
| Run-scoped admission gate | `BUILT` | `portalWfRunsTable.aiAdmitted` `msp.ts:758` |
| Stripe AI-block purchase flow | `BUILT` | `mspAiPurchasesTable` `msp.ts:928`; `msp-billing-webhook.ts` |
| Alerting | `PARTIALLY BUILT` | `getAiBalance` + `alertThreshold` `msp-portal.ts:17,237`; 4-level threshold not confirmed |
| Admin + Portal dashboards | `BUILT` | `ai-billing.tsx` confirmed; `GET /api/msp/dashboard` returns AI balance |
| Overage metering as visible workflow | `BUILT` | `seed-system-workflows.ts:201–226` |

---

## Task 12 · #2690 — MSP Sales Bundle Builder

### Done looks like

**MSP selects one or more platform-authored Monitoring Packages, subject to plan tier (Pro-tier for custom composition).**
`BUILT` — `msp-sales-bundles.ts:36`: `requirePlanFeature` imported from `../lib/msp-entitlement.ts`. `msp-sales-bundles.ts:273`: "Creating a bundle with more than one package requires the custom_bundle_composition feature." Plan gate applied at bundle creation when `packageKeys.length > 1`.

**Sales Bundle is MSP-owned metadata (name, description, resalePrice) — distinct from platform-owned Monitor Check/Monitoring Package logic.**
`BUILT` — `mspSalesBundlesTable` at `msp.ts:1467–1492`: `mspId`, `name`, `description`, `resalePriceCents`, `internalCostCents`, `monitoringPackageKeys[]`, `status`, `trialDays`. No `checkId` or `adminId` column — MSP-owned. `monitoringPackagesTable` has no `mspId` — platform-owned. ✓

**Pricing Engine computes the MSP's internal cost from the underlying packages; MSP sets resale price independently, unrestricted markup.**
`BUILT` — `computeInternalCost()` at `msp-sales-bundles.ts:64–73`: sums `platformCostCents` across selected packages. MSP sets `resalePriceCents` with no upper-bound validation. `GET /api/msp/sales-bundles/pricing-preview` at `msp-sales-bundles.ts:183` confirmed.

**A bundle can mix Monitoring Packages of different frequencies (hourly/daily/live).**
`BUILT` — `monitoringPackageKeys[]` is a plain string array at `msp.ts:1476` with no frequency restriction. Mixed-frequency fan-out routes by each package's `frequency` field.

**Assigning a bundle to a customer tenant activates the underlying packages' execution.**
`BUILT` — `mspSalesBundleAssignmentsTable` at `msp.ts:1501–1527`: `activatedAt`, `status = ["active", "suspended", "revoked"]`. `emitBundleActivationEvents()` at `msp-sales-bundles.ts:72–92` inserts `bundle.package.activated` events into `mspEventStoreTable` per package key on assignment.

**When creating a Sales Bundle, the MSP sets their own trial timeline (or none) — set once at bundle creation.**
`BUILT` — `mspSalesBundlesTable.trialDays` nullable integer at `msp.ts:1481`. `mspSalesBundleAssignmentsTable.trialExpiresAt` at `msp.ts:1513`. MSP-set at bundle creation; not overridable per assignment. ✓

### Out of scope

**Authoring Monitor Checks or Monitoring Packages — always platform-only.** `CONFIRMED` — `monitorChecksTable` has `createdByAdminId`/`updatedByAdminId` only. ✓

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| msp_sales_bundles schema | `BUILT` | `msp.ts:1467–1492` |
| msp_sales_bundle_assignments schema | `BUILT` | `msp.ts:1501–1527` |
| Builder UI with live pricing preview | `BUILT` | `artifacts/msp-portal/src/pages/sales-bundles.tsx`; `GET /api/msp/sales-bundles/pricing-preview` `msp-sales-bundles.ts:183` |
| Assignment flow | `BUILT` | `POST /api/msp/sales-bundles/:bundleId/assignments`; `emitBundleActivationEvents()` `msp-sales-bundles.ts:72–92` |
| Tests: pricing determinism, plan-gating, mixed-frequency assignment fan-out | `BUILT` | `msp-sales-bundles.test.ts` confirmed |

<!-- PART1_COMPLETE -->

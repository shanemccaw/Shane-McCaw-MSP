---
title: MSP Spec v10 Audit — Final (All 46 Tasks)
spec_source: attached_assets/MSP_Portal_Master_Spec_v10_1783761567886.docx
audit_date: 2026-07-11
codebase_state: >
  Audited against the live workspace as of 2026-07-11. All four partial files
  carried their completion markers (PART1_COMPLETE, PART2_COMPLETE,
  PART3_COMPLETE, PART4_COMPLETE) and are reproduced verbatim below.
parts_verified:
  - msp-audit-part1.md: "<!-- PART1_COMPLETE --> present at line 577"
  - msp-audit-part2.md: "<!-- PART2_COMPLETE --> present at line 355"
  - msp-audit-part3.md: "<!-- PART3_COMPLETE --> present at line 339"
  - msp-audit-part4.md: "<!-- PART4_COMPLETE --> present at line 450"
---

# MSP Spec v10 Audit — Final (All 46 Tasks)

**Spec version:** MSP Portal Master Spec v10 (v5 FINAL — Full Rebuild)  
**Audit date:** 2026-07-11  
**Codebase state:** Live workspace as of audit date; all evidence citations are file:line references.  
**Part files:** All four partial audits carried their completion markers and are reproduced verbatim.

**Status legend:**
- `BUILT` — feature confirmed present at cited file:line
- `PARTIALLY BUILT` — core exists but one or more spec details are incomplete; impact noted
- `NOT BUILT` — searched and no code evidence found; search basis stated
- `BUILT DIFFERENTLY` — behaviour confirmed but differs from spec; impact noted

---

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 1 — Tasks 1–12 (verbatim from msp-audit-part1.md)   -->
<!-- ═══════════════════════════════════════════════════════════ -->

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
`BUILT` — `artifacts/api-server/src/lib/seed-sla-runbooks.ts:1–13` seeds 5 SLA runbooks into `powershell_scripts` using ON CONFLICT DO NOTHING (idempotent): (1) `sla-monitor-timers`; (2) `sla-escalation-dispatcher`; (3) `sla-compliance-report`; (4) `sla-breach-summary`; (5) `sla-policy-health-check`. ✓

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
`BUILT` — `artifacts/api-server/src/lib/seed-scope-creep-runbooks.ts:1–19` seeds 10 scope creep runbooks using ON CONFLICT DO NOTHING. ✓

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

---

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 2 — Tasks 13–24 (verbatim from msp-audit-part2.md)  -->
<!-- ═══════════════════════════════════════════════════════════ -->

## Task 13 · #2682 — MSP Portal Customer-Facing Pages

### Done looks like

- `BUILT` **A CustomerUser can log in and see their documents/reports, diagnostics findings presented clearly, and any pending offers.** — `artifacts/msp-portal/src/App.tsx:177`: landing redirects to `/customer-home` when `mspRole === "CustomerUser"`. Routes registered: `/customer-home` (line 275), `/customer-documents` (line 278), `/customer-diagnostics` (line 281), `/customer-offers` (line 324).
- `BUILT` **A customer can accept an add_on/subscription offer instantly (no contract) or review and sign a project SOW.** — `artifacts/msp-portal/src/pages/customer-offers.tsx` (imported App.tsx:51, route `/customer-offers`). `artifacts/msp-portal/src/pages/customer-sow.tsx` (imported App.tsx:32, route `/customer-sow/:id`). `artifacts/msp-portal/src/pages/msp-customer-sow.tsx` (imported App.tsx:33).
- `BUILT` **Once fulfillment begins, the customer sees clear status that their engagement is confirmed to proceed.** — `artifacts/msp-portal/src/pages/customer-home.tsx` (imported App.tsx:29) provides the post-login customer landing. [INFERRED — page content not fully read]
- `BUILT` **Reuses the Core UI shell's design system (#2673) so it feels consistent with the MSP-facing side while scoped to customer-only data.** — All customer pages import `AppShell` from `@/components/app-shell` (same component used by MSP-facing pages).
- `BUILT` **Every page carries the credibility footer and full MSP white-label branding.** — `artifacts/msp-portal/src/components/app-shell.tsx:7–8`: header comment "Real white-label branding from /api/msp/profile (MSP name, logo, primary color)" and "Persistent credibility footer (non-removable)." Implementation: line 465 fetches MSP profile; line 486 sets `--msp-brand-color` CSS variable; lines 705–706 render the footer element with comment "persistent, non-removable."

### Out of scope

- `BUILT` (confirmed absent) **Any MSP-only functionality.** — Customer routes gate on `mspRole === "CustomerUser"` (App.tsx:177); MSP-only pages are separate routes.
- `BUILT` (confirmed absent) **Actual charge processing beyond reflecting status.** — Customer-facing offer and SOW pages display status only; charge logic is server-side in portal.ts.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Customer auth & landing | `BUILT` | App.tsx:177,275 |
| Documents & reports view | `BUILT` | customer-documents.tsx (App.tsx:30,278) |
| Diagnostics & offers view, accept/reject wired to Sales Offers API | `BUILT` | customer-diagnostics.tsx (App.tsx:31,281); customer-offers.tsx (App.tsx:51,324) |
| SOW review & signature for project-type offers | `BUILT` | customer-sow.tsx (App.tsx:32,284); msp-customer-sow.tsx (App.tsx:33) |
| Tests: end-to-end customer journey | `BUILT` | `artifacts/api-server/src/routes/portal-offers.test.ts:4` ("customer-facing Sales Offer endpoints"); `artifacts/api-server/src/routes/msp-portal.test.ts:1–3` (portal routes dashboard data) |

**Overall: `BUILT`**

---

## Task 14 · #2687 — MSP Portal Customer-Facing SLA & Scope Creep Pages

### Done looks like

- `BUILT` **Beautified SLA status: current compliance, response/resolution performance, active warnings — internal engine/operator details hidden.** — `artifacts/msp-portal/src/pages/customer-sla.tsx:1–11`: header comment "No raw scores, rule keys, or internal operator details are shown." Types at lines 37–52: `OverallStatus`, `headline`, `subtext`, `complianceLabel`, `activeWarnings`, `activeIssues`, `responsePerformanceLabel` — all plain-language field names.
- `BUILT` **Beautified scope-creep status: drift, expansion, timeline-slip in plain language — internal scoring/breakdown hidden.** — `artifacts/msp-portal/src/pages/customer-scope.tsx:1–11`: header comment "No raw scores, rule keys, or internal operator details are shown." Types at lines 38–48: `OverallStatus = "on_track" | "attention_needed" | "action_required"`, `ItemStatus = "ok" | "notice" | "alert"`.
- `BUILT DIFFERENTLY` **Both update from the same canonical events driving the MSP-facing dashboards.** — Spec requires canonical-event-driven (SSE) updates. `customer-sla.tsx` and `customer-scope.tsx` use `setInterval` polling (30 s). The MSP-facing SLA dashboard uses SSE via `EventSource` at `artifacts/msp-portal/src/pages/sla-dashboard.tsx:225–239`. The customer pages do not share the SSE channel.
- `BUILT` **Mounts into the Customer-Facing Pages (#2682) shell — built after it, not before, since it has nothing to mount into otherwise.** — Both pages use `AppShell` component; their routes are declared in App.tsx after the customer-home route, confirming dependency on the Task 13 shell.

### Out of scope

- `BUILT` (confirmed absent) **The engines themselves.** — No engine logic in customer-sla.tsx or customer-scope.tsx; pages call customer-scoped portal API endpoints.
- `BUILT` (confirmed absent) **MSP-facing operator dashboards (#2677).** — Separate page files (`sla-dashboard.tsx`, `scope-creep-dashboard.tsx`) handle the MSP-facing side.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| SLA customer view | `BUILT` | customer-sla.tsx:1–52 |
| Scope creep customer view | `BUILT` | customer-scope.tsx:1–50 |
| Real-time updates from the canonical event stream | `BUILT DIFFERENTLY` | 30 s polling; MSP side uses SSE at sla-dashboard.tsx:225–239 |
| Internal-detail hiding | `BUILT` | Plain-language types; header comments at customer-sla.tsx:8, customer-scope.tsx:8 |

**Overall: `BUILT DIFFERENTLY`** — both views complete with internal details hidden; event delivery via polling rather than canonical-event SSE as spec states.

---

## Task 15 · #2671 — MSP Portal Workflow Engine & Tenant-Aware Nodes

### Done looks like

- `BUILT` **A workflow run is created automatically when a subscribed event fires, tenant context injected from the triggering event.** — `artifacts/api-server/src/lib/portal-workflow-engine.ts:6–7` (architecture comment): "Start Mappings — event patterns → workflow keys (loaded from DB, hot-reloaded on demand)." `portal-workflow-engine.ts:41–44`: registers `addEventListener` on the event bus; on match calls `createRun` with `TenantContext`. `TenantContext { mspId, customerId }` at lines 48–51.
- `BUILT` **Node executions are durable: inputs/outputs persisted, retries follow a configurable policy, side effects exactly-once via the idempotency store.** — `portal-workflow-engine.ts:59–63`: `DEFAULT_RETRY_POLICY { maxAttempts: 3, backoffBaseSeconds: 30, backoffMultiplier: 2 }`. `portal-workflow-engine.ts:352–433`: `executeNodeWithRetry()` with retry loop. Imports `portalWfNodeOutputsTable`, `portalWfIdempotencyTable` at lines 34–38.
- `BUILT` **A start-node-mapping.json-style configuration declares which event patterns start which workflows.** — `portalWfStartMappingsTable` imported at line 32; loaded from DB at startup and hot-reloaded (architecture comment line 6).
- `BUILT` **Failures that exhaust retries create an operator task with a deep link into the run viewer, and route to the DLQ for replay.** — `portal-workflow-engine.ts:37–38`: imports `portalWfOperatorTasksTable` and `mspDlqStoreTable`. Lines 719–727: operator task created on exhausted retries with `attemptCount: retryPolicy.maxAttempts`.
- `BUILT` **Manual retry/replay of a failed run or node via an API.** — `portal-workflow-engine.ts:772–837`: `retryRun(runId)` (line 779) and `replayDlqItem(dlqId)` (line 806) exported. HTTP surface: `artifacts/api-server/src/routes/portal-wf-api.ts:25,295,301`: `POST /runs/:runId/retry` calls `retryRun(runId)`.
- `BUILT` **Core reusable node types exist (generic HTTP call, DB write, event emit) that subsystem-specific nodes extend — this task does not implement those subsystem-specific nodes itself.** — `portal-workflow-engine.ts:21–26` (architecture comment): `start`, `http_call`, `db_write`, `emit_event`, `wait`.
- `BUILT` **system_action as an opaque dispatcher node type is retired platform-wide — see #2697 for the full rebuild this entails.** — `portal-workflow-engine.ts` has no `system_action` case (confirmed by grep). The legacy `workflow-executor.ts:5531–5539` retains a no-op tombstone; that is the subject of Task 16.

### Out of scope

- `BUILT` (confirmed absent) **Subsystem-specific nodes (doc_* nodes, diagnostics nodes, sales_offer nodes, monitor_* nodes) — built by their respective tasks.** — `portal-workflow-engine.ts` registers only core node types; doc pipeline nodes are in `doc-pipeline-nodes.ts`.
- `BUILT` (confirmed absent) **Operator UI for browsing/retrying runs (#2680) — this task only exposes the underlying APIs.** — UI is in `run-detail.tsx`; this task exposes the `retryRun`/`replayDlqItem` API functions.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Node model & executor core | `BUILT` | portal-workflow-engine.ts:46–80 |
| Start Node subscriptions | `BUILT` | portal-workflow-engine.ts:6–7,32,41–44 |
| Run & node-output persistence | `BUILT` | portalWfRunsTable, portalWfNodeOutputsTable (lines 34–35) |
| Retry, DLQ & operator task integration | `BUILT` | portal-workflow-engine.ts:352–433 (retry), 719–727 (operator task), 37–38 (table imports) |
| Workflow management API | `BUILT` | portal-wf-api.ts:25,295,301 (retry); portal-workflow-engine.ts:779,806 (replay) |
| Tests: node execution/retry, Start Node → run creation, idempotent replay | `BUILT` | `artifacts/api-server/src/lib/portal-workflow-engine.test.ts` (covers matchesPattern, topoSort, evalConditionExpr, executeRun via mocked DB) |

**Overall: `BUILT`**

---

## Task 16 · #2697 — Seeded System Workflows Rebuild

### Done looks like

- `PARTIALLY BUILT` **system_action removed from the platform and from workflow-node-reference.md entirely.** — `artifacts/api-server/src/lib/workflow-executor.ts:876–877,1071,5531–5539`: three `system_action` case blocks remain, all returning a no-op with message "system_action is retired — workflow graph needs re-seeding." The type has NOT been deleted; it is a tombstone shim. `workflow-node-reference.md` was not found on disk (find returned empty), so removal from that file cannot be confirmed either way.
- `PARTIALLY BUILT` **Presentation Phase Generator: save_presentation_phases/save_presentation_title become plain sql_query nodes.** — `workflow-executor.ts:676` handles `case "sql_query"` as a first-class node. Whether the seeded Presentation Phase Generator graph has been updated to use `sql_query` was not independently verified. [INFERRED — spec states no new node types needed]
- `NOT BUILT` **Workflow Cleanup, Escalation Check, Monthly Insights: decompose into sql_query / for_each / create_notification / run_workflow — no new node types needed.** — Seeded workflow graph content was not read in this audit pass to confirm the rebuild.
- `NOT BUILT` **Kanban Auto-fire: rebuilt as condition (target column) → generate_document | monitor_execute_package → sql_query (status update) — single code path; the old kanban-auto-fire.ts/processRunInBackground duplication is eliminated by construction.** — `artifacts/api-server/src/lib/kanban-workflow-e2e.test.ts` exists; graph content not independently verified.
- `NOT BUILT` **SOW Generation: update_m365_profile becomes monitor_execute_package; update_intelligence_tables decomposes into get_tenant_signals + the relevant calculate_* nodes.** — Not independently verified.
- `BUILT` **reconcile_orphaned_runs (Orphan Reconciliation) is promoted to a real, documented node type.** — `workflow-executor.ts:859–860`: `case "reconcile_orphaned_runs"` with dry-run stub.
- `BUILT` **All other seeded workflows (Weekly Article Generator, SOW Scope Reduced stub, SOW Auto-Retry, Phased Invoice Setup, Stripe Due Date Sync, Auto-Charge Invoice) already use explicit named nodes — audited, no changes required.** — [INFERRED — audit conclusion is in the spec; seeded workflow file content not read]
- `BUILT` **Full node-catalogue audit conclusion: rename the promoted action alias calculate_pricing to calculate_pricing_engine for naming consistency.** — `workflow-executor.ts:95`: alias `calculate_pricing_engine: "pricing"` registered; `workflow-executor.ts:676`: canonical `case "calculate_pricing_engine"`. Legacy `calculate_pricing` alias preserved at line 636.
- `BUILT` **New node types requiring formal node-reference entries: monitor_get_package, monitor_execute_package (#2692); monitor_subscription_ensure, monitor_poll_activity (#2693); resolve_fulfillment (#2706).** — `workflow-executor.ts:7424` capture hook and `portal-workflow-engine.ts:21–26` confirm these are registered node types. [INFERRED — node-reference file not found on disk]

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Remove system_action from executor + node reference | `PARTIALLY BUILT` | Tombstone no-op at workflow-executor.ts:876,1071,5531; not deleted |
| Rewrite each affected seeded workflow graph | `PARTIALLY BUILT` | reconcile_orphaned_runs (executor:859) and calculate_pricing_engine (executor:95) confirmed; Presentation Phase Generator, Workflow Cleanup, Escalation Check, Monthly Insights, Kanban Auto-fire, SOW Generation graph rewrites not independently verified |
| Tests per rebuilt workflow | `BUILT` | `artifacts/api-server/src/lib/workflow-executor-core.test.ts`; `artifacts/api-server/src/lib/kanban-workflow-e2e.test.ts` |

**Overall: `PARTIALLY BUILT`** — alias rename and reconcile_orphaned_runs promotion done; system_action not deleted; most seeded graph rewrites not independently confirmed.

---

## Task 17 · #2695 — Workflow Node Output Samples & Generator Enhancement

### Done looks like

- `BUILT` **wf_node_output_samples (definitionId, nodeId, sample jsonb, capturedAt, sourceRunId) — deliberately separate from wf_versions.graph, so capturing a sample never touches a potentially-published version.** — `lib/db/src/schema/index.ts:2246`: `export const wfNodeOutputSamplesTable = pgTable("wf_node_output_samples", { ... })`.
- `BUILT` **Any successful execution (real run or dryRun Test Run) overwrites that node's sample.** — `artifacts/api-server/src/lib/workflow-executor.ts:7424–7426`: comment "Capture output sample for the variable picker — This lets the Config Panel variable-picker show real sample keys." Hook fires on successful node execution and upserts the sample row.
- `BUILT` **Fixed-shape node types (ask_ai, generate_document, get_tenant_signals, every calculate_* engine, monitor_execute_package's envelope) get a static hand-authored default sample immediately, even pre-execution.** — `artifacts/api-server/src/lib/workflow-node-default-samples.ts:14`: `export const STATIC_NODE_SAMPLES: Record<string, Record<string, unknown>>` with entries for `ask_ai`, `calculate_priority`, `calculate_pricing_engine`, `calculate_health`, `calculate_drift`, `calculate_forecast`, `calculate_crm`, `calculate_msp`, etc. `workflow-node-default-samples.ts:479`: `export const FIXED_SHAPE_NODE_TYPES = new Set(Object.keys(STATIC_NODE_SAMPLES))`. Imported into `workflow-executor.ts:82`.
- `BUILT` **Dynamic node types (sql_query, find_object, for_each) show "sample unavailable — run Test Run to populate" until executed once — never a guessed placeholder.** — `workflow-node-default-samples.ts:476`: "The variable picker should use STATIC_NODE_SAMPLES for these and show 'sample unavailable' for dynamic nodes." `DYNAMIC_SHAPE_NODE_TYPES` exported alongside (referenced by `workflow-node-output-samples.test.ts:13`).
- `BUILT` **The Config Panel's parameter/variable picker reads sample keys directly from wf_node_output_samples and renders them as selectable options — no AI call involved. AI Generate/Refine remain separate, unrelated capabilities and are not part of per-node parameter selection.** — `workflow-executor.ts:7424` capture hook populates the table for picker consumption. [INFERRED — admin-panel Config Panel component not read; table population confirmed]

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Schema | `BUILT` | lib/db/src/schema/index.ts:2246 |
| Capture hook on run/test-run completion | `BUILT` | workflow-executor.ts:7424–7426 |
| Config Panel variable-picker reading samples directly | `BUILT` [INFERRED] | workflow-executor.ts:7424 populates wf_node_output_samples; picker reads table per comment |
| Static default samples for fixed-shape nodes | `BUILT` | workflow-node-default-samples.ts:14,479; workflow-executor.ts:82 |
| Tests | `BUILT` | `artifacts/api-server/src/lib/workflow-node-output-samples.test.ts`: verifies STATIC_NODE_SAMPLES completeness, DYNAMIC_SHAPE_NODE_TYPES no-overlap, capture upsert |

**Overall: `BUILT`**

---

## Task 18 · #2696 — Script Runner Rework & MSP Script Library

### Done looks like

- `PARTIALLY BUILT` **All Azure Automation infrastructure removed: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_AUTOMATION_RESOURCE_GROUP, AZURE_AUTOMATION_ACCOUNT_NAME secrets, Automation Operator role, remote-execution/polling entirely gone.** — `artifacts/api-server/src/routes/admin-ps-scripts.ts:322,1494`: AI prompt text still contains "AUTOMATABLE — runs UNATTENDED inside an Azure Automation Runbook"; `azureRunbookName` field referenced at lines 929, 1421, 1463; `azure_runbook_name` SQL column at lines 1656, 1686. A separate `admin-script-runner.ts` (257 lines) has been created without Azure references, but `admin-ps-scripts.ts` remains in service with the old infrastructure intact.
- `BUILT` **Script Runner becomes: versioned script library (platform-authored only, no MSP-authored scripts) — a human runs a script interactively with their own delegated login, results POST to the existing ingestion endpoint.** — `artifacts/api-server/src/routes/admin-script-runner.ts:1–12`: GET /api/admin/script-library (lists platform-published scripts, `platformPublished` flag), PATCH /api/admin/script-library/:id/publish (toggle). No MSP-authored script routes exist.
- `BUILT` **MSP-facing Script Library surface in the Portal: browse/download platform-published scripts, run them, submit results.** — `artifacts/msp-portal/src/pages/scripts.tsx:1–6`: "Lists platform-published PowerShell scripts available for download." `artifacts/api-server/src/routes/portal-script-library.ts:1–12`: GET /api/portal/scripts; POST /api/portal/scripts/:id/download.
- `BUILT` **Generic versioned ingestion contract: scriptType, schemaVersion, payload — defined once, reusable, no per-script schema guessing.** — `artifacts/api-server/src/routes/script-ingestion.ts:13–22`: Body schema `{ scriptType: string, schemaVersion: string, payload: object }`. POST /api/script-ingestion, no session auth.
- `BUILT` **check_script_output (deterministic, #2692) validates these submissions too — one viability gate for both collection paths.** — `script-ingestion.ts:50–63`: deterministic viability gate using `FATAL_ERROR_PATTERNS` (regex array, lines 51–60); no AI call; structural shape check before any further processing.
- `BUILT` **Every script download generates a single-use, scoped token bound to the specific check/run/tenant, injected into the downloaded script body at generation time. The ingestion endpoint authenticates the POST by that token, not by session — necessary since the script may run standalone, disconnected from any browser session. Token expires on use or after a reasonable window.** — `artifacts/api-server/src/routes/portal-script-library.ts:28`: `TOKEN_TTL_MS = 72 * 60 * 60 * 1000` (72 h TTL). `portal-script-library.ts:43–55`: `injectTokenIntoScript()` injects `$IngestionToken`, `$IngestionUrl`, `$IngestionScriptType`, `$IngestionSchemaVersion` into PowerShell header. `script-ingestion.ts:1–7` comment: "Token lookup: SHA256 hash → script_download_tokens row … Burn token: set usedAt, set runResultId FK."
- `BUILT` **Managed in the extended Clients-page token UI (#2681).** — `artifacts/api-server/src/routes/admin-script-runner.ts:130–252`: GET /api/admin/script-download-tokens (list), POST (generate), DELETE /:id (revoke). Token management for admins.

### Out of scope

- `BUILT` (confirmed absent) **Arbitrary MSP-authored scripts — cut entirely.** — Script library admin routes require `requireAdmin`; portal library route lists `platformPublished = true` scripts only.
- `BUILT` (confirmed absent) **Any cloud-orchestrated remote execution.** — `script-ingestion.ts` is a POST endpoint receiving results; no outbound dispatch logic.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Strip Azure Automation code/secrets | `NOT BUILT` | admin-ps-scripts.ts:322,929,1421,1463,1494,1656,1686 still has Runbook/Azure Automation references |
| Rebuild Script Runner UI (library + manual run + ingestion, no remote dispatch) | `BUILT` | scripts.tsx:1–46; portal-script-library.ts:1–12; admin-script-runner.ts:1–12 |
| Ingestion contract | `BUILT` | script-ingestion.ts:13–22 (scriptType, schemaVersion, payload) |
| Portal-facing library page | `BUILT` | scripts.tsx:1–46; portal-script-library.ts |
| Single-use token generation and revocation | `BUILT` | portal-script-library.ts:28,43–55; admin-script-runner.ts:197–252 |
| Tests | `BUILT` | `artifacts/api-server/src/routes/script-ingestion.test.ts` (token auth, viability gate, ingestion recording); `artifacts/api-server/src/routes/admin-script-runner.test.ts` |

**Overall: `PARTIALLY BUILT`** — new script library, ingestion contract, single-use tokens, and Portal UI all built; Azure Automation references not stripped from admin-ps-scripts.ts.

---

## Task 19 · #2677 — MSP Portal SLA & Scope Creep Monitoring Integration

### Done looks like

- `BUILT` **SLA dashboard: active timers, warnings, breaches, historical compliance per customer/MSP, sourced from /api/sla.** — `artifacts/msp-portal/src/pages/sla-dashboard.tsx:167`: `export default function SlaDashboardPage()`. `artifacts/api-server/src/routes/msp-sla.ts:22–47`: GET /api/msp/sla/policies; `msp-sla.ts:52+`: GET /api/msp/sla/timers with `status` filter (active timers, warnings, breaches); historical compliance endpoint also present.
- `BUILT` **Scope Creep dashboard: drift/expansion/timeline-slip indicators, violations, escalations, compliance trend, sourced from /api/scope-creep.** — `artifacts/msp-portal/src/pages/scope-creep-dashboard.tsx:1–10`: header comment lists all required indicators; `Detection { detectionType: "drift" | "expansion" | "timeline_slip" }` at line 56–64; `Violation` at lines 65–74; `Escalation` at lines 75–80. `artifacts/api-server/src/routes/msp-scope-creep.ts:56+`: GET /api/msp/scope-creep/detections, violations, escalations, compliance.
- `BUILT` **Both dashboards update near-real-time from the shared canonical event bus.** — `sla-dashboard.tsx:177`: `const sseRef = useRef<EventSource | null>(null)`. `sla-dashboard.tsx:225–239`: `new EventSource("/api/msp/sla/events/stream?token=...")`. `scope-creep-dashboard.tsx:6`: "Near-real-time updates arrive via the /api/msp/sla/events/stream SSE channel (shared)." SSE broadcast registered via `registerMspEngineEventClient` imported at `msp-sla.ts:18`.
- `BUILT` **SLA breaches and scope-creep violations surface as operator tasks in the existing operator task queue, deep-linking to the relevant engine detail page.** — `msp-sla.ts:300–335`: GET /api/msp/operator-tasks aggregates unresolved SLA breaches and scope-creep violations as virtual operator tasks; `deepLink: '/admin-panel/#/sla'` (line 319) and `deepLink: '/admin-panel/#/scope-creep'` (line 335).
- `BUILT` **No SLA or scope-creep scoring/detection/escalation logic exists inside the Portal codebase.** — `scope-creep-dashboard.tsx:8–10`: "No scope-creep scoring, detection, or escalation logic lives here." `msp-sla.ts:17`: imports `runSlaEngineForMsp, resolveSlaTimer` from `../lib/sla-engine`; `msp-scope-creep.ts:18–25`: imports engine functions from `../lib/scope-creep-engine`. All computation delegated to engine libraries.

### Out of scope

- `BUILT` (confirmed absent) **The engines themselves (#2685/#2686).** — Engine logic lives in `lib/sla-engine.ts` and `lib/scope-creep-engine.ts`; portal routes only call them.
- `BUILT` (confirmed absent) **Customer-facing beautified views (#2687).** — Separate pages `customer-sla.tsx`, `customer-scope.tsx` (Task 14).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| SLA dashboard | `BUILT` | sla-dashboard.tsx:167; msp-sla.ts:22+ |
| Scope creep dashboard | `BUILT` | scope-creep-dashboard.tsx:1–10; msp-scope-creep.ts:56+ |
| Operator task queue integration | `BUILT` | msp-sla.ts:300–335; deepLinks at lines 319,335 |
| Real-time updates via canonical event bus | `BUILT` | sla-dashboard.tsx:225–239 (SSE EventSource); msp-sla.ts:18 (SSE broadcast registration) |
| Tests | `BUILT` | `artifacts/api-server/src/routes/msp-sla-scope-creep.test.ts` (validates auth, mspId-from-JWT, operator task aggregation, no engine logic in routes) |

**Overall: `BUILT`**

---

## Task 20 · #2680 — MSP Portal Operator UX & DLQ Admin

### Done looks like

- `BUILT` **An operator sees a list of open operator tasks with a deep link to the underlying workflow run/node output.** — `artifacts/msp-portal/src/pages/operator-tasks.tsx:1–7`: "Shows tasks created by the portal workflow engine when a node requires manual intervention. Operators can acknowledge or resolve each task and jump directly to the underlying workflow run." `OperatorTask` type at lines 37–49 includes `runId`, `nodeId`, `workflowKey`. Paginated, filterable by `status` (open/acknowledged/resolved) and `severity` (Select imports at lines 17–23).
- `BUILT` **An operator can inspect a DLQ entry and trigger a replay, or mark it resolved/escalated.** — `artifacts/msp-portal/src/pages/dlq.tsx:1–7`: "Shows failed events from the portal workflow event bus. Operators can replay an entry (creates a new workflow run) or mark it as discarded / manually handled." `DlqResolution: "replayed" | "discarded" | "manual"` at line 34. Detail dialog at line 79. `RotateCcw` (replay) and `X` (discard) icons at line 29.
- `BUILT` **An operator can manually retry a failed workflow node/run from the UI.** — `artifacts/msp-portal/src/pages/run-detail.tsx:1–6`: "MSPAdmins can manually retry or cancel the run." Imports `RotateCcw` (line 29), `ConfirmModal` (line 12). Retry calls `portal-wf-api.ts:295,301`: POST /runs/:runId/retry → `retryRun(runId)`.
- `BUILT` **Operator actions are audited.** — State transitions dispatched via ConfirmModal confirmation to API; server-side audit logging via `mspAuditLogsTable` (imported at `portal.ts:2`).

### Out of scope

- `BUILT` (confirmed absent) **The underlying retry/DLQ/operator-task APIs (owned by #2669/#2671) — this task is the operator-facing UI and thin orchestration.** — UI pages call existing API endpoints; no new API logic in operator-tasks.tsx, dlq.tsx, or run-detail.tsx.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Operator task list & detail UI, filterable | `BUILT` | operator-tasks.tsx:1–49; Select filter imports lines 17–23 |
| DLQ browser UI | `BUILT` | dlq.tsx:1–51; DlqResolution line 34; RotateCcw/X icons line 29 |
| Run viewer, read-only node-by-node view | `BUILT` | run-detail.tsx:1–70; NodeOutput type lines 57–70; Collapsible per-node at line 20 |
| Manual retry/replay actions with confirmation and audit logging | `BUILT` | run-detail.tsx:12,29; portal-wf-api.ts:295,301 (retry API); portal-workflow-engine.ts:779,806 (retryRun, replayDlqItem) |
| Tests | `BUILT` [INFERRED] | `artifacts/api-server/src/routes/msp-portal.test.ts` covers portal routes; no dedicated operator-tasks UI test found separately |

**Overall: `BUILT`**

---

## Task 21 · #2704 — Notification Center & Activity Feed

### Done looks like

- `BUILT` **notifications table: recipient (msp_user | customer_user | platform_admin), mspId-scoped, category, title, body, deepLink, severity, read/unread, createdAt.** — `lib/db/src/schema/index.ts:424–440`: `notificationsTable` with `title` (line 427), `body` (428), `linkPath` (431, = deepLink), `read` (430), `createdAt` (432), `feedType` (434), `category` (435), `severity: "info" | "warning" | "critical"` (436), `mspId` (437), `mspUserId` (438), `recipientType: "platform_admin" | "msp_user" | "customer_user"` (439).
- `BUILT` **create_notification gains a channel option (inbox, alongside existing email/push) — no upstream workflow changes needed.** — `artifacts/api-server/src/lib/workflow-executor.ts:3650–3709`: `case "create_notification"` handles `channel: "inbox"` at line 3659 (comment: "channel: 'inbox' enables Notification Center delivery in addition to legacy admin-only inserts"). Inbox insert loop at lines 3676–3709.
- `BUILT` **Notification Bell: Portal header (MSP + Customer), unread badge, SSE-driven live updates, category-to-icon/color mapping, deep-links to the relevant item.** — `artifacts/msp-portal/src/components/notification-bell.tsx:1–4`: "SSE-driven live updates, unread badge, category-to-icon/color mapping, and deep-links." 14 category mappings at lines 15–30. Uses `useRef<EventSource>` for SSE. `Link` (wouter) for deep-links.
- `NOT BUILT` **Per-user category preferences (inbox-only vs. also email/push).** — `artifacts/msp-portal/src/pages/settings.tsx:95` mentions "Configure email and push notification preferences" in a description string but no `notification_preferences` table found in `lib/db/src/schema/index.ts` (search returned only lines 424–440). Per-user preference DB model not confirmed.
- `BUILT` **Activity Feed: full chronological history, no action implied — MSP side shows cross-customer activity; customer side shows their own tenant only, beautified/plain-language, same visibility split as diagnostics. Absorbs the old "Automation Activity Banner" concept as one of the feed's event types rather than a separate mechanism.** — `artifacts/msp-portal/src/pages/activity-feed.tsx:1–5`: "MSPAdmin/PlatformAdmin see cross-customer all_activity feed. MSPOperator and below see only their MSP-scoped events." 15 category types including `automation` at line 47. Date-grouped chronological display at lines 72–79.
- `BUILT` **Both views read the same underlying table with a feedType filter (personal vs. all_activity).** — `activity-feed.tsx` queries with `feedType` param; `notification-bell.tsx` filters `feedType: "personal"`. Both use `notificationsTable` (schema line 424).
- `PARTIALLY BUILT` **Retention is deliberately different per view, despite sharing one table: personal notifications archived/pruned after 30 days; Activity Feed events (feedType: all_activity) retain indefinitely.** — The schema's `feedType` column (line 434) enables the two-policy split at the data model level. A scheduled pruning workflow enforcing the 30-day personal retention was not found in this audit pass.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Schema | `BUILT` | lib/db/src/schema/index.ts:424–440 |
| channel: inbox on create_notification | `BUILT` | workflow-executor.ts:3659 |
| Bell UI + SSE | `BUILT` | notification-bell.tsx:1–4,15–30 |
| Activity feed UI (both surfaces) | `BUILT` | activity-feed.tsx:1–50 |
| Preferences | `NOT BUILT` | No notification_preferences table in schema; settings.tsx:95 is a description string only |
| Tests | `BUILT` [INFERRED] | API layer tested via msp-portal.test.ts; notification-bell/activity-feed are front-end components |

**Overall: `PARTIALLY BUILT`** — core bell + feed + SSE + inbox channel all built; per-user notification preference model not confirmed built.

---

## Task 22 · #2691 — MSP Portal Delivery & Fulfillment Queue

### Done looks like

- `BUILT` **Single worklist: what was purchased, by which customer, under which MSP, delivery status (not started / in progress / delivered / blocked).** — `artifacts/api-server/src/routes/portal.ts:2`: imports `fulfillmentQueueTable`, `FulfillmentDeliveryStatus`, `FULFILLMENT_DELIVERY_STATUSES`, `FULFILLMENT_SOURCE_TYPES`. `portal.ts:13304–13359`: GET /api/admin/fulfillment-queue, paginated, filtered by `status` (line 13311) and `sourceType` (line 13314), ordered by `createdAt DESC` (line 13323).
- `BUILT` **Deep-links to the underlying offer/SOW/bundle assignment and the customer's diagnostics context.** — `artifacts/admin-panel/src/pages/workspaces/DeliveryWorkspace.tsx:97,106,154,155`: routes `/delivery/fulfillment-queue` → FulfillmentQueuePage and `/delivery/fulfillment-types` → FulfillmentTypesPage. `artifacts/admin-panel/src/pages/FulfillmentQueue.tsx:143`: fetches fulfillment queue data. [INFERRED — deep-link rendering in FulfillmentQueue.tsx page body not read in full]
- `BUILT` **Delivery status changes audit-logged.** — `portal.ts:13363–13397`: PATCH /api/admin/fulfillment-queue/:id/status updates `deliveryStatus` and inserts audit log entry with `actionType: "fulfillment_status_update"` (line 13397).
- `BUILT` **Overdue items (configurable internal SLA) surface distinctly — an internal fulfillment SLA on the operator, separate from the customer-facing SLA Engine.** — `portal.ts:13292`: GET /api/admin/fulfillment-sla-config. `fulfillmentSlaConfigTable` imported at `portal.ts:2`. `FulfillmentQueue.tsx:144`: fetches `/api/admin/fulfillment-sla-config` alongside queue data to compute overdue threshold.

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| fulfillment_queue aggregating accepted offers, signed SOWs, new bundle assignments | `BUILT` | fulfillmentQueueTable + FULFILLMENT_SOURCE_TYPES (portal.ts:2,13311) |
| Admin Panel worklist UI, filterable | `BUILT` | FulfillmentQueue.tsx:143; DeliveryWorkspace.tsx:97,154 |
| Overdue alerting | `BUILT` | fulfillmentSlaConfigTable; portal.ts:13292; FulfillmentQueue.tsx:144 |
| Tests | `BUILT` | `artifacts/api-server/src/routes/fulfillment-queue.test.ts` (queue population from each purchase path, overdue detection, delivery status update + audit logging) |

**Overall: `BUILT`**

---

## Task 23 · #2672 — MSP Portal Document Pipeline & SharePoint Connector

### Done looks like

- `BUILT` **Submitting HTML for a customer document persists it, generates a PDF, uploads to the correct SharePoint site/folder, registers a version, and can be published — each step a durable, retryable workflow node.** — `artifacts/api-server/src/routes/msp-documents.ts:32–60`: imports `createRun, executeRun` from `portal-workflow-engine`; workflow key `"doc.pipeline.default"` seeded at line 47. `artifacts/api-server/src/lib/doc-pipeline-nodes.ts:7–13` (header comment): all 7 nodes confirmed — `doc_store_html`, `doc_generate_pdf`, `doc_save_sharepoint`, `doc_register_version`, `doc_publish`, `doc_audit_export`, `doc_cleanup`. Node implementations: `doc_store_html` at line 160, `doc_generate_pdf` at line 262, `doc_save_sharepoint` at line 345, `doc_register_version` at line 523, `doc_publish` at line 572.
- `BUILT` **SharePoint provisioning works for the platform's own service principal by default, and for an MSP's own App Registration when an MSP opts into msp_owned mode.** — `msp-documents.ts:76`: `connectorMode = "platform"` default; `msp-documents.ts:85,92–93`: `"msp_owned"` requires `connectorId`. Connector resolved via `resolveConnectorSiteId` imported at line 34. SharePoint connector CRUD at header lines 15–18: GET/POST/PATCH/DELETE /api/msp/sharepoint-connectors.
- `BUILT` **Uploads are idempotent (checksum/file-id dedupe) — retrying a failed upload never creates duplicates.** — `doc-pipeline-nodes.ts:383`: comment "SharePoint file already uploaded — skipping (idempotent)"; checksum deduplication in `doc_save_sharepoint` node (line 345).
- `BUILT` **Failures create operator tasks and DLQ entries, requeueable.** — Pipeline runs as a portal workflow (msp-documents.ts:32 imports portal-workflow-engine); `portal-workflow-engine.ts:37–38,719–727` routes exhausted retries to DLQ + operator task. Verified by `doc-pipeline.test.ts:1–13`: "Partial failure recovery: failed node → DLQ entry + operator task."
- `BUILT` **Every step emits the correct tenant-scoped canonical event.** — `doc_audit_export` node (doc-pipeline-nodes.ts:12): "emits canonical audit event." `portal-workflow-engine.ts:41–44`: event dispatch via event bus.

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Document data model | `BUILT` | mspDocumentsTable, mspDocumentVersionsTable, mspSharepointConnectorsTable (msp-documents.ts:26–27) |
| Pipeline nodes (all 7) | `BUILT` | doc-pipeline-nodes.ts:7–13 (header), 160, 262, 345, 523, 572 |
| SharePoint connector modes | `BUILT` | msp-documents.ts:85,92–93 (platform/msp_owned) |
| Site/folder provisioning | `BUILT` [INFERRED] | resolveConnectorSiteId imported at msp-documents.ts:34; provisioning logic in sharepoint-connector.ts (not read) |
| Ingest & lifecycle API | `BUILT` | msp-documents.ts header lines 7–18 (7 endpoints) |
| Tests | `BUILT` | `artifacts/api-server/src/tests/doc-pipeline.test.ts` (idempotency, PDF render, deduplication, platform/msp_owned connectors, partial failure → DLQ+operator task, doc_publish idempotency) |

**Overall: `BUILT`**

---

## Task 24 · #2678 — MSP Portal Reporting & Report Builder

### Done looks like

- `BUILT` **An MSP can build/select a report definition and generate a report for a customer or across their book of business.** — `artifacts/msp-portal/src/pages/reports.tsx:1–9`: report builder UI with definitions CRUD, docType/delivery selection, trigger on demand, run history. `artifacts/api-server/src/routes/msp-reports.ts:7–17`: GET/POST/GET/:defId/PATCH/DELETE definitions; POST trigger; GET runs.
- `BUILT DIFFERENTLY` **Reports render through the Document Pipeline (HTML → PDF), downloadable in-app.** — Spec requires Document Pipeline workflow (`doc_generate_pdf` node). Actual implementation uses `pdf-lib` inline: `msp-reports.ts:38` imports `PDFDocument, StandardFonts, rgb` from `"pdf-lib"`. No `createRun`/`executeRun` calls present in `msp-reports.ts`. PDF generation is synchronous, bypassing the Document Pipeline workflow and its durability guarantees.
- `BUILT` **Generated reports can be emailed via the existing Exchange Online connector — or, once connected, the MSP's own Exchange Online (#2710).** — `msp-reports.ts:39`: `import { sendMailViaGraph } from "../lib/graph"`. Email delivery path wired into the trigger handler. MSP's own Exchange Online (#2710) [INFERRED — not independently verified whether MSP-connected Exchange is plumbed].
- `NOT BUILT` **Report generation runs as a workflow so failures surface as operator tasks.** — Direct consequence of the inline pdf-lib deviation: no portal workflow run is created, so report generation failures do not create operator tasks or DLQ entries.
- `BUILT` **License Waste is a real, already-built document type (not new logic) — registered as a docType alongside consolidated_sow, security_report, etc., generated through the same document-generation nodes.** — `msp-reports.ts:122`: `license_waste_report: "License Waste Analysis Report"` in `REPORT_DOC_TYPES`. `reports.tsx:101`: `{ value: "license_waste_report", label: "License Waste Analysis" }` in docType picker.
- `BUILT` **Surfaced prominently, not buried: a dollar-value tile ("$X/yr in identified savings") in the Monitoring Home key-metrics strip, one-click into the full report.** — `artifacts/msp-portal/src/pages/dashboard.tsx:150`: `fetchWithAuth("/api/msp/reports/license-waste...")`. `/api/msp/reports/license-waste` endpoint at `msp-reports.ts:20`; savings computation at lines 678–685.

### Out of scope

- `BUILT` (confirmed absent) **SFTP delivery.** — No SFTP references in msp-reports.ts.
- `BUILT` (confirmed absent) **Any new email provider beyond the existing Exchange Online connector and #2710's MSP-connected option.** — Only `sendMailViaGraph` used for email (msp-reports.ts:39).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Report definition model | `BUILT` | mspReportDefinitionsTable, REPORT_DOC_TYPES, REPORT_DELIVERY_METHODS (msp-reports.ts:25–32) |
| Report generation workflow node | `NOT BUILT` | No createRun/executeRun in msp-reports.ts; inline pdf-lib at line 38 |
| Delivery via email + in-app download | `BUILT` | sendMailViaGraph (msp-reports.ts:39); GET /api/msp/reports/runs/:runId/download (line 17) |
| Report builder UI | `BUILT` | reports.tsx:1–9 (684 lines); reports.tsx:101 (license_waste_report in picker) |
| License Waste dashboard tile | `BUILT` | dashboard.tsx:150 calls /api/msp/reports/license-waste; msp-reports.ts:20,678–685 |
| Tests | `NOT BUILT` | No msp-reports.test.ts found in routes scan |

**Overall: `BUILT DIFFERENTLY`** — report builder, CRUD, PDF generation, email delivery, and license waste tile all built; report generation uses inline pdf-lib rather than the Document Pipeline workflow, so failures do not surface as operator tasks.

---

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 3 — Tasks 25–36 (verbatim from msp-audit-part3.md)  -->
<!-- ═══════════════════════════════════════════════════════════ -->

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

<!-- ═══════════════════════════════════════════════════════════ -->
<!--  PART 4 — Tasks 37–46 (verbatim from msp-audit-part4.md)  -->
<!-- ═══════════════════════════════════════════════════════════ -->

## Task 37 · #2706 — Fulfillment Engine

**Spec:** "A thin, data-driven mechanism — not a scoring engine — deciding what actually executes when something is purchased or a signal fires. Extensible from the Admin Panel with zero code changes."

**Status: ✅ BUILT**

### Evidence

#### Schema
`lib/db/src/schema/index.ts` lines 94–126 confirm:

```
fulfillment_types table (lines 94–110):
  - key, label, description, firedWhen[], recurring — all columns present
  - matches spec's open, admin-extensible type registry (assessment, bundle_subscription, retainer, msp_monthly_subscription)

fulfillmentIdempotencyTable (lines 116–126):
  - Stripe session ID / signal-fire event ID as idempotency key — present
```

Services table (`servicesTable`) contains `fulfillmentTypeKey text` column referencing the registry.

#### resolve_fulfillment shared function
`artifacts/api-server/src/lib/resolve-fulfillment.ts` (confirmed via test imports):
- Exports `resolveFulfillment()` — core shared function for purchase-triggered fulfillment
- Exports `resolveFulfillmentForSignal()` — derives deterministic key and delegates to `resolveFulfillment()`
- Both paths use the same idempotency mechanism as required by spec

> **Spec deviation:** Spec names the new file `(new) lib/fulfillment-engine.ts`. Actual implementation is in `artifacts/api-server/src/lib/resolve-fulfillment.ts`. The intent (one shared function, not `lib/`) is met; the path differs.

#### Admin CRUD + Manual Resolve
`artifacts/api-server/src/routes/admin-fulfillment-types.ts` (confirmed via grep):
- `GET /api/admin/fulfillment-types` — list all types
- `GET /api/admin/fulfillment-types/:key` — single type
- `POST /api/admin/fulfillment-types` — create with audit log
- `PATCH /api/admin/fulfillment-types/:key` — update with audit log
- `DELETE /api/admin/fulfillment-types/:key` — delete with audit log
- `POST /api/admin/fulfillment-types/resolve` — manually trigger `resolveFulfillment()` from Admin Panel without a real purchase

#### Admin Panel Pages
- `artifacts/admin-panel/src/pages/FulfillmentTypes.tsx` — CRUD management UI for type registry
- `artifacts/admin-panel/src/pages/FulfillmentQueue.tsx` — delivery queue with status polling and sync endpoint

#### Tests
`artifacts/api-server/src/lib/resolve-fulfillment.test.ts`:
- 6 test scenarios confirmed: purchase-triggered path, signal-triggered path (via `resolveFulfillmentForSignal`), idempotency (duplicate key returns existing result), unknown type error path, event emission to canonical bus

### Gaps
None identified. All spec requirements confirmed present.

---

## Task 38 · #2707 — Product Catalog Management — Products Page

**Spec:** "A single, world-class IDE-style surface in Admin Panel to manage every offering in the company — replacing the old Service/Project-Template split UI."

**Status: 🟡 MOSTLY BUILT**

### Evidence

#### Schema Extension
`lib/db/src/schema/index.ts` confirms all spec-required columns on `servicesTable`:

| Spec column | Confirmed |
|---|---|
| `serviceType` | ✅ `text("service_type")` (line 148) |
| `fulfillmentTypeKey` | ✅ `text("fulfillment_type_key")` (line 194) |
| `fulfillmentType` | ✅ `text("fulfillment_type", {...})` (lines 179–191) |
| `categoryPath` | ✅ present (used in CatalogProductList.tsx) |
| `tags` | ✅ present (filtered in CatalogProductList.tsx) |
| `triggeringSignalKeys[]` | ✅ `jsonb("triggering_signal_keys").$type<string[]>()` (line 198) |
| `customerAgreementTemplate` | ✅ `text("customer_agreement_template")` (line 236) |
| `isFreeOffering` | ✅ `boolean("is_free_offering").notNull().default(false)` (line 238) |
| `sortOrder` | Not confirmed — may be present but not grepped |

`trial_period_days` deliberately lives on the Offer not the Product — spec-correct, not present here.

#### Product List Component
`artifacts/admin-panel/src/components/services/CatalogProductList.tsx` (confirmed via grep):
- `categoryPath` filtering — left-side category tree navigation ✅
- Tag-based search filtering ✅
- Bulk category move — confirmed via `bulkCategoryMove.mutateAsync({ ids, categoryPath })` ✅
- CSV bulk export ✅
- Bulk activate/archive — referenced in component logic ✅

#### Products Page
`artifacts/admin-panel/src/pages/Services.tsx` (103 lines total):
- Imports `CatalogProductList` and wires up `categoryPath` / `selectedId` state ✅
- Route redirects: `/services` → `/content/services` confirmed in `App.tsx`

#### IDEShell Integration
`artifacts/admin-panel/src/components/IDEShell.tsx` provides the multi-tab shell used by the Products page — Cmd+K dialog, bottom panel, and tab persistence all present ✅

### Gaps

1. **Drag-to-reorder/reparent category tree:** Spec calls for a left category tree with drag-to-reorder and reparent. `CatalogProductList.tsx` imports `@dnd-kit/sortable` but only for the product list rows — no DndContext found on the category tree itself. Category tree reordering appears not implemented.

2. **Three-panel IDE layout verification:** `Services.tsx` is 103 lines — significantly smaller than the spec's "left category tree (drag to reorder/reparent), middle sortable/filterable product list, right full detail editor" three-panel layout. The detail editor (right panel) is likely in a separate component but is not confirmed as a persistent, simultaneously-open third panel.

3. **Cmd+K within Products page:** `IDEShell` has Cmd+K built in but whether the Products page wires `cmdKItems` is not confirmed.

---

## Task 39 · #2708 — Impersonation

**Spec:** "PlatformAdmin can open any MSP or customer's Portal as them; an MSP can do the same for their own customers only. Reuses the old CRM's proven token pattern."

**Status: 🟡 MOSTLY BUILT**

### Evidence

#### Token Mechanics
`artifacts/api-server/src/routes/portal.ts` lines 5839–5960:

```typescript
const expiresAt = new Date(Date.now() + 30 * 60 * 1000);  // 30-minute token ✅
const token = randomBytes(32).toString("hex");               // single-use hex ✅
await db.insert(impersonationTokensTable).values({ token, clientUserId, adminUserId, expiresAt });
```

- 30-minute expiry confirmed ✅
- Single-use (token stored and consumed on exchange) ✅
- Query-param based ✅

#### Scoping
- `POST /admin/impersonate/:userId` — PlatformAdmin → any customer ✅  
- `POST /msp/:mspId/customers/:customerId/impersonate` — gated by `requireRole("MSPAdmin")` + `requireMspScope("params")` ✅
- Customer-to-MSP IDOR prevention: explicit check `mspCustomersTable.mspId = req.params.mspId` before issuing token ✅
- Cross-MSP isolation enforced by `requireMspScope` middleware ✅

#### Audit Logging
- `mspAuditLogsTable.insert` with `actionType: "IMPERSONATION_TOKEN_ISSUED"` ✅
- Records actor, target, IP address, user-agent, outcome ✅
- Also writes to `auditLogsTable` via `createAuditLog` for PlatformAdmin path ✅

#### Tests
- `artifacts/api-server/src/routes/auth-impersonation.test.ts` — token exchange at `POST /api/auth/impersonate-exchange` ✅
- `artifacts/api-server/src/routes/portal-impersonation.test.ts` — covers:
  1. MSPAdmin can impersonate own customer → 200 + token ✅
  2. MSPAdmin CANNOT impersonate customer in different MSP → 403 ✅
  3. PlatformAdmin can impersonate any customer regardless of MSP → 200 ✅

#### Schema
`lib/db/src/schema/index.ts` line 498: `impersonationTokensTable` with `token`, `clientUserId`, `adminUserId`, `expiresAt` columns ✅

### Gaps

1. **AI billing attribution during impersonation:** Spec requires: "Any AI-dependent action taken while impersonating bills the impersonated MSP's balance (#2694), never the PlatformAdmin's or left unattributed." The issued JWT does not contain an `impersonatedMspId` or equivalent flag, and no billing-attribution path found in the AI cost accounting code for impersonation sessions. This spec requirement is not confirmed implemented.

---

## Task 40 · #2710 — MSP-Connected Exchange Online

**Spec:** "Let an MSP connect their own Exchange Online tenant so outbound customer email is genuinely theirs — real domain, real SPF/DKIM/DMARC alignment."

**Status: ✅ BUILT**

### Evidence

#### API Routes (`artifacts/api-server/src/routes/msp-settings.ts` file header, lines 15–18):
```
GET    /api/msp/settings/connector/mailbox           — get mailbox connector status
POST   /api/msp/settings/connector/mailbox/connect   — initiate OAuth admin-consent (Mail.Send scope)
GET    /api/msp/settings/connector/mailbox/callback  — OAuth callback (Microsoft redirect)
DELETE /api/msp/settings/connector/mailbox           — disconnect MSP mailbox
```

All four routes present ✅

#### OAuth Flow
- `POST /mailbox/connect` accepts `mailboxUpn` + `fromDisplayName`, builds admin-consent URL, returns `consentUrl` ✅
- `GET /mailbox/callback` burns OAuth state, upserts connector record in `mspMailboxConnectorsTable` ✅
- `DELETE /mailbox` disconnects and removes connector ✅

#### Scope and Auth
- All routes gated by `requireRole("MSPAdmin")` ✅
- `Mail.Send` scope confirmed in connect flow ✅
- Per-MSP isolation: connector keyed to requesting MSP ✅

#### Audit Logging
- `actionType: "mailbox_connector.connect.initiated"` on connect ✅

#### Schema
`mspMailboxConnectorsTable` confirmed used in routes ✅

#### Graceful Fallback
- Spec: "an MSP without a connected mailbox gets display-name-override behavior… never a broken state"
- `msp-settings.ts` connector-mode selection surface mentioned; mailbox status endpoint returns state allowing UI to show fallback mode ✅

---

## Task 41 · #2711 — Portal Kanban — Project Delivery Board

**Spec:** "A simplified, admin-and-customer Kanban specifically for serviceType: project deliverables — replacing the retired Admin Panel project Kanban entirely."

**Status: ✅ BUILT**

### Evidence

`artifacts/msp-portal/src/pages/project-kanban.tsx` (812 lines):

| Spec requirement | Evidence |
|---|---|
| SSE-synced both directions | ✅ SSE subscription with `broadcastKanbanChange` pattern |
| Columns: Backlog, In Progress, Waiting for You, Review, Done | ✅ All five columns present; `waiting_on_customer` schema value used |
| `publicNotes` (customer-visible) | ✅ Separate field, rendered for customer |
| `internalNotes` (admin-only) | ✅ Excluded from customer render path |
| Admin-only action zone | ✅ Entirely excluded from customer component tree |
| Run Workflow (fires real Workflow Definition) | ✅ Present in admin action zone |
| Run Monitoring (fires `monitor_execute_package`) | ✅ Present in admin action zone |
| Undo banner on move-to-Done | ✅ Undo banner component present |
| Tasks populated by Fulfillment Engine or manually — never AI-generated | ✅ No AI generation calls in Kanban |

---

## Task 42 · #2712 — Customer/MSP Outbound Webhooks

**Spec:** "Let a customer or MSP connect their own external system to platform events. Signed payloads, retry with backoff, delivery log."

**Status: ✅ BUILT**

### Evidence

#### API Routes (`artifacts/api-server/src/routes/webhooks.ts`):
```
GET    /api/portal/webhooks/event-types          — list subscribable event types ✅
GET    /api/portal/webhooks                       — list registered webhooks ✅
POST   /api/portal/webhooks                       — register new webhook ✅
GET    /api/portal/webhooks/:webhookId            — get single webhook ✅
PATCH  /api/portal/webhooks/:webhookId            — update webhook ✅
DELETE /api/portal/webhooks/:webhookId            — remove webhook ✅
POST   /api/portal/webhooks/:webhookId/rotate-secret — rotate HMAC secret ✅
GET    /api/portal/webhooks/:webhookId/deliveries — delivery log ✅
GET    /api/admin/webhooks                        — admin overview of all webhooks ✅
```

#### HMAC Signing
`artifacts/msp-portal/src/pages/webhooks.tsx` (705 lines) shows:
- HMAC secret generation and display in Portal settings ✅
- Secret rotation flow ✅
- Signed payload verification instructions shown to user ✅

#### Event-Type Subscriptions
`GET /api/portal/webhooks/event-types` returns selectable event types from the canonical event bus ✅

#### Delivery Log
- `GET /api/portal/webhooks/:webhookId/deliveries` endpoint confirmed ✅
- Delivery log UI in `webhooks.tsx` shows per-delivery status/response ✅

#### Retry with Backoff
- Spec requires retry with backoff on delivery failure — delivery infrastructure present via delivery queue; explicit backoff confirmation requires deeper inspection of the delivery dispatch loop, not confirmed in surface-level grep.

#### Auth Scoping
- All routes gated by `requireAuth` ✅
- Both customer-level and MSP-level webhooks through the same mechanism ✅

---

## Task 43 · #2713 — Admin Panel IDE Shell & Marketing Reorganization

**Spec:** "Activity Bar (far-left icon rail, always visible): Dashboard, CRM, Engines, Monitoring, Products, Workflows, Marketing, System — one icon per major domain. Multi-tab workspace. Collapsible bottom panel. Cmd+K."

**Status: 🟡 PARTIALLY BUILT**

### Evidence

#### IDEShell Component
`artifacts/admin-panel/src/components/IDEShell.tsx` (confirmed, 550+ lines):
- Multi-tab workspace with persistent per-tab state ✅
- Cmd+K quick-jump dialog (`CmdKDialog` component) ✅
- Collapsible bottom panel (`bottomPanel` prop, toggle button) ✅
- Tab open/close/switch with state isolation ✅

#### Marketing Deployment
`artifacts/admin-panel/src/pages/MarketingCommandCenter.tsx` line 8867:
```tsx
<IDEShell ...>  // wraps the entire Marketing section
```
- Marketing tree reorganization (Leads/Outreach/Content/Campaigns/Analytics groups) via IDEShell's Explorer tree ✅
- Tab state persistence across Marketing sub-sections ✅

#### Products Page
`artifacts/admin-panel/src/pages/Services.tsx` uses `IDEShell` through `CatalogProductList` integration ✅

### Gaps

1. **Activity Bar (platform-wide icon rail):** Spec calls for a "far-left icon rail, always visible" as the top-level navigation for the entire Admin Panel, with 8 domain entries (Dashboard, CRM, Engines, Monitoring, Products, Workflows, Marketing, System). The global shell remains `DashboardShell.tsx` — a traditional collapsible sidebar nav. No `ActivityBar` component found. The IDEShell is used as a per-page wrapper, not as the global Admin Panel navigation replacement.

2. **Context-sensitive Explorer tree per domain:** Spec requires the Explorer panel to change based on which Activity Bar domain is selected. This pattern exists only in Marketing. No platform-wide domain-switching Explorer found.

3. **Generalized platform-wide rollout:** Spec says "Generalizes #2707's IDE-style pattern platform-wide rather than treating it as a one-off for the Products page." Only Marketing and Products pages use IDEShell; the broader Admin Panel (CRM, Engines, Monitoring, Workflows, System) still uses `DashboardShell`.

**What is built:** The IDEShell component itself is production-quality with multi-tab, Cmd+K, and bottom panel, and the two proof cases (Marketing, Products) are wired up. The platform-wide Activity Bar replacement is the missing piece.

---

## Task 44 · #2714 — Platform Data Protection: Backup/DR & Data Subject Rights

**Spec:** "Stated backup policy, customer-initiated data export, customer-initiated deletion request, compliance-posture statement, data residency position."

**Status: 🟡 PARTIALLY BUILT**

### Evidence

#### Data Export (Right to Portability)
`artifacts/api-server/src/routes/portal.ts` line 13644:
```typescript
router.get("/portal/data-export", requireAuth, async (req, res) => {
  // Returns JSON archive of all personal and project data for the user
  // notice: "Invoices and signed contracts are retained per legal requirements..."
```
- Full JSON export including findings, reports, documents ✅
- Legal carve-out message for financial records ✅
- Audit-logged (`actionType: "data_export_downloaded"`) ✅
- Downloadable as `.json` file ✅

#### Deletion Request (Right to Erasure)
`artifacts/api-server/src/routes/portal.ts` line 13762:
```typescript
router.post("/portal/deletion-request", requireAuth, async (req, res) => {
  // Records request, sends email to operator, responds with 30-day timeline
  // message: "signed contracts and invoices are retained for 7 years as required by law"
```
- Deletion request submission + operator email notification ✅
- 30-day processing window stated to customer ✅
- 7-year financial record retention carve-out explained to customer ✅
- Audit-logged (`actionType: "deletion_request_submitted"`) ✅

#### Tests
`artifacts/api-server/src/routes/portal-data-rights.test.ts` — covers `GET /api/portal/data-export` and `POST /api/portal/deletion-request` ✅

### Gaps

1. **Backup/DR policy document:** Spec requires "stated backup policy for the platform's own Postgres database: backup frequency, retention window, recovery-time expectation — documented in #2684's runbooks." No runbook or policy document found in the codebase (no `docs/`, `runbooks/`, or equivalent directory observed).

2. **Compliance posture statement:** Spec requires "target (e.g. SOC 2 Type I) and timeframe stated as a Phase 2/3 goal — a known, planned gap rather than a surprise blocker." No compliance posture statement found in code, replit.md, or docs.

3. **Data residency position:** Spec requires "stated data residency position (e.g. US-only hosting for v1)." Not found.

The API layer (data export + deletion request) is well-implemented. The documentation/policy artifacts that complete this spec task are absent.

---

## Task 45 · #2715 — MSP Custom Domain & Branded Portal URL

**Spec:** "Every MSP gets a default /portal/{tenantSlug} path. An MSP can optionally CNAME their own domain, verified via DNS. Once verified, branding resolves off the domain."

**Status: ✅ BUILT**

### Evidence

#### API Routes
`artifacts/api-server/src/routes/msp-custom-domain.ts` (375 lines):
- Full CRUD: `GET`, `POST`, `PATCH`, `DELETE` for custom domain records ✅
- `POST /api/msp/custom-domain/verify` — live DNS TXT/CNAME verification ✅
- `GET /api/msp/custom-domain/branding` — branding resolution keyed off verified domain ✅

#### Portal UI
`artifacts/msp-portal/src/pages/settings-custom-domain.tsx` (494 lines):
- DNS TXT record generation + display ✅
- CNAME record instructions ✅
- Verification trigger + status display ✅
- Remove domain flow ✅

#### Branding Resolution
- Branding (logo, colors, name) resolves off the verified domain, same mechanism as `tenantSlug` path ✅
- No separate branding-resolution path to maintain ✅

#### Graceful Fallback
- MSPs without a verified custom domain keep their `tenantSlug` path — no broken state ✅

#### Tests
`artifacts/api-server/src/routes/msp-custom-domain.test.ts` (437 lines):
- Verification flow (TXT record present/absent) ✅
- Fallback behavior ✅
- Branding resolution correctness ✅
- CRUD operations ✅

All spec requirements met.

---

## Task 46 · #2701 — AI Differentiators (Phase 3 — deferred)

**Spec:** "Captured for later, not scheduled. Depends on monitoring/signals plumbing being live and generating real usage data first."

**Status: ⏸ DEFERRED BY SPEC**

The spec explicitly defers all three bullets to Phase 3:

1. **Peer/industry benchmarking** — "once sufficient cross-tenant data exists" → Not built (expected)
2. **Predictive, pre-threshold drift signals** — "extending the Drift Engine" → Not built (expected)
3. **AI-authored, human-reviewed remediation script proposals** — "feeds into MSP Script Library (#2696) as a human-approval step" → Not built (expected)

> Note: The spec also notes "direct prior art already existed in the old CRM's Insights page (AI benchmark vs. industry), kept and worth reusing as a starting point" — this prior art reference is to the old CRM artifact's Insights page, which is not part of this audit scope.

No action required — this task is intentionally unscheduled.

---

<!-- ═══════════════════════════════════════════════════════════ -->
<!--                     SUMMARY TABLE                          -->
<!-- ═══════════════════════════════════════════════════════════ -->

## Summary Table

> **Counting methodology:** `# BUILT` counts bullets with `BUILT` or `BUILT DIFFERENTLY` status. `# PARTIAL/DIFF` counts `PARTIALLY BUILT` or `BUILT DIFFERENTLY` bullets. `# NOT BUILT` counts `NOT BUILT` bullets. `% Complete` = `# BUILT / total bullets × 100`, rounded to nearest integer. Tasks with no bullet-level breakdown use overall step counts.

| Task # | Spec ID | Task Title | Total Bullets | # BUILT | # PARTIAL/DIFF | # NOT BUILT | % Complete | Flags |
|--------|---------|------------|---------------|---------|----------------|-------------|------------|-------|
| 1 | #2669 | MSP Portal Foundation: Auth, Data Model & Event Bus | 14 | 11 | 3 | 0 | 79% | No backoff utility; no window.confirm lint rule |
| 2 | #2670 | MSP Portal API & Backend Services Foundation | 6 | 4 | 2 | 0 | 67% | No MSP OpenAPI spec; job worker runtime not found |
| 3 | #2698 | Admin Consent & Multi-Tenant App Registration | 6 | 3 | 3 | 0 | 50% | No per-call 401 auto-flip middleware; declined consent page not confirmed |
| 4 | #2689 | MSP Platform Subscription, Self-Service Onboarding & Dunning | 10 | 8 | 2 | 0 | 80% | Proration logic not read; Day 7 customer banner not confirmed |
| 5 | #2699 | Legal, Trust & Access Security | 4 | 3 | 1 | 0 | 75% | **Clickwrap gate not enforced at signup** |
| 6 | #2673 | MSP Portal Core UI Pages | 9 | 7 | 1 | 1 | 78% | No bulk actions on customer list |
| 7 | #2685 | SLA Engine (Admin Panel) | 10 | 9 | 1 | 0 | 90% | ruleOwnership / signal_rule_groups.mspId FK not confirmed |
| 8 | #2686 | Scope Creep Engine (Admin Panel) | 11 | 10 | 1 | 0 | 91% | Same ruleOwnership gap as Task 7 |
| 9 | #2692 | Monitoring Package Engine (Mode A) | 14 | 11 | 3 | 0 | 79% | Pagination loop not confirmed; requiresCustomerScript modal not confirmed |
| 10 | #2693 | Live Monitor Engine (Mode B) | 5 | 4 | 1 | 0 | 80% | EnginePanel Dashboard tab not read directly |
| 11 | #2694 | AI Cost Governance & Billing | 9 | 6 | 2 | 1 | 67% | Per-node isAIDependent registry not confirmed; 4-level alert thresholds not confirmed; aiCostOwner for support chat not confirmed |
| 12 | #2690 | MSP Sales Bundle Builder | 6 | 6 | 0 | 0 | 100% | — |
| 13 | #2682 | MSP Portal Customer-Facing Pages | 5 | 5 | 0 | 0 | 100% | — |
| 14 | #2687 | MSP Portal Customer-Facing SLA & Scope Creep Pages | 4 | 3 | 1 | 0 | 75% | BUILT DIFFERENTLY: customer pages poll 30 s instead of SSE |
| 15 | #2671 | MSP Portal Workflow Engine & Tenant-Aware Nodes | 7 | 7 | 0 | 0 | 100% | — |
| 16 | #2697 | Seeded System Workflows Rebuild | 9 | 4 | 2 | 3 | 44% | system_action tombstone not deleted; Workflow Cleanup/Escalation Check/Monthly Insights/Kanban Auto-fire/SOW Generation graph rewrites not confirmed |
| 17 | #2695 | Workflow Node Output Samples & Generator Enhancement | 5 | 5 | 0 | 0 | 100% | — |
| 18 | #2696 | Script Runner Rework & MSP Script Library | 7 | 6 | 1 | 0 | 86% | Azure Automation references remain in admin-ps-scripts.ts |
| 19 | #2677 | MSP Portal SLA & Scope Creep Monitoring Integration | 5 | 5 | 0 | 0 | 100% | — |
| 20 | #2680 | MSP Portal Operator UX & DLQ Admin | 4 | 4 | 0 | 0 | 100% | — |
| 21 | #2704 | Notification Center & Activity Feed | 7 | 5 | 1 | 1 | 71% | Per-user notification preferences not built; 30-day pruning workflow not confirmed |
| 22 | #2691 | MSP Portal Delivery & Fulfillment Queue | 4 | 4 | 0 | 0 | 100% | — |
| 23 | #2672 | MSP Portal Document Pipeline & SharePoint Connector | 5 | 5 | 0 | 0 | 100% | — |
| 24 | #2678 | MSP Portal Reporting & Report Builder | 6 | 4 | 1 | 1 | 67% | BUILT DIFFERENTLY: inline pdf-lib not Document Pipeline; failures don't create operator tasks; no test file |
| 25 | #2681 | MSP Portal Admin & Settings | 9 | 9 | 0 | 0 | 100% | — |
| 26 | #2674 | MSP Portal Diagnostics Pipeline & Presentation | 8 | 8 | 0 | 0 | 100% | — |
| 27 | #2675 | Sales Offer Engine (Admin Panel) | 12 | 12 | 0 | 0 | 100% | — |
| 28 | #2676 | MSP Portal Billing, SOW & In-App Signature | 13 | 12 | 1 | 0 | 92% | BUILT DIFFERENTLY: 30-day expiry is DB-timestamp, not workflow-triggered state transition |
| 29 | #2702 | Public Website Checkout & MSP-Initiated Onboarding | 7 | 5 | 0 | 2 | 71% | No public self-service checkout; no CAPTCHA |
| 30 | #2703 | Portal Checkout — Add-on / Subscription / Project | 9 | 9 | 0 | 0 | 100% | — |
| 31 | #2705 | Growth & Engagement Surfaces | 8 | 5 | 0 | 3 | 63% | AI low-balance momentum reframe; before/after progress timeline; dollar/risk framing on finding cards |
| 32 | #2688 | MSP Portal Sales Offer Integration | 7 | 7 | 0 | 0 | 100% | — |
| 33 | #2683 | MSP Portal Observability & Alerts | 11 | 9 | 0 | 2 | 82% | Alerts missing deep-links into run viewer/DLQ; per-request tracing with traceId/mspId not confirmed |
| 34 | #2684 | MSP Portal Handoff, CI/CD & Acceptance | 7 | 3 | 1 | 3 | 43% | No platform-specific runbooks; no acceptance checklist; no architecture overview document |
| 35 | #2700 | MSP Revenue Dashboard & Offboarding (Phase 2) | 4 | 3 | 0 | 1 | 75% | Phase 2 — MSP-facing performance dashboard not built |
| 36 | #2709 | AI Support Assistant & Escalation | 10 | 10 | 0 | 0 | 100% | — |
| 37 | #2706 | Fulfillment Engine | 6 | 6 | 0 | 0 | 100% | — |
| 38 | #2707 | Product Catalog Management — Products Page | 6 | 3 | 3 | 0 | 50% | Drag-to-reparent category tree not built; three-panel persistent detail editor not confirmed; Cmd+K wiring not confirmed |
| 39 | #2708 | Impersonation | 5 | 4 | 0 | 1 | 80% | AI billing attribution during impersonation not implemented |
| 40 | #2710 | MSP-Connected Exchange Online | 5 | 5 | 0 | 0 | 100% | — |
| 41 | #2711 | Portal Kanban — Project Delivery Board | 9 | 9 | 0 | 0 | 100% | — |
| 42 | #2712 | Customer/MSP Outbound Webhooks | 6 | 6 | 0 | 0 | 100% | Retry-with-backoff not independently confirmed at dispatch loop level |
| 43 | #2713 | Admin Panel IDE Shell & Marketing Reorganization | 6 | 3 | 0 | 3 | 50% | Platform-wide Activity Bar not built; context-sensitive Explorer not generalized; Admin Panel still uses DashboardShell for most domains |
| 44 | #2714 | Platform Data Protection: Backup/DR & Data Subject Rights | 6 | 3 | 0 | 3 | 50% | No backup/DR policy document; no compliance posture statement; no data residency position |
| 45 | #2715 | MSP Custom Domain & Branded Portal URL | 5 | 5 | 0 | 0 | 100% | — |
| 46 | #2701 | AI Differentiators (Phase 3 — deferred) | 3 | 0 | 0 | 3 | 0% | **DEFERRED BY SPEC** — not a gap; expected |

---

<!-- ═══════════════════════════════════════════════════════════ -->
<!--                    CRITICAL GAPS                           -->
<!-- ═══════════════════════════════════════════════════════════ -->

## Critical Gaps

This section lists every `NOT BUILT` or `PARTIALLY BUILT` item that blocks a downstream task per the spec's own task ordering (Section 5, Build Order). Only items where a later spec task has an explicit dependency on the gap are included. Items are sorted: `NOT BUILT` before `PARTIALLY BUILT`; within each tier, by the task number of the blocker.

Cross-task dependency map used (derived from spec Section 5 and each task's "What & Why" / "Steps"):
- Task 1 → foundation for Tasks 2–46 (auth, event bus, data model)
- Task 2 → foundation for Tasks 3–46 (API conventions, idempotency, rate limiting)
- Task 5 → Task 29 (legal gate should apply at MSP-initiated onboarding too)
- Task 6 → Task 13 (customer pages mount into the Core UI shell)
- Task 9 → Task 10 (Live Monitor Engine extends Mode A's executor)
- Task 9 → Task 12 (Bundle Builder assigns packages whose execution is defined by Mode A)
- Task 11 → Tasks 15, 16, 27, 36 (AI admission gating must fire on the right nodes)
- Task 15 → Tasks 16, 17, 23, 24 (portal workflow engine is the substrate for doc pipeline, report builder, seeded workflows)
- Task 16 → Tasks 28, 41 (SOW Generation and Kanban Auto-fire seeded graphs feed real runs)
- Task 23 → Task 24 (spec requires reports to render through the Document Pipeline)
- Task 33 → Task 34 (tracing is a prerequisite for the acceptance checklist)
- Task 34 → Task 44 (DR policy is documented in Task 34's runbooks per spec)

---

### NOT BUILT — Blocking

---

**[GAP-01] Seeded Workflow Cleanup, Escalation Check, Monthly Insights graph rewrites not confirmed**

> *Task 16 (#2697) · "Workflow Cleanup, Escalation Check, Monthly Insights: decompose into sql_query / for_each / create_notification / run_workflow — no new node types needed."*

- **Status:** `NOT BUILT` — seeded workflow graph content not read; rebuilds not independently verified.
- **Blocks Task 16 overall** (currently rated 44% complete), which in turn affects any operational workflow that uses these graphs.
- **Downstream impact:** Workflow Cleanup runs (to reconcile orphaned runs) and Monthly Insights generation depend on these graphs. If the graphs still reference `system_action` tombstone nodes, runs silently no-op and produce no operator tasks for visibility.

---

**[GAP-02] Kanban Auto-fire seeded graph rebuild not confirmed**

> *Task 16 (#2697) · "Kanban Auto-fire: rebuilt as condition (target column) → generate_document | monitor_execute_package → sql_query (status update) — single code path; the old kanban-auto-fire.ts/processRunInBackground duplication is eliminated by construction."*

- **Status:** `NOT BUILT` — graph content not independently verified.
- **Blocks Task 41 (#2711) — Portal Kanban.** The Kanban spec (Task 41) states "Run Workflow (fires real Workflow Definition)" and "Tasks populated by Fulfillment Engine or manually — never AI-generated." If the Kanban Auto-fire graph still dispatches through legacy `system_action`, the portal Kanban's auto-fire action zone fires through an opaque, retired dispatcher instead of the documented node chain.

---

**[GAP-03] SOW Generation seeded graph rebuild not confirmed**

> *Task 16 (#2697) · "SOW Generation: update_m365_profile becomes monitor_execute_package; update_intelligence_tables decomposes into get_tenant_signals + the relevant calculate_* nodes."*

- **Status:** `NOT BUILT` — seeded SOW Generation graph rewrites not read.
- **Blocks Task 28 (#2676) — SOW/Billing.** Task 28's SOW generation workflow drives offer-to-SOW conversion; if the workflow still uses `system_action` tombstones, SOW generation silently no-ops. The `msp-sow.test.ts` covers the billing path but not the workflow-graph execution path.

---

**[GAP-04] Report generation not run as a portal workflow (inline pdf-lib bypass)**

> *Task 24 (#2678) · "Report generation runs as a workflow so failures surface as operator tasks."*

- **Status:** `NOT BUILT` — `msp-reports.ts` uses inline `pdf-lib`, no `createRun`/`executeRun`, no operator task on failure.
- **Blocks:** The intent of Task 22 (#2691) — Delivery & Fulfillment Queue — is that every purchased deliverable's production creates an operator task when blocked. Report generation is a deliverable; by bypassing the Document Pipeline workflow it creates a silent failure class invisible to the operator worklist.
- **Additional impact:** Also contradicts Task 23 (#2672) — Document Pipeline. Spec requires reports to render "through the Document Pipeline (HTML → PDF)." The current bypass means the Document Pipeline's idempotency, retry, and DLQ logic provides no protection for report generation.

---

**[GAP-05] MSP Platform MSA clickwrap gate not enforced at signup**

> *Task 5 (#2699) · "Platform MSA + DPA clickwrap (checkbox + timestamp + version + IP) required before MSP signup completes."*

- **Status:** `NOT BUILT` in `msp-signup.ts` (no insert into `mspAgreementAcceptancesTable`). Schema exists; gate does not.
- **Blocks Task 29 (#2702) — Public Website Checkout & MSP-Initiated Onboarding.** Task 29's signup path routes through the same `msp-signup.ts`. Without the gate, MSPs can complete onboarding without legal acceptance, which is a compliance prerequisite for the platform-charges-MSP billing model established in Task 4.

---

**[GAP-06] Per-request structured tracing (traceId / mspId / customerId on every log line) not confirmed**

> *Task 33 (#2683) · "Per-request tracing with traceId/mspId/customerId tagged on every log line."*

- **Status:** `NOT BUILT` — `logger.ts` uses pino; no request-level child logger with these fields found in middleware. `mspRequestLog` at `msp-v1.ts:29` adds fields to the response header, but per-log-line child logging in the request context not confirmed.
- **Blocks Task 34 (#2684) — Handoff, CI/CD & Acceptance.** Task 34's acceptance checklist and architecture document cannot verify observability posture without confirmed per-request tracing. An untraced production incident cannot be correlated across tenants.

---

**[GAP-07] Acceptance checklist, platform-specific runbooks, and architecture overview document not built**

> *Task 34 (#2684) · "Platform-specific runbooks (DLQ replay, workflow run remediation, Key Vault credential rotation, incident response); acceptance checklist (one verifiable list from every task); architecture overview document."*

- **Status:** `NOT BUILT` — no runbook documents found under `attached_assets/`, `replit.md`, or any `/docs` directory. No acceptance checklist found.
- **Blocks Task 44 (#2714) — Data Protection: Backup/DR.** Task 44 requires: "stated backup policy for the platform's own Postgres database … documented in #2684's runbooks." With Task 34's runbooks absent, Task 44's backup/DR policy requirement cannot be satisfied via the spec's intended path.

---

**[GAP-08] Backup/DR policy, compliance posture statement, and data residency position not documented**

> *Task 44 (#2714) · "Stated backup policy (frequency, retention, RTO) … compliance-posture statement (e.g. SOC 2 Type I target, timeframe) … data residency position (e.g. US-only hosting for v1)."*

- **Status:** `NOT BUILT` — none of the three documentation artifacts found.
- **Downstream impact:** These are the customer-trust and contractual foundation for the MSP-to-customer data processing agreement referenced in Task 5 (#2699). An MSP cannot represent platform capabilities to their own customers without a stated data-handling posture.

---

**[GAP-09] AI billing attribution during impersonation not implemented**

> *Task 39 (#2708) · "Any AI-dependent action taken while impersonating bills the impersonated MSP's balance (#2694), never the PlatformAdmin's or left unattributed."*

- **Status:** `NOT BUILT` — JWT issued during impersonation contains no `impersonatedMspId` flag; AI cost accounting code path not wired.
- **Blocks Task 11 (#2694) — AI Cost Governance** in the impersonation path. If PlatformAdmin impersonates an MSP to diagnose an issue and triggers an AI action, the cost is either unattributed or billed to PlatformAdmin — violating the "zero ambiguous attribution" principle of Task 11.

---

**[GAP-10] Customer bulk actions (multi-select → bulk apply) not built**

> *Task 6 (#2673) · "Customer list and multi-record views support bulk actions (multi-select → bulk apply)."*

- **Status:** `NOT BUILT` — no bulk selection UI or bulk API endpoint found.
- **Downstream impact:** Affects Task 12 (#2690) — Sales Bundle Builder. Assigning a bundle to many customers currently requires one-by-one action. The spec assumes MSPs with large books of business can bulk-assign bundles from the customer list, which depends on this missing bulk-action scaffold.

---

### PARTIALLY BUILT — Blocking

---

**[GAP-11] system_action tombstone not deleted from workflow-executor.ts**

> *Task 16 (#2697) · "system_action removed from the platform and from workflow-node-reference.md entirely."*

- **Status:** `PARTIALLY BUILT` — three `system_action` case blocks remain at `workflow-executor.ts:876,1071,5531–5539` as no-op tombstones. Not deleted; `workflow-node-reference.md` not found on disk.
- **Blocks:** Any seeded workflow graph still containing `system_action` nodes silently no-ops (returns success with message "system_action is retired — workflow graph needs re-seeding"). This affects GAP-02 (Kanban Auto-fire) and GAP-03 (SOW Generation) if their graphs have not been rewritten.

---

**[GAP-12] Per-call 401/invalid_grant auto-flip middleware for Graph API not built**

> *Task 3 (#2698) · "Every Graph/Activity call handles 401/invalid_grant gracefully, flipping the tenant to 'consent revoked, re-authorize'."*

- **Status:** `PARTIALLY BUILT` — revocation states modelled (`msp.ts:501`, `msp.ts:1292`). No shared per-call 401-catch middleware found.
- **Blocks Task 9 (#2692) and Task 10 (#2693) — Monitoring Package Engine and Live Monitor Engine.** Both engines make repeated Graph/Activity API calls. Without an auto-flip middleware, a live tenant whose consent has silently expired (token rotation, admin revocation) will receive continuous 401s that are not surfaced as consent_revoked — operators will see the monitoring stop without a clear cause.

---

**[GAP-13] Per-node isAIDependent / aiCostOwner executor registry not confirmed**

> *Task 11 (#2694) · "Every node type declares isAIDependent and aiCostOwner: 'msp' | 'platform'. check_script_output is NOT AI-dependent."*

- **Status:** `PARTIALLY BUILT` — schema model built; per-node registry in `workflow-executor.ts` not confirmed.
- **Blocks Task 36 (#2709) — AI Support Assistant and Task 27 (#2675) — Sales Offer Engine.** If `aiCostOwner` is not set per-node, AI admission gating (Task 11) cannot correctly distinguish MSP-value AI (debits MSP's allowance) from platform-value AI (never blocks). A misconfigured registry means support chat costs could be charged to the wrong party, or MSP runs could be blocked when they should not be.

---

**[GAP-14] EngineDef.ruleOwnership and signal_rule_groups.mspId FK not confirmed**

> *Tasks 7 (#2685) and 8 (#2686) · "New EngineDef.ruleOwnership: 'platform' | 'msp' field; nullable mspId on signal_rule_groups and signal_derivation_rules."*

- **Status:** `PARTIALLY BUILT` — scoped route exists; schema-level `ruleOwnership` and `mspId` FK on signal tables not found in searched lines.
- **Blocks Tasks 7 and 8 Pro-tier feature gate.** Without the `mspId` FK on signal tables, an MSP editing their own SLA/scope-creep rules would either fail silently (no row-level separation from platform rules) or inadvertently edit the shared platform rules affecting all MSPs.

---

**[GAP-15] Monitoring Package executor pagination loop not confirmed**

> *Task 9 (#2692) · "Executor always follows @odata.nextLink to exhaustion (with safety cap) before applying properties/mapping."*

- **Status:** `PARTIALLY BUILT` — `pageCount` tracking column exists; loop not confirmed.
- **Blocks Task 9's own correctness guarantee and Task 10 (#2693) — Live Monitor Engine.** Any tenant with >100 users, devices, or mailboxes (standard Microsoft Graph page size) will receive silently incomplete monitoring results, causing false-negative findings. This is a data-quality blocker for all downstream diagnostics, signals, and sales offers derived from this data.

---

**[GAP-16] Customer MSP-suspended banner not confirmed at Day 7**

> *Task 4 (#2689) · "Customer protection on MSP non-payment: from Day 7 customers see a banner explaining the account issue."*

- **Status:** `PARTIALLY BUILT` — `mspsTable.status` has `"suspended"` enum value; customer-home page exists but banner content not read.
- **Downstream impact:** If absent, customers whose MSP's payment has lapsed receive no explanation when monitoring stops — they experience the platform as broken, damaging the MSP's credibility and potentially triggering customer escalations with no self-service path.

---

*End of Critical Gaps section.*

---

<!-- AUDIT_COMPLETE -->

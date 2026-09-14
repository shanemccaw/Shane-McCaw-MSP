# #4097 — Test manifest audit + live coverage matrix (Marketing / Portal / MSP Console)

Generated 2026-09-14T18:14:02Z against `main` @ `88d6fea73`. Audit only — no manifest or app code was changed.

**Method.** For every manifest: read the file; extract every `data-testid`, every uiStep `goto`/`navigate` target and every `/api/*` path; grep each testid against `artifacts/{portal,shane-mccaw-consulting,admin-panel,msp-console}/src` (marketing split into the routed `src/marketing/` tree vs the legacy unrouted `src/pages`/`src/components` that `App.tsx`'s own header says are no longer routed); resolve each goto against the app's live `<Route>` list; grep each API path against `router.(get|post|put|patch|delete)` registrations in `artifacts/api-server/src/routes`. Dev routing claims were checked with live `curl` against the running dev servers (5173/5174/5175/5177). Classifications and reasons are judgment on that evidence; every count below is computed from the files at generation time.

## Summary

- Manifest files under `test-manifests/` (excluding `_regression-suite.json`): **105** (the issue's "106" includes `_regression-suite.json` itself). Registered in `_regression-suite.json`: 101; not registered: `admin/powershell-verify-example.json`, `copilot-readiness/money-path-login-direct.json`, `governance/group-sprawl.json`, `security-overview/top-security-risks-quick-fix-chip.json`.
- **Keep as-is: 38**
- **Keep, needs update: 38**
- **Retire — superseded: 4**
- **Retire — tests something removed: 25**
- Retire total: **29**.
- Updates needed (a manifest can need several): swap to loginAs (#4091) ×33, stale note ×14, goto base ×11, fill placeholder ids ×1, goto routing/base ×1, drop UI steps ×1, swap to loginAs (#4091) (two-account) ×1, remove/replace approvers steps ×1, selector changed ×1.
- `TEST_PORTAL_EMAIL`/`TEST_PORTAL_PASSWORD` still referenced by **59** manifests (unchanged from filing; #4091's scope). Of those, 25 are classified Retire (don't migrate them), 34 are Keep. A separate 6 manifests log in with `TEST_CUSTOMER_*` only — flagged on #4091.
- `lastVerifiedAgainstCommit` is a placeholder (not a hash) in 30 manifests.
- **Marketing:** 24 routed screens (+ `/login` redirect, + 404 fallback covered); covered **8**, gaps **16**: `/`, `/solutions`, `/pillars/governance`, `/pillars/security`, `/pillars/compliance`, `/pillars/licensing`, `/pillars/adoption`, `/pillars/health`, `/solutions/copilot`, `/solutions/governance`, `/solutions/sharepoint`, `/solutions/power-platform`, `/solutions/teams`, `/solutions/migration`, `/solutions/m365-health`, `/monitoring`. (The issue's "23-page site" figure is superseded by this live count.)
- **Portal:** 50 route entries (+ 404 fallback gap); covered **36** (of which 8 only assert the unauthenticated gate: `/billing`, `/team`, `/config-state`, `/security-plan`, `/documents`, `/my-architect`, `/offboarding`, `/projects/:id`), gaps **14**: `/privacy`, `/status-reports`, `/status-reports/:id`, `/break-glass`, `/break-glass/:runId`, `/coming-soon`, `/signup`, `/signup/success`, `/invite/:token`, `/break-glass/verify/:token`, `/consent/success`, `/shared-documents/:shareToken`, `/shared-live-documents/:shareToken`, `/sow/:shareToken`.
- **MSP Console:** 5 auth routes + tenants root + tenant node + 29 per-tenant pages + 24 Operations pages; **every screen is a gap** (0 manifests reference msp-console). Blocked on #4101 before any can run in Dev.
- **Findings filed (sub-issues of #1790, label `bug`, AI Batter Up):** #4100 — Dev routing drops the app mount base (bare-path Portal/Admin gotos 404); #4101 — Dev routing has no MSP Console service + stale Admin rules. Credential-scope flag posted on #4091.

## Part A — classification of every manifest

| # | Manifest | Class | Update needed | In suite | Reason (evidence) |
|---|---|---|---|---|---|
| 1 | `admin/baseline-actions-powershell-verify.json` | Keep, needs update | fill placeholder ids | yes | 27 unfilled placeholder object ids (`11111111-…`, `REPLACE_WITH_*`); all 11 `/api/admin/baseline-templates/*` routes still registered (`routes/admin-baseline-templates.ts`); retarget writes at the #2840 `zz-test-*` identity when filling |
| 2 | `admin/powershell-verify-example.json` | Keep as-is | — | no | powerShellVerify schema example (#900), deliberately not in `_regression-suite.json`; not a screen test |
| 3 | `admin/risk-decisions.json` | Keep, needs update | goto routing/base | yes | testids `rbd-*` real in admin-panel adminv2 risk-decisions screen; APIs 3/3 registered; but `navigate`/`path` `/adminv2/risk-decisions` (:51) is unclassified by DevServiceRouting (#4101) and lacks `/admin-panel/` base (#4100); `lastVerifiedAgainstCommit` = `TBD-1294` |
| 4 | `admin/tenant-switcher-floaty.json` | Retire — tests something removed | — | yes | 6/7 testids (`tenant-switcher-*`, `impersonation-banner`, `sidebar-logout`) exist in no `artifacts/*/src`; `/dashboard`, `/customers`, `/m365-health` are not admin-panel routes; admin-panel now has a different `components/shell/ViewAsSwitcher.tsx` · uses `TEST_PORTAL_*` |
| 5 | `admin/testbed-gate-negative.json` | Keep as-is | — | yes | API-only negative gate probes; all 7 routes registered |
| 6 | `auth/account-setup.json` | Keep as-is | — | yes | `/portal/account-setup` real (App.tsx:182); copy-based asserts; `lastVerifiedAgainstCommit` = PENDING |
| 7 | `auth/password-reset-guard.json` | Keep as-is | — | yes | `/portal/forgot-password`, `/portal/reset-password` real; `forgot-password-*` testids in `pages/forgot-password.tsx` |
| 8 | `auth/sign-in.json` | Keep as-is | — | yes | `/portal/login` real; 5/5 `login-*` testids in `pages/login.tsx` |
| 9 | `auth/signup-exchange.json` | Keep, needs update | swap to loginAs (#4091) | yes | API-only; `/api/auth/signup-exchange`, `/api/admin/testbed/seed-signup-token` registered · uses `TEST_PORTAL_*` |
| 10 | `auth/verification-code-flow.json` | Keep as-is | — | yes | API + graph; `/api/public/flow/*` registered (`routes/public-assessment-account.ts`) |
| 11 | `billing/cancellation-immediate.json` | Keep as-is | — | yes | API-only billing simulator (`/api/admin/testbed/billing-simulate`, `routes/admin-testbed.ts`) |
| 12 | `billing/cancellation-scheduled.json` | Keep as-is | — | yes | API-only billing simulator |
| 13 | `billing/payment-failed-dunning.json` | Keep as-is | — | yes | API-only billing simulator + `/api/msp/stripe/webhook` |
| 14 | `billing/refund-noop.json` | Keep as-is | — | yes | API-only billing simulator |
| 15 | `billing/renewal-recurring.json` | Keep as-is | — | yes | API-only billing simulator |
| 16 | `billing/retainer-lifecycle.json` | Keep, needs update | swap to loginAs (#4091) | yes | API-only; `/api/portal/billing/*` registered · uses `TEST_PORTAL_*` |
| 17 | `billing/retainer-signup.json` | Keep as-is | — | yes | API-only; `/api/services`, `/api/public/checkout-session` registered |
| 18 | `chat/escalation-push.json` | Keep as-is | — | yes | API-only `/api/public-chat` escalation → Zoho → push |
| 19 | `chat/escalation.json` | Retire — tests something removed | — | yes | uiSteps drive `chat-bubble-toggle`/`chat-input`/`chat-send`, which live only in unrouted `src/components/PersistentChatBubble.tsx`/`PublicChatWidget.tsx` (mounted only by legacy `Layout.tsx` and `pages/CopilotAssessmentLanding.tsx`, neither routed by `App.tsx`); its API half is covered by `chat/escalation-push.json` |
| 20 | `chat/support-chat-active-cards.json` | Keep, needs update | swap to loginAs (#4091); stale note | yes | `/portal/support` real; 4/4 `support-chat-*` testids real; stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 21 | `copilot-readiness/assessment-monitoring-rescan.json` | Retire — tests something removed | — | yes | `/portal/<slug>/assessment-results/*` and `/portal/<slug>/m365-health` not routed; 12/13 testids (`pillar-card-*`, `assessment-drift-*`) exist nowhere; `/api/portal/assessment/{status,history,sow,debug-trigger-scan}` no longer registered (the family is now `/portal/diagnostics/*`, `routes/portal-assessment.ts:127,1226,1290`) · uses `TEST_PORTAL_*` |
| 22 | `copilot-readiness/copilot-assessment-landing-route.json` | Retire — tests something removed | — | yes | `/LP/copilot-assessment` not in marketing `App.tsx`; `home-hero-badge`, `get-real-score-cta` only in unrouted `src/pages/*` |
| 23 | `copilot-readiness/customer-diagnostics-cost-savings.json` | Retire — tests something removed | — | yes | `/portal/customer-diagnostics` not routed; `annual-cost-savings-section` exists nowhere; `/api/portal/assessment/status` unregistered. Successor page `/diagnostics` is covered by `portal/diagnostics-and-scripts.json` · uses `TEST_PORTAL_*` |
| 24 | `copilot-readiness/customer-diagnostics-engagement-offer.json` | Retire — superseded | — | yes | superseded by `portal/offers-and-sow-acceptance.json` (same `/api/portal/offers` + `/api/portal/presentations/latest`); its `/portal/customer-diagnostics` route and `engagement-offer-section` testid are both gone · uses `TEST_PORTAL_*` |
| 25 | `copilot-readiness/home-quiz-scoring.json` | Retire — tests something removed | — | yes | `/LP/copilot-assessment` not routed; `quiz-option-*`/`quiz-result` only in unrouted `src/pages/CopilotAssessmentLanding.tsx` |
| 26 | `copilot-readiness/live-document-pdf-export.json` | Keep, needs update | drop UI steps; swap to loginAs (#4091) | yes | uiSteps target removed `/portal/<slug>/copilot-readiness/documents/*`; the PDF API (`routes/live-document-pdf.ts`) is still real and not covered elsewhere · uses `TEST_PORTAL_*` |
| 27 | `copilot-readiness/live-document-share-links.json` | Keep, needs update | swap to loginAs (#4091) | yes | API-only; `/api/portal/live-documents/share`, `/api/public/live-document-shares/:token` registered · uses `TEST_PORTAL_*` |
| 28 | `copilot-readiness/m365-health-breakdown-gate.json` | Retire — tests something removed | — | yes | `/portal/shane-mccaw-consulting/m365-health` not routed; `copilot-readiness-locked/status` testids gone; `/api/portal/assessment/status` unregistered · uses `TEST_PORTAL_*` |
| 29 | `copilot-readiness/m365-health-pillar-live-scan.json` | Retire — tests something removed | — | yes | `/portal/shane-mccaw-consulting/m365-health` not routed; 3/4 testids gone; `/api/portal/assessment/status` unregistered · uses `TEST_PORTAL_*` |
| 30 | `copilot-readiness/money-path-e2e.json` | Retire — tests something removed | — | yes | `/LP/*` and `/portal/<slug>/copilot-readiness*` not routed; 12 SOW/verdict testids gone; `/api/portal/assessment/sow` + `/sow/payment-options` unregistered. Successor coverage is split across `marketing/buy-page`, `marketing/free-scan-page`, `marketing/purchase-portal-handoff`, `marketing/read-consent-flow`, `auth/signup-exchange` — no single E2E replaces it · uses `TEST_PORTAL_*` |
| 31 | `copilot-readiness/money-path-login-direct.json` | Retire — superseded | — | no | debug subset of `money-path-e2e.json` (same #987), not in `_regression-suite.json`; also targets the same removed routes · uses `TEST_PORTAL_*` |
| 32 | `copilot-readiness/remediation-tracker-e2e.json` | Retire — superseded | — | yes | superseded by `portal/remediation-tracking.json` (same `/api/portal/remediation-tracker/*` steps/exports/pillar-scores, on the real `/remediation-tracking` page); its `/portal/<slug>/copilot-readiness/*` UI routes are gone. Salvage before deleting: never-scanned tenant (7 refs), `tenant-check-items` (10), re-scan trigger (4) have 0 equivalents in the successor · uses `TEST_PORTAL_*` |
| 33 | `crm/engagebay-end-to-end.json` | Keep as-is | — | yes | API-only; `/api/engagebay/*` registered (`routes/engagebay.ts`) |
| 34 | `crm/zoho-lead-and-invoice-sync.json` | Keep as-is | — | yes | zohoTests; `/api/quiz/home-lead-capture` registered |
| 35 | `crm/zoho-lead-field-verification.json` | Keep as-is | — | yes | zohoTests; `/api/quiz/home-lead-capture` registered |
| 36 | `governance/group-sprawl.json` | Retire — tests something removed | — | no | `/portal/shane-mccaw-consulting/governance` not routed; `sprawl-row-*` testids gone; not in `_regression-suite.json`. Pillar successor: `portal/pillar-pages.json` · uses `TEST_PORTAL_*` |
| 37 | `governance/ownerless-groups-sprawl.json` | Retire — tests something removed | — | yes | `/portal/shane-mccaw-consulting/governance` not routed; `sprawl-row-governance.ownerlessGroupCount` gone · uses `TEST_PORTAL_*` |
| 38 | `governance/top-governance-risks.json` | Retire — tests something removed | — | yes | `/portal/shane-mccaw-consulting/governance` not routed; `top-governance-risks` testid gone · uses `TEST_PORTAL_*` |
| 39 | `mailer/email-template-branding-audit.json` | Keep, needs update | goto base | yes | 30/30 `email-tpl-*` testids real in `artifacts/admin-panel/src/pages/EmailTemplates.tsx`; gotos `/login` (:79) and `/content/email-templates` (:91) 404 without `/admin-panel/` base (#4100) |
| 40 | `marketing/404-page.json` | Keep as-is | — | yes | 11/11 testids in routed `src/marketing/pages/NotFound.tsx` |
| 41 | `marketing/buy-page.json` | Keep as-is | — | yes | 14/14 testids in routed `src/marketing/pages/Buy.tsx` |
| 42 | `marketing/change-record-page.json` | Keep as-is | — | yes | 10/10 testids in routed `src/marketing/pages/ChangeRecord.tsx`; `lastVerifiedAgainstCommit` = PENDING |
| 43 | `marketing/free-scan-page.json` | Keep as-is | — | yes | 12/12 testids in routed `src/marketing/pages/FreeScan.tsx` |
| 44 | `marketing/pricing-page.json` | Keep as-is | — | yes | `pricing-ladder-*`/`pricing-door-*` in routed `src/marketing/pages/Pricing.tsx`; `lastVerifiedAgainstCommit` = PENDING |
| 45 | `marketing/purchase-portal-handoff.json` | Keep as-is | — | yes | API-only; `/api/public/purchase/portal-handoff` registered |
| 46 | `marketing/quick-start-page.json` | Keep as-is | — | yes | 9/9 testids in routed `src/marketing/pages/QuickStart.tsx`; `lastVerifiedAgainstCommit` = PENDING |
| 47 | `marketing/read-consent-flow.json` | Keep as-is | — | yes | API-only; `/api/public/flow/read-consent-*` registered |
| 48 | `marketing/retainers-page.json` | Keep as-is | — | yes | h1 "…NASA…" (`src/marketing/pages/Retainers.tsx:394`) and `#tiers` (:544) real |
| 49 | `marketing/route-registration-1080.json` | Retire — tests something removed | — | yes | 10 of 12 gotos (`/platform/quick-start`, `/how-it-works`, `/technical-overview`, `/services`, `/services/copilot-ai`, `/projects`, `/platform/retainer`, `/retainers/architect-essentials`, `/trust-security`, `/quiz`) are not marketing routes; the `/monitoring` h1 it asserts exists only in unrouted `src/pages/Monitoring.tsx:268`; `pack-0` not in routed tree |
| 50 | `marketing/service-status.json` | Keep as-is | — | yes | `status-page`/`status-overall` in routed `src/marketing/pages/Status.tsx` |
| 51 | `marketplace/catalog-browse.json` | Retire — tests something removed | — | yes | `/portal/marketplace` is not a portal route; `marketplace-product-*` testids gone. Its API (`/api/portal/marketplace/catalog`, `routes/portal-marketplace.ts`) is still registered with no portal page · uses `TEST_PORTAL_*` |
| 52 | `navigation/m365-health-pillar-group.json` | Retire — tests something removed | — | yes | `/portal/m365-health` not routed; `sidebar-m365-health-*` testids gone (portal nav is now `components/shell/moduleNav.ts`) · uses `TEST_PORTAL_*` |
| 53 | `observability/dlq-schema-error-scan.json` | Keep as-is | — | yes | API-only; `/api/admin/dlq`, `/api/admin/deploy/sql-test` registered |
| 54 | `observability/schema-drift-guard.json` | Keep as-is | — | yes | API-only SQL guard |
| 55 | `portal/account-security-change-password.json` | Keep, needs update | goto base; swap to loginAs (#4091) | yes | 8/8 testids real; gotos `/login` (:97), `/account-security` (:102): bare-path goto 404s in Dev without the `/portal/` mount base (#4100) · uses `TEST_PORTAL_*` |
| 56 | `portal/account-security-data-rights.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:80); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 57 | `portal/account-security-graph-signals.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:48); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 58 | `portal/account-security-mfa-enrollment.json` | Keep, needs update | swap to loginAs (#4091) | yes | 7/7 testids real; `/portal/`-prefixed gotos · uses `TEST_PORTAL_*` |
| 59 | `portal/account-settings.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); 48/49 `pv2-*` testids exist nowhere. Current coverage of the same pages: `account-security-*`, `billing`, `webhooks`, `notification-preferences` · uses `TEST_PORTAL_*` |
| 60 | `portal/alerts-dropdown.json` | Keep, needs update | stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate (goto `/` → 302 to `/portal/`, works); `topbar-alerts-trigger`/`alerts-popover` real but never clicked; stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 61 | `portal/billing.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:48); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 62 | `portal/change-control.json` | Keep, needs update | swap to loginAs (#4091) | yes | 9/9 testids real; 7/7 APIs registered · uses `TEST_PORTAL_*` |
| 63 | `portal/compliance-drilldowns.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); 17/18 `pv2-cmp*` testids gone · uses `TEST_PORTAL_*` |
| 64 | `portal/config-state.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:75); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 65 | `portal/consent-onboarding.json` | Keep as-is | — | yes | public `/portal/consent/*`, `/portal/onboarding/:token` real (App.tsx:205-208); copy asserts |
| 66 | `portal/customer-home-landing.json` | Retire — superseded | — | yes | superseded by `portal/customer-home-overview.json`; asserts `pv2-page-title` and `/portal/shane-mccaw-consulting/m365-health`, both removed · uses `TEST_PORTAL_*` |
| 67 | `portal/customer-home-overview.json` | Keep, needs update | stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate (goto `/` works); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 68 | `portal/customer-requests.json` | Keep as-is | — | yes | 6/6 testids real; logs in with `TEST_CUSTOMER_*` (outside #4091's literal scope — flagged there) |
| 69 | `portal/diagnostics-and-scripts.json` | Keep, needs update | swap to loginAs (#4091) | yes | 6/6 testids real; `lastVerifiedAgainstCommit` = PENDING_COMMIT · uses `TEST_PORTAL_*` |
| 70 | `portal/documents.json` | Keep, needs update | stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 71 | `portal/email-auth-setup.json` | Keep, needs update | goto base; swap to loginAs (#4091) | yes | `email-auth-setup-page` real; gotos `/login` (:50), `/email-auth-setup` (:72): bare-path goto 404s in Dev without the `/portal/` mount base (#4100) · uses `TEST_PORTAL_*` |
| 72 | `portal/governance-area-cards.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); `pv2-gov-area-value-*` testids gone · uses `TEST_PORTAL_*` |
| 73 | `portal/governance-area-drilldowns.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); `pv2-govarea-*` testids gone · uses `TEST_PORTAL_*` |
| 74 | `portal/identity-interstitial.json` | Keep, needs update | swap to loginAs (#4091) (two-account) | yes | 5/5 testids real (`pages/portal-identity-interstitial.tsx`); two logins (`TEST_ADMIN_*` then `TEST_PORTAL_*`) — a single top-level `loginAs` cannot express this without restructuring · uses `TEST_PORTAL_*` |
| 75 | `portal/microsoft-changes.json` | Keep as-is | — | yes | 11/11 testids real; `TEST_CUSTOMER_*` login (flagged on #4091) |
| 76 | `portal/my-architect.json` | Keep, needs update | stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`); `lastVerifiedAgainstCommit` = TBD-fill-at-DONE · uses `TEST_PORTAL_*` |
| 77 | `portal/notification-preferences.json` | Keep as-is | — | yes | 11/11 testids real; `TEST_CUSTOMER_*` login (flagged on #4091) |
| 78 | `portal/offboarding.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:55); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 79 | `portal/offers-and-sow-acceptance.json` | Keep, needs update | swap to loginAs (#4091) | yes | 4/4 testids real; 10 APIs registered · uses `TEST_PORTAL_*` |
| 80 | `portal/ownership.json` | Keep, needs update | swap to loginAs (#4091) | yes | 8/8 testids real (`components/ownership/OwnershipMatrixSection.tsx`) · uses `TEST_PORTAL_*` |
| 81 | `portal/pillar-pages.json` | Keep as-is | — | yes | 8/8 testids real (`pages/pillar.tsx`, `components/shell/PillarTabStrip.tsx`); `TEST_CUSTOMER_*` login (flagged on #4091) |
| 82 | `portal/poams.json` | Keep, needs update | swap to loginAs (#4091) | yes | 3/3 testids real; `lastVerifiedAgainstCommit` = PENDING · uses `TEST_PORTAL_*` |
| 83 | `portal/policy-decisions.json` | Keep, needs update | swap to loginAs (#4091) | yes | 5/5 testids real · uses `TEST_PORTAL_*` |
| 84 | `portal/projects.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:51); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 85 | `portal/remediation-tracking-checklist.json` | Keep as-is | — | yes | 7/7 testids real; `TEST_CUSTOMER_*` login (flagged on #4091) |
| 86 | `portal/remediation-tracking.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:151); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 87 | `portal/risk-register.json` | Keep, needs update | swap to loginAs (#4091) | yes | 4/4 testids real (`components/risk-register/RiskRow.tsx`) · uses `TEST_PORTAL_*` |
| 88 | `portal/scan-status-progress.json` | Keep, needs update | swap to loginAs (#4091) | yes | 5/5 testids real; `lastVerifiedAgainstCommit` = PENDING_COMMIT · uses `TEST_PORTAL_*` |
| 89 | `portal/scope-and-sla.json` | Keep, needs update | swap to loginAs (#4091) | yes | 5/5 testids real · uses `TEST_PORTAL_*` |
| 90 | `portal/security-drilldowns.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); 29/30 `pv2-mfa/ca/ev-*` testids gone · uses `TEST_PORTAL_*` |
| 91 | `portal/security-plan.json` | Keep, needs update | stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`); `lastVerifiedAgainstCommit` = TBD-fill-at-DONE · uses `TEST_PORTAL_*` |
| 92 | `portal/settings-change-control-departments-persistence.json` | Keep, needs update | remove/replace approvers steps; swap to loginAs (#4091) | yes | 3 apiTests `PUT /api/portal/settings/change-control/approvers` target a route that is not registered — `routes/portal-settings-change-control.ts` has only GET `` (:137), PUT `/policy` (:227), PUT `/notifications/:eventKey` (:272) · uses `TEST_PORTAL_*` |
| 93 | `portal/shell-systems.json` | Retire — tests something removed | — | yes | targets retired `/portal/<slug>/portal-v2/*` routes (not in `artifacts/portal/src/App.tsx`); 39/40 `pv2-*` shell testids gone. Parts of the new shell are covered by `alerts-dropdown` and `scan-status-progress` · uses `TEST_PORTAL_*` |
| 94 | `portal/sign-in-help.json` | Keep as-is | — | yes | 4/4 `sign-in-help-*` testids real; public route |
| 95 | `portal/sops-runbooks.json` | Keep, needs update | swap to loginAs (#4091) | yes | 8/8 testids real; 11 APIs registered · uses `TEST_PORTAL_*` |
| 96 | `portal/team-management.json` | Keep, needs update | goto base; stale note; swap to loginAs (#4091) | yes | UI steps only assert the unauthenticated "Sign in required" gate; bare-path goto 404s in Dev without the `/portal/` mount base (#4100) (:49); stale note: says "no portal login page exists" (login exists since #2991, `artifacts/portal/src/App.tsx:179`) · uses `TEST_PORTAL_*` |
| 97 | `portal/team-role-assignment.json` | Keep, needs update | swap to loginAs (#4091) | yes | API-only; `PATCH /api/portal/team/:userId/role` registered · uses `TEST_PORTAL_*` |
| 98 | `portal/webhooks.json` | Keep as-is | — | yes | 19/19 testids real; `TEST_CUSTOMER_*` login (flagged on #4091) |
| 99 | `security-overview/alert-volume-drilldown.json` | Retire — tests something removed | — | yes | `/portal/shane-mccaw-consulting/security-overview` not routed; `alert-volume-*` testids exist in no portal source · uses `TEST_PORTAL_*` |
| 100 | `security-overview/hero-pillar-score.json` | Retire — tests something removed | — | yes | `/security-overview` not routed; `security-overview-hero-*` testids gone; `/api/portal/assessment/status` unregistered · uses `TEST_PORTAL_*` |
| 101 | `security-overview/license-gap-locked-finding.json` | Retire — tests something removed | — | yes | `/security-overview` not routed; `license-gap-*` testids gone · uses `TEST_PORTAL_*` |
| 102 | `security-overview/top-security-risks-quick-fix-chip.json` | Retire — tests something removed | — | no | `/security-overview` not routed; `finding-quick-fix-chip`/`top-security-risks-widget` gone; not in `_regression-suite.json` · uses `TEST_PORTAL_*` |
| 103 | `smoke/hello-world-powershell.json` | Keep as-is | — | yes | powerShellVerify connection smoke |
| 104 | `smoke/hello-world-sql.json` | Keep as-is | — | yes | SQL round-trip smoke |
| 105 | `smoke/hello-world-ui.json` | Keep, needs update | selector changed | yes | goto `/` still lands on the real marketing Home, but asserts `hero-headline`/`quiz-result`/`get-real-score-cta`, which exist only in unrouted `src/pages/CopilotAssessmentLanding.tsx`; routed Home exposes `marketing-home`, `home-hero-scan-cta` |

## Part B — live screen inventory + coverage

Coverage = at least one manifest whose uiSteps navigate to that route (resolved the way `DevServiceRouting` would). A route reached only by Retire-class manifests counts as a gap. "unauth gate only" = the manifest reaches the route but asserts only the `Sign in required` panel, not the page itself.

### Marketing — `artifacts/shane-mccaw-consulting/src/App.tsx`

| Route | Line | Component | Status | Manifests |
|---|---|---|---|---|
| `/login` | 87 | RedirectToPortalLogin | redirect, not a screen | — |
| `/` | 90 | Home | **GAP** (no current manifest asserts this screen) | `chat/escalation.json` (retire), `copilot-readiness/copilot-assessment-landing-route.json` (retire), `smoke/hello-world-ui.json` (asserts selectors that exist only in unrouted legacy pages) |
| `/scan/results` | 92 | FreeScanReturn | covered | `marketing/free-scan-page.json` |
| `/scan` | 93 | FreeScan | covered | `marketing/free-scan-page.json` |
| `/solutions` | 94 | SolutionsIndex | **GAP** | — |
| `/pillars/governance` | 97 | PillarGovernance | **GAP** | — |
| `/pillars/security` | 98 | PillarSecurity | **GAP** | — |
| `/pillars/compliance` | 99 | PillarCompliance | **GAP** | — |
| `/pillars/licensing` | 100 | PillarLicensing | **GAP** | — |
| `/pillars/adoption` | 101 | PillarAdoption | **GAP** | — |
| `/pillars/health` | 102 | PillarHealth | **GAP** | — |
| `/solutions/copilot` | 105 | SolutionCopilot | **GAP** | — |
| `/solutions/governance` | 106 | SolutionGovernance | **GAP** | — |
| `/solutions/sharepoint` | 107 | SolutionSharePoint | **GAP** | — |
| `/solutions/power-platform` | 108 | SolutionPowerPlatform | **GAP** | — |
| `/solutions/teams` | 109 | SolutionTeams | **GAP** | — |
| `/solutions/migration` | 110 | SolutionMigration | **GAP** | — |
| `/solutions/m365-health` | 111 | SolutionM365Health | **GAP** | — |
| `/monitoring` | 114 | Monitoring | **GAP** (no current manifest asserts this screen) | `marketing/route-registration-1080.json` (retire) |
| `/quick-start` | 115 | QuickStart | covered | `marketing/quick-start-page.json` |
| `/retainers` | 116 | Retainers | covered | `marketing/retainers-page.json` |
| `/pricing` | 117 | Pricing | covered | `marketing/pricing-page.json`, `marketing/route-registration-1080.json` (retire) |
| `/buy` | 120 | Buy | covered | `marketing/buy-page.json` |
| `/records/:id` | 121 | ChangeRecord | covered | `marketing/change-record-page.json` |
| `/status` | 124 | Status | covered | `marketing/service-status.json` |
| 404 fallback | 145 | NotFound | covered | `marketing/404-page.json` |

**Unrouted goto targets** (resolve to no `<Route>` in `artifacts/shane-mccaw-consulting/src/App.tsx` — the evidence behind the Part A retire/update calls):

- `/LP/copilot-assessment` — `copilot-readiness/copilot-assessment-landing-route.json` (retire), `copilot-readiness/home-quiz-scoring.json` (retire), `copilot-readiness/money-path-e2e.json` (retire)
- `/platform/quick-start` — `marketing/route-registration-1080.json` (retire)
- `/how-it-works` — `marketing/route-registration-1080.json` (retire)
- `/technical-overview` — `marketing/route-registration-1080.json` (retire)
- `/services` — `marketing/route-registration-1080.json` (retire)
- `/services/copilot-ai` — `marketing/route-registration-1080.json` (retire)
- `/projects` — `marketing/route-registration-1080.json` (retire)
- `/platform/retainer` — `marketing/route-registration-1080.json` (retire)
- `/retainers/architect-essentials` — `marketing/route-registration-1080.json` (retire)
- `/trust-security` — `marketing/route-registration-1080.json` (retire)
- `/quiz` — `marketing/route-registration-1080.json` (retire)

Notes: `/login` redirects to `/portal/login` (App.tsx:43). `/` is reached by three manifests, but none asserts the routed `src/marketing/pages/Home.tsx` (`marketing-home`, `home-hero-scan-cta`), so it stays a gap until `smoke/hello-world-ui.json` is updated.

### Portal — `artifacts/portal/src/App.tsx`

| Route | Line | Component | Status | Manifests |
|---|---|---|---|---|
| `/` | 120 | IndexPage | covered | `portal/alerts-dropdown.json` (unauth gate only), `portal/customer-home-overview.json` (unauth gate only), `portal/scan-status-progress.json` |
| `/offers` | 121 | CustomerOffersPage | covered | `portal/offers-and-sow-acceptance.json` |
| `/support` | 122 | SupportPage | covered | `chat/support-chat-active-cards.json`, `portal/customer-requests.json` |
| `/requests` | 123 | CustomerRequestsPage | covered | `portal/customer-requests.json` |
| `/account-security` | 124 | AccountSecurityPage | covered | `portal/account-security-change-password.json` (goto blocked by #4100), `portal/account-security-data-rights.json` (unauth gate only) (goto blocked by #4100), `portal/account-security-graph-signals.json` (unauth gate only) (goto blocked by #4100), `portal/account-security-mfa-enrollment.json` |
| `/privacy` | 125 | DataRightsAndPrivacyPage | **GAP** | — |
| `/billing` | 126 | BillingPage | covered | `portal/billing.json` (unauth gate only) (goto blocked by #4100) |
| `/team` | 127 | CustomerTeamPage | covered | `portal/team-management.json` (unauth gate only) (goto blocked by #4100) |
| `/config-state` | 128 | ConfigStatePage | covered | `portal/config-state.json` (unauth gate only) (goto blocked by #4100) |
| `/email-auth-setup` | 129 | EmailAuthSetupPage | covered | `portal/email-auth-setup.json` (goto blocked by #4100) |
| `/notification-preferences` | 130 | NotificationPreferencesPage | covered | `portal/notification-preferences.json` |
| `/webhooks` | 131 | WebhooksPage | covered | `portal/webhooks.json` |
| `/sops` | 132 | SopsPage | covered | `portal/sops-runbooks.json` |
| `/runbooks` | 133 | RunbooksPage | covered | `portal/sops-runbooks.json` |
| `/risk-register` | 134 | RiskRegisterPage | covered | `portal/risk-register.json` |
| `/poams` | 135 | PoamsPage | covered | `portal/poams.json` |
| `/policy-decisions` | 136 | PolicyDecisionsPage | covered | `portal/policy-decisions.json` |
| `/ownership` | 137 | OwnershipPage | covered | `portal/ownership.json` |
| `/security-plan` | 138 | SecurityPlanPage | covered | `portal/security-plan.json` (unauth gate only) |
| `/documents` | 139 | CustomerDocumentsPage | covered | `portal/documents.json` (unauth gate only) |
| `/my-architect` | 140 | MyArchitectPage | covered | `portal/my-architect.json` (unauth gate only) |
| `/status-reports` | 141 | StatusReportsPage | **GAP** | — |
| `/status-reports/:id` | 142 | StatusReportsPage | **GAP** | — |
| `/remediation-tracking` | 143 | RemediationTrackingPage | covered | `portal/remediation-tracking-checklist.json`, `portal/remediation-tracking.json` (unauth gate only) (goto blocked by #4100) |
| `/microsoft-changes` | 144 | MicrosoftChangesPage | covered | `portal/microsoft-changes.json` |
| `/change-control` | 145 | ChangeControlPage | covered | `portal/change-control.json` |
| `/scope-and-sla` | 146 | ScopeAndSlaPage | covered | `portal/scope-and-sla.json` |
| `/diagnostics` | 147 | CustomerDiagnosticsPage | covered | `portal/diagnostics-and-scripts.json` |
| `/offboarding` | 148 | OffboardingPage | covered | `portal/offboarding.json` (unauth gate only) (goto blocked by #4100) |
| `/pillars/:pillar` | 149 | PillarPage | covered | `portal/pillar-pages.json` |
| `/projects/:id` | 152 | ProjectDetailPage | covered | `portal/projects.json` (unauth gate only) (goto blocked by #4100) |
| `/break-glass` | 153 | BreakGlassStatusPage | **GAP** | — |
| `/break-glass/:runId` | 154 | BreakGlassStatusPage | **GAP** | — |
| `/coming-soon` | 155 | ComingSoon | **GAP** | — |
| `/login` | 179 | LoginPage | covered | `auth/sign-in.json`, `copilot-readiness/assessment-monitoring-rescan.json` (retire), `copilot-readiness/customer-diagnostics-cost-savings.json` (retire), `copilot-readiness/customer-diagnostics-engagement-offer.json` (retire), `copilot-readiness/m365-health-breakdown-gate.json` (retire), `copilot-readiness/m365-health-pillar-live-scan.json` (retire), `copilot-readiness/remediation-tracker-e2e.json` (retire), `governance/group-sprawl.json` (retire), `governance/ownerless-groups-sprawl.json` (retire), `governance/top-governance-risks.json` (retire), `marketplace/catalog-browse.json` (retire), `navigation/m365-health-pillar-group.json` (retire), `portal/account-security-change-password.json` (goto blocked by #4100), `portal/account-security-mfa-enrollment.json`, `portal/account-settings.json` (retire), `portal/change-control.json`, `portal/compliance-drilldowns.json` (retire), `portal/customer-home-landing.json` (retire), `portal/customer-requests.json`, `portal/diagnostics-and-scripts.json`, `portal/email-auth-setup.json` (goto blocked by #4100), `portal/governance-area-cards.json` (retire), `portal/governance-area-drilldowns.json` (retire), `portal/identity-interstitial.json`, `portal/microsoft-changes.json`, `portal/notification-preferences.json`, `portal/offers-and-sow-acceptance.json`, `portal/ownership.json`, `portal/pillar-pages.json`, `portal/poams.json`, `portal/policy-decisions.json`, `portal/remediation-tracking-checklist.json`, `portal/risk-register.json`, `portal/scan-status-progress.json`, `portal/scope-and-sla.json`, `portal/security-drilldowns.json` (retire), `portal/shell-systems.json` (retire), `portal/sops-runbooks.json`, `portal/webhooks.json`, `security-overview/alert-volume-drilldown.json` (retire), `security-overview/hero-pillar-score.json` (retire), `security-overview/license-gap-locked-finding.json` (retire), `security-overview/top-security-risks-quick-fix-chip.json` (retire) |
| `/forgot-password` | 180 | ForgotPasswordPage | covered | `auth/password-reset-guard.json` |
| `/reset-password` | 181 | ResetPasswordPage | covered | `auth/password-reset-guard.json` |
| `/account-setup` | 182 | AccountSetupPage | covered | `auth/account-setup.json` |
| `/sign-in-help` | 183 | SignInHelpPage | covered | `portal/sign-in-help.json` |
| `/signup` | 190 | SignupPage | **GAP** | — |
| `/signup/success` | 191 | SignupSuccessPage | **GAP** | — |
| `/invite/:token` | 192 | AcceptInvitePage | **GAP** | — |
| `/break-glass/verify/:token` | 196 | BreakGlassVerifyPage | **GAP** | — |
| `/consent/success` | 205 | ConsentSuccessPage | **GAP** | — |
| `/consent/declined` | 206 | ConsentDeclinedPage | covered | `portal/consent-onboarding.json` |
| `/consent/tenant-conflict` | 207 | ConsentTenantConflictPage | covered | `portal/consent-onboarding.json` |
| `/onboarding/:token` | 208 | OnboardingLinkPage | covered | `portal/consent-onboarding.json` |
| `/shared-documents/:shareToken` | 223 | SharedDocumentPublicPage | **GAP** | — |
| `/shared-live-documents/:shareToken` | 224 | SharedLiveDocumentsPublicPage | **GAP** | — |
| `/sow/:shareToken` | 225 | MspSowPublicPage | **GAP** | — |
| 404 fallback | 156 | NotFound | **GAP** | — |
| (identity interstitial gate — not a route; `App.tsx` RequireAuth) | — | — | covered | `portal/identity-interstitial.json` |

**Unrouted goto targets** (resolve to no `<Route>` in `artifacts/portal/src/App.tsx` — the evidence behind the Part A retire/update calls):

- `/{{TEST_PORTAL_SLUG}}/assessment-results/copilot-readiness-assessment` — `copilot-readiness/assessment-monitoring-rescan.json` (retire)
- `/{{TEST_PORTAL_SLUG}}/m365-health` — `copilot-readiness/assessment-monitoring-rescan.json` (retire)
- `/customer-diagnostics` — `copilot-readiness/customer-diagnostics-cost-savings.json` (retire), `copilot-readiness/customer-diagnostics-engagement-offer.json` (retire)
- `/{{TEST_PORTAL_SLUG}}/login` — `copilot-readiness/live-document-pdf-export.json`
- `/{{TEST_PORTAL_SLUG}}/copilot-readiness/documents/copilot_readiness` — `copilot-readiness/live-document-pdf-export.json`
- `/shane-mccaw-consulting/m365-health` — `copilot-readiness/m365-health-breakdown-gate.json` (retire), `copilot-readiness/m365-health-pillar-live-scan.json` (retire), `portal/customer-home-landing.json` (retire)
- `/shane-mccaw-consulting/login` — `copilot-readiness/money-path-e2e.json` (retire), `copilot-readiness/money-path-login-direct.json` (retire)
- `/shane-mccaw-consulting/copilot-readiness` — `copilot-readiness/money-path-e2e.json` (retire), `copilot-readiness/money-path-login-direct.json` (retire)
- `/shane-mccaw-consulting/copilot-readiness/documents` — `copilot-readiness/money-path-e2e.json` (retire), `copilot-readiness/money-path-login-direct.json` (retire), `copilot-readiness/remediation-tracker-e2e.json` (retire)
- `/{{TEST_NEVERSCANNED_SLUG}}/copilot-readiness/documents` — `copilot-readiness/remediation-tracker-e2e.json` (retire)
- `/shane-mccaw-consulting/copilot-readiness/remediation-tracker` — `copilot-readiness/remediation-tracker-e2e.json` (retire)
- `/shane-mccaw-consulting/governance` — `governance/group-sprawl.json` (retire), `governance/ownerless-groups-sprawl.json` (retire), `governance/top-governance-risks.json` (retire)
- `/marketplace` — `marketplace/catalog-browse.json` (retire)
- `/m365-health` — `navigation/m365-health-pillar-group.json` (retire)
- `/shane-mccaw-consulting/portal-v2` — `portal/account-settings.json` (retire), `portal/shell-systems.json` (retire)
- `/shane-mccaw-consulting/portal-v2/account-security` — `portal/account-settings.json` (retire)
- `/shane-mccaw-consulting/portal-v2/webhooks` — `portal/account-settings.json` (retire)
- `/shane-mccaw-consulting/portal-v2/alert-preferences` — `portal/account-settings.json` (retire)
- `/shane-mccaw-consulting/portal-v2/receipt` — `portal/account-settings.json` (retire)
- `/shane-mccaw-consulting/portal-v2/billing` — `portal/account-settings.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/open-gaps` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/decisions` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/obligations` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/retention-coverage` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/sensitivity-labels` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/dsr` — `portal/compliance-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/compliance/disposition` — `portal/compliance-drilldowns.json` (retire)
- `/{{TEST_PORTAL_SLUG}}/portal-v2/governance` — `portal/governance-area-cards.json` (retire)
- `/shane-mccaw-consulting/portal-v2/governance/orphaned-teams` — `portal/governance-area-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/governance/device-inventory` — `portal/governance-area-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/governance/sharing-drift-legacy` — `portal/governance-area-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/security/mfa` — `portal/security-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/security/ca` — `portal/security-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/security/oauth` — `portal/security-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/security/legacy-auth` — `portal/security-drilldowns.json` (retire)
- `/shane-mccaw-consulting/portal-v2/security/email` — `portal/security-drilldowns.json` (retire)
- `/shane-mccaw-consulting/security-overview` — `security-overview/alert-volume-drilldown.json` (retire), `security-overview/hero-pillar-score.json` (retire), `security-overview/license-gap-locked-finding.json` (retire), `security-overview/top-security-risks-quick-fix-chip.json` (retire)

Notes: `/status-reports` and `/status-reports/:id` share `StatusReportsPage`; `/break-glass` and `/break-glass/:runId` share `BreakGlassStatusPage`. API-level coverage without a screen: `portal/account-security-data-rights.json` exercises the `/privacy` page's export/deletion endpoints from `/account-security`; `copilot-readiness/live-document-share-links.json` exercises the public API behind `/shared-live-documents/:shareToken`; `portal/documents.json` mints the share link behind `/shared-documents/:shareToken`.

### MSP Console — `artifacts/msp-console/src/App.tsx` (+ `src/console/nav.ts`)

Mount base `/msp-console/` (`App.tsx`), dev port 5177 (`scripts/dev-server/services.json`). `grep -rli msp-console test-manifests` → 0, so every screen below is a **GAP**. Module status says whether the screen is a real module today or the designed placeholder, so follow-up manifests can target real modules first.

| Screen | URL | Source | Module status | Status |
|---|---|---|---|---|
| Sign in | `/login` | App.tsx:29 | standalone auth page | **GAP** |
| Two-factor | `/mfa` | App.tsx:30 | standalone auth page | **GAP** |
| Forgot password | `/forgot-password` | App.tsx:31 | standalone auth page | **GAP** |
| Change MFA | `/account/mfa` | App.tsx:32 | standalone auth page | **GAP** |
| Sessions | `/account/sessions` | App.tsx:33 | standalone auth page | **GAP** |
| Tenants root (break-glass watchlist) | `/tenants` | App.tsx:36 | module (`BreakGlassWatchlist`) | **GAP** |
| Tenant node | `/tenants/:id` | App.tsx:37 | no `sel.kind === "tenant"` branch in `moduleFor` | **GAP** |
| Tenant · Overview | `/tenants/:id/overview` | nav.ts:31 | module (`ConsoleShell.tsx:263`) | **GAP** |
| Tenant · Signals | `/tenants/:id/signals` | nav.ts:34 | no `moduleFor` branch → ScreenSlot placeholder (`ConsoleShell.tsx:522`) | **GAP** |
| Tenant · Diagnostics | `/tenants/:id/diag` | nav.ts:35 | module (`ConsoleShell.tsx:273`) | **GAP** |
| Tenant · Remediation | `/tenants/:id/rem` | nav.ts:36 | module (`ConsoleShell.tsx:276`) | **GAP** |
| Tenant · CR register | `/tenants/:id/cc.register` | nav.ts:41 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · Standard Catalog | `/tenants/:id/cc.catalog` | nav.ts:42 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · CAB | `/tenants/:id/cc.cab` | nav.ts:43 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · Freeze & maintenance | `/tenants/:id/cc.calendars` | nav.ts:44 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · Dependencies | `/tenants/:id/cc.deps` | nav.ts:45 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · Executions | `/tenants/:id/cc.exec` | nav.ts:46 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · PIRs | `/tenants/:id/cc.pir` | nav.ts:47 | module (`ChangeControl`, via `CHANGE_CONTROL_TABS`) | **GAP** |
| Tenant · Risk Register | `/tenants/:id/risk` | nav.ts:52 | module (`ConsoleShell.tsx:279`) | **GAP** |
| Tenant · POA&Ms | `/tenants/:id/poams` | nav.ts:53 | module (`ConsoleShell.tsx:285`) | **GAP** |
| Tenant · Ownership | `/tenants/:id/raci` | nav.ts:54 | module (`ConsoleShell.tsx:337`) | **GAP** |
| Tenant · Runbooks | `/tenants/:id/run` | nav.ts:55 | module (`ConsoleShell.tsx:270`) | **GAP** |
| Tenant · Data rights | `/tenants/:id/dr` | nav.ts:56 | module (`ConsoleShell.tsx:308`) | **GAP** |
| Tenant · Team | `/tenants/:id/team` | nav.ts:61 | module (`ConsoleShell.tsx:320`) | **GAP** |
| Tenant · Break-glass | `/tenants/:id/bg` | nav.ts:62 | module (`ConsoleShell.tsx:324`) | **GAP** |
| Tenant · Launch Control | `/tenants/:id/lc` | nav.ts:63 | module (`ConsoleShell.tsx:298`) | **GAP** |
| Tenant · Webhooks | `/tenants/:id/wh` | nav.ts:64 | module (`ConsoleShell.tsx:305`) | **GAP** |
| Tenant · OU Assignment | `/tenants/:id/ou` | nav.ts:65 | module (`ConsoleShell.tsx:327`) | **GAP** |
| Tenant · Azure Credential | `/tenants/:id/azurecred` | nav.ts:68 | module (`ConsoleShell.tsx:330`) | **GAP** |
| Tenant · Status Reports | `/tenants/:id/status-reports` | nav.ts:73 | module (`ConsoleShell.tsx:311`) | **GAP** |
| Tenant · Offers & SOWs | `/tenants/:id/offers-sows` | nav.ts:78 | module (`ConsoleShell.tsx:314`) | **GAP** |
| Tenant · Contracts | `/tenants/:id/contracts` | nav.ts:79 | no `moduleFor` branch → ScreenSlot placeholder (`ConsoleShell.tsx:522`) | **GAP** |
| Tenant · Documents | `/tenants/:id/hub` | nav.ts:80 | module (`ConsoleShell.tsx:352`) | **GAP** |
| Tenant · Billing | `/tenants/:id/billing` | nav.ts:81 | no `moduleFor` branch → ScreenSlot placeholder (`ConsoleShell.tsx:522`) | **GAP** |
| Tenant · Marketplace | `/tenants/:id/marketplace` | nav.ts:84 | module (`ConsoleShell.tsx:358`) | **GAP** |
| Tenant · Audit log | `/tenants/:id/audit` | nav.ts:87 | module (`ConsoleShell.tsx:364`) | **GAP** |
| Ops · MSP settings | `/ops/settings` | nav.ts:100 | no `moduleFor` branch → ScreenSlot placeholder (`ConsoleShell.tsx:522`) | **GAP** |
| Ops · Executive view | `/ops/exec` | nav.ts:101 | module (`ConsoleShell.tsx:411`) | **GAP** |
| Ops · Activity timeline | `/ops/timeline` | nav.ts:102 | module (`ConsoleShell.tsx:401`) | **GAP** |
| Ops · Configuration State | `/ops/config` | nav.ts:103 | module (`ConsoleShell.tsx:394`) | **GAP** |
| Ops · Sales | `/ops/sales` | nav.ts:104 | module (`ConsoleShell.tsx:431`) | **GAP** |
| Ops · Scope & SLA | `/ops/sla` | nav.ts:105 | module (`ConsoleShell.tsx:414`) | **GAP** |
| Ops · SOPs | `/ops/sops` | nav.ts:106 | module (`ConsoleShell.tsx:388`) | **GAP** |
| Ops · Documents | `/ops/docs` | nav.ts:107 | module (`ConsoleShell.tsx:380`) | **GAP** |
| Ops · SharePoint connectors | `/ops/connectors` | nav.ts:108 | module (`ConsoleShell.tsx:384`) | **GAP** |
| Ops · Offboarding | `/ops/offboarding` | nav.ts:109 | module (`ConsoleShell.tsx:391`) | **GAP** |
| Ops · Projects | `/ops/projects` | nav.ts:116 | module (`ConsoleShell.tsx:466`) | **GAP** |
| Ops · Policy engine | `/ops/policy` | nav.ts:117 | module (`ConsoleShell.tsx:438`) | **GAP** |
| Ops · Staff Roster | `/ops/staff` | nav.ts:118 | module (`ConsoleShell.tsx:425`) | **GAP** |
| Ops · Account Security | `/ops/acctsec` | nav.ts:119 | module (`ConsoleShell.tsx:422`) | **GAP** |
| Ops · Consent & Onboarding | `/ops/consent` | nav.ts:123 | module (`ConsoleShell.tsx:441`) | **GAP** |
| Ops · Dead Letter Queue | `/ops/dlq` | nav.ts:124 | module (`ConsoleShell.tsx:428`) | **GAP** |
| Ops · Plan & billing | `/ops/plan` | nav.ts:125 | module (`ConsoleShell.tsx:444`) | **GAP** |
| Ops · Reports | `/ops/reports` | nav.ts:126 | module (`ConsoleShell.tsx:447`) | **GAP** |
| Ops · Retention Queue | `/ops/retention` | nav.ts:127 | module (`ConsoleShell.tsx:453`) | **GAP** |
| Ops · Retainer hours | `/ops/retainer` | nav.ts:131 | module (`ConsoleShell.tsx:456`) | **GAP** |
| Ops · Partner Revenue | `/ops/revenue` | nav.ts:132 | module (`ConsoleShell.tsx:463`) | **GAP** |
| Ops · Workflows | `/ops/workflows` | nav.ts:137 | `PlaceholderModule` (`ConsoleShell.tsx:473`) | **GAP** |
| Ops · Agents | `/ops/agents` | nav.ts:138 | `PlaceholderModule` (`ConsoleShell.tsx:484`) | **GAP** |
| Ops · Audit log | `/ops/audit` | nav.ts:142 | module (`ConsoleShell.tsx:495`) | **GAP** |
| 404 | any other path | App.tsx:40 | `pages/not-found.tsx` | **GAP** |

MSP Console totals: **60** screens (+404), all gapped; 6 of the 53 tree pages are placeholders today, so **47** real module pages + 5 auth pages + root are the testable gap.

## Counts at a glance

| App | Screens (route entries) | Covered | Gap |
|---|---|---|---|
| Marketing | 24 (+404) | 8 (+404 covered) | 16 |
| Portal | 50 (+404) | 36 (8 unauth-gate only; +404 gap) | 14 |
| MSP Console | 60 (+404) | 0 | 60 |

Follow-up issues are intentionally **not** filed from this report (per #4097's scope); they should be cut per BUILD_QUEUE_METHOD §3.2 from Part A/B.

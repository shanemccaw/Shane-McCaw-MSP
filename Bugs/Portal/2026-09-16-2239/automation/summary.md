# Automated QA Session Summary – Issue #4452 - Change Control add-on gate (#4452, Feature #1486) — when the calling tenant holds no active `change_control` row in tenant_add_on_entitlements, GET /api/portal/change-control answers 402 ADD_ON_REQUIRED (requireAddOnEntitlement, artifacts/api-server/src/lib/portal-addon-entitlements.ts). artifacts/portal/src/pages/change-control.tsx must render that as its own 'add-on not active' state — not the 'Couldn't load the change register' failure card, and never with the header claiming 'change control add-on active' (which it previously printed unconditionally). Companion to test-manifests/portal/change-control.json, which covers the ENTITLED path.

> **Product**: `Portal`  
> **Session ID**: `2026-09-16-2239`  
> **Date**: 2026-09-16 22:39:50 – 22:40:14  
> **Duration**: 00m 23s (23.5s)  
> **Result**: ❌ 0 STEP FAILURE(S) (0/0 passed, 100.0%)  

## Executive Summary
❌ TEST ABORTED — loginAs 'Customer — RBAC test' failed: submitted credentials for 'Customer — RBAC test' but the app never redirected away from its login page within 20000ms (current URL: http://localhost:5175/portal/login) — treating as a failed login (bad credentials or an unexpected page).

## Pages Visited
- `http://localhost:5175/portal/login`
- `http://localhost:5175/portal/change-control`

## Test Steps & Assertions
*(No steps recorded)*

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/login` |

## Screenshot & DOM Attachments
- **Screenshots (1)**:
  - `screenshots/screenshot-01.png`

## Recommendations for Claude & Engineering
Run aborted: loginAs 'Customer — RBAC test' failed: submitted credentials for 'Customer — RBAC test' but the app never redirected away from its login page within 20000ms (current URL: http://localhost:5175/portal/login) — treating as a failed login (bad credentials or an unexpected page).. Check prerequisite selectors, authentication, or network connectivity.

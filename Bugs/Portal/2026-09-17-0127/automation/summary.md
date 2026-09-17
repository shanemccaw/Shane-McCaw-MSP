# Automated QA Session Summary – Issue #4452 - Change Control add-on gate (#4452, Feature #1486) — when the calling tenant holds no active `change_control` row in tenant_add_on_entitlements, GET /api/portal/change-control answers 402 ADD_ON_REQUIRED (requireAddOnEntitlement, artifacts/api-server/src/lib/portal-addon-entitlements.ts). artifacts/portal/src/pages/change-control.tsx must render that as its own 'add-on not active' state — not the 'Couldn't load the change register' failure card, and never with the header claiming 'change control add-on active' (which it previously printed unconditionally). Companion to test-manifests/portal/change-control.json, which covers the ENTITLED path.

> **Product**: `Portal`  
> **Session ID**: `2026-09-17-0127`  
> **Date**: 2026-09-17 01:27:38 – 01:28:13  
> **Duration**: 00m 35s (35.5s)  
> **Result**: ❌ 1 STEP FAILURE(S) (1/2 passed, 50.0%)  

## Executive Summary
❌ TEST ABORTED — critical step 2 (expect [data-testid='change-control-page']) failed: [data-testid='change-control-page'] — state 'visible' NOT matched (found=False, visible=False) [polled 30000ms / 119 attempts, 30000ms budget exhausted] (1/10 steps ran, 8 skipped)

## Pages Visited
- `http://localhost:5175/portal/login`
- `http://localhost:5175/portal/change-control`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/portal/change-control` | ✅ PASS | 490ms | Navigated to http://localhost:5175/portal/change-control |
| 2 | `expect` | `[data-testid='change-control-page']` | ❌ FAIL | 30014ms | [data-testid='change-control-page'] — state 'visible' NOT matched (found=Fals... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |

## Screenshot & DOM Attachments
- **Screenshots (2)**:
  - `screenshots/screenshot-01.png`
  - `screenshots/screenshot-02.png`
- **DOM Snapshots & Diffs (2)**:
  - Step 1: `/portal/change-control` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='change-control-page']` (37 elements) &rarr; `dom/dom-step-02.json`

## Recommendations for Claude & Engineering
Run aborted: critical step 2 (expect [data-testid='change-control-page']) failed: [data-testid='change-control-page'] — state 'visible' NOT matched (found=False, visible=False) [polled 30000ms / 119 attempts, 30000ms budget exhausted]. Check prerequisite selectors, authentication, or network connectivity.

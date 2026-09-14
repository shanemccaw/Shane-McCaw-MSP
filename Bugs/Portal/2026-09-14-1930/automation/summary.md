# Automated QA Session Summary – Issue #2993 - Risk Register (#2993, Feature #1487) -- the real customer-facing Risk Register page in the rebuilt artifacts/portal (/risk-register), wired to GET /api/portal/risk-register, GET /api/portal/policy-decisions, POST /api/portal/risk-register/:rbdId/accept, and GET /api/portal/risk-register/rbd/:rbdId/versions -- see docs/portal/risk-register-contract-pack.md. No fixture module: every row on screen comes from these endpoints. #3058 wired the whole-document viewer + drawn-signature capture (GET .../versions/:versionUid/document, POST .../versions/:versionUid/sign) that this manifest's DOC steps below cover.

> **Product**: `Portal`  
> **Session ID**: `2026-09-14-1930`  
> **Date**: 2026-09-14 19:30:19 – 19:32:16  
> **Duration**: 01m 57s (117s)  
> **Result**: ❌ 3 STEP FAILURE(S) (7/10 passed, 70.0%)  

## Executive Summary
⚠ TEST INCOMPLETE (7/10 Steps)

## Pages Visited
- `http://localhost:5175/portal/team`
- `http://localhost:5175/portal/risk-register`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/portal/risk-register` | ✅ PASS | 1528ms | Navigated to http://localhost:5175/portal/risk-register |
| 2 | `expect` | `body` | ✅ PASS | 26ms | body — state 'visible' matched (found=True, visible=True); text contained "Ri... |
| 3 | `expect` | `[data-testid='risk-row-toggle-RBD-2026-104']` | ✅ PASS | 44ms | [data-testid='risk-row-toggle-RBD-2026-104'] — state 'visible' matched (found... |
| 4 | `click` | `[data-testid='risk-row-toggle-RBD-2026-104']` | ✅ PASS | 55ms | Executed click on [data-testid='risk-row-toggle-RBD-2026-104'] |
| 5 | `expect` | `body` | ✅ PASS | 20ms | body — state 'visible' matched (found=True, visible=True); text contained "WH... |
| 6 | `click` | `[data-testid='risk-row-toggle-RBD-2026-104']` | ✅ PASS | 18ms | Executed click on [data-testid='risk-row-toggle-RBD-2026-104'] |
| 7 | `expect` | `body` | ❌ FAIL | 30029ms | body — state 'visible' matched (found=True, visible=True); text contained non... |
| 8 | `expect` | `body` | ❌ FAIL | 30019ms | body — state 'visible' matched (found=True, visible=True); text contained non... |
| 9 | `expect` | `[data-testid='policy-decision-row-RBD-2026-104']` | ✅ PASS | 30ms | [data-testid='policy-decision-row-RBD-2026-104'] — state 'visible' matched (f... |
| 10 | `expect` | `body` | ❌ FAIL | 30018ms | body — state 'visible' matched (found=True, visible=True); text contained non... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |

## Screenshot & DOM Attachments
- **Screenshots (10)**:
  - `screenshots/screenshot-01.png`
  - `screenshots/screenshot-02.png`
  - `screenshots/screenshot-03.png`
  - `screenshots/screenshot-04.png`
  - `screenshots/screenshot-05.png`
  - `screenshots/screenshot-06.png`
  - `screenshots/screenshot-07.png`
  - `screenshots/screenshot-08.png`
  - `screenshots/screenshot-09.png`
  - `screenshots/screenshot-10.png`
- **DOM Snapshots & Diffs (10)**:
  - Step 1: `/portal/risk-register` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `body` (233 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='risk-row-toggle-RBD-2026-104']` (10 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='risk-row-toggle-RBD-2026-104']` (10 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `body` (301 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `[data-testid='risk-row-toggle-RBD-2026-104']` (10 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `body` (233 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `body` (233 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='policy-decision-row-RBD-2026-104']` (4 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `body` (233 elements) &rarr; `dom/dom-step-10.json`

## Recommendations for Claude & Engineering
Investigate failing step(s) and review captured screenshots and console/API logs under /Bugs/Portal/2026-09-14-1930/automation/.

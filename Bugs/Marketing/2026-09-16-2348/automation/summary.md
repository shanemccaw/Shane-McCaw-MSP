# Automated QA Session Summary – Issue #0 - Marketing Free Scan scoped Prospect account (/scan/account + the acctScreen block on /scan/remediate) — Git #4329, Feature #1352. A paid Free Scan Prospect creates a SCOPED login (emailed code -> password -> authenticator app or SMS) that opens only their own engagement: scan results, signed SOW and the Remediate step behind it. It is not a Portal login: the credential lives in free_scan_accounts (never users.password_hash / mfa_enrollments / client_services, so hasRealEntitlement() #656 stays closed) and the session is an httpOnly cookie scoped to /api/public/free-scan, signed with a derived key requireAuth cannot verify. Served by routes/public-free-scan-account.ts -> lib/free-scan-account.ts, plus the `accountSession` door on resolveActor (routes/public-free-scan-sow.ts).

> **Product**: `Marketing`  
> **Session ID**: `2026-09-16-2348`  
> **Date**: 2026-09-16 23:48:46 – 23:49:05  
> **Duration**: 00m 19s (19.5s)  
> **Result**: ✅ ALL PASSED (10/10 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (10/10 Steps)

## Pages Visited
- `http://localhost:5173/buy?product=retainer&resume=1`
- `http://localhost:5173/scan/account`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/scan/account` | ✅ PASS | 409ms | Navigated to http://localhost:5173/scan/account |
| 2 | `expect` | `[data-testid='freescan-account-signin']` | ✅ PASS | 24ms | [data-testid='freescan-account-signin'] — state 'visible' matched (found=True... |
| 3 | `expect` | `body` | ✅ PASS | 15ms | body — state 'visible' matched (found=True, visible=True); text contained "Si... |
| 4 | `expect` | `[data-testid='freescan-account-signin-email']` | ✅ PASS | 14ms | [data-testid='freescan-account-signin-email'] — state 'visible' matched (foun... |
| 5 | `expect` | `[data-testid='freescan-account-signin-password']` | ✅ PASS | 20ms | [data-testid='freescan-account-signin-password'] — state 'visible' matched (f... |
| 6 | `expect` | `[data-testid='freescan-account-engagement']` | ✅ PASS | 14ms | [data-testid='freescan-account-engagement'] — state 'absent' matched (found=F... |
| 7 | `goto` | `/scan/remediate` | ✅ PASS | 438ms | Navigated to http://localhost:5173/scan/remediate |
| 8 | `expect` | `body` | ✅ PASS | 26ms | body — state 'visible' matched (found=True, visible=True); text contained "We... |
| 9 | `expect` | `[data-testid='freescan-remediate-signin']` | ✅ PASS | 24ms | [data-testid='freescan-remediate-signin'] — state 'visible' matched (found=Tr... |
| 10 | `expect` | `[data-testid='freescan-account-setup']` | ✅ PASS | 30ms | [data-testid='freescan-account-setup'] — state 'absent' matched (found=False,... |

## Console Errors
⚠️ **1 console error(s) captured:**

- **[console.error] [auth] free-scan remediate: read failed {"err":{}}**  
  ```text
Error
    at console.error (<anonymous>:23:25)
    at emit (http://localhost:5173/src/lib/logger.ts:3:17)
    at Object.error (http://localhost:5173/src/lib/logger.ts:10:35)
    at http://localhost:5173/src/marketing/pages/FreeScanRemediate.tsx:469:13
  ```

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `GET` | `401` | 0ms | HTTP 401 | `http://localhost:5173/api/public/free-scan/account/me` |
| `GET` | `401` | 0ms | HTTP 401 | `http://localhost:5173/api/public/free-scan/account/me` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5173/api/public/free-scan/remediate/read` |

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
  - Step 1: `/scan/account` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='freescan-account-signin']` (9 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `body` (46 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='freescan-account-signin-email']` (0 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `[data-testid='freescan-account-signin-password']` (0 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `[data-testid='freescan-account-engagement']` (46 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `/scan/remediate` (0 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `body` (42 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='freescan-remediate-signin']` (0 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `[data-testid='freescan-account-setup']` (42 elements) &rarr; `dom/dom-step-10.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

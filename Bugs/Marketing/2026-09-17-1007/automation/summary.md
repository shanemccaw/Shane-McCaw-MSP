# Automated QA Session Summary – Issue #0 - Marketing Free Scan scoped Prospect account (/scan/account + the acctScreen block on /scan/remediate) — Git #4329, Feature #1352. A paid Free Scan Prospect creates a SCOPED login (emailed code -> password -> authenticator app or SMS) that opens only their own engagement: scan results, signed SOW and the Remediate step behind it. It is not a Portal login: the credential lives in free_scan_accounts (never users.password_hash / mfa_enrollments / client_services, so hasRealEntitlement() #656 stays closed) and the session is an httpOnly cookie scoped to /api/public/free-scan, signed with a derived key requireAuth cannot verify. Served by routes/public-free-scan-account.ts -> lib/free-scan-account.ts, plus the `accountSession` door on resolveActor (routes/public-free-scan-sow.ts).

> **Product**: `Marketing`  
> **Session ID**: `2026-09-17-1007`  
> **Date**: 2026-09-17 10:07:08 – 10:08:05  
> **Duration**: 00m 57s (57.3s)  
> **Result**: ✅ ALL PASSED (10/10 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (10/10 Steps)

## Pages Visited
- `http://localhost:5173/buy?product=monitoring&resume=1`
- `http://localhost:5173/scan/account`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/scan/account` | ✅ PASS | 8001ms | Navigated to http://localhost:5173/scan/account |
| 2 | `expect` | `[data-testid='freescan-account-forgot-password']` | ✅ PASS | 2747ms | [data-testid='freescan-account-forgot-password'] — state 'visible' matched (f... |
| 3 | `expect` | `[data-testid='freescan-account-lost-mfa-start']` | ✅ PASS | 434ms | [data-testid='freescan-account-lost-mfa-start'] — state 'visible' matched (fo... |
| 4 | `click` | `[data-testid='freescan-account-forgot-password']` | ✅ PASS | 338ms | Executed click on [data-testid='freescan-account-forgot-password'] |
| 5 | `expect` | `[data-testid='freescan-account-recovery']` | ✅ PASS | 29ms | [data-testid='freescan-account-recovery'] — state 'visible' matched (found=Tr... |
| 6 | `expect` | `[data-testid='freescan-account-recovery']` | ✅ PASS | 49ms | [data-testid='freescan-account-recovery'] — state 'visible' matched (found=Tr... |
| 7 | `expect` | `[data-testid='freescan-recovery-email']` | ✅ PASS | 50ms | [data-testid='freescan-recovery-email'] — state 'visible' matched (found=True... |
| 8 | `click` | `[data-testid='freescan-recovery-back']` | ✅ PASS | 52ms | Executed click on [data-testid='freescan-recovery-back'] |
| 9 | `click` | `[data-testid='freescan-account-lost-mfa-start']` | ✅ PASS | 1260ms | Executed click on [data-testid='freescan-account-lost-mfa-start'] |
| 10 | `expect` | `[data-testid='freescan-account-recovery']` | ✅ PASS | 38ms | [data-testid='freescan-account-recovery'] — state 'visible' matched (found=Tr... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
✅ **No HTTP errors or slow API calls detected.**

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
  - Step 2: `[data-testid='freescan-account-forgot-password']` (0 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='freescan-account-lost-mfa-start']` (0 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='freescan-account-forgot-password']` (45 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `[data-testid='freescan-account-recovery']` (8 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `[data-testid='freescan-account-recovery']` (8 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `[data-testid='freescan-recovery-email']` (0 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `[data-testid='freescan-recovery-back']` (49 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='freescan-account-lost-mfa-start']` (45 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `[data-testid='freescan-account-recovery']` (8 elements) &rarr; `dom/dom-step-10.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

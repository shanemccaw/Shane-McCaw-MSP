# Automated QA Session Summary – Issue #0 - Marketing Buy / Checkout page (/buy) — the one checkout for all three products. Asserts the product-specific rules that make or break the flow: monitoring gates pricing+payment behind a tenant connection, retainer offers a skippable scan and is never gated, packs are multi-select with a summed one-time total, and the terms checkbox gates the pay button without ever hiding the payment fields.

> **Product**: `Marketing`  
> **Session ID**: `2026-09-16-1240`  
> **Date**: 2026-09-16 12:40:27 – 12:43:09  
> **Duration**: 02m 42s (162.4s)  
> **Result**: ❌ 3 STEP FAILURE(S) (36/39 passed, 92.3%)  

## Executive Summary
⚠ TEST INCOMPLETE (36/39 Steps)

## Pages Visited
- `http://localhost:5173/buy?product=pack&packs=entra,mfa`
- `http://localhost:5173/buy?product=monitoring&seats=250`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/buy?product=monitoring&seats=250` | ✅ PASS | 261ms | Navigated to http://localhost:5173/buy?product=monitoring&seats=250 |
| 2 | `expect` | `[data-testid='buy-page']` | ✅ PASS | 12ms | [data-testid='buy-page'] — state 'visible' matched (found=True, visible=True) |
| 3 | `expect` | `[data-testid='buy-heading']` | ✅ PASS | 16ms | [data-testid='buy-heading'] — state 'visible' matched (found=True, visible=Tr... |
| 4 | `expect` | `[data-testid='buy-connect-grant']` | ✅ PASS | 14ms | [data-testid='buy-connect-grant'] — state 'visible' matched (found=True, visi... |
| 5 | `expect` | `[data-testid='buy-pay']` | ✅ PASS | 15ms | [data-testid='buy-pay'] — state 'visible' matched (found=True, visible=True);... |
| 6 | `expect` | `[data-testid='buy-payment-fields']` | ✅ PASS | 16ms | [data-testid='buy-payment-fields'] — state 'visible' matched (found=True, vis... |
| 7 | `goto` | `/buy?product=monitoring&scanned=1` | ✅ PASS | 279ms | Navigated to http://localhost:5173/buy?product=monitoring&scanned=1 |
| 8 | `expect` | `[data-testid='buy-connect']` | ✅ PASS | 12ms | [data-testid='buy-connect'] — state 'visible' matched (found=True, visible=True) |
| 9 | `expect` | `[data-testid='buy-connected']` | ✅ PASS | 12ms | [data-testid='buy-connected'] — state 'absent' matched (found=False, visible=... |
| 10 | `expect` | `[data-testid='buy-estimate']` | ✅ PASS | 12ms | [data-testid='buy-estimate'] — state 'visible' matched (found=True, visible=T... |
| 11 | `goto` | `/buy?product=retainer&tier=architect-essentials-retainer` | ✅ PASS | 347ms | Navigated to http://localhost:5173/buy?product=retainer&tier=architect-essent... |
| 12 | `expect` | `[data-testid='buy-heading']` | ✅ PASS | 17ms | [data-testid='buy-heading'] — state 'visible' matched (found=True, visible=Tr... |
| 13 | `expect` | `[data-testid='buy-connect-skip']` | ✅ PASS | 89ms | [data-testid='buy-connect-skip'] — state 'visible' matched (found=True, visib... |
| 14 | `expect` | `[data-testid='buy-payment-fields']` | ✅ PASS | 20ms | [data-testid='buy-payment-fields'] — state 'visible' matched (found=True, vis... |
| 15 | `expect` | `[data-testid='buy-summary-sub']` | ✅ PASS | 12ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 16 | `expect` | `[data-testid='buy-summary-total']` | ✅ PASS | 16ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |
| 17 | `click` | `[data-testid='buy-terms']` | ✅ PASS | 18ms | Executed click on [data-testid='buy-terms'] |
| 18 | `expect` | `[data-testid='buy-pay']` | ✅ PASS | 14ms | [data-testid='buy-pay'] — state 'visible' matched (found=True, visible=True);... |
| 19 | `goto` | `/buy?product=retainer&tier=architect-advisory-retainer` | ✅ PASS | 438ms | Navigated to http://localhost:5173/buy?product=retainer&tier=architect-adviso... |
| 20 | `expect` | `[data-testid='buy-summary-sub']` | ✅ PASS | 16ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 21 | `expect` | `[data-testid='buy-summary-total']` | ✅ PASS | 20ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |
| 22 | `goto` | `/buy?product=retainer&tier=architect-growth-retainer` | ✅ PASS | 315ms | Navigated to http://localhost:5173/buy?product=retainer&tier=architect-growth... |
| 23 | `expect` | `[data-testid='buy-summary-sub']` | ✅ PASS | 16ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 24 | `expect` | `[data-testid='buy-summary-total']` | ✅ PASS | 31ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |
| 25 | `goto` | `/buy?product=retainer&tier=architect-enterprise-retainer` | ✅ PASS | 213ms | Navigated to http://localhost:5173/buy?product=retainer&tier=architect-enterp... |
| 26 | `expect` | `[data-testid='buy-summary-sub']` | ✅ PASS | 12ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 27 | `expect` | `[data-testid='buy-summary-total']` | ✅ PASS | 18ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |
| 28 | `goto` | `/buy?product=pack&packs=entra,ca` | ✅ PASS | 267ms | Navigated to http://localhost:5173/buy?product=pack&packs=entra,ca |
| 29 | `expect` | `[data-testid='buy-heading']` | ✅ PASS | 12ms | [data-testid='buy-heading'] — state 'visible' matched (found=True, visible=Tr... |
| 30 | `expect` | `[data-testid='buy-connect']` | ✅ PASS | 17ms | [data-testid='buy-connect'] — state 'visible' matched (found=True, visible=True) |
| 31 | `expect` | `[data-testid='buy-summary-sub']` | ✅ PASS | 12ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 32 | `expect` | `[data-testid='buy-summary-total']` | ✅ PASS | 13ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |
| 33 | `expect` | `[data-testid='buy-payment-fields']` | ✅ PASS | 13ms | [data-testid='buy-payment-fields'] — state 'visible' matched (found=True, vis... |
| 34 | `click` | `[data-testid='buy-terms']` | ✅ PASS | 17ms | Executed click on [data-testid='buy-terms'] |
| 35 | `expect` | `[data-testid='buy-pay']` | ✅ PASS | 28ms | [data-testid='buy-pay'] — state 'visible' matched (found=True, visible=True);... |
| 36 | `goto` | `/buy?product=pack&packs=entra,mfa` | ✅ PASS | 217ms | Navigated to http://localhost:5173/buy?product=pack&packs=entra,mfa |
| 37 | `expect` | `[data-testid='buy-option-coming-soon-mfa']` | ❌ FAIL | 30083ms | [data-testid='buy-option-coming-soon-mfa'] — state 'visible' NOT matched (fou... |
| 38 | `expect` | `[data-testid='buy-summary-sub']` | ❌ FAIL | 30017ms | [data-testid='buy-summary-sub'] — state 'visible' matched (found=True, visibl... |
| 39 | `expect` | `[data-testid='buy-summary-total']` | ❌ FAIL | 30024ms | [data-testid='buy-summary-total'] — state 'visible' matched (found=True, visi... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
✅ **No HTTP errors or slow API calls detected.**

## Screenshot & DOM Attachments
- **Screenshots (39)**:
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
  - `screenshots/screenshot-11.png`
  - `screenshots/screenshot-12.png`
  - `screenshots/screenshot-13.png`
  - `screenshots/screenshot-14.png`
  - `screenshots/screenshot-15.png`
  - `screenshots/screenshot-16.png`
  - `screenshots/screenshot-17.png`
  - `screenshots/screenshot-18.png`
  - `screenshots/screenshot-19.png`
  - `screenshots/screenshot-20.png`
  - `screenshots/screenshot-21.png`
  - `screenshots/screenshot-22.png`
  - `screenshots/screenshot-23.png`
  - `screenshots/screenshot-24.png`
  - `screenshots/screenshot-25.png`
  - `screenshots/screenshot-26.png`
  - `screenshots/screenshot-27.png`
  - `screenshots/screenshot-28.png`
  - `screenshots/screenshot-29.png`
  - `screenshots/screenshot-30.png`
  - `screenshots/screenshot-31.png`
  - `screenshots/screenshot-32.png`
  - `screenshots/screenshot-33.png`
  - `screenshots/screenshot-34.png`
  - `screenshots/screenshot-35.png`
  - `screenshots/screenshot-36.png`
  - `screenshots/screenshot-37.png`
  - `screenshots/screenshot-38.png`
  - `screenshots/screenshot-39.png`
- **DOM Snapshots & Diffs (39)**:
  - Step 1: `/buy?product=monitoring&seats=250` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='buy-page']` (156 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='buy-heading']` (0 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='buy-connect-grant']` (0 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `[data-testid='buy-pay']` (0 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `[data-testid='buy-payment-fields']` (10 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `/buy?product=monitoring&scanned=1` (0 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `[data-testid='buy-connect']` (26 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='buy-connected']` (159 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `[data-testid='buy-estimate']` (9 elements) &rarr; `dom/dom-step-10.json`
  - Step 11: `/buy?product=retainer&tier=architect-essentials-retainer` (0 elements) &rarr; `dom/dom-step-11.json`
  - Step 12: `[data-testid='buy-heading']` (0 elements) &rarr; `dom/dom-step-12.json`
  - Step 13: `[data-testid='buy-connect-skip']` (0 elements) &rarr; `dom/dom-step-13.json`
  - Step 14: `[data-testid='buy-payment-fields']` (10 elements) &rarr; `dom/dom-step-14.json`
  - Step 15: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-15.json`
  - Step 16: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-16.json`
  - Step 17: `[data-testid='buy-terms']` (4 elements) &rarr; `dom/dom-step-17.json`
  - Step 18: `[data-testid='buy-pay']` (0 elements) &rarr; `dom/dom-step-18.json`
  - Step 19: `/buy?product=retainer&tier=architect-advisory-retainer` (0 elements) &rarr; `dom/dom-step-19.json`
  - Step 20: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-20.json`
  - Step 21: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-21.json`
  - Step 22: `/buy?product=retainer&tier=architect-growth-retainer` (0 elements) &rarr; `dom/dom-step-22.json`
  - Step 23: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-23.json`
  - Step 24: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-24.json`
  - Step 25: `/buy?product=retainer&tier=architect-enterprise-retainer` (0 elements) &rarr; `dom/dom-step-25.json`
  - Step 26: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-26.json`
  - Step 27: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-27.json`
  - Step 28: `/buy?product=pack&packs=entra,ca` (0 elements) &rarr; `dom/dom-step-28.json`
  - Step 29: `[data-testid='buy-heading']` (0 elements) &rarr; `dom/dom-step-29.json`
  - Step 30: `[data-testid='buy-connect']` (26 elements) &rarr; `dom/dom-step-30.json`
  - Step 31: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-31.json`
  - Step 32: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-32.json`
  - Step 33: `[data-testid='buy-payment-fields']` (10 elements) &rarr; `dom/dom-step-33.json`
  - Step 34: `[data-testid='buy-terms']` (4 elements) &rarr; `dom/dom-step-34.json`
  - Step 35: `[data-testid='buy-pay']` (0 elements) &rarr; `dom/dom-step-35.json`
  - Step 36: `/buy?product=pack&packs=entra,mfa` (0 elements) &rarr; `dom/dom-step-36.json`
  - Step 37: `[data-testid='buy-option-coming-soon-mfa']` (271 elements) &rarr; `dom/dom-step-37.json`
  - Step 38: `[data-testid='buy-summary-sub']` (0 elements) &rarr; `dom/dom-step-38.json`
  - Step 39: `[data-testid='buy-summary-total']` (0 elements) &rarr; `dom/dom-step-39.json`

## Recommendations for Claude & Engineering
Investigate failing step(s) and review captured screenshots and console/API logs under /Bugs/Marketing/2026-09-16-1240/automation/.

# Automated QA Session Summary – Issue #0 - Marketing Buy / Checkout page (/buy) — the one checkout for all three products. Asserts the product-specific rules that make or break the flow: monitoring gates pricing+payment behind a tenant connection, retainer offers a skippable scan and is never gated, packs are multi-select with a summed one-time total, and the terms checkbox gates the pay button without ever hiding the payment fields.

> **Product**: `Marketing`  
> **Session ID**: `2026-09-17-0924`  
> **Date**: 2026-09-17 09:24:35 – 09:25:03  
> **Duration**: 00m 27s (27.6s)  
> **Result**: ✅ ALL PASSED (10/10 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (10/10 Steps)

## Pages Visited
- `http://localhost:5175/portal/login`
- `http://localhost:5173/buy?product=monitoring&seats=250`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/buy?product=monitoring&seats=250` | ✅ PASS | 859ms | Navigated to http://localhost:5173/buy?product=monitoring&seats=250 |
| 2 | `expect` | `[data-testid='buy-page'][data-stage='identity']` | ✅ PASS | 20ms | [data-testid='buy-page'][data-stage='identity'] — state 'visible' matched (fo... |
| 3 | `expect` | `[data-testid='buy-steprail']` | ✅ PASS | 33ms | [data-testid='buy-steprail'] — state 'visible' matched (found=True, visible=T... |
| 4 | `expect` | `[data-testid='buy-steprail']` | ✅ PASS | 15ms | [data-testid='buy-steprail'] — state 'visible' matched (found=True, visible=T... |
| 5 | `expect` | `[data-testid='buy-steprail']` | ✅ PASS | 23ms | [data-testid='buy-steprail'] — state 'visible' matched (found=True, visible=T... |
| 6 | `expect` | `[data-testid='buy-steprail']` | ✅ PASS | 22ms | [data-testid='buy-steprail'] — state 'visible' matched (found=True, visible=T... |
| 7 | `expect` | `[data-testid='buy-tier-continue']` | ✅ PASS | 359ms | [data-testid='buy-tier-continue'] — state 'absent' matched (found=False, visi... |
| 8 | `expect` | `[data-testid='buy-tier-change']` | ✅ PASS | 15ms | [data-testid='buy-tier-change'] — state 'absent' matched (found=False, visibl... |
| 9 | `expect` | `[data-testid='buy-connect']` | ✅ PASS | 29ms | [data-testid='buy-connect'] — state 'absent' matched (found=False, visible=Fa... |
| 10 | `expect` | `[data-testid='buy-pay']` | ✅ PASS | 33ms | [data-testid='buy-pay'] — state 'absent' matched (found=False, visible=False) |

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
  - Step 1: `/buy?product=monitoring&seats=250` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='buy-page'][data-stage='identity']` (49 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='buy-steprail']` (20 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='buy-steprail']` (20 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `[data-testid='buy-steprail']` (20 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `[data-testid='buy-steprail']` (20 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `[data-testid='buy-tier-continue']` (52 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `[data-testid='buy-tier-change']` (52 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='buy-connect']` (52 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `[data-testid='buy-pay']` (52 elements) &rarr; `dom/dom-step-10.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

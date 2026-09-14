# Automated QA Session Summary – Issue #2921 - Customer Home / Overview - the real artifacts/portal '/' page (src/pages/index.tsx), wired to the two real endpoints traced in docs/portal/customer-home-and-timeline-contract-pack.md: GET /api/portal/dashboard (artifacts/api-server/src/routes/portal-customer-engines.ts, requireAuth) and GET /api/portal/customer/timeline (portal-customer-timeline.ts, requireRole Customer). Backs the page's header state banner, Needs You / Coming Up / Happened / Work In Flight / Portal Counts / Reports panels - see src/components/overview/ for the data hooks and src/pages/index.tsx's own header comment for the one deliberate design departure (no gantt/calendar strip - see that comment for why).

> **Product**: `Portal`  
> **Session ID**: `2026-09-14-1957`  
> **Date**: 2026-09-14 19:57:49 – 19:58:26  
> **Duration**: 00m 36s (36.8s)  
> **Result**: ✅ ALL PASSED (3/3 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (3/3 Steps)

## Pages Visited
- `http://localhost:5175/portal/`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/portal/` | ✅ PASS | 1230ms | Navigated to http://localhost:5175/portal/ |
| 2 | `expect` | `[data-testid='overview-notifications-chip']` | ✅ PASS | 134ms | [data-testid='overview-notifications-chip'] — state 'visible' matched (found=... |
| 3 | `expect` | `[data-testid='overview-messages-chip']` | ✅ PASS | 20ms | [data-testid='overview-messages-chip'] — state 'visible' matched (found=True,... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `GET` | `404` | 0ms | HTTP 404 | `http://localhost:5175/favicon.ico` |

## Screenshot & DOM Attachments
- **Screenshots (3)**:
  - `screenshots/screenshot-01.png`
  - `screenshots/screenshot-02.png`
  - `screenshots/screenshot-03.png`
- **DOM Snapshots & Diffs (3)**:
  - Step 1: `/portal/` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='overview-notifications-chip']` (2 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='overview-messages-chip']` (2 elements) &rarr; `dom/dom-step-03.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

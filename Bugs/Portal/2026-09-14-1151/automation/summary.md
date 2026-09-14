# Automated QA Session Summary – Issue #2921 - Customer Home / Overview - the real artifacts/portal '/' page (src/pages/index.tsx), wired to the two real endpoints traced in docs/portal/customer-home-and-timeline-contract-pack.md: GET /api/portal/dashboard (artifacts/api-server/src/routes/portal-customer-engines.ts, requireAuth) and GET /api/portal/customer/timeline (portal-customer-timeline.ts, requireRole Customer). Backs the page's header state banner, Needs You / Coming Up / Happened / Work In Flight / Portal Counts / Reports panels - see src/components/overview/ for the data hooks and src/pages/index.tsx's own header comment for the one deliberate design departure (no gantt/calendar strip - see that comment for why).

> **Product**: `Portal`  
> **Session ID**: `2026-09-14-1151`  
> **Date**: 2026-09-14 11:51:11 – 11:51:38  
> **Duration**: 00m 27s (27s)  
> **Result**: ✅ ALL PASSED (2/2 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (2/2 Steps)

## Pages Visited
- `http://localhost:5175/`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/` | ✅ PASS | 838ms | Navigated to http://localhost:5175/ |
| 2 | `expect` | `h1` | ✅ PASS | 30ms | h1 — state 'visible' matched (found=True, visible=True); text contained "Sign... |

## Console Errors
✅ **Zero console errors observed during this automated run.**

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `GET` | `404` | 0ms | HTTP 404 | `http://localhost:5175/favicon.ico` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |

## Screenshot & DOM Attachments
- **Screenshots (2)**:
  - `screenshots/screenshot-01.png`
  - `screenshots/screenshot-02.png`
- **DOM Snapshots & Diffs (2)**:
  - Step 1: `/` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `h1` (0 elements) &rarr; `dom/dom-step-02.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

# Automated QA Session Summary – Issue #1736 - Settings (#1736, Feature #1596) — the consolidated Settings container page in artifacts/portal, per the landed Shell design's own settingsGroups/stab state machine (Design/portal/design_handoff_full_site/screens/Shell.dc.html:1418-1450). Six tabs, three groups: ALERTS (Alert preferences, Notifications), YOUR TENANT (Email authentication, Webhooks, Departments), YOUR ACCOUNT (Privacy and your data). Change Control, Ownership/RACI and Account Security are deliberately NOT part of this page — the landed design keeps each on its own dedicated destination, contradicting the earlier #4057 contract-pack framing. Route: /settings. This manifest covers the new container (nav, tab switching) and the two brand-new tabs (Alert preferences, Departments); Webhooks/Notification Preferences/Email authentication/Privacy already have their own manifests covering their standalone routes and are only smoke-checked here for correctly rendering inside the container.

> **Product**: `Portal`  
> **Session ID**: `2026-09-14-1715`  
> **Date**: 2026-09-14 17:15:08 – 17:15:45  
> **Duration**: 00m 36s (36.8s)  
> **Result**: ✅ ALL PASSED (19/19 passed, 100.0%)  

## Executive Summary
✔ TEST PASSED (19/19 Steps)

## Pages Visited
- `http://localhost:5175/portal/settings`
- `http://localhost:5175/portal/login`

## Test Steps & Assertions
| Step | Action | Target / Selector | Status | Duration | Details |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `goto` | `/portal/login` | ✅ PASS | 783ms | Navigated to http://localhost:5175/portal/login |
| 2 | `expect` | `[data-testid='login-email']` | ✅ PASS | 17ms | [data-testid='login-email'] — state 'visible' matched (found=True, visible=True) |
| 3 | `input` | `[data-testid='login-email']` | ✅ PASS | 16ms | Executed input on [data-testid='login-email'] |
| 4 | `input` | `[data-testid='login-password']` | ✅ PASS | 20ms | Executed input on [data-testid='login-password'] |
| 5 | `click` | `[data-testid='login-submit']` | ✅ PASS | 29ms | Executed click on [data-testid='login-submit'] |
| 6 | `goto` | `/portal/settings` | ✅ PASS | 1262ms | Navigated to http://localhost:5175/portal/settings |
| 7 | `expect` | `[data-testid='settings-page']` | ✅ PASS | 14ms | [data-testid='settings-page'] — state 'visible' matched (found=True, visible=... |
| 8 | `expect` | `[data-testid='settings-nav-alerts']` | ✅ PASS | 10ms | [data-testid='settings-nav-alerts'] — state 'visible' matched (found=True, vi... |
| 9 | `expect` | `[data-testid='alert-preferences-content']` | ✅ PASS | 12ms | [data-testid='alert-preferences-content'] — state 'visible' matched (found=Tr... |
| 10 | `click` | `[data-testid='settings-nav-departments']` | ✅ PASS | 22ms | Executed click on [data-testid='settings-nav-departments'] |
| 11 | `expect` | `[data-testid='departments-content']` | ✅ PASS | 16ms | [data-testid='departments-content'] — state 'visible' matched (found=True, vi... |
| 12 | `click` | `[data-testid='settings-nav-webhooks']` | ✅ PASS | 34ms | Executed click on [data-testid='settings-nav-webhooks'] |
| 13 | `expect` | `[data-testid='webhooks-page']` | ✅ PASS | 32ms | [data-testid='webhooks-page'] — state 'visible' matched (found=True, visible=... |
| 14 | `click` | `[data-testid='settings-nav-notifs']` | ✅ PASS | 54ms | Executed click on [data-testid='settings-nav-notifs'] |
| 15 | `expect` | `[data-testid='notification-preferences-page']` | ✅ PASS | 21ms | [data-testid='notification-preferences-page'] — state 'visible' matched (foun... |
| 16 | `click` | `[data-testid='settings-nav-emailauth']` | ✅ PASS | 36ms | Executed click on [data-testid='settings-nav-emailauth'] |
| 17 | `expect` | `[data-testid='email-auth-setup-page']` | ✅ PASS | 18ms | [data-testid='email-auth-setup-page'] — state 'visible' matched (found=True, ... |
| 18 | `click` | `[data-testid='settings-nav-data']` | ✅ PASS | 28ms | Executed click on [data-testid='settings-nav-data'] |
| 19 | `expect` | `[data-testid='data-rights-and-privacy-page']` | ✅ PASS | 15ms | [data-testid='data-rights-and-privacy-page'] — state 'visible' matched (found... |

## Console Errors
⚠️ **1 console error(s) captured:**

- **[console.error] Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §6**  
  ```text
Error
    at console.error (<anonymous>:23:25)
    at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:5749:25
    at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:1485:72)
    at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:5748:15)
    at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:5789:114)
    at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:5995:88)
    at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:6061:35
    at reconcileChildren (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:6444:53)
    at beginWork (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:7830:104)
    at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=b88af16a:1485:72)
  ```

## API Failures & Network Performance
| Method | Status | Duration | Reason | URL |
|:---:|:---:|:---:|:---:|:---|
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |
| `POST` | `401` | 0ms | HTTP 401 | `http://localhost:5175/api/auth/refresh` |

## Screenshot & DOM Attachments
- **Screenshots (19)**:
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
- **DOM Snapshots & Diffs (19)**:
  - Step 1: `/portal/login` (0 elements) &rarr; `dom/dom-step-01.json`
  - Step 2: `[data-testid='login-email']` (0 elements) &rarr; `dom/dom-step-02.json`
  - Step 3: `[data-testid='login-email']` (0 elements) &rarr; `dom/dom-step-03.json`
  - Step 4: `[data-testid='login-password']` (0 elements) &rarr; `dom/dom-step-04.json`
  - Step 5: `[data-testid='login-submit']` (2 elements) &rarr; `dom/dom-step-05.json`
  - Step 6: `/portal/settings` (0 elements) &rarr; `dom/dom-step-06.json`
  - Step 7: `[data-testid='settings-page']` (307 elements) &rarr; `dom/dom-step-07.json`
  - Step 8: `[data-testid='settings-nav-alerts']` (5 elements) &rarr; `dom/dom-step-08.json`
  - Step 9: `[data-testid='alert-preferences-content']` (259 elements) &rarr; `dom/dom-step-09.json`
  - Step 10: `[data-testid='settings-nav-departments']` (7 elements) &rarr; `dom/dom-step-10.json`
  - Step 11: `[data-testid='departments-content']` (18 elements) &rarr; `dom/dom-step-11.json`
  - Step 12: `[data-testid='settings-nav-webhooks']` (5 elements) &rarr; `dom/dom-step-12.json`
  - Step 13: `[data-testid='webhooks-page']` (52 elements) &rarr; `dom/dom-step-13.json`
  - Step 14: `[data-testid='settings-nav-notifs']` (4 elements) &rarr; `dom/dom-step-14.json`
  - Step 15: `[data-testid='notification-preferences-page']` (207 elements) &rarr; `dom/dom-step-15.json`
  - Step 16: `[data-testid='settings-nav-emailauth']` (4 elements) &rarr; `dom/dom-step-16.json`
  - Step 17: `[data-testid='email-auth-setup-page']` (98 elements) &rarr; `dom/dom-step-17.json`
  - Step 18: `[data-testid='settings-nav-data']` (5 elements) &rarr; `dom/dom-step-18.json`
  - Step 19: `[data-testid='data-rights-and-privacy-page']` (99 elements) &rarr; `dom/dom-step-19.json`

## Recommendations for Claude & Engineering
All automated UI steps passed. Review baseline screenshots for visual drift.

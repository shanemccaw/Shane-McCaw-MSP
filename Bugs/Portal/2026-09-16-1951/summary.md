# QA Session Summary – Portal

> **Session ID**: `2026-09-16-1951`  
> **Date**: 2026-09-16 19:51:44 – 21:28:35  
> **Duration**: 36m 51s (5812 seconds)  
> **Overall Assessment**: ⚠️ 2 Issues Requiring Attention  

## Executive Summary
Tested page account-security. Found 2 issues.

## Pages & Endpoints Tested
- `http://localhost:5175/portal/account-security`

## Bugs & Issues Logged (2)
| # | Severity | Status | Title / Description | Steps | Shots |
|---|---|---|---|---|---|
| 1 | **Bug** | Open | If there are no retainers for this custome... | No | 1 |
| 2 | **Bug** | Open | This is all hard coded and not pulling fro... | No | 1 |

### [BUG] If there are no retainers for this customer, why is it showing Retained 8h? Reamining 8h ...
- **URL**: `http://localhost:5175/portal/account-security`

**Notes**:
If there are no retainers for this customer, why is it showing Retained 8h? Reamining 8h ...

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\my-architect\2026-09-16_21-26-39-206.png)

### [BUG] This is all hard coded and not pulling from a real source at all... This needs a new wire pass.
- **URL**: `http://localhost:5175/portal/account-security`

**Notes**:
This is all hard coded and not pulling from a real source at all... This needs a new wire pass.

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\remediation-tracking\2026-09-16_21-25-05-286.png)

## Console & Script Diagnostics
- **Errors**: 24
- **Warnings**: 2
- **Total Console Logs**: 98

### Key Errors Captured:
- `[21:23:30.994]` Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
  ```text
  TypeError: parameter 1 is not of type 'Node'.
      at <anonymous>:16:18
      at <anonymous>:21:3
  ```
- `[21:23:30.995]` Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
  ```text
  TypeError: parameter 1 is not of type 'Node'.
      at <anonymous>:16:18
      at <anonymous>:21:3
  ```
- `[21:24:13.344]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §2
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5789:114)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:24:16.303]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §2
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5773:25)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:27:03.924]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §1.6
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5789:114)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:27:03.969]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §1.6
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5773:25)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:27:03.975]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §1.6
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5773:25)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:28:25.923]` Encountered two children with the same key, `%s`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version. §6
  ```text
      at http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5749:25
      at runWithFiberInDEV (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:1485:72)
      at warnOnInvalidKey (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5748:15)
      at reconcileChildrenArray (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5789:114)
      at reconcileChildFibersImpl (http://localhost:5175/portal/node_modules/.vite/deps/react-dom_client.js?v=2c638c6e:5995:88)
  ```
- `[21:20:42.312]` %s a style property during rerender (%s) when a conflicting property is set (%s) can lead to styling bugs. To avoid this, don't mix shorthand and non-shorthand properties for the same value; instead, replace the shorthand with separate values. Removing borderColor border
- `[21:20:42.313]` %s a style property during rerender (%s) when a conflicting property is set (%s) can lead to styling bugs. To avoid this, don't mix shorthand and non-shorthand properties for the same value; instead, replace the shorthand with separate values. Removing borderColor border
  ```text
   (:83:31)
  setValueForStyles (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:2265:24)
  setProp (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:12307:12)
  updateProperties (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:12966:44)
  commitUpdate (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:13955:8)
  runWithFiberInDEV (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:1484:71)
  commitHostUpdate (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:8729:10)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9512:96)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9373:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9654:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9501:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9501:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9501:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9373:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9654:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9373:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9373:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9373:12)
  recursivelyTraverseMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9364:12)
  commitMutationEffectsOnFiber (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:9550:12)
  flushMutationEffects (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11097:14)
  commitRoot (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11078:10)
  commitRootWhenReady (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:10511:8)
  performWorkOnRoot (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:10456:16)
  performSyncWorkOnRoot (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11634:8)
  flushSyncWorkAcrossRoots_impl (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11535:121)
  processRootScheduleInMicrotask (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11557:8)
   (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=c31b848e:11648:14)
  ```
- ...and 14 more errors (see `console/console.json`).

## Network & API Activity
- **API Calls Executed (Runner)**: 0
- **Network Failures Captured**: 6

### Network Failures / Drops:
- `GET` `/api/portal/change-control` &rarr; **402 Payment Required** (22 ms)
- `GET` `/api/portal/change-control` &rarr; **402 Payment Required** (33 ms)
- `GET` `http://localhost:5175/api/portal/offers/sse?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDM2NiwiZW1haWwiOiJzaGFuZW1jY2F3K3ByZW1pZXJAb3V0bG9vay5jb20iLCJuYW1lIjoiU2hhbmUgTWNDYXciLCJjb21wYW55IjoiTWNDYXdTb2Z0Iiwicm9sZSI6ImNsaWVudCIsIm1zcFJvbGUiOiJDdXN0b21lciIsIm1zcElkIjoxLCJjdXN0b21lcklkIjoyMDgwLCJtc3BTbHVnIjoic2hhbmUtbWNjYXctY29uc3VsdGluZyIsImlhdCI6MTc4OTYwODIxMSwiZXhwIjoxNzg5NjA5MTExfQ.CvTjZok9O69nWKPwCL4rWHPpd9NvCylBWrdf_HpmDmU` &rarr; **0 Canceled** (1578 ms)
- `GET` `http://localhost:5175/api/portal/offers/sse?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDM2NiwiZW1haWwiOiJzaGFuZW1jY2F3K3ByZW1pZXJAb3V0bG9vay5jb20iLCJuYW1lIjoiU2hhbmUgTWNDYXciLCJjb21wYW55IjoiTWNDYXdTb2Z0Iiwicm9sZSI6ImNsaWVudCIsIm1zcFJvbGUiOiJDdXN0b21lciIsIm1zcElkIjoxLCJjdXN0b21lcklkIjoyMDgwLCJtc3BTbHVnIjoic2hhbmUtbWNjYXctY29uc3VsdGluZyIsImlhdCI6MTc4OTYwODIxMSwiZXhwIjoxNzg5NjA5MTExfQ.CvTjZok9O69nWKPwCL4rWHPpd9NvCylBWrdf_HpmDmU` &rarr; **0 Canceled** (1803 ms)
- `GET` `http://localhost:5175/api/portal/change-control` &rarr; **402 Payment Required** (22 ms)
- `GET` `http://localhost:5175/api/portal/change-control` &rarr; **402 Payment Required** (33 ms)

## JavaScript Commands Executed
- None.

## Screenshots Captured (0)
- No screenshots attached.

## Recommendations for Claude
1. Review each reported bug above, cross-referencing reproduction steps and console logs.
2. Inspect `report.json` for structured telemetry, stack traces, and viewport details.
3. Address high-severity bugs first before running regression verification.

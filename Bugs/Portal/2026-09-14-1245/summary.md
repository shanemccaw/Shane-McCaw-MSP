# QA Session Summary – Portal

> **Session ID**: `2026-09-14-1245`  
> **Date**: 2026-09-14 12:45:41 – 13:02:46  
> **Duration**: 17m 04s (1024 seconds)  
> **Overall Assessment**: ⚠️ 1 Issues Requiring Attention  

## Executive Summary
Tested page /. Found 1 issue.

## Pages & Endpoints Tested
- `http://localhost:5175/portal/`

## Bugs & Issues Logged (1)
| # | Severity | Status | Title / Description | Steps | Shots |
|---|---|---|---|---|---|
| 1 | **Blocker** | Open | Portal -> Login as a Customer account and ... | No | 1 |

### [BLOCKER] Portal -> Login as a Customer account and I am told I need to logout and login to the Admin Panel.
- **URL**: `http://localhost:5175/portal/`

**Notes**:
Portal -> Login as a Customer account and I am told I need to logout and login to the Admin Panel.

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\_\2026-09-14_13-00-37-161.png)

## Console & Script Diagnostics
- **Errors**: 5
- **Warnings**: 2
- **Total Console Logs**: 14

### Key Errors Captured:
- `[13:01:08.715]` Uncaught TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
  ```text
  TypeError: parameter 1 is not of type 'Node'.
      at <anonymous>:16:18
      at <anonymous>:21:3
  ```
- `[13:00:59.641]` TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
    at <anonymous>:16:18
    at <anonymous>:21:3
  ```text
   (:15:17)
   (:20:2)
  ```
- `[13:00:59.642]` TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
    at <anonymous>:16:18
    at <anonymous>:21:3
  ```text
   (:15:17)
   (:20:2)
  ```
- `[13:01:08.721]` TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
    at <anonymous>:16:18
    at <anonymous>:21:3
  ```text
   (:15:17)
   (:20:2)
  ```
- `[13:01:08.721]` TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
    at <anonymous>:16:18
    at <anonymous>:21:3
  ```text
   (:15:17)
   (:20:2)
  ```

## Network & API Activity
- **API Calls Executed (Runner)**: 0
- **Network Failures Captured**: 11

### Network Failures / Drops:
- `POST` `/api/auth/refresh` &rarr; **401 Unauthorized** (30 ms)
- `GET` `/api/portal/theme-preference` &rarr; **403 Forbidden** (63 ms)
- `POST` `/api/client-events` &rarr; **403 Forbidden** (322 ms)
- `POST` `http://localhost:5175/api/auth/refresh` &rarr; **401 Unauthorized** (28 ms)
- `GET` `http://localhost:5174/api/admin/analytics/live` &rarr; **503 Service Unavailable** (320 ms)
- `GET` `http://localhost:5174/api/admin/emails/unread-count` &rarr; **401 Unauthorized** (315 ms)
- `GET` `http://localhost:5174/api/admin/analytics/live` &rarr; **503 Service Unavailable** (320 ms)
- `GET` `http://localhost:5174/api/admin/analytics/live` &rarr; **503 Service Unavailable** (321 ms)
- `GET` `http://localhost:5174/api/admin/emails/unread-count` &rarr; **401 Unauthorized** (316 ms)
- `GET` `http://localhost:5175/api/portal/theme-preference` &rarr; **403 Forbidden** (63 ms)

## JavaScript Commands Executed
- None.

## Screenshots Captured (0)
- No screenshots attached.

## Recommendations for Claude
1. Review each reported bug above, cross-referencing reproduction steps and console logs.
2. Inspect `report.json` for structured telemetry, stack traces, and viewport details.
3. Address high-severity bugs first before running regression verification.

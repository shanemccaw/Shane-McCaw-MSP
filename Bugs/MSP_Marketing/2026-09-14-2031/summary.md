# QA Session Summary – Website

> **Session ID**: `2026-09-14-2031`  
> **Date**: 2026-09-14 20:31:14 – 20:31:40  
> **Duration**: 00m 25s (26 seconds)  
> **Overall Assessment**: ⚠️ 3 Issues Requiring Attention  

## Executive Summary
Tested page scan. Found 3 issues.

## Pages & Endpoints Tested
- `http://localhost:5173/scan`

## Bugs & Issues Logged (3)
| # | Severity | Status | Title / Description | Steps | Shots |
|---|---|---|---|---|---|
| 1 | **Bug** | Open | I do not think this is accurate | Yes | 1 |
| 2 | **Bug** | Open | I do not think this is accurate | Yes | 1 |
| 3 | **Bug** | Open | ![screenshot](C:\Users\Ronnie\AppData\Roam... | No | 2 |

### [BUG] I do not think this is accurate
- **URL**: `http://localhost:5173/scan`
- **Tags**: `dom-inspector`, `div`

**Notes**:
I do not think this is accurate

**Steps to Reproduce**:
1. Locate and inspect `[data-testid="freescan-consent-screen"] > div:nth-of-type(3)`

**Expected vs Actual**:
- **Actual**: Selector: [data-testid="freescan-consent-screen"] > div:nth-of-type(3)
Tag: <div>
Dimensions: 656×170 px
Text: "NOT REQUESTED, AND NOT GRANTABLE HERE
×
Mail.Read — no mailbox, message or attachment is ever read
×
Files.Read — fil..."

### [BUG] I do not think this is accurate
- **URL**: `http://localhost:5173/scan`
- **Tags**: `dom-inspector`, `div`

**Notes**:
I do not think this is accurate

**Steps to Reproduce**:
1. Locate and inspect `[data-testid="freescan-consent-screen"] > div:nth-of-type(2)`

**Expected vs Actual**:
- **Actual**: Selector: [data-testid="freescan-consent-screen"] > div:nth-of-type(2)
Tag: <div>
Dimensions: 656×377 px
Text: "THE READ APP REGISTRATION ASKS FOR
Organization.Read.All
Tenant profile, verified domains and the licence counts your..."

### [BUG] ![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5173\scan\2026-09-14_20-31-25-451.png)
- **URL**: `http://localhost:5173/scan`

**Notes**:
![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5173\scan\2026-09-14_20-31-25-451.png)

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5173\scan\2026-09-14_20-31-33-578.png)

## Console & Script Diagnostics
- **Errors**: 0
- **Warnings**: 0
- **Total Console Logs**: 104

## Network & API Activity
- **API Calls Executed (Runner)**: 0
- **Network Failures Captured**: 0

## JavaScript Commands Executed
- None.

## Screenshots Captured (2)
- [2026-09-14_20-31-25-451.png](screenshots/2026-09-14_20-31-25-451.png)
- [2026-09-14_20-31-33-578.png](screenshots/2026-09-14_20-31-33-578.png)

## Notes & Observations
### Active Page Notes
![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5173\scan\2026-09-14_20-31-25-451.png)

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5173\scan\2026-09-14_20-31-33-578.png)

## Recommendations for Claude
1. Review each reported bug above, cross-referencing reproduction steps and console logs.
2. Inspect `report.json` for structured telemetry, stack traces, and viewport details.
3. Address high-severity bugs first before running regression verification.

# QA Session Summary – Portal

> **Session ID**: `2026-09-17-1236`  
> **Date**: 2026-09-17 12:36:10 – 15:14:07  
> **Duration**: 37m 56s (9477 seconds)  
> **Overall Assessment**: ⚠️ 5 Issues Requiring Attention  

## Executive Summary
Tested page pillars/governance. Found 5 issues.

## Pages & Endpoints Tested
- `http://localhost:5175/portal/pillars/governance`

## Bugs & Issues Logged (5)
| # | Severity | Status | Title / Description | Steps | Shots |
|---|---|---|---|---|---|
| 1 | **Bug** | Open | Scan ran - things are scored... but Govern... | No | 0 |
| 2 | **Bug** | Open | ![screenshot](C:\Users\Ronnie\AppData\Roam... | No | 2 |
| 3 | **Bug** | Open | It says never scanned... but it's been sca... | Yes | 1 |
| 4 | **Bug** | Open | This talks too much for a customer view | Yes | 1 |
| 5 | **Bug** | Open | ![screenshot](C:\Users\Ronnie\AppData\Roam... | No | 1 |

### [BUG] Scan ran - things are scored... but Governance doesnt show any of its findings boxes
- **URL**: `http://localhost:5175/portal/pillars/governance`

**Notes**:
Scan ran - things are scored... but Governance doesnt show any of its findings boxes

### [BUG] ![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\_\2026-09-17_15-10-41-458.png)
- **URL**: `http://localhost:5175/portal/pillars/governance`

**Notes**:
![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\_\2026-09-17_15-10-41-458.png)

![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\_\2026-09-17_15-10-58-723.png)

### [BUG] It says never scanned... but it's been scanned
- **URL**: `http://localhost:5175/portal/pillars/governance`
- **Tags**: `dom-inspector`, `div`

**Notes**:
It says never scanned... but it's been scanned

**Steps to Reproduce**:
1. Locate and inspect `div.relative.flex:nth-of-type(2) > div.flex.min-w-0 > div.flex.flex-wrap:nth-of-type(1) > div.flex.items-center:nth-of-type(1)`

**Expected vs Actual**:
- **Actual**: Selector: div.relative.flex:nth-of-type(2) > div.flex.min-w-0 > div.flex.flex-wrap:nth-of-type(1) > div.flex.items-center:nth-of-type(1)
Tag: <div>
Dimensions: 134×25 px
Classes: flex items-center gap-[7px] rounded-full px-[11px] py-1
Text: "NEVER SCANNED"

### [BUG] This talks too much for a customer view
- **URL**: `http://localhost:5175/portal/pillars/governance`
- **Tags**: `dom-inspector`, `div`

**Notes**:
This talks too much for a customer view

**Steps to Reproduce**:
1. Locate and inspect `div.mt-auto:nth-of-type(2) > div.rounded-\[14px\].border > div.mt-\[9px\].border-t:nth-of-type(4) > div.pt-\[3px\].text-\[11px\]:nth-of-type(2)`

**Expected vs Actual**:
- **Actual**: Selector: div.mt-auto:nth-of-type(2) > div.rounded-\[14px\].border > div.mt-\[9px\].border-t:nth-of-type(4) > div.pt-\[3px\].text-\[11px\]:nth-of-type(2)
Tag: <div>
Dimensions: 181×69 px
Classes: pt-[3px] text-[11px]
Text: "Showing its stored summary: 198 checks · 166 passed · 2 errored · 19 license gaps. The live log for it is gone."

### [BUG] ![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\pillars_governance\2026-09-17_15-14-00-376.png)
- **URL**: `http://localhost:5175/portal/pillars/governance`

**Notes**:
![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\pillars_governance\2026-09-17_15-14-00-376.png)

## Console & Script Diagnostics
- **Errors**: 0
- **Warnings**: 0
- **Total Console Logs**: 0

## Network & API Activity
- **API Calls Executed (Runner)**: 0
- **Network Failures Captured**: 0

## JavaScript Commands Executed
- None.

## Screenshots Captured (1)
- [2026-09-17_15-14-00-376.png](screenshots/2026-09-17_15-14-00-376.png)

## Notes & Observations
### Active Page Notes
![screenshot](C:\Users\Ronnie\AppData\Roaming\BuildConsole\visual-test-screenshots\localhost_5175_portal\pillars_governance\2026-09-17_15-14-00-376.png)

## Recommendations for Claude
1. Review each reported bug above, cross-referencing reproduction steps and console logs.
2. Inspect `report.json` for structured telemetry, stack traces, and viewport details.
3. Address high-severity bugs first before running regression verification.

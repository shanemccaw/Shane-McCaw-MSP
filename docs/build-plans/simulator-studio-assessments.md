# Initiative: Simulator Studio — Assessments Node

**Slug:** simulator-studio-assessments
**Status:** Not Started
**Iteration:** 1
**Area:** admin-panel
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-27

## Goal
Add a new "Assessments" node to Simulator Studio's left tree (alongside the
10 existing sections — M365 Endpoints, Signal Rules, SQL Query, etc.) giving
Shane an admin-direct way to execute any of the 21 real `services` (category
= `assessment`) against a testbed tenant, watch live progress, and see
per-check results — closing the current gap where the only execution path
(`POST /portal/assessment/debug-trigger-scan`) is buried behind customer-portal
login and has no PlatformAdmin entry point at all.

## Scope
- New Section 11 in `SimulatorLeftTree.tsx`: live list of the 21 assessment
  `services` rows, grouped Free/Paid, each showing its resolved `packageKey`
  and flagging any still on the `core:security-baseline` fallback (6 of 21
  got dedicated packages as of 2026-07-27; the rest are unverified).
- New center canvas: testbed-customer picker, Run button that calls
  `runDiagnostics()` directly (same function `debug-trigger-scan` and
  production both use) without requiring portal/customer login.
- Live progress via the same SSE mechanism other Simulator sections use.
- Results view: per-check findings table (from `msp_diagnostic_findings`) +
  run summary (from `msp_diagnostic_runs`: checksTotal/Ok/Error/LicenseGap).
- Run history + diff, reusing the existing `SimulatorRunHistory.tsx` pattern.

## Dependencies / Prerequisites
- None blocking. Reuses existing `runDiagnostics()`, `msp_diagnostic_runs`,
  `msp_diagnostic_findings`, and the Simulator Studio IDE shell as-is.
- Loosely related to (not blocking, not blocked by): the separate Admin
  Panel task to expose `packageKey` as an editable dropdown in the
  Assessment product editor (authoring side; this initiative is the
  testing/execution side).

## Phases
| Phase | Title                                        | Status      | Issue |
|-------|-----------------------------------------------|-------------|-------|
| 1     | Assessment catalog tree + packageKey audit     | Not Started | #TBD  |
| 2     | Admin-direct execution wiring                  | Not Started | #TBD  |
| 3     | Results & findings display                    | Not Started | #TBD  |
| 4     | Run history & diff                             | Not Started | #TBD  |

## Notes
Phase count/order may change (decimal insertion, e.g. 2.5) if a phase splits
mid-build — never renumbering existing phases. This file is the source of
truth; GitHub Issues are a derived view corrected to match it if they ever
disagree.

Logging channel: `engine.monitor` (matches existing `monitor-executor.ts`
and `simulator-run-store.ts` — no new leaf channel needed).
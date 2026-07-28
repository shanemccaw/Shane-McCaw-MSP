<<<<<<< HEAD
# Initiative: Simulator Studio Assessments

**Slug:** simulator-studio-assessments
**Status:** In Progress
=======
# Initiative: Simulator Studio — Assessments Node

**Slug:** simulator-studio-assessments
**Status:** Not Started
>>>>>>> 144adb52c0ae97ea897e012b0e0ed3142fc539b0
**Iteration:** 1
**Area:** admin-panel
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-27

## Goal
<<<<<<< HEAD
Bring the platform's 21 real `services` rows with `category = 'assessment'` into
Simulator Studio as a first-class explorer node, so an operator can see â€” for
every assessment product â€” which `monitoring_package_checks` scan it actually
runs (its dedicated package, or the `core:security-baseline` fallback) without
reading SQL. Later phases add the ability to execute assessments directly,
view their results/history, and manage the assessment catalog itself
(create/edit/delete) from within the Simulator.

## Scope
- New read-only backend route returning the assessment catalog + resolved
  packageKey + package check list.
- New Section 11 "Assessments" in `SimulatorLeftTree.tsx`, grouped Free/Paid.
- New `SimulatorAssessmentCanvas.tsx` mirroring `SimulatorEndpointCanvas.tsx`'s
  shell for the center-canvas detail view.
- Explicitly OUT of scope for Phase 1: create/edit/delete of assessment
  packageKey assignments or monitoring packages themselves (later phases).

## Dependencies / Prerequisites
None â€” `monitor_checks` / `monitoring_packages` / `monitoring_package_checks`
and the `services.type_attributes->>'packageKey'` resolution path already
exist and are live (see `consent.ts`).

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | Assessment catalog tree + packageKey audit | Done | #23 |
| 2 | Admin-direct execution wiring | Not Started | #24 |
| 3 | Results & findings display | Not Started | #25 |
| 4 | Run history & diff | Not Started | #26 |
| 5 | Assessment Creation Wizard | Not Started | #28 |
| 6 | Assessment Edit Wizard | Not Started | #29 |
| 7 | Delete / Deprecate | Not Started | #30 |

## Notes
Phase count/order may change (decimal insertion, e.g. 2.5, if a phase
splits mid-build). This table is the index only â€” full spec per phase
lives in that phase's GitHub issue. This file is the source of truth;
the GitHub Issue/Project card is a derived view. If they ever disagree,
this file wins and the Issue gets corrected to match it.

Phases 5â€“7 (#28, #29, #30) are placeholders only â€” their real scope will be
filled in on each phase's issue once the phase it depends on is Done and
it's actually planned in detail. Dependency chain: Phase 5 (#28) depends on
Phase 1 (#23) being Done; Phase 6 (#29) and Phase 7 (#30) each depend on
Phase 5 (#28) being Done (an edit/delete wizard needs the create wizard's
form + validation scaffolding in place first).
=======
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
| 1     | Assessment catalog tree + packageKey audit     | Not Started | #23 |
| 2     | Admin-direct execution wiring                  | Not Started | #24 |
| 3     | Results & findings display                    | Not Started | #25 |
| 4     | Run history & diff                             | Not Started | #26 |

## Notes
Phase count/order may change (decimal insertion, e.g. 2.5) if a phase splits
mid-build — never renumbering existing phases. This file is the source of
truth; GitHub Issues are a derived view corrected to match it if they ever
disagree.

Logging channel: `engine.monitor` (matches existing `monitor-executor.ts`
and `simulator-run-store.ts` — no new leaf channel needed).
>>>>>>> 144adb52c0ae97ea897e012b0e0ed3142fc539b0

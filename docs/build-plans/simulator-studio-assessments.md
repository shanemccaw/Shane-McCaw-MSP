# Initiative: Simulator Studio Assessments

**Slug:** simulator-studio-assessments
**Status:** In Progress
**Iteration:** 1
**Area:** admin-panel
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-27

## Goal
Bring the platform's 21 real `services` rows with `category = 'assessment'` into
Simulator Studio as a first-class explorer node, so an operator can see — for
every assessment product — which `monitoring_package_checks` scan it actually
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
None — `monitor_checks` / `monitoring_packages` / `monitoring_package_checks`
and the `services.type_attributes->>'packageKey'` resolution path already
exist and are live (see `consent.ts`).

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | Assessment catalog tree + packageKey audit | Done | #23 |
| 2 | Admin-direct execution wiring | Done | #24 |
| 3 | Results & findings display | Done | #25 |
| 4 | Run history & diff | Not Started | #26 |
| 5 | Assessment Creation Wizard | Not Started | #28 |
| 6 | Assessment Edit Wizard | Not Started | #29 |
| 7 | Delete / Deprecate | Not Started | #30 |

## Notes
Phase count/order may change (decimal insertion, e.g. 2.5, if a phase
splits mid-build). This table is the index only — full spec per phase
lives in that phase's GitHub issue. This file is the source of truth;
the GitHub Issue/Project card is a derived view. If they ever disagree,
this file wins and the Issue gets corrected to match it.

Phases 5–7 (#28, #29, #30) are placeholders only — their real scope will be
filled in on each phase's issue once the phase it depends on is Done and
it's actually planned in detail. Dependency chain: Phase 5 (#28) depends on
Phase 1 (#23) being Done; Phase 6 (#29) and Phase 7 (#30) each depend on
Phase 5 (#28) being Done (an edit/delete wizard needs the create wizard's
form + validation scaffolding in place first).

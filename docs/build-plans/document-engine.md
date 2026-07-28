# Initiative: Document Engine

**Slug:** document-engine
**Status:** In Progress
**Iteration:** 1
**Area:** document-generator
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-27

## Goal
Replace the hardcoded, unscoped document-generation system (every document
type fed the AI an identical, unfiltered dump of the full M365 tenant
profile, with document types themselves hardcoded as TypeScript constants)
with a real, admin-authorable engine: per-document-type declarative scoping
(`document_types.includedProfileKeyPatterns`/`includedSignalCategories`),
real white-label branding, Sales Offer Engine as sole authority on SOW
project/pricing scope (never the legacy `engagement_projects`/`triggeredBy`
catalog), and telemetry-based OMG cards computed at generation time (never
re-extracted from rendered HTML afterward).

## Scope
- `document_types` table: scoping fields, `pipelineCategory`
  (standalone/pipeline_output), structured `sections`.
- `document-engine.ts`: standalone document generation, real scoping,
  placeholder-first generation UX, dry-run preview mode.
- `document-engine-sow.ts`: SOW generation, Sales Offer Engine authority,
  real pricing lines, workstream selection, archive-mode versioning,
  dry-run preview mode.
- `omg-card-generator-v2.ts`: telemetry-based OMG cards, no HTML extraction.
- Document Types IDE (`DocumentTypesManager.tsx`): list, editor, sections
  builder, scoping builder, AI-prompt-link editing. Preview still pending.
- Cutover: `workflow-executor.ts`'s `generate_document` node routes to the
  real engine instead of the old inline/legacy-function logic.
- Retirement of the old generation path once no real callers remain.

## Dependencies / Prerequisites
None — built on top of Sales Offer Engine, Signal Policy Engine, and the
`ai_prompts` system, all of which already existed or were built earlier in
this same session.

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | `document_types` scoping + `pipelineCategory` + structured `sections` columns | Done | #TBD |
| 2 | `admin-document-types.ts` route extended for new fields | Done | #TBD |
| 3 | Document Types IDE — list view + basic editor | Done | #TBD |
| 4 | Document Types IDE — structured sections editor | Done | #TBD |
| 5 | Document Types IDE — scoping builder (profile patterns + signal categories) | Done | #TBD |
| 6 | Document Types IDE — AI prompt link editing (reused existing prompt editor) | Done | #TBD |
| 7 | `document-engine.ts` — standalone generation core, real per-type scoping | Done | #TBD |
| 8 | `omg-card-generator-v2.ts` — telemetry-based OMG cards | Done | #TBD |
| 9 | `document-engine-sow.ts` — SOW generation core, Sales Offer Engine authority, real pricing lines | Done | #TBD |
| 10 | Wire OMG card generation into both engine functions (fire-and-forget) | Done | #TBD |
| 11 | Placeholder-first generation UX (both engines) — real "generating" state, not insert-after-completion | Done | #TBD |
| 12 | Workflow builder — real, live document type list (replaced hardcoded hint strings) | Done | #TBD |
| 13 | Cutover — `workflow-executor.ts`'s `generate_document` node routes to real engine, `"consolidated_sow"` aliased to real `"sow"` key, `task_execution_guide` kept on old inline logic as deliberate exception | Done | #TBD |
| 14 | Dry-run preview mode — both engine functions, TypeScript overload pattern | Done | #TBD |
| 15 | Workstream selection + archive-mode supersede, moved into `generateSowDocument()` itself (not caller-side) | Done | #TBD |
| 16 | Remove now-duplicate prior-doc cleanup from workflow cutover wrapper | Done | #TBD |
| 17 | Port `portal-assessment.ts`'s direct SOW-regeneration call site to the new engine | Done | #32 |
| 18 | Document Types IDE — preview (dry-run payload shown to admin before real generation) | Done | #33 |
| 19 | Retire old generation path (`generateAndDeliverDocument`, `generateConsolidatedSowDocument`, `extractAndStoreOmgCards`, extraction-based `sowPricingLines`) — blocked on Phase 17 | Not Started | #34 |

## Notes
Phase 17 is a real, load-bearing gap, not cleanup: `portal-assessment.ts`'s
`/portal/assessment/sow/select` route lets a customer choose which specific
workstreams to include in their SOW and regenerate it scoped to that
selection, using `supersedeMode: "archive"` so prior scope selections aren't
lost. This currently still calls the legacy `generateConsolidatedSowDocument`
directly — Phase 19's retirement is blocked until this is ported.

`extractAndStoreOmgCards` also still has one real caller in
`portal-assessment.ts` as a lazy-extraction fallback for the race condition
where a customer views a document before the new engine's fire-and-forget
OMG card generation has finished. Confirm whether this fallback should be
kept (harmless, rare) or removed once Phase 17 lands, since removing it
entirely would mean a genuinely blank OMG-cards state during that race
window instead of a fallback extraction.

Phase count/order may change (decimal insertion) if a phase splits
mid-build. This table is the index only — full spec per phase lives in
that phase's GitHub issue. This file is the source of truth; the GitHub
Issue/Project card is a derived view.

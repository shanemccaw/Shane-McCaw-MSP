# Initiative: Document Generator IDE

**Slug:** document-generator-ide
**Status:** In Progress
**Iteration:** 1
**Area:** admin-panel
**Owner:** Shane McCaw Consulting
**Created:** 2026-07-27

## Goal
Give the admin a real, primary-nav page for driving the Document Engine
(`document-engine.ts` / `document-engine-sow.ts` against the `document_types`
table) directly — list active document types, generate a real document for a
chosen client/project with one click, preview a dry run first, and see recent
generation history. This is a fresh admin surface built only against the real
engine, with zero dependency on the legacy `admin-insights.ts` /
`InsightsOutputs.tsx` / `InsightsPayloadDialog.tsx` inline-generation path,
which this initiative also formally retires (nav removed, files marked dead)
once the new page covers the same ground.

## Scope
- New backend route file, e.g. `admin-document-generator.ts`
  (`logger.child({ channel: "engine.document-generator" })`):
  - `GET` list of active `document_types` rows (key, label, category,
    pipelineCategory).
  - `POST` generate — routes to `generateDocument()` (pipelineCategory
    `standalone`) or `generateSowDocument()` (pipelineCategory
    `pipeline_output`) from `document-engine.ts` / `document-engine-sow.ts`.
  - `GET` recent generation history from `insights_generated_documents`
    (join `document_types` for label, `users`/`projects` for client/project
    display name).
  - Client/project pickers reuse existing non-insights endpoints —
    `GET /admin/clients/enriched` (admin-clients.ts) and `GET /admin/projects`
    (portal.ts) — not `admin-insights.ts`'s `/admin/insights/projects`.
- New frontend page component under `artifacts/admin-panel/src/pages/`
  (name TBD at build time, e.g. `DocumentGenerator.tsx`): document type list,
  client/project selector, "Generate Now" button per type, dry-run preview
  via the existing `DocumentTypePreviewDialog` (reused as-is, not rebuilt),
  recent history list.
- New nav entry wired into `workspaceNav.tsx` (path/workspace TBD at build
  time) pointing at the new page.
- Phase 2 (separate phase, sequenced after Phase 1 ships): remove the
  `cmd-insights` nav entry from `workspaceNav.tsx` entirely, and stamp a
  standard "dead — do not use" banner comment at the top of
  `admin-insights.ts`, `InsightsOutputs.tsx`, and `InsightsPayloadDialog.tsx`.
- Phase 3: "New Document Type" button + modal on `DocumentGeneratorIde.tsx`
  (label, auto-slugified/editable key, category, pipelineCategory, optional
  service dropdown from `GET /admin/services`), submitting to the existing
  `POST /admin/document-types` (admin-document-types.ts) unmodified, plus an
  "Edit Prompt" deep link to `/prompt-center/:id` after creation. Also fixes
  that route's prompt-creation block, which still pointed its new prompts'
  `featureRoute` at the legacy `/command/insights` instead of this page.
- Phase 4: "Missing Document Types" panel on the same page, backed by a new
  `GET` in `admin-document-generator.ts` — `services` LEFT JOIN
  `document_types`, filtered to `delivery_type = 'document_generation'` rows
  with no matching type — with a per-row "Quick Add" that reuses Phase 3's
  create call path.

## Dependencies / Prerequisites
Built on top of the already-shipped Document Engine initiative
(`docs/build-plans/document-engine.md`) — `document_types` table,
`generateDocument()` / `generateSowDocument()` (both with real `dryRun`
overloads), and `DocumentTypePreviewDialog.tsx` all already exist and are
reused, not rebuilt. Phase 2 depends on Phase 1 being done first (can't kill
the old nav entry / mark the old files dead until the new page actually
covers generation). Phase 4 is sequenced after Phase 3 since Quick Add reuses
Phase 3's create call path rather than a second one.

## Phases
| Phase | Title | Status | Issue |
|-------|-------|--------|-------|
| 1 | Document Generator admin page — list, generate, preview, history | Done (8b25356f, 69edf1ae) | #40 |
| 2 | Retire legacy insights generation UI — remove nav entry, mark files dead | Done (e5607df6) | #41 |
| 3 | New Document Type create modal | Done | #43 |
| 4 | Missing Document Types panel | Done | #44 |
| 5 | Scoping visibility — unscoped warning + create-time editors | Done | #46 |


## Notes
`InsightsPayloadDialog.tsx` exports `CollapsibleSection`/`MonoPre`, which
`DocumentTypePreviewDialog.tsx` (kept, reused) currently imports from it —
Phase 2's dead-banner pass must not delete or move those exports, only add
the banner comment to the top of the file, since a live component still
depends on them.

Phase count/order may change (decimal insertion) if a phase splits
mid-build. This table is the index only — full spec per phase lives in
that phase's GitHub issue. This file is the source of truth; the GitHub
Issue/Project card is a derived view.

The Phases table above previously carried a leftover merge artifact
(duplicate Phase 1/2 rows plus a stray `=======` divider from a prior
merge into `main`) — cleaned up as part of Phase 5, no content lost, both
rows already agreed on "Done".

## Open Issues
Phase 5's "Unscoped" badge links to `DocumentTypesManager.tsx`'s edit flow
at `/command/insights?tab=document_types` (deep link works — the page
reads `?tab` — but the `cmd-insights` nav entry itself was removed in
Phase 2, so an admin can only reach it by knowing this URL). If
`DocumentTypesManager.tsx`'s scoping builder becomes a regularly-needed
editing surface rather than an occasional one, it should get its own
reachable nav entry (or be ported into `DocumentGeneratorIde.tsx` directly)
rather than staying a URL-only path into a page whose own banner calls it
dead.

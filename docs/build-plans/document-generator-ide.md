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
| 6 | Signal-category scoping for document generation | Done (9255f6fc) | — |
| 7 | Simulator Studio Documents node | Done (ef7ba2a3) | — |
| 8 | Tenant-first document generation signature | Done (b44f01fd) | #47 |
| 8.5 | `insights_generated_documents` tenant FK (`msp_customer_id`) | Done (bb3390b1) — File B reported run; Drizzle `.notNull()` added in Phase 9.5 | — |
| 9 | Tenant picker — admin generate/preview take `mspCustomerId` | Done | — |
| 9.5 | Document drift gate (cost overrun guard) — reuse an existing document when no tenant data has moved | Done (c2e498ea) | — |
| 9.6 | Simulator Studio force-regenerate override | Done | — |
| 10 | Tenant-first workflow `generate_document` node (`customerId` in the payload) | Open | — |
| 11 | Retire `documentOwnerUserId` — derive ownership from the customer only | Open | — |
| 12 | Tenant-first `admin-ai-prompts` test-draft surface | Open | — |


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

## Phase 6 — Signal-category scoping for document generation
Makes `document_types.includedSignalCategories` actually do something. It had
been a stored-but-unread column since the table was created: Phase 5 gave
admins editors and an "Unscoped" warning for it, but `document-engine.ts`
discarded the value and always sent every finding to the AI, so a
security-scoped document type still received adoption/licensing findings.

What was built:
- `deriveMonitorFindingsWithKeys()` (tenant-signals.ts) — the same findings
  `deriveMonitorFindings()` already produced, each still carrying its source
  `monitor_checks.key`. `deriveMonitorFindings()` is now a `.map(f => f.text)`
  projection of it, so the two can't drift on wording or on which rows qualify.
- `fetchSignalCategoriesForCheckKeys()` (tenant-signals.ts) — ONE batched query
  (never per-check) joining `signal_derivation_rules.source_key =
  monitor_checks.key`, projecting each matched rule's `signal_key` down to its
  category prefix, validated against `SIGNAL_CATEGORY_PREFIXES` and deduped per
  checkKey. Same join `getSignalStabilizationWindowHours` already uses.
- `buildTenantProfile()` gained an ADDITIVE `categorizedFindings:
  { text, categories }[]` — 1:1 with `findings` (same strings, order, dedupe),
  built from the monitor rows it already fetched. `findings` and every other
  field are byte-for-byte unchanged; all 18 existing call sites were audited
  first and none read anything that moved.
- `document-engine.ts` (both the dry-run and real-run branches, via one shared
  `scopeFindingsBySignalCategory()` so preview can't disagree with the real
  document): when `includedSignalCategories` is non-empty, only findings whose
  categories intersect it are sent. Empty list = all findings, the same fallback
  convention `includedProfileKeyPatterns` uses.
- Logging on the filter decision under `engine.document-generator` (findings
  total / kept / uncategorizable), so "why is this finding missing?" is
  answerable from logs.

## Phase 7 — Simulator Studio Documents node
Gives Simulator Studio its own "Documents" explorer section (`SimulatorLeftTree.tsx`)
and center-canvas tab (`SimulatorCenterCanvas.tsx`), following the Assessments
section's exact existing event-driven select/open-tab pattern — no new
convention invented. This is a second, additive front end onto the same
`document_types` registry `DocumentGeneratorIde.tsx` already exposes; no
backend routes changed.

What was built:
- `SimulatorLeftTree.tsx` — new top-level "Documents" section (Section 12),
  fetching the same `GET /api/admin/document-types` list, grouped by the
  real `category` column ("report"/"consulting") the same way Section 11
  groups Assessments Free/Paid. A row with `aiPromptId === null` shows an
  amber warning-triangle with the tooltip "No AI prompt configured — this
  document type has no database-backed generation logic yet." Clicking a
  row dispatches `simulator-select-document` with the full row as detail,
  same hand-off pattern `simulator-select-assessment` already uses.
- `SimulatorCenterCanvas.tsx` — `"document"` added to `SimDocumentTab`'s type
  union; a `handleSelectDocumentType` listener (mirroring
  `handleSelectAssessment`) opens a `document:<key>` tab rendering the new
  `SimulatorDocumentCanvas`.
- `DocumentTypePreviewContent.tsx` (new) — the inner content rendering
  extracted out of `DocumentTypePreviewDialog.tsx` (copy-all button +
  collapsible sections), so the exact same preview rendering is shared by
  (a) the existing modal dialog, unchanged props/behavior for its two
  existing callers (`DocumentGeneratorIde.tsx`, `DocumentTypesManager.tsx`),
  and (b) the new inline tab pane. `DocumentTypePreviewDialog.tsx` now only
  owns the modal chrome (backdrop, bordered box, header/close button).
- `SimulatorDocumentCanvas.tsx` (new) — client/project picker using
  `DocumentGeneratorIde.tsx`'s exact fetch pattern (`GET /api/admin/clients`,
  `GET /api/admin/document-generator/clients/:id/projects`); a Dry-Run/Real
  AI toggle defaulting to Dry-Run (no accidental AI spend); one action button
  whose label follows the toggle:
  - Dry-Run → `GET /api/admin/document-types/:key/preview`, rendered via
    `DocumentTypePreviewContent`.
  - Real AI → `POST /api/admin/document-generator/document-types/:key/generate`
    (unchanged route/behavior), rendered live in an `iframe` via the
    `srcDoc`/`sandbox="allow-same-origin"` pattern `RunDetailContent.tsx`'s
    `HtmlContentPreview` already established, with a loading state during the
    call. Below that, an editable properties panel (label, pipeline category,
    linked service, section hints, sections, profile key patterns, signal
    categories) reusing `DocumentTypesManager.tsx`'s exact JSON-array
    CodeMirror editor pattern for the two scoping fields plus `sections`;
    "Save" submits through the existing `PUT /api/admin/document-types/:key`
    unmodified. `category` is shown read-only — `updateSchema`
    (`admin-document-types.ts`) omits it from the PUT payload, same as
    `DocumentTypesManager.tsx`'s edit-mode behavior, so it was never
    editable here either. A successful Save refetches via
    `simulator-documents-updated` (new event, mirroring
    `simulator-endpoints-updated`) so the tree's warning-triangle state and
    this pane's fields reflect the saved row. "Edit Prompt" stays a deep link
    to `/prompt-center/:id` — no prompt-body editor was built here.

No other Simulator Studio section (Assessments, Config Packs, Write Actions,
Monitor Checks, etc.) was touched — purely additive.

## Phase 8 — Tenant-first document generation signature
Flips the primary parameter of the shared generation entry points from a portal
user to the tenant they belong to. `generateDocument()` / `generateSowDocument()`
now take `mspCustomerId` (an `msp_customers.id`) and no longer translate a
`users.id` into one internally.

**Why it mattered:** every real input a document is built from — the tenant
profile, the findings, the MSP branding, the Sales Offer Engine's candidates —
is customer-scoped. Taking a `users.id` and privately resolving it meant the
engines could only ever be driven from user-shaped entry points, which is what
kept document generation from being drivable by tenant at all.

**Audit first (mandatory step 1, done before any code).** Repo-wide grep of every
`generateDocument(` / `generateSowDocument(` call site, cross-checked with a
second `grep -rn` pass through Bash because the Grep tool is known to silently
skip the 9899-line `workflow-executor.ts` in directory sweeps — and it did skip
it again here, so the second pass was what surfaced the executor's two call
sites. **8 real call sites across 5 files**, every one of which had only a
`users.id` available and NONE of which had an `mspCustomerId` already resolved:

| Call site | Identifier it had |
|---|---|
| `workflow-executor.ts:2320` `generateSowDocument` | `clientUserId` from the node payload |
| `workflow-executor.ts:2321` `generateDocument` | `clientUserId` from the node payload |
| `admin-ai-prompts.ts:217` `generateSowDocument` (test-draft, pipeline_output) | `clientUserId` from the request body |
| `admin-ai-prompts.ts:229` `generateDocument` (test-draft, standalone) | `clientUserId` from the request body |
| `admin-ai-prompts.ts:254` `generateSowDocument` (pricing-formula prompt) | `clientUserId` from the request body |
| `admin-document-generator.ts:103/104` (real generate) | `clientUserId` from the request body |
| `admin-document-types.ts:216/217` (dry-run preview) | `clientUserId` from the query string |
| `portal-assessment.ts:1267` `generateSowDocument` (SOW rescope) | `userId` from the logged-in token |

Ruled out as false positives: `msp-sow.ts:1178` and `portal-checkout.ts:135`
each define their own unrelated LOCAL `generateSowDocument(opts)` HTML-string
builder, and `admin-insights.ts` / `InsightsOutputs.tsx` / the `lib/db` schema
carry a `generateDocument` BOOLEAN column of the same name.

**The audit's key finding — `clientUserId` was doing two jobs, not one.** It was
the customer lookup key, but it was ALSO stamped directly onto
`insights_generated_documents.customerId`, which is a nullable `users.id`-shaped
FK, and it fed `resolveSiblingUserIds()` for prior-document grounding. So this
was never a pure rename; the customer-first signature still has to name a
document owner.

What was built:
- `resolveCustomerIdForPortalUser()` (tenant-signals.ts) — the `users.id ->
  msp_customers.id` translation, exported ONCE, beside the other bridge helpers
  and the exact inverse of the `resolveCustomerPortalUserId()` already there. It
  had been duplicated privately in three files; the two engines' copies are gone.
- `resolveDocumentOwnerUserId()` (tenant-signals.ts) — the `users.id` to stamp on
  a generated document. Prefers the canonical ACTIVE portal user, falls back to
  the canonical-order first linked login even if deactivated (a NULL FK would
  make the document unfindable by every customer-scoped read), null only when
  the customer has no linked portal user at all.
- `GenerateDocumentParams` / `GenerateSowParams` — `mspCustomerId: number`
  replaces `clientUserId`, plus an optional `documentOwnerUserId?: number`. Every
  existing caller passes its `users.id` through that field, so which login owns a
  generated document is byte-for-byte unchanged by this phase. It exists so a
  signature change couldn't silently re-attribute documents; Phase 11 retires it.
- Both engines' private `resolveEngineCustomerId()` deleted. The SOW engine's
  two `resolveSiblingUserIds(clientUserId)` grounding reads became one
  `resolveCustomerUserIds(mspCustomerId)` resolved up front — the same set,
  reached from the customer directly instead of bouncing off one arbitrary login.
- Every caller resolves at its OWN boundary and reports a real error when a user
  has no engine customer, instead of the engine silently generating against an
  empty tenant profile: workflow-executor fails the node with a message naming
  the client, the three admin routes 404, and the portal route 409s with
  customer-safe wording.

**Phase 10 (tenant picker) had not landed, so the two admin routes still accept
`clientUserId` — deliberately, and only at the boundary.** The Document
Generator IDE's only picker is `GET /admin/clients`, which is user-shaped, so
nothing in the UI could supply a customer id yet; changing the HTTP contract now
would break the page for a field no caller can populate. No frontend file
changed. Each route resolves in one line that becomes a one-line deletion when
the picker lands.

Also collapsed, because the change made them dead: the two `if (mspCustomerId !=
null)` guards in `document-engine.ts` (the id is now required, so it can't be
null) and the duplicated MSP-branding lookup they wrapped, extracted to one
`resolveMspBranding()` shared by the dry-run and real branches so a preview can
never be branded differently from the document. Dry-run/preview behavior is
otherwise untouched.

## Phase 8.5 — `insights_generated_documents` tenant FK (`msp_customer_id`)

**Numbering note.** The task that commissioned this work called it "Phase 9",
but Phase 9 in the table above is the tenant picker and is still Open — marking
that row Done would have been false. Inserted as 8.5 per this file's own
documented convention (decimal insertion for split phases, never renumber).

**The gap.** `insights_generated_documents.customer_id` is a `users.id` — ONE
arbitrary login out of however many a tenant has. Every customer-scoped read
therefore fans out through the `msp_users` bridge
(`inArray(customerId, resolveCustomerUserIds(...))`), and a document becomes
unfindable if that particular login is ever unlinked. Phase 8 made the
generation *signature* tenant-first; this phase makes the *stored row*
tenant-first. `customer_id` stays, demoted to what it actually is: the document
OWNER (which login generated/receives it), not the scope.

**Migration ships as TWO manual SQL files, deliberately not combined.** Claude
Code executes no SQL in this environment; Shane runs both by hand.
- `lib/db/migrations/manual/2026-07-28-igd-msp-customer-id-A-add-and-backfill.sql`
  — adds the nullable column, backfills from `msp_users`, and ends with a
  verification SELECT grouped by `doc_type` that breaks the stragglers into
  their three real causes (owner is NULL / no `msp_users` row / the bridge row
  has a NULL `customer_id`), plus a single gating count. Safe, additive.
- `2026-07-28-igd-msp-customer-id-B-not-null-and-index.sql` — `SET NOT NULL`
  plus the `(msp_customer_id, doc_type, created_at)` index. Labelled
  **⛔ DO NOT RUN** in the file itself, not just in commit prose. If stragglers
  remain, its `SET NOT NULL` fails outright (Postgres validates the whole
  table) — nothing corrupts, the migration just stops.
- `msp_users.user_id` is UNIQUE, so the backfill join matches at most one row
  per document — deterministic, no arbitrary row-pick.
- **No migration file deletes a document.** Resolving stragglers is Shane's
  explicit decision, not a side effect.

**The Drizzle column is typed NULLABLE on purpose.** Until File B has actually
been run, real rows can hold NULL, so `.notNull()` would make every read lie.
Adding `.notNull()` is an explicit post-File-B step, called out both in the
schema comment and at the end of File B.

**All 5 real writers populate it:**
- `document-engine.ts` / `document-engine-sow.ts` — `mspCustomerId` is already
  the function's own required param post-Phase-8; nothing to resolve.
- `workflow-executor.ts` (the `task_execution_guide` branch) — resolves via
  `resolveCustomerIdForPortalUser(clientUserId)` **before the AI call**, so an
  unlinked client fails the node with a real message instead of paying for a
  document that cannot be persisted. Mirrors the engine branch below it.
- `dashboard-export.ts` (`POST /portal/dashboard/share`) — resolves from
  `req.user!.id` and 409s with customer-safe wording.
- `document-generator.ts` (legacy but still live — imported by
  `cio-narrative-generator.ts`, `document-types.ts`, `crm-pipeline.ts`,
  `admin-document-types.ts`; deleting it is Phase 19.2's job, not this one).
  It already resolved the customer for `buildTenantProfile()`, so that value is
  threaded into `upsertDocument()` as a required param rather than re-queried —
  the row's tenant and the tenant the document was GENERATED against therefore
  cannot disagree. `testMode` is exempt from the guard because it never
  persists.

**Step 3 landed differently than commissioned — see Open Issues below.** The
task called for unmounting `admin-insights.ts` entirely from `routes/index.ts`
on the basis that "nothing calls them". That is true of its three insert
routes, but NOT of the router as a whole, so the three write routes were gated
off (410 Gone) instead and the router stays mounted.

## Phase 9 — Tenant picker: admin generate/preview take `mspCustomerId`

**Numbering note.** The task that commissioned this work called it "Phase 10",
but Phase 10 in the table above (`Tenant-first workflow generate_document node`)
is a different, unrelated change and is still Open — marking that row Done
would have been false. This is the tenant picker Phase 8 explicitly deferred,
which is Phase 9. Same situation as Phase 8.5's numbering note above; this file
is the source of truth over a task description's phase number.

Closes the interim gap Phase 8 left open: the two admin document-generation
HTTP boundaries (generate, preview) still took `clientUserId` because the
Document Generator IDE's only picker (`GET /admin/clients`) was user-shaped —
nothing in the UI could supply a real `mspCustomerId`. This phase gives the UI
that picker and flips both routes onto it.

**Built (`admin-document-generator.ts`):**
- `GET /admin/document-generator/tenants` — every `msp_customers` row
  (id, name, tenantId, domain, status), ordered by name. Rows with a null
  `tenantId` (not yet connected to a real M365 tenant) are returned, not
  filtered out, so the frontend can show the same amber "not yet connected"
  warning convention already used elsewhere in this app instead of hiding an
  onboarding-stage customer from the picker.
- `GET /admin/document-generator/tenants/:mspCustomerId/projects` — resolves
  every linked login for the tenant via `resolveCustomerUserIds()`
  (tenant-signals.ts, already built in Phase 8) and returns projects across
  the whole set via `inArray(projectsTable.clientUserId, userIds)`, ordered by
  `updatedAt desc` — not just one arbitrary login's projects. Empty user-id set
  (an unclaimed customer) short-circuits to `[]` rather than an unguarded
  `inArray([])`.
- The old `GET /admin/document-generator/clients/:id/projects` route is
  removed outright — both of its only two callers (the two frontend surfaces
  below) moved onto the tenant-scoped route in the same change, so nothing was
  left depending on it.

**Flipped (the two routes Phase 8 deliberately left on `clientUserId`):**
- `POST /admin/document-generator/document-types/:key/generate`
- `GET /admin/document-types/:key/preview` (`admin-document-types.ts`)

Both now read `mspCustomerId` at the HTTP boundary directly and no longer call
`resolveCustomerIdForPortalUser()` — that one-line translation is deleted from
both routes, exactly as Phase 8 said it would be. Neither route passes
`documentOwnerUserId` anymore either (there is no `clientUserId` left to pass);
`document-engine.ts`/`document-engine-sow.ts` already fall back to
`resolveDocumentOwnerUserId(mspCustomerId)` when it's omitted (Phase 8), so
document ownership still resolves to the tenant's canonical active portal
user rather than going unowned.

**Frontend (`DocumentGeneratorIde.tsx`, `SimulatorDocumentCanvas.tsx`):** both
surfaces' client dropdown (`GET /admin/clients`, showing a person's
name/email) is replaced with the new tenant dropdown (showing
`msp_customers.name` — the real company name), with the amber "⚠ … (not yet
connected)" label for null-`tenantId` rows. Both surfaces' project fetch and
every preview/generate call now send `mspCustomerId` instead of
`clientUserId`. `GET /admin/clients` itself and its other callers (real
account-management screens that legitimately list logins) were not touched —
only these two document-generation surfaces moved off it.

**Verified:** `npx tsc --noEmit` clean in both `api-server` and `admin-panel`.
Existing `admin-document-generator.test.ts` (missing-types coverage) passes
unchanged. Not live-verified — no `DATABASE_URL` in this environment per repo
rule.

## Phase 9.5 — Document drift gate (cost overrun guard)

**Numbering note.** The task that commissioned this work called it "Phase 11",
but Phase 11 in the table above (`Retire documentOwnerUserId — derive ownership
from the customer only`) is a different, unrelated change and is still Open —
`documentOwnerUserId` is untouched by this phase and every caller still passes
it. Marking that row Done would have been false. Decimal insertion instead, per
the same convention Phase 8.5 and Phase 9 already set: this phase depends on
Phase 8.5 (the real `msp_customer_id` column) and Phase 9 (the tenant-native
generate route) and on nothing in Phases 10-12, so it sits at 9.5. This file is
the source of truth over a task description's phase number.

Repeated "Generate" clicks against a tenant whose data had not moved each paid
for a fresh AI call to produce the same document. This phase gates real
generation on whether any of the document's real inputs are newer than the
document already on file.

**Built (`tenant-signals.ts`): `findReusableDocument(mspCustomerId, docTypeKey)`.**
Reads `insights_generated_documents` by `msp_customer_id` + `doc_type` directly
— a real column since Phase 8.5, with File B's `(msp_customer_id, doc_type,
created_at)` index behind exactly this query, so no `msp_users` fan-out join is
involved. Candidate statuses are `approved` / `delivered` / `draft` only:
`generating` is an in-flight placeholder with empty HTML, `failed` never
produced content, and `archived` was deliberately superseded (by an operator or
by the SOW supersede path) — handing one back would silently resurrect it.
`draft` IS reusable: it is a complete document, just one generated in testMode.

Drift is the MAX of the three timestamps that actually feed a document's inputs,
matching what `buildTenantProfile()` reads: `tenant_monitor_profiles.collectedAt`
for the customer's `msp_customers.tenantId`, plus `client_m365_profiles.updatedAt`
and `script_run_results.createdAt` across every login `resolveCustomerUserIds()`
returns. A NULL `tenantId` (no linked M365 tenant yet) skips the monitor source
rather than erroring — the other two can still be meaningful, and for some
document types they are the only inputs there are; an unclaimed customer with no
linked logins skips the other two the same way. `MAX <= document.createdAt` is
reuse; strictly newer is drift. **No telemetry at all is treated as no drift** —
nothing has changed since the document was written because nothing exists to
change, and regenerating would buy an AI call to reproduce the same "no
telemetry was captured" document.

**Wired (`document-engine.ts`, `document-engine-sow.ts`):** new
`forceRegenerate?: boolean` (default false) on `GenerateDocumentParams` /
`GenerateSowParams`. At the top of each function's non-dry-run branch a hit
returns immediately — no placeholder row, no AI call — logging
`"document-engine: reusing existing document, no drift detected, no AI call
made"` under `engine.document-generator` with the tenant, doc type, and reused
document id. **Dry-run/preview is untouched:** both dry-run branches return
before the gate, so a preview never consults it.

**THE GATE REFUSES TO RUN FOR REQUEST-LEVEL INPUTS IT CANNOT SEE.** The three
timestamps describe the tenant's DATA; they say nothing about inputs that belong
to a particular *request*, and reusing on those would be silently wrong rather
than merely stale. So reuse is suppressed, independently of `forceRegenerate`,
whenever `promptOverride` or `pricingFormulaOverride` is set (an admin testing an
unsaved draft prompt would otherwise be handed a document built from the
PUBLISHED prompt and believe their draft produced it — `admin-ai-prompts.ts`'s
three test-draft calls) or `selectedWorkstreamTitles` is non-empty (the customer
narrowing their own SOW scope in `portal-assessment.ts` would otherwise get the
OLD, wider SOW back — wrong scope and wrong price on a document they sign).
Inputs owned by other tables — an edited `ai_prompts` body, changed
`document_types` scoping config, new Sales Offer Engine pricing — are equally
invisible to the gate and are what `forceRegenerate: true` exists for.

**Two real hazards this change introduced elsewhere, found by audit and fixed
in the same commit:**
- `workflow-executor.ts`'s `generate_document` node looks up a `priorDocId` to
  supersede BEFORE generating and deletes it after. A reuse hit very often
  returns *that exact row* (same customer, project, doc type, status set), so
  the node would have deleted the document it had just reported as its own
  output. Guarded with `priorDocId !== engineResult.documentId`.
- `portal-assessment.ts`'s SOW rescope path now passes `forceRegenerate: true`
  explicitly. Non-empty `selectedWorkstreamTitles` already suppresses reuse
  structurally, but the caller states the intent, and it holds even when the
  requested list is empty.

**Threaded:** `POST /admin/document-generator/document-types/:key/generate`
takes `forceRegenerate` as a body param, defaulting false via a strict
`=== true` check so a body carrying the string `"false"` cannot accidentally buy
an AI call. Whichever later phase adds the Simulator's explicit regenerate
override sets this same flag.

**Schema:** `insightsGeneratedDocumentsTable.mspCustomerId` is now `.notNull()`,
matching the DB column after File B. **This uncovered three insert call sites
Phase 8.5's "all 5 real writers already supply it" audit did not cover** — the
three retired write paths in `admin-insights.ts` (`POST .../documents/generate`,
`POST .../consulting/generate`, `POST .../automations/:id/run`). All three are
unreachable behind that file's 410 `retiredWriteRoute()` gate, but unreachable
code still type-checks, and none of them has a correct tenant to supply (the
automation runner's is `automation.customerId ?? null`, nullable by design).
Rather than fabricate a value — which would write a document under the WRONG
tenant the moment anyone lifted the gate — each insert's `mspCustomerId` is
supplied by `retiredWriteRouteHasNoTenant()`, a function typed `number` that
throws. They compile, stay unreachable, and fail loudly instead of silently
mis-attributing a document.

**Known timestamp caveat, documented in the helper rather than hidden:**
`collected_at` is `timestamptz` while `created_at`/`updated_at` on the other
three tables are `timestamp` (no zone), which node-postgres parses as local time.
At a positive UTC offset that biases the comparison toward REGENERATING (the safe
direction); at a negative offset a same-hour reuse could in principle serve a
document a few hours stale. Worth confirming the DB's `TimeZone` on Shane's
console; not fixable from here without changing the column types.

**Verified:** `npx tsc --noEmit` clean in `api-server` (after
`tsc --build --force lib/db`). 14 new tests in `document-drift-gate.test.ts`
(registered in `vitest.config.ts`'s hardcoded include list) — 14/14 passing:
no-candidate short-circuits before any drift query; the reusable-status set
asserted on the real query rather than inferred; drift from each of the three
sources independently; the `<=` boundary; no-telemetry reuse; draft reuse; and
NULL-`tenantId` / no-linked-login paths proving the skipped source is not
queried at all while the remaining ones still decide. Scoped A/B on the
`workflow-executor.ts` hunk: 97 failed / 195 passed across the five
workflow-executor test files BEFORE and AFTER — identical, and those 97 belong to
a concurrent AI-cost-metering session's in-flight work, not this change.
`tenant-signals.test.ts` (needs a real `DATABASE_URL` — it never mocked
`@workspace/db`) and `doc-pipeline.test.ts` (`logger.child` in
`sharepoint-connector.ts`, a file this change never touches) fail for documented
pre-existing reasons. Not live-verified — no `DATABASE_URL` in this environment
per repo rule.

## Phase 9.6 — Simulator Studio force-regenerate override

**Numbering note.** The task that commissioned this work called it "Phase 12",
but Phase 12 in the table above (`Tenant-first admin-ai-prompts test-draft
surface`) is a different, unrelated change and is still Open. Phase 9.5's own
numbering note had already flagged that whichever phase adds this Simulator
override should sit next to the drift gate it exposes, not after it — so this
is 9.6: it depends on 9.5 (the drift gate/`forceRegenerate` param it already
built) and on nothing in Phases 10-12.

`SimulatorDocumentCanvas.tsx`'s Real AI mode had no way to bypass the Phase 9.5
reuse check — an operator testing a document type against a tenant with no new
telemetry would silently get the old cached document back instead of a fresh
generation. Added a "Force regenerate" checkbox next to the Dry-Run/Real AI
toggle, visible and enabled only in Real AI mode (meaningless in Dry-Run, since
`/preview` never consults the drift gate). Default unchecked. When checked, the
generate POST body includes `forceRegenerate: true`; when unchecked, the field
is omitted entirely so the server's existing `=== true` default-false handling
is unchanged. An inline note under the checkbox states what it does: "Bypasses
the reuse check — always calls AI, even if an unchanged document already
exists." No backend changes — the route and `forceRegenerate` param already
existed from Phase 9.5.

## Open Issues
**Phase 9.5 assumes migration File B has been run.** The Drizzle `.notNull()`
was added on the commissioning task's statement that
`insights_generated_documents.msp_customer_id` is already NOT NULL in the DB.
That could not be verified from here (no `DATABASE_URL` per repo rule). If File B
has NOT actually been run, real rows can still hold NULL and every select of that
column now types as `number` while it isn't — Shane should confirm File B ran
before relying on it. The `.notNull()` changes no runtime behavior either way;
all five real writers already populated the column unconditionally.

**Phase 8.5 — `admin-insights.ts` could NOT be unmounted; 3 GET routes are
still live.** The task commissioning this phase specified removing the
`router.use(adminInsightsRouter)` mounting entirely. Grep says that would break
real surfaces, so it was not done:
- `GET /admin/insights/documents/:id/download` is the URL stored in
  `insights_generated_documents.pdf_url` **by the current engine path** —
  `workflow-executor.ts` stamps it on every document `generateDocument()`/
  `generateSowDocument()` produces, and `document-generator.ts` does the same.
  Unmounting 404s the download link on every generated document, including
  brand-new ones and every row already in the table.
- `GET /admin/insights/documents` backs live pickers in
  `ScriptGeneratorPage.tsx` and `WorkflowBuilderPage.tsx`.
- `GET /admin/insights/projects` backs `WorkflowBuilderPage.tsx` and
  `WorkflowListPage.tsx`.

What was done instead achieves the actual safety goal: the three
document-creating routes (`POST /admin/insights/documents/generate`,
`POST /admin/insights/consulting/generate`,
`POST /admin/insights/automations/:id/run`) return **410 Gone** via a
`retiredWriteRoute()` gate. `executeAutomation` has no scheduler or cron caller
— verified by grep — so gating that route genuinely makes its insert
unreachable. Note that route could never have satisfied the constraint anyway:
its insert uses `automation.customerId ?? null`, nullable by design.

**To actually unmount the file**, those three GETs need rehoming onto a
non-legacy router (`admin-document-generator.ts` is the natural home), and the
`pdf_url` values already persisted in the table need either a backfill to the
new path or a redirect from the old one. That is its own phase, not a
side-effect of this one. A matching comment sits at the mount site in
`routes/index.ts` so the next session doesn't re-litigate it.

**Phase 6 — script-run findings can never be category-scoped (permanent).**
Findings from `script_run_results.parsedFindings` are free-text strings uploaded
by the legacy M365 script with no checkKey and no link to any
`signal_derivation_rules` row. There is nothing to attribute them through, so
they always carry `categories: []` and are EXCLUDED whenever a document type
sets `includedSignalCategories`. This is a data limitation, not a deferred
task — the attribution data does not exist and cannot be derived without
fabricating it. They are deliberately kept in `categorizedFindings` (rather
than dropped from the type) so callers can see them and decide. Post-wipe,
script-fed findings are largely dead anyway.

**Phase 6 — recall limit on the rule↔check join.** A rule whose `source_key` is
a mapping targetField (e.g. `globalAdminCount`) or the synthetic
`<checkKey>__itemCount` rather than the bare check key does not match the join,
so its category isn't attributed to that check. Widening to mapping
targetFields would be ambiguous (two checks can emit the same targetField).
Under-attribution is the safe direction — it can only make a scoped document
narrower, never leak a finding into a type that didn't ask for its category.
Not live-verified: no DB access in Claude Code sessions, so how many real rules
use the bare-key form vs. a derived form is unknown here and worth a look on
Shane's console before any document type is switched to a narrow category list.

Phase 5's "Unscoped" badge links to `DocumentTypesManager.tsx`'s edit flow
at `/command/insights?tab=document_types` (deep link works — the page
reads `?tab` — but the `cmd-insights` nav entry itself was removed in
Phase 2, so an admin can only reach it by knowing this URL). If
`DocumentTypesManager.tsx`'s scoping builder becomes a regularly-needed
editing surface rather than an occasional one, it should get its own
reachable nav entry (or be ported into `DocumentGeneratorIde.tsx` directly)
rather than staying a URL-only path into a page whose own banner calls it
dead.

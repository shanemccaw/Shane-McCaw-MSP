# Documents (MSP Console) — contract extraction pack for Claude Design

**#2645**, step 3 of **#2569** (Feature: Documents, MSP Console — the operator half of
#1658), under **#1571** (EPIC: Portal Admin — MSP-side operator surface). Follows the
**#1642 pattern**: per-surface wire contracts extracted verbatim and cited to file:line,
CURRENT vs DECIDED marked on every field, real enum unions only, cross-surface edges,
honest tri-state, forbidden list, orphaned endpoints listed explicitly. Read-only — no
product code, schema, or UI changed.

**This is a different surface from `docs/documents-contract-pack.md`, not a re-run of
it.** That pack (#2449, part of #1658 "Feature: Documents (Portal)") is scoped to the
**customer-facing** read surface — `GET /api/portal/reports`,
`GET /api/portal/insights-documents` (+ `/:id/view`, `/:id/pdf`),
`POST /api/portal/documents/:id/share`, `GET /api/portal/reports/:id/download`, plus
the two public share routes — all in `portal-documents.ts`, where a customer views and
shares their own generated documents. #2569 is the other half: the **MSP-console
operator** surface, split across two genuinely different concerns that happen to share
this Feature —

1. **A document the MSP itself authors and publishes** (`msp-documents.ts`) — an
   HTML→PDF→SharePoint pipeline the MSP drives directly (its own SharePoint-hosted
   deliverables, general/branded documents), backed by `msp_documents` /
   `msp_document_versions` / `msp_sharepoint_connectors`. Nothing to do with
   `insights_generated_documents`.
2. **An aggregated read/share view over documents the *platform already generated for
   customers*** (`msp-documents-hub.ts`) — a book-wide "documents hub" so MSP staff
   don't have to open each customer individually to find a report/SOW/deliverable,
   backed by the exact same `insights_generated_documents` table
   `docs/documents-contract-pack.md` already documents, read-only here except for its
   own MSP-scoped share-mint route.

Both halves are confirmed real and live, both mounted in the same router:
`artifacts/api-server/src/routes/index.ts:452-453`
(`router.use(mspDocumentsRouter)`, `router.use(mspDocumentsHubRouter)`).

Backend route files (all 15 routes real, confirmed live before any of this was
written — 11 in `msp-documents.ts`, 4 in `msp-documents-hub.ts`):

- `POST   /api/msp/documents` — `msp-documents.ts:66-161`
- `GET    /api/msp/documents` — `msp-documents.ts:165-201`
- `GET    /api/msp/documents/:documentId` — `msp-documents.ts:205-251`
- `POST   /api/msp/documents/:documentId/versions` — `msp-documents.ts:256-319`
- `GET    /api/msp/documents/:documentId/versions` — `msp-documents.ts:323-374`
- `GET    /api/msp/documents/:documentId/versions/:versionId` — `msp-documents.ts:378-423`
- `POST   /api/msp/documents/:documentId/publish` — `msp-documents.ts:427-485`
- `GET    /api/msp/sharepoint-connectors` — `msp-documents.ts:489-523`
- `POST   /api/msp/sharepoint-connectors` — `msp-documents.ts:525-599`
- `PATCH  /api/msp/sharepoint-connectors/:connectorId` — `msp-documents.ts:601-666`
- `DELETE /api/msp/sharepoint-connectors/:connectorId` — `msp-documents.ts:668-699`
- `GET    /api/msp/documents-hub` — `msp-documents-hub.ts:89-184`
- `GET    /api/msp/documents-hub/:id/view` — `msp-documents-hub.ts:228-243`
- `GET    /api/msp/documents-hub/:id/pdf` — `msp-documents-hub.ts:247-278`
- `POST   /api/msp/documents-hub/:id/share` — `msp-documents-hub.ts:287-330`

Schema: `lib/db/src/schema/msp.ts:776-886` (`MSP_SHAREPOINT_CONNECTOR_MODES`,
`mspSharepointConnectorsTable`, `DOC_PIPELINE_STATUSES`, `mspDocumentsTable`,
`mspDocumentVersionsTable`); `lib/db/src/schema/index.ts:2420-` and `:2794-2810`
(`insightsGeneratedDocumentsTable`, `quickWinResultSharesTable` — both owned by
`docs/documents-contract-pack.md`, cited here only far enough to be honest about
what §2's hub route reads/writes). Auth: `requireAuth.ts:80-93` (`ROLE_ORDER`,
`roleIndex`), `:205-221` (`requireRole`), `:349-361`
(`resolveStaffScopedCustomerIds`). `resolveMspIdStrict()`:
`resolve-msp-id.ts:75-77`. Pipeline: `doc-pipeline-nodes.ts` (all 7 node handlers +
`DEFAULT_DOC_PIPELINE_GRAPH`, `:161-729`), `portal-workflow-engine.ts` (`createRun`,
`executeRun`, `topoSort`, `:1-908`). SharePoint: `sharepoint-connector.ts` (all
exports, `:1-338`).

**No test file exists for either route file** — `find` for
`*msp-documents*test*` under `artifacts/api-server/src/routes` returns nothing.
Unlike the sibling `docs/offboarding-msp-console-contract-pack.md` (backed by
`msp-portal.test.ts`), this Feature's backend has zero automated coverage today —
Design/QA should know these 15 routes are real and live but not regression-tested.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03): `msp_documents`,
`msp_document_versions`, `msp_sharepoint_connectors`, `insights_generated_documents` all
return `count = 0`. Nobody has ever exercised either pipeline against this environment.
Every route below is real and live, but the pack's own example values are all
zero-state, not a live mid-lifecycle sample — same honest caveat
`docs/offboarding-msp-console-contract-pack.md`'s header already carries.

---

## 0. What this surface is, and what it is not

**Two independent document concerns under one Feature, sharing no table.**

```
msp-documents.ts          msp_documents ─┬─ msp_document_versions
(MSP-authored pipeline)                  └─ msp_sharepoint_connectors

msp-documents-hub.ts      insights_generated_documents (read) ── quick_win_result_shares (write, §2's share route only)
(customer-doc aggregator)
```

**§1's pipeline is forward, linear, non-branching.** A submitted document runs
`doc_store_html → doc_generate_pdf → doc_save_sharepoint → doc_register_version →
doc_publish → doc_audit_export → doc_cleanup` (`DEFAULT_DOC_PIPELINE_GRAPH`,
`doc-pipeline-nodes.ts:708-728`) unconditionally, every time, for every document —
see §6's honest-empty note on `autoPublish`.

**§2's hub is read-only aggregation over a table this Feature does not own.**
`msp-documents-hub.ts`'s own file header says so explicitly (`:4-16`): it does not
modify `insights_generated_documents` or its generation logic, and does not duplicate
the existing customer-side share flow — it adds an MSP-staff-scoped entry point that
writes to the *same* `quick_win_result_shares` table through the exact same mechanism,
since the customer-side `POST /portal/documents/:id/share`
(`docs/documents-contract-pack.md`) is gated to `doc.customerId === caller's own
users.id` and has no path for MSP staff acting on a customer's behalf.

**Not built yet, on the frontend.** `artifacts/msp-console` does not exist (confirmed
via `ls artifacts/`: `admin-panel`, `api-server`, `mcp-server`, `msp-website`,
`portal`, `shane-mccaw-consulting` — no `msp-console`) — same expected
pre-scaffolding state `docs/offboarding-msp-console-contract-pack.md` §0 and
`docs/sops-msp-console-contract-pack.md` §0 already documented for their own
Features. §0.1 below is the honest orphaned-consumer picture for both halves.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/documents` | POST, GET | `msp-documents.ts:66, 165` | **Nothing found** | **Yes** |
| `/api/msp/documents/:documentId` | GET | `msp-documents.ts:205` | **Nothing found** | **Yes** |
| `/api/msp/documents/:documentId/versions` | POST, GET | `msp-documents.ts:256, 323` | **Nothing found** | **Yes** |
| `/api/msp/documents/:documentId/versions/:versionId` | GET | `msp-documents.ts:378` | **Nothing found** | **Yes** |
| `/api/msp/documents/:documentId/publish` | POST | `msp-documents.ts:427` | **Nothing found** | **Yes** |
| `/api/msp/sharepoint-connectors` | GET, POST | `msp-documents.ts:489, 525` | **Nothing found** | **Yes** |
| `/api/msp/sharepoint-connectors/:connectorId` | PATCH, DELETE | `msp-documents.ts:601, 668` | **Nothing found** | **Yes** |
| `/api/msp/documents-hub` | GET | `msp-documents-hub.ts:89` | **Nothing found** | **Yes** |
| `/api/msp/documents-hub/:id/view` | GET | `msp-documents-hub.ts:228` | **Nothing found** | **Yes** |
| `/api/msp/documents-hub/:id/pdf` | GET | `msp-documents-hub.ts:247` | **Nothing found** | **Yes** |
| `/api/msp/documents-hub/:id/share` | POST | `msp-documents-hub.ts:287` | **Nothing found** | **Yes** |

```
grep -rln "msp/documents\|msp/sharepoint-connectors" --include=*.ts --include=*.tsx artifacts/
```

returns only the route files themselves — zero UI or tool callers anywhere in
`artifacts/portal`, `artifacts/admin-panel`, `artifacts/msp-website`. All 15 routes are
real and live, none is exercised by any current surface. Root cause, same one already
tracked project-wide: `Design/msp-console/` has no export yet and `artifacts/msp-console`
has no scaffolding — expected state ahead of #2569's own architect → build → pack →
Design → wire sequence, not a bug, not filed as a new finding.

---

## 1. Wire contract — the MSP-authored document pipeline (`msp-documents.ts`)

Every route in this section gates `requireRole("MSPOperator")` except the 3 SharePoint
connector write routes (POST/PATCH/DELETE), which gate `requireRole("MSPAdmin")` — one
tier up, since connector credentials are sensitive. All 8 non-connector routes and the
connector `GET` resolve `mspId` via `resolveMspIdStrict(req)` (session claim only, no
query-param override) and 403 `{ error: "MSP context required" }` if the session
carries none.

### 1.1 `POST /api/msp/documents` (`:66-161`) — submit HTML, trigger the pipeline

Body: `title` (required, 400 `"title is required"`), `htmlContent` (required, 400
`"htmlContent is required"`), `documentType` (optional, default `"general"`, free-text —
no enum gate at the route), `customerId` (optional `tenants.id`; sets
`ownerType: customerId ? "customer" : "msp"`), `changeNote` (optional), `connectorMode`
(`"platform" | "msp_owned"`, default `"platform"`), `connectorId` (required when
`connectorMode === "msp_owned"`, 400 `"connectorId is required when connectorMode is
msp_owned"`), `autoPublish` (optional boolean, default `false` — **see §6, this field
has no effect on the pipeline's real behavior**).

On success: inserts `msp_documents` (`status: "draft"`, `pipelineStatus: "pending"`),
lazily seeds the `doc.pipeline.default` workflow if it doesn't already exist
(`ensureDocPipelineWorkflow`, `:44-62`), creates a `portal_wf` run via `createRun()`
with `tenantContext.mspId = resolveBillingMspId(req.user) ?? mspId` (so an
impersonation session debits the *impersonated* MSP, not the impersonator —
`ai-billing.ts:73-78`), persists the returned `runId` onto the document, and fires
`executeRun(runId)` **without awaiting it** (`void executeRun(runId)`). Response:
`202 { documentId, runId, message: "Document accepted — pipeline started" }` — the
pipeline itself runs asynchronously; the caller gets no synchronous confirmation the
pipeline succeeded, only that it started.

### 1.2 `GET /api/msp/documents` (`:165-201`) — list, mspId-scoped

Query params: `customerId` (optional int filter), `status` (optional, must be one of
`"draft" | "active" | "archived"` — silently ignored if any other string). Returns up
to 100 rows, newest-first (`orderBy(desc(createdAt))`), no pagination beyond the fixed
limit. Response: `{ documents: MspDocument[] }` — the **full** row shape (every column
on `mspDocumentsTable`), not a projected subset.

### 1.3 `GET /api/msp/documents/:documentId` (`:205-251`) — one document + its current version

404 `{ error: "Document not found" }` if the document doesn't exist or belongs to a
different `mspId`. If `document.currentVersionId` is set, fetches that version and
strips its `content` field to the literal string `"[html]"` when non-null (`:241-243`)
— the version's HTML is deliberately never returned by this route (can be large);
`GET .../versions/:versionId` (§1.6) is the only route that returns real content.
Response: `{ document: MspDocument, currentVersion: MspDocumentVersion | null }` (with
`currentVersion.content` always `"[html]"` or `null`, never the real HTML).

### 1.4 `POST /api/msp/documents/:documentId/versions` (`:256-319`) — new version, re-trigger pipeline

404 if the document isn't found/scoped. 409 `{ error: "Cannot add versions to an
archived document" }` if `status === "archived"` — the only guard on this route; a
`"draft"` or `"active"` document accepts new versions freely, including one already
`"active"` (re-versioning a published document is allowed, not just draft iteration).
Body: `htmlContent` (required, 400), `changeNote` (optional). Creates a new
`doc.pipeline.default` run the same way as §1.1 (`triggerEventType:
"msp.document.version"`, always `autoPublish: false` hardcoded in the input payload —
see §6, this hardcoding is moot given §6's finding), sets
`pipelineStatus: "pending"` on the parent document, fires `executeRun(runId)`
unawaited. Response: `202 { documentId, runId, message: "New version pipeline
started" }`.

### 1.5 `GET /api/msp/documents/:documentId/versions` (`:323-374`) — version list

404 if the document isn't found/scoped (checked via a narrow `documentId`-only select,
`:335-344`). Returns every version for the document, newest-`versionNumber`-first, as
a **projected** column set (`:349-363`) that explicitly excludes `content` — the same
"don't ship large HTML in a list response" pattern as §1.3. Response:
`{ versions: Array<{versionId, documentId, versionNumber, contentHash, mimeType,
sizeBytes, pdfSizeBytes, sharepointFileId, sharepointFileUrl, pipelineStatus,
authorUserId, changeNote, createdAt}> }`.

### 1.6 `GET /api/msp/documents/:documentId/versions/:versionId` (`:378-423`) — one version, full content

404 `{ error: "Version not found" }` if the version doesn't exist or its
`documentId` doesn't match the URL's `:documentId` (both checked, `:406-411`) — this is
the **only** route in this pack that returns the version's real `content` field
(`res.json({ version })` — the full row, unprojected, `:417`).

### 1.7 `POST /api/msp/documents/:documentId/publish` (`:427-485`) — manual publish

404 if not found/scoped. 409 `{ error: "Document has no version to publish — run the
pipeline first" }` if `currentVersionId` is null. 409 `{ error: "Cannot publish an
archived document" }` if `status === "archived"`. On success: sets
`status: "active"`, `pipelineStatus: "published"`, `publishedAt`, `publishedByUserId`
on the document, and `pipelineStatus: "published"` on the current version. Response:
`{ documentId, publishedAt: <ISO> }`. **Not idempotent-guarded** — unlike §3 below,
calling this twice on an already-published document just re-writes the same fields
with a fresh timestamp; no 409/skip branch exists for "already active."

### 1.8 SharePoint connector CRUD (`:489-699`)

- **`GET /api/msp/sharepoint-connectors`** (`MSPOperator+`) — all connectors for the
  caller's `mspId`, newest-first, projected columns including `clientSecretRef`
  (the Key Vault *reference name*, not the secret value) but **not**
  `clientSecretPlain` — the plaintext dev-only secret is never returned by any route
  in this pack.
- **`POST /api/msp/sharepoint-connectors`** (`MSPAdmin+`) — `label`, `tenantId`,
  `clientId` all required (400 each). Exactly one of `clientSecretRef` /
  `clientSecretPlain` required (400 `"clientSecretRef or clientSecretPlain is
  required"`). **`clientSecretPlain` is hard-rejected when
  `process.env.NODE_ENV === "production"`** (400
  `"clientSecretPlain is not allowed in production — use clientSecretRef (Key Vault)"`,
  `:559-562`) — a real production guard, not merely a convention comment.
  `sharepointSiteId` is resolved via `resolveConnectorSiteId()` best-effort (`.catch(()
  => null)` — a resolution failure never blocks connector creation). Response:
  `201 { connector: {connectorId, label, sharepointSiteId} }` — a narrow returning
  clause, not the full row (no secret fields echoed back).
- **`PATCH /api/msp/sharepoint-connectors/:connectorId`** (`MSPAdmin+`) — 404 if not
  found/scoped. Every field is optional and independently patchable; re-resolves
  `sharepointSiteId` only when a new `sharepointSiteUrl` string is provided.
  `clientSecretPlain` writes are silently dropped (not rejected — just not applied,
  `:650-652`) when `NODE_ENV === "production"`, the update equivalent of the POST
  route's hard 400. Response: `{ ok: true, connectorId }`.
- **`DELETE /api/msp/sharepoint-connectors/:connectorId`** (`MSPAdmin+`) — **soft**
  delete only: sets `isActive: false`, never a real `DELETE`. 404 if not found/scoped.
  Response: `{ ok: true, connectorId }`.

---

## 2. Wire contract — the customer-documents hub (`msp-documents-hub.ts`)

All 4 routes gate `requireRole("MSPOperator")`, resolve `mspId` via
`resolveMspIdStrict(req)`, and additionally call
`resolveStaffScopedCustomerIds(req.user!)` (`requireAuth.ts:349-361`) — `null` for an
`MSPAdmin`/unscoped `MSPOperator` (unrestricted, full book), or a real `customerId[]`
allow-list for a staff member with rows in `msp_staff_customer_scopes`. Every route in
this section fences a scoped caller to their own assigned customers.

### 2.1 The customer bridge (`loadCustomerBridge`, `:69-85`)

**The MSP scope comes off the tenant row, not the user row** — the function's own
comment explains why (`:60-68`): since #92, a tenant-scoped login carries `tenantId`
but not necessarily `mspId` (`users_role_scope_check` demands one or the other), so
filtering on `users.mspId` would return an empty bridge and this whole hub would report
zero documents for every real MSP. The join is an **inner** join
(`usersTable ⋈ tenantsTable` on `tenantId`, filtered `tenantsTable.mspId = mspId`) — a
user with no tenant contributes nothing to the bridge.

### 2.2 `GET /api/msp/documents-hub` (`:89-184`) — aggregated, filterable, paginated list

Query params: `customerId` (int), `docType` (string, exact match against
`insights_generated_documents.doc_type` — no enum gate at the route, matches whatever
the generator wrote), `category` (must coerce to `"report" | "consulting"` — cast, not
validated), `dateFrom`/`dateTo` (parsed `Date`, invalid dates silently ignored via
`isNaN` guards), `limit` (default 50, hard-capped at 200 via `Math.min`), `offset`
(default 0, floored at 0 via `Math.max`).

**Pagination is in-memory, not SQL-level** (`:159-160`): the full filtered row set is
fetched, `total = rows.length` computed from the *entire* set, and only then is
`.slice(offset, offset + limit)` applied to build the page — `total` is always the true
total-matching count, but every request re-fetches the whole filtered set from Postgres
regardless of `limit`/`offset`. Fine at current (zero) row counts; a real scaling
concern once a book has thousands of generated documents, not flagged as a defect here
(no evidence yet it's ever been hit) but worth Design/build knowing before assuming
cursor-style pagination.

Response fields per row (`:162-177`): `id`, `title`, `category`, `docType`, `status`,
`deliveredAt`, `createdAt`, `sowTotalPrice`, `projectId`, `projectTitle` (joined from
`projectsTable`, `null` if the document has no linked project),
`customerId`/`customerName` (resolved through the bridge, `null` if unresolvable —
should not happen given the inner join but coded defensively), `deepLink` (a relative
`/customers/:customerId` path, `null` if `customerId` is null). If the bridge is empty
(no customers in this MSP's book) or the eligible-user-id set is empty after
scoping/filtering, returns `{ documents: [], total: 0, limit, offset }` immediately
(`:98-101`, `:127-130`) — honest early-empty, not a query that runs and returns
nothing.

### 2.3 `loadScopedDocument` (`:192-224`) — the shared authorization gate for §2.4-2.6

Loads the document, returns `null` (→ 404 at every call site) if: the document doesn't
exist, `customerId` is null (an orphaned/malformed row), the owning user has no tenant,
that tenant's `mspId` doesn't match the caller's, or (when scoped) the owning tenant
isn't in the caller's assigned `scopedCustomerIds`. Same inner-join MSP-ownership
pattern as §2.1, applied per-document.

### 2.4 `GET /api/msp/documents-hub/:id/view` (`:228-243`) — sandboxed HTML viewer content

No status gate — any resolvable document returns its HTML, even `"draft"` or
`"generating"`. Runs `stripStagedForReviewBanner()` (`sow-pricing.ts`) on the content
before returning. Response: `{ id, title, htmlContent }`.

### 2.5 `GET /api/msp/documents-hub/:id/pdf` (`:247-278`) — branded PDF download

**403** `{ error: "Document not available for download" }` unless
`status ∈ {"approved", "delivered"}` — stricter than §2.4's viewer, which has no status
gate at all. Builds the PDF live on every call via `buildHtmlDoc()` + `htmlToPdf()`
(`insight-pdf.ts`) — **not cached**, regenerated from the stripped HTML every request.
Filename sanitized to `[a-zA-Z0-9 _-]`, spaces→hyphens, truncated to 80 chars. Streams
`application/pdf` with `Content-Disposition: attachment`.

### 2.6 `POST /api/msp/documents-hub/:id/share` (`:287-330`) — MSP-staff-scoped share mint

403 unless `status ∈ {"approved", "delivered"}` **or** `docType === "scoped_sow"` — a
real exception carved out for scoped SOWs regardless of status, not present on §2.5's
PDF gate. Deletes any existing `document`-kind share row for this `id` first
(`:301-307` — **at most one live share link per document**, a fresh call always
invalidates the prior link rather than stacking), then mints a new 32-byte hex token
with a 30-day expiry into `quick_win_result_shares` — the exact same table/mechanism
`docs/documents-contract-pack.md`'s customer-side `POST /portal/documents/:id/share`
writes to, differing only in the authorization check (MSP-book ownership here vs.
`doc.customerId === caller` there). Response:
`{ shareUrl: "<portalBaseUrl>/shared-documents/<token>", expiresAt: <ISO> }`.
`getMspPortalBaseUrl()` returns `<domain>/portal` (`portal-url.ts:65-67`) — the
resulting `shareUrl` points at a page (`/shared-documents/:token`) that does not exist
yet anywhere in `artifacts/portal`'s routing (confirmed by grep) — the same known,
already-documented pre-scaffolding gap `docs/documents-contract-pack.md` covers for its
own share flow, not a new finding.

---

## 3. Real enum unions

- **Document status** (`msp_documents.status`, `msp.ts:833`): `"draft" | "active" |
  "archived"`. §1.2's `status` query filter silently ignores any value outside this
  set (no 400) — an invalid filter is a no-op, not an error.
- **Document pipeline status** (`DOC_PIPELINE_STATUSES`, `msp.ts:810-820`, shared by
  both `msp_documents.pipeline_status` and `msp_document_versions.pipeline_status`):
  `"pending" | "html_stored" | "pdf_generating" | "pdf_ready" | "sharepoint_uploading" |
  "sharepoint_uploaded" | "version_registered" | "published" | "failed"` — 9 values,
  the real sequence §1's pipeline steps a document/version through. `"failed"` is a
  real terminal value in the type, but **no node handler in `doc-pipeline-nodes.ts`
  ever sets it** (grep confirms — every handler either succeeds and advances the
  status or throws, and the workflow-engine's own retry/failure path, outside this
  pack's scope, is what would apply it, not visible in either route file).
- **Document owner type** (`msp_documents.owner_type`, `msp.ts:830`): `"customer" |
  "msp" | "platform"` — only `"customer"`/`"msp"` are ever written by §1.1 (derived
  from whether `customerId` was supplied); nothing in this pack ever writes
  `"platform"`.
- **SharePoint connector mode** (`MSP_SHAREPOINT_CONNECTOR_MODES`, `msp.ts:776`):
  `"platform" | "msp_owned"`.
- **Generated-document category** (`insights_generated_documents.category`,
  `schema/index.ts:2447`, owned by the sibling Portal pack, read-only here):
  `"report" | "consulting"`. §2.2's `category` query param is cast to this union with
  no runtime validation — an arbitrary string silently produces zero matches (no rows
  will ever equal an invalid cast value) rather than a 400.
- **Generated-document status** (`insights_generated_documents.status`,
  `schema/index.ts:2452`, read-only here): `"draft" | "approved" | "delivered" |
  "archived" | "generating" | "failed"` — §2.5/§2.6 each independently gate a subset
  of these (see §1's per-route breakdown above), not the full union.
- **MSP role hierarchy** — `ROLE_ORDER` (`requireAuth.ts:80-88`), lowest to highest:
  `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin <
  PlatformAdmin`. Every `requireRole(x)` call across both files is a minimum-tier gate
  against this order, not the separately-declared `MSP_ROLES` array's own order.

---

## 4. Pipeline stage detail (`doc-pipeline-nodes.ts`)

All 7 nodes are documented idempotent by the file's own header comment (`:15`) and each
node's own doc comment confirms a real mechanism, not just an assertion:

- **`doc_store_html`** (`:174-261`) — dedupes on `contentHash` (SHA-256 of the raw
  HTML): re-submitting identical content for the same document returns the existing
  `versionId` rather than inserting a duplicate version (`deduplicated: true`).
- **`doc_generate_pdf`** (`:276-344`) — **text-only rendering via `pdf-lib`**, not a
  real HTML→PDF engine. `stripHtml()` (`:37-56`) regex-strips all tags/style/script and
  converts block-level closes to newlines; `generatePdfFromText()` (`:82-159`)
  word-wraps and paginates the resulting plain text into a fixed-margin Helvetica PDF
  with a page-footer. The file's own comment says so explicitly (`:273-274`): "For full
  HTML fidelity, configure playwright-core with a Chromium browser path and replace the
  render call" — this is documented as a stopgap, not a hidden defect, but Design
  should know a "branded PDF" today is genuinely plain black-Helvetica-on-white text,
  with no CSS/images/tables preserved from the source HTML.
- **`doc_save_sharepoint`** (`:358-522`) — resolves the target site ID from the
  document's own `connectorMode`/`connectorId` (`msp_owned`) or falls back to a
  platform-wide `sharepoint_hub_site_id` row in the `settings` table (`platform`
  mode) — **throws** if neither resolves (`"no SharePoint site ID available"`), a hard
  pipeline failure, not a silent skip. Dedupes twice: once on the version already
  carrying a `sharepointFileId` (full skip), once on content-hash match across *any*
  version of the same document (reuses the existing file rather than re-uploading
  identical bytes).
- **`doc_register_version`** (`:531-571`) — promotes the version to
  `mspDocuments.currentVersionId`, the field §1.3/§1.7 both read.
- **`doc_publish`** (`:583-632`) — **idempotent by an explicit check**
  (`status === "active" && publishedAt` → early return with `alreadyPublished: true`),
  unlike §1.7's manual publish route, which has no equivalent guard.
- **`doc_audit_export`** (`:641-672`) — emits a `msp.document.exported` event via
  `dispatchEvent()`; **best-effort, non-fatal** — a dispatch failure is caught and
  logged as a warning, never thrown, so a broken event bus cannot fail the pipeline.
- **`doc_cleanup`** (`:681-685`) — a documented no-op today ("included for pipeline
  completeness and future temp-file cleanup").

**The graph is strictly linear, no branching, no conditions** —
`start → store_html → generate_pdf → save_sp → register_version → publish → audit →
cleanup` (`DEFAULT_DOC_PIPELINE_GRAPH`, `:708-728`). `topoSort()`
(`portal-workflow-engine.ts:236-269`) executes every reachable node in dependency
order; `PortalWfEdge.condition` is a declared optional field on the edge type
(`portal-workflow-engine.ts:78`) but **is never read anywhere in the engine** (grep for
`.condition` across the file finds one unrelated match, a `conditions` filter-array
variable in an unrelated query builder) — a dead field on the type, not wired to
anything that would let a graph branch. See §6 for what this means for `autoPublish`.

---

## 5. Honest-empty / partial-data contract

- **Header (all 4 tables)**: `msp_documents`, `msp_document_versions`,
  `msp_sharepoint_connectors`, `insights_generated_documents` are all genuinely
  0-row locally — an honest zero-state, not a fixture. The MSP-console UI's first
  real action against this environment will be a real `POST /api/msp/documents`, not a
  replay of pre-seeded data.
- **§2.2's empty-book short-circuit** (`:98-101`, `:127-130`) is itself honest: an MSP
  with no bridge rows, or a scoped staff member with none of their assigned customers
  eligible after filtering, gets `{ documents: [], total: 0 }` immediately — no query
  runs against a set known to be empty.
- **§1.7's publish route is not idempotent-guarded** — re-publishing an already-active
  document silently succeeds again with a fresh `publishedAt`, unlike the pipeline's
  own `doc_publish` node (§4), which explicitly detects and reports
  `alreadyPublished: true`. Two different code paths reach the same field with two
  different idempotency postures — Design should know a UI "Publish" button hit twice
  in a row (manual route) behaves differently from the pipeline auto-publishing twice
  (node), even though both ultimately write the same `status`/`pipelineStatus`/
  `publishedAt` fields.
- **§1.1/§1.4's `202` responses are a real async contract, not a synchronous
  success/failure.** `executeRun(runId)` is fired with `void` — deliberately
  unawaited — so a `202` means only "the pipeline started," never "the document is now
  published" or even "the HTML was stored." A caller must poll
  `GET /api/msp/documents/:documentId` (§1.3, reading `pipelineStatus`) or
  `GET .../versions` (§1.5) to observe real progress; there is no push/webhook
  notification in this pack.

---

## 6. Open gaps — NOT decided (flag, do not resolve)

1. **`autoPublish` is a dead request field — real, confirmed, filed.** `POST
   /api/msp/documents` accepts `autoPublish` (default `false`, `:84`) and threads it
   into the workflow run's `inputPayload` (`:138`); `POST .../versions` hardcodes
   `autoPublish: false` in its own input payload (`:302`). **Neither value is ever
   read by anything** — `DEFAULT_DOC_PIPELINE_GRAPH` has no conditional edge (§4,
   `PortalWfEdge.condition` is declared but never evaluated), and `handleDocPublish`
   (`doc-pipeline-nodes.ts:583-632`) never inspects `ctx.input["autoPublish"]`. Every
   document submitted through this pipeline runs the full graph to `doc_publish` and
   is unconditionally published — the flag has zero effect on real behavior in either
   direction; passing `autoPublish: true` changes nothing (it was already going to
   publish), and passing `autoPublish: false` (the default) does not skip publishing
   as its name implies. Filed as **#2724** (sibling sub-issue of #2569, `bug`).
2. **All 15 routes are orphaned today** (§0.1) — expected pre-Design/pre-scaffolding
   state, not a defect. `artifacts/msp-console` doesn't exist and `Design/msp-console/`
   has no export yet.
3. **No test coverage exists for either route file** (header) — unlike the sibling
   offboarding pack's `msp-portal.test.ts` backing, `msp-documents.ts` and
   `msp-documents-hub.ts` have zero automated tests today. Restated here as a known
   gap, not separately filed — test-writing for `artifacts/api-server` route files is
   ordinary follow-on build work, not a standalone finding under this project's bar.
4. **§2.2's pagination is in-memory over the full filtered set** (§2.2) — correct at
   today's zero row count, a real scaling question once a book has a large document
   history. Not filed — no evidence yet this has ever actually been hit in a live
   book, and the fix (SQL-level `LIMIT`/`OFFSET` with a separate `COUNT(*)`) is
   ordinary follow-on optimization work once/if it is.
5. **`doc_generate_pdf`'s PDF rendering is plain-text-only** (§4) — a documented
   stopgap in the code's own comment, not a hidden defect, but a real fidelity gap
   Design should account for: no CSS, images, or tables survive from the source HTML
   into the "branded PDF."
6. **`DOC_PIPELINE_STATUSES` includes `"failed"` with no writer** (§3) — declared in
   the enum, never assigned by any handler in this pack. Whatever failure path the
   underlying workflow engine's retry/error handling uses (outside `doc-pipeline-nodes.ts`
   and `msp-documents(-hub).ts`, not audited here) is the real source of that value if
   it is ever written at all — not confirmed one way or the other by this pack's scope.

---

## 7. The forbidden list — declared, not merely absent

1. **§1.8's DELETE never deletes a connector row** — soft-delete only
   (`isActive: false`). No `DELETE` statement exists anywhere in either route file.
2. **`clientSecretPlain` is never returned by any route** — §1.8's GET/POST/PATCH all
   explicitly project it out of every response; only `clientSecretRef` (a Key Vault
   *name*, not a secret) is ever echoed back.
3. **`clientSecretPlain` cannot be *written* in production** — hard 400 on POST
   (`:559-562`), silently dropped (not applied, not erroring) on PATCH (`:650-652`).
4. **§1.3/§1.5 never return a version's real `content`** — both explicitly strip or
   project it out; only §1.6 (`GET .../versions/:versionId`) returns real HTML.
5. **No route resets `pipelineStatus` back to `"pending"` except starting a brand-new
   version pipeline run** (§1.1, §1.4) — there is no "retry from here" action against
   an already-in-progress or failed pipeline in either route file.
6. **§2's hub never writes to `insights_generated_documents`** — confirmed by the
   file's own header comment and by reading every route: all four are pure reads
   except §2.6, which writes only to `quick_win_result_shares`.

---

## 8. Cross-surface edges

- **`insights_generated_documents` is shared, read-only ground with
  `docs/documents-contract-pack.md`.** §2's entire hub is a second, MSP-staff-scoped
  read/share surface over the same table and the same `quick_win_result_shares`
  share mechanism the customer-facing Portal pack already documents field-by-field —
  this pack does not re-derive that table's own schema/enum details, it only cites the
  fields §2.2's response actually surfaces.
- **`msp_sharepoint_connectors` bridges §1's pipeline and §1.8's CRUD.** The
  `doc_save_sharepoint` node (§4) reads the exact same table §1.8 writes —
  a connector deactivated via §1.8's soft-DELETE (`isActive: false`) is still
  resolvable by connectorId in `doc_save_sharepoint`'s lookup (`:415-420` selects by
  `connectorId` alone, with **no `isActive` filter**) — a document already configured
  with a since-deactivated connector will still attempt to use it on its next pipeline
  run rather than failing fast. Not filed as a finding here (no evidence this has been
  hit — zero connectors exist in this environment), but Design/QA should know
  deactivating a connector does not retroactively block documents already pointed at
  it.
- **`msp.document.exported`'s severity is unclassified**, the same pattern already
  filed under #2510 (cited by the sibling offboarding pack) for a different event
  type — `msp-portal.ts`'s `/msp/events` severity derivation only special-cases
  `error.*`/`msp.cancellation*` (critical) and `signal.*`/`msp.offboarding*`
  (warning); `msp.document.exported` (§4) matches neither prefix and would render at
  the default `info` severity if a future MSP-console events view ever surfaces it.
  Not re-filed — restated so whoever builds that view knows.
- **`resolveBillingMspId()` (ai-billing.ts) governs pipeline billing attribution**,
  not `resolveMspIdStrict()` — §1.1/§1.4 both use the billing-specific resolver
  (`impersonatedMspId ?? mspId`) for the workflow run's `tenantContext.mspId` while
  every authorization/scoping check in this pack uses the plain
  `resolveMspIdStrict()`. An impersonation session is billed against the impersonated
  MSP but authorized against the impersonator's own session claim — a real, deliberate
  split already used elsewhere in this codebase (comment at `:128-129` cites it
  explicitly), not new to this Feature.

---

## 9. Provenance

Extracted 2026-09-03 against branch `agent/2645-q1415`, a new pack (no prior version of
this MSP-console-scoped Documents surface existed — `docs/documents-contract-pack.md`,
part of #1658/#2449, is the sibling customer-facing pack, not superseded or replaced by
this one). Full read of all 15 routes across `msp-documents.ts` (`:1-702`) and
`msp-documents-hub.ts` (`:1-333`), the Drizzle schema (`msp.ts:776-886`,
`schema/index.ts:2420-2477, 2794-2810`), all 7 pipeline node handlers plus
`DEFAULT_DOC_PIPELINE_GRAPH` (`doc-pipeline-nodes.ts:1-729`), the workflow engine's
`topoSort`/edge model (`portal-workflow-engine.ts`, targeted read), the SharePoint
connector library (`sharepoint-connector.ts:1-338`), auth middleware
(`requireAuth.ts:80-93, 205-221, 349-361`), `resolveMspIdStrict()`
(`resolve-msp-id.ts:75-77`), `resolveBillingMspId()` (`ai-billing.ts:73-78`),
`getMspPortalBaseUrl()` (`portal-url.ts:65-67`). Live DB state confirmed via direct
`psql` against local `DATABASE_URL`: all 4 tables 0 rows. Consumer sweep
(`grep -rln "msp/documents\|msp/sharepoint-connectors"`) across `artifacts/portal`,
`artifacts/admin-panel`, `artifacts/msp-website` found zero callers; confirmed
`artifacts/msp-console` does not exist and no test file exists for either route file.
Real finding filed: **#2724** (`autoPublish` dead field, §6.1), sibling sub-issue of
#2569, labeled `bug`. No other gap in §6 met this project's finding bar — each either
restates an already-filed pattern (#2510) or is an expected pre-Design/
pre-scaffolding/pre-scale state, not a newly confirmed defect. Read-only pass: no
product code, schema, or UI was changed.

# Documents (Portal) — contract extraction pack

**Issue:** #2449, part of #1658 ("Feature: Documents (Portal)"), part of #1485 (EPIC:
Portal). Method per #1642. Extracted, not authored — every field below traces to one
of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

All three endpoint groups named in #2449's Step 1 were confirmed real and live in the
current codebase before any of this was written — all three live in the same file:

- `GET /api/portal/reports` — `portal-documents.ts:43`
- `GET /api/portal/insights-documents` (+ `/:id/view`, `/:id/pdf`) — `portal-documents.ts:54, 92, 126`
- `POST /api/portal/documents/:id/share`, `GET /api/portal/reports/:id/download` — `portal-documents.ts:222, 394`

**All are currently orphaned — no live frontend consumer.** `artifacts/msp-portal`
(the old portal-v2 codebase that used to call these) was retired wholesale on
2026-08-29 (`f40438cdc`, preserved at tag `portal-archive-2026-08-29`); the
replacement `artifacts/portal` scaffold under #1485 has exactly one real route
(`/`, `App.tsx:54-55`) and no page calling any of these routes yet, and no
`Design/portal/` export exists for Documents. That is real, current state, not a gap
this pack invents — Design has a real, live backend to design against, with zero
frontend debt to carry over.

Two public (unauthenticated, share-token-gated) sibling routes on the same router are
also in scope, since they serve the same `insights_generated_documents` data through a
document-share flow this Feature owns:

- `GET /api/public/documents/:shareToken` — `portal-documents.ts:286`
- `POST /api/public/documents/:shareToken/doc-views` — `portal-documents.ts:351`

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-documents.ts` — all 8 routes
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveSiblingUserIds()`, the
  multi-login scoping bridge
- `artifacts/api-server/src/lib/sow-pricing.ts` — `stripStagedForReviewBanner()`
- `artifacts/api-server/src/lib/portal-url.ts` — `getMspPortalBaseUrl()`,
  `buildPrintDocumentUrl()`
- `artifacts/api-server/src/lib/insight-pdf.ts` — `buildHtmlDoc()`, `htmlToPdf()`,
  `renderLiveDocumentToPdf()`
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser` shape
- `lib/db/src/schema/index.ts` — `reportsTable`, `insightsGeneratedDocumentsTable`,
  `quickWinResultSharesTable`, `presentationDocViewsTable`, `printTokensTable`,
  `documentTypesTable` (real column/enum sources)
- `artifacts/portal/src/App.tsx` — comparison surface for §4's live-PDF finding
  (the current portal scaffold's real route list)

---

## 1. Wire contract — `GET /api/portal/reports`

Auth: `requireAuth` (`:43`) — any authenticated login, not role-gated further.

No query params. Response: `Report[]` (full row, no field projection, `:47-50`).

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `reports.id` |
| `clientUserId` | `number` | not null | `reports.client_user_id` |
| `projectId` | `number \| null` | nullable | `reports.project_id` |
| `title` | `string` | not null | `reports.title` |
| `period` | `"weekly" \| "monthly" \| "executive_summary" \| "other"` | not null, defaults `"monthly"` | `reports.period` |
| `filename` | `string` | not null | `reports.filename` — the on-disk name under `UPLOADS_BASE/reports/` |
| `mimeType` | `string \| null` | nullable | `reports.mime_type` |
| `sizeBytes` | `number \| null` | nullable | `reports.size_bytes` |
| `reportDate` | `string \| null` (ISO) | nullable | `reports.report_date` |
| `createdAt` | `string` (ISO) | not null | `reports.created_at` |

Scoping (#1397): `inArray(reports.client_user_id, resolveSiblingUserIds(userId))`
(`:46-48`) — bridged across every login of the customer account, the correct pattern
(not the single-`eq` mistake §4 of the Customer Home pack found on the timeline
route).

Sort: `desc(createdAt)` — newest first, no pagination.

---

## 2. Wire contract — `GET /api/portal/insights-documents`

Auth: `requireAuth` (`:54`) — same as §1, not role-gated to `CustomerUser`.

No query params. Response: a field-projected array (`:60-84`), **not** the full row —
`htmlContent` is deliberately excluded from the list payload (only the two
detail/download routes below return it):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `insights_generated_documents.id` |
| `title` | `string` | not null | `insights_generated_documents.title` |
| `category` | `"report" \| "consulting"` | not null, defaults `"report"` | `insights_generated_documents.category` |
| `docType` | `string` | not null, defaults `"other"` | `insights_generated_documents.doc_type` — free text, real vocabulary is `document_types.key` (§3) |
| `status` | `"draft" \| "approved" \| "delivered" \| "archived" \| "generating" \| "failed"` | not null, defaults `"draft"` | `insights_generated_documents.status` |
| `deliveredAt` | `string \| null` (ISO) | nullable | `insights_generated_documents.delivered_at` |
| `createdAt` | `string` (ISO) | not null | `insights_generated_documents.created_at` |
| `sowTotalPrice` | `number \| null` | nullable | `insights_generated_documents.sow_total_price` (parsed SOW pricing) |
| `projectId` | `number \| null` | nullable | `insights_generated_documents.project_id` |
| `projectTitle` | `string \| null` | nullable | left-joined `projects.title` — `null` if `projectId` is null or the project row is gone |

Scoping (#1397): `inArray(insights_generated_documents.customer_id,
resolveSiblingUserIds(userId))` (`:59, 77`) — **correctly bridged**, unlike the
`customerId`-vs-`mspCustomerId` gap the schema's own comment warns about
(`index.ts:2416-2437`): `customerId` here is a `users.id`-shaped "owner" column, but
because the query fans out across every sibling login first, a document owned by any
login of the same tenant is still found. This route does not use `mspCustomerId` (the
tenant-owning column) at all — it doesn't need to, since the sibling-login bridge
already achieves the same coverage for this specific list.

Row filter (`:75-82`): `status = "delivered"` **or** `docType = "scoped_sow"` — a
`"draft"`/`"approved"`/`"archived"`/`"generating"`/`"failed"` document is excluded
from the list *unless* it is a `scoped_sow`, which is deliberately shown pre-delivery
(the SOW review/approval flow needs the customer to see it before it's formally
`"delivered"`).

Sort: `desc(createdAt)` — newest first, no pagination.

### 2a. `GET /api/portal/insights-documents/:id/view`

Auth: `requireAuth`. 400 on non-numeric `:id` (`:96`). 404 if the row doesn't exist
(`:108`). 403 if the row's `customerId` isn't in the requester's sibling set (`:111`).
403 `{ error: "Document not yet delivered" }` unless `status = "delivered"` or
`docType = "scoped_sow"` (`:112`) — same gate as the list filter, applied per-document
here. 409 `{ error: "This report renders live and has no stored HTML to view here"
}` if `docType` is one of the 7 `LIVE_RENDERED_DOC_TYPES` (§3) — those documents have
no server-stored HTML representation to serve through this route by design.

Response: `{ id, title, htmlContent }` — `htmlContent` run through
`stripStagedForReviewBanner()` (`:117`), which strips a "Staged for Review" banner
`<div>` if present (matches on a ⚠️ or 📋 leading marker, `sow-pricing.ts:112-114`).

### 2b. `GET /api/portal/insights-documents/:id/pdf`

Auth: `requireAuth`. Same 400/404/403-ownership gates as §2a, but the delivery gate is
looser: `status in ("approved", "delivered")` (`:149`) — an *approved-but-not-yet-
delivered* document (shown in the presentation portal) can be downloaded as a PDF,
unlike `/view` which requires full `"delivered"`.

Two distinct rendering paths, branching on `LIVE_RENDERED_DOC_TYPES` (§3):

- **Live-rendered doc type** (`:150-199`) — see §4, the finding: mints a single-use
  `print_tokens` row (`expiresAt` = now + 2 min, `:168-177`), builds a print URL
  (`buildPrintDocumentUrl(mspSlug, doc.id, printToken)` →
  `{portalBase}/{slug}/copilot-readiness/documents/{id}?printToken=...`, `portal-url.ts:107-109`),
  and calls `renderLiveDocumentToPdf(printUrl)` (Playwright/Chromium screenshot-to-PDF
  of that live page, `insight-pdf.ts:254-291`) rather than converting stored HTML.
  502 `{ error: "Could not render this report to PDF right now — please try again"
  }` if that navigation/render throws (`:183-186`).
- **Stored-HTML doc type** (`:201-215`) — `stripStagedForReviewBanner(htmlContent)`
  → `buildHtmlDoc()` → `htmlToPdf()` (a direct HTML-to-PDF conversion, no browser
  navigation).

Both paths respond `Content-Type: application/pdf`, `Content-Disposition: attachment;
filename="<sanitized-title>.pdf"` (title sanitized to `[a-zA-Z0-9 _-]`, spaces →
hyphens, truncated to 80 chars, `:189-192, 206-209`).

### 2c. `POST /api/portal/documents/:id/share`

Auth: `requireAuth`. Same 400/404/403-ownership gates as §2a/§2b. Share-eligibility
gate: `status in ("approved", "delivered")` **or** `docType = "scoped_sow"` (`:242`) —
a third distinct variant of the delivery gate (§2a requires `"delivered"` alone; §2b
allows `"approved"`+`"delivered"`; this one adds the `scoped_sow` carve-out from §1's
list filter on top of §2b's pair).

Side effects: deletes any existing `quick_win_result_shares` row for **this specific
document** (`shareKind = "document"`, `documentId = id`, `:249-255`) — scoped
per-document, not per-client, so re-sharing one document never invalidates a
colleague's still-valid link to a different document. Inserts a new share row with a
32-byte random token, `expiresAt` = now + 30 days (`:257-268`).

Response: `{ shareUrl, expiresAt }` — `shareUrl` = `{getMspPortalBaseUrl()}/shared-documents/{shareToken}`.

### 2d. `GET /api/public/documents/:shareToken`

**No auth** — gated entirely by knowledge of the share token. 400 if the token param
is empty. 404 if no `quick_win_result_shares` row matches
`(shareToken, shareKind="document")`, or if it matches but `documentId` is null
(`:307`). 410 `{ error: "This share link has expired" }` if `now() > expiresAt`
(`:308`). 404 again if the referenced document row is gone (`:320`).

Response: `{ title, htmlContent, docType, expiresAt }` — `htmlContent` run through the
same `stripStagedForReviewBanner()` as §2a. **No `LIVE_RENDERED_DOC_TYPES` check on
this path** — a shared live-rendered document (stale/absent stored HTML, see the
`LIVE_RENDERED_DOC_TYPES` comment at `:18-37`) would serve whatever is in
`htmlContent` with no 409 guard, unlike §2a. Flagged for Design awareness, not filed
as a standalone bug — a `scoped_sow`-only sharing UI (the realistic near-term use of
this route) never hits a live-rendered `docType` in practice, but the route itself
has no code-level guarantee against it.

Side effects (fire-and-forget, errors swallowed, `:323-332`): increments
`quick_win_result_shares.view_count`, inserts a `presentation_doc_views` row
(`presentationId: null`, `eventType: "view"`).

### 2e. `POST /api/public/documents/:shareToken/doc-views`

**No auth.** Body: `{ dwellSeconds: number }` — 400 if missing, non-numeric, or
negative (`:355-358`). Same token/expiry gates as §2d (`:360-372`). Inserts a
`presentation_doc_views` row (`eventType: "dwell"`, `dwellSeconds` rounded,
`documentTitle` looked up fresh, not trusted from the client, `:374-385`). Responds
`204` with no body. Mirrors the existing `/portal/presentations/:id/doc-views` dwell
route (comment at `:346-349`) — same event shape, so admin analytics reading
`presentation_doc_views` by `documentId` see consistent data from either entry point.

---

## 3. Real enum unions

- **Report period** — `reports.period`: `"weekly" | "monthly" | "executive_summary" |
  "other"` (`index.ts:725`), all 4 real, no route-level filtering — `/portal/reports`
  returns every period value as-is.
- **Generated document category** — `insights_generated_documents.category`:
  `"report" | "consulting"` (`index.ts:2440`), unfiltered by any route in this pack.
- **Generated document status** — `insights_generated_documents.status`: `"draft" |
  "approved" | "delivered" | "archived" | "generating" | "failed"` (`index.ts:2445`).
  See §2 for which routes gate on which subset — three different subsets across four
  routes (list: `delivered ∪ scoped_sow`; view: `delivered ∪ scoped_sow`; pdf/share:
  `approved+delivered`, share additionally `∪ scoped_sow`).
- **Generated document type (`docType`)** — free `text`, no DB-level enum
  (`index.ts:2441`). The real, current vocabulary is `document_types.key`
  (`documentTypesTable`, `index.ts:330-345`) — a DB-backed lookup table (label,
  category, section structure per key), not a hardcoded list. 7 of these keys are
  additionally distinguished at the application level as
  `LIVE_RENDERED_DOC_TYPES` (`portal-documents.ts:29-37`, kept in sync by hand with
  `JOURNEY_LIVE_DOCUMENTS` in the old, retired `msp-portal`'s
  `journeyTokens.ts` — see §4 for why that cross-app sync target no longer exists):
  `copilot_readiness`, `security_posture_report`, `governance_maturity_report`,
  `compliance_alignment_report`, `license_optimization_report`, `adoption_report`,
  `operational_health_report`.
- **Share kind** — `quick_win_result_shares.share_kind`: `"quick_win_scores" |
  "document"` (`index.ts:2793`). Every route in this pack only reads/writes
  `shareKind = "document"`; `"quick_win_scores"` is a sibling feature's share kind,
  out of scope here.
- **Presentation doc view event type** — `presentation_doc_views.event_type`: free
  `text`, default `"dwell"` (`index.ts:2778`, no DB enum). This pack's routes only
  ever write `"view"` (§2d) or `"dwell"` (§2e) — the two values a route comment
  (`:346-349`) confirms are the real, complete vocabulary in current use.

---

## 4. Finding — the live-rendered-document PDF export navigates to a route that no longer exists

**`portal-documents.ts:126-220`'s PDF export for `LIVE_RENDERED_DOC_TYPES` documents
builds a print URL via `buildPrintDocumentUrl()`
(`portal-url.ts:107-109`) → `{getMspPortalBaseUrl()}/{slug}/copilot-readiness/documents/{id}?printToken=...`,
then hands that URL to `renderLiveDocumentToPdf()` (`insight-pdf.ts:254-291`), which
navigates a headless Chromium tab there and waits for `[data-print-ready="true"]` to
appear before printing to PDF (`insight-pdf.ts:272`, 20s timeout).**

That route pattern — `/{slug}/copilot-readiness/documents/{id}` — only ever existed
in `artifacts/msp-portal`, which was retired wholesale on 2026-08-29 (`f40438cdc`,
tag `portal-archive-2026-08-29`). The replacement `artifacts/portal` scaffold has
exactly one real route registered, `/` (`App.tsx:54-55`) — every other path,
including this one, falls through to `NotFound` (`App.tsx:55`). `NotFound` never
renders a `[data-print-ready="true"]` marker.

Consequence: **every PDF export request for one of the 7 `LIVE_RENDERED_DOC_TYPES`
documents (`copilot_readiness`, `security_posture_report`,
`governance_maturity_report`, `compliance_alignment_report`,
`license_optimization_report`, `adoption_report`, `operational_health_report`) is
currently broken** — `page.waitForSelector` times out against the 404 page, throws,
and the route correctly reports it as a 502 (`:183-186`) rather than silently
returning a wrong PDF, but the *feature* itself cannot succeed for any tenant today.
The stored-HTML PDF path (§2b, non-live doc types) and the `/view` HTML path (§2a,
also 409-blocked for live types) are unaffected — this is isolated to the one
Chromium-navigation branch.

The sibling `buildLiveDocumentPrintUrl()` (`portal-url.ts:119-121`, used by
`live-document-pdf.ts`/`live-document-shares.ts`, out of scope for #2449's named
endpoint list but sharing the same dead route pattern) is affected the same way and
is called out here for completeness, not analyzed further in this pack.

Filed as #2507, sibling of this issue's own Feature parent #1658, labeled `bug`.

---

## 5. Honest-empty / partial-data contract

- **`GET /api/portal/reports`**: a customer with zero reports gets a real `[]` — no
  fixture branch exists in this route. No distinct error path is coded beyond
  whatever a DB failure would throw uncaught (this route has no `try/catch`, unlike
  every other route in the file — a DB error here 500s via Express's default error
  handler, not a route-authored JSON error body). Flagged for awareness, not filed —
  low severity, consistent with every other route in the file having explicit
  `try/catch` + JSON error bodies except this one.
- **`GET /api/portal/insights-documents`**: same shape — genuinely empty is a real
  `[]` (`:85`); a caught DB error returns `500 { error: "Failed to fetch documents" }`
  (`:87-88`). Two distinguishable states, no third "loading" state server-side.
- **`GET /api/portal/insights-documents/:id/pdf`**: the live-render path's 502 (§4) is
  itself an honest, distinguishable failure state — a caller can tell "this document's
  live render is currently broken" apart from a 403 (not yours), 404 (doesn't exist),
  or 409 (wrong `docType` for `/view`). It's an honest signal of a real, currently-
  always-true failure (§4), not a fixture masking it.
- **`GET /api/public/documents/:shareToken`**: 404 (link not found / document gone),
  410 (link expired), and 200 (real content) are the only three outcomes — no
  fixture/placeholder content is ever returned for a dead or expired link.

---

## 6. Cross-surface edges

- **`insights_generated_documents` reads across this pack vs. Customer Home's
  Dashboard** (`docs/customer-home-and-timeline-contract-pack.md` §1, source 4): the
  Dashboard's timeline event source scopes this same table by a **single**
  `eq(customerId, userId)` (not bridged — flagged as that pack's own §4 finding,
  #2499). This pack's list route (§2) scopes the same table correctly via
  `inArray(customerId, resolveSiblingUserIds(userId))`. The two routes read the same
  table with different (and, on the Dashboard side, incorrect) scoping — worth Design
  knowing that a document visible in `/portal/insights-documents` may not appear as a
  timeline event for a multi-login customer, independent of this pack's own finding.
- **`print_tokens` vs. the live-document-pdf sibling flow**: `portal-documents.ts`
  mints `print_tokens` rows for the numeric-id live-render path (§4); the sibling
  `live-document-pdf.ts`/`live-document-shares.ts` routes (not cited in #2449's
  endpoint list, out of scope here) use the same table for the docType-keyed variant
  (`buildLiveDocumentPrintUrl`). Both share one broken destination route (§4).
- **`presentation_doc_views` vs. `/portal/presentations/:id/doc-views`**: this pack's
  §2d/§2e write the same table with `presentationId: null`, deliberately so
  admin analytics reading this table by `documentId` see a consistent event stream
  whether a document was viewed inside a Quick Win presentation or via a direct share
  link — confirmed intentional by the route's own comment (`:280-284, 346-349`), not
  an oversight to "fix" by giving these a real `presentationId`.

---

## Orphaned-endpoint check

None of the 6 authenticated/portal routes in this pack has a live frontend caller
anywhere in the current tree:

```
grep -rn "portal/reports\|portal/insights-documents\|portal/documents" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

returns no matches. The 2 public share-viewer routes (`/api/public/documents/...`)
are likewise uncalled from any current frontend. This is expected, current state —
`artifacts/msp-portal` (the only prior caller) was retired 2026-08-29, and no
`Design/portal/` export exists yet for Documents. All 8 routes are real, none is
exercised by any live surface today; that is the honest state Design should build
against, not a gap this pack needs to close.

---

## Not covered by this pack

Per #2449 Step 3, no page/UI-shape decisions are made here. This pack extracts what
exists on the endpoints named in #2449's own Step 1 (plus the two public share-viewer
siblings that serve the same underlying data), it does not decide what a Documents
page should look like, which fields it draws, or how reports/insights-documents
should be combined into one list. `msp-documents-hub.ts` (the MSP/admin-side
documents surface) and `live-document-pdf.ts`/`live-document-shares.ts` (the
docType-keyed live-print variant) are separate routers, not part of this Feature's
named endpoint list, and are not analyzed here beyond the §4/§6 notes above.

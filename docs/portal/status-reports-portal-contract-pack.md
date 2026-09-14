# Status Reports — Customer Portal contract extraction pack

**#3889**, under Feature #3435 ("Surface MSP Console Status Reports to the customer
in Portal, read-only + comment"), phase 2 of 4 for #3435's own build order —
**architect → build the endpoints → regenerate the contract pack from the real
code → Design → wire.** Phase 1 (the endpoints) is two sibling issues, both closed
and merged before this pack was started: #3887 (customer-facing read + comment,
commits `34f7809ce` feature / `5e90f0cef`, `f8e044f2c` bookends) and #3888
(MSP-side comment view + reply, commit `5fb36f3c`). Phase 3 (Design export into
`Design/portal/`) is #3890, already filed and explicitly sequenced after this pack.
No phase-4 (wiring) issue exists yet — correct, per the fixed order; nothing wires
until #3890's Design lands.

Method per #1642. Read-only. Every field below is extracted verbatim from the two
real routers' own logic and the Drizzle schema, cited to file:line, cross-checked
live against local PostgreSQL. **Nothing here is authored or invented.** No product
code, schema, or UI was touched to produce this document.

**Scope note — this pack is the customer-facing read + comment surface only.**
The MSP-console *authoring* side of the same underlying `msp_status_reports`
object already has its own contract pack: `docs/msp-console/status-reports-
msp-console-contract-pack.md` (#3763, under Feature #3434). That pack documents
`msp-status-reports.ts`'s create/list/detail/edit/publish routes in full; this
pack does not re-derive them and cites that pack directly wherever the two share
a real dependency (the `state` enum, `reportToWire()`'s sibling function, the
`msp_status_report_comments` table both routers share).

Two backend routers, six routes total across both, all real, all reachable:

- `artifacts/api-server/src/routes/portal-status-reports.ts` (293 lines) — the
  customer-facing router this pack's §1 documents in full (Git #3887).
- `artifacts/api-server/src/routes/msp-status-reports.ts` (423 lines) — the
  MSP-operator router; only its two comment routes (added by Git #3888,
  `:317-421`) are this pack's concern, since the rest is #3763's pack's own
  territory.

Registration confirmed live in `routes/index.ts`: `portalStatusReportsRouter`
imported `:183`, mounted `:515`; `mspStatusReportsRouter` imported `:136`, mounted
`:478`.

Schema: `lib/db/src/schema/msp.ts:9599-9623` (`mspStatusReportCommentsTable` /
`msp_status_report_comments`) — the one table new to this Feature slice; the
parent `msp_status_reports` table (`:9540-9597`) is #3763's pack's own citation,
reused here read-only. Re-verified live against local PostgreSQL
(`psql "$DATABASE_URL" -c '\d msp_status_report_comments'`): the live table
matches the Drizzle source exactly — 6 columns, one index
(`msp_status_report_comments_report_id_idx`), the `author_type` CHECK constraint
(`'customer'`/`'msp'`), and both FKs (`report_id → msp_status_reports.id ON
DELETE CASCADE`, `author_user_id → users.id`).

---

## 0. A second, unrelated "status reports" concept already exists — do not conflate

**Real, load-bearing disambiguation for Design/wiring:** this codebase has TWO
independent things both plainly called "status reports," on different tables,
serving different pages, predating each other by Feature:

| | This pack's subject | The pre-existing, unrelated one |
|---|---|---|
| Table | `msp_status_reports` (Git #3762, Feature #3434) | `status_reports` (Git #1410/#1589/#1923) |
| Written from | MSP Console (`artifacts/msp-console/src/console/modules/StatusReports.tsx`) | AdminV2 (`routes/admin-retainer.ts`) |
| Read from | *(nothing yet — this Feature, #3435, still phase 2)* | `GET /api/portal/retainer` (`portal-retainer.ts:91-100,115`), rendered today in `artifacts/portal/src/pages/my-architect.tsx:326-360` under the card `data-testid="my-architect-status-reports"` |
| Wire fields | `periodLabel`, `asOfDate`, `content`, `state` (`draft`/`published`) | `title`, `period`, `clientStatus`, `executiveSummary`, `completedActivities`, `sentAt` (`portal-retainer.ts:124+`, `statusReportToWire`) |
| Scoping | `customerId` (`tenants.id`), no `clientUserId` concept | `customerId` OR `clientUserId` membership (back-compat fallback, `portal-retainer.ts:11-24`) |

The My Architect page's "Status reports" card **already ships and already reads
real data** — but it is the OTHER table. A Design pass for #3435/#3890 that
assumes an existing card can be extended, or that greps for "status report" and
finds `my-architect.tsx`, is looking at the wrong feature. This pack's subject
(`msp_status_reports` + `msp_status_report_comments`) has zero portal-side
consumers today (§4).

---

## 1. Wire contract — the customer-facing router (`portal-status-reports.ts`)

Source: read in full on `main` at pack time (2026-09-14).

Auth floor on **every** route: `requireCapability("ladder.customer-user")`
(`:112`, `:147`, `:182`, `:233`) — live-confirmed via the real
`msp_feature_role_mapping` row for this exact capability key (`psql`, pack time):
admits `Customer`, `ServiceAccount`, `MSPOperator`, `MSPAdmin`, `PlatformAdmin`.
Deliberately excludes the `Free`/assessment-only tier — status reports are
paid-engagement MSP output (file header, `:42-45`).

Scoping is `resolveCustomerId(req)` (`portal-customer-scope.ts:33-36`) — the
JWT's own `customerId` claim, never a route param, never client-overridable.
There is no `:customerId` URL segment anywhere on this router (file header,
`:11-18`).

### 1.1 `GET /api/portal/status-reports` — this customer's own reports, published only

`:110-140`. `customerId` resolved from the JWT; 403 `{ error: "No customer
identity on token" }` if absent (`:115-118`). Query:
`where customerId = :customerId AND state = 'published'`, `orderBy
desc(asOfDate)` (`:121-125`) — a draft is never returned to the customer
regardless of `customerId` match; there is no state filter param to override
this. Author names resolved in one batched follow-up query
(`inArray(usersTable.id, authorIds)`, `:127-132`), same pattern #3763's pack
documents for the operator-side list route.

Response: `{ reports: [...] }`, wire shape below (§2).

### 1.2 `GET /api/portal/status-reports/:id` — one report

`:145-175`. Non-numeric `id` → `404 { error: "Not found" }` (`:155-159`) before
any query. Resolution is `loadPublishedReportForCustomer(id, customerId)`
(`:92-105`) — a single query matching `id`, `customerId`, AND `state =
'published'` all at once, so **a foreign customer's report, an unknown id, and
a real-but-still-draft report all 404 identically** (`:161-166`) — never
confirming existence of a report this customer may not see, the exact same
discipline #3763's pack documents for the MSP-side `:id` routes, applied here
against a stricter predicate (published-only, not just ownership).

Response: `{ report: {...} }`.

### 1.3 `GET /api/portal/status-reports/:id/comments` — full two-sided thread

`:180-222`. Same `loadPublishedReportForCustomer` gate as §1.2 (`:197-201`) —
an unpublished or foreign report 404s before the comment query ever runs.
Comments query: `where reportId = :id`, `orderBy asc(createdAt)` (`:203-207`) —
**oldest-first**, the opposite sort direction from the parent report list (§1.1
is newest-first); a thread reads top-to-bottom in the order it was written.
Author names batched the same way as §1.1 (`:209-214`), across BOTH
`authorType` values in one query — a customer's own name and the MSP operator's
name are resolved identically, no branch on which side wrote it.

Response: `{ comments: [...] }`, wire shape §2 — includes both `authorType:
"customer"` and `authorType: "msp"` rows in the same array, ordered together.

### 1.4 `POST /api/portal/status-reports/:id/comments` — customer adds a comment

`:231-290`. Same `loadPublishedReportForCustomer` gate (`:254-258`) — a
customer cannot comment on a report they cannot otherwise see; this is checked
**after** body validation (`:247-251`) but **before** any insert, so a
malformed body against a foreign/draft report gets the 400, not the 404 (body
shape is checked first in source order, ownership second — confirmed by
reading `:241-258` in sequence).

Body (`createCommentSchema`, `:224-226`):

| Field | Type | Constraint |
|---|---|---|
| `body` | `string` | trimmed, 1–10,000 chars |

On success: inserts `{ reportId: id, authorType: "customer", authorUserId:
req.user!.id, body }` (`:260-268`) — `authorUserId` is always the calling
session's own id, never client-supplied, same discipline #3763's pack documents
for `authoredByUserId` on report creation. Returns `201 { comment: {...} }`
(`:284`).

**Notification on customer comment** (`:270-281`): fires `createNotification`
with `recipient: { type: "msp_user", mspUserId: report.authoredByUserId, mspId:
report.mspId }` — targets the SPECIFIC operator who authored the report, not a
tenant-wide MSP fan-out. `void`-called, best-effort (comment text, `:270-273`):
a notification delivery failure cannot fail the already-committed comment
insert. **CURRENT, not independently live-confirmed by this pack**: zero
`recipient_type = 'msp_user'` rows exist anywhere in the local `notifications`
table (`psql`, pack time) — the #3887 build's own verification note describes
"insert comment, read thread" replay but does not claim to have confirmed this
specific notification landed, and no later session appears to have exercised
this exact path either. The code path (`notification-center.ts:203-211`) reads
correct by inspection — no early return before the insert for a `msp_user`
recipient with no opt-out preference row — so this is flagged as an unverified
gap in test coverage, not a confirmed bug; a Design/wiring session that builds
against this notification should re-confirm it live rather than assume #3887's
comment covers it.

---

## 2. Wire shapes

### 2.1 `reportToWire()` — `portal-status-reports.ts:62-73`

**Deliberately narrower than the MSP-side `reportToWire()`** #3763's pack
documents (`msp-status-reports.ts:62-76`) — the customer never needs, and never
receives, three fields the operator side returns:

| Field | Type | Source | Present on MSP-side wire too? |
|---|---|---|---|
| `id` | `number` | `row.id` | yes |
| `periodLabel` | `string` | `row.periodLabel` | yes |
| `asOfDate` | `string` (ISO) | `row.asOfDate.toISOString()` | yes |
| `content` | `string` | `row.content` | yes |
| `authoredByName` | `string \| null` | resolved `usersTable.name`; `null` if unset (no synthesized fallback — same discipline #3763's pack documents) | yes |
| `createdAt` | `string` (ISO) | `row.createdAt.toISOString()` | yes |
| `updatedAt` | `string` (ISO) | `row.updatedAt.toISOString()` | yes |
| `publishedAt` | `string` (ISO) | `row.publishedAt.toISOString()` — never `null` in practice on this router, since every row reaching this shape already passed a `state = 'published'` filter | yes |
| ~~`customerId`~~ | — | omitted — the customer already knows whose report this is; would be a redundant self-referential field on every row | **no** |
| ~~`state`~~ | — | omitted — always `"published"` on anything this router returns (the query itself filters it), so the field would carry zero information customer-side | **no** |
| ~~`authoredByUserId`~~ | — | omitted — only the resolved display name is customer-facing; the raw operator user id is MSP-internal | **no** |

### 2.2 `commentToWire()` — `portal-status-reports.ts:75-84`

Byte-for-byte identical field set to the MSP-side comment wire function
(`msp-status-reports.ts:78-87`) — the two files each define their own copy
rather than sharing an import, but the shapes match exactly:

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `row.id` |
| `reportId` | `number` | `row.reportId` |
| `authorType` | `"customer" \| "msp"` | `row.authorType` — real enum, §3 |
| `authorName` | `string \| null` | resolved `usersTable.name` for `authorUserId`; `null` if unset |
| `body` | `string` | `row.body` |
| `createdAt` | `string` (ISO) | `row.createdAt.toISOString()` |

No `updatedAt` — comments are never edited anywhere in either router (confirmed
by full read of both files: no `PATCH`/`PUT` route targets
`msp_status_report_comments` in `portal-status-reports.ts` or
`msp-status-reports.ts`).

---

## 3. Real enum union

Pulled verbatim from the schema (`lib/db/src/schema/msp.ts:9607-9608`), live
CHECK-constraint-verified (see table header above):

```ts
// msp.ts:9607 — msp_status_report_comments.author_type
STATUS_REPORT_COMMENT_AUTHOR_TYPES = ["customer", "msp"] as const;
```

No third value, no `system`/`ai`-authored comment type. The parent report's own
`state` enum (`"draft" | "published"`) is #3763's pack's citation
(`msp.ts:9488-9489`); this pack's routes only ever read it as a filter
predicate (`state = 'published'`), never write it.

---

## 4. Live-data state — real rows exist, and what they show

```
psql "$DATABASE_URL" -c "SELECT count(*) FROM msp_status_reports;"   -- 1
psql "$DATABASE_URL" -c "SELECT count(*) FROM msp_status_report_comments;"  -- 1
```

Confirmed live 2026-09-14 — **not the honest-empty state #3763's pack
documented two days earlier.** Real data now exists because #3887/#3888's own
build sessions exercised it:

- `msp_status_reports` id `5`: `customerId 1`, `state 'published'`,
  `publishedAt 2026-09-12 20:22:06-04` — created and published during #3763's
  original build/verification pass.
- `msp_status_report_comments` id `2`: `reportId 5`, `authorType 'msp'`,
  `authorUserId 1`, body `"Live verification comment from #3888"`, created
  `2026-09-13 02:17:52-04` — a real leftover from #3888's own live-verification
  pass (that build's comment: *"Live-verified... hit the real endpoints with a
  signed JWT... POST a real comment → 201, row created"*). #3887's own earlier
  comment-insert test was explicitly cleaned up after (`id 1`, no longer
  present); #3888's was not — this is real local dev-database state, not
  fabricated for this pack, and not a production concern (local Postgres only).

Real notification fan-out confirmed for the MSP→customer direction (#3888's
own scope): 7 rows in `notifications` with `recipient_type = 'customer_user'`,
`link_path = '/status-reports/5'`, targeting the 7 real `role = 'client'` users
on tenant 1 (`psql`, pack time). The customer→MSP direction (#3887's own scope,
§1.4 above) has zero corresponding rows — see §1.4's own flagged note.

Every route in §1 therefore has real, non-fixture data to serve today: `GET
/api/portal/status-reports` for a tenant-1 customer session returns one real
published report; `GET .../5/comments` returns one real comment. A different
tenant's customer session still sees the honest empty states (`{ reports: [] }`,
a 404 on `/5`) — confirmed by the query predicates in §1.1–§1.2, not
separately re-run per-tenant for this pack.

---

## 5. Cross-surface edges

- **§0 above is the single most load-bearing cross-surface fact in this
  pack** — two same-named, unrelated "status reports" features. Repeat: the
  live My Architect card is the OTHER one.
- **Shares `msp_status_report_comments` with `msp-status-reports.ts`'s own two
  comment routes** (Git #3888, `:317-421`) — one table, two routers, split by
  auth ladder exactly as #3888's own issue body states ("different auth
  ladders... on different routers — same split `msp-status-reports.ts`/
  `portal-message-center.ts` already follow elsewhere in this Feature area").
  Neither router imports from the other; each defines its own
  `reportToWire`/`commentToWire` pair independently (§2 notes where the
  customer-side `reportToWire` diverges).
- **No relationship to `portal-message-center.ts`** beyond the auth-pattern
  precedent cited in this router's own file header (`:9`) — no shared table,
  no shared route prefix, no import between the two files (confirmed by
  reading both routers' import blocks).
- **`authorName`/`authoredByName` can legitimately be `null`** on either side,
  same as #3763's pack documents for the MSP-only wire — no synthesized
  fallback string anywhere in either `reportToWire`/`commentToWire` pair
  across both files.

---

## 6. The forbidden list — declared, not merely absent

1. **No draft ever reaches this router's responses.** Every read
   (`loadPublishedReportForCustomer`, and the inline `state = 'published'`
   predicate in §1.1's list query) filters on `state = 'published'` at the SQL
   level — there is no code path where a customer session can retrieve a draft
   report's content, id, or existence, regardless of `customerId` match
   (§1.1–§1.2).
2. **No cross-customer read.** `resolveCustomerId` is the JWT's own claim,
   never a route param; combined with the published-only filter, a foreign
   customer's report 404s identically to an unpublished or nonexistent one
   (§1.2).
3. **No comment edit or delete route exists anywhere in either router** for
   `msp_status_report_comments` (confirmed by full read of both files, §2.2).
4. **`authorUserId`/`authorType` are never client-supplied** on comment
   creation — `authorType: "customer"` is hardcoded in this router's insert
   (`:264`); the caller cannot post as `"msp"` through this surface no matter
   what the request body contains (the schema, `:224-226`, has no such field
   to set).
5. **No route on this router fabricates a report or comment.** Every response
   is a real, derived query; a customer with zero published reports gets an
   honest `{ reports: [] }` (§1.1), never a fixture — confirmed both by code
   reading and by the real non-empty vs. would-be-empty contrast in §4.

---

## 7. Open question this pack surfaces, not resolves

§1.4's flagged notification gap (customer→MSP-operator direction, never
confirmed live) is a real, honest observation from this read-only pass — not a
confirmed defect (the code reads correct by inspection) and not something this
pack's read-only scope can resolve by writing a test. It is recorded here so
#3890's Design pass and the eventual wiring build know to re-verify it rather
than assume parity with the MSP→customer direction's own confirmed-live
7-notification fan-out (§4).

---

## 8. Provenance

Written 2026-09-14 against `main`, for #3889, under Feature #3435 phase 2 of 4,
real-blocked on #3887 and #3888 (both closed, both merged — confirmed via `gh
issue view`, blocked_by edges cleared per this issue's own dispatch comment).
Read in full, not sampled: `portal-status-reports.ts` (293 lines), the new
comment-route additions to `msp-status-reports.ts` (`:313-421`, 423 lines
total), the schema block in `lib/db/src/schema/msp.ts:9599-9623`,
`portal-customer-scope.ts` (for the `resolveCustomerId` citation), and the
relevant sections of `notification-center.ts` (`:43-66`, `:171-282`) for §1.4's
flagged observation. Verified live against local PostgreSQL: the
`msp_status_report_comments` table's real schema confirmed to match the
Drizzle source exactly; real row counts and content for both tables (§4); the
real `msp_feature_role_mapping` row and its five allowed roles for
`ladder.customer-user` (§1); real notification row counts by
`recipient_type` (§4, §1.4). `docs/msp-console/status-reports-msp-console-
contract-pack.md` (#3763) used as both format precedent and the authoritative
citation source for everything on the MSP-operator side this pack references
rather than re-derives. No product code, schema, or UI was changed by this
pass.

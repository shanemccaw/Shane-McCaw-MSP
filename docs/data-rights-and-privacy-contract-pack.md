# Data Rights and Privacy — contract extraction pack

**Issue:** #2549 (Data Rights and Privacy: generate the contract pack from the real backend),
part of #1652 (Feature: Data Rights and Privacy (Portal)), part of #1485 (EPIC: Portal New
Design). Method per #1577. Extracted, not authored — every field below traces to one of the
files listed, cited to file:line. READ-ONLY session; no product code changed producing this
pack.

Design surface: no `.dc.html` export exists yet under `Design/portal/` for this page (checked
2026-09-03) — this pack is the input Design needs to produce one, not a page being wired.

Archived reference page: `artifacts/msp-portal/src/pages/customer-privacy.tsx` at the
`portal-archive-2026-08-29` tag (340 lines) — the last working build of this surface, preserved
per #1652's own instructions. Read for real request/response handling and edge cases, not for
markup or layout.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-privacy.ts` — `GET /api/portal/data-export`,
  `POST /api/portal/deletion-request`
- `artifacts/api-server/src/lib/data-rights.ts` — the shared deletion-request recording logic
  (audit log + admin notification email), used by both the customer self-service path here and
  the MSP-admin-initiated path in `msp-data-rights.ts`
- `artifacts/api-server/src/routes/msp-data-rights.ts` — the MSP-facing counterpart, for the
  overlap check in §6
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveSiblingUserIds`, the legacy
  cross-login scoping the export uses
- `artifacts/api-server/src/routes/portal-privacy.test.ts` — real request/response fixtures,
  used to confirm shapes and status codes below
- `artifacts/api-server/src/middlewares/requireAuth.ts` — auth failure shapes
- `lib/db/src/schema/index.ts`, `lib/db/src/schema/msp.ts` — table definitions backing every
  exported field, and the real enum sources in §3
- `artifacts/msp-portal/src/pages/customer-privacy.tsx` at `portal-archive-2026-08-29` — the
  archived page (interaction states, copy, edge cases)

---

## 1. Wire contract

### `GET /api/portal/data-export` (`portal-privacy.ts:40-272`, `requireAuth`)

No query params, no body. Resolves `req.user.id` (the requester's own account — there is no way
to export on behalf of another user from this endpoint).

**Auth failure** — no/invalid/expired token: `401 { "error": "Missing or invalid Authorization
header" }` or `401 { "error": "Invalid or expired token" }` (`requireAuth.ts:102`, `152`), before
the handler runs at all.

**404** — `req.user.id` has no row in `users`: `{ "error": "User not found" }`
(`portal-privacy.ts:52`). Genuinely defensive; a valid JWT always resolves to a real row in
practice.

**500** — any query throws: `{ "error": "Failed to generate data export" }`
(`portal-privacy.ts:269-271`), logged via `req.log.error`.

**200** — a JSON file download (`Content-Type: application/json`,
`Content-Disposition: attachment; filename="data-export-<email>-<YYYY-MM-DD>.json"`,
`portal-privacy.ts:264-267`), body:

| Field | Type | Source |
|---|---|---|
| `exportedAt` | `string` (ISO) | `new Date().toISOString()` at request time |
| `exportVersion` | `string` — literal `"2"` | bumped from `"1"` when the `currentSchema` block below was added |
| `notice` | `string` | fixed retention-notice copy, `portal-privacy.ts:240` |
| `profile` | `{ id, name, email, company, phone, createdAt }` | `users` row, `portal-privacy.ts:43-50` |
| `projects` | `{ id, title, status, createdAt }[]` | `projects` where `clientUserId IN siblingIds`, newest first |
| `documents` | `{ id, name, filename, projectId, createdAt }[]` | `documents` where `projectId IN` the sibling projects' ids — **empty array, not a query, when `projects` is empty** (`portal-privacy.ts:70-78`) |
| `invoices` | `{ id, amount, status, description, createdAt }[]` | `invoices` where `clientUserId IN siblingIds`; `amount` is presented as a `"123.45"` decimal string, converted from integer cents (`portal-privacy.ts:87-89`, Git #1610) |
| `messages` | `{ id, body, senderUserId, createdAt }[]` | `messages` where `clientUserId IN siblingIds` |
| `m365Profile` | `{ profile, updatedAt } \| null` | `client_m365_profiles` for any sibling id, `limit(1)` |
| `clientDocuments` | `{ id, filename, mimeType, createdAt }[]` | `client_documents` where `clientUserId IN siblingIds` |
| `auditActivity` | `{ actionType, entityType, createdAt }[]` | `audit_logs` where `actorUserId = req.user.id` (own id only, **not** sibling-scoped — this is "who did this", not account data), newest 500 |
| `quizResults` | `{ id, email, tier, categoryScores, createdAt }[]` | `quiz_leads` matched by the account's own `email`, all rows |
| `currentSchema` | object or `null` — see below | present only when `req.user.customerId` is a number |

**"Siblings"**: `resolveSiblingUserIds(userId)` (`tenant-signals.ts:175-184`) resolves every
portal login sharing the requester's `users.tenantId` (falls back to `[userId]` alone if the
account has no `tenantId`). Per the route's own comment (`portal-privacy.ts:54-58`), this is
deliberate — the legacy `users.id`-keyed records (projects/invoices/messages/documents/M365
profile) belong to the **customer**, not the individual login, so an export claiming to hold
"all data … for your account" has to cross every linked login. Confirmed by
`portal-privacy.test.ts` mocking `resolveSiblingUserIds` to `[id]` for the single-login case.

**`currentSchema`** (`portal-privacy.ts:134-235`) — only populated when `req.user.customerId`
(the JWT's frozen `tenants.id` claim) is a number; `null` for staff/admin accounts and
legacy-only clients (confirmed by `portal-privacy.test.ts`'s "omits currentSchema for a
legacy-only account" case). All thirteen sub-queries run in parallel (`Promise.all`,
`portal-privacy.ts:152`), each scoped to `customerId`:

| Sub-field | Fields | Source table |
|---|---|---|
| `customerProfile` | `id, name, domain, industry, status, createdAt` | `tenants` (single row, or `null`) |
| `diagnosticRuns` | `runId, packageKey, status, checksTotal, checksOk, checksError, startedAt, completedAt, createdAt` | `msp_diagnostic_runs`, all rows |
| `diagnosticFindings` | `findingId, checkKey, checkLabel, severity, title, description, recommendation, createdAt` | `msp_diagnostic_findings`, newest 2000 |
| `engineScoreHistory` | `engineKey, score, previousScore, delta, trendDirection, capturedAt` | `tenant_engine_snapshots`, newest 2000 |
| `engineScoreDailyRollup` | `engineKey, day, score` | `engine_score_daily_rollup`, newest 2000 |
| `engineBaselineHistory` | `engineKey, baselineScore, resetTriggerType, createdAt` | `engine_baseline_history`, newest 2000 |
| `signalHistory` | `signalKey, category, firedAt, resolvedAt` | `tenant_signal_history`, newest 2000 |
| `documents` (nested, same name as the legacy top-level `documents`) | `documentId, title, documentType, status, createdAt` | `msp_documents`, all rows |
| `sows` | `sowId, title, amountCents, currency, status, signerName, signedAt, signedIp, createdAt` | `msp_sows`, all rows |
| `reportRuns` | `runId, status, createdAt` | `msp_report_runs`, all rows |
| `clickwrapAcceptances` | `agreementTextSnapshot, ipAddress, acceptedAt` | `msp_customer_clickwraps`, all rows |
| `tenantConsent` | the raw `TenantConsentMap` jsonb, or `{}` | `tenants.consent` |
| `salesBundleAssignments` | `status, activatedAt, trialExpiresAt, assignedAt, revokedAt` | `msp_sales_bundle_assignments`, all rows |
| `auditActivity` (nested — **same field name as the legacy top-level `auditActivity`, different scope**: `customerId`-wide, not requester-only) | `actionType, entityType, outcome, occurredAt` | `msp_audit_logs`, newest 500 |

A side effect on every successful call: `createAuditLog` fires (fire-and-forget, `void`,
`portal-privacy.ts:253-262`) recording `actionType: "data_export_downloaded"` against the
requester — this is the audit trail the MSP-facing view in §6 reads.

### `POST /api/portal/deletion-request` (`portal-privacy.ts:277-306`, `requireAuth`)

No body. Same `req.user.id`-not-found 404 as above (`portal-privacy.ts:287`); same auth-failure
shapes; **500** on any thrown error: `{ "error": "Failed to submit deletion request" }`.

**200**: `{ "ok": true, "message": "Your deletion request has been received. We will process it
within 30 days and send a confirmation to your email address. Note: signed contracts and
invoices are retained for 7 years as required by law." }` — the literal, final response string
(`portal-privacy.ts:298-301`); confirmed verbatim by `portal-privacy.test.ts`'s 30-day/contracts
assertions. **There is no confirmation email to the requester** — only the admin notification
below. The response message's claim ("send a confirmation to your email address") describes the
*eventual* manual fulfillment step (per the runbook prose baked into the admin email, §6), not
anything this call itself sends.

The handler does not act on the request itself — it calls
`submitSelfServiceDeletionRequest(user, req.user.customerId)` (`data-rights.ts:139-146`), which:

1. Resolves the customer's current-schema footprint via `resolveCurrentSchemaSummary`
   (`data-rights.ts:45-72`) — `null` if `customerId` is undefined or has no `tenants` row,
   otherwise `{ customerId, mspId, customerName, diagnosticRuns, diagnosticFindings, sows,
   mspDocuments, engineSnapshots }` (all five counts via `COUNT(*)`, real numbers, never
   estimated).
2. Writes one `audit_logs` row: `actionType: "deletion_request_submitted"`, `actorRole:
   "client"`, `clientId: <requester's own id>`, `metadata: { requestedAt, currentSchema,
   submittedByAdmin: false }` (`data-rights.ts:99-112`).
3. Emails `process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL` (skipped entirely if neither
   is set) via `sendEmail` (`data-rights.ts:114-132`) — real HTML naming the requester, listing
   the current-schema footprint if any, and reminding the operator that CRM → Delete Client only
   clears legacy portal records, not the current-schema data. Sent over Microsoft Graph
   (`mailer.ts`'s `sendMailViaGraph`), never Resend.

**There is no request/confirmation status stored anywhere** — the audit-log write above *is* the
entire record of the request. No `deletion_requests` table, no status/lifecycle field. Confirmed
by `msp-data-rights.ts`'s own header comment (`msp-data-rights.ts:9-15`): "there is no
status/lifecycle field anywhere … fulfillment is a manual, out-of-band process."

---

## 2. CURRENT / DECIDED

| Field / action | Status | Issue |
|---|---|---|
| Data export — legacy fields (`profile`, `projects`, `documents`, `invoices`, `messages`, `m365Profile`, `clientDocuments`, `auditActivity`, `quizResults`) | **CURRENT** | — |
| Data export — `currentSchema` block (13 sub-fields) | **CURRENT**, gated on `req.user.customerId` being present | #1397 |
| Deletion request submit + audit log + admin email | **CURRENT** | — |
| Deletion request — self-service confirmation email to the requester | **DOES NOT EXIST** — only the operator gets an email; the requester only sees the synchronous 200 response | not yet assigned — flagged, see §7 |
| Deletion request lifecycle / status tracking | **DOES NOT EXIST BY DESIGN** — audit_logs is the only record; fulfillment is manual (see `msp-data-rights.ts:9-15`) | see §6 for the MSP-facing read surface |
| `docs/runbooks/data-subject-rights.md` (cited by both `data-rights.ts:14` and `msp-data-rights.ts:15` as "the full procedure") | **File does not exist in this repo** — a stale doc reference | filed, see §7 |

---

## 3. Real enum unions

Pulled directly from the Drizzle schema — no invented vocabulary. Every one of these is a field
this endpoint's `currentSchema` block or legacy block can surface:

- **`msp_diagnostic_runs.status`** — `"pending" | "running" | "completed" | "failed" |
  "partial"` (`MSP_DIAGNOSTIC_RUN_STATUS`, `lib/db/src/schema/msp.ts:3290`).
- **`msp_diagnostic_findings.severity`** — `"ok" | "info" | "warning" | "critical"`
  (`MSP_DIAGNOSTIC_FINDING_SEVERITY`, `lib/db/src/schema/msp.ts:3343`).
- **`msp_sows.status`** — `"draft" | "sent" | "signed" | "paid" | "failed" | "expired"`
  (`MSP_SOW_STATUSES`, `lib/db/src/schema/msp.ts:3444`).
- **`msp_documents.status`** — `"draft" | "active" | "archived"` (`lib/db/src/schema/msp.ts:833`).
- **`msp_sales_bundle_assignments.status`** — `"active" | "suspended" | "revoked"`
  (`MSP_BUNDLE_ASSIGNMENT_STATUS`, `lib/db/src/schema/msp.ts:3251`).
- **`msp_audit_logs.outcome`** — `"success" | "failure" | "partial"`
  (`lib/db/src/schema/msp.ts:907`).
- **`tenants.status`** — `"active" | "inactive" | "onboarding" | "archived"`
  (`lib/db/src/schema/msp.ts:228`).
- **`audit_logs.actor_role`** (the legacy audit trail, both `data_export_downloaded` and
  `deletion_request_submitted` rows) — `"admin" | "client"` (`lib/db/src/schema/index.ts:1394`).
  There is no `entityType`/`actionType` enum constraint at the DB layer — both are plain `text`;
  the only two `actionType` values this module ever writes are the two literal strings above
  (`"data_export_downloaded"`, `"deletion_request_submitted"`), enumerated explicitly as
  `DATA_RIGHTS_ACTION_TYPES` on the MSP-reading side (`msp-data-rights.ts:52`).
- **Legacy `projects.status`** — `"active" | "on_hold" | "completed"`
  (`lib/db/src/schema/index.ts:603`).
- **Legacy `invoices.status`** — `"draft" | "due" | "paid" | "overdue"`
  (`lib/db/src/schema/index.ts:750`).
- **`quiz_leads.tier`** — plain `text`, no DB enum constraint (`lib/db/src/schema/index.ts:1527`,
  defaults to `"Beginner"`). Real values are whatever the quiz scoring logic has ever written —
  do not invent a closed vocabulary for this field.

---

## 4. Honest-empty contract

**There is no fixture fallback anywhere in this backend surface** — unlike pages built on the
old `useXLive` + `*Data.ts` pattern, `portal-privacy.ts` has exactly two outcomes: a real 200
with real (possibly all-empty-array) data, or a real error status. A customer with zero
projects, zero invoices, zero messages genuinely gets `projects: [], invoices: [], messages:
[]` in the export — there is no length check anywhere that would substitute placeholder rows.

The archived page's own error handling (`customer-privacy.tsx:64-88`, `152-166`) is a real
tri-state worth carrying forward: **loading** (button shows a spinner + "Preparing export…" /
"Submitting…"), **success** (green alert / submitted-state card), **error** (red alert with the
server's own `error` string, or a generic "…Please try again." fallback if the response body
didn't parse). Nothing here is a fixture — it's real fetch-state handling around two calls that
always either succeed or genuinely fail.

---

## 5. Cross-surface: shared deletion-request logic

`lib/data-rights.ts` is deliberately the **single** place the audit-log write + admin
notification email are built (`data-rights.ts:1-16`'s own header states this explicitly), called
from two entry points that must never drift from each other:

- `submitSelfServiceDeletionRequest` — this page's `POST /api/portal/deletion-request`, actor is
  the customer themselves (`actorRole: "client"`).
- `submitAdminInitiatedDeletionRequest` — `msp-data-rights.ts`'s
  `POST /api/msp/data-rights/customers/:customerId/deletion-request`, for when a customer
  contacts the MSP directly instead of using self-service; actor is the MSP admin
  (`actorRole: "admin"`), but the audit row's `clientId` still points at the customer's own
  `users.id` so both paths bridge into the same `msp-data-rights.ts:GET /msp/data-rights`
  activity feed identically (`msp-data-rights.ts:18-26`).

`GET /api/msp/data-rights` (`msp-data-rights.ts:88-138`) is the MSP-facing read of the exact same
`audit_logs` rows this page's `POST` writes — gated `MSPAdmin`, scoped by
`resolveStaffScopedCustomerIds`, bridged from `users.id` to `tenants.id`/`customerName` via
`loadCustomerBridge`. It surfaces `actionType`, `submittedByAdmin`, `customerId`,
`customerName`, `currentSchema` (only for `deletion_request_submitted` rows), `createdAt` — i.e.
every deletion request this page's users submit is visible to their MSP as a real row, not a
private/local-only record.

**Real overlap, per #1652's own note:** #1604 (Account Security: wire data rights) covers these
exact same two endpoints from a different page (`accountSecurityModel.ts:47-49` gates the
delete-account button's type-to-confirm state; `docs/account-security-contract-pack.md:125`
already documents `POST /api/portal/deletion-request` as "Endpoint CURRENT; button on this page
is inert"). #1652 defaults to this being its own dedicated Privacy & Data surface, matching the
archived page's own structure — reversible, not a final call. **Flag for Shane's confirmation
before both surfaces ship wired independently** — if both end up live, they must call the same
two endpoints and never diverge in copy about what is/isn't retained.

---

## 6. The forbidden list — what this backend deliberately does not serve

- **No deletion-request status/lifecycle for the requester to check later.** A customer who
  submits a request has no way to look it up again from the portal — the only two states are
  "not yet submitted" and "submitted" (the archived page's own `submitted` boolean is pure local
  component state, reset on page reload). There is no `GET` counterpart on the portal side; only
  MSP staff can see the activity feed (§6 above).
- **No requester-facing confirmation email.** Only the MSP operator's `ADMIN_EMAIL` gets
  notified. The response text's promise to "send a confirmation to your email address" is
  fulfilled manually, by whoever processes the request within the 30-day window — not by any
  code in this repository.
- **No partial/selective export or deletion.** Both endpoints operate on the whole account; there
  is no way to request "just my invoices" or "just my M365 profile."
- **No automatic data erasure.** `POST /api/portal/deletion-request` never deletes a single row.
  Every actual erasure (legacy: CRM → Delete Client; current-schema: manual, by `customerId`,
  per the admin email's own instructions) is a human action outside this codebase.

---

## 7. Findings — filed, not fixed in this pack (read-only session)

- **`docs/runbooks/data-subject-rights.md` does not exist**, despite being cited as "the full
  procedure" by both `lib/data-rights.ts:14` and the admin-notification email built in
  `data-rights.ts:129` (`<code>data-subject-rights.md</code> runbook`) and referenced again in
  `msp-data-rights.ts:15`. `docs/runbooks/` currently holds only `dlq-replay.md`,
  `incident-response.md`, `key-vault-credential-rotation.md`, and
  `workflow-run-remediation.md` (checked 2026-09-03) — no `data-subject-rights.md` among them.
  Every deletion-request admin email sent today links a runbook that has never existed in this
  repo. Filed as a sibling sub-issue of #1652 (see bookend for the number).

---

## Not covered by this pack

- The MSP-facing `GET /msp/data-rights*` surface's own UI/page wiring — out of scope for this
  Feature (#1652 is the customer-facing Privacy & Data page only); only its wire contract is
  documented here (§6) for the overlap check.
- Whether #1652 and #1604 end up as one surface or two — a real product decision (§6), not
  something this pack resolves.
- The manual fulfillment procedure itself (what an operator actually clicks/runs within the
  30 days) — that lives in the (missing) runbook, not in any wire contract.

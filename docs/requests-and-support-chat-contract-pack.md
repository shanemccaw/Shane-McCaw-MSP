# Requests and Support Chat (Portal) — contract extraction pack

**Issue:** #2450, part of #1659 ("Feature: Requests and Support Chat (Portal)"), part of
#1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below traces
to one of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

All 5 endpoints named in #2450's Step 1 were confirmed real and live in the current
codebase before any of this was written, across three route files:

- `POST /api/msp/support/chat` — `support-chat.ts:454`
- `POST /api/msp/support/escalate` — `support-chat.ts:712`
- `POST /api/portal/customer/requests` — `portal-customer-requests.ts:99`
- `POST /api/portal/mission-control/remediate` — `portal-mission-control.ts:548`
- `POST /api/portal/customer/requests/:ticketId/reply` — `portal-customer-requests.ts:237`

Confirmed against the archived page's own real fetch calls (`git show
portal-archive-2026-08-29:artifacts/msp-portal/src/pages/{support-chat,customer-requests}.tsx`)
— every path above matches exactly what the deleted page called, no drift.

Three sibling endpoints on the same routes/state are also in scope, since they cannot be
honestly documented without their siblings (same discipline as `docs/offboarding-contract-pack.md`):

- `GET /api/portal/customer/requests` — `portal-customer-requests.ts:163` (the list view
  `POST /requests` and `/reply` exist to feed)
- `GET /api/portal/customer/requests/:ticketId` — `portal-customer-requests.ts:194` (the
  detail/thread view `/reply` posts into)
- `GET /api/portal/mission-control/overview` — `portal-mission-control.ts:365` (the finding
  feed `/remediate`'s offers are surfaced from; **already has a live caller** — see
  Orphaned-endpoint check)

Two more endpoints exist on the exact same action-execution lifecycle `/msp/support/chat`
proposes into, and are undocumented anywhere else — included for completeness, not part of
#2450's named 5 but unreachable without them:

- `POST /api/msp/support/actions/regenerate-document` — `support-chat.ts:759`
- `POST /api/msp/support/actions/rerun-scan` — `support-chat.ts:837`

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/support-chat.ts` — `/msp/support/chat`,
  `/msp/support/escalate`, `/msp/support/actions/regenerate-document`,
  `/msp/support/actions/rerun-scan`
- `artifacts/api-server/src/routes/portal-customer-requests.ts` — all 4
  `/portal/customer/requests*` routes
- `artifacts/api-server/src/routes/portal-mission-control.ts` —
  `/portal/mission-control/overview`, `/portal/mission-control/remediate`,
  `listRemediableOffers()`
- `artifacts/api-server/src/lib/zoho-desk.ts` — `enqueueEscalationTicket()`,
  `enqueueZohoDeskWrite()`, `resolveDeskContactIdForEmail()`,
  `listDeskTicketsForContact()`, `getDeskTicketForContact()`, `getDeskTicketThread()`,
  `handleCreateTicketJob()`
- `artifacts/api-server/src/lib/chat-content-blocks.ts` — `ChatContentBlock`,
  `buildAssistantContent()`, `contentToText()`, `parseSuggestedReplies()`
- `artifacts/api-server/src/lib/shanebot-engine.ts` — `buildGrounding()`,
  `resolveInstance()`, `assembleSystemPrompt()`, `routeRequestedActions()`,
  `routeRequestedCards()` (referenced for the propose/confirm contract, not re-documented —
  out of this pack's own scope, see §9)
- `artifacts/api-server/src/lib/config-pack-orchestrator.ts` — `ConfigPackError`,
  `runConfigPackForCustomer()`
- `artifacts/api-server/src/lib/ai-billing.ts` — `resolveBillingMspId()`
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspId()`
- `artifacts/api-server/src/lib/remediation-catalog.ts` — `resolvePackKeyForService()`
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireAuth`, `requireRole()`
- `lib/db/src/schema/index.ts` — `messagesTable`, `salesOffersTable`
  (`SALES_OFFER_STATES`), `ChatContentBlock`/`ChatMessageContent`
- `lib/db/src/schema/msp.ts` — `mspDiagnosticRunsTable` (`MSP_DIAGNOSTIC_RUN_STATUS`),
  `mspDiagnosticFindingsTable` (`MSP_DIAGNOSTIC_FINDING_SEVERITY`,
  `MSP_DIAGNOSTIC_FINDING_SOURCES`)
- `artifacts/api-server/src/routes/support-chat.test.ts`,
  `artifacts/api-server/src/routes/portal-mission-control.test.ts` — confirm the real
  behaviour cited below is under test, not just read from source
- `artifacts/portal/src/components/health-suite/useTopicHealthLive.ts` — comparison surface
  for the orphaned-endpoint check
- Archived page: `git show
  portal-archive-2026-08-29:artifacts/msp-portal/src/pages/{support-chat,customer-requests}.tsx`
  — read per #2450's own instruction, for real request/response shape and error states; not
  used as a layout/vocabulary source

---

## 1. Wire contract — `POST /api/msp/support/chat`

Auth: `requireAuth` only (`:455`) — any authenticated role passes the middleware, but
`rejectPlatformAdmin()` (`:437-449`) then hard-rejects a PlatformAdmin (`role === "admin"`
or `mspRole === "PlatformAdmin"`) with **403** `{ error: "Support chat isn't available for
PlatformAdmin." }` — even while impersonating or with a selected MSP context. So the real
effective gate is: MSPAdmin, MSPOperator, or CustomerUser only.

Request body (`:463-465`): `{ messages: Array<{ role: "user" | "assistant"; content:
ChatMessageContent }> }`. **Stateless** — the client holds and re-sends the whole
transcript every turn; the server keeps nothing between calls. **400** `{ error: "messages
array is required and must not be empty" }` if `messages` is missing, not an array, or
empty (`:467-470`). `content` may be the legacy bare `string` or the #361 structured
`ChatContentBlock[]` array (`type: "text" | "suggested_replies" | "card"`,
`chat-content-blocks.ts:96-100`) — both vintages normalize through `contentToText()`.
Only the last 20 messages are sent to the model (`:516-519`).

Grounding (`:474-508`): `resolveMspId(req)` resolves the caller's MSP context;
`resolveBillingMspId(user) ?? mspId` resolves who is billed (takes precedence under
impersonation, so a PlatformAdmin-as-MSP session bills the impersonated MSP, not the actor
— but PlatformAdmin itself is already rejected above, so this branch is effectively for a
future impersonation shape, not reachable today given the reject-first ordering). Grounded
context comes from the shared `shanebot_paid` instance's `buildGrounding()`
(`shanebot-engine.ts`, out of this pack's scope beyond citation) — on failure, degrades to
`{ identity: "platform user", summary: "Platform data temporarily unavailable." }`
(`:504-508`) rather than erroring the request.

For a `CustomerUser` with a resolvable `customerId`, `listRemediableOffers(customerId)`
(§4) also runs, in parallel with grounding (`:496-500`) — every other caller (MSP staff)
gets an empty `remediableOffers` array and the remediation-proposal system-prompt block is
never even included for them.

Calls `anthropic.messages.create()` (`model: "claude-haiku-4-5"`, `max_tokens: 1024`)
through `withAiAttribution()` (`:526-541`) — billed to `billingMspId`, `costOwner: "msp"`,
`nodeType: "chat_message"`, `feature: "support_chat"`. If `billingMspId` is `null`, the
turn is still run but logged as unattributed rather than billed to the wrong tenant
(`:542-547`). **503** `{ error: "The AI assistant is temporarily unavailable. Please try
again shortly." }` if the Anthropic call itself throws (`:550-556`).

The raw model reply is parsed for four control markers, each stripped from the
user-visible text before response (`:558-656`):

| Marker | Meaning | Re-validated against |
|---|---|---|
| `[ESCALATE_TO_HUMAN]` | Model wants to hand off to a human | nothing — always honored, triggers `escalateToAdmin()` (§3's shared helper) fire-and-forget after the response is built (`:686-696`) |
| `[PROPOSE_REMEDIATION:<offerId>]` | Model offers an instant remediation | `remediableOffers` (the SAME list computed for this turn) — a hallucinated/ineligible id is dropped silently, logged as a warning (`:567-577`) |
| `[ACTION:regenerate_document]` / `[ACTION:rerun_scan]` | Model offers a platform action | fresh DB lookup for THIS customer at response time — `findRegenerableDocument()` / `hasScanHistory()` (`:591-611`) — never trusted from the token or an earlier turn |
| `[SHOW_CARD:invoice\|subscription\|score\|data-answer]` | Model wants to show a data card | `groundedCtx.cardData` from THIS turn's own grounding (`resolveCardData()`, `:189-206`) — never fabricated, an unavailable type yields no card |

Every marker's *proposal* is "propose only" — the marker never runs anything itself; a
Confirm click from the client is required, which hits one of the two action-execution
endpoints in §5/§6 (for `[ACTION:...]`) or the remediate endpoint in §4 (for
`[PROPOSE_REMEDIATION:...]`). `[SHOW_CARD:...]`/`[ESCALATE_TO_HUMAN]` have no separate
confirm step — a card renders immediately, escalation fires immediately.

Suggested-reply chips (`parseSuggestedReplies()`, #361) are parsed the same way; a token
that parses to zero usable options is logged, not surfaced (`:637-646`).

Success response (`:698-705`):

| Field | Type | Source |
|---|---|---|
| `reply` | `string` | Visible reply text with all 4 markers stripped — legacy shape, kept for any client not yet on `content` |
| `content` | `ChatContentBlock[]` | `buildAssistantContent(visibleReply, suggestedReplies, [proposedCard] \| [])` (#361 structured shape) |
| `suggestedReplies` | `string[]` | Parsed chip options, `[]` if none |
| `escalated` | `boolean` | Whether `[ESCALATE_TO_HUMAN]` fired this turn |
| `proposedRemediation` | `{ offerId: number; offerTitle: string; packKey: string } \| null` | Re-validated remediation proposal, or `null` |
| `proposedAction` | `{ action: string; label: string } \| null` | Re-validated platform-action proposal, or `null` |

`proposedCard` (the resolved card) is **not** a top-level response field — it only appears
folded into `content`'s `card` block, if present. There is no separate `proposedCard` key
in the JSON, unlike `proposedRemediation`/`proposedAction`.

Audits `ai_support_chat` (`:665-684`) with `mspId`, `customerId`, `mspRole`, `escalated`,
`aiCostOwner: "msp"`, `aiBillingMspId`, plus the three proposal outcomes and
`suggestedReplyCount` — every turn is audited, not only escalated ones.

---

## 2. Wire contract — `POST /api/msp/support/escalate`

Auth: `requireAuth`, then `rejectPlatformAdmin()` — identical gate to §1.

Request body: `{ question?: string }` (`:716`) — optional; falls back to
`"(no question provided)"` if omitted (`:724`). No validation beyond that; an empty-string
`question` is not rejected, it is passed through as-is.

Always calls `escalateToAdmin()` (§3) with `aiReply: "(User explicitly requested human
support)"` (`:725`) — this is the **explicit** escalation path, distinct from `/chat`'s
automatic `[ESCALATE_TO_HUMAN]` fallthrough, but both funnel through the same helper and
therefore the same Zoho Desk ticket + recipient-resolution + (for CustomerUser) inbox-thread
row.

Audits `support_escalate` (`:733-739`) with `mspId`, `mspRole`, `explicit: true` — this is
the one field that actually distinguishes this route's audit rows from `/chat`'s automatic
`ai_support_chat` escalations (which carry `escalated: true` but no `explicit` field at
all).

Response (`:742`): `{ ok: true, message: "Your question has been sent to a human. You will
hear back shortly." }` — **always** this fixed shape; `escalateToAdmin()`'s own internal
try/catch (`:382, :425-427`) swallows every failure to a logged warning, so this endpoint
has no failure response path a caller can observe — a Zoho outage or a zero-recipient
resolution is invisible to the client, always reported as success.

---

## 3. Shared helper — `escalateToAdmin()` (not a route, backs §1's automatic and §2's
explicit escalation)

`support-chat.ts:373-428`. Resolves recipients via `resolveEscalationRecipients()`
(`:339-371`), the real routing table:

| Caller | Recipients |
|---|---|
| MSP staff (MSPAdmin/MSPOperator) | ALL platform admins (`usersTable.role = "admin"`) |
| CustomerUser on the platform MSP (`mspId === 1`) | ALL platform admins |
| CustomerUser on any other MSP | that MSP's active MSPAdmins (`isActive = true`, `mspRole = "MSPAdmin"` OR `canApprovePurchases = true`) |
| CustomerUser MSP with zero active MSPAdmins | falls back to ALL platform admins, with a `log.warn` |
| No resolvable `mspId` | ALL platform admins |

If **zero** recipients resolve even after fallback (only possible if the platform-admin
table itself is empty), the escalation silently no-ops — logged, nothing queued
(`:389-392`).

Queues one `zoho_desk_create_ticket` job via `enqueueEscalationTicket()`
(`zoho-desk.ts:701-706`, itself `enqueueZohoDeskWrite()` with `nodeType:
"zoho_desk_create_ticket"`) carrying the resolved recipients' emails as `notifyEmails` — the
admin-notification email is sent from the queued job's own handler
(`handleCreateTicketJob()`, `zoho-desk.ts:549`) **after** the ticket is confirmed created, so
it carries a real ticket link, never a dead-end "log in" pointer. Runs on the standard
`msp_job_queue` drain cadence (~every 5 minutes, per this file's own header comment) — an
escalation is not instant.

For a `CustomerUser`, one more write happens synchronously (not queued): a `messagesTable`
row (`:416-423`) — `clientUserId`/`senderUserId` both the customer's own `userId`,
`readByAdmin: false`, `readByClient: true` — so the escalation shows immediately in that
customer's own inbox thread. MSP-staff escalations get no such row (no inbox concept for
staff here).

---

## 4. Wire contract — `POST /api/portal/mission-control/remediate`

Auth: `requireRole("CustomerUser")` (`:549`). Body: `{ offerId: number }` (Zod-validated,
positive integer, `:524, :557-561`) — **400** with Zod's flattened error details on any
other shape.

**HARD server-side guard, testbed-only** (`:583-595`): the calling customer's
`tenants.isTestbed` must be exactly `true`, or **403** `{ error: "Instant remediation is
not available for this account" }`. This is a genuinely production-consequential route —
its downstream config-pack run performs **real Microsoft Graph writes** against the
tenant. The same guard is enforced a second, independent time inside
`runConfigPackForCustomer()` (`customer_not_testbed`, mapped back to 403 via
`CONFIG_PACK_ERROR_STATUS`, `:536`), so a UI bug that somehow bypassed this route-level
check still cannot reach a live tenant.

State/eligibility chain, each a real failure mode:

1. **404** `{ error: "Offer not found" }` — no `sales_offers` row with this `id` AND
   `customerId` (`:564-572`) — ownership-scoped, a foreign offer id 404s the same as a
   nonexistent one.
2. **409** `{ error: "Offer is not currently actionable" }` — `offer.state !== "sent"`
   (`:573-576`). Real enum: `SALES_OFFER_STATES = ["draft", "sent", "accepted", "rejected",
   "expired"]` (`index.ts:3182`) — only `"sent"` is remediable.
3. **403** testbed guard, above.
4. **400** `{ error: "This offer does not support instant remediation" }` — the offer's
   linked `services` row resolves to no `packKey` via `resolvePackKeyForService()`
   (`:597-608`) — not every offer maps to an instant-remediation config pack.

On success, calls `runConfigPackForCustomer({ packKey, customerId, triggeredBy:
"mission-control:offer:<id>:customer:<id>:user:<id>" })` (`:610-614`) and returns **202**
`{ runId: string, packKey: string, gated: boolean }` (`:631`) — `gated` reflects whether
the config-pack orchestrator itself paused the run (e.g. pending an authorization it
requires), not whether it started. Any `ConfigPackError` thrown maps through
`CONFIG_PACK_ERROR_STATUS` (`:526-545`):

| `ConfigPackError.code` | HTTP status |
|---|---|
| `pack_not_found` | 404 |
| `customer_not_found` | 404 |
| `missing_variables` | 400 |
| `concurrency_limit` | 409 |
| `pack_not_active` | 422 |
| `pack_empty` | 422 |
| `dependency_not_in_pack` | 422 |
| `dependency_cycle` | 422 |
| `customer_not_connected` | 422 |
| `customer_not_testbed` | 403 |
| `customer_write_consent_missing` | 422 |
| `tenant_domain_unresolved` | 422 |
| `change_request_not_authorized` | 403 (mapped for exhaustiveness — this route never passes a `changeRequestAuthorization`, since it is already testbed-gated, so this code cannot actually arise here) |
| `generated_secret_store_unavailable` | 503 (#1911 — Key Vault store for generated credentials not configured; fails closed rather than writing a credential to the DB) |

Audits `mission_control.instant_remediation_triggered` (`:620-629`) with `packKey`,
`customerId`, `workflowRunId`, `gated`.

---

## 5. `listRemediableOffers()` — the shared eligibility function `/chat`'s proposal and
`/remediate`'s execution both trust

`portal-mission-control.ts:284-362` (not a route — exported and imported directly by
`support-chat.ts:47`). Returns **only** offers that would pass `/remediate`'s own gate, so
a caller (here, the AI model via the system prompt) can trust every listed `offerId` is
genuinely actionable; `/remediate` still re-validates everything independently on execute
(§4) — this is never the sole gate.

```ts
interface RemediableOffer {
  offerId: number;
  offerTitle: string;
  offerRationale: string | null;
  packKey: string;
  relatedFindingTitles: string[];  // titles of latest-scan findings this offer fired against, [] if none
}
```

Chain: `[]` immediately if `tenants.isTestbed !== true` (`:292`) — same testbed gate as
§4, checked first. `[]` if no `sales_offers` rows with `state = "sent"` for this
`customerId` (`:294-299`). Filters to only offers whose linked `services` row resolves a
`packKey` (`:301-316`). For the customer's latest `completed`/`partial` diagnostic run,
cross-references each offer's `firedSignalKeys` against that run's findings'
`recommendation.signalKey` to build `relatedFindingTitles` — a purely human-readable
reference; **raw signal keys never leave the server** (`:318-361`, matches the module's own
header-comment privacy contract, `:8-12`).

---

## 6. Wire contract — `GET /api/portal/mission-control/overview`

Auth: `requireRole("CustomerUser")` (`:366`). **403** `{ error: "No customer identity on
token" }` if no `customerId` resolves from the JWT (`:369-372`).

Not one of #2450's originally-named 5, but in scope because it is the read side of the
exact same finding→offer surface `/remediate` (§4) executes against, and — per the
Orphaned-endpoint check below — it is the only endpoint in this pack with a real, live
frontend caller today.

Reads the customer's latest `mspDiagnosticRunsTable` row (any status) for `scan.active` /
`scan.status`, and separately the latest `completed`/`partial` row for `summary` and
`findings` (`:374-391`). Response shape (`:498-514`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `scan.active` | `boolean` | not null | `latestRun.status` is `"pending"` or `"running"` |
| `scan.runId` | `string \| null` | nullable | `latestRun.runId` when `active`, else `null` |
| `scan.status` | `MspDiagnosticRunStatus \| null` | nullable | `latestRun.status` |
| `scan.startedAt` | — | nullable | when `active` |
| `scan.lastScanAt` | — | nullable | `lastCompleted.completedAt ?? lastCompleted.createdAt` |
| `summary.critical` / `.warning` / `.info` | `number` | not null | counts over `findings` by `severity` |
| `summary.checksOk` / `.checksTotal` | `number \| null` | nullable | `lastCompleted.checksOk`/`.checksTotal` |
| `findings` | array | not null, `[]` when none | each finding + its linked offer, see below |

Each `findings[]` entry links to its sales offer where one of the offer's
`firedSignalKeys` matches the finding's `recommendation.signalKey` (`:475-493`, same
linkage rule as §5) — **no offer is fabricated where none matches**; a finding with no
linked offer carries `offer: null`.

Real enum: `MSP_DIAGNOSTIC_RUN_STATUS = ["pending", "running", "completed", "failed",
"partial"]` (`msp.ts:3267`). Finding severity: `MSP_DIAGNOSTIC_FINDING_SEVERITY = ["ok",
"info", "warning", "critical"]` (`msp.ts:3320`) — note `summary.critical/warning/info`
above counts only 3 of these 4 values; a finding with `severity: "ok"` is never counted in
`summary` (real, current behavior — not filed, see §9).

**500** `{ error: "Failed to load mission control overview" }` on any thrown error
(`:515-518`).

---

## 7. Wire contract — `POST /api/portal/customer/requests` ("Open a Request")

Auth: `requireRole("CustomerUser")` (`:99`). **400** `{ error: "No customer account
associated with this user" }` if no `customerId` on the session (`:102-105`).

Body validation (`:107-121`): `subject` (required, trimmed, truncated to 200 chars —
`MAX_SUBJECT`), `description` (required, trimmed, truncated to 5000 chars — `MAX_BODY`),
`category` (free-text, optional), `priority` (optional, must be exactly one of `Low |
Medium | High | Urgent` — `ALLOWED_PRIORITIES`, `:53` — any other value is silently
dropped to empty string, not rejected). **400** `{ error: "A subject is required." }` /
`{ error: "Please describe your request." }` for the two required fields.

`category`/`priority`, when present, are folded as prefix lines into the Zoho ticket
description (`:124-129`) rather than extending the Zoho ticket schema — this keeps the
create path a 1:1 reuse of `enqueueEscalationTicket()` (the SAME function `/msp/support/*`
uses, §1/§3), no separate Zoho integration surface for customer-opened requests.

Resolves the owning MSP via `resolveCustomerMspId()` (`:62-69`, `tenants.mspId`, falling
back to the JWT's `mspId`, then `undefined` → Zoho defaults to `ZOHO_DEFAULT_MSP_ID`), then
that MSP's active-MSPAdmin emails via `resolveMspAdminEmails()` (`:76-89`) — **the exact
same recipient-resolution shape** as `/msp/support/*`'s escalation routing (active
MSPAdmins OR `canApprovePurchases = true`), though this route does not fall back to
platform admins when the list is empty; an empty `notifyEmails` array is fine, the ticket
is still created, just not emailed to anyone (`:75`).

Queues `zoho_desk_create_ticket` (`:136-147`) and returns **202** `{ queued: true, message:
"Your request has been submitted. Our team has been notified and will be in touch." }`
(`:150-153`) — same "queued, drain-cadence, not instant" contract as §3's escalation ticket.
**500** `{ error: "We couldn't submit your request right now. Please try again shortly." }`
on any thrown error (`:154-157`) — this is the one route in this pack with no
Zoho-unavailable-specific branch; a disconnected Zoho Desk surfaces as a generic 500 here,
unlike the three read/reply routes below which all have an explicit `isZohoUnavailable()`
branch.

---

## 8. Wire contract — `GET /api/portal/customer/requests` (list)

Auth: `requireRole("CustomerUser")` (`:163`). Same 400 customer-identity guard as §7.

Resolves the Zoho Desk Contact for the caller's own email via
`resolveDeskContactIdForEmail()` (`:172-173`) — **not** persisted/cached anywhere; this is
a live Zoho lookup on every list call, per this file's own header-comment tradeoff ("Reads
hit Zoho live per-request... the create + reply writes go through the queued drain").

Three honest states, all real, none a fixture:

| State | Response | When |
|---|---|---|
| Never opened a request | `{ configured: true, requests: [] }` | no Zoho Desk Contact exists yet for this email (`:174-177`) |
| Has requests | `{ configured: true, requests: CustomerTicketSummary[] }` | contact resolved, `listDeskTicketsForContact()` (up to 100, newest-modified-first) |
| Zoho Desk not connected at all (MSP-level) | `{ configured: false, requests: [] }` | `ZohoNotConnectedError` (`:181-185`) — **200, not an error status** |

`CustomerTicketSummary` (`zoho-desk.ts:363-372`): `{ id, ticketNumber, subject, status,
statusType, createdTime, modifiedTime, webUrl }` — `status` is Zoho's real free-text label
(e.g. `"Open"`, `"Closed"`); `statusType` is Zoho's coarser bucket (`Open | On Hold |
Escalated | Closed`) — both `string | null`, no enum this codebase constrains (Zoho-owned
vocabulary, not this platform's).

**500** `{ error: "We couldn't load your requests right now. Please try again shortly." }`
on any other thrown error (`:186-188`).

---

## 9. Wire contract — `GET /api/portal/customer/requests/:ticketId` (detail + thread)

Auth: `requireRole("CustomerUser")` (`:194`). Same 400 customer-identity guard. **400**
`{ error: "Missing request id" }` if `:ticketId` is empty after trim.

**Ownership enforced by design, not by convention**: resolves the caller's own Contact id,
then `getDeskTicketForContact(ticketId, contactId, mspId)` (`zoho-desk.ts:440-450`), which
returns one of `"owned" | "foreign" | "missing"`. **Both `"foreign"` and `"missing"` map to
the identical 404** `{ error: "Request not found" }` (`:210-218`) — a customer cannot
distinguish "this ticket doesn't exist" from "this ticket exists but isn't yours" by
response shape, which is the point: ownership can't be probed by id.

On `"owned"`, fetches the full conversation via `getDeskTicketThread()`
(`zoho-desk.ts:458-497`) — **only after** ownership is confirmed; that function's own
docblock says explicitly it does not check ownership itself, callers must gate first. Filters
to public entries only: agent-authored **private** notes never reach the customer
(`isPublic` check, `zoho-desk.ts:476-477`). Each `CustomerTicketThreadEntry` (`zoho-desk.ts:374-383`):
`{ id, kind: "thread" | "comment", direction: "in" | "out" | null, author, isPublic,
content, createdTime }` — `direction` is only meaningful for `kind: "thread"` (`"in"` =
from the customer, `"out"` = a reply from support); comments (agent notes made public) carry
`direction: null`.

Response: `{ request: CustomerTicketSummary, thread: CustomerTicketThreadEntry[] }`
(`:220`). **503** `{ error: "Ticketing is not available right now." }` on
`ZohoNotConnectedError` (`:222-225`) — note this is a genuinely different status than §8's
list route, which returns **200** `configured: false` for the exact same underlying
condition; a client polling both routes during a Zoho outage sees two different signals for
one real cause (not filed — see §11). **500** on any other error (`:226-227`).

---

## 10. Wire contract — `POST /api/portal/customer/requests/:ticketId/reply`

Auth: `requireRole("CustomerUser")` (`:237`). Same 400 customer-identity guard, plus 400
`{ error: "Missing request id" }` and 400 `{ error: "Please enter a message." }` for an
empty/missing `message` body field.

Same ownership chain as §9 (resolve Contact → `getDeskTicketForContact` →
`"owned"`-or-404), enforced **before** any write.

**Zoho attribution quirk, real and documented in the route's own comment (`:233-235`)**: an
API-authored public comment is attributed in Zoho to the *connected agent*, never to the
Contact — so the customer's display name is prefixed into the comment body itself
(`"${displayName} (customer) replied:\n\n${message}"`, `:269-270`) to keep authorship
legible in the thread, since Zoho's own `author` field on the resulting comment will read as
the agent, not the customer.

Queues `zoho_desk_add_comment` via `enqueueZohoDeskWrite()` with `{ ticketId, content,
isPublic: true }` (`:271-275`) — same queued-drain cadence as every other Zoho write in this
pack. **202** `{ queued: true, message: "Your reply has been added to the request." }`
(`:278`).

Three distinct failure branches, more granular than any other route in this pack:

| Condition | Status | Body |
|---|---|---|
| `ZohoNotConnectedError` | 503 | `{ error: "Ticketing is not available right now." }` |
| `ZohoApiError` (a real Zoho-side API rejection) | 502 | `{ error: "We couldn't add your reply right now. Please try again shortly." }` (logs `err.body`/`err.status` distinctly) |
| any other thrown error | 500 | same message as above |

---

## 11. Sibling routes (undocumented elsewhere, real, not part of #2450's named 5) —
`POST /api/msp/support/actions/regenerate-document` and `.../rerun-scan`

These are the confirm-click execution endpoints for §1's `[ACTION:regenerate_document]` /
`[ACTION:rerun_scan]` proposals — included because §1's proposal contract is incomplete
without documenting what a Confirm click actually does; not otherwise covered by any other
contract pack.

**`POST /api/msp/support/actions/regenerate-document`** (`:759`): `CustomerUser`-only, gated
inline (`user.mspRole !== "CustomerUser" || !user.customerId` → **403** `{ error: "Not
available for this account" }`, `:763-766`) rather than via `requireRole` middleware — no
body params, the target document is re-resolved from scratch server-side
(`findRegenerableDocument(customerId)`, the SAME function §1 uses to build the proposal) —
**never trusted from the request body**, so a stale or tampered confirm click can never
regenerate anything but the caller's own current document. **404** `{ error: "No document
available to regenerate" }` if none. **400** `{ error: "This document type can no longer be
generated" }` if the resolved `documentTypesTable` row is inactive (`:775-783`).

Streams an SSE response (`Content-Type: text/event-stream`) with frames `{ type: "phase" |
"delta" | "done" | "error", ... }` (`:785-821`) — calls the SAME `generateDocument()` /
`generateSowDocument()` functions `admin-document-generator.ts` uses (branching on
`pipelineCategory === "pipeline_output"`), no separate generation pipeline. Audits
`shanebot_action_regenerate_document` on success only.

**`POST /api/msp/support/actions/rerun-scan`** (`:837`): same inline `CustomerUser`+
`customerId` gate. Resolves `packageKey` via `resolveScanPackageKey()` (the customer's
active `monitoring_subscription` service's `typeAttributes.packageKey`, falling back to
`"core:security-baseline"`, `:162-178`), inserts a `mspDiagnosticRunsTable` row
(`status: "pending"`), returns **202** `{ runId, status: "pending", packageKey }`
immediately (`:871`), then fires `runDiagnostics()` **fire-and-forget** (`:873-876`) — the
same real scan pipeline `msp-diagnostics.ts`'s own manual-rerun trigger uses. The client is
expected to stream progress via the **existing**
`GET /msp/customers/:customerId/diagnostics/runs/:runId/sse` endpoint with the returned
`runId` (per this route's own header comment, `:832-834`) — no new streaming mechanism.
**404** `{ error: "Account not found" }` if the `tenants` row is gone; **500** `{ error:
"Failed to start scan" }` on any other thrown error before the 202 is sent.

---

## 12. Real enum unions

- **Sales offer state** — `salesOffersTable.state` (`SALES_OFFER_STATES`, `index.ts:3182`):
  `"draft" | "sent" | "accepted" | "rejected" | "expired"`. §4/§5 both act only on
  `"sent"`.
- **MSP diagnostic run status** — `mspDiagnosticRunsTable.status`
  (`MSP_DIAGNOSTIC_RUN_STATUS`, `msp.ts:3267`): `"pending" | "running" | "completed" |
  "failed" | "partial"`. §6's `scan.active` is true only for `"pending"`/`"running"`; its
  `summary`/`findings` are sourced from the latest `"completed"` OR `"partial"` run —
  `"partial"` is treated as a fully-valid completed-enough state for summary purposes, same
  as `listRemediableOffers()` (§5).
- **Diagnostic finding severity** — `mspDiagnosticFindingsTable.severity`
  (`MSP_DIAGNOSTIC_FINDING_SEVERITY`, `msp.ts:3320`): `"ok" | "info" | "warning" |
  "critical"`, default `"info"`. §6's `summary` counts only `critical`/`warning`/`info` — see
  §11 (Honest-empty) below for the `"ok"` gap.
- **Diagnostic finding source** — `mspDiagnosticFindingsTable.findingSource`
  (`MSP_DIAGNOSTIC_FINDING_SOURCES`, `msp.ts:3328`): `"baseline" | "policy"`, surfaced
  read-only in §6's findings, not analyzed further here — out of this Feature's scope
  (`docs/microsoft-changes-contract-pack.md`/policy-decisions own that vocabulary).
- **Chat content block type** — `ChatContentBlock` (`index.ts:4096-4100`): `{ type: "text";
  text: string } | { type: "suggested_replies"; options: string[] } | { type: "card";
  cardType: string; data: Record<string, unknown> }`. `ChatMessageContent = string |
  ChatContentBlock[]` — the legacy bare-string shape is still accepted on every read path
  through `contentToText()`/`toContentBlocks()`.
- **Zoho ticket priority (this route's own local vocabulary, not Zoho's)** —
  `ALLOWED_PRIORITIES` (`portal-customer-requests.ts:53`): `"Low" | "Medium" | "High" |
  "Urgent"` — enforced client-input validation only, folded into the ticket description as
  free text; Zoho's own ticket object has no structured priority field written by this
  route.
- **Zoho ticket status / statusType** — real Zoho-owned free text, not a locally-defined
  enum: `status` (e.g. `"Open"`, `"Closed"`), `statusType` (`"Open" | "On Hold" |
  "Escalated" | "Closed"` per `zoho-desk.ts:369`'s comment, not TS-enforced since it
  crosses an external API boundary).
- **Ticket thread entry kind/direction** — `CustomerTicketThreadEntry.kind`: `"thread" |
  "comment"`; `.direction`: `"in" | "out" | null` (`zoho-desk.ts:374-383`).

---

## 13. Honest-empty / partial-data contract

- **`GET /api/portal/customer/requests`**: a customer who has never opened a request gets
  real `{ configured: true, requests: [] }` (§8) — indistinguishable in shape from "has
  requests but they're all closed," which is correct (both are real empty/non-empty
  states, not fixtures).
- **`GET /api/portal/mission-control/overview`**: `findings: []` is real for a
  never-completed-scan customer; `summary.checksOk`/`.checksTotal` are `null` (not `0`)
  when there is no `lastCompleted` run at all — a genuine third state distinguishable from
  "scan ran, zero checks."
- **`listRemediableOffers()` / `/remediate`'s eligibility**: a non-testbed customer, or one
  with zero `"sent"` offers, or one whose offers map to no `packKey`, all resolve to a real
  `[]` — never a fabricated always-available fallback. This is the one surface in this pack
  where "empty" is also a hard production-safety boundary (§4), not just an honest-data
  convention.
- **`GET /api/portal/customer/requests/:ticketId` vs. the list route's Zoho-outage
  signal**: a real, current inconsistency, not a fixture gap — see §14/§15 (filed as a
  finding).

---

## 14. Cross-surface edges

- **`listRemediableOffers()` is the single shared eligibility source for two different
  UIs**: `/msp/support/chat`'s system prompt (§1) and `/portal/mission-control/remediate`'s
  own execution gate (§4) both trust the identical function — a chat-proposed remediation
  and a (not-yet-built) direct mission-control "Remediate" button would show the exact same
  eligible set, since they'd call the same function, not two independently-derived lists.
- **`enqueueEscalationTicket()` is shared across three real call sites**: `/msp/support/*`'s
  automatic + explicit escalation (§1/§2/§3), `/portal/customer/requests`'s "Open a
  Request" (§7), and (outside this pack's scope) `public-chat.ts`'s pre-auth escalation
  path — all three write through the identical `zoho_desk_create_ticket` job/handler, so a
  Design decision about how a queued ticket surfaces (timing, copy) affects all three
  surfaces identically, not just this Feature's own two entry points.
- **`resolveMspAdminEmails()` (§7) and `resolveEscalationRecipients()` (§3) compute the
  same real MSP-admin set** (active MSPAdmin OR `canApprovePurchases`) via two separately-
  written queries in two different files — same underlying eligibility rule, not
  code-shared, so a future change to "who counts as an MSP admin for notification purposes"
  needs updating in both `portal-customer-requests.ts:76-89` and
  `support-chat.ts:351-358` to stay consistent. Not filed as a bug — both are currently
  identical in effect — but a real duplication Design/future-build should know about.
- **`/msp/support/chat`'s action-proposal system feeds `/msp/support/actions/*`** (§11) —
  a chat turn's `[ACTION:...]` proposal and that action's actual execution are two separate
  HTTP round-trips the client must wire together (proposal → render Confirm → click →
  call the action endpoint), not one atomic call.
- **`GET /api/portal/mission-control/overview` already has a live frontend caller** — see
  the Orphaned-endpoint check below. This is the one endpoint in this pack NOT waiting on a
  `Design/portal/` export to be reachable; a Requests-and-Support-Chat Design pass should
  know its own findings-feed data is already flowing to `useTopicHealthLive.ts` today, on a
  different page than this Feature's own eventual UI.

---

## 15. Finding — the two Zoho-unavailable read paths for the SAME condition return two
different HTTP contracts

`portal-customer-requests.ts`'s three GET/reply routes all call the identical
`resolveDeskContactIdForEmail()` → `isZohoUnavailable()` check for the identical root cause
(`ZohoNotConnectedError` — the MSP's Zoho Desk integration isn't connected), but the two
read routes disagree on how to report it:

- `GET /api/portal/customer/requests` (§8, `:181-185`): returns **200** `{ configured:
  false, requests: [] }` — an explicit, structured "not configured" signal a client can
  branch on to show a real empty/unconfigured state.
- `GET /api/portal/customer/requests/:ticketId` (§9, `:222-225`): returns **503** `{ error:
  "Ticketing is not available right now." }` — an error status with no `configured` field
  at all.

A client that correctly reads `configured: false` from the list call and renders "ticketing
isn't set up yet" has no way to reach the detail route in practice (there's nothing to
click into), so this is low real-world impact — but it is a genuine, live inconsistency in
how this route file reports the exact same underlying condition, and a client that DID
reach the detail route directly (e.g. a deep link) would see a generic 503 error page
instead of the same honest "not configured" state the list already knows how to show. Filed
as #2512 (sibling sub-issue of this Feature's own parent, #1659) rather than fixed here,
since #2450 Step 3 makes no implementation decisions.

---

## Orphaned-endpoint check

```
grep -rn "msp/support/chat\|msp/support/escalate\|msp/support/actions\|portal/customer/requests\|mission-control/remediate\|mission-control/overview" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

Returns exactly **one** match:

```
artifacts/portal/src/components/health-suite/useTopicHealthLive.ts:354:
    const res = await fetchWithAuth("/api/portal/mission-control/overview", ...)
```

`GET /api/portal/mission-control/overview` (§6) is **already live**, wired into
`artifacts/portal`'s Health Suite topic view — real, current state, not something this
Feature's Design pass introduces. Every other route in this pack — the 5 named in #2450,
plus `/mission-control/remediate` and the 2 action-execution siblings — has **zero** live
callers anywhere in the current tree. This is expected: `artifacts/msp-portal` (the only
prior caller, via the now-archived `support-chat.tsx`/`customer-requests.tsx`) was retired
2026-08-29, and no `Design/portal/` export exists yet for Requests and Support Chat
(`ls Design/portal/` has no matching `.dc.html`). All routes in this pack are real, under
test (`support-chat.test.ts`, `portal-mission-control.test.ts`), and — aside from
`/overview` — none is exercised by any live surface today; that is the honest state Design
should build against, not a gap this pack needs to close.

---

## Not covered by this pack

Per #2450 Step 3, no page/UI-shape decisions are made here. `shanebot-engine.ts`'s
`buildGrounding()`/`assembleSystemPrompt()`/`routeRequestedActions()`/
`routeRequestedCards()` internals are real and cited where §1 depends on them, but the
engine itself is shared infrastructure serving multiple ShaneBot instances beyond this
Feature (`shanebot_paid`, `shanebot_public`, etc.) and is out of this pack's own field-by-
field scope — see `docs/shanebot-contract-pack.md` for that engine's own documentation.
`config-pack-orchestrator.ts`'s `runConfigPackForCustomer()` internals (the actual Graph
writes a remediation performs) are similarly cited only far enough to document §4's honest
error contract, not analyzed pack-by-pack — that belongs to the Config Pack /
Remediation Feature, not this one.

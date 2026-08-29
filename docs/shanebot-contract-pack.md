# ShaneBot Active Cards — Contract Extraction Pack (`shanebot_paid` only)

**Issue:** #1616 · **Epic:** #1485 · **Method:** #1577 (contract pack, step 3 of #1578)
**Scope decision:** #1616's DECIDED comment (2026-08-28) — `shanebot_paid` ONLY.
**Read-only.** Extracted, not authored. Every field cited to `file:line`. No product
code, schema, or UI was changed producing this pack.

---

## 0. Scope and the hard boundary

`shanebot_public` is **out of scope** and stays that way for v1.1. It carries
`allowedCardTypes: []` by configuration (`shanebot-engine.ts:106`) and its
`live_catalog` grounding builder returns **no `cardData`** — `buildLiveCatalogGrounding()`
returns only `{ identity, summary }` (`shanebot-engine.ts:294-343`), never the
`cardData` key. There is no `cardData` builder for the public surface and none is to be
written. Everything below is the `shanebot_paid` instance.

The DECIDED v1.1 card set is **nine cards**:

| Card | Status | This pack extracts |
|---|---|---|
| `invoice` | EXISTING | the real `InvoiceCardData` contract |
| `subscription` | EXISTING | the real `SubscriptionCardData` contract |
| `score` | EXISTING | the real `ScoreCardData` contract |
| `data-answer` | EXISTING | the real `DataAnswerCardData` contract (fallback-of-last-resort) |
| `finding` | NEW | derived from remediation-tracker + diagnostics-findings backing |
| `remediation` | NEW | derived from `WireTrackerStep` backing |
| `microsoft-change` | NEW | derived from `WirePost` + `WireAnalysis` backing |
| `ticket` | NEW | derived from the Zoho Desk escalation payload |
| `document` | NEW | derived from `insightsGeneratedDocumentsTable` (see §5.5 nuance) |

For the four EXISTING: the contract is authored **in code today** — extracted verbatim.
For the five NEW: **no card shape exists in code.** This pack extracts the owning route's
real backing shape so the card contract is *derived*, per #1616's instruction ("do NOT
author a card shape").

---

## 1. The card vocabulary — the real one

`BotCardType` is the closed union of the four existing types:

```ts
// shanebot-engine.ts:83-84
/** Active Cards (#366) — the four v1 card types. shanebot_paid only. */
export type BotCardType = "invoice" | "subscription" | "score" | "data-answer";
```

Gated per instance via `allowedCardTypes` (`shanebot-engine.ts:92-93`):

| Instance | authMode | grounding | `allowedCardTypes` | cite |
|---|---|---|---|---|
| `shanebot_public` | `public` | `live_catalog` | `[]` | `shanebot-engine.ts:100-109` |
| `shanebot_paid` | `portal_authenticated` | `customer_entitlements` | `["invoice","subscription","score","data-answer"]` | `shanebot-engine.ts:110-119` |

The DB enum vocabularies backing these (real, from the schema — no invented values):

- `botAuthMode = ["public","portal_authenticated"]` — `lib/db/src/schema/index.ts:4150`
- `botGroundingSource = ["live_catalog","customer_entitlements"]` — `index.ts:4161`
- `botCostOwner = ["platform","msp"]` — `index.ts:4165`
- `botAction = ["regenerate_document","rerun_scan"]` — `index.ts:4173`

There is **no DB enum for card type.** `allowedCardTypes` is a code-only field on
`BotInstanceConfig` (`shanebot-engine.ts:93`); it is NOT a column on `bot_instances`
(`index.ts:4176-4189` has `allowedActions` jsonb but no `allowedCardTypes`). The card
vocabulary lives only in `BotCardType` and the two config literals.

---

## 2. The card_router path, end to end

All in `shanebot-engine.ts`, mirroring `action_router` exactly ("propose, never silently
act").

1. **Model emits** a control token on its own line: `[SHOW_CARD:invoice]` /
   `[SHOW_CARD:subscription]` / `[SHOW_CARD:score]` / `[SHOW_CARD:data-answer]`. Token
   regex: `/\[SHOW_CARD:\s*([a-z-]+)\s*\]/gi` (`shanebot-engine.ts:961`).
2. **`parseRequestedCards(text)`** (`:971-984`) — extracts every distinct requested
   cardType, lowercased, in first-seen order.
3. **`routeCards(instance, requested)`** (`:987-999`) — gates EACH against
   `new Set(instance.allowedCardTypes)`. Returns `RoutedCard[]` with `authorized`
   boolean. A hallucinated / unknown / unauthorized type → `authorized: false`, and logs
   a warn (`:991-996`). `routeRequestedCards` (`:1002-1004`) is parse+gate in one call.
4. **`stripCardTokens(text)`** (`:1007-1009`) — removes every `[SHOW_CARD:x]` token
   before the user sees the reply.

**Gating is on the TYPE only.** `routeCards` does NOT resolve data — the header comment
is explicit (`:956-959`): the caller pulls card data from this turn's own
`BotGrounding.cardData`, never from model text.

### The caller — `support-chat.ts`

- `resolveCardData(cardType, cardData)` (`support-chat.ts:189-206`) maps an authorized
  cardType to the pre-built payload: `invoice → cardData.invoice`,
  `subscription → cardData.subscription`, `score → cardData.score`,
  `data-answer → cardData.dataAnswer`. **Returns `null` when that key is `undefined`** —
  never null-coalesces to fabricated data.
- The card is only computed for a **CustomerUser on their own tenant**
  (`isCustomerUser && customerId`, `support-chat.ts:620`), the same gate as actions. An
  MSP-staff turn never learns the tokens exist (`cardsBlock` is empty unless
  `actionsEnabled`, `support-chat.ts:269`).
- Loop (`support-chat.ts:621-633`): for each authorized routed card, resolve data; the
  first type with real data wins (`proposedCard = { cardType, data }; break`). A card with
  no real data is dropped with a warn (`:628-631`).
- `proposedCard` is placed into the response `content` via
  `buildAssistantContent(visibleReply, suggestedReplies, proposedCard ? [proposedCard] : [])`
  (`support-chat.ts:660`) and echoed in the audit metadata as `proposedCardType`
  (`:681`). Note: `proposedCard` is **not** returned as a top-level JSON field — it rides
  inside `content` only (`res.json` at `:698-705` returns `reply`, `content`,
  `suggestedReplies`, `escalated`, `proposedRemediation`, `proposedAction`).

### The system-prompt instruction (`cardsBlock`, `support-chat.ts:269-281`)

The model is told: show a card "instead of only describing it in prose", append the
marker on its own line after the written answer, "Request at most one card per reply", and
"Still answer briefly in your own words too — the card supplements your reply, it never
replaces it." Only enabled when `actionsEnabled` (CustomerUser on own tenant).

---

## 3. `RoutedCard.cardType` — genuinely open (string), and exactly where it widens

```ts
// shanebot-engine.ts:963-968
export interface RoutedCard {
  /** The card type the model requested (lowercased). */
  cardType: string;            // <-- string, NOT BotCardType
  authorized: boolean;
}
```

The union **narrows at configuration and widens again at the routing boundary**:

- `BotInstanceConfig.allowedCardTypes: BotCardType[]` — closed (`shanebot-engine.ts:93`).
- `parseRequestedCards` returns `string[]` — it parses whatever the model emitted
  (`:971`, `m[1].toLowerCase()`), so an unknown token like `[SHOW_CARD:risk]` yields the
  string `"risk"`.
- `routeCards` maps those `string`s to `RoutedCard { cardType: string, authorized }`
  (`:987-999`) — `authorized` is `allowed.has(cardType)`, but `cardType` itself is never
  narrowed back to `BotCardType`.

So **design must not treat the four (or nine) as a closed set at the routing layer.**
`cardType` is a `string`; the gate is authorization, not a type. Also note
`ChatCardBlock.cardType` in the storage shape is `string` too
(`lib/db/src/schema/index.ts:4071`).

---

## 4. The four EXISTING card contracts — extracted in full

All four are built in `buildCustomerContext()` from the SAME rows the prose summary
fetched (`shanebot-engine.ts:676-732`), so requesting a card never triggers a second
query. **A card key is set to `undefined` when there is genuinely no real data** — so
`card_router`/the caller can distinguish "genuinely nothing to show" from a hallucinated
request. What the caller does with an authorized card whose data key is `undefined`:
`resolveCardData` returns `null` (`support-chat.ts:194-205`), the loop drops it with a
warn and shows no card (`support-chat.ts:624-631`).

### 4.1 `invoice` → `InvoiceCardData`

```ts
// shanebot-engine.ts:139-149
export interface InvoiceCardData {
  invoices: Array<{
    invoiceNumber: string;
    description: string | null;
    amount: string;        // dollars string "$xx.xx" — divided from integer cents
    currency: string;
    status: string;
    dueDate: string | null;   // ISO
    paidAt: string | null;    // ISO
  }>;
}
```

- **Backing:** `invoicesTable`, keyed by the **login** (`invoicesTable.clientUserId`),
  NOT the tenant (`shanebot-engine.ts:611-627`; same scoping `portal-billing.ts` uses).
- **Real column types** (`lib/db/src/schema/index.ts:730-748`): `invoiceNumber` text
  notNull; `description` text nullable; `amount` **integer cents** notNull (Git #1610,
  migrated from numeric); `currency` text notNull default `usd`; `status` enum
  `["draft","due","paid","overdue"]` (`index.ts:743`); `dueDate`/`paidAt` timestamp
  nullable.
- **Builder** (`:677-690`): `amount` is rendered `` `$${(Number(r.amount)/100).toFixed(2)}` ``;
  dates `.toISOString()` or `null`. `undefined` when `invoiceRows.length === 0`.
- Note the card's `status` is served as raw `string`, but the real DB enum is the
  four-value set above — design should treat those four as the vocabulary.

### 4.2 `subscription` → `SubscriptionCardData`

```ts
// shanebot-engine.ts:151-158
export interface SubscriptionCardData {
  subscriptions: Array<{
    name: string;
    status: string;
    activatedAt: string | null;    // ISO
    trialExpiresAt: string | null; // ISO
  }>;
}
```

- **Backing:** `mspSalesBundleAssignmentsTable` INNER JOIN `mspSalesBundlesTable`
  (`shanebot-engine.ts:574-584`) — active monitoring-bundle assignments, double-scoped by
  `customerId` (+ `mspId` when resolvable). `name` from the bundle, `status`/`activatedAt`/
  `trialExpiresAt` from the assignment.
- **Builder** (`:691-700`): dates ISO or null. `undefined` when `bundleRows.length === 0`.

### 4.3 `score` → `ScoreCardData`

```ts
// shanebot-engine.ts:160-167
export interface ScoreCardData {
  identity: number;
  security: number;
  collaboration: number;
  compliance: number;
  copilotReadiness: number;
  updatedAt: string;   // ISO
}
```

- **Backing:** `clientScoresTable`, keyed by the **login** (`clientScoresTable.clientId`,
  `shanebot-engine.ts:629-642`), NOT the tenant.
- **Builder** (`:701-710`): the five pillar numbers verbatim + `updatedAt.toISOString()`.
  `undefined` when there is no score row (`scoreRow` falsy). Note: unlike the other three
  (which wrap an array), `score` is a single flat object — a card with no data is the whole
  object `undefined`, there is no empty-array intermediate.

### 4.4 `data-answer` → `DataAnswerCardData` (the fallback of last resort)

```ts
// shanebot-engine.ts:169-173
export interface DataAnswerCardData {
  subscriptions: SubscriptionCardData["subscriptions"];
  latestScan: { packageKey: string; status: string; startedAt: string | null } | null;
  purchases: Array<{ title: string; status: string; amount: string; date: string | null }>;
}
```

- **Backing:** a composite of `bundleRows` (subscriptions), `latestRunRows[0]`
  (`mspDiagnosticRunsTable` — latest run regardless of status), and `sowRows`
  (`mspSowsTable` — signed/paid/pending purchases). Builder `:711-731`.
- **Unlike the other three, `dataAnswer` is ALWAYS built** (never `undefined`) — it is an
  object literal, not gated on row count (`:711`). Its interior arrays may be empty and
  `latestScan` may be `null`, but the key itself is always present. This is consistent with
  it being the generic fallback.
- `amount` here is `` `$${Math.round(r.amountCents/100).toLocaleString("en-US")}` ``
  (whole dollars, `:728`) — a DIFFERENT format from the invoice card's `.toFixed(2)`.

**The `data-answer` demotion is a PROMPT constraint, not a routing one (RECORD, do not
resolve).** `routeCards` gates on **authorization**, not preference — all four are equally
authorized for `shanebot_paid`. Because a generic `data-answer` can satisfy almost any
question and is always populated, if the model is free to reach for it the eight specific
cards will rarely fire. The persona/prompt must prefer a specific card whenever one fits
and fall back to `data-answer` only when none does. **Where this must live:**
`shanebot-persona.ts` (voice) and/or the `cardsBlock` prompt in `support-chat.ts:269-281`.

**The current gap is visible:** the `cardsBlock` instruction (`support-chat.ts:274`) lists
`[SHOW_CARD:data-answer]` as "for any other structured platform-data question" — it does
NOT instruct a specific-card-first preference ordering. `shanebot-persona.ts` says nothing
about cards at all (see §7). So today there is **no** prompt-level bias toward the specific
cards over `data-answer`. This is an OPEN GAP that the v1.1 build must close, and #1616's
DECIDED comment says it must be verified by asking real questions, not a unit test.

---

## 5. The five NEW cards — backing shapes (contract derived, not authored)

No card shape exists in code for any of these. Below is the real backing each derives from.

### 5.1 `remediation` → `WireTrackerStep` (`portal-remediation-tracker.ts:108-116`)

```ts
interface WireTrackerStep {
  readonly stepId: string;          // "s1"…"s23", "s26"…"s30" (24/25 removed, #757)
  readonly status: string;          // REMEDIATION_TRACKER_STEP_STATUS enum
  readonly completedAt: string | null;   // ISO, derived server-side from status
  readonly updatedAt: string | null;     // ISO
  readonly verificationState: string;    // "unverified" | "verified" | "drift"
  readonly verifiedAt: string | null;    // ISO
}
```

- **Route:** `GET /api/portal/remediation-tracker` (`portal-remediation-tracker.ts:153`),
  role floor `Assessment`. Returns `{ steps: WireTrackerStep[], pricing }`
  (`:188`). `pricing` is `computeRemediationTrackerPricing(knownRows)` (#734 Phase E,
  `:186`).
- **Real enum:** `REMEDIATION_TRACKER_STEP_STATUS` (imported from `@workspace/db`,
  `portal-remediation-tracker.ts:59`); the schema value set is the authority, and the
  step-id catalogue is `REMEDIATION_TRACKER_STEP_IDS` (`:96-99`).
- **Critical honest-empty rule (`:44-56, :147-152`):** this route holds **no `total`** and
  **no catalogue** — a step with no row is `not_started`, an untouched tracker is `[]`. The
  step CATALOGUE (title/problem/fix text) lives in **msp-portal's fixture**
  `previewRemediationGuide.ts` / `remediationLiveGuide.ts`, not here. Per #1489's pack, the
  guide's per-step title/problem/fix/CR-stage/hold-window/evidence copy is **100% fixture**;
  only `status`/`verificationState` are real, keyed by `stepId`. A `remediation` card
  therefore has real *state* but its descriptive body is fixture — flag this at build time.
- **A tick is NOT verification** (`:18-27`): `status` is the customer's own claim; only a
  rescan (`reverifyRemediationTrackerSteps()`) moves `verificationState` to
  `verified`/`drift`. The two facts must never collapse.

### 5.2 `finding` → diagnostics findings + remediation-tracker (`portal-remediation-tracker.ts:108`)

`finding` has **no single dedicated Wire interface.** The DECIDED comment points both
`finding` and `remediation` at `portal-remediation-tracker.ts:108`. The real "finding"
data in the codebase is `mspDiagnosticFindingsTable` — the engine already reads
`{ severity, title }` from it (`shanebot-engine.ts:650-663`), scoped by `runId` and
`severity ∈ ["critical","warning"]`. A `finding` card derives from:

- `mspDiagnosticFindingsTable.severity` (real enum in the schema — `["critical","warning",…]`
  as used at `shanebot-engine.ts:658`) and `.title` (text), tied to a run.
- OR the remediation guide's fixture finding/problem text (see §5.1) — which is **not real
  backing** and must not be used as card data (HARD RULE: no fixture-as-fallback).

**OPEN GAP:** there is no `Wire*` finding contract on any route today. The `finding` card
needs its real backing settled (diagnostic findings vs remediation-guide findings) before a
contract can be derived — this is why #1616 DECIDED says "`remediation` and `finding` both
need their contract packs (#1489) to confirm field shape before the card is built."

### 5.3 `microsoft-change` → `WirePost` + `WireAnalysis` (`portal-message-center.ts:135, :169`)

```ts
// WirePost — routes/portal-message-center.ts:135-156
interface WirePost {
  readonly id: string;            // graphMessageId
  readonly title: string;
  readonly wl: string; readonly workload: string;
  readonly kind: string;          // kindLabel(): "Retirement"|"Feature update"|… |"Action required"|"Plan for change"|"Stay informed"
  readonly hard: boolean;         // kindForPost() === "b"
  readonly month: number; readonly when: string; readonly countdown: string;
  readonly score: number; readonly impact: string; readonly bucket: number;
  readonly ms: string;            // Microsoft's body, html→text
  readonly plain: string;         // ALWAYS "" — no human write-up exists (:214-217)
  readonly msSays: string;
  readonly services: readonly string[]; readonly tags: readonly string[];
  readonly publishedAt: string; readonly lastModifiedAt: string;
  readonly actionRequiredBy: string | null;
}

// WireAnalysis — the tenant's own reading (#1532/#1533), :169-180
interface WireAnalysis {
  readonly summary: string | null;
  readonly changeClass: string;    // from m365ChangeInterpretationsTable
  readonly whoActs: string;
  readonly controllable: string;
  readonly controlMethod: string | null;
  readonly measured: boolean;      // true only when resolution counted the estate
  readonly affectedCount: number | null;   // null unless measured; measured 0 ⇒ noise
  readonly measuredAt: string | null;
  readonly basis: string | null;
  readonly noise: boolean;         // measured && affectedCount === 0
}
```

- **Route:** `GET /api/portal/message-center` (`portal-message-center.ts:227`), role
  `CustomerUser`. Returns `{ scoped, itemCount, onAxisCount, postsTruncated, lastSyncedAt,
  scanAt, buckets, waveShort, posts, density, stats, workloads, provenance }` (`:381-416`).
  Each `post` is a `WirePost` + `analysis: WireAnalysis | null` (`:359-363`).
- **What #1530–#1533 landed** (all present in this route):
  - Roadmap/Message-Center ingestion → `MessageCenterRow` from Graph
    `/admin/serviceAnnouncement/messages` (`provenance.source`, `:401`); classification
    `ChangeKind = "b"|"d"|"v"|"s"` and `kindLabel` in `lib/portal-message-center.ts:126-161`.
  - **#1532 interpretation layer** → `m365ChangeInterpretationsTable`
    (`summary/changeClass/whoActs/controllable/controlMethod`), joined by `graphMessageId`,
    **confirmed only** (`status = "confirmed"`, `:336`); a proposed reading never reaches a
    customer.
  - **#1533 resolution layer** → `m365ChangeResolutionsTable` LEFT JOIN by
    `interpretationId` + `customerId` (`:326-332`); `measured` is
    `resolutionStatus === "measured" && affectedCount !== null` (`:344`); a measured 0 sets
    `noise` (`:355`). This is the per-tenant affected-object count.
- **Honest-empty:** `WireAnalysis` is `null` when no confirmed interpretation exists — the
  page keeps the stated-absence copy `NOT_READ_AGAINST_TENANT` (`:191-192`). `plain` is
  always `""` (no human paraphrase exists, `:214-217`). `provenance` states plainly what was
  and was not measured (`:396-415`).

### 5.4 `ticket` → the Zoho Desk escalation payload (`zoho-desk.ts:690-699`)

There is **no ticket read-model / Wire interface.** `ticket` is the card that RESULTS from
the escalation action (`escalate` is not a card — DECIDED). The escalation path:

- **Fires from** `support-chat.ts`'s `escalateToAdmin()` (auto when the model emits
  `[ESCALATE_TO_HUMAN]`, `:558, :686-696`; or explicitly via
  `POST /api/msp/support/escalate`, `:711-744`).
- **What is attached** — `enqueueEscalationTicket(EnqueueEscalationTicketInput)`
  (`zoho-desk.ts:690-699`): `subject`, `description` (the truncated question + AI reply,
  `support-chat.ts:383`), `contactEmail`, `contactName`, `localUserId`, `notifyEmails`,
  `notifySubject`, `pushNotify?`. Queued as one `zoho_desk_create_ticket` job
  (`zoho-desk.ts:701-705`); `handleCreateTicketJob` (`:554-...`) resolves/upserts the Desk
  contact and creates the ticket, then emails `notifyEmails` with the real ticket link.
- **When it fires:** only on the turn that triggered escalation. For a CustomerUser a
  `messagesTable` row is also inserted so it shows in their inbox (`support-chat.ts:416-424`).
- **OPEN GAP:** the ticket, once created, is not read back into the portal anywhere — there
  is no "my tickets" endpoint. A `ticket` card would show the just-created escalation
  (subject/description/contact) from the request path, or needs a new read endpoint against
  Zoho Desk. No backing read-model exists today.

### 5.5 `document` → `insightsGeneratedDocumentsTable` (NOT `documentsTable`)

**Important extraction correction.** The DECIDED comment points `document` at
`documentsTable` + Document Viewer (#347). The real backing is different:

- `documentsTable` (`lib/db/src/schema/index.ts:698-707`) is **project-attached uploaded
  files**: `projectId, name, filename, mimeType, sizeBytes, uploadedBy, createdAt`. It has
  **no portal viewer route and no `Wire*`** — nothing in `portal-documents.ts` reads it.
- The portal **Document Viewer (#347)** actually serves `insightsGeneratedDocumentsTable`
  via `GET /api/portal/insights-documents` (`portal-documents.ts:54-85`), returning
  `{ id, title, category, docType, status, deliveredAt, createdAt, sowTotalPrice, projectId }`;
  the viewer itself is `GET /api/portal/insights-documents/:id/view`
  (`:92-117`, returns `{ id, title, htmlContent }`) and `/pdf` (`:126-...`).
- The **`regenerate_document` action** `document` is said to pair with ALSO operates on
  `insightsGeneratedDocumentsTable`, NOT `documentsTable`: `findRegenerableDocument()`
  reads it by `mspCustomerId` + `status = "delivered"`, excluding `LIVE_RENDERED_DOC_TYPES`
  (`support-chat.ts:117-146`).

So the `document` card's real backing is **`insightsGeneratedDocumentsTable`** (fields:
`id, title, category, docType, status, deliveredAt, createdAt, sowTotalPrice, projectId`;
`htmlContent` for the viewer) — the same table the viewer serves and `regenerate_document`
refreshes. Recorded here as an extraction finding: **`documentsTable` is the wrong table**
for this card.

---

## 6. Is a `{type:"card"}` content block ever PERSISTED? — No.

Checked against the LIVE write paths and tables, not just #361's comment.

- **The block is reserved in the schema:** `ChatCardBlock = { type: "card"; cardType:
  string; data: Record<string,unknown> }` (`lib/db/src/schema/index.ts:4071`), part of
  `ChatContentBlock` (`:4073`) and `BotConversationMessage.content` (`:4204-4208`). The
  schema comment (`:4064-4068`) documents `card` as a valid stored block.
- **`toContentBlocks` preserves a `card` block on READ** (`chat-content-blocks.ts:130-141`)
  with the comment "RESERVED block type … nothing writes it today."
- **`buildAssistantContent` CAN build a card block** (`chat-content-blocks.ts:178-192`), and
  `support-chat.ts:660` calls it with `proposedCard` — so a card block IS created in the
  **response `content`** returned to the client.
- **BUT the paid surface never persists that content.** `support-chat.ts` does **not** import
  or call `upsertBotConversation` (its imports, `:52-70`, are grounding/routers/strippers
  only). The route is **stateless** — the client holds the transcript and re-sends it each
  turn (`:459-465`). Confirmed by `public-chat.ts:199-200`: the transcript store is "the same
  store support-chat.ts **will target whenever it grows persistence**" — i.e. it has not yet.
- **The only writer of `bot_conversations` is `public-chat.ts`** (`upsertBotConversation` at
  `public-chat.ts:269`), and it builds content with `buildAssistantContent(visibleReply,
  suggestedReplies)` (`:208`) — **no cards** (public has `allowedCardTypes: []`). So no
  `card` block is ever written by the one path that writes.

**Conclusion:** a `{type:"card"}` block is reserved but **never persisted in any live
table.** A returning customer scrolling back through an old thread sees **no cards** —
cards are transient per-turn, resolved live and returned in the response only. Design must
treat a card as ephemeral to its turn; the layout must not assume a card survives reload.

---

## 7. `shanebot-persona.ts`'s portal surface — and the card-selection gap

- The portal persona is `SHANEBOT_PERSONA_PORTAL` (`shanebot-persona.ts:113-140`), surface
  `"portal"`, consumed by `support-chat.ts` via `assembleSystemPrompt` →
  `resolvePersonaPrompt` → `renderPersonaPrompt` (`shanebot-engine.ts:130-132, :880-887`).
- Its remit is **VOICE ONLY** (`:16-23`): identity, tone, dos, donts, sample openers. It
  deliberately carries no grounding, no control-token instructions, no card rules.
- **The file is a DRAFT** — its own header (`:1-7`): "pending Shane's review, do not treat
  as final voice."
- **Card-selection instruction lives in `support-chat.ts`, not the persona.** The
  `cardsBlock` (`support-chat.ts:269-281`) is the only place the model is told about cards.
  It says "request at most one card per reply" and "only request a card type that is
  actually relevant" — but it does **NOT** encode the DECIDED preference that a specific
  card must be preferred over `data-answer`.
- **The gap (per §4.4):** the persona says nothing about cards, and `cardsBlock` gives
  `data-answer` the broadest mandate ("for any other structured platform-data question")
  with no "specific-card-first" ordering. Closing this is a **prompt-design task** for the
  v1.1 build, in `shanebot-persona.ts` and/or `support-chat.ts`'s `cardsBlock`, verified by
  asking real questions (#1616 DECIDED), not by a unit test.

---

## 8. Honest-state contract for the renderer

Per #1616's note (and #366's own test manifest): **a reply carrying NO card is the normal
case, not an empty state.** Whether `[SHOW_CARD:x]` appears is a live-model judgment per
turn (`claude-haiku-4-5`, `support-chat.ts:536`). It **cannot be forced or seeded**, which
is why no test asserts a card renders. The renderer must handle the same reply **with and
without** a card without the layout breaking either way — a card is an optional supplement
to prose (`support-chat.ts:279`), never a replacement.

Preserve the honest tri-state where a card IS shown: an authorized card whose data key is
`undefined`/`null` shows **no card** (never fixture) — the caller already enforces this
(`support-chat.ts:624-631`). No fixture-as-fallback, ever (HARD RULE).

---

## 9. CURRENT vs DECIDED table

Every DECIDED row needs an issue number; a row without one is an **OPEN GAP**, not decided.

| Item | State | Issue | Notes |
|---|---|---|---|
| `invoice` card contract | **CURRENT** | #366 | `InvoiceCardData`, real `invoicesTable` |
| `subscription` card contract | **CURRENT** | #366 | `SubscriptionCardData`, sales-bundle assignments |
| `score` card contract | **CURRENT** | #366 | `ScoreCardData`, `clientScoresTable` |
| `data-answer` card contract | **CURRENT** | #366 | `DataAnswerCardData`, always-built composite |
| `card_router` (parse/route/strip) | **CURRENT** | #366 | `shanebot-engine.ts:950-1009` |
| `allowedCardTypes` gating | **CURRENT** | #1097/#366 | code-only field, not a DB column |
| `{type:"card"}` reserved block | **CURRENT (reserved, unwritten)** | #361 | never persisted (see §6) |
| Nine-card v1.1 set decision | **DECIDED** | #1616 | DECIDED comment 2026-08-28 |
| `data-answer` demoted to fallback | **DECIDED (prompt constraint)** | #1616 | lives in persona/prompt, not routing |
| `remediation` card | **DECIDED (backing exists, card not built)** | #1616 (+#1489) | `WireTrackerStep`; body copy is fixture |
| `microsoft-change` card | **DECIDED (backing exists, card not built)** | #1616 (+#1530–#1533) | `WirePost`+`WireAnalysis` |
| `document` card | **DECIDED (backing exists, card not built)** | #1616 (+#347) | backing is `insightsGeneratedDocumentsTable`, not `documentsTable` |
| `finding` card real backing | **OPEN GAP** | #1616/#1489 | no `Wire*` finding contract exists; diagnostics-findings vs guide-findings unsettled |
| `ticket` card read-model | **OPEN GAP** | #1616 | escalation write path exists; no ticket READ endpoint |
| portal-v2 renderer for ANY real card | **OPEN GAP → sub-issue filed** | see §10 | four existing types route/gate/populate real data, nothing draws them |
| `change-request` card | **EXCLUDED for v1.1** | #1486/#1616 | CRs never execute (`drift-collector.ts:78`) |
| public-surface cards | **OUT OF SCOPE** | #1616 | `allowedCardTypes: []`, no `cardData` builder |
| `risk` / `ownership` / `sop`/`runbook` cards | **DEFERRED** | #1507 / #1515 / #1557 | blocked on known-wrong backing |

---

## 10. Sub-issue filed at pack time

Per #1616 ("For every real live endpoint or card type with no renderer, FILE A SUB-ISSUE
… The four existing card types having no portal-v2 renderer at all is the obvious first
one"):

- **Filed:** "ShaneBot Active Cards — the four existing card types have no portal-v2
  renderer" (sub-issue of #1616). The `invoice`/`subscription`/`score`/`data-answer` cards
  are routed (`shanebot-engine.ts:950-1009`), gated (`allowedCardTypes`), and populated with
  real DB rows returned in `support-chat.ts`'s response `content` — but portal-v2's
  `ShaneBot.tsx` renders the retired **fixture** `shaneBotData.ts` (`SbCardKind`) and is not
  even wired to `POST /api/msp/support/chat`. Nothing in portal-v2 renders a real card.

(The `finding` and `ticket` OPEN GAPs in §9 are backing-shape gaps, not "live endpoint with
no renderer" — they are recorded here for the v1.1 build to settle, not filed as renderer
sub-issues, because there is no live card/endpoint to render yet.)

---

## 11. Gate note

**#1269's gate is not touched by this pack.** #1269 is an open `Shane To-Do` gate that
blocks *wiring* ShaneBot into portal-v2 (no human has used ShaneBot yet). This pack is
read-only and touches no product code, so it does not cross that gate. The renderer
sub-issue in §10 is filed but must respect #1269 — building the renderer is wiring, gated
by #1269.

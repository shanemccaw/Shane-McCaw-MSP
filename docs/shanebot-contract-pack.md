# ShaneBot Active Cards — Contract Extraction Pack (`shanebot_paid` only)

**Issue:** #1740 · **Feature:** #1616 (ShaneBot + Active Cards, Portal) · **Epic:** #1485
**Method:** #1577 (contract pack, step 3 of #1578) · **Pattern:** #1642
**Scope decision:** #1616's DECIDED comment (2026-08-28) — `shanebot_paid` ONLY.
**Read-only.** Extracted, not authored. Every field cited to `file:line`. No product
code, schema, or UI was changed producing this pack.

## Why this is a wholesale regeneration, not an edit

The prior pack (`fc3466355`, 2026-09-02, DONE per `build-journal/1616.md`) was written
**before the backend it describes had a consumer.** Two real builds landed on `main` since:

- **#2519** (`6dfcb1d88`) — the actual `artifacts/portal` chat shell + Active Card renderer
  library. The prior pack's own §10 sub-issue ("the four existing card types have no
  portal renderer") is now **closed and built**, not open.
- **#1624** (`e24b89aba`) — specific-card-first ordering in `support-chat.ts`'s
  `cardsBlock`. The prior pack's own §4.4/§9 "OPEN GAP" (no prompt-level bias toward the
  specific cards over `data-answer`) is now **closed**.

Handing the old pack to Design would draw against a state where nothing rendered a card and
the model had no preference ordering — both now false. Per #1642's own reasoning, this
issue exists so the regeneration has a clean number with no prior DONE against it; §1740 is
that number. Treat the old file as prior art replaced wholesale, not edited.

**A second, unrelated commit (`schema/index.ts` gained `canApproveChanges`, Git #1496)
shifted every line number below `lib/db/src/schema/index.ts:100` by +34.** Every schema
citation in this pack has been re-verified against the current file rather than copied
forward from the old pack's line numbers.

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
| `invoice` | EXISTING, **rendered** (#2519) | the real `InvoiceCardData` contract + the real client renderer |
| `subscription` | EXISTING, **rendered** (#2519) | the real `SubscriptionCardData` contract + the real client renderer |
| `score` | EXISTING, **rendered** (#2519) | the real `ScoreCardData` contract + the real client renderer |
| `data-answer` | EXISTING, **rendered** (#2519) | the real `DataAnswerCardData` contract + the real client renderer |
| `finding` | NEW | derived from remediation-tracker + diagnostics-findings backing |
| `remediation` | NEW | derived from `WireTrackerStep` backing |
| `microsoft-change` | NEW | derived from `WirePost` + `WireAnalysis` backing |
| `ticket` | NEW | derived from the Zoho Desk escalation payload |
| `document` | NEW | derived from `insightsGeneratedDocumentsTable` (see §5.5 nuance) |

For the four EXISTING: the contract is authored **in code today** — extracted verbatim, on
both the server (unchanged since the prior pack) and the client (new, built by #2519).
For the five NEW: **no card shape exists in code, on either side.** This pack extracts the
owning route's real backing shape so the card contract is *derived*, per #1616's
instruction ("do NOT author a card shape").

---

## 1. The card vocabulary — the real one

`BotCardType` is the closed union of the four existing types (**unchanged since the prior
pack** — verified `git diff fc3466355..HEAD -- artifacts/api-server/src/lib/shanebot-engine.ts`
is empty):

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

The DB enum vocabularies backing these (real, from the schema — no invented values;
**line numbers re-verified against current `main`, shifted +34 from the prior pack**):

- `botAuthMode = ["public","portal_authenticated"]` — `lib/db/src/schema/index.ts:4184`
- `botGroundingSource = ["live_catalog","customer_entitlements"]` — `index.ts:4195`
- `botCostOwner = ["platform","msp"]` — `index.ts:4199`
- `botAction = ["regenerate_document","rerun_scan"]` — `index.ts:4207`

There is **no DB enum for card type.** `allowedCardTypes` is a code-only field on
`BotInstanceConfig` (`shanebot-engine.ts:93`); it is NOT a column on `bot_instances`
(`index.ts:4210-4223` has `allowedActions` jsonb but no `allowedCardTypes`). The card
vocabulary lives only in `BotCardType` and the two config literals.

---

## 2. The card_router path, end to end

All in `shanebot-engine.ts`, mirroring `action_router` exactly ("propose, never silently
act"). Unchanged since the prior pack.

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

### The caller — `support-chat.ts` (line numbers shifted since the prior pack; #1624 added the
specific-card-first prompt block ahead of these, +14 lines net)

- `resolveCardData(cardType, cardData)` (`support-chat.ts:189-206`, unmoved — the #1624 edit
  landed after this function) maps an authorized cardType to the pre-built payload:
  `invoice → cardData.invoice`, `subscription → cardData.subscription`,
  `score → cardData.score`, `data-answer → cardData.dataAnswer`. **Returns `null` when that
  key is `undefined`** — never null-coalesces to fabricated data.
- The card is only computed for a **CustomerUser on their own tenant**
  (`isCustomerUser && customerId`, `support-chat.ts:634`), the same gate as actions
  (`:605`). An MSP-staff turn never learns the tokens exist (`cardsBlock` is empty unless
  `actionsEnabled`, `support-chat.ts:277`).
- Loop (`support-chat.ts:634-645`): for each authorized routed card, resolve data; the
  first type with real data wins (`proposedCard = { cardType, data }; break`). A card with
  no real data is dropped with a warn (`:641-644`).
- `proposedCard` is placed into the response `content` via
  `buildAssistantContent(visibleReply, suggestedReplies, proposedCard ? [proposedCard] : [])`
  (`support-chat.ts:674`) and echoed in the audit metadata as `proposedCardType`
  (`:695`). Note: `proposedCard` is **not** returned as a top-level JSON field — it rides
  inside `content` only (`res.json` at `:712-719` returns `reply`, `content`,
  `suggestedReplies`, `escalated`, `proposedRemediation`, `proposedAction`).

### The system-prompt instruction (`cardsBlock`, `support-chat.ts:265-291`) — **changed by #1624**

The DECIDED gap the prior pack flagged (§4.4/§9: "no prompt-level bias toward the specific
cards over `data-answer`") is now closed. The block was rewritten from a flat list of four
equally-weighted options to an explicit ordering:

```
=== DATA CARDS AVAILABLE ===
When your answer is about one of these, prefer the specific card for it over any generic one:
- Invoices or billing history → [SHOW_CARD:invoice]
- Subscription or plan status → [SHOW_CARD:subscription]
- Copilot readiness score → [SHOW_CARD:score]
Only if none of those three fit, and the question is still a structured platform-data
question you can answer from the data above, you may fall back to [SHOW_CARD:data-answer].
Treat data-answer as the fallback of last resort, not a first choice.
```

plus a DATA CARD RULES line: "Prefer the specific card (invoice, subscription, score)
whenever it applies. Only request data-answer when none of those three do."
(`support-chat.ts:288`). Only enabled when `actionsEnabled` (CustomerUser on own tenant,
`:277`). Per #1616 DECIDED, this is verified by asking real questions, not a unit test —
**this pack does not claim the ordering has been behaviorally verified against the live
model**, only that the prompt text now encodes the preference the old pack found missing.

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
(`lib/db/src/schema/index.ts:4105`, re-verified — was `:4071` in the prior pack).

**The client renderer built by #2519 respects this exactly.** `ActiveCard.tsx`'s
dispatcher (`artifacts/portal/src/components/support-chat/cards/ActiveCard.tsx:27-48`)
`switch`es on `card.cardType: string` with a `default: return null` — an unrecognized
type (one of the five NEW types, or a genuine hallucination) renders nothing rather than
throwing or guessing. This is the client half of the same "propose, never silently act"
discipline the server enforces.

---

## 4. The four EXISTING card contracts — extracted in full, server AND client

All four are built in `buildCustomerContext()` from the SAME rows the prose summary
fetched (`shanebot-engine.ts:676-732`), so requesting a card never triggers a second
query. **A card key is set to `undefined` when there is genuinely no real data** — so
`card_router`/the caller can distinguish "genuinely nothing to show" from a hallucinated
request. What the caller does with an authorized card whose data key is `undefined`:
`resolveCardData` returns `null` (`support-chat.ts:194-205`), the loop drops it with a
warn and shows no card (`support-chat.ts:637-644`).

**On the wire, `data` is untyped** — `ChatCardBlock.data: Record<string, unknown>`
(`chat-content-blocks.ts:4105` on the server; restated verbatim on the client,
`artifacts/portal/src/lib/chat-content-blocks.ts:24`, since the portal is an independent
Vite app with no workspace-package import of the server's type — see that file's own
header comment). Each of the four client renderer components below therefore re-checks
its own shape at runtime (`cards/types.ts`'s `asInvoiceCardData` etc.) rather than
trusting a cast — real defensive code, not decorative typing, because a card's `data` is
genuinely `unknown` until that check runs.

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
- **Real column types** (`lib/db/src/schema/index.ts:737-757`, re-verified — was
  `:730-748` in the prior pack): `invoiceNumber` text notNull; `description` text
  nullable; `amount` **integer cents** notNull (Git #1610, `amount_old_numeric` dropped
  entirely by #1623 since the prior pack — there is no longer even a retired column to
  note); `currency` text notNull default `usd`; `status` `text` column with a
  `{ enum: [...] }` literal — `["draft","due","paid","overdue"]` — **not a `pgEnum`**
  (`index.ts:748`); `dueDate`/`paidAt` timestamp nullable.
- **Builder** (`:677-690`): `amount` is rendered `` `$${(Number(r.amount)/100).toFixed(2)}` ``;
  dates `.toISOString()` or `null`. `undefined` when `invoiceRows.length === 0`.
- Note the card's `status` is served as raw `string`, but the real DB literal is the
  four-value set above — design should treat those four as the vocabulary.
- **Client renderer:** `InvoiceCard.tsx` — one card per invoice, grouped list with
  `Separator` between rows, `invoiceNumber` + optional `description`, "Paid `<date>`" when
  `status === "paid"` else "Due `<date>`", amount + uppercased currency, and a status
  `Badge` (`card-status.ts`'s keyword-based `statusBadgeVariant`/`formatStatusLabel` — see
  §12). `data-testid="active-card-invoice"`.

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
- **Client renderer:** `SubscriptionCard.tsx` — one row per subscription, `name` +
  status-derived caption ("Trial ends `<date>`" > "Active since `<date>`" > "Not yet
  activated", in that priority), status `Badge`. `data-testid="active-card-subscription"`.

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
- **Client renderer:** `ScoreCard.tsx` — headline `copilotReadiness` (`x / 100 overall`)
  plus four `PillarBar` rows for `identity`/`security`/`collaboration`/`compliance`
  (`security`'s own pillar score is shown here even though the platform's separate
  Security Pillar surface is deliberately excluded elsewhere — see MEMORY
  `security-pillar-deliberate-exclusion`; that exclusion is about the standalone Security
  Pillar module, not this card, which is only restating five numbers the engine already
  computed). Bar color is a plain 3-band threshold (`>=80` primary, `>=50` amber, else
  destructive) — **not** derived from the platform's real severity-band vocabulary
  anywhere else in the codebase; this is a card-local heuristic, not a shared one.
  `data-testid="active-card-score"`.

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
  (whole dollars, `:728`) — a DIFFERENT format from the invoice card's `.toFixed(2)`. The
  client renderer does not reconcile this inconsistency — it renders each card's `amount`
  string as delivered.
- **Client renderer:** `DataAnswerCard.tsx` — the only one of the four with a genuine
  empty state (`hasAnything` check across all three interior arrays/objects → "Nothing on
  file yet for this account."), and the only one with three independently-optional
  sections (Subscriptions / Latest Scan / Purchases), each conditionally
  `Separator`-divided from the one before it. `data-testid="active-card-data-answer"`.

**The `data-answer` demotion is now a REALIZED prompt constraint, not just a recorded
one.** §2 above documents #1624's fix. `routeCards` still gates on **authorization**, not
preference — all four remain equally authorized for `shanebot_paid`; the bias lives
entirely in the prompt text, same place the prior pack's OPEN GAP said it should.

---

## 5. The five NEW cards — backing shapes (contract derived, not authored)

No card shape exists in code for any of these, on either the server or the client. Below
is the real backing each derives from. **Unchanged since the prior pack** — no commit
since `fc3466355` touched any of these routes' card-relevant shapes.

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
  step CATALOGUE (title/problem/fix text) lives in **`artifacts/portal`'s fixture**
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

**OPEN GAP, still open:** there is no `Wire*` finding contract on any route today. The
`finding` card needs its real backing settled (diagnostic findings vs remediation-guide
findings) before a contract can be derived — this is why #1616 DECIDED says "`remediation`
and `finding` both need their contract packs (#1489) to confirm field shape before the
card is built."

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
  `[ESCALATE_TO_HUMAN]`; or explicitly via `POST /api/msp/support/escalate`,
  `support-chat.ts:725-757` — this route is now the one actually called by the real
  `/support` page's "Talk to a human" button, see §8).
- **What is attached** — `enqueueEscalationTicket(EnqueueEscalationTicketInput)`
  (`zoho-desk.ts:690-699`): `subject`, `description` (the truncated question + AI reply,
  `support-chat.ts:383`), `contactEmail`, `contactName`, `localUserId`, `notifyEmails`,
  `notifySubject`, `pushNotify?`. Queued as one `zoho_desk_create_ticket` job
  (`zoho-desk.ts:701-705`); `handleCreateTicketJob` (`:554-...`) resolves/upserts the Desk
  contact and creates the ticket, then emails `notifyEmails` with the real ticket link.
- **When it fires:** only on the turn that triggered escalation. For a CustomerUser a
  `messagesTable` row is also inserted so it shows in their inbox (`support-chat.ts:416-424`).
- **OPEN GAP, still open:** the ticket, once created, is not read back into the portal
  anywhere — there is no "my tickets" endpoint. A `ticket` card would show the
  just-created escalation (subject/description/contact) from the request path, or needs a
  new read endpoint against Zoho Desk. No backing read-model exists today.

### 5.5 `document` → `insightsGeneratedDocumentsTable` (NOT `documentsTable`)

**Important extraction correction, carried forward from the prior pack.** The DECIDED
comment points `document` at `documentsTable` + Document Viewer (#347). The real backing
is different:

- `documentsTable` (`lib/db/src/schema/index.ts:705-714`, re-verified — was `:698-707` in
  the prior pack) is **project-attached uploaded files**: `projectId, name, filename,
  mimeType, sizeBytes, uploadedBy, createdAt`. It has **no portal viewer route and no
  `Wire*`** — nothing in `portal-documents.ts` reads it.
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

Checked against the LIVE write paths and tables, not just #361's comment. **Unchanged
since the prior pack**, and directly confirmed by the client's own header comment (see
below).

- **The block is reserved in the schema:** `ChatCardBlock = { type: "card"; cardType:
  string; data: Record<string,unknown> }` (`lib/db/src/schema/index.ts:4105`, re-verified —
  was `:4071` in the prior pack), part of `ChatContentBlock` (`:4107`) and
  `BotConversationMessage.content` (`:4238-4242`). The schema comment documents `card` as a
  valid stored block.
- **`toContentBlocks` preserves a `card` block on READ**, on both server
  (`chat-content-blocks.ts:112-142`, the `card` branch at `:129-140`) and now the client too
  (`artifacts/portal/src/lib/chat-content-blocks.ts:35-61`, the `card` branch at `:54-60`) —
  the client's own header
  comment states explicitly: *"This app is an independent Vite app with no
  workspace-package dependency, so the shape is restated here rather than imported… Keep
  the three in step."* This is a real, load-bearing duplication, not an oversight — flagged
  here as a maintenance surface Design/future builds should know about.
- **`buildAssistantContent` CAN build a card block** (`chat-content-blocks.ts:178-192`), and
  `support-chat.ts:674` calls it with `proposedCard` — so a card block IS created in the
  **response `content`** returned to the client.
- **BUT the paid surface never persists that content.** `support-chat.ts` does **not** import
  or call `upsertBotConversation` (its imports are grounding/routers/strippers only). The
  route is **stateless** — the client holds the transcript and re-sends it each turn
  (`support-chat.ts:459-465`, and independently confirmed client-side: `support.tsx:73`
  sends `newMessages.map((m) => ({ role: m.role, content: m.content }))` — the FULL
  transcript, every turn). Confirmed by `public-chat.ts:199-200`: the transcript store is
  "the same store support-chat.ts **will target whenever it grows persistence**" — i.e. it
  has not yet.
- **The only writer of `bot_conversations` is `public-chat.ts`** (`upsertBotConversation` at
  `public-chat.ts:269`), and it builds content with `buildAssistantContent(visibleReply,
  suggestedReplies)` (`:208`) — **no cards** (public has `allowedCardTypes: []`). So no
  `card` block is ever written by the one path that writes.

**Conclusion, now client-verified as well as server-verified:** a `{type:"card"}` block is
reserved but **never persisted in any live table**, and the real client holds its own
in-memory `messages` React state (`support.tsx:41`) that is discarded on reload — there is
no client-side cache or localStorage transcript either. A returning customer reloading
`/support` sees an **empty conversation**, not a stale one with stale cards. Design must
treat a card as ephemeral to its turn AND treat the whole conversation as ephemeral to the
page load; the layout must not assume either survives reload.

---

## 7. `shanebot-persona.ts`'s portal surface — and the card-selection gap (CLOSED by #1624)

- The portal persona is `SHANEBOT_PERSONA_PORTAL` (`shanebot-persona.ts:113-140`), surface
  `"portal"`, consumed by `support-chat.ts` via `assembleSystemPrompt` →
  `resolvePersonaPrompt` → `renderPersonaPrompt` (`shanebot-engine.ts:130-132, :880-887`).
  **Unchanged since the prior pack** — verified `git diff fc3466355..HEAD --
  artifacts/api-server/src/lib/shanebot-persona.ts` is empty.
- Its remit is **VOICE ONLY** (`:16-23`): identity, tone, dos, donts, sample openers. It
  deliberately carries no grounding, no control-token instructions, no card rules.
- **The file is still a DRAFT** — its own header (`:1-7`): "pending Shane's review, do not
  treat as final voice." That review has not happened as part of this pack or #1624/#2519.
- **Card-selection instruction lives in `support-chat.ts`, not the persona** — unchanged
  architecturally. What changed is the instruction's *content*: the `cardsBlock`
  (`support-chat.ts:277-291`, was `:269-281` in the prior pack) now DOES encode the DECIDED
  preference that a specific card must be preferred over `data-answer` (§2/§4.4 above).
- **The gap the prior pack flagged is CLOSED at the prompt-text level.** Whether it changes
  actual model behavior is, per #1616 DECIDED, something to verify by asking real questions
  — not claimed as verified by this pack, which is read-only and did not run the model.

---

## 8. The real `artifacts/portal` chat shell + Active Card renderer (#2519) — NEW section

The prior pack's §10 sub-issue is now built. This section documents what's actually there,
extracted from the live code, the same way §4-5 document the server side.

### 8.1 Page and route

- **Page:** `artifacts/portal/src/pages/support.tsx`. **Route:** `/support`
  (`App.tsx:57`), which the app's `RequireAuth` wrapper gates — **there is still no portal
  login page** (`App.tsx:21-24`'s own comment), so an unauthenticated visitor sees an
  honest "Sign in required" panel, never a broken chat surface. This is a structural gap in
  the whole portal rebuild (#1673), not specific to ShaneBot.
- **No sidebar/nav entry exists to `/support` today.** `PortalShell.tsx`'s own header
  comment (`:49-51`) lists "ShaneBot dock" among the pieces still out of scope, alongside
  the three popovers and Settings container. `SidebarNav.tsx`/`TopBar.tsx` have no
  `Support`/`ShaneBot` menu item — the only place `/support` is referenced in the shell is
  `useBreadcrumb()`'s `if (location === "/support") return { current: "Support" }`
  (`PortalShell.tsx:30`), which labels the breadcrumb IF you're already there; it doesn't
  get you there. The page is real and functions, but is reachable only by direct URL right
  now. This is expected pre-Design/pre-wire state (#1741 Design, #1742 wire are still open
  and are exactly where a nav entry point would be decided), not a defect of #2519's scope.

### 8.2 Wire contract the page actually calls

- `POST /api/msp/support/chat` (`support.tsx:67-77`) — body
  `{ messages: Array<{ role, content }> }`, the FULL transcript re-sent every turn (stateless,
  §6). On `403` shows `data.error` as a fatal, non-recoverable inline message and reverts
  optimistic state (`:79-84`). On any other non-`200` throws to the generic catch, which
  renders an inline assistant-bubble apology rather than a toast or crash (`:92-99`).
- `POST /api/msp/support/escalate` (`support.tsx:113-117`) — body `{ question }`, the last
  user message's text extracted via `contentToText()`. Always shows `data.message` (or a
  generic fallback) as a transient banner (`:118-119`), regardless of the response shape
  the server actually sent (no `ok` check on the client).
- **Not called by this page at all:** `POST /api/msp/support/actions/regenerate-document`
  and `POST /api/msp/support/actions/rerun-scan` (`support-chat.ts:772-`, `:850-`), and the
  response's own `proposedRemediation`/`proposedAction` fields are not read by `support.tsx`'s
  `ChatResponse` interface (`support.tsx:17-23` types only `reply`, `content`,
  `suggestedReplies`, `escalated`, `error`). **This is deliberately out of #1616's scope,
  not an orphaned-endpoint finding for this pack** — the action-confirmation layer is #363's
  tree (parented under the separate, closed #360, itself under Epic #1096 Application Core,
  not Feature #1616). It is noted here only so Design doesn't mistake ShaneBot's action
  layer for part of the Active Cards contract; a`Requests and Support Chat` contract pack
  (docs/requests-and-support-chat-contract-pack.md, #2450) already covers those two routes
  and both response fields in full, and that pack — not this one — is the place a
  sub-issue for that gap would belong if filed.

### 8.3 Structured content rendering (client mirror of #361)

`artifacts/portal/src/lib/chat-content-blocks.ts` restates the server's `ChatContentBlock`
union (`text` / `suggested_replies` / `card`) rather than importing it (§6's flagged
duplication). `ChatBubble.tsx` renders `contentToText()` for the bubble body and, for an
assistant turn only, pulls `cardFrom(content)` and — if present — renders `<ActiveCard
card={card} />` beneath the bubble (`ChatBubble.tsx:20-42`). `SuggestedReplies.tsx` renders
the `suggested_replies` block's `options` as tappable chips that re-send that exact text
(`SuggestedReplies.tsx`). A `TypingIndicator` shows while `isLoading` (`support.tsx:191`).

### 8.4 The four card renderers — real files, real testids

`artifacts/portal/src/components/support-chat/cards/`:

| File | Renders | `data-testid` |
|---|---|---|
| `ActiveCard.tsx` | dispatcher — `switch (card.cardType)`, `default: return null` | — |
| `InvoiceCard.tsx` | `InvoiceCardData` | `active-card-invoice` |
| `SubscriptionCard.tsx` | `SubscriptionCardData` | `active-card-subscription` |
| `ScoreCard.tsx` | `ScoreCardData` | `active-card-score` |
| `DataAnswerCard.tsx` | `DataAnswerCardData` | `active-card-data-answer` |
| `types.ts` | client-side shape guards (`asInvoiceCardData` etc.) + `formatCardDate` | — |
| `card-status.ts` | `statusBadgeVariant`/`formatStatusLabel` — keyword-based across all 4 cards' several different DB status enums | — |

Full field-by-field renderer behavior for each is folded into §4.1-4.4 above rather than
repeated here.

### 8.5 Honest-state contract for the renderer (confirmed as-built, not just as-specified)

The prior pack's §8 stated what the renderer *must* do. #2519 built it to spec:

- **A reply with no card is the default, unremarkable case.** `ChatBubble.tsx` only renders
  `<ActiveCard>` when `cardFrom(content)` returns non-null; there is no "card missing"
  placeholder, spinner, or error state — the bubble is simply text.
- **An authorized card whose `data` fails its own client-side shape guard renders
  nothing**, matching the server's "no fixture-as-fallback" discipline exactly
  (`ActiveCard.tsx`'s `data ? <Card data={data} /> : null` pattern, all four cases).
- **The one genuine empty state among the four** is `DataAnswerCard`'s `hasAnything` check
  (§4.4) — the only card whose data key is *always* present but can be *entirely* empty
  inside; the other three simply don't render if their key is `undefined`.

---

## 9. CURRENT vs DECIDED table

Every DECIDED row needs an issue number; a row without one is an **OPEN GAP**, not decided.
Rows marked **(updated)** changed state since the prior pack (`fc3466355`).

| Item | State | Issue | Notes |
|---|---|---|---|
| `invoice` card contract | **CURRENT** | #366 | `InvoiceCardData`, real `invoicesTable` |
| `subscription` card contract | **CURRENT** | #366 | `SubscriptionCardData`, sales-bundle assignments |
| `score` card contract | **CURRENT** | #366 | `ScoreCardData`, `clientScoresTable` |
| `data-answer` card contract | **CURRENT** | #366 | `DataAnswerCardData`, always-built composite |
| `card_router` (parse/route/strip) | **CURRENT** | #366 | `shanebot-engine.ts:950-1009` |
| `allowedCardTypes` gating | **CURRENT** | #1097/#366 | code-only field, not a DB column |
| `{type:"card"}` reserved block | **CURRENT (reserved, unwritten)** | #361 | never persisted (see §6) |
| **`artifacts/portal` chat shell + 4 card renderers** | **CURRENT (updated — was OPEN GAP)** | #2519 | §8; real `/support` page, real renderer library |
| **`data-answer` demoted to fallback, in the prompt** | **CURRENT (updated — was DECIDED, unimplemented)** | #1624 | §2/§4.4/§7; prompt text now encodes it, model behavior not independently re-verified here |
| Nine-card v1.1 set decision | **DECIDED** | #1616 | DECIDED comment 2026-08-28 |
| `remediation` card | **DECIDED (backing exists, card not built)** | #1616 (+#1489) | `WireTrackerStep`; body copy is fixture |
| `microsoft-change` card | **DECIDED (backing exists, card not built)** | #1616 (+#1530–#1533) | `WirePost`+`WireAnalysis` |
| `document` card | **DECIDED (backing exists, card not built)** | #1616 (+#347) | backing is `insightsGeneratedDocumentsTable`, not `documentsTable` |
| `finding` card real backing | **OPEN GAP** | #1616/#1489 | no `Wire*` finding contract exists; diagnostics-findings vs guide-findings unsettled |
| `ticket` card read-model | **OPEN GAP** | #1616 | escalation write path exists; no ticket READ endpoint |
| **No nav/dock entry point to `/support`** | **OPEN, expected pre-wire** | #1742 (+#1741) | §8.1; page works, is unreachable from the UI shell today |
| **Client mirror of `ChatContentBlock` duplicated, not imported** | **OPEN (noted, not a defect)** | — | §6/§8.3; `artifacts/portal` has no workspace-package dependency on the server type; a future drift here is a real risk, not filed as a bug since it's a known, accepted app-boundary pattern (same as `shane-mccaw-consulting`'s copy) |
| `change-request` card | **EXCLUDED for v1.1** | #1486/#1616 | CRs never execute (`drift-collector.ts:78`) |
| public-surface cards | **OUT OF SCOPE** | #1616 | `allowedCardTypes: []`, no `cardData` builder |
| `risk` / `ownership` / `sop`/`runbook` cards | **DEFERRED** | #1507 / #1515 / #1557 | blocked on known-wrong backing |

---

## 10. Sub-issues from the prior pack — resolved

Per #1616 ("For every real live endpoint or card type with no renderer, FILE A SUB-ISSUE
… The four existing card types having no portal renderer at all is the obvious first
one"), the prior pack filed:

- **#1622** "ShaneBot Active Cards: the four existing card types have no artifacts/portal
  renderer" — **CLOSED, built by #2519.** See §8.

No new sub-issue is filed at this pack's build time. The remaining gaps in §9
(`finding`, `ticket`, no-nav-entry) are already tracked — `finding`/`ticket` on #1616/#1489
itself, and the nav entry point on the already-open #1741/#1742 chain — so filing a
duplicate would violate the "check for existing tracking before filing" discipline. The
action-layer orphan noted in §8.2 belongs to #2450's pack/scope, not this one.

---

## 11. Gate note

**#1269's gate is not touched by this pack.** #1269 is an open `Shane To-Do` gate that
originally blocked *wiring* ShaneBot into the customer-facing portal (no human had used
ShaneBot yet). Per #2519's own body, that gate was explicitly removed by Shane's decision
before #2519 built the real chat shell — #2519 quotes it directly: "Gate removed — Shane's
explicit call." #1269 itself stays open (it also carries an unrelated unanswered question
about Marketing Page test runs) but no longer blocks this module. This pack is read-only
regardless and touches no product code.

---

## 12. Real enum/vocabulary honesty check (new section, per #1740's own extraction spec)

None of the four EXISTING cards' `status` fields are backed by a `pgEnum` — every one is a
`text` column with a TypeScript `{ enum: [...] }` literal (Drizzle's inline-checked-text
pattern, not a database-level enum type):

- `invoicesTable.status` — `text` + `["draft","due","paid","overdue"]` (`index.ts:748`)
- `mspSalesBundleAssignmentsTable.status` (subscription card) — `text` +
  `MSP_BUNDLE_ASSIGNMENT_STATUS` named constant (`lib/db/src/schema/msp.ts:3261`), same
  text-column pattern, not a `pgEnum`.
- `mspDiagnosticRunsTable.status` (data-answer's `latestScan.status`) — `text` +
  `MSP_DIAGNOSTIC_RUN_STATUS` named constant (`lib/db/src/schema/msp.ts:3300`), same
  pattern again.

The client's `card-status.ts` (`statusBadgeVariant`/`formatStatusLabel`, §8.4) is
deliberately **keyword-based, not a closed switch**, precisely because it spans several
different real DB status vocabularies across the four cards rather than one shared enum —
an honest design choice given there is no single "card status" vocabulary in the schema,
only several unrelated ones.

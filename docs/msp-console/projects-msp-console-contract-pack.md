# Projects (MSP Console) — contract extraction pack

**#2619**, under Feature **#2561** (`Feature: Projects (MSP Console)`), part of **#1571**
(EPIC: Portal Admin — MSP-side operator surface). Follows the **#1642 pattern**: the wire
contract extracted verbatim and cited to file:line, CURRENT vs DECIDED marked, real enum
unions only, cross-surface edges, honest-empty contract, orphaned-endpoint check. Read-only —
no product code, schema, or UI changed by this session; every count below is cross-checked
live against local Postgres (`shanemccawmsp`, `DATABASE_URL`).

**This is the first pack written for this Feature.** #2619's own issue body previously held
itself deliberately blocked ("no real backend issue exists yet") — that premise is now stale.
The real Phase 1 backend landed and closed under **#3773**: `kanban_buckets` / `kanban_cards`,
`artifacts/api-server/src/routes/msp-kanban.ts`. Nav placement (#3768) is explicitly **not** a
precondition for this pack per Shane's 2026-09-14 dispatch comment — the real tree location
gets decided during the Design pass itself, using this pack as its input.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-kanban.ts` — the route itself (all line refs below are
  into this file unless stated otherwise); 421 lines, 7 routes, no test file exists for it yet
  (confirmed: no `msp-kanban.test.ts` anywhere in the tree)
- `lib/db/src/schema/msp.ts:9639-9671` — `kanbanBucketsTable`, `kanbanCardsTable`,
  `insertKanbanBucketSchema`, `insertKanbanCardSchema`, and the four inferred types
- `lib/db/migrations/manual/2026-09-12-kanban-buckets-cards-3773.sql` — the real DDL as applied
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireCapability`,
  `assertCustomerAccess`, `resolveStaffScopedCustomerIds`
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict`
- `artifacts/api-server/src/routes/index.ts:137,479` — router import + mount
- `artifacts/api-server/src/app.ts:127` — confirms the real, live path prefix is
  `/api` (`app.use("/api", subscriptionGate, router)`)
- `artifacts/api-server/src/routes/msp-status-reports.ts` — the sibling route this file's own
  header cites as sharing the same auth/ownership pattern (`msp-status-reports.ts:37-45`)
- `artifacts/api-server/src/routes/portal-delivery-kanban.ts` — a **separate, pre-existing**
  Kanban system, cited for the cross-surface edge in §6
- Live local Postgres: `kanban_buckets`, `kanban_cards`, `kanban_tasks`,
  `msp_feature_role_mapping`, `rbac_capabilities`, `msp_roles` — row counts and RBAC allow-list
  queried directly, not assumed

---

## 1. Wire contract — the 7 routes

Every route: `requireCapability("ladder.msp-operator")` (`:127` etc — every route gate in this
file), then `assertCustomerAccess` against the real owning `customerId` (either the URL param
directly, or resolved from the row first for the `:id`-only routes). **Confirmed live**: the
`ladder.msp-operator` row in `msp_feature_role_mapping` (`msp_id IS NULL`, the platform-default
row) has `allow: [MSPOperator, MSPAdmin, PlatformAdmin]` — resolved by uuid against
`msp_roles` — matching this file's own header claim (`:40-41`) exactly; no drift between the
header comment and the live RBAC row.

| Route | Auth extra | Body schema | Success | Notes |
|---|---|---|---|---|
| `POST /api/msp/customers/:customerId/kanban/buckets` | `resolveMspIdStrict` must be non-null (`:133-134`, else 403 `{error:"MSP context required"}`) | `createBucketSchema` | `201 {bucket}` | `position` defaults to end-of-list via `nextBucketPosition` (`:106-112`, `MAX(position)+1`, `-1+1=0` on an empty board) if omitted |
| `GET /api/msp/customers/:customerId/kanban/buckets` | — | — | `200 {buckets: [...]}` | Each bucket carries its own `cards` array, both ordered by `position asc` (`:179,190`) — this is the full board shape a UI renders in one call |
| `PATCH /api/msp/kanban/buckets/:id` | Row-resolved ownership (`:220-225`) | `patchBucketSchema` (both fields optional) | `200 {bucket}` | Empty body (`{}` or all-undefined) is `400 {error:"No fields to update"}` (`:231-233`) — not a silent no-op 200 |
| `DELETE /api/msp/kanban/buckets/:id` | Row-resolved ownership | — | `204` | Cascades to the bucket's cards via `ON DELETE CASCADE` (migration `:28`) — no confirmation, no card-count warning in the response |
| `POST /api/msp/kanban/buckets/:bucketId/cards` | Row-resolved ownership via the bucket (`:292-297`) | `createCardSchema` | `201 {card}` | `position` defaults to end-of-list within that bucket (`nextCardPosition`, `:114-120`) |
| `PATCH /api/msp/kanban/cards/:id` | Row-resolved ownership via the card's **current** bucket (`:338-345`) | `patchCardSchema` | `200 {card}` | See §2 for the cross-bucket move rule |
| `DELETE /api/msp/kanban/cards/:id` | Row-resolved ownership via the card's bucket | — | `204` | — |

Every `:id`-not-a-number case (`isNaN`) is `404 {error:"Not found"}`, **not** `400` — a
deliberate divergence from the two `:customerId`-scoped routes, which are `400
{error:"Invalid customerId"}` on a non-numeric param (`:130,168` vs `:217,261,289,332,396`).
This is CURRENT, not DECIDED: nothing in the code or #3773 explains the split; it reads as
"the customer-scoped routes validate the param, the id-only routes treat a bad id as
not-found" — a consistent internal rule, just not a documented one.

### `bucketToWire` (`:60-69`)

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `kanban_buckets.id` (serial) |
| `customerId` | `number` | not null | `kanban_buckets.customer_id` |
| `name` | `string` | not null | `kanban_buckets.name` |
| `position` | `number` | not null | `kanban_buckets.position` |
| `createdAt` | `string` (ISO) | not null | `.toISOString()` of `created_at` |
| `updatedAt` | `string` (ISO) | not null | `.toISOString()` of `updated_at` |

**`mspId` is stored on every bucket row (`kanban_buckets.msp_id`, migration `:15`) but is never
put on the wire** — `bucketToWire` omits it entirely (`:60-69`). It exists purely as a
server-side scoping/index column (`kanban_buckets_msp_id_idx`, migration `:23`); a caller never
sees which MSP a bucket belongs to, which is correct since the caller is already scoped to
exactly one MSP by the auth layer.

### `cardToWire` (`:71-81`)

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `kanban_cards.id` |
| `bucketId` | `number` | not null | `kanban_cards.bucket_id` |
| `title` | `string` | not null | `kanban_cards.title` |
| `description` | `string \| null` | nullable | `kanban_cards.description` (real DB `null`, not `undefined` — `TEXT` column with no default, `.description` passed straight through) |
| `position` | `number` | not null | `kanban_cards.position` |
| `createdAt` | `string` (ISO) | not null | — |
| `updatedAt` | `string` (ISO) | not null | — |

A card carries **no `customerId` field of its own** — it is reached only via its parent
bucket's `customerId`, both on the wire (nested under `GET .../buckets`) and for every
ownership check (`currentBucket.customerId`, `:343`).

---

## 2. Real business rules — request-body schemas and move semantics

- **`createBucketSchema`** (`:83-86`): `name` — trimmed string, 1-200 chars; `position` —
  optional non-negative integer.
- **`patchBucketSchema`** (`:88-91`): both fields optional, same constraints; at least one
  required (enforced post-parse, `:231-233`, not by the Zod schema itself).
- **`createCardSchema`** (`:93-97`): `title` — trimmed string, 1-500 chars; `description` —
  optional trimmed string, max 10,000 chars (note: optional-but-not-nullable on create — you
  cannot explicitly create a card with a `null` description, only omit it, which the DB then
  defaults to `null` via `parsed.data.description ?? null`, `:311`); `position` — optional
  non-negative integer.
- **`patchCardSchema`** (`:99-104`): `title` optional; **`description` is `nullable().optional()`**
  — the one field in this file where a caller can explicitly clear a value (`PATCH {description:
  null}` sets it to `null`; omitting the key leaves it untouched, distinguished via
  `parsed.data.description !== undefined`, `:372`); `bucketId` — optional integer (move target);
  `position` optional non-negative integer.
- **Cross-bucket move rule** (`:355-366`): moving a card (`bucketId` changed) resolves the
  **target** bucket and requires `targetBucket.customerId === currentBucket.customerId` — i.e.
  a card can move between buckets **within the same customer's board only**. Attempting to move
  it onto a bucket owned by a different customer (even one within the same MSP) is `400
  {error:"Target bucket does not belong to this customer"}` — this is checked by direct
  customer-id equality, not by re-running `assertCustomerAccess` against the target, so it holds
  even for a PlatformAdmin (no cross-customer move exists for anyone). If `bucketId` is supplied
  but equal to the card's current bucket, `targetBucketId` short-circuits to the existing value
  (`:356`) — a same-bucket reposition-only PATCH is not treated as a "move."
- **Position is never renumbered.** No route ever shifts sibling `position` values on
  insert/delete/reorder — a caller (the eventual UI) owns computing and sending the full set of
  new `position` values for a drag-reorder; the backend stores whatever integer it's given, and
  ties are legal (nothing enforces uniqueness of `(bucket_id, position)` or `(customer_id,
  position)` at the DB or app layer). This is CURRENT behavior worth Design/UI knowing: a
  naive "just PATCH the one card I dragged" implementation will produce duplicate positions
  among untouched siblings unless the client also PATCHes them.

---

## 3. Real enum unions

**There are none.** Phase 1 deliberately has no `type`/`status`/`state` column on either table
— `kanban_cards` is "plain title/description/position/bucket" by explicit design (schema
comment, `msp.ts:9655-9656`; migration comment `:6-9`). No CHECK constraint, no Zod `z.enum`,
no application-level status vocabulary exists anywhere in this surface. This is a real,
confirmed absence, not a gap this pack invents — Phase 2 (per #3768's roadmap, cited in this
file's own header `:10-14`) is where a `type` field and per-type shapes are expected to land.

---

## 4. Honest-empty / partial-data contract

- **A customer with no buckets yet**: `GET .../buckets` short-circuits to `{buckets: []}`
  before ever querying `kanban_cards` (`:181-183`) — no wasted second query, and a real empty
  array, not a fixture.
- **A bucket with no cards**: `cardsByBucket.get(b.id) ?? []` (`:200`) — real `[]`, never
  omitted or `null`.
- **Confirmed against local Postgres**: `kanban_buckets` and `kanban_cards` are both genuinely
  **0 rows** in the local dev database right now. This Phase 1 backend has shipped and closed
  (#3773) but has never been exercised by a real caller — consistent with §6 below (no UI, no
  frontend caller anywhere in the tree). A read against this surface today returns an honest,
  universal empty board for every customer, not a partial one.
- **Delete is unconditional** — no "board must have at least one bucket" rule, no soft-delete,
  no undo. Deleting every bucket on a board leaves `GET .../buckets` returning `{buckets: []}`
  indistinguishable from a board that was never populated.
- **A 500 on any route** is a fixed, generic per-route message (`"Failed to create bucket"` /
  `"Failed to load kanban board"` / etc., one per handler) — no partial-success shape exists
  anywhere in this file; every mutation is a single-row `insert`/`update`/`delete`, so there is
  no multi-step operation that could partially apply.

---

## 5. Not covered by this pack (real, current absences — Phase 1 scope only)

Per the dispatch instructions, confirming real completeness rather than assuming anything
beyond buckets/tasks exists:

- **No card `type` field, no per-type forms** — Phase 2, explicitly out of scope (file header
  `:10-11`, #3768 roadmap).
- **No Project Templates** — Phase 3 (file header `:11-12`).
- **No connection to #3433 (Project Milestones), #3769 (Communications Push tracker — schema
  exists at `msp.ts:9673+` but is its own independent backend, not wired to kanban), #3770
  (Training), or #3771 (Automation Registry)** — all confirmed still independent, standalone
  entities; none of their tables carry a `kanban_card_id` or reverse FK, matching the file
  header's explicit statement (`:12-14`).
- **No MSP Console UI screen** — blocked on #3768's nav placement, confirmed: zero React
  components, zero API client calls, zero routes reference `kanban/buckets` or `kanban/cards`
  anywhere under `artifacts/msp-portal` or `artifacts/admin-panel` (see §6's grep).
- **No bulk/batch endpoints** — no "reorder all buckets in one call," no "move N cards at
  once." Every mutation is single-row.
- **No customer-facing (portal) read of this board at all** — every route in this file requires
  `ladder.msp-operator` or above; there is no `/api/portal/...` sibling. A customer using the
  portal has no visibility into their own Kanban board today, by design (Phase 1 is
  MSP-operator-facing only, per the file header's own scope statement).
- **No `GET` single-bucket or single-card endpoint** — only the list-the-whole-board `GET`
  exists; `PATCH`/`DELETE` resolve a row internally but never expose a "fetch one" route.

---

## 6. Cross-surface edges

- **A second, unrelated "Kanban" already exists and is live: `portal-delivery-kanban.ts`.**
  This is a real, distinct, already-wired system — `kanban_tasks` table (not `kanban_cards`),
  backed by `projectsTable`, a **fixed 5-column pipeline** (`backlog → in_progress →
  waiting_on_customer → review → completed`, per that file's own header), SSE-synced
  (`broadcastKanbanChange`), with admin-only Workflow/Monitoring trigger actions per task and
  an admin/customer field-visibility split (`internalNotes` stripped from customer reads). It
  is mounted (`routes/index.ts:261,628`) and **actually called from the frontend** —
  `artifacts/admin-panel/src/pages/crm/ProjectDetail.tsx` — unlike this pack's #3773 backend,
  which has zero callers. Both systems are named "kanban" in their own filenames and both live
  under MSP-facing surfaces, but they share no table, no route prefix, and no code. **This is a
  real disambiguation risk for the #3768 Design pass**: "Projects" nav placement needs to
  account for the fact that a project-scoped Kanban board already exists and ships today
  (fixed pipeline, tied to `projectsTable`), separate from the new free-form,
  customer-scoped-but-project-agnostic buckets/cards model this pack documents. Confirmed live:
  `kanban_tasks` is also 0 rows in local dev right now (built and wired, but not yet populated
  with real data either) — so neither Kanban surface has live data today, but only
  `portal-delivery-kanban.ts` has a UI that could create some.
- **vs. `msp-status-reports.ts`** (the sibling this file's own header cites as sharing its auth
  pattern, `:40-45`): identical `requireCapability("ladder.msp-operator")` +
  `assertCustomerAccess` shape, identical "resolve the row first, then check its real owning
  customerId, so a foreign id 404s rather than confirms existence" rule for `:id`-only routes.
  The one difference: `msp-status-reports.ts` additionally calls `resolveMspIdStrict` for
  every route; `msp-kanban.ts` only calls it on bucket **create** (`:133`), because that is the
  only route that needs to stamp a fresh row's `msp_id` — every other route derives ownership
  from an existing row's `customerId`/`bucketId` chain instead.
- **Per-staff-member scoping (`resolveStaffScopedCustomerIds`) is not applied anywhere in this
  file.** `assertCustomerAccess` does fold in `isCustomerBlockedByStaffScope` internally
  (`requireAuth.ts:412`) for the single-customer ownership checks this file uses everywhere —
  so a scoped MSP staff member **is** correctly blocked from a customer outside their
  assignment on every route here. There is simply no list/aggregate route in this file that
  would need the separate `resolveStaffScopedCustomerIds` multi-id form (unlike
  `msp-customer-timeline.ts`'s cross-tenant merge) — Phase 1 has no "all my customers' boards"
  view.
- **`customerId` is a `tenants.id` with no FK** (migration comment `:6-9`) — the same
  deliberate "successor id-space, no FK by design" convention as `msp_status_reports.customer_id`
  and `break_glass_pending_secrets`, cited verbatim in both the migration and the schema file's
  own comments (`msp.ts:9635-9637`).

---

## Orphaned-endpoint check

```
grep -rln "msp/customers/.*kanban\|msp/kanban" artifacts/ --include=*.ts --include=*.tsx
```

returns only `artifacts/api-server/src/routes/msp-kanban.ts` itself — no frontend caller
anywhere in the current tree, and (per §6) no confusion with `portal-delivery-kanban.ts`'s
separate `kanban/tasks`-shaped calls either, which grep independently for
`delivery-kanban|kanbanTasksTable|/kanban/tasks|projects/.*kanban` and resolve only to
`ProjectDetail.tsx`. This is expected, current state, not a gap this pack invents: #3773 was
explicitly backend/data-model only, blocked on #3768 for a UI. The endpoints are real, live,
and mounted (`app.ts:127` → `routes/index.ts:479`) but exercised by nothing today.

---

## Findings filed

None. No drift, bug, or stale-comment finding was found in this backend during this audit —
the file's header comment matches the live code and the live RBAC row exactly (§1), and the
one thing that could read as a gap (two same-named "kanban" systems) is a real design input
for #3768, not a bug in either system; it is recorded here rather than filed as its own issue.

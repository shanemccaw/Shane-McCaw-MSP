# Communications Push tracker — MSP Console contract extraction pack

**#4078**, generated per the #1642 pattern (Feature roadmap #3768 — Projects/Milestones +
Communications/Training/Workflows/Agents nav placement). Read-only extraction. Every field below
is taken verbatim from the route's own code and the Drizzle schema, cited to file:line, and
cross-checked live against local PostgreSQL. **Nothing here is authored or invented.** No product
code, schema, or UI was changed by this pass — this pack is a prerequisite for a future Design
pass under #3768, not the Design pass itself.

Backend route (live, mounted — `artifacts/api-server/src/routes/index.ts:486`):
`artifacts/api-server/src/routes/msp-communications-push.ts` — **518 lines, 23,498 bytes, 9
routes**. Built under Git #3769 (`6a6d1b525`).

**Confirmed complete, not half-built.** Read in full, not sampled: no `TODO`/`FIXME`/`XXX`/stub
markers anywhere in the file (grep-confirmed). Every route the file's own header comment
(`:16-50`) declares is actually implemented below, with matching behavior. The one thing
genuinely absent is a UI to call it from (§0) — a Design/wire-step gap, not a backend gap this
pack's own module is responsible for.

**Not a delivery/send system.** The file's own header (`:4-11`) is explicit: this is a real
project-management tracking tool. Shane initiates a "communications push" (an upcoming
change/release), assigns it to a customer, and the tool tracks a cascade of checkpoint reminders
(e.g. 60/45/30 days before the effective date) so he doesn't forget to send each one himself. Who
it goes out to and how is entirely on him — **no recipient list, no email/Teams integration, no
send mechanism of any kind exists in this module.** Do not read "Communications" in the Feature
name as implying an outbound-messaging surface; it does not have one.

Schema: `lib/db/src/schema/msp.ts:9803-9843` (`communicationsPushesTable` /
`communicationsPushCheckpointsTable`, tables `communications_pushes` /
`communications_push_checkpoints`). Migration: `lib/db/migrations/manual/2026-09-12-communications-push-3769.sql`.
Verified live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d communications_pushes'` /
`'\d communications_push_checkpoints'`) — every column below is confirmed present on the running
schema, column-for-column identical to the Drizzle source, including both real indexes per table
and the two real FKs (`communications_pushes.msp_id → msps.id ON DELETE CASCADE`,
`communications_pushes.created_by_user_id → users.id`,
`communications_push_checkpoints.push_id → communications_pushes.id ON DELETE CASCADE`).
**`communications_pushes.customer_id` carries no FK** — confirmed by the live `\d` output listing
only two FKs on the parent table, neither touching `customer_id`. This is a deliberate, documented
convention, not an oversight: both the route file's own header (`:11-12` via the migration
comment) and the migration file itself (`:9-12`) state it matches the existing "successor
id-space, no FK by design" convention already used by `msp_status_reports`,
`kanban_buckets`/`kanban_cards`, and `break_glass_pending_secrets`.

`communications_push_checkpoints.state` **is** DB-CHECK-enforced — confirmed live:
`CHECK (state = ANY (ARRAY['pending'::text, 'done'::text]))`, matching the Drizzle
`{ enum: COMMUNICATIONS_PUSH_CHECKPOINT_STATES }` declaration exactly. This is the *enforced*
case (contrast the RBD pack's `risk_instances.status`, also DB-checked, versus the audit-log
pack's `msp_audit_logs.outcome`, which is Drizzle-only with no real DB constraint) — worth noting
because this repo has both shapes live and they aren't interchangeable at the schema level.

---

## 0. The surface and its consumers

**No MSP Console UI reads this route yet.** `artifacts/msp-console` has no `communications-push`
page or component (confirmed: no file matching `*communicat*` anywhere under
`artifacts/msp-console`). `Design/MSP_Console/design_handoff_msp_console/github.md` lists
`msp-communications-push` on both its "new/added upstream with no mapped screen" note (`:188`)
and the "Not yet covered" route list (`:324`), and explicitly states the reason (`:166`): it is
"outside this console's current screen map" — the expected pre-Design state for a Feature at the
Document step, not a gap this pack invents.

No other surface (MCP server, admin-panel, portal) reads or writes these tables either — grep-
confirmed no reference to `communicationsPushesTable`, `communicationsPushCheckpointsTable`,
`communications_pushes`, or `communications_push_checkpoints` outside
`lib/db/src/schema/msp.ts` and `msp-communications-push.ts` itself. This module is currently
API-only, consumed by nothing.

| Endpoint | Method | Gate | Consumer today |
|---|---|---|---|
| all 9 routes below | — | `requireCapability("ladder.msp-operator")` (`:170`, `:229`, `:281`, `:304`, `:368`, `:391`, `:472`, `:478`, `:487`) | none — no UI, no MCP tool, no other route reads these tables |

`requireCapability("ladder.msp-operator")` (`requireAuth.ts:271-307`) resolves via
`userClearsLadderCapability` against the `msp_feature_role_mapping` table, exactly the mechanism
the audit-log pack's §0 documents. **Live-verified** (`psql` against `msp_feature_role_mapping`
joined to `msp_roles`, platform-level row, `msp_id IS NULL`): the allow set for
`ladder.msp-operator` is `{MSPOperator, MSPAdmin, PlatformAdmin}` — matching the route file's own
header comment (`:52-53`) exactly. `MSPOperator` is the floor; there is no rung below it that
clears any route in this file. On a genuinely unconsultable RBAC model the route fails **closed**
with a 503, same as every other `requireCapability`-gated route in this codebase — not an open
403-as-allow.

Every `:customerId`-scoped route additionally runs `assertCustomerAccess(req.user!, customerId)`
(`requireAuth.ts:393-419`) — for an `MSPAdmin`/`MSPOperator` caller this resolves the customer
via `tenantsTable.mspId = user.mspId`, so a customer belonging to a different MSP 404s rather than
403s (indistinguishable from a non-existent customer, by design). The `:id`/`:checkpointId`-only
routes (no `:customerId` in the path) resolve the row first via `loadOwnedPush` (`:131-144`) or
the inline lookup in `setCheckpointState` (`:423-464`)/the checkpoint-delete handler (`:485-516`),
then run the identical `assertCustomerAccess` check against the row's own stored `customerId` —
so an id belonging to another MSP's customer 404s rather than confirming the row exists. This is
the same ownership-check shape `msp-status-reports.ts` uses, per the route file's own header
(`:54-58`), and is verified accurate against the actual code at every one of the five id-scoped
handlers.

---

## 1. Wire contract

### 1.1 `POST /api/msp/customers/:customerId/communications-pushes` — create a push

**`msp-communications-push.ts:168-222`.** Creates one push and, if any `offsetDays` are supplied,
its checkpoint rows in the same call.

Request body (`createSchema`, `:148-153`):

| Field | Type/validation | Required |
|---|---|---|
| `title` | string, trimmed, 1-200 chars | yes |
| `description` | string, trimmed, max 5000 chars | no |
| `effectiveDate` | ISO datetime string with offset (`z.string().datetime({ offset: true })`) | yes |
| `offsetDays` | array of positive integers ≤3650, 1-50 entries | yes |

**`offsetDays` is not hardcoded to 60/45/30.** The route file's own header (`:18-21`) and the
migration file (`:14-16`) both state this explicitly: 60/45/30 is only a UI-level default
suggestion the *caller* passes; the route accepts any 1-50 positive-integer offsets and creates
one checkpoint row per offset, each independently.

Server behavior: resolves `mspId` from `req.user!.mspId` via `resolveMspIdStrict` (`:176`,
`resolve-msp-id.ts:76-78` — a direct `req.user?.mspId ?? null` read, not a DB query), 403s
`"MSP context required"` if the caller has no `mspId`. Runs `assertCustomerAccess` before
touching the DB (`:179-181`). Inserts the push row, then (if `offsetDays.length > 0`) inserts one
checkpoint per offset in a single batched `insert().values([...])` call (`:202-214`), each
checkpoint's `checkpointDate` computed by `resolveCheckpointDate` (`:126-129`:
`effectiveDate.getTime() - offsetDays * 86400000`, i.e. exact calendar-day subtraction, not a
month-aware calculation) and `state: "pending"`. Responds `201` with `{ push: <wire shape> }`
(§1.2 below has the shape). Malformed body → `400` with Zod's `flatten()` details. Any DB error →
`500`, logged via `log.error` on the `tenant.portal` channel (`:74`, `:218`).

### 1.2 `GET /api/msp/customers/:customerId/communications-pushes` — list, paginated

**`:227-274`.** `assertCustomerAccess` first (`:235-237`). Real `?limit=&offset=` pagination
(`:239-242`): `limit` clamped to `[1, 200]`, default `50`; `offset` clamped to `≥0`, default `0` —
both parsed with `Number.isFinite` guards against non-numeric query values (falls back to the
default rather than `NaN`ing through). Query: all pushes for the customer, `ORDER BY
effective_date DESC` (`:244-250` — newest effective date first, matching the header comment
`:24`), then a second batched query loads every returned push's checkpoints via `loadCheckpoints`
(`:111-124`, one `WHERE push_id = ANY(...)` call, not N+1).

**This is the one route in the file that calls `auditPrivilegedRead`** (`:254-262`) —
`actionType: "communications_push.customer_list_viewed"`, `entityType: "communications_push"`,
`tenantId: customerId`, `metadata: { count: rows.length }`. This matches the exact pattern
`msp-kanban.ts:200-207`'s `kanban_board_viewed` call uses (list-level audit only, not per-item) —
confirmed by direct comparison, not assumed; every other `msp-*.ts` route wired under #4046 audits
only the customer-scoped list/detail entry point, not every downstream row read, and this route
is consistent with that.

Response: `{ pushes: [<wire shape>...], limit, offset }`.

### 1.3 `GET /api/msp/communications-pushes/:id` — one push with checkpoints

**`:279-297`.** `loadOwnedPush` (`:133-144`) resolves the row and re-runs
`assertCustomerAccess` against its stored `customerId`; non-numeric `:id` → `404` before any
query (`:283-284`, not `400` — a malformed id is treated identically to a not-found one).
Response: `{ push: <wire shape> }`. No audit call on this route.

### 1.4 `PATCH /api/msp/communications-pushes/:id` — edit

**`:302-361`.** Body (`patchSchema`, `:155-159`): `title` (1-200 chars), `description`
(nullable — explicit `null` clears it, `undefined`/omitted leaves it unchanged), `effectiveDate`
(ISO datetime with offset) — all optional, but at least one field required (`:317-319`, `400
"No fields to update"` if the parsed body is `{}`).

**Editing `effectiveDate` recomputes every still-`pending` checkpoint's `checkpointDate`** from
its own stored `offsetDays` (`:337-352`) — a real per-row loop, re-querying all checkpoints for
the push and updating each one individually (not a single batched UPDATE). **`done` checkpoints
are explicitly skipped** (`:343` — `if (cp.state !== "pending") continue`): the route file's own
comment (`:334-336`) states the rationale — "a reminder already sent doesn't un-send itself
because the date moved." Response: `{ push: <wire shape> }` with the (possibly recomputed)
checkpoints. No audit call.

### 1.5 `DELETE /api/msp/communications-pushes/:id` — delete push + checkpoints

**`:366-384`.** `loadOwnedPush` gate, then a single `DELETE FROM communications_pushes WHERE id =
:id`. Checkpoint deletion is **not** a second application-level query — it relies entirely on the
DB's own `ON DELETE CASCADE` on `communications_push_checkpoints.push_id`
(confirmed live: `communications_push_checkpoints_push_id_fkey ... ON DELETE CASCADE`). `204 No
Content` on success. No audit call.

### 1.6 `POST /api/msp/communications-pushes/:id/checkpoints` — add an offset

**`:389-421`.** `loadOwnedPush` gate. Body (`addCheckpointSchema`, `:161-163`): single
`offsetDays` (same positive-integer-≤3650 validation as create). Inserts one checkpoint row,
`checkpointDate` computed from the **push's existing `effectiveDate`** (not a caller-supplied
date), `state: "pending"`. `201` with `{ checkpoint: <wire shape> }`. No audit call.

### 1.7 / 1.8 `PATCH /api/msp/communications-pushes/checkpoints/:checkpointId/done` and `/pending`

**`:466-480`**, both routed through the shared `setCheckpointState` helper (`:423-464`). Loads
the checkpoint, then its parent push, then runs `assertCustomerAccess` against the push's
`customerId` (`:435-442`) — the checkpoint itself carries no `customerId`, so ownership is always
resolved one hop up through its push. **Idempotent**: if the checkpoint is already in the target
state, returns the existing row unchanged with `200` rather than erroring or re-writing
(`:444-447`, matching the route file's own header claim at `:43-44`). Transitioning to `done` sets
`doneAt: new Date()`; transitioning to `pending` clears it (`doneAt: null`, `:452-453`) — so
`doneAt` is always a real timestamp or `null`, never stale from a prior `done` cycle. No audit
call on either.

### 1.9 `DELETE /api/msp/communications-pushes/checkpoints/:checkpointId` — remove one checkpoint

**`:485-516`.** Same lookup-then-`assertCustomerAccess`-via-parent-push shape as 1.7/1.8. Deletes
exactly the one checkpoint row (does not touch the parent push). `204 No Content`. No audit call.

---

## 2. Wire shapes

`pushToWire` (`:94-109`):

```json
{
  "id": 1,
  "customerId": 42,
  "title": "string",
  "description": "string | null",
  "effectiveDate": "ISO 8601 string",
  "createdByUserId": 7,
  "createdAt": "ISO 8601 string",
  "updatedAt": "ISO 8601 string",
  "checkpoints": ["<checkpoint wire shape>", "... sorted by offsetDays DESC"]
}
```

Checkpoints on a push are sorted **descending by `offsetDays`** at serialization time (`:105-106`
— `.sort((a, b) => b.offsetDays - a.offsetDays)`, applied fresh on every response, not persisted
order), i.e. the furthest-out reminder (e.g. 60 days) first, nearest (e.g. 30 days) last — matching
a natural reading order for an upcoming-deadline checklist.

`checkpointToWire` (`:81-92`):

```json
{
  "id": 1,
  "pushId": 1,
  "offsetDays": 30,
  "checkpointDate": "ISO 8601 string",
  "state": "pending | done",
  "doneAt": "ISO 8601 string | null",
  "createdAt": "ISO 8601 string",
  "updatedAt": "ISO 8601 string"
}
```

All four date fields on both shapes are always real `Date.toISOString()` calls — never a raw DB
value passed through, never a placeholder string.

---

## 3. Real vocabularies

| Vocabulary | Values | Enforced where |
|---|---|---|
| `communications_push_checkpoints.state` | `pending`, `done` | **Both** Drizzle (`msp.ts:9829`, `{ enum: [...] }`) **and** a live DB `CHECK` constraint (confirmed via `\d`) — genuinely double-enforced, not Drizzle-only |

No other enum/status vocabulary exists in this module. There is no "overdue" or "missed" state —
a checkpoint whose `checkpointDate` has passed while still `pending` is not distinguished at the
data layer; that would be a UI-side derived-from-`checkpointDate`-vs-now computation if/when a
screen is built, not a stored state this pack can report as existing.

---

## 4. Live data — queried against local PostgreSQL, 2026-09-14

```
select count(*) from communications_pushes;          -- 0
select count(*) from communications_push_checkpoints; -- 0
```

**Both tables are genuinely empty.** This module has shipped its backend (Git #3769) but has
never been exercised through the API — no push has ever been created against local dev. This is
reported honestly rather than fabricating sample rows to make the pack look more populated than
reality: per this repo's standing rule, a contract pack extracts real state, and real state here
is zero rows.

---

## 5. Provenance

- Extracted against `main` at commit `24b7452bd550b962bfd626695f3a50596211c5a2`, 2026-09-14.
- Route file: `artifacts/api-server/src/routes/msp-communications-push.ts` (518 lines, 23,498
  bytes), introduced by Git #3769 (`6a6d1b525`), extended by Git #4046 (`8345e3d8f`, adding the
  one `auditPrivilegedRead` call at `:254-262` — an 11-line addition, accounting for the byte-size
  drift from this issue's originally-cited 22,980 bytes to the 23,498 confirmed here).
- Schema: `lib/db/src/schema/msp.ts:9789-9843`.
- Migration: `lib/db/migrations/manual/2026-09-12-communications-push-3769.sql`.
- Live schema and row counts confirmed via direct `psql "$DATABASE_URL"` against local PostgreSQL
  18, not `shaneapp://executeSql` (this is local dev work, not Replit/Staging debugging).
- No findings filed. The module is complete for what it declares itself to be (a real, working
  backend with no UI yet) — the absence of a UI is the expected pre-Design state for a Feature
  parked at the Document step, not a bug in this module.

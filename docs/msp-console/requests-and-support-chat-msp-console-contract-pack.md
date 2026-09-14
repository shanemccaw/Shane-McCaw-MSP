# Requests and Support Chat (MSP Console) — contract extraction pack for Claude Design

**#4083**, under **#2570** ("Feature: Requests and Support Chat (MSP Console)"), same
**#1485** (EPIC: Portal) lineage, same **#1642** method — per-surface wire contracts
extracted verbatim and cited to file:line, real enum unions only, cross-surface edges,
honest tri-state, orphaned endpoints listed explicitly. Read-only — no product code,
schema, or UI changed.

**This is a relocation, not a fresh extraction.** The real MSP-operator backend
(`msp-support.ts` + 3 org-scoped `lib/zoho-desk.ts` functions) was confirmed built under
#2672 and originally documented as a §16-19 addendum inside
`docs/portal/requests-and-support-chat-contract-pack.md` (added 2026-09-04, #2648, part of
this same #2570 Feature). The Design pass for #1485 reads only `docs/msp-console/`, so that
material belongs here instead — this pack is that content, re-verified against live code
and moved to the naming/structural convention every other landed `docs/msp-console/*`
pack uses (see `docs/msp-console/offboarding-msp-console-contract-pack.md` for the sibling
example of a Portal-pack/MSP-console-pack split on the same underlying Feature pair).

**Every citation below was re-checked against the live code on 2026-09-14, not copied
blind from the 2026-09-04 addendum.** One real drift was found and corrected in this
pack — see "Auth" under §1 below; everything else (route logic, response shapes, line
numbers) matched the source addendum exactly.

Backend route file: `artifacts/api-server/src/routes/msp-support.ts` (all 3 routes real,
confirmed live and under test — `msp-support.test.ts` — before any of this was written).
Backing reads/writes: `artifacts/api-server/src/lib/zoho-desk.ts`.

- `GET /api/msp/support/requests` — `msp-support.ts:54-79` (operator list)
- `GET /api/msp/support/requests/:ticketId` — `msp-support.ts:85-113` (operator detail + full thread)
- `POST /api/msp/support/requests/:ticketId/reply` — `msp-support.ts:121-172` (operator reply / internal note)

**Shared Portal-side schema — cite, don't re-derive:** `CustomerTicketSummary` and
`CustomerTicketThreadEntry` (`zoho-desk.ts:363-384`) are the exact same wire shapes the
customer-facing Portal routes use. For the full field-by-field breakdown of those types,
the customer-scoped read/write routes they also back, and the shared
`zoho_desk_create_ticket` / `zoho_desk_add_comment` job plumbing, see
`docs/portal/requests-and-support-chat-contract-pack.md` §7-§15 — not reproduced here.
This pack documents only the operator-side surface: the three routes above, their real
differences from the customer-facing routes, and the enum/cross-surface edges specific to
the operator side.

---

## 1. `GET /api/msp/support/requests` (operator list)

`msp-support.ts:54-79`.

**Auth — corrected from the 2026-09-04 addendum:** gated
`requireCapability("ladder.msp-operator")` (`:54`), **not** `requireRole("MSPOperator")`.
The array-index `ROLE_ORDER`/`requireRole` mechanism the addendum cited was retired
between #2648 and this pack (`requireAuth.ts:84-119`'s own removal note, #2460, part of
the #1696 RBAC-ladder migration) — `requireRole` no longer exists in `requireAuth.ts` at
all (confirmed: `grep -n "requireRole" requireAuth.ts` returns only a doc-comment
mentioning the function it replaced). `requireCapability` (`requireAuth.ts:271-307`)
consults a DB-backed capability model (`@workspace/db/rbac/evaluate`) instead of a static
array.

The **effective floor is unchanged**: `ladder.msp-operator`'s seeded allow-set is
`{MSPOperator, MSPAdmin, PlatformAdmin}` (`rbac-ladder.ts:19-22`'s own worked example for
the sibling `ladder.msp-admin` key — same construction), i.e. MSPOperator is a
**minimum**, not an exact match, same as the old comparison. The 403 body on a genuine
denial is deliberately byte-identical to what `ROLE_ORDER` produced
(`requireAuth.ts:262-264`, asserted by `rbac-ladder.live-db.test.ts`), so a client sees no
difference from this migration on the denial path.

**One real new failure mode the addendum never had to document**, because a static array
can't produce it: if the RBAC model can't be consulted at all (`requireAuth.ts:283-294`)
— the one real, predictable cause being an environment where the ladder-seed migration
hasn't run (`rbac-ladder.ts:56-58`: recorded on #1630 as a Replit/Staging release-gate
action, so Staging genuinely lacks these rows today) — the route answers **503**
`{ error: "Authorization is temporarily unavailable" }` rather than a 403. This is NOT a
denial; it fails closed rather than silently falling back to any older check
(`rbac-ladder.ts:62-67`). A client should treat this 503 as distinct from both the
route's own Zoho-unavailable 503 (below) and a genuine 403 denial.

`resolveMspIdStrict(req)` (`req.user?.mspId ?? null`) resolves the caller's MSP from
their own session (`:55-59`) — **403** `{ error: "MSP context required" }` if `null`.
Unlike the Portal-side customer routes, there is no `:mspId`/`?mspId=` override anywhere
in this file; the caller's own session `mspId` is the only source, same discipline as
`msp-message-center.ts`.

Query params `limit`/`offset` (`:61-62`), both optional, parsed via `Number(...)` with a
`Number.isFinite` guard — a non-numeric or missing value falls through to
`listDeskTicketsForOrg()`'s own defaults (`limit: 50`, clamped `[1, 100]`; `offset: 0`,
clamped `>= 0`, `zoho-desk.ts:462-463`) rather than erroring; no 400 path for a bad
`limit`/`offset` exists on this route.

Every ticket under the caller's MSP's Zoho Desk org — **both** customer-opened requests
and chat escalations land in the same list, since both write through the identical
`zoho_desk_create_ticket` job into the same org/department (`msp-support.ts`'s own header
comment, `:6-14`). An escalated ticket is identifiable only by its real `subject` field
(`"Support escalation from <name>"`, set by `escalateToAdmin()` in `support-chat.ts`) —
**there is no separate `type`/`source` field** distinguishing an escalation from a
customer-opened request; a client wanting to filter/badge them must match on `subject`
text, not a structured enum.

**Ownership boundary — org-scoped, not per-Contact** (real, deliberate difference from
every Portal-side read): `listDeskTicketsForOrg()` queries `GET /api/v1/tickets` under
the caller's MSP's own org header (`orgHeader(mspId)`), optionally further scoped to
`ZOHO_DESK_DEFAULT_DEPARTMENT_ID` when that env var is set (`zoho-desk.ts:465-466`) — an
operator sees every ticket in their org, not just tickets tied to their own Contact
record (operators generally have none). A foreign-MSP ticket id is invisible by
construction: it was never created under this org header, so it never appears — no
explicit ownership column check exists or is needed (`zoho-desk.ts:432-444`'s own header
comment).

Response (`:69`): `{ configured: true, requests: CustomerTicketSummary[], count: number }`
on success. `count` is Zoho's own reported total (`body.count`) when present, else
`rows.length` (`zoho-desk.ts:475`) — **not necessarily equal to `requests.length`** when a
`limit` truncates the page; a client needs `count` for real pagination, `requests.length`
alone undercounts.

Same honest not-configured state as the Portal-side list route: `ZohoNotConnectedError` →
`{ configured: false, requests: [], count: 0 }`, still **200** (`:71-75`). **500**
`{ error: "We couldn't load requests right now. Please try again shortly." }` on any other
thrown error (`:76-78`).

`CustomerTicketSummary` shape is the exact same type the Portal-side routes use
(`zoho-desk.ts:363-372`) — no separate operator-only summary shape exists.

---

## 2. `GET /api/msp/support/requests/:ticketId` (operator detail + full thread)

`msp-support.ts:85-113`. Same `requireCapability("ladder.msp-operator")` +
`resolveMspIdStrict` gate as §1 (same corrected auth note applies — see §1). **400**
`{ error: "Missing request id" }` if `:ticketId` is empty after trim (`:91-95`).

Two sequential calls, both scoped to the caller's MSP org (not a Contact):
`getDeskTicketById(ticketId, mspId)` (`:98`) — **404** `{ error: "Request not found" }` if
`null` (`:99-102`, covers both "doesn't exist" and "exists in a different MSP's org", via
org-header scoping rather than a Contact-match check). Only on a confirmed hit does it
then fetch `getDeskTicketThreadForOperator(ticketId, mspId)` (`:103`) — ownership is
always confirmed before the thread is fetched.

**The real, deliberate difference from the Portal-side customer thread route**:
`getDeskTicketThreadForOperator()` does **not** filter out private agent notes
(`zoho-desk.ts:490-495`'s own docblock) — an operator sees the full internal conversation,
including comments with `isPublic: false`, that a customer calling the Portal-side thread
route would never receive (that route drops them, `zoho-desk.ts:579`). Same
`CustomerTicketThreadEntry` shape (`{ id, kind: "thread" | "comment", direction: "in" |
"out" | null, author, isPublic, content, createdTime }`) — the type itself is unchanged;
only the operator function's own filtering behavior differs. `isPublic` is present and
meaningful on the operator response in a way it never needs to be checked on the customer
response (customer only ever sees `isPublic: true` rows).

One real inference quirk in `getDeskTicketThreadForOperator()`'s own mapping
(`zoho-desk.ts:510, :513`): `isComment` is inferred from `raw.type === "comment" ||
raw.commenter != null || raw.commentType != null` (Zoho's conversations feed conflates
threads and comments in one list, no clean discriminator field) — and for a row NOT
classified as a comment (i.e. `kind: "thread"`), `isPublic` is hardcoded `true`
unconditionally (`:513`, the ternary's else-branch), since a `thread` entry (the actual
customer-originated message/reply, as opposed to an agent's added `comment`) has no
private variant in Zoho's model. Sort order: ascending by `createdTime` string compare
(`:530`) — oldest-first, the opposite of §1's list route's newest-first ordering.

Response: `{ request: CustomerTicketSummary, thread: CustomerTicketThreadEntry[] }`
(`:104`) — same field names as the Portal-side customer detail response, not namespaced
`operatorRequest`/`operatorThread` or similar; a client distinguishes purely by which
route it called.

**503** `{ error: "Ticketing is not available right now." }` on `ZohoNotConnectedError`
(`:106-109`) — note this route does **not** share §1's list route's 200/`configured:
false` convention; it returns a plain 503 instead. This is a genuine, live inconsistency
in how this route file reports the exact same underlying condition across its own two GET
routes (mirrors the same inconsistency already documented on the Portal side of this pack
— see §19's own equivalent note). **500** on any other error (`:110-111`).

---

## 3. `POST /api/msp/support/requests/:ticketId/reply` (operator reply / internal note)

`msp-support.ts:121-172`. Same `requireCapability("ladder.msp-operator")` +
`resolveMspIdStrict` gate as §1 (same corrected auth note applies — see §1). **400**
`{ error: "Missing request id" }` / `{ error: "Please enter a message." }` for an empty
`:ticketId` / empty-or-missing `message` body field (`:132-139`).

Body (`:128-130`): `{ message: string; isPublic?: boolean }` — `isPublic` defaults to
`true` (`bodyIn.isPublic === false ? false : true`, `:130` — any value other than the
literal boolean `false`, including `undefined`, a truthy string, or `null`, resolves to
`true`; not Zod-validated, a loose truthy/falsy-adjacent coercion rather than a strict
boolean check).

Same ownership chain as §2: `getDeskTicketById(ticketId, mspId)` first, **404** on `null`
(`:142-145`), **before** any write — the reply cannot be queued against a ticket the
caller's org can't see.

Queues `zoho_desk_add_comment` via `enqueueZohoDeskWrite()` with `{ ticketId, content:
message.slice(0, MAX_BODY), isPublic }`, `MAX_BODY = 5000` (`:45, :148-152`) — same node
type and same 5000-char truncation as the Portal-side customer reply route, but **no
display-name-prefixing** of the message body (contrast the customer route's real,
documented `"${displayName} (customer) replied:\n\n${message}"` prefix). This route's own
comment explains why (`msp-support.ts:116-120`): Zoho already attributes a public comment
to the connected agent, and for this route that agent attribution **is** the actual
operator replying — no authorship-legibility gap to work around, unlike the customer
route where the connected agent is never the customer.

**202** response, message text branches on `isPublic` (`:155-158`):

| `isPublic` | Message |
|---|---|
| `true` (default) | `"Your reply has been added to the request."` |
| `false` | `"Your internal note has been added."` |

Three failure branches, identical shape/ordering to the Portal-side customer reply route:
`ZohoNotConnectedError` → **503** `{ error: "Ticketing is not available right now." }`
(`:160-163`); `ZohoApiError` → **502** `{ error: "We couldn't add your reply right now.
Please try again shortly." }`, logging `err.body`/`err.status` distinctly (`:164-168`); any
other thrown error → **500**, same message text as the 502 case (`:169-171`) — note this
route's 500 and 502 bodies are textually identical, so a client cannot distinguish "Zoho
rejected the write" from "something else broke" by response body alone, only by status
code.

---

## 4. Real enum/vocabulary additions and cross-surface edges

No new enum unions are introduced by the operator side — `CustomerTicketSummary` and
`CustomerTicketThreadEntry` (`zoho-desk.ts:363-384`) are reused verbatim; §1-§3 are pure
reads/writes against the same shapes and the same real Zoho-owned `status`/`statusType`
vocabulary already documented in `docs/portal/requests-and-support-chat-contract-pack.md`.
One real, operator-only distinction worth a caller's attention: on §2's response,
`CustomerTicketThreadEntry.isPublic === false` is a genuinely reachable, meaningful state
(an internal-only note) — on every Portal-side response it is not (customer thread
entries are pre-filtered to `isPublic === true` only, so the field is always `true` there
in practice even though the type doesn't statically guarantee it).

Cross-surface edges (operator side):

- **§1/§2/§3 share the exact same `CustomerTicketSummary`/`CustomerTicketThreadEntry`
  wire shapes as the Portal-side customer-facing routes** — a single set of TypeScript
  interfaces (`zoho-desk.ts:363-384`) backs both the customer's "My Requests" surface and
  the operator's queue, so a future shape change to either type is a simultaneous
  contract change for both Portal and MSP Console.
- **§3's `zoho_desk_add_comment` queue is the identical job/handler the Portal-side
  customer reply route uses** — an operator's public reply and a customer's reply both
  land in the same Zoho ticket thread via the same drain-cadence job (two producers —
  `portal-customer-requests.ts` and `msp-support.ts` §3 — one consumer).
- **The operator's list (§1) is the real escalation queue** — no separate "escalations"
  table/view exists; both a customer- or staff-initiated escalation and a customer's
  "Open a Request" action create rows that surface in §1 exactly like any other ticket,
  distinguishable only by the `subject` text convention noted in §1, not a structured
  field. A Design pass building an operator queue view that wants to visually separate
  "escalations" from "requests" has no server-side field to key off — it would need to
  parse `subject`, or a new field would need to be added (a real, filed gap — carried
  forward from the original addendum, no new sub-issue filed by this pack).
- **Ownership model genuinely differs between the two sides of this Feature**: Portal
  reads are Contact-scoped (one customer sees only their own tickets); MSP-console reads
  (§1-§3) are org-scoped (one operator sees every ticket in their MSP's Zoho org). Both
  are real, correct, and intentional — not a gap — but a Design/QA pass should know they
  are architecturally different scoping mechanisms, not the same check applied twice.
- **Auth mechanism, platform-wide, not specific to this Feature**: all three routes'
  `requireCapability("ladder.msp-operator")` gate is part of the #1696/#2458/#2460
  RBAC-ladder migration that touches every `requireRole`-gated route in the codebase, not
  something unique to Support Chat — noted here only because it is the one real drift this
  pack's re-verification found relative to the source addendum (see §1).

---

## Orphaned-endpoint check

```
grep -rn "msp/support/requests" artifacts/msp-console/src artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel
```

Returns **zero** matches (re-run 2026-09-14, same result as the 2026-09-04 addendum).
`artifacts/msp-console` (the real MSP-operator app the §1-§3 routes are built for) exists
in the tree and now has real `requireCapability("ladder.msp-operator")`-gated call sites
elsewhere in its own auth plumbing (`console-api.ts`, `retainer-api.ts`, `AuthGate.tsx`,
`AuthContext.tsx`), but no `support`-related source under `src/` — and no
`Design/msp-console/` export directory exists yet at all (only `Design/portal/` is
populated). So there is **no live caller anywhere** for any of §1, §2, or §3. This is the
same honest "backend built, Design/wire not yet started" state #2672's own closing
comment describes, not a gap this pack needs to close.

---

## Not covered by this pack

Per the #1642 method, no page/UI-shape decisions are made here. The shared Portal-side
schema (`CustomerTicketSummary`/`CustomerTicketThreadEntry` field-by-field breakdown),
the customer-facing routes those types also back, the `zoho_desk_create_ticket` job's
three producer call sites, and the ShaneBot escalation path (`support-chat.ts`) are all
documented in `docs/portal/requests-and-support-chat-contract-pack.md` — cited here, not
re-derived.

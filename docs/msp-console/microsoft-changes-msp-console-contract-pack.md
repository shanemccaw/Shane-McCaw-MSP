# Microsoft Changes — MSP Console contract extraction pack

**#4084**, part of Feature **#1688** ("Microsoft Changes (MSP Console)"), the operator half
of module epic #1494. A real contract pack already exists —
[`docs/portal/microsoft-changes-contract-pack.md`](../portal/microsoft-changes-contract-pack.md)
(568 lines, Surfaces A-F, last refreshed by #3781 on 2026-09-12) — but it lives in
`docs/portal/`, not `docs/msp-console/`, the one folder the MSP Console Design pass actually
reads. **This pack does not re-derive that document.** It cites it for the shared
schema/routes/enums, and adds only what is genuinely new: the console's own scope (author →
review resolution → review/override routing → handle propose → Surface F list), re-verified
line-by-line against `main` at pack time (2026-09-14), plus three real drifts the root pack's
own #3781 refresh missed (§0.1) and one architectural gap the root pack never had reason to
name (§2). Read-only: no product code, schema, or UI was touched to produce this document.

Method per #1642, same convention as every other landed MSP-console pack (see
[`training-sessions-msp-console-contract-pack.md`](training-sessions-msp-console-contract-pack.md)
§0 for the pattern this follows).

---

## 0. What this issue covers, per #1688's own scope

Per #1688: *"Author the interpretation once per announcement, applied to every tenant · review
the resolution's affected-object counts · review and override the routing decision · handle
the propose branch where the gate did not auto-create."* Plus Surface F
(`GET /api/msp/message-center`, root pack §1g) — the operator's read view of the raw corpus.

**Real decision, 2026-09-12 (recorded on #1688):** interpretation authoring lives in the **MSP
Console**, not AdminV2 — Shane's own explicit override of #1678's closing recommendation. See
§2 for why the *current* backend does not yet match that decision.

**Real, current state (recorded on #1688, from #1678):** the pipeline is no longer fully
dormant — one real interpretation (id 4, MC1287370) has been authored, resolved (2 shared
mailboxes, tenant 1), and routed (`auto_created`, CR-2026-183). Every other post is still
`analysis: null` / no routing row. #1678's comment (quoted verbatim where cited below) is the
only real populated-state example that exists; do not invent a second one.

### 0.1 Three drifts the root pack's own #3781 refresh missed — re-verified live against `main`

The issue instructs re-verifying each cited route rather than trusting the root pack blindly.
Doing so surfaced three real gaps, all landed **before** #3781's 2026-09-12 "re-verify and
refresh" pass yet still absent from its result:

1. **The routing engine now has an HTTP surface.** Root pack §0's surface table still states
   "D | The routing engine (no HTTP surface)". That was true when #1642 first wrote it, but
   **#1701 landed a real on-demand trigger on 2026-08-29** — two weeks before #3781 ran —
   and #3781 did not pick it up. See §1h below; this is the mechanism for "review and override
   the routing decision," the console's own stated scope.
2. **The customer wire (`WirePost`) gained a `routing` field.** **#1744 landed 2026-09-06** —
   six days before #3781 — adding `routing: WireRouting | null` to every post on
   `GET /api/portal/message-center`. Root pack's §1a `WirePost` field table (ending at
   `analysis`) does not list it. See §1a-note below.
3. **Root pack §1g's "known defect"** (`limit`/`offset` not NaN-guarded on
   `GET /api/msp/message-center`, filed as #2696) **is already fixed and closed** — the guard
   landed via commit `ef46ada2e` ("Fix NaN limit/offset in msp-message-center route"), confirmed
   present in the live file (`msp-message-center.ts:35-38`, `!isNaN(...)` guards on both). The
   root pack's defect note is stale; do not carry it into console Design.

A finding for #1 and #2 (the root pack itself needs updating) is filed as a sibling of #1688 —
see the bookend for the issue number.

---

## 1. Per-surface wire contract — re-verified against `main` at pack time (2026-09-14)

The console's five real surfaces, re-cited to current file:line (several have shifted since
the root pack's own citations — this pack cites current line numbers throughout, not the root
pack's).

| # | Surface | File | Console screen | Writes? |
|---|---|---|---|---|
| 1a | AdminV2-hosted interpretation/resolution/routing routes (root pack's surface B, extended) | `artifacts/api-server/src/routes/admin-m365-interpretations.ts` (855 lines, 12 routes) | Author interpretation · review resolution · review/override routing | yes |
| 1g | `GET /api/msp/message-center` (root pack's surface F) | `artifacts/api-server/src/routes/msp-message-center.ts` (59 lines, 1 route) | The raw corpus list (currently no console consumer) | no |
| — | The routing engine's pure gate + sweep (root pack's surface D) | `artifacts/api-server/src/lib/m365-change-router.ts` (798 lines) | Read for citation only; not a route | yes (via 1a's routes) |
| — | The customer-facing wire (root pack's surface A) | `artifacts/api-server/src/routes/portal-message-center.ts` (596 lines) | Not a console screen — cited only because §0.1's `routing` field is shared context an operator override changes | no |

### 1a. The 12 interpretation/resolution/routing routes — full current list

Source: `admin-m365-interpretations.ts`, read in full on `main` at pack time. **Every route is
gated `requireAdmin`** (`:67` imports it from `../middlewares/requireAuth.ts`) — see §2 for why
this is a real, current mismatch with the console's own operator role, not a citation detail to
skip past. `mspId` is resolved server-side via `resolveDefaultMspId()` (`:88-…`, called at
`:133`, `:171`, `:301`, `:404`, and again in the resolve/route/routings handlers) — **never**
from the request body or a route param, same discipline as the root pack's surface B.

| Route | Method | Purpose | Line |
|---|---|---|---|
| `/admin/m365/interpretations` | GET | library + status counts (`{ proposed, confirmed, rejected, total }`) | `131` |
| `/admin/m365/interpretations/candidates` | GET | roadmap/MC sources with no interpretation yet, `?cloud=` filter (root pack §1b) | `168` |
| `/admin/m365/interpretations/propose` | POST | AI proposes (unsaved) | `294` |
| `/admin/m365/interpretations` | POST | create (default `status: "proposed"`) | `397` |
| `/admin/m365/interpretations/:id` | PATCH | edit | `465` |
| `/admin/m365/interpretations/:id/confirm` | POST | → `status: "confirmed"` — the only path to `confirmed` | `517` |
| `/admin/m365/interpretations/:id/reject` | POST | → `status: "rejected"` | `522` |
| `/admin/m365/interpretations/:id` | DELETE | remove | `563` |
| `/admin/m365/interpretations/:id/resolve` | POST | run the count now, across tenants (confirmed-only) | `600` |
| `/admin/m365/interpretations/:id/resolutions` | GET | stored per-tenant answers | `658` |
| **`/admin/m365/interpretations/:id/route`** | **POST** | **on-demand routing trigger (#1701) — new since root pack** | **`729`** |
| **`/admin/m365/interpretations/:id/routings`** | **GET** | **stored per-tenant routing decisions (#1701) — new since root pack** | **`791`** |

**`createSchema`** body (`:373-395`): `title` (1-500 chars), `summary` (nullable, ≤4000),
`changeClass` (`M365_CHANGE_CLASSES`, §3), `touches` (optional, §3 shape), `whoActs`
(`M365_ACTORS`, default `"microsoft"`), `controllable` (`M365_CONTROLLABILITY`, default
`"unknown"`), `controlMethod` (nullable), `probe` (optional, §3 shape), `proposedBy`
(`"ai" | "human"`, default `"human"`), `aiModel`/`aiRationale` (nullable), `notes` (nullable),
`status` (`M365_INTERPRETATION_STATUSES`, default `"proposed"` — "an AI-proposed reading is
never born confirmed", `:392-393`; a human authoring by hand may create it already
`"confirmed"` in the same call).

**`resolveSchema`** body (`:595-598`): `{ customerId?: number (positive int), live: boolean
(default true) }`. `live: false` reads only already-collected monitor/license data (what #1678
used for its real example); `live: true` fires a fresh Graph probe. `customerId` omitted
resolves **all** tenants; supplied, only that one.

**`GET .../:id/resolutions`** response (`:658-707`): `{ interpretationId, resolutions:
[{ id, customerId, tenantName, status, affectedCount, basis, basisDetail, errorMessage,
measuredAt, updatedAt }] }`, ordered `desc(updatedAt)`, left-joined to `tenantsTable` for a
real name (falls back to `"Customer {id}"` if blank, `:697`). This is the review-the-counts
screen's direct data source.

### 1h. `POST .../:id/route` and `GET .../:id/routings` — the review/override surface (#1701)

**This is the mechanism for #1688's "review and override the routing decision."** Before #1701
(landed 2026-08-29), `runM365ChangeRoutingSweep` had no HTTP surface at all — only the seeded
`m365_route_changes` Workflow Engine node, run nightly at 04:00 UTC
(`seed-system-workflows.ts`, per the route's own header comment `:715-728`). An operator who
had just confirmed + resolved an interpretation had no way to see it become a Change Request
without waiting for the nightly sweep. #1701 closed that gap.

**`POST /admin/m365/interpretations/:id/route`** (`:729-784`):
- 400 if `:id` is not a positive integer (`:732-735`); 400 if no MSP resolves (`:737-740`);
  404 if the interpretation isn't found for this MSP (`:746-749`); **409 if it isn't
  `confirmed`** (`:750-753`) — the same gate `/resolve` already enforces, since routing an
  unconfirmed reading makes no sense.
- Fires the **same** Workflow Engine node the nightly sweep runs — `fireWorkflowForDefinition`
  → `wf_runs` → `executeWorkflowRun` (`:767-772`) — narrowed to this one interpretation via
  `{ interpretationId: id }` in the run's trigger payload. **Never a parallel code path, never
  a scheduler bypass**; if the workflow definition isn't seeded, it 503s rather than silently
  no-opping (`:755-764`).
- 202 response: `{ interpretationId, runId, status: "queued" }` (`:779`) — asynchronous. The
  console must poll or re-fetch `/routings` to see the outcome, not assume the 202 means done.
- 503 if the run couldn't start ("concurrency limit or missing published version" — `:773-776`).

**`GET /admin/m365/interpretations/:id/routings`** (`:791-853`) — the stored per-tenant
decisions this trigger (or the nightly sweep) produced, **"same read shape as
`/resolutions`"** per the route's own header comment (`:788`): `{ interpretationId, routings:
[{ id, customerId, tenantName, decision, reason, intake, affectedCount, hasStructuralDate,
changeRequestId, changeRequestCode, riskDecisionId, routedAt, updatedAt }] }`, ordered
`desc(updatedAt)`, left-joined to `tenantsTable` the same way `/resolutions` is.
`changeRequestCode` is **derived server-side** via `routedChangeRequestCode(id)`
(`m365-change-router.ts:796`, formats the real `CR-YYYY-NNN` code every other change-control
surface uses) — **never re-derived client-side** (the route's own comment, `:837-839`). Both
both fields (`decision`, `reason`) are the real §3 enum unions, unchanged from the root pack.

**What "review and override" actually means today:** the backend has no override *write* —
there is no `PATCH .../routings/:id` to flip a `proposed` decision to `auto_created` by hand.
"Override" as built is: (a) see the `proposed` outcome and *why* (`reason`, §2 of the root
pack's gate table — `zero_affected` / `no_announcement` / `undated`), then (b) fix the actual
input the gate reads (edit the interpretation, re-run `/resolve` with corrected data, or wait
for a real announcement/date) and re-fire `/route`. There is no raw decision-flip. If the
console needs a genuine manual override (create the CR directly from a `proposed` routing
without re-satisfying the gate), that does not exist in the backend today and is a real product
decision, not a citation gap — flag it to Design rather than assume it.

### 1g. `GET /api/msp/message-center` — Surface F, re-verified

Source: `msp-message-center.ts`, read in full (59 lines, one route) — unchanged in shape from
the root pack's §1g except the NaN-guard fix already noted in §0.1. `requireCapability
("ladder.msp-operator")` (`:24`) — **this route, unlike every route in §1a, already admits
MSPOperator/MSPAdmin/PlatformAdmin**, the console's real roles. Scope is `resolveMspIdStrict
(req)` (`:26`) — 403 `{ error: "MSP context required" }` if the caller has no `mspId` claim
(`:27-30`).

Query params (`:32-38`), all optional: `category` (exact match), `customerId` (numeric, a
non-numeric value silently dropped — `!isNaN` guard, `:33-34`), `limit` (default 50, hard cap
200, **now NaN-guarded**, `:35-36`), `offset` (default 0, floor 0, **now NaN-guarded**,
`:37-38`). Response (`:52`): `{ items, limit, offset }` — `items` is the **raw Drizzle row
set**, every `mspMessageCenterItemsTable` column, unfiltered and unshaped; `limit`/`offset` are
echoed back verbatim, not an actual row count or `hasMore`/`total` — a caller still cannot tell
if more rows exist past the page. Ordered `desc(lastModifiedDateTime)` (`:48`).

**Still orphaned.** No route in `artifacts/msp-console` calls this — `artifacts/msp-console`
does not exist yet (#1688 is blocked on the console scaffold, #1680, and on the Design export,
#2599). This pack documents F as live, correctly-scoped for the console's own roles, and
working, with zero UI consumers.

### 1a-note. The customer wire's new `routing` field (#1744) — context the console changes

Not a console screen, but load-bearing context: since #1744 (2026-09-06), `WirePost` on the
**customer-facing** `GET /api/portal/message-center` carries a `routing: WireRouting | null`
field (`portal-message-center.ts:264-272`, attached at `:510`):

```ts
interface WireRouting {
  readonly decision: string;             // M365_ROUTING_DECISIONS, excluding "none"
  readonly reason: string;               // M365_ROUTING_REASONS
  readonly intake: string | null;        // CHANGE_REQUEST_INTAKES
  readonly changeRequestCode: string | null;   // populated only when decision === "auto_created" produced a real CR
  readonly changeRequestStatus: string | null;
  readonly declined: boolean;            // true once a customer (or MSP) decline became an accepted risk (#1514)
}
```

Populated by a left join on `(mspId, customerId, graphMessageId)` against
`m365ChangeRoutingsTable` → `mspChangeRequestsTable` (`:454-483`); rows with `decision ===
"none"` are filtered out (`:487`) since that state is already carried on `analysis.measured`.
**Why the console must know this:** any routing decision an operator reviews or triggers via
§1h is the same row the customer already sees reflected on their own Changes page the moment
it's written — there is no separate "publish to customer" step. An on-demand `/route` fire
(§1h) is customer-visible as soon as the sweep completes, not after a review/approval gate the
console might otherwise assume exists.

---

## 2. Real finding — the console's own operator role cannot reach any authoring route today

**Every route in §1a is gated `requireAdmin`** (`requireAuth.ts:200-208`): `req.user?.role !==
"admin"` → 403. This is the **legacy literal role check**, not `requireCapability("ladder.msp-
operator")` — the capability every other real MSP-console route in this repo uses (§1g above,
and every route documented in the other landed `docs/msp-console/*.md` packs, e.g.
`training-sessions-msp-console-contract-pack.md` §1: `requireCapability("ladder.msp-
operator")` admits `MSPOperator`/`MSPAdmin`/`PlatformAdmin`).

`requireAdmin` admits **only** a session whose `role` claim is literally `"admin"` — the legacy
PlatformAdmin shape, not the ladder. An MSPOperator or MSPAdmin session — the console's own
real users, the ones #1688's 2026-09-12 decision says should author interpretations — **cannot
call any of the 12 routes in §1a today**: not create, not confirm, not resolve, not the new
`/route`/`/routings` pair. Only a legacy `role: "admin"` session can.

This directly contradicts the decision recorded on #1688 itself: *"interpretation authoring
goes in the MSP Console... not AdminV2."* The routes exist and work (per #1678's real
end-to-end run), but they are wired for the surface Shane's decision says to move authoring
*away* from. Until this is re-gated (or a parallel `requireCapability("ladder.msp-operator")`
path is added), the console screens this pack describes have no reachable backend for an actual
MSPOperator — only for a legacy `role: "admin"` account.

**This is not a "BUILD IT" gap the console build should just patch silently** — changing an
admin-only write surface's auth gate is exactly the kind of change that needs to be visible and
tracked, not folded quietly into a UI-wiring pass. Filed as a real finding, sibling to #1688 —
see the issue number recorded in this pack's own bookend (`build-journal/4084.md`).

---

## 3. Real enum unions only — cited to current line, re-verified

All from `lib/db/src/schema/msp.ts` (line numbers have shifted since the root pack's own
citations — the schema file has grown; these are current at pack time, 2026-09-14):

```ts
// msp.ts:~3395 — what a resolved change becomes
M365_ROUTING_DECISIONS = ["auto_created", "proposed", "declined_risk", "none"]

// msp.ts:~3399 — why it was proposed/skipped rather than auto-created
M365_ROUTING_REASONS = ["auto_created", "undated", "zero_affected", "not_measured", "no_announcement"]
```

The interpretation-side enums (`M365_CHANGE_CLASSES`, `M365_INTERPRETATION_STATUSES`,
`M365_ACTORS`, `M365_CONTROLLABILITY`, `M365_RESOLUTION_STATUSES`, `M365_RESOLUTION_BASES`,
`M365_NOT_MEASURED_REASONS`, `CHANGE_REQUEST_INTAKES`, `CHANGE_REQUEST_IMPLEMENTERS`,
`CHANGE_REQUEST_SOURCE_KINDS`) are unchanged in value from the root pack's §3 — cite that
document directly for their definitions rather than duplicating them here; only their line
numbers have drifted, not their content, confirmed by grep against current `main`.

**The routing gate itself (`decideRouting`, `m365-change-router.ts:142-159`)** is unchanged
from the root pack's §2 table — re-verified, same four inputs (`resolutionStatus`,
`affectedCount`, `hasAnnouncement`, `hasStructuralDate`), same four outcomes. Cite the root
pack's §2 directly; this pack does not repeat it.

---

## 4. The real populated-state example — cite #1678, do not invent a second one

The only real, non-fabricated populated example on this pipeline is #1678's own comment
(quoted in full there): interpretation id 4 (MC1287370, "Auto upgrade of shared calendars from
legacy MAPI model to modern REST model"), resolved to **2** shared mailboxes for tenant 1
(`monitor_check` basis), routed `auto_created` → **CR-2026-183**. Design must draw the console's
review-the-resolution and review-the-routing screens against that exact real payload (quoted
verbatim in #1678, §§3-5 of that comment) — not a second invented example. Every other
interpretation/resolution/routing row in the local DB is still zero, per #1678's own baseline.

---

## 5. The forbidden list — unchanged from the root pack, restated for the console

Everything the root pack's §6 names as deliberately not served (`plain` always `""`, no
per-tenant config read on the customer page, `affectedCount` never a guessed zero, no
`roadmapId` on the customer wire, no cloud/GCC toggle on the customer page, no rollout-ring
breakdown) applies identically here — the console reads the **same** `m365ChangeInterpretationsTable`
/ `m365ChangeResolutionsTable` / `m365ChangeRoutingsTable` rows the customer wire does, just
through the admin-authoring routes instead of the customer route. Cite root pack §6 directly;
nothing new to add on the console side beyond §2's role-gate finding above.

---

## 6. Open questions for Design — genuine product decisions, not extraction gaps

- **The manual-override gap (§1h).** The backend has no way to flip a `proposed` routing
  decision to `auto_created` by hand — only to fix the underlying inputs and re-fire the gate.
  Does the console need a genuine override write, or is "fix the input, re-run the gate" the
  intended operator workflow? Code cannot settle this.
- **The auth-gate mismatch (§2).** Whether the fix is re-gating the 12 routes to
  `requireCapability("ladder.msp-operator")`, adding a parallel console-facing route set, or
  something else, is a real architecture decision for whoever picks up the filed finding — not
  pre-empted here.
- **Surface F's wire shape**, unchanged from root pack §1g's own open question: whether the
  future console list needs its own narrower `WireMspMessageCenterItem` shape (matching A's
  `analysis`/`workload`/`kind` derivation) or genuinely wants F's current raw columns. Still
  undecided; this pack does not pre-empt it.
- **Design export (#2599)** remains the real, current blocker per #1688 — no screen for this
  Feature exists in the design handoff package. This pack is the prerequisite for that export
  landing correctly, not a substitute for it.

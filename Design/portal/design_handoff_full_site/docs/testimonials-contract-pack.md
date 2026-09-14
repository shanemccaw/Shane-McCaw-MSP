# Testimonials — contract extraction pack

**Issue:** #3893, part of #3436 ("Feature: Build customer testimonial collection in
Portal (Portal)"), part of #1485 (EPIC: Portal). This is Phase 2 of the Portal build
order (architect → build the endpoints → regenerate the contract pack → Design → wire)
— no page/UI-shape decisions are made here. Extracted, not authored — every field
below traces to one of the files listed, cited to file:line.

Real product context, settled on #3436 (2026-09-14, Shane, not re-derivable): the
Feature exists to ask the customer about their service in exchange for a discount that
goes on the marketing site as a testimonial. **The discount only applies once Admin
Panel approves/publishes the testimonial — not on submission** — and it applies as a
one-time credit against the customer's next month of service, not a standing/recurring
discount. **None of that approval/discount mechanism is built yet.** Phase 1 (#3891,
#3892) built only the submission table, the submission endpoints, and the periodic
prompt-due check. There is no `status`/`approved`/`publishedAt` column on
`customer_testimonials` at all — `permissionToPublish` (set by the customer at
submission time) is not the same thing as Admin Panel's approval decision, and nothing
in the current schema records that decision happening or fires a discount off it. That
gap is real, current state — not something this pack invents — and is filed as its own
finding below (§5).

Backend confirmed real and live in the current codebase before any of this was written:

- `POST /api/portal/testimonials` — `portal-testimonials.ts`
- `GET /api/portal/testimonials` — `portal-testimonials.ts`
- `GET /api/portal/testimonials/prompt-due` — `portal-testimonials.ts`
- `GET /api/admin/testimonials/all` — `admin-testimonials.ts`

**All four are currently orphaned — no live frontend consumer.** No `Design/portal/`
export exists yet for a Testimonials page (portal-side or admin-side), and grep across
every real frontend tree turns up zero matches for any of the four routes (see the
Orphaned-endpoint check at the end of this pack). That is real, current state, not a
gap this pack invents — Design has a real, live backend to design against, with zero
frontend debt to carry over.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-testimonials.ts` — the three customer-portal
  endpoints (submit, own history, prompt-due)
- `artifacts/api-server/src/routes/admin-testimonials.ts` — the admin-side read
  surfaces, including the one this pack covers (`/admin/testimonials/all`) and the two
  pre-existing `project_closures`-only ones it sits alongside
- `lib/db/src/schema/index.ts:1628-1650` — `customerTestimonialsTable`,
  `CUSTOMER_TESTIMONIAL_KINDS`
- `lib/db/src/schema/index.ts:1866-1878` — `couponsTable.requiresTestimonial` (the
  pre-existing, unrelated reverse mechanism — see §4)
- `lib/db/migrations/manual/2026-09-13-customer-testimonials-3891.sql` — the real DDL
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireCapability`,
  `requireAdmin`
- `artifacts/admin-panel/src/pages/crm/Testimonials.tsx` — confirmed real consumer of
  `GET /api/admin/closures/signed` only (see §5)
- Git #3436, #3891, #3892 issue bodies/comments — the real product-decision record
  cited throughout

---

## 1. Wire contract — `POST /api/portal/testimonials`

Auth: `requireCapability("ladder.customer-user")` (`portal-testimonials.ts:38`) — the
same capability-string floor other portal customer-tier routes use (paying customers +
MSP staff; Free/Assessment tier excluded, per the convention documented in the
Microsoft Changes pack). 400s with `{ error: "No customer account associated with this
user" }` if the JWT carries no `customerId` claim (`:39-43`).

Request body (Zod `postSchema`, `:31-35`):

| Field | Type | Nullability | Notes |
|---|---|---|---|
| `body` | `string` | required | trimmed, `min(1)`, `max(4000)` — empty/whitespace-only rejected |
| `kind` | `"testimonial" \| "feedback" \| "suggestion"` | optional | defaults `"testimonial"` if omitted |
| `permissionToPublish` | `boolean` | optional | defaults `false` if omitted |

A validation failure is `400 { error: "Validation failed", details: <zod flatten()> }`
(`:46-48`).

Response shape (`201`, `:64-70`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `customer_testimonials.id` (serial PK) |
| `body` | `string` | not null | echoes the inserted row |
| `kind` | `"testimonial" \| "feedback" \| "suggestion"` | not null | echoes the inserted row |
| `permissionToPublish` | `boolean` | not null | echoes the inserted row |
| `createdAt` | `string` (ISO, serialized `Date`) | not null | `defaultNow()` |

`customerId` (from the JWT, `tenants.id`) and `authorUserId` (`req.user!.id`) are
written on insert (`:56-57`) but **not echoed back** in the response body — a caller
that needs them already has both from its own session.

A DB failure is `500 { error: "Unable to submit right now. Please try again shortly."
}` (`:71-74`).

---

## 2. Wire contract — `GET /api/portal/testimonials`

Auth: same `requireCapability("ladder.customer-user")` floor, same 400 shape for a
missing `customerId` claim (`:79-84`).

**Scoped to the requesting login's own submissions, not the whole customer/tenant** —
`WHERE customer_id = :customerId AND author_user_id = :req.user.id` (`:90`), ordered
`createdAt DESC`. A customer account with more than one linked login will not see a
sibling login's submissions in this list — see §4 for the cross-reference to how other
portal routes handle multi-login scoping, and why this one may be a deliberate
narrower choice rather than an oversight.

Response: `TestimonialSummary[]` (`:93-101`), same four fields as §1's response shape
(`id`, `body`, `kind`, `permissionToPublish`, `createdAt`) — `[]` for a login with no
submissions, never a fixture substitution (no fixture branch exists in this router at
all).

A DB failure is `500 { error: "Unable to load submission history right now. Please try
again shortly." }` (`:102-105`).

---

## 3. Wire contract — `GET /api/portal/testimonials/prompt-due`

Auth: same `requireCapability("ladder.customer-user")` floor, same 400 shape
(`:117-122`). 404s with `{ error: "Customer account not found" }` if the JWT's
`customerId` doesn't resolve to a real `tenants` row (`:131-134`) — a state distinct
from the 400 above (that one is "no `customerId` claim at all"; this one is "a claim
that doesn't resolve").

**Cadence, settled on #3892 (2026-09-14, Shane) — DECIDED, not this pack's own
derivation:**

- First prompt eligible **30 days** after the customer's tenant row was created
  (`FIRST_PROMPT_AFTER_DAYS = 30`, `:24`).
- After that, **every 90 days thereafter** (`REPEAT_PROMPT_AFTER_DAYS = 90`, `:25`),
  reset by any submission — testimonial, feedback, or suggestion kind all count, the
  due-check does not filter by `kind` (`:136-141`).

**Anchor decision (#3892's own real finding, not re-derived here):** the "when did
this customer start" anchor is `tenants.createdAt`, not
`users.onboardingWizardCompletedAt`. The route's own header comment (`:108-116`) states
why: `onboardingWizardCompletedAt` is per-*user* and nullable (not every user on a
tenant completes the wizard), so it cannot anchor a tenant-wide check the way
`tenants.createdAt` (`NOT NULL`, always present) can. There is no tenant-level
onboarding-*completion* timestamp anywhere in the schema — `tenants.status` has an
`"onboarding"` enum value but nothing records when it flips to `"active"`.

Due logic (`:143-149`):

```
daysSinceCustomerStart = (now - tenants.createdAt) / 1 day
daysSinceLastSubmission = lastSubmission
  ? (now - lastSubmission.createdAt) / 1 day
  : null

due = daysSinceCustomerStart >= 30
  AND (daysSinceLastSubmission === null OR daysSinceLastSubmission >= 90)
```

`lastSubmission` is scoped `customer_id = :customerId` **only** — not
`author_user_id` — so a submission by *any* login on the tenant resets the clock for
*every* login on that tenent asking. This is a real, deliberate scoping difference from
§2's own-login-only history read (`:136-141` vs `:90`) — worth Design/architecture
awareness, not flagged as a bug here (a tenant-wide "have we been asked recently"
signal is a defensible read of the product intent; a per-login one would prompt every
seat on the same tenant independently).

Response shape (`:151-155`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `due` | `boolean` | not null | the logic above |
| `customerStartedAt` | `string` (ISO) | not null | `tenants.createdAt` |
| `lastSubmissionAt` | `string \| null` (ISO) | nullable | most recent `customer_testimonials.createdAt` for this tenant, `null` if none exist yet |

A DB failure is `500 { error: "Unable to check prompt status right now. Please try
again shortly." }` (`:156-159`).

---

## 4. Wire contract — `GET /api/admin/testimonials/all`

Auth: `requireAdmin` (`admin-testimonials.ts:68`) — the legacy session-role admin
guard (`req.user.role === "admin"`, `requireAuth.ts:200-208`), not the `ladder.*`
capability system the three portal routes above use. This route sits in the same file
as, and alongside, two pre-existing `project_closures`-only admin reads
(`GET /testimonials` and `GET /admin/closures/signed`) that this pack does not cover —
neither changed for #3891/#3892 and both remain real, live, and (per §5) the one that
**is** consumed.

**Merges two real, distinct sources into one array** (`:69-141`), run in parallel via
`Promise.all`:

1. **`project_closures`** (`source: "project_closure"`) — the pre-existing,
   project-closure-gated feedback capture. `WHERE signedAt IS NOT NULL AND feedback IS
   NOT NULL AND trim(feedback) <> ''` (`:85-89`), joined to `projects` (inner) and
   `users` (left, via `signerUserId`).
2. **`customer_testimonials`** (`source: "customer_testimonial"`, #3891) — the new
   standing any-time surface, unfiltered (every row, no `permissionToPublish` gate on
   this read — the admin view intentionally sees everything, not just publishable
   ones), joined to `tenants` (inner, via `customerId`) and `users` (left, via
   `authorUserId`).

Both are mapped to one common shape, concatenated, then sorted descending by
`createdAt` (`:134-138` — `project_closures.signedAt` and
`customer_testimonials.createdAt` are aliased to the same `createdAt` key so the two
sources can share one sort).

Response shape — one array, each row tagged by `source`:

| Field | Type | Nullability | Present on |
|---|---|---|---|
| `source` | `"project_closure" \| "customer_testimonial"` | not null | both |
| `id` | `number` | not null | both (two independent id spaces — a `project_closure` id and a `customer_testimonial` id can collide numerically; `source` is what disambiguates) |
| `body` | `string \| null` | nullable for `project_closure` (`feedback` column is nullable at the schema level, though the query's own `WHERE` already excludes null/blank) | both — aliased from `feedback` (closure) or `body` (testimonial) |
| `kind` | `"testimonial" \| "feedback" \| "suggestion"` | not null | both — `project_closure` rows are hardcoded `kind: "testimonial"` (`:115`), since that source predates the kind concept entirely; `customer_testimonial` rows carry their real stored `kind` |
| `permissionToPublish` | `boolean` | not null | both — aliased from `permissionGranted` (closure) or `permissionToPublish` (testimonial) |
| `createdAt` | `string \| null` (ISO) | nullable for `project_closure` if `signedAt` were ever null (excluded by the `WHERE`, so effectively always present in practice) | both |
| `clientName` / `clientEmail` | `string \| null` | nullable (left join) | both — aliased from the closure's `signerUserId`→`users` join or the testimonial's `authorUserId`→`users` join |
| `projectId` / `projectTitle` / `projectType` | `number \| string \| null` | `project_closure` only | closure rows only — absent (not `null`, the key itself is missing) on `customer_testimonial` rows |
| `customerId` / `customerName` | `number \| string \| null` | `customer_testimonial` only | testimonial rows only — absent on `project_closure` rows |

**A caller must branch on `source` to know which of the two optional-field groups to
read** — this is not a uniform row shape, it's a real tagged union across two
structurally different source tables.

---

## 5. Finding — three of the four endpoints have no live frontend consumer; the fourth (`/admin/closures/signed`) does, but `/admin/testimonials/all` does not replace it anywhere

Confirmed via grep across every real frontend tree (`artifacts/portal/src`,
`artifacts/msp-website`, `artifacts/shane-mccaw-consulting`,
`artifacts/admin-panel/src`) — see the Orphaned-endpoint check below.

- `POST/GET /api/portal/testimonials` and `GET /api/portal/testimonials/prompt-due`:
  zero matches anywhere. Expected — no `Design/portal/` export exists yet for a
  Testimonials page, portal-side, and no prior `portal-v2` page ever called these
  (they're new as of #3891/#3892, not a retirement-era orphan).
- `GET /api/admin/testimonials/all`: zero matches in `artifacts/admin-panel/src`. The
  real, live admin Testimonials page
  (`artifacts/admin-panel/src/pages/crm/Testimonials.tsx:34`) calls
  `/api/admin/closures/signed` only — the pre-existing `project_closures`-only read.
  #3891 built `/admin/testimonials/all` specifically to merge in the new
  `customer_testimonials` source (per its own body: "Admin-side: extend
  `admin-testimonials.ts` to also list `customer_testimonials` rows alongside the
  existing `project_closures` ones") but nothing wires the admin page to the merged
  endpoint — the page still reads only the narrower, closure-only one. **A customer who
  submits a standing testimonial today (via #3891's own `POST` endpoint, once a
  portal page exists to call it) will not appear anywhere in the admin CRM's
  Testimonials view until this page is repointed at `/admin/testimonials/all`.**

Filed as four real orphaned-endpoint findings, one issue, parented to #3436 (this
pack's own Feature) per standing rule — not the Epic:

- **#4031** — `bug`, labeled, board status set to AI Batter Up.

---

## 6. Finding — no schema or endpoint exists yet for the approval → discount mechanism settled on #3436

#3436's own settled decision (2026-09-14, Shane): the discount fires **only on Admin
Panel approval/publish**, as a one-time credit against the customer's next month of
service — not on submission. That mechanism does not exist anywhere in the current
schema or routes:

- `customer_testimonials` has no `status`, `approvedAt`, `approvedByUserId`, or
  `publishedAt` column — only `permissionToPublish` (a customer-set intent flag at
  submission time, not an admin decision record).
- `GET /api/admin/testimonials/all` is read-only — there is no `POST`/`PATCH` route
  anywhere that records an approval decision against either source table.
- No coupon/credit is issued anywhere in this code path. The pre-existing
  `coupons.requiresTestimonial` boolean (`index.ts:1876`) is confirmed to run the
  *other* direction — a coupon that requires a testimonial to redeem — and has no
  foreign key or other real linkage to `customer_testimonials`; #3436's own comment
  already flags these as two different mechanisms that "should be built as its own
  real trigger... rather than forced into that existing mechanism if the shapes don't
  actually match," and the code confirms the shapes don't match (no shared column, no
  shared table).

This is real, current absence — not a gap this pack is positioned to close itself
(implementing the approval workflow and discount-issuance mechanism is a real,
undecided architecture question flagged explicitly on #3436 as "worth confirming at
architecture time," still open) and squarely a product/architecture decision, not a
missing column. Filed as its own issue, parented to #3436:

- **#4032** — `bug`, labeled, board status set to AI Batter Up.

---

## 7. Real enum unions

- **`customer_testimonials.kind`** — `CUSTOMER_TESTIMONIAL_KINDS` (`index.ts:1649`):
  `"testimonial" | "feedback" | "suggestion"`. Enforced at two layers: a Postgres
  `CHECK` constraint (`customer_testimonials_kind_check`, `index.ts:1644` /
  migration `:16`) and the `postSchema` Zod `z.enum(...)` on the write path
  (`portal-testimonials.ts:33`) — both layers agree, no drift between them. All three
  values are real and reachable; none is dead.
- **`GET /admin/testimonials/all` → `source`** — application-level union, not a DB
  enum: `"project_closure" | "customer_testimonial"` (`:110, 123`). Both values are
  always reachable — the endpoint always runs both queries.
- **Coupon `requiresTestimonial`** (`index.ts:1876`) is a plain `boolean`, not an enum
  — noted here only because it's easy to mistake for a related vocabulary; it isn't
  one (see §6).

---

## 8. Honest-empty / partial-data contract

- **`GET /api/portal/testimonials`**: a login with zero submissions gets a real `[]`,
  never a fixture substitution — there is no fixture branch in this router at all. A
  failed read is a `500` with a distinct error message; a caller must distinguish
  empty-but-200 from errored-500 itself.
- **`GET /api/portal/testimonials/prompt-due` → `lastSubmissionAt`**: `null` is a
  genuine "this tenant has never submitted," not an error state — `due` still
  evaluates correctly against a `null` (the `daysSinceLastSubmission === null` branch
  in §3's logic), so a customer past their 30-day mark with zero submissions reads
  `due: true` correctly.
- **`GET /api/admin/testimonials/all`**: an empty array is real "no signed closures and
  no standing submissions exist yet," not a fixture — both source queries run
  unconditionally and concatenate, so `[]` requires both to genuinely be empty. There
  is no separate read-failure branch in this route (no `try`/`catch` at all around the
  `Promise.all`) — a DB error here throws to Express's own default error handler
  rather than returning a documented error shape, unlike the three portal-side routes
  which each wrap their body in `try`/`catch` with a stated `500` message. Not filed as
  a finding — this asymmetry is a real, minor consistency gap on an already-orphaned
  endpoint (§5), noted here rather than filed as its own issue since fixing an error
  handler on a route nothing calls yet is not a customer-facing gap today.

---

## 9. Cross-surface edges

- **`customer_testimonials` vs. `project_closures.feedback`**: deliberately separate
  tables per #3891's own scope — `project_closures.feedback` stays the
  project-closure-specific record it already was before this Feature, gated on a
  project actually closing; `customer_testimonials` is the new standing, any-time
  surface this Feature added. `GET /admin/testimonials/all` (§4) is the only place
  that reads both together; every other admin/portal route touches exactly one of the
  two.
- **`customer_testimonials` vs. `coupons.requiresTestimonial`**: unrelated mechanisms
  that happen to share the word "testimonial" — confirmed no shared column/FK (§6).
  Worth Design/architecture awareness so the eventual approval→discount build (§6)
  isn't mistakenly bolted onto the coupon-requires-testimonial flow, which runs the
  reverse direction (redemption requires a testimonial, not "submitting one grants a
  discount").
- **`GET /api/portal/testimonials` (own-login scope) vs.
  `GET /api/portal/testimonials/prompt-due` (tenant-wide scope)**: real, deliberate
  scoping difference within the same router — see §3.

---

## Orphaned-endpoint check

```
grep -rn "portal/testimonials\|admin/testimonials/all" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting artifacts/admin-panel/src
```

returns no matches. This is expected, current state — no `Design/portal/` export
exists yet for a Testimonials page (portal-side or admin-side), and the admin CRM's
real, live Testimonials page calls only the older, narrower
`/api/admin/closures/signed` endpoint (§5). All four routes covered by this pack are
real and exercised by nothing today; that is the honest state Design should build
against, not a gap this pack needs to close.

---

## Not covered by this pack

Per #2446's Step 3 precedent (same discipline this pack follows), no page/UI-shape
decisions are made here. This pack extracts what exists on the four named endpoints;
it does not decide what a Testimonials page (portal-side or admin-side) should look
like, and it does not design the approval→discount mechanism flagged missing in §6 —
that is real, undecided product/architecture scope, not something a contract-extraction
pass settles.

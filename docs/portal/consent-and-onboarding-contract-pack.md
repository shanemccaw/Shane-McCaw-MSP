# Consent and Onboarding (Portal) — contract extraction pack

**Issue:** #2758, part of #1650 ("Feature: Consent and Onboarding (Portal)"), part of
#1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below
traces to one of the files listed, cited to file:line. This is Phase 2 of the Portal
build order (architect → build the endpoints → regenerate the contract pack → Design →
wire) — no page/UI-shape decisions are made here.

The 5 endpoint families named in #2758's own body were confirmed real and live in the
current codebase before any of this was written:

- `GET /api/consent/callback` (the redirect/close-popup mechanics behind
  `consent-success`/`consent-declined`/`consent-tenant-conflict`) — `consent.ts:453`
- `POST /api/portal/onboarding/contract` — `portal-onboarding.ts:416`
- `POST /api/portal/checkout/free` — `portal-checkout-free.ts:370`
- `GET /api/public/checkout-session/:id` — `public-services.ts:275`
- `GET /api/services` — `public-services.ts:43`
- `POST /api/msp/onboarding/generate-link` — `msp-onboarding.ts:86`

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/consent.ts` — the full admin-consent OAuth flow:
  `POST /consent/invite-link`, `POST /portal/consent/reconsent-link`,
  `GET /consent/callback`, `GET /consent/declined`, `GET /admin/consent`,
  `PATCH /admin/consent/:tenantId/revoke`
- `artifacts/api-server/src/routes/portal-onboarding.ts` — `POST
  /portal/onboarding/contract` and its PDF-generation helper
- `artifacts/api-server/src/routes/portal-checkout-free.ts` — `POST
  /portal/checkout/free` and the shared `provisionFreeOnboarding()` it and
  `claim-free` (out of scope, see below) both call
- `artifacts/api-server/src/routes/msp-onboarding.ts` — all 7 routes: `POST
  /msp/onboarding/generate-link`, `GET /msp/onboarding/links`, `GET
  /public/onboarding/link/:token`, `POST /public/checkout/gate`, `GET
  /public/msps/direct`, `GET /public/msp-invite/:token`, `POST
  /public/msp-invite/:token/accept`
- `artifacts/api-server/src/routes/public-services.ts` — `GET /services`, `POST
  /public/checkout-session`, `GET /public/checkout-session/:id`, `GET
  /public/consent-url` (read in part, for the checkout-session/consent handoff only)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `MspRole`, `ROLE_ORDER`,
  `requireRole()`
- `lib/db/src/schema/msp.ts` — `consentInviteTokensTable`, `mspOnboardingLinksTable`,
  `mspInvitesTable`
- `lib/db/src/schema/index.ts` — `checkoutSessionsTable`, `tenantsTable.consent`
  (`TenantConsentRecord`/`TenantConsentMap`), `servicesTable`, `contractsTable`
- `artifacts/shane-mccaw-consulting/src/pages/home/AssessmentFlow.tsx` — the one
  confirmed live caller of the checkout-session + consent machinery, read to
  establish which real flow currently reaches these endpoints (§9a)
- Archived old portal-v2, all 5 named pages (`git show
  portal-archive-2026-08-29:artifacts/msp-portal/src/pages/<name>.tsx`) — read in
  full, per #2758's own instruction, for real request/response shapes and every
  branch/error state. Not used as a source of field shapes or vocabulary beyond
  what the live endpoints actually return — per the standing rule, the old pages
  are a signal about what UI states exist, not a design target.

---

## 1. Wire contract — `GET /api/consent/callback`

**No `requireRole` gate at all** — this is Microsoft's own OAuth redirect target
(`consent.ts:453`), not a page a browser navigates to directly. It is the one route
behind all three "outcome" pages the old portal-v2 rendered
(`consent-success`/`consent-declined`/`consent-tenant-conflict`); there is no separate
JSON endpoint for any of those three — this callback resolves the outcome and either
redirects to a portal path or serves a self-closing popup page, per the two real UI
origins below.

**Query params Microsoft appends:** `tenant` (GUID), `admin_consent` (`"True"`/absent),
`state` (either a UUID checkout-session id or a 64-char hex invite token), `error` /
`error_subcode` (present only on decline).

**Two structurally different callers, and the response shape depends on which one
(`:276-343`):**

| `uiOrigin` | When | Response |
|---|---|---|
| `"popup"` | `state` is a UUID (`isCheckoutSession`, `:462-463`) — the marketing-site funnel opened Microsoft in a `window.open` popup | `200 text/html`, a small self-contained page that reports the outcome and calls `window.close()` after 600ms (except the tenant-conflict terminal case, which stays open) |
| `"portal"` | `state` is absent or a non-UUID invite token | `302` redirect to one of three real portal paths below |

**This distinction is load-bearing for #2758's own scope**: the 5 archived pages this
pack documents (`consent-success`, `consent-declined`, `consent-tenant-conflict`) are
the **`"portal"`-origin** redirect targets only. The live marketing-site flow
(`AssessmentFlow.tsx`, see §9a) is `"popup"`-origin and **never reaches these three
pages at all** — it polls `GET /api/public/flow/consent-status` (a separate route, not
named in #2758 and not documented here) and advances itself in-page. Design should
treat these 3 pages as serving the **MSP-invite-link / logged-in-customer reconsent
path only** (`inviteRecord` set, or a non-UUID `state`), not the marketing funnel.

### 1a. Portal redirect — success (`consent-success.tsx`'s real target)

`302` to `/portal/consent/success?tenant=<GUID>` (`:619`). Query params: `tenant`
(always present) — **no `session` param is ever appended by this route**; the archived
page's own `session` query-param branch (`isDirectBusiness`) is dead for every path
this redirect can produce, because a `session`-bearing (UUID `state`) consent always
resolves to `"popup"` origin instead (see §9b for why this is a real, non-hypothetical
finding, not a hypothetical branch).

Side effects that already happened **before** this redirect fires (all real, all
described in `consent.ts`'s own header/inline comments):
- `tenants.consent.graph` and `.sharepoint` both stamped `status: "granted"` (`:736,
  751-756`) — same App Registration covers both (Git #480).
- For an invite-token path with `inviteRecord.customerId`, that customer's `status`
  flips `"onboarding"` → `"active"` (`:782-795`), guarded so an admin's own
  `"inactive"`/`"archived"` is never overwritten.
- A fire-and-forget diagnostics run and DLP/Label role-group provisioning both start
  (`:995-1083`) — non-fatal, logged, never delays this redirect.
- `tenants.domain` is best-effort captured via Graph (`:766-773`).

**What the archived page's `session`/`isDirectBusiness` UI branch documents that IS
still real**, for the one caller that does reach it with a `session` param present —
namely a `"popup"`-origin flow that was opened in a normal tab instead of a popup
(a real, acknowledged degraded case: popup blockers, or a buyer who copy-pasted the
Microsoft redirect URL) — the page's own client-side calls remain live and correct:
- `GET /api/public/checkout-session/:id` (§4) to resolve the session's `productSlug`/
  `seats`.
- `GET /api/services` (§5) to resolve the catalog entry and compute `isFree`.
- `POST /api/portal/onboarding/contract` (§2) then `POST /api/portal/checkout/free`
  (§3) to finalize a free order inline, using `guestInfo` cached client-side by the
  public checkout at `checkout_guest_<sessionId>` in `localStorage` — this page never
  writes that cache itself, only reads what an earlier step wrote.

### 1b. Portal redirect — declined (`consent-declined.tsx`'s real target)

`302` to `/portal/consent/declined?tenant=<GUID>` (`:503`), fired when Microsoft's
callback carries `error=access_denied` or `error_subcode=cancel` (`:466`). Side effect:
if `state` is a non-UUID invite token, it is burned (`usedAt` stamped, `:471-475`) —
**a decline permanently consumes the invite link**, same as an accept would; there is
no "try again with the same link" path. If `tenant` is present, `tenants.consent.graph`
is stamped `status: "declined"` (`:484-486`) **only if a `tenants` row already exists
for that GUID** — a decline from an org with no existing customer object records
nothing (logged, not silent, `:487-489`), matching the archived page's own framing
("no changes were made to your Microsoft 365 tenant").

The archived page's hardcoded `REQUIRED_PERMISSIONS` list (4 entries:
`Directory.Read.All`, `User.Read.All`, `Reports.Read.All`, `AuditLog.Read.All`) is
**not sourced from this callback's response** — this route returns no permissions list
at all. It is a static display list the old page authored itself. The real,
authoritative scope list this flow actually requests is `REQUIRED_MT_SCOPES`
(`graph.ts`, re-exported into `consent.ts:77` and separately into
`public-services.ts` for the free-scan start form, `:265`) — Design should read from
that manifest constant if this page needs to show real requested scopes, not
re-hardcode a list that can drift from it (flagged in §10, not filed — the archived
list happens to match `REQUIRED_MT_SCOPES` today, so it is stale-risk, not a currently
wrong display).

### 1c. Portal redirect — tenant conflict (`consent-tenant-conflict.tsx`'s real target)

`302` to `/portal/consent/tenant-conflict?tenant=<GUID>` — **but only for
`"portal"`-origin** callers; a `"popup"`-origin conflict gets the deliberately
non-self-closing popup page instead (`:557-569`, the *only* popup ending that doesn't
auto-close — see the file's own `endConsentCallback` comment, `:552-556`). Fired when
the Microsoft tenant that just consented already belongs to a **different** MSP than
the one the checkout session/invite belongs to (`:525-571`) — a real, previously-live
cross-tenant data leak this guard closes (confirmed incident cited in the code:
"user 92 under mspId 89 saw customer 1's data under mspId 1"). **No payment has
occurred and no tenant row is created or modified** on this path — the callback
returns before any DB write past the read-only conflict check.

---

## 2. Wire contract — `POST /api/portal/onboarding/contract`

**No `requireRole` gate — optional auth** (`:416-439`): a `Bearer` JWT resolves
`resolvedUserId`; absent/invalid JWT requires `guestEmail` in the body instead (`401`
if neither is present). Body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `serviceId` | `number` | one of `serviceId`/`serviceIds` | legacy single-service form |
| `serviceIds` | `number[]` | one of the two | multi-service form, takes priority if both present |
| `signerName` | `string` | yes | `400` if missing/blank |
| `signatureData` | `string` (data URL) | conditionally | required, and must start with `data:image/` and be ≥100 chars, **only if any resolved service's `serviceType` is `"project"` or `"retainer"`** (`:480-493`) — an assessment/monitoring service needs no drawn signature |
| `guestEmail` | `string` | required if unauthenticated | `401` if missing |
| `wizardSelections` | `Record<serviceId, {stepId,stepTitle?,optionId,optionLabel?,priceAdjustment?}[]>` | conditional | required per-step, strictly validated against the service's own `orderWorkflow` if it has one (`:516-556`) — `400` on any missing step, duplicate step, or unknown step/option id |
| `couponCode` | `string` | no | only consulted for the `requiresTestimonial` flag (§2a) |
| `guestName`/`guestCompany`/`guestPhone`/`guestAddress`/`guestCity`/`guestState`/`guestZip` | `string` | no | pre-saved onto the guest's `users` row at signing time, never overwriting an already-populated field (`:719-726`) |
| `appRegPermissionsAgreed` | `boolean` | no | stored verbatim on the contract row |
| `seats` | `number` | no, default `1` | clamped to `≥1` |

**Response, single service:** the raw `contracts` row **plus** `contractIds:
[<id>]` spliced on (`:736`). **Response, multiple services:** `{ contractIds:
number[], contracts: <row>[] }` (`:738`) — the archived page only ever reads
`contractIds[0]`, i.e. it is written for the single-service case even though the
endpoint supports multi-service.

**404** `{ error: "One or more services not found" }` if any `serviceId` doesn't
resolve (`:472-475`). **400** on: missing `serviceId(s)`/`signerName`
(`:464-467`), the signature-format/length gate above (`:485-492`), or any
wizard-workflow validation failure (`:524, 531, 541, 546`).

### 2a. Side effects (all per-service, in a loop — not one transaction across services)

- A `contracts` row is inserted per service (`:626-641`), with `finalPrice` computed
  server-side from the service's `orderWorkflow` + `wizardSelections` when the service
  has a wizard (never trusted from the client), clamped to `maxPrice` if set.
- A signed PDF is generated **synchronously, inline** (`generateContractPdf()`,
  `:37-414`) and uploaded to the client's SharePoint Contracts folder if the (already
  authenticated) user has a `sharepointSiteId` and Graph credentials are configured —
  **best-effort**: a PDF-generation or SharePoint-upload failure is caught and logged,
  and the contract row is still returned without `pdfFilename` (`:690-693`), not a
  500.
- If `couponCode` resolves to a `coupons` row with `requiresTestimonial: true`
  (`:607-624`), a testimonial-obligation clause is appended to the contract body and
  the generated PDF — this is the only effect `couponCode` has here; the coupon's own
  discount arithmetic is applied later, at checkout.
- For a guest (`resolvedUserId === null`), a **passwordless** `users` row is
  ensured via `ensureClientAccount()` (`:713-714`) — this is a pre-create for the
  address fields, not the real account creation. **This route never issues a JWT or
  logs anyone in.**

---

## 3. Wire contract — `POST /api/portal/checkout/free`

**No `requireRole` gate** (`:370`) — works both authenticated (JWT sets
`req.user.id`) and as a guest. **CAPTCHA required unconditionally**: `400` if
`captchaToken` is missing from the body, `403` if `verifyCaptchaToken()` fails
(transparently bypassed in dev/preview when `TURNSTILE_SECRET_KEY` is unset,
`:377-380`).

Body: `{ contractIds: number[], serviceIds: number[], guestEmail?: string,
captchaToken: string }`. Both id arrays are coerced through `Number(...)` and
filtered to valid numbers (`:382-383`) — a non-numeric entry is silently dropped,
not rejected.

**Response on success:** `{ ok: true, sentSetupEmail: boolean }` (`:393`).
**`sentSetupEmail` is `false` on both**: (a) an account that already has a password
(returning customer — gets an "onboarding-confirmation" email instead, a real but
different email, not reflected in this boolean at all), and (b) an idempotent replay
of an already-provisioned order (`alreadyProvisioned: true` internally, `:143`, but
that flag itself is **not** in the wire response — a replay looks identical to a
fresh `sentSetupEmail: false` provisioning on the wire).

**Errors, all `provisionFreeOnboarding()`'s own status/error pairs surfaced verbatim
(`:392`):**
- `400 { error: "No service IDs provided" }` / `"Services not found"` — empty or
  fully-unresolvable `serviceIds`.
- `400 { error: "This order has a non-zero price — use the standard checkout" }` —
  **the real server-side price guard** (`isServiceFree()`, checked across every
  pricing representation — flat columns AND `typeAttributes` — `:66-92`): a paid
  service can never provision through this route regardless of what the frontend
  believes.
- `401 { error: "Please provide your email address to complete registration." }` —
  unauthenticated with no `guestEmail`.
- `404 { error: "Account not found" }` — resolved `userId` no longer has a `users`
  row (should not happen in practice).
- `409 { error: "Your Microsoft 365 connection hasn't been set up yet. Please
  complete the connection step first so your order can be linked to your
  organization." }` — **the consent-first invariant** (§9c): a guest email with no
  account means the consent step (which provisions the account, §1a) was skipped;
  this route refuses to create an unscoped account rather than silently degrading.
- Uncaught exception → `500 { error: "We couldn't complete your free registration.
  Please try again in a moment." }` (`:394-396`).

### 3a. Side effects on success (`provisionFreeOnboarding()`, `portal-checkout-free.ts:50-361`)

- A `projects` row (`projectType: "quick_win"`), one `client_services` row per
  service, workflow steps + kanban tasks seeded from the primary service's
  `workflowTemplateId` (falling back to `seedDefaultWorkflowSteps` for every
  service after the first), and one `$0` `invoices` row per service.
- Idempotency key: `FREE-ONB-<userId>-<sorted serviceIds joined with ->` — a replay
  with the same user+services short-circuits to `{ ok: true, sentSetupEmail: false,
  alreadyProvisioned: true }` before any of the above re-runs (`:139-143`).
- Every pre-signed `contracts` row (by `contractIds`) is linked to the new
  `projects.id`, and its already-generated PDF (if any) is attached as a
  `documents` row.
- Email: a brand-new (no `passwordHash`) buyer gets an `account-setup` email with a
  72-hour token link (`ensureClientSetupToken()`); an existing-password buyer gets
  an `onboarding-confirmation` email instead — **mutually exclusive, never both**.
- Fire-and-forget admin notifications (SMS, in-app `notifications` rows, web push,
  device push, admin email) and a `onboarding.free_claimed` workflow event — all
  non-fatal, none of them can fail this response.

---

## 4. Wire contract — `GET /api/public/checkout-session/:id`

**Public, no auth.** `404 { error: "Not found" }` for a non-UUID `:id`
(`:277-280`) or a UUID that doesn't resolve to a live, unexpired row
(`:293-296`) — **these two 404s are indistinguishable on the wire**, matching the
same no-ownership-leak pattern documented elsewhere in this pack's sibling packs.

Response, **only 3 non-PII fields** (`:283-289`): `{ productSlug: string, status:
"pending" | "consented" | "paid" | "expired", seats: number }`. Deliberately never
returns `email`/`fullName`/`company`/`industry` — the archived page's own comment
confirms why: "the client caches name/email in localStorage alongside the sessionId
so they survive cross-origin redirects without the server ever exposing PII on this
public endpoint." A caller that expects PII from this endpoint (the way
`GuestInfoCache` reads it from `localStorage` instead) would be reading the wrong
source.

---

## 5. Wire contract — `GET /api/services`

**Public, no auth**, filtered to `visibility: "public"` always, with optional
`?type=` / `?category=` query filters (`:43-52`). Response: `CatalogService[]`, an
**explicit column projection** (not a bare `select()`, `:63-83` — deliberately, so a
pending-migration admin-only column never 500s this public storefront route).

The 5 archived pages collectively read only this subset of the full projected shape:

| Field | Type | Nullability | Consumer |
|---|---|---|---|
| `id` | `number` | not null | matched against a checkout session's `productSlug` |
| `slug` | `string` | not null | join key |
| `name` | `string` | not null | display |
| `tagline` | `string \| null` | nullable | display |
| `description` | `string \| null` | nullable | not used by these 5 pages |
| `price` / `basePrice` | `string \| null` | nullable | fed into `serviceIsFree()` |
| `priceCents` | `number \| null` | nullable | fed into `serviceIsFree()` |
| `isFreeOffering` | `boolean \| null` | nullable | fed into `serviceIsFree()` |
| `typeAttributes` | `Record<string, unknown> \| null` | nullable | `pricePerUserMonth`/`flatMonthlySurcharge`/`flatMonthlyPrice` read for the same free/paid gate — **the full price for a monitoring tier lives here, not in the flat columns** (see §9d's parallel confirmation on the server side) |

No pagination; the full public catalog is returned in one response.

---

## 6. Wire contract — `POST /api/msp/onboarding/generate-link`

Auth: `requireRole("MSPOperator")` (`:89`) — this is `initiate-onboarding.tsx`'s real
endpoint, unchanged in shape from what the archived page already calls. Rate-limited:
100/hour in production, 500/hour in dev (`:68-74`).

Body: `{ customerEmail: string, serviceId?: number, note?: string, ttlHours?: number
(default 72, clamped 1–168) }`. `400 { error: "A valid customerEmail is required" }`
on a malformed/missing email. `403 { error: "No MSP scope on this token" }` if the
JWT carries no `mspId`. `403 { error: "MSP is not active" }` if the caller's own MSP
row is `status: "suspended"` (`:120-123`) — **the archived page's form has no UI
state for this 403** (no error branch distinguishes it from the generic error
banner), a real gap Design should account for.

**Response:** `{ token: string, link: string, expiresAt: Date }` (`:144`) — matches
the archived page's `GeneratedLink` interface exactly. `link` is
`${SITE_URL}/onboarding/${token}` (`:141-142`) — **not** `/portal/onboarding/...`
or any portal-prefixed path; this is a bare top-level route the customer visits
directly, unauthenticated.

### 6a. Sibling routes on the same feature (pulled in — not named in #2758, but the direct downstream consumers of the link this route mints)

- **`GET /api/msp/onboarding/links`** (`:153-188`, `requireRole("MSPOperator")`) —
  lists the caller's own MSP's links (max 200, newest first), with a computed
  `status: "used" | "expired" | "pending"` derived from `usedAt`/`expiresAt` (there is
  no stored status column). **Not called by any of the 5 archived pages** — a real,
  live, currently-unexercised list endpoint for this same feature (see §10).
- **`GET /api/public/onboarding/link/:token`** (`:192-256`, public) — the landing page
  a customer reaches from the minted link. `404` if the token doesn't exist, `410` if
  already used or expired, `403` if the owning MSP is `"suspended"`. Response includes
  the pre-filled `customerEmail`, optional `serviceId`, `note`, and the MSP's branding
  (`name`/`slug`/`logoUrl`/`primaryColor`).
- **`POST /api/public/checkout/gate`** (`:271-371`, public, rate-limited) — an
  email-gate check a checkout flow runs before showing the catalog: `{ action:
  "redirect", portalUrl, mspName, mspSlug }` if the email already belongs to an
  **active or trial** MSP (staff `mspId` wins over a customer's `tenants.mspId` if
  both resolve, `:319`); `{ action: "proceed" }` otherwise (new email, inactive
  account, or a suspended/unresolvable MSP).
- **`GET /api/public/msps/direct`** (`:376-401`, public) — the direct-business MSP row
  (Shane's own book), for a checkout flow with no MSP-generated link in play. `404 {
  error: "No direct-business MSP configured" }` if none is flagged
  `isDirectBusiness` with an active/trial status — a real, load-bearing
  misconfiguration state (consent.ts's own `resolveOrCreateDirectTenant` depends on
  exactly this same flag existing, `consent.ts:710-721`).

---

## 7. Wire contract — `portal-identity-interstitial.tsx`'s real backing: no dedicated endpoint

**This page calls no API endpoint of its own.** It is a pure client-side branch on the
JWT already in hand — every field it renders (`user.mspRole`) comes from `useAuth()`'s
existing decoded-token state, not a fetch. It exists to intercept a non-`CustomerUser`
role that reached `/portal/` (customer-only) rather than `/admin-panel/`.

The real, authoritative role vocabulary is `MspRole` (`requireAuth.ts`, `ROLE_ORDER`,
`:80-88`): `"Assessment" | "Free" | "CustomerUser" | "ServiceAccount" | "MSPOperator" |
"MSPAdmin" | "PlatformAdmin"` — **7 values**, an exact match for the archived page's
own `ROLE_LABELS` record keys. Two of its actions:

- **"Log out and sign in at the Admin Panel"** — calls the existing `logout()` from
  `auth-context`, then a hard `window.location.href` to `/admin-panel/`. No new
  endpoint.
- **"Continue into the customer portal"** — a client-side `navigate("/portal-v2")`
  (dead literal path, see §9e) with no server call.

**Not covered by this pack**: which route/middleware actually decides to *send* a
staff role here in the first place (the archived page's own header comment says
`login.tsx` does this) — `login.tsx` is not one of the 6 named endpoint files and is
out of scope; this section documents only the interstitial page's own (absence of)
wire contract.

---

## 8. Honest-empty / partial-data contract

- **`GET /api/public/checkout-session/:id`**: no genuinely-empty success state exists
  — the row either exists (all 3 fields populated) or the route 404s. There is no
  partial/nullable field in the response shape.
- **`GET /api/services`**: an empty catalog is a real `[]`, not an error — no fixture
  branch exists in this route.
- **`GET /api/msp/onboarding/links`**: zero links for an MSP is a real `[]` (`:181`,
  bounded to 200 rows, no pagination beyond that cap).
- **`POST /api/portal/checkout/free`**: the `alreadyProvisioned` idempotency state
  (§3) is real, intentional, and **invisible on the wire** — a caller cannot
  distinguish "just provisioned" from "already existed" from the response shape
  alone; only the server-side log line does.
- **`GET /api/consent/callback`**: has no JSON failure shape at all on any path — every
  outcome is either an HTML popup page, an HTML redirect, or a raw `res.status(...).
  send(<plain string>)` (e.g. `:511, 599, 719`) — never a `{ error }` JSON body.

---

## 9. Findings

### 9a. The archived `consent-success.tsx` `session`/`isDirectBusiness` branch is dead for the flow that actually reaches it today

The live marketing-site funnel (`AssessmentFlow.tsx`) opens Microsoft consent in a
`window.open` popup (confirmed by that file's own header comment, `:44-51`) and polls
`GET /api/public/flow/consent-status` to advance itself in-page — it never navigates
to, and is never redirected to, `/portal/consent/success`. `consent.ts`'s own
`isCheckoutSession` check (`:462`) means **every** `state` that is a checkout-session
UUID resolves to `"popup"` origin and gets the self-closing page instead of this
redirect (§1). So the archived page's `session` query param — and its entire
`isDirectBusiness`/inline-finalize branch built around it — can only be reached today
by a popup-origin buyer whose popup failed to open as a popup (blocked, or the raw
Microsoft URL opened in a normal tab) and who is now looking at a same-tab page that
still carries `?session=...&tenant=...` in its URL. That is a real, live-reachable
degraded path (not literally unreachable), but it is **not** the primary route this
page was designed to serve — the primary caller (a genuine MSP-invite-link consent)
never has a `session` param at all. Not filed as a bug: the code correctly handles
both cases and nothing is broken; flagged so Design does not over-invest in the
`session`-present branch as if it were the common case.

### 9b. `consent-declined.tsx`'s hardcoded `REQUIRED_PERMISSIONS` list has a real single source of truth it doesn't read from

The archived page hardcodes 4 permission name+reason pairs
(`Directory.Read.All`/`User.Read.All`/`Reports.Read.All`/`AuditLog.Read.All`). The
real, live, single-source scope list this flow actually requests is
`REQUIRED_MT_SCOPES` (defined in `graph.ts`, imported into both `consent.ts:77` and
`public-services.ts` for the free-scan scope-disclosure response, `:265`). Today the
hardcoded list happens to be a subset/match of that constant, so there is no current
display bug — but it is drift-risk with no compiler or runtime tie between them: if
`REQUIRED_MT_SCOPES` gains or loses a scope, this page's static list silently goes
stale. Not filed (no live mis-display today); flagged for Design/wiring awareness
that a live scope-manifest source already exists and should be read from, not
re-copied.

### 9c. The 409 consent-first guard on `/portal/checkout/free` is real and the archived page has no UI branch for it

`provisionFreeOnboarding()` explicitly refuses to create an unscoped guest account
when a guest email resolves to nothing (`:109-126`) — a real, deliberate hard
failure mode with its own dedicated 409 status and message, tied directly to a
documented past incident (a paid, non-functional account). The archived
`consent-success.tsx`'s `handleFinalize()` only distinguishes a generic contract-step
failure from a generic checkout-step failure (`setError(err.error ?? "...generic...")`
for both, `:266-268, 279-281`) — it does surface the server's real `error` string
verbatim, so the 409's specific message would in fact display, but there is no
distinct UI treatment (e.g. a "go back and reconnect" CTA) for this specific,
recoverable case versus a generic network failure. Not filed as a bug (the message
does surface); flagged as a real UX gap for Design to address explicitly, since this
409 is the direct, documented descendant of a real production incident and deserves
better than a generic error banner.

### 9d. `portal-identity-interstitial.tsx`'s "Continue into the customer portal" target (`/portal-v2`) is a dead literal path

The archived page's accept action navigates to the literal string `/portal-v2`
(`:66`) — a portal-v2-era route that no longer exists in the current tree (portal-v2
was retired 2026-08-29, per this repo's own standing CLAUDE.md convention; confirmed
no `artifacts/msp-portal` directory exists in the current tree, only the new
`artifacts/portal` scaffold under #1485). This is a real, load-bearing UI-navigation
gap in the archived page as written — Design must resolve it to whatever the new
#1485 customer-portal entry route actually is, not carry the literal string forward.
Not filed as a new bug: the whole reason this page is archived and being
re-contracted here is that its target surface was retired; this is exactly the kind
of pre-existing staleness #2758 exists to catch before Design starts, not a new
defect introduced by this pack.

---

## 10. Orphaned-endpoint check

```
grep -rn "consent-success\|consent-declined\|consent-tenant-conflict\|initiate-onboarding\|portal-identity-interstitial\|/portal/consent/\|onboarding/generate-link\|msp/onboarding\|checkout-session\|portal/checkout/free\|portal/onboarding/contract" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

Real result: `artifacts/portal` (the new #1485 scaffold) has **zero** hits — matching
#2758's own premise: no `.dc.html` export exists yet for any of these 5 pages, and no
page in the new portal scaffold references any of this pack's endpoints. That is real,
current state, not evidence of breakage.

The **one** confirmed live caller across the whole tree is
`artifacts/shane-mccaw-consulting/src/pages/home/AssessmentFlow.tsx`, which reaches
`POST /public/checkout-session` (creating the session), `GET
/public/checkout-session/:id` indirectly via its own session-status polling, and (per
§9a) the popup-ending half of `GET /consent/callback` — but explicitly **not** the
`"portal"`-origin redirect targets this pack's §1a/§1b/§1c document, and not
`GET /api/msp/onboarding/links`, `GET /api/public/onboarding/link/:token`, `POST
/api/public/checkout/gate`, or `GET /api/public/msps/direct` (§6a) — those four have
**no current frontend caller anywhere in the tree**. That is real, current state (the
only prior caller of the MSP-onboarding-link family, old portal-v2's
`initiate-onboarding.tsx`, was retired 2026-08-29) — Design should build against these
real, live, unexercised endpoints, not treat the absence of a caller as evidence
something is broken.

---

## Not covered by this pack

Per #2758's own scope, no page/UI-shape decisions are made here. `GET
/api/public/flow/consent-status` and `GET /api/public/consent-url` (the two routes the
live `"popup"`-origin marketing funnel actually polls/reads, referenced only for §9a's
finding) are not opened beyond that reference — they belong to the Assessment/Home
purchase flow's own contract, not this Feature's 6 named endpoint families. The admin
tier of `consent.ts` (`GET /admin/consent`, `PATCH
/admin/consent/:tenantId/revoke`, `POST /consent/invite-link`) is documented in §1's
source list only to the extent needed to establish the callback's own behavior; those
three are PlatformAdmin/admin-panel surfaces, not customer-facing, and are out of scope
for Design under this Feature. `claim-free` (`POST /portal/onboarding/claim-free`, described in
`portal-checkout-free.ts`'s own header comment, `:46`, as the CRM-side sibling of
`POST /portal/checkout/free`, sharing the same `provisionFreeOnboarding()`) is named
only in that comment — **no route registers this path in `portal-checkout-free.ts` or
anywhere else searched for this pack**; it is not part of this customer-facing
Feature's live surface either way.

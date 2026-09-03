# Signup, Agreement and Invite — contract extraction pack

**Issue:** #2442, part of #1649 ("Feature: Signup, Agreement and Invite (Portal)"), part of
#1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below traces
to one of the files listed, cited to file:line. All five endpoints named in #2442's body were
verified live and unchanged in shape by the #1673 portal restructure; none are orphaned.

Design surface: none yet — portal-v2's old signup/agreement/invite pages are retired (see
CLAUDE.md's portal-v2 retraction note). This pack is extracted straight from the backend, not
from the old pages' layout, field groupings, or vocabulary.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-signup.ts` — `GET /api/msp/signup/tiers`,
  `POST /api/msp/signup/start`, `GET /api/msp/signup/success`
- `artifacts/api-server/src/routes/platform-agreements.ts` — `GET /api/platform/agreement/current`,
  `GET /api/platform/agreement/acceptance-status`, `POST /api/platform/agreement/accept`, plus
  the `PlatformAdmin`-only `/api/admin/platform-agreements*` CRUD
- `artifacts/api-server/src/routes/msp-onboarding.ts` — `GET /api/public/msp-invite/:token`,
  `POST /api/public/msp-invite/:token/accept` (also `generate-link` / `checkout/gate` / `msps/direct`,
  the customer-onboarding-link half of this file, out of scope for #2442's five named endpoints
  but documented in §6 for the cross-surface edge)
- `artifacts/api-server/src/routes/msp-settings.ts:1615-1770` — `POST/GET/DELETE
  /api/msp/settings/invites*`, the write side that actually creates the rows
  `GET /api/public/msp-invite/:token` reads
- `artifacts/api-server/src/lib/catalog-pricing.ts` — `resolveEffectiveChargeCents()`, the
  canonical price resolver used by both `tiers` and `start`
- `artifacts/api-server/src/lib/productTypeConfig.ts` — the `platform_subscription_tier` →
  `msp_monthly_subscription` fulfillment-type mapping
- `lib/db/src/schema/index.ts` — `services` table (`fulfillmentType` enum, `1152`), the tier
  source rows
- `lib/db/src/schema/msp.ts` — `platform_agreements` (`:1152`), `msp_agreement_acceptances`
  (`:1173`), `msp_invites` (`:597`), `msps` (`:34`) table definitions
- `artifacts/api-server/src/routes/index.ts:127-443` — router mount confirmation (all live
  under `/api`)
- Local PostgreSQL (`shanemccawmsp`, `DATABASE_URL`) — queried live for §2/§5 real-state checks

---

## 1. Wire contract — MSP self-service signup

### `GET /api/msp/signup/tiers` — public, no auth (`msp-signup.ts:38-103`)

Selects `services` rows where `fulfillmentType = "msp_monthly_subscription"` OR
`fulfillmentTypeKey = "msp_monthly_subscription"` (`msp-signup.ts:66-69`), ordered by
`sortOrder`. Response: `{ tiers: Tier[] }`.

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `services.id` |
| `slug` | `string` | not null | `services.slug` |
| `name` | `string` | not null | `services.name` |
| `description` | `string \| null` | nullable | `services.description` |
| `tagline` | `string \| null` | nullable | `services.tagline` |
| `price` | `string` | not null | **re-derived**, not the raw column — `msp-signup.ts:86`: `resolveEffectiveChargeCents(t,1)/100` formatted `.toFixed(2)` when > 0, else the raw legacy `price` string. See note below. |
| `priceCents` | `number` | not null | `msp-signup.ts:87` — the canonical resolved integer cents, same resolver as `start` uses for the actual Stripe charge |
| `basePrice`, `maxPrice` | `string \| null` | nullable | raw legacy columns, passed through unmodified (spread at `msp-signup.ts:85`) |
| `billingType` | `string` | not null | `services.billingType` |
| `features`, `inclusions` | `jsonb` | nullable | raw columns |
| `badge` | `string \| null` | nullable | `services.badge` |
| `highlighted` | `boolean` | not null | `services.highlighted` |
| `tier` | `string \| null` | nullable | `services.tier` |
| `pageHref` | `string \| null` | nullable | `services.pageHref` |
| `serviceType` | `string` | not null | `services.serviceType` |
| `isFreeOffering` | `boolean` | not null | `services.isFreeOffering` |
| `sortOrder` | `number` | not null | `services.sortOrder` |
| `fulfillmentType`, `fulfillmentTypeKey` | `string \| null` | nullable | raw columns |
| `tenantAllowance` | `unknown \| null` | nullable | `typeAttributes.tenantAllowance ?? null` (`msp-signup.ts:88`) |
| `aiCreditAllowance` | `unknown \| null` | nullable | `typeAttributes.aiCreditAllowancePlatformValue ?? typeAttributes.aiCreditAllowance ?? null` |
| `aiCreditAllowancePlatformValue`, `aiCreditAllowanceMspValue`, `aiCreditOverageRateCents`, `overageRateCents` | `unknown \| null` | nullable | flattened out of `typeAttributes` (`msp-signup.ts:89-93`) |
| `tierCapabilities` | `object` | not null (defaults `{}`) | `typeAttributes.tierCapabilities ?? {}` (`msp-signup.ts:94`) |

**Price resolution note (real, in-code comment, `msp-signup.ts:75-82`):** a tier created via
the modern admin API carries its price only in the integer `priceCents` column — legacy
`price`/`basePrice` are `NULL` — so serving the raw legacy column previously rendered every
modern tier as "Contact for pricing." `resolveEffectiveChargeCents()` is now the single
canonical source both this list endpoint and the actual Stripe charge in `start` read from.

### `POST /api/msp/signup/start` — public, no auth (`msp-signup.ts:114-353`)

Request body: `{ companyName, domain?, contactName?, contactEmail, serviceId, agreementVersion?, agreementId?, checkboxConfirmed? }`.

**Agreement gate (GAP-05, `msp-signup.ts:150-196`):** if a `platform_agreements` row has
`isCurrentVersion = true`, the request MUST carry `checkboxConfirmed === true` (400
`AGREEMENT_CHECKBOX_REQUIRED` otherwise) AND `agreementVersion` matching that row's `version`
exactly (400 `AGREEMENT_REQUIRED` with `requiredVersion` otherwise). **If no
`platform_agreements` row is currently published, the gate is skipped entirely and the signup
proceeds** — logged as a warning (`msp-signup.ts:191-195`), not blocked. See §2: this is the
real, current state of the testbed database today.

Validates `serviceId` resolves to a service with `fulfillmentType` or `fulfillmentTypeKey`
of `msp_monthly_subscription` (400 otherwise), and that it has a configured price via the
same `resolveEffectiveChargeCents()` resolver (400 `"Service tier has no price configured"`
otherwise). **See §5 — this validation does not distinguish an actual platform tier from a
different product type that happens to carry the same `fulfillmentType` value.**

Creates/finds a Stripe customer by `contactEmail`, creates an ad-hoc monthly Stripe Price at
the resolved `chargeCents`, and creates a Stripe Checkout Session (`mode: "subscription"`).
Agreement acceptance evidence (`agreement_accepted`, `agreement_version`, `agreement_id`,
`signup_ip`, `signup_ua`) is carried in the session's `metadata`, consumed later by
`msp-billing-webhook.ts` to actually insert the `msp_agreement_acceptances` row — **the MSP
record itself, and the agreement-acceptance row, are NOT created by this endpoint**; both are
provisioned by the webhook once Stripe confirms payment (`msp-signup.ts:6-9`).

Response: `{ checkoutUrl, sessionId }`.

### `GET /api/msp/signup/success` — public, no auth (`msp-signup.ts:359-417`)

Query: `?session_id=<stripe checkout session id>`. Retrieves the Stripe session
(`expand: ["subscription"]`). If `payment_status !== "paid"` → `{ status: "pending", message }`.
Otherwise derives a slug from `session.metadata.msp_company_name` and checks whether an `msps`
row with that slug already exists (i.e. whether the webhook has already provisioned it):

| Response `status` | Meaning |
|---|---|
| `"pending"` | Stripe hasn't confirmed payment yet |
| `"provisioned"` | webhook already ran — `{ mspId, mspName, message }` |
| `"provisioning"` | payment confirmed, webhook hasn't fired yet — real polling case, not an error |

---

## 2. Wire contract — Platform Agreement (clickwrap MSA/DPA)

### `GET /api/platform/agreement/current` — public, no auth (`platform-agreements.ts:30-47`)

Returns the full `platform_agreements` row (`select()` with no column projection) where
`isCurrentVersion = true`, or `{ agreement: null }` if none is published. Full row shape
(`platform_agreements`, `msp.ts:1152-1164`): `id`, `version`, `title` (default `"Platform MSA
+ DPA"`), `body` (raw text, presumably HTML/markdown — no rendering hint in the row itself),
`publishedAt`, `publishedByUserId`, `isCurrentVersion`, `createdAt`, `updatedAt`.

**Real, current state of the local database (queried live, 2026-09-03):**

```
 id | version | is_current_version
----+---------+--------------------
  1 | Test    | f
```

One draft row exists (`version = "Test"`), never published. `GET
/api/platform/agreement/current` genuinely returns `{ agreement: null }` today — this is a
real, verified empty state, not a read failure, and it is exactly why the `start` gate above
is currently a no-op in this environment. Design should build the "no agreement published"
state as a real, reachable case, not a placeholder.

### `GET /api/platform/agreement/acceptance-status` — MSP-authenticated, `requireAuth` (`platform-agreements.ts:51-88`)

No request body. Looks up the current agreement; if none, returns `{ required: false,
accepted: true }` (nothing to accept). If one exists, looks up an
`msp_agreement_acceptances` row for `(userId, agreementVersion)` and returns:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `required` | `boolean` | not null | `true` once a current agreement exists |
| `accepted` | `boolean` | not null | `!!acceptance` |
| `acceptedAt` | `Date \| null` | nullable | `acceptance?.acceptedAt ?? null` |
| `version` | `string` | not null (only present when `required`) | `current.version` |

### `POST /api/platform/agreement/accept` — MSP-authenticated, `requireAuth` (`platform-agreements.ts:92-157`)

Body: `{ checkboxConfirmed: boolean }`. 400 if not `true`. If no current agreement, no-op
success (`{ ok: true, message: "No agreement currently published" }`). Idempotent: if an
acceptance row already exists for `(userId, current.version)`, returns `{ ok: true }` without
a second insert. Otherwise inserts into `msp_agreement_acceptances`:

| Column | Source |
|---|---|
| `mspId` | `user.mspId ?? null` |
| `userId` | `user.id` |
| `agreementVersion` | `current.version` |
| `agreementId` | `current.id` |
| `ipAddress` | `req.ip ?? req.socket?.remoteAddress ?? null` |
| `userAgent` | `req.headers["user-agent"] ?? null` |
| `checkboxConfirmed` | `true` (hardcoded — the route already 400'd on anything else) |

**Real enum note:** `msp_agreement_acceptances` is schema-documented (`msp.ts:1170-1172`) as
"one row per MSP signup … never deleted — audit trail," but this route's own path is a
*separate*, later acceptance mechanism from the one described in §1 (the webhook-driven insert
at initial signup). A user can therefore accept the same agreement version twice through two
different code paths (signup-time via the webhook, and later via this endpoint) — the
idempotency guard here only protects against double-submission of *this* endpoint, not against
a duplicate row already inserted by the signup webhook for the same `(userId,
agreementVersion)` pair, since that path does its own unguarded insert
(`msp-billing-webhook.ts` — not read in full for this pack; flagged for the "no genuine
finding fixed in this build" ledger below, not filed, because it wasn't independently
confirmed against the webhook's actual insert logic in this session).

### Admin CRUD (`PlatformAdmin` or legacy `admin` role, `requireRole("PlatformAdmin")`)

`GET /api/admin/platform-agreements` (list all, newest first) · `POST
/api/admin/platform-agreements` (create draft, `{version, title?, body}` required version+body)
· `PUT /api/admin/platform-agreements/:id` (edit a draft only — 400 if `isCurrentVersion`) ·
`PATCH /api/admin/platform-agreements/:id/publish` (transactional: unsets `isCurrentVersion`
on every row, then sets it on the target — real single-current-version invariant, enforced in
a `db.transaction`, `platform-agreements.ts:258-272`). Out of scope for #2442's five named
endpoints but the only way the empty state in §2 above gets filled — Design/Shane need this to
actually publish a version before the clickwrap gate does anything.

---

## 3. Wire contract — MSP staff invite (accept side)

**Two-sided feature; #2442 named only the public accept-side endpoints. The write side that
actually creates the rows those endpoints read is `msp-settings.ts:1615-1770` — included here
because the accept-side contract is meaningless without it.**

### Write side — `POST /api/msp/settings/invites` — `requireRole("MSPAdmin")` (`msp-settings.ts:1622-1718`)

Body: `{ email, mspRole: "MSPAdmin" | "MSPOperator" }` (zod-validated). Rejects with 409 if the
email is already an active member of the calling MSP, or if an unexpired, unused invite to the
same email already exists for this MSP. On success, inserts an `msp_invites` row (72-hour
expiry, `randomBytes(32).toString("hex")` token), sends an email via `sendEmailForMsp`
(**Exchange Online / Graph, per this repo's mail-transport rule — no Resend anywhere in this
path**), writes an `invite.create` audit-log row, and returns the full inserted row (`201`).

`GET /api/msp/settings/invites` (same role) lists unused, unexpired invites for the caller's
MSP, left-joined to `users` for `inviterEmail`/`inviterName`. `DELETE
/api/msp/settings/invites/:inviteId` revokes (hard-deletes) an unused invite, scoped to the
caller's MSP, with an `invite.revoke` audit-log row.

`msp_invites` real schema (`msp.ts:597-610`): `id`, `token` (unique), `mspId` (FK, cascade
delete), `invitedEmail`, `mspRole` (enum `"MSPAdmin" | "MSPOperator"`, default
`"MSPOperator"`), `invitedByUserId`, `expiresAt`, `usedAt` (null = unused), `createdAt`.

**Real, current state of the local database (queried live, 2026-09-03): zero rows.** No
invite has ever been created in this environment — a genuinely empty, not a broken, list.

### `GET /api/public/msp-invite/:token` — public, rate-limited (`msp-onboarding.ts:369-425`)

Joins `msp_invites` → `msps`. 404 if the token doesn't resolve, 410 if `usedAt` is set or
`expiresAt < now`, 403 if the owning MSP's `status = "suspended"`. On success:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `invitedEmail` | `string` | not null | `msp_invites.invitedEmail` |
| `mspRole` | `"MSPAdmin" \| "MSPOperator"` | not null | `msp_invites.mspRole` |
| `expiresAt` | timestamp | not null | `msp_invites.expiresAt` |
| `msp.id`, `.name`, `.slug`, `.logoUrl`, `.primaryColor` | mixed | `logoUrl`/`primaryColor` nullable | `msps` row, joined |

### `POST /api/public/msp-invite/:token/accept` — public, rate-limited (`msp-onboarding.ts:436-675`)

Body (zod): `{ name?: string (2-120 chars), password?: string (min 8) }`. Same
404/410/403 token checks as the GET above, plus:

- **Existing-user branch:** if `invitedEmail` already has a `users` row, the request MUST
  carry a valid `Authorization: Bearer` JWT whose decoded `email` matches the invited email
  (case-insensitive) — otherwise 401 `requiresSignIn: true` or 403 if signed in as someone
  else. This is a real anti-hijack guard: a bare token can never reassign another user's MSP
  membership by itself.
- **New-user branch:** `name` and `password` become required (400 if missing).
- Atomic transaction (`msp-onboarding.ts:542-601`): burns the token
  (`UPDATE ... WHERE id = ? AND usedAt IS NULL`, guards the double-accept race), then either
  re-points an existing user's `mspId`/`mspRole`/`isActive` at this MSP, or inserts a brand-new
  `users` row with `mspId`/`mspRole` set inline (a bare insert would otherwise default to
  `mspRole = "Free"`, which the `users_role_scope_check` constraint rejects without a
  `tenantId` — real, load-bearing comment at `msp-onboarding.ts:560-564`).
- On success, if a new-user-equivalent account was just provisioned, checks
  `getActiveMfaMethods()` / `mfaEnforcementActive()` (same MFA-gate logic as password-based
  signup — real cross-surface edge, see §6) and issues real access/refresh tokens
  (`msp-onboarding.ts:646-666`) so the accepting user lands signed in, with
  `mfaSetupPending: true` in the JWT payload if enforcement applies and no MFA method exists
  yet.

Response (success): `{ ok: true, mspSlug, accessToken, refreshToken, refreshExpiresAt }` (token
issuance is best-effort — a token-issuance failure still returns `{ ok: true, mspSlug }`
without breaking the accept itself, `msp-onboarding.ts:669-674`).

---

## 2. CURRENT / DECIDED

*(section 2 numbering intentionally continues the #1642 pattern's own "wire contract, then
status ledger" structure per module — see account-security-contract-pack.md §2 for the
precedent.)*

| Surface | Status | Note |
|---|---|---|
| `GET /api/msp/signup/tiers` | **CURRENT** | live, returns 4 rows today (see §5 — one is misclassified) |
| `POST /api/msp/signup/start` | **CURRENT** | agreement gate is a real no-op today (§2 above — no published agreement) |
| `GET /api/msp/signup/success` | **CURRENT** | polling-shaped, real three-state response |
| `GET /api/platform/agreement/current` | **CURRENT — genuinely empty (`{agreement: null}`) today** | not a read failure; the DB has zero published versions |
| `GET /api/platform/agreement/acceptance-status` | **CURRENT** | correctly no-ops when nothing is published |
| `POST /api/platform/agreement/accept` | **CURRENT** | idempotent; see §2's duplicate-insert caveat (not independently confirmed, not filed) |
| Admin agreement CRUD (`/api/admin/platform-agreements*`) | **CURRENT** | the only path that fills the empty state above |
| `POST /api/msp/settings/invites` (+ GET/DELETE) | **CURRENT** | zero rows exist today — genuinely never used in this environment |
| `GET /api/public/msp-invite/:token` | **CURRENT** | |
| `POST /api/public/msp-invite/:token/accept` | **CURRENT** | real anti-hijack + MFA-enforcement wiring, not stubbed |
| `services.fulfillmentType = "msp_monthly_subscription"` on a genuine add-on row | **REAL BUG — filed as #2509, sibling of this issue's own Feature #1649** | see §5 |

---

## 4. Real enum unions

- **MSP staff role** — `msp_invites.mspRole` / the invite-accept write to `users.mspRole`:
  `"MSPAdmin" | "MSPOperator"` (`msp.ts:602`). This is a strict subset of the platform-wide
  `mspRole` vocabulary (`MSP_ROLES`, `index.ts:85`, which also includes `CustomerUser`,
  `ServiceAccount`, `Free`, `PlatformAdmin`'s legacy equivalents, etc.) — an invite can only
  ever grant one of these two, by construction of the zod schema at both the write side
  (`msp-settings.ts:1619`) and the invite row's own column enum.
- **MSP status** (gates all three invite/onboarding-link surfaces identically) —
  `msps.status`: `"active" | "suspended" | "trial"` (`msp.ts:41`). Only `"suspended"` is ever
  checked against in these routes (403); `"trial"` is treated the same as `"active"` — real,
  not an oversight worth flagging, since nothing here differentiates trial behavior.
- **Service fulfillment type** — `services.fulfillmentType`: `"standard" |
  "msp_monthly_subscription"` (`index.ts:515`) — a **binary** enum, not a general product-type
  taxonomy. `"msp_monthly_subscription"` is meant to mean exactly one thing: "this row is a
  purchasable platform subscription tier," per `productTypeConfig.ts:25`'s
  `platform_subscription_tier` → `msp_monthly_subscription` mapping. See §5 for where that
  invariant is currently broken by live data.
- **Agreement version** — free-text (`platform_agreements.version`, `text`, not an enum) —
  whatever string an admin publishes; `"Test"` is the only value that has ever existed in this
  environment.

---

## 5. Real finding — an add-on row is misclassified as a platform tier

**Filed as #2509**, sibling sub-issue of #1649 (this issue's own Feature-tier parent), labeled
`bug`.

`GET /api/msp/signup/tiers` (`msp-signup.ts:66-69`) selects every `services` row where
`fulfillmentType = "msp_monthly_subscription"` OR `fulfillmentTypeKey =
"msp_monthly_subscription"`. Live query against the local database today returns four rows:

```
 id  |           slug            |               name                | fulfillment_type | fulfillment_type_key | price_cents
-----+---------------------------+-----------------------------------+-------------------+-----------------------+------------
 131 | launch-control-plus-addon | M365 Launch Control — Plus Add-On | msp_monthly_subscription |                | 19900
 120 | msp-platform-free         | Free                               | manual            | msp_monthly_subscription | 0
 122 | msp-platform-pro          | Pro                                | manual            | msp_monthly_subscription | 29900
 121 | msp-platform-growth       | Growth                             | manual            | msp_monthly_subscription | 12900
```

Row `131` is **not** a platform tier. Its own `type_attributes`
(`{"addOnType": "launch_control_capability", "grantsCapabilityKey": "launch_control_plus",
"requiresMinPlatformTier": "growth", "whiteLabel": {...}}`) show it is an add-on capability
that requires an MSP already be on the Growth tier or above — it has no `tier` value, no
`tagline`, and `sortOrder = 0` (tied with everything else, since it was never meant to sort
alongside real tiers). Unlike the three genuine tiers, which reach
`fulfillmentType = "msp_monthly_subscription"` only through the seed-portal backfill path that
sets `fulfillmentTypeKey` and leaves the legacy `fulfillmentType` column as `"manual"`
(`seed-portal.ts:374-375`, `413-414`, `453-454`), row 131 has `fulfillmentType` itself
literally set to `"msp_monthly_subscription"` — hitting the *primary* condition in the query,
not the OR safety-net arm.

**Real, live consequence:** a brand-new MSP going through self-service signup — someone with
no platform tier yet — sees this $199/mo add-on presented as a fourth, equal-looking option
alongside Free/Growth/Pro on `GET /api/msp/signup/tiers`. If they select it, `POST
/api/msp/signup/start`'s own validation (`msp-signup.ts:215-222`) accepts it, since it checks
only `fulfillmentType`/`fulfillmentTypeKey`, and creates a real $199/mo recurring Stripe
subscription for a capability that presupposes a Growth-tier platform subscription that does
not exist yet.

Not filed as `security` (no privilege boundary crossed, no data exposure — this is a
catalog-data/business-logic integrity gap, not an auth gap). Not prefixed `URGENT:` (self-service
MSP signup is not live-launched yet per #1649's own scope).

---

## 6. Cross-surface edges

- **MFA enforcement** — both the invite-accept path (`msp-onboarding.ts:626-644`) and the
  password-based signup/setup-password path (referenced by the same comment,
  `msp-onboarding.ts:627-632`, "same as auth.ts's setup-password") independently call
  `getActiveMfaMethods()` / `mfaEnforcementActive()` (`mfa.ts` / `auth.ts`) to decide whether a
  freshly-provisioned account gets `mfaSetupPending: true`. Real, shared logic — not
  duplicated by copy-paste drift, genuinely imported from the same two functions in both
  places.
- **Customer-onboarding link vs. staff invite — two distinct, non-overlapping flows in the
  same file.** `msp-onboarding.ts`'s `generate-link` / `GET /public/onboarding/link/:token` /
  `checkout/gate` pair is for a **customer** being pointed at a specific MSP + service by an
  MSPOperator (`mspOnboardingLinksTable`), while `msp-invite` is for **MSP staff** joining an
  existing MSP's own team (`mspInvitesTable`). #2442 named only the invite pair; documented
  here so Design doesn't conflate the two when this pack reaches them.
- **Billing webhook is the real MSP-provisioning point**, not `msp/signup/start` — see §1's
  note. Any Design work assuming the MSP row exists immediately after `start` returns a
  `checkoutUrl` is wrong; `success`'s three-state response is the only honest signal.
- **`sendEmailForMsp`** (invite email) — Exchange Online / Microsoft Graph transport, per this
  repo's standing rule that Resend is never used for any outgoing platform email. Confirmed by
  the import site in `msp-settings.ts`; not independently re-verified against `sendEmailForMsp`'s
  own implementation in this session (out of scope for #2442's five named endpoints).

---

## 7. Orphaned-endpoint check

All five endpoints named in #2442 are live, mounted, and reachable — none are orphaned:

| Endpoint | Mount confirmed | Consumer |
|---|---|---|
| `GET /api/msp/signup/tiers` | `routes/index.ts:443` | none in current `msp-portal` frontend (portal-v2 retired); real consumer TBD by Design per #1649 |
| `POST /api/msp/signup/start` | `routes/index.ts:443` | same |
| `POST /api/platform/agreement/accept` | `routes/index.ts:429` | same |
| `GET /api/platform/agreement/current` | `routes/index.ts:429` | same |
| `GET /api/public/msp-invite/:token` | `routes/index.ts:441` | same |

**No frontend caller currently exists for any of the five** — a genuine, confirmed absence
(`grep` across `artifacts/msp-portal/src` for all five path fragments returned zero hits),
consistent with portal-v2's retirement and #1649 being the feature that will (re)build the UI
against this pack. This is expected at this phase of the build order (§2.1: architect → build
endpoints → **contract pack** → Design → wire) — not itself a finding.

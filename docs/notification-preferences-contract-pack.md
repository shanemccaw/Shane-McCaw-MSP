# Notification Preferences — contract extraction pack for Claude Design (#2552)

Method: #1577's contract extraction pack, applied per the #1642 pattern — audit the
real backend and the archived page against it before Design, extracted not authored.
Standing rules inherited from #1485/#1577: every field cited to file:line; fields
marked `CURRENT` (serves real data today) or `DECIDED` (architecture settled, not
built, with an issue number) — anything else is an **open architecture question**, not
a decision, and is labelled as such; real enum unions only; honest-empty contract;
forbidden list; no `drizzle-kit push`.

**Scope, per #2552's own default:** this pack covers the Notification Preferences
surface only — `GET`/`PATCH /api/portal/notification-preferences`. Webhooks
(`portal/webhooks`) already has its own contract pack, `docs/webhooks-contract-pack.md`
(#1597), and is referenced here, not re-extracted. This matches the archived page's
own structure (`customer-notifications.tsx` composed two independent cards,
`CategoryPreferencesCard` and `WebhookCard`, over two unrelated endpoints) and is a
**reversible default, not a final call** — Shane may still decide the two belong on
one surface; flagged, not blocking.

## 1. Files extracted

| File | What it holds |
|---|---|
| `artifacts/api-server/src/routes/notification-preferences.ts` | The only route file for this surface. Two endpoints, `GET`/`PATCH /api/portal/notification-preferences`. Registered at `artifacts/api-server/src/routes/index.ts:409` (`router.use(notificationPreferencesRouter)`, imported line 103). |
| `lib/db/src/schema/index.ts:826-839` | `customerNotificationPreferencesTable` (`customer_notification_preferences`) — the real Drizzle schema, one row per `(userId, category)`. |
| `artifacts/api-server/src/routes/notifications.ts:12-28` | `CATEGORY_STYLES` — the 15-key object whose `Object.keys()` is the route's own `KNOWN_CATEGORIES` (`notification-preferences.ts:26`), i.e. the real, only category vocabulary this surface serves. |
| `artifacts/api-server/src/lib/notification-center.ts` | The real **consumer** of this table — `getCustomerPreference` (lines 22-39) is what actually gates delivery on the values this route reads/writes. Not part of this route file, but load-bearing: without it, the preferences table would be inert. |
| `lib/db/src/schema/msp.ts:8404-8436` | Adjacent comment block, written under #1276/#1278, stating the deliberate decision that `customer_notification_preferences` and the newer `customer_alert_preferences` table are **two genuinely non-overlapping taxonomies** — see §8. |
| `portal-archive-2026-08-29:artifacts/msp-portal/src/pages/customer-notifications.tsx` | The archived, previously-working consumer page. `CategoryPreferencesCard` (lines 84-206) is the real, cross-checked evidence of this route's request/response shape and its edge cases; `WebhookCard` (lines 208-311) is the archived webhook consumer, out of scope here (see above). |

**No named `interface Wire*` exists in `notification-preferences.ts`.** Both
responses are inline object literals built at the call site (`{ preferences }` at
line 55, `{ ok: true }` at line 97) — Section 2 extracts them directly from the
route body, the same convention `webhooks-contract-pack.md` uses for `webhooks.ts`.

## 2. Wire contract, per endpoint

Both endpoints sit behind `requireAuth` only (`notification-preferences.ts:32,69`) —
**no role check, and no `resolveOwner()`/tenant-scoping call of any kind.**
`req.user!.id` (the authenticated user's own row id) is the only scope key used, on
both read and write. See §7 for what this means in practice.

### `GET /api/portal/notification-preferences` — `notification-preferences.ts:32-56`

Response: `{ preferences: Preference[] }`, built at lines 46-53:

| Field | Type | Nullability | Status |
|---|---|---|---|
| `category` | `string` — one of the 15 `KNOWN_CATEGORIES` keys (§3) | not null | CURRENT |
| `inAppEnabled` | `boolean` | not null, default `true` if no row exists | CURRENT |
| `emailEnabled` | `boolean` | not null, default `false` if no row exists | CURRENT |

**Always returns exactly 15 rows, one per known category, regardless of what is
actually stored** (lines 46-53: `KNOWN_CATEGORIES.map(...)`, not a pass-through of the
query result). A user with zero stored rows still gets 15 rows back, each defaulted
`{ inAppEnabled: true, emailEnabled: false }` — this route has **no "empty" response
shape**; §6 below is about the stored table being empty, not the response.
`byCategory` (line 44) is a `Map` built from the DB query (lines 35-42, no `WHERE`
category filter — every stored row for the user, regardless of whether its category
still exists in `KNOWN_CATEGORIES`) and is only consulted for categories that are
still known — see §4 for what happens to a stored row whose category has since
dropped out of `KNOWN_CATEGORIES`.

### `PATCH /api/portal/notification-preferences` — `notification-preferences.ts:61-98`

Request body (`patchSchema`, lines 61-67):

| Field | Type | Validation |
|---|---|---|
| `preferences` | `{ category: string, inAppEnabled: boolean, emailEnabled: boolean }[]` | 1–50 entries, required |
| `preferences[].category` | `string` | `.min(1)` only — **not validated against `KNOWN_CATEGORIES`**, see §4 |
| `preferences[].inAppEnabled` | `boolean` | required |
| `preferences[].emailEnabled` | `boolean` | required |

`400 { error: "Validation failed", details: <zod .flatten()> }` on schema failure
(lines 73-76). On success: one `INSERT ... ON CONFLICT (userId, category) DO UPDATE`
per array entry (lines 78-95, sequential `await` in a loop — **not a single batched
statement, not wrapped in an explicit transaction**; a request patching 50 categories
issues 50 separate round-trips and a failure partway through leaves the earlier ones
committed). Response `200 { ok: true }` (line 97) — **the route never re-selects and
returns the saved rows**; a client that wants confirmation of the persisted values has
to issue a follow-up `GET`. The archived page does exactly this implicitly: it applies
the patch optimistically to local state (`updateLocal`, lines 99-102) and never
re-fetches after a successful save.

There is no `DELETE` — a category can be reset to its default only by explicitly
`PATCH`ing it back to `{ inAppEnabled: true, emailEnabled: false }`; there is no way
to remove a stored row and fall back to the *default resolution path* itself (harmless
in practice, since an explicit row set to the default values is behaviorally
identical to no row at all).

## 3. Real enum union — the category vocabulary

`KNOWN_CATEGORIES = Object.keys(CATEGORY_STYLES)` (`notification-preferences.ts:26`,
`CATEGORY_STYLES` at `notifications.ts:12-28`) — **15 values, and this is the entire
real category vocabulary for this table**, not an invented list:

`fulfillment`, `payment`, `security`, `ai`, `sow`, `signal`, `message`, `system`,
`lead`, `dunning`, `consent`, `automation`, `project`, `onboarding`, `offer`.

This exactly matches the archived page's own `CATEGORY_INFO` map
(`customer-notifications.tsx:47-63`) key-for-key — the archived page's human-readable
`label`/`description` text for each category is real, hand-written product copy with
no other source in the backend (the route serves no label/description field at all,
only the bare `category` key) and should be **carried forward verbatim** per
CLAUDE.md's "copy is final" rule, not regenerated.

`CATEGORY_STYLES` itself also carries `icon`/`color` per category
(`notifications.ts:13-27`) — **not served by this route at all.** That admin-facing
bell UI reads `CATEGORY_STYLES` directly from the same route file
(`notifications.ts:402`, `GET /notifications/category-styles`); the customer
preferences route only ever reads its *keys*.

## 4. A real gap: `PATCH` accepts any category string, unvalidated

`patchSchema.preferences[].category` is `z.string().min(1)` with no `.refine`/`.enum`
against `KNOWN_CATEGORIES` (`notification-preferences.ts:63`). A client can `PATCH` a
category that is not one of the 15 known ones — the row is genuinely written to
`customer_notification_preferences` (the `INSERT ... ON CONFLICT` has no category
constraint beyond the DB's own `text` column type), but:

- `GET` will never surface it back — the response is always the fixed
  `KNOWN_CATEGORIES.map(...)` list (§2), so a stray row is invisible to any client
  that only reads through this route.
- `getCustomerPreference` (`notification-center.ts:22-39`) looks up the row by
  `(userId, category)` directly against the table, **not filtered through
  `KNOWN_CATEGORIES`** — so if `createNotification` is ever called with a `category`
  string that isn't one of the 15 (nothing in `notification-center.ts` restricts what
  string a caller passes as `category`), a stray preference row *would* actually gate
  it. This is real, live behavior, not a hypothetical — just not reachable from the
  documented UI today since the archived page only ever sent back categories it first
  received from `GET`.

No issue number exists for this; it's an open gap, not `DECIDED`. Not filed as its own
finding — it's a real but low-severity validation gap on a single-tenant-scoped write
(a user can only write rows keyed to their own `userId`), not a cross-tenant or
security-relevant issue.

## 5. The route's own scope statement, and how it holds up against the real consumer

`notification-preferences.ts:1-15`'s header comment states two claims. Both verified
directly against `notification-center.ts`:

1. *"Deliberately does NOT touch `policy_rules` severity/cooldown/escalation — those
   stay MSP-configured. This only gates delivery of already-fired notifications."*
   **True.** `getCustomerPreference` is called from `createNotification`
   (`notification-center.ts:159`) — after severity/category/routing have already been
   decided elsewhere — not from anything that decides whether a notification fires in
   the first place.
2. *"Webhook delivery... is handled by the existing generic `/api/portal/webhooks`
   endpoints... a customer webhook subscribed to `notification.*` events receives the
   same fan-out this page's category toggles gate."* **True, and stronger than the
   comment states:** `fanOutToCustomerWebhook` (`notification-center.ts:102-128`) is
   only ever reached from inside `createNotification`'s `customer_user` branch
   (line 215), which itself only runs **after** the `inAppEnabled` check has already
   passed (lines 160-163: `if (!customerPref.inAppEnabled) { ...; return null; }`,
   before the notification row — or any webhook dispatch — is created at all).
   **A customer's webhook subscribed to `notification.<category>` never fires for a
   category that customer has turned `inAppEnabled` off for.** This is a real,
   verified cross-surface edge between this table and the Webhooks module (§8) that
   neither pack's own file states explicitly.

## 6. Real gating behavior — what turning a toggle off actually does

Read directly from `createNotification` (`notification-center.ts:134-216`), not
inferred from the schema:

- **`inAppEnabled: false` suppresses the notification entirely, not just its
  visibility in the bell.** `getCustomerPreference` is checked before the
  `notifications` row is inserted (lines 159-163); if `inAppEnabled` is false the
  function returns `null` immediately — no row, no SSE broadcast, no unread-count
  update, no email, no webhook fan-out. The archived page's own copy — *"These
  settings control delivery, not detection... Turning a category off stops it from
  reaching you"* (`customer-notifications.tsx:330-337`) — is accurate and should be
  carried forward.
- **`emailEnabled` only gates the email side-channel**, and only applies once
  `inAppEnabled` has already passed (line 212: `if (customerPref.emailEnabled) { void
  deliverPreferenceEmail(...) }`, inside the same `if (userId !== undefined)` block
  that already required `inAppEnabled` truthy to be reached at all). This confirms the
  archived UI's own constraint (`updateLocal`, `customer-notifications.tsx:99-102`:
  turning `inAppEnabled` off in the UI forces `emailEnabled` to `false` in the same
  local state update, and the email `Switch` is `disabled={!pref.inAppEnabled}`,
  line 174) — the UI enforces client-side what the backend also independently
  enforces: email can never be on while in-app is off.
- **Email delivery goes through Exchange Online/Microsoft Graph**
  (`deliverPreferenceEmail`, `notification-center.ts:77-92`, calling `sendMessage`
  from `graphEmail.ts`) — never Resend, consistent with CLAUDE.md's standing rule.
  It's best-effort: any failure (missing `GRAPH_MAIL_USER_ID` env var, missing user
  email, a thrown error from Graph) is caught and logged, never surfaced to the
  caller or the end user (lines 90-92) — a customer who enables email and never
  receives it has no in-product signal that delivery is failing.

## 7. A real gap: no role/tenant scoping on the route itself

Unlike Webhooks' `resolveOwner()` (`webhooks.ts:71-97`, scoping every call to the
caller's own `mspId`/`customerId`), this route applies **no scoping beyond
`requireAuth`** — any authenticated user of any role (`CustomerUser`, `MSPAdmin`,
`MSPOperator`, `PlatformAdmin`) can `GET`/`PATCH` their own `req.user!.id` row here,
despite the route's own header comment describing it as "Lets a CustomerUser control…"
(`notification-preferences.ts:4`). In practice this is low-impact: `customer_user`
is the only `recipient.type` `createNotification` ever reads `customer_notification_
preferences` for (`notification-center.ts:156-163`) — an `MSPAdmin` or `PlatformAdmin`
writing rows here has no effect on their own notification delivery, since the
`msp_user`/`platform_admin` recipient branches never consult this table (lines
154-155, 164-167). Stated as an observed fact for Design/Shane to see, not filed as
its own bug — it's dead-but-harmless, not a security or data issue, and the archived
page was itself only ever reachable by a `CustomerUser` login.

## 8. Cross-surface edges

- **Webhooks (#1597, `docs/webhooks-contract-pack.md`) — real, verified edge.** See
  §5: a customer webhook subscribed to `notification.<category>` never fires for a
  category the same customer has `inAppEnabled: false` for, because
  `fanOutToCustomerWebhook` is only reached after that check passes. Neither pack
  previously stated this dependency explicitly.
- **Notification Categories admin bell (`notifications.ts`) — shared vocabulary
  source, no live coupling.** `CATEGORY_STYLES` (`notifications.ts:12-28`) is the
  single source `KNOWN_CATEGORIES` derives from; the admin-facing
  `GET /notifications/category-styles` (`notifications.ts:402`) and this route's `GET`
  read the same object from two different angles (icon/color vs. per-user
  toggle-state) but neither calls the other.
- **Customer Portal Alert Preferences (`customer_alert_preferences`, #1276/#1278) —
  deliberately separate, per an existing written decision.** The schema comment at
  `lib/db/src/schema/msp.ts:8404-8411` states this explicitly: *"Confirmed decision
  (a) from the original #1236 finding: a NEW taxonomy, not folded into the existing
  15-technical-category `customer_notification_preferences`... that table stays
  exactly as-is for the Notification Center bell — genuinely non-overlapping."* This
  is a `DECIDED` boundary, not an open question — the two tables intentionally serve
  different concerns (this one: bell/email/webhook delivery of already-fired
  technical notifications; that one: `customer_tenant_alert_rules`-driven monitoring
  alert thresholds/digest cadence per #1278) and neither reads the other.

## 9. Honest-empty contract

Live-queried against the local Postgres instance, 2026-09-03
(`SELECT count(*) FROM customer_notification_preferences`): **0 rows — genuinely
empty, real current state, not a query error.**

Because `GET` always returns all 15 `KNOWN_CATEGORIES` regardless of what's stored
(§2), the empty-table case and the fully-configured case look identical in shape —
`{ preferences: [15 rows] }` either way, every row defaulted
`{ inAppEnabled: true, emailEnabled: false }` when unstored. **There is no
loading-vs-empty-vs-error distinction the backend can express** — that distinction is
entirely a client-side concern (the archived page's own `loading` state,
`customer-notifications.tsx:88`, gates a spinner before the first successful fetch;
after that, any thrown error or non-2xx just shows an `AlertBox` error message,
`customer-notifications.tsx:96-97`, with `preferences` left at whatever it last held —
normally still the initial empty array pre-fetch, so an errored first load renders
zero rows and an error banner, not a defaulted 15-row list).

## 10. Forbidden list

`notification-preferences.ts` carries no `"What this route deliberately does NOT
serve"` header block (same absence noted for `webhooks.ts` in
`docs/webhooks-contract-pack.md` §7). Stated plainly from what's actually in scope:

- No `label`/`description`/`icon`/`color` per category — only the bare `category`
  key, `inAppEnabled`, `emailEnabled`. Any human-readable copy or iconography is a
  frontend concern the archived page's own `CATEGORY_INFO` (§3) supplied entirely
  client-side.
- No confirmation of the values actually persisted — `PATCH` returns only
  `{ ok: true }` (§2); a caller wanting to display saved state must re-`GET`.
- No delivery-history/audit trail of what was actually sent or suppressed by a given
  preference — `notificationsTable` rows for a `customer_user` recipient that was
  suppressed (`inAppEnabled: false`) are never inserted at all (§6), so there is no
  record anywhere that a suppression happened, only the absence of a row that would
  otherwise have appeared.
- No push-channel toggle — the schema comment on
  `customer_alert_preferences`/`CUSTOMER_ALERT_DIGEST_MODES` (a sibling, unrelated
  table, §8) has `immediate`/`daily`/`weekly` digest modes; this table has no
  equivalent cadence concept — every enabled category delivers immediately, always.

## 11. Summary — CURRENT vs. open

| Item | Status | Where |
|---|---|---|
| `GET`/`PATCH /api/portal/notification-preferences`, all fields | `CURRENT` | §2 |
| 15-category vocabulary, exact match to archived page copy | `CURRENT` | §3 |
| `PATCH` category string unvalidated against known list | open gap, no issue filed | §4 |
| Route has no role/tenant scoping beyond `requireAuth` (harmless today) | open observation, no issue filed | §7 |
| Webhook fan-out is gated by `inAppEnabled`, not independently documented before this pack | `CURRENT`, cross-surface edge | §5, §8 |
| Alert Preferences (`customer_alert_preferences`) is a deliberately separate taxonomy | `DECIDED` (#1236/#1278) | §8 |
| No confirmation payload on `PATCH`, no persisted-value re-select | `CURRENT` (by design, not a bug) | §2 |
| Email delivery failures are silent (best-effort, logged only) | `CURRENT` | §6 |

## 12. Verification ledger

- Live Postgres query run directly against the local dev instance (`DATABASE_URL`
  from `.env.local`), 2026-09-03: `customer_notification_preferences`: 0 rows.
- Every file:line citation above was read directly from
  `artifacts/api-server/src/routes/notification-preferences.ts`,
  `artifacts/api-server/src/routes/notifications.ts`,
  `artifacts/api-server/src/lib/notification-center.ts`,
  `lib/db/src/schema/index.ts`, and `lib/db/src/schema/msp.ts` in this worktree, plus
  the archived `customer-notifications.tsx` at tag `portal-archive-2026-08-29` — no
  product code was changed.
- The §4/§5/§6 gating-behavior claims trace to a direct read of
  `createNotification`'s actual control flow (`notification-center.ts:134-216`), not
  an inference from the schema or the archived page's own comments — the archived
  page's claims were independently cross-checked against the real consumer, not taken
  at face value.
- Nothing in this pack was inferred from a TypeScript type and presented as
  runtime-observed; the one live-data claim (§9, the empty table) traces to the
  Postgres query above.

# Shane's Life

The real hosted app for [Epic #3086](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3086).
This directory is the **App Foundation** ([#3087](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3087)):
hosting, database, auth, the universal capture box, no-login share links, and the MCP write
plane. Shopping ([#3088](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3088)) is the
first content Feature built on top of it, not beside it — see its own section below.

**Read the design first:** `Design/design_handoff_shanes_life/` in this directory — `README.md`
is the handoff (screens, data model additions, auth), `contract.md` is the v2 design contract, and
the `.dc.html` files are the real per-screen references. (`contract.md` is the same document as
`docs/shanes-life-design-contract-pack.md` (in this directory — see #3097), copied in beside the screens.)
Every decision below traces to a section of it, and the section is cited in the code.

---

## What actually exists

| Contract-pack requirement | Where it lives |
|---|---|
| Passkey-only sign-in, no password screen (§9) | `src/auth/webauthn.mjs`, `src/core/credentials.mjs`, `POST /api/auth/passkey/*` |
| Universal capture box, text/voice/photo (§3) | `public/index.html` (the fixed bottom bar), `src/core/captures.mjs`, `src/core/media.mjs` |
| Genuinely open classification, no fixed enum (§3) | `src/core/categories.mjs`, `entities.category` + `entities.data jsonb` |
| Shareable links with no login (§9) | `src/core/shares.mjs`, `src/routes/public.mjs`, `public/share.html` |
| MCP write plane reachable from any Claude conversation (§9, §10) | `src/mcp/`, `src/routes/mcp.mjs` |
| Home Screen web app, not Expo (§10) | `public/manifest.webmanifest`, `public/sw.js`, the four `apple-mobile-web-app-*` meta tags |
| Notification tray leads, not a dashboard (§3, §11) | `GET /api/today` returns at most three things; there are no charts, totals, streaks or percentages anywhere |
| Shopping: one running list, real capture-grammar push, no-login share (§5, §9, Shanes Life 04) | `src/core/lists.mjs`, `GET /api/shopping`, `public/app.js` `#/shopping`, MCP `push_list`/`get_list`/`check_list_item` (#3088) |
| Shopping: per-store price history, real dated observations (Shanes Life 04) | `src/core/prices.mjs`, `GET/POST /api/stores`, `GET/POST /api/prices`, `public/app.js` "Log price"/"History" on each Shopping row, MCP `get_prices` (#3112) |
| Shopping: weekly-ad cross-store verdicts, coupons, multi-buy (§3, §5, Shanes Life 04) | `src/core/prices.mjs` (`pushDeals`/`pushCoupons`/`fetchWeeklyAd`/`attachWeeklyAdVerdicts`), `GET /api/shopping` (`weeklyAdVerdict` per item), MCP `push_deals`/`push_coupons`/`fetch_weekly_ad` (#3110) |
| Recipes: core list, real can-make matching against Shopping, add missing, heart-healthy context (§5, Shanes Life 05) | `src/core/recipes.mjs`, `GET /api/recipes`, `POST /api/recipes/:id/add-missing`, `GET/PATCH /api/health-context`, `public/app.js` `#/recipes`, MCP `push_recipes`/`get_recipes`/`add_missing_ingredients`/`get_health_context`/`set_health_context` (#3124) |
| Food preferences: dislikes (soft avoid) and allergies (hard exclusion) (§5) | `src/core/food-preferences.mjs`, `food_preferences` table (migration 024), MCP `get_food_preferences`/`set_food_preferences` -- additive, no separate settings form (#3132) |
| Recipes: Cook mode -- step-by-step view, next/back, unchecked never blocks, screen stays awake (Shanes Life 05) | `public/app.js` `#/cook/<id>` (`viewCook`, `cookSession`, Wake Lock API), `recipes.mjs`'s `normaliseSteps` now carries real per-step `{text, ings}` (#3125) |
| Recipes: Sunday meal-planning ritual + Today surfacing (§5) | `src/core/meal-plan.mjs`, `meal_plan_entries` table (migration 026), `GET/DELETE /api/meal-plan`, `GET /api/today` (`mealNudges`/`tonight`), `public/app.js` Today "Tonight" card + `#/recipes` "This week's plan", MCP `push_meal_plan`/`get_meal_plan` (#3127) |
| Recipes: Tonight -- multi-dish synchronized cooking, live status/countdowns, start + done alarms, per-dish snooze (Shanes Life 05) | `recipes.cook_minutes` (migration 028), MCP `push_recipes` `cookMinutes`, `public/app.js` `#/tonight` (`mealSession`, `mealDishState`, `renderMealAlarmOverlay`) -- client-only session, deliberately not persisted; takes priority over #3127's own Today "Tonight" card while a live session is running (#3126) |
| People & Patterns: private per-person journal, deliberately dumb word/timing/topic patterns, real search/ask, therapist export (§7, Shanes Life 11) | `src/core/people.mjs`, `people`/`person_entries` tables (migration 035), `GET/POST /api/people`, `GET/POST/DELETE /api/people/:id/...`, `public/app.js` `#/people` + `#/person/:id`, MCP `list_people`/`log_person_note`/`get_person_notes` (#3157) |
| Enhanced alerts: real Web Push sending + act-on-notification (mark done/snooze/dismiss) (§10) | `src/push/webpush.mjs` (hand-rolled RFC 8291/8292, no dependency added), `src/core/push-subscriptions.mjs`, `push_subscriptions` table (migration 036), `POST /api/push/subscribe`\`/unsubscribe\`, `GET /api/push/vapid-public-key`, `POST /api/nudges/:id/action`, `public/sw.js` (`push`/`notificationclick`), `public/app.js` Settings "Notifications" -- real action buttons work on Chrome/Android; Safari/iOS does not honor custom action buttons on either push mechanism (confirmed, not assumed -- see §10), so it degrades to the design's own stated fallback: tap opens the app to the item (#3160) |
| Bankruptcy/debt tracker, ported from Finance-Tracker's dead `BankruptcyItem` sub-feature -- a real overlay on ShanesSurvival's own `debts` table, not a second list (docs/shanes-life-design-contract-pack.md §12) | `debts.debt_type`/`original_balance`/`last_payment_date`/`included_in_bankruptcy` (migration 042), `src/core/money.mjs` `listDebts`/`createDebt`/`updateDebt`/`deleteDebt`, `GET/POST /api/money/debts`, `PATCH/DELETE /api/money/debts/:id`, `public/app.js` Money "Bankruptcy" tab, MCP `list_debts`/`set_debt`/`delete_debt` (#3163) |
| Accounts "Debts · critical first" overlay -- real payoff-progress sparkline per critical debt plus a real "paid down since" summary (Shanes Life 17 - Money v3, option 1d) | `debt_balance_history` table, one real snapshot per debt per real day (migration 048), `src/core/money.mjs` `recordDebtBalanceSnapshot` (wired into `createDebt`/`updateDebt`)/`getCriticalDebtOverlay`, `GET /api/money/debts/critical-overlay`, `public/app.js` Money "Accounts" tab `appendCriticalDebtOverlayCard`/`debtPayoffSparklineHtml` (#3210) |
| Money -> Vault: real browser extension autofill, phase 2 of the LastPass replacement -- reuses the vault's existing session + per-entry fresh-WebAuthn reveal unchanged, no new backend auth | `extension/` (Chrome MV3: `background.js`, `content-script.js`, `bridge.js`, `options.html`/`popup.html`, `lib/site-match.mjs` + its own real node test), `public/app.js` `extensionReveal`/`completeExtensionReveal` bridge -- see `extension/README.md` for the full design and the three open questions it answers (#3243) |

---

## Running it locally

Requires Node 20+ and a reachable Postgres 13+.

```bash
cd web/shanes-life
cp .env.example .env          # then set DATABASE_URL to the SAME database the WPF app uses
npm install                   # one dependency: pg
npm run create-user -- --email you@example.com --name "Your Name"
npm start                     # http://localhost:5000
```

`create-user` prints a single-use enrolment link. Open it once in a browser, approve with Face ID
/ Windows Hello / a security key, and that device holds the passkey. There is no password to
choose. Later devices get their own link from `npm run enroll-passkey -- --email you@example.com`.

Migrations apply themselves on boot, so there is no separate setup step. `npm run migrate` runs
them without starting the server. If `DATABASE_URL` is not the shared ShanesSurvival database,
both refuse to run and say which database they actually found.

Verify the whole thing end to end against the real database, with the server running:

```bash
npm run check
```

That enrols a passkey and signs in with a real WebAuthn assertion, captures something, has MCP
classify it into a category nothing in this codebase has ever heard of, mints a share link, ticks
an item off through that link with no credential at all, and confirms the tick is visible to the
owner. It also asserts the refusals — a replayed challenge, a tampered signature, a spent
enrolment token — and, because it now runs against Shane's real financial database, re-counts
every ShanesSurvival table at the end to prove not one row moved. It creates and then deletes its
own disposable account, so it leaves no residue.

## Connecting Claude

```bash
npm run issue-mcp-token -- --email you@example.com --label "Claude Code"
```

The token is shown once. Then:

```bash
claude mcp add --transport http shanes-life https://<host>/mcp \
  --header "Authorization: Bearer slmcp_..."
```

Tokens can also be minted and revoked in the app under **Settings**, where every call each token
has made is listed alongside it.

---

## Real decisions, and why

### One database, shared with ShanesSurvival — migrations 013 and up

**Corrected in [#3107](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3107). The original
#3087 build created a separate `shanes_life` database, and that was wrong.** The design says so
in its own first line — "the cloud-hosted half of ShanesSurvival … one app, one login, one
Postgres" — and the handoff's *Data model additions* section is explicitly headed "extending
ShanesSurvival migrations 001–012". A second database made the Money screens, which read the same
real Plaid-synced accounts the WPF app does, impossible to build without copying rows between two
databases.

So: **`DATABASE_URL` points at the same real database the ShanesSurvival WPF app already uses**,
and this app's migrations start at **013**, on top of ShanesSurvival's real 001–012.

The two migration runners — `src/migrate.mjs` here, `MigrationRunner.cs` there — share one real
`schema_migrations(filename, applied_at)` ledger and each only ever executes files from its own
directory, so neither can run the other's. The number space, though, is genuinely shared: **check
both `desktop/ShanesSurvival/migrations/` and `web/shanes-life/migrations/` before naming a new
migration file.** That's no longer just a comment (Git #3118) — `scripts/check-migration-numbers.mjs`
enforces it for real. Both runners call `assertNoDuplicateMigrationNumbers()` before applying
anything, and refuse to run if the same leading number was used in both directories.

**A ledger row you don't have a file for is not always a problem (Git #3175).** That one
`schema_migrations` table is shared by every concurrent build on this machine, but each build
runs in its own git worktree off `origin/main` — so for the whole window between "a sibling
build applied its migration" and "that sibling's commit reached `origin/main` and I merged it",
your ledger is legitimately *ahead* of your own `migrations/` directory. `src/migrate.mjs` now
tells the two apart:

- **Ahead** — the row's number is higher than anything you have on disk. Nothing here can re-run
  under it, because this checkout has no file at that number at all. Logged as a one-line notice;
  the migration runs, the server boots, `npm run check` runs.
- **Missing** — the row's number *is* occupied on disk under a different name. That is the real
  #3140 hazard (an applied migration renamed, so its identical SQL re-executes under the new
  name), or a sibling that took your number first and needs you to renumber. Still fails closed,
  loudly, before anything is applied, and the message names which of the two it is.

Before #3175 both were fatal, which meant `npm start` — and therefore `npm run check`, the whole
end-to-end suite — was blocked most of the time whenever several builds were live.
`node scripts/check-migration-numbers.selftest.mjs` covers the classification with real files on
disk.

**Reading only those two local directories is not enough to PICK a number, and two concurrent
builds proved it
(Git #3197)** — `044_income_rules.sql` and `044_money_home_tab_decision_tools.sql` both landed on
044 the same night because neither session's worktree had the other's file on disk, and
`origin/main` didn't either until one of them merged. **Run `node bin/next-migration-number.mjs`
before naming a new migration file.** It reads the shared `schema_migrations` ledger — which both
migrations directories combined cannot see, but which every session that has already run its
migration locally (already required, real work, before merging) has already written a row into —
unioned with both on-disk directories, and prints the real next-free number, warning loudly if the
ledger holds a number no local file has yet (a peer's in-flight, not-yet-merged claim). This is
advisory on top of, not a replacement for, `assertNoDuplicateMigrationNumbers()` /
`assertNoOrphanLedgerRows()`, which remain the real enforcement.

`src/migrate.mjs` refuses to run at all if `DATABASE_URL` points somewhere without
ShanesSurvival's own tables, and names the database it actually found. That guard exists
precisely so #3087's mistake cannot repeat silently — a half-applied Shane's Life on a bare
database looks like it worked.

**Finding the real database name:** it is the connection string the WPF app is genuinely
configured with, in `%AppData%\ShanesSurvival\settings.json`. On Shane's machine today that is
**`finances`**, *not* `shanessurvival` — a `shanessurvival` database does exist on that box but is
an empty leftover with only `001_init.sql` ever applied and no `schema_migrations` table at all,
created by following `desktop/ShanesSurvival/README.md`'s example `CREATE DATABASE` line
literally. Read the settings file rather than trusting either name.

Two databases that are still deliberately *not* used, for unchanged reasons:

- **The hosted Neon project is dead.** Its free-plan data-transfer quota was exhausted and its
  compute is suspended — the reason `CLAUDE.md` moved local dev onto a local Postgres 18 install
  in the first place.
- **`shanemccawmsp` (the MSP platform database) is the wrong domain.** It carries customer/tenant
  business data and has migrations applied to it automatically by `scripts/post-merge.sh` on
  every merge. A personal app has no business sharing that blast radius.

Hosting is unchanged and still later work: nothing here provisions a cloud database, and the
Replit deployment is a real, separate, deliberate step (#3107 puts it explicitly out of scope).
When it happens, ShanesSurvival's local Postgres and this app move to the hosted instance
together, because by then they are one schema.

### There is no framework and no build step

Plain ES modules served as-is, and two runtime dependencies: `pg`, and `jpeg-js` (added for
Git #3262's server-side photo downscale below). Three real reasons this stays deliberately thin:

1. **Instant redeploy-and-refresh** is a stated reason the Home Screen web app won over Expo
   (§10). A build step reintroduces the wait it was chosen to avoid.
2. **Bandwidth is a hard constraint on this project** (`CLAUDE.md`, Git #1987). A React + Vite +
   Tailwind toolchain is roughly a thousand packages to install and reinstall; `pg` is eight and
   `jpeg-js` is one, zero transitive deps, pure JS (no native binary to fetch per platform).
3. **`pg` was already resolvable**, so this app was built and verified without a single package
   download.

This is a foundation-scale decision, not a permanent vow: if the UI outgrows it, adding a bundler
later is ordinary work. Nothing here is structured to prevent that.

`jpeg-js` is the one deliberate exception to "hand-roll instead of adding a dependency"
(`bin/make-icons.mjs`'s hand-written PNG encoder, `src/push/webpush.mjs`'s hand-rolled RFC 8291
crypto): a correct JPEG codec is real DCT/Huffman/chroma-subsampling work, and a subtly wrong
hand-rolled decoder risks silently corrupting exactly the photos `get_capture_photo` (#3261)
exists to let Claude actually see. The resize math itself (`src/core/image-resize.mjs`'s
nearest-neighbor downsample) is still hand-written, same as everywhere else in this app --
`jpeg-js` only does the decode/encode.

### Passkeys, not passwords — and no password screen anywhere

**Also corrected in #3107.** #3087 shipped scrypt password auth; the design specifies WebAuthn.
Screen 1 (`Shanes Life 01 - Sign in.dc.html`) draws exactly two controls — *Continue with Face ID*
and *Use a passkey from another device* — with no email field and no password field, and the
handoff's *Auth and sharing* section says "Passkeys (WebAuthn) for the app". There is now no
password column, no `/api/auth/login`, and no password input in the DOM.

The passkeys registered are **discoverable** (`residentKey: "required"`) and **user-verified**
(`userVerification: "required"`). Discoverable is what removes the email field: the authenticator
resolves the account itself, so `POST /api/auth/passkey/options` can issue a challenge with no
`allowCredentials` and leak nothing about which accounts exist.

**Enrolment is out-of-band, on purpose.** The one thing a passkey-only app cannot do with a
passkey is register the first one, so `npm run create-user` and `npm run enroll-passkey` print a
single-use, 30-minute link, and the token rides in the URL **fragment** so it never reaches a
request line or an access log. There is no browser-reachable route that mints one — in a
passkey-only app that would be a password reset with extra steps. An already-signed-in session can
add another device from **Settings**, authorised by the session it already holds. The server
refuses to remove the last passkey on an account: there is nothing to fall back on.

**The server half is hand-written** (`src/auth/webauthn.mjs`, `src/auth/cbor.mjs`), for the same
reason the MCP server is: bandwidth is a real constraint on this project (`CLAUDE.md`, Git #1987),
and this is verification only — nothing here mints key material. Attestation is deliberately *not*
verified and registration asks for `attestation: "none"`; attestation exists so an enterprise can
restrict which authenticator models may enrol, and Shane is the only person who will ever enrol
one. The enrolment token is the real control.

`npm run check` runs the whole flow against a **real software authenticator**
(`bin/soft-authenticator.mjs`) — real P-256 keys, real ECDSA signatures, real CBOR — and asserts
the refusals as well as the successes: a replayed challenge, a tampered signature, a spent
enrolment token, and removing the only passkey are all rejected. What it does not cover, and says
so in its own output, is the browser half.

Sessions are random tokens in an `HttpOnly; SameSite=Lax` cookie, with only the SHA-256 stored.
Not JWTs, specifically because **a JWT cannot be revoked** and "sign out everywhere" is a real
requirement for an app that will hold financial reference data (§3, the bill-payment vault).
`sessions.last_verified_at` records when a session last passed a real assertion, via
`POST /api/auth/reverify`.

The vault's "fresh passkey per reveal" requirement (Git #3150) is deliberately **not** measured
against that stamp. A reveal carries its own assertion, against a challenge issued for that one
entry (`purpose = vault:reveal:<id>`) — so one assertion cannot unlock every entry inside a
window, cannot be replayed to reveal the same entry twice, and cannot be pointed at a different
entry than the one it was earned for. `last_verified_at` moves when a reveal succeeds, but no
reveal has ever been granted by reading it.

Sign-in failures are rate-limited per source, and every outcome — success, bad assertion, unknown
credential, throttled, passkey registered, passkey revoked — is recorded in `auth_events`. The
response is one identical message for every failure mode.

### Categories are a table, not an enum

This is the single most load-bearing schema decision, and it is straight out of §3: Claude must be
able to file "mom's coming to visit the 12th-18th" without a developer shipping a Visits feature
first. `entities.category` references an open registry that grows on first use, and
`entities.data` is unconstrained `jsonb`. **Nothing in this codebase enumerates known categories**,
and nothing added later should. `npm run check` asserts this against a slug generated at runtime
that appears nowhere in the source.

### The app does no AI inference of its own

§10 is a hard architectural line: Shane's subscription does not cover live API costs for a
production app. There is no API key, no model call, and no outbound AI request anywhere in this
server. Classification happens in a Claude conversation and arrives over MCP; this app stores,
displays, shares and checks off. Keep that line clean.

### The MCP server is hand-written

The server half of Streamable HTTP is `initialize`, `tools/list`, `tools/call`, `ping` and a few
empty probes — about 150 lines (`src/mcp/protocol.mjs`), against a full SDK dependency tree. Two
ways in, both authenticating against the same revocable `mcp_tokens` row:

- `POST /mcp` with `Authorization: Bearer slmcp_…` — the correct form.
- `POST /mcp/t/<token>` — the token as a capability URL, for a client with no header field.

### Attachments live in Postgres

Replit's filesystem does not survive a redeploy, and a photo of an after-visit summary (§3) is
exactly the thing that must. `bytea`, with a size ceiling and a MIME allowlist.

---

## Deploying to Replit

**Not yet, deliberately** — #3107 puts every part of this explicitly out of scope until the
shared-database build is verified locally, which is the same local → staging → production
discipline the Marketing site already follows. Nothing below has been done, and no cloud database
has been provisioned. It is written down because the hosting shape is real and settled, not
because it is the next step.

When it is the next step, **creating the deployment is Shane's own action** — it needs his Replit
account, and per `CLAUDE.md` an agent does not perform a hosting deploy.

1. **Create the Repl** from the GitHub repo `shanemccaw/Shane-McCaw-MSP`. `.replit` in this
   directory already points every command at `web/shanes-life`.
2. **Move the real database up, once.** This is the step the separate-database design used to
   hide: Shane's Life and ShanesSurvival are one schema now, so what gets hosted is the whole
   `finances` database — dump it locally, restore it into the Repl's Postgres, and repoint the
   WPF app's `%AppData%\ShanesSurvival\settings.json` at the hosted instance. Replit sets
   `DATABASE_URL` itself.
3. **Set these Secrets:**
   | Secret | Value |
   |---|---|
   | `PUBLIC_ORIGIN` | the deployment's real HTTPS URL, no trailing slash |
   | `PGSSLMODE` | `require` |
   | `NODE_ENV` | `production` |
   | `SL_VAULT_KEY` | 32 random bytes, base64 — see `.env.example` |
   | `SL_VAPID_PUBLIC_KEY` / `SL_VAPID_PRIVATE_KEY` | `node bin/generate-vapid-keys.mjs`, once — see `.env.example` |

   `PUBLIC_ORIGIN` is load-bearing twice over: it is what share links and the MCP endpoint are
   built from, **and** its hostname is the WebAuthn Relying Party ID. A passkey enrolled against
   `localhost` will not work against the deployed hostname — the first thing to do on the real
   host is enrol a passkey there.
4. **Deploy as a Reserved VM**, not Autoscale — the reasoning is in `.replit`, and it matters:
   the sign-in limiter is per-process, and the notification tray this app is built toward needs a
   single long-lived process to schedule from.
5. **Create the real account**, once, in the Repl's shell:
   ```bash
   cd web/shanes-life && npm run create-user -- --email <shane's email> --name "Shane"
   ```
   It prints a single-use enrolment link — open it on the iPhone, approve with Face ID. There is
   no public sign-up route, by design.
6. **Add it to the Home Screen** — Safari → Share → Add to Home Screen. HTTPS, the manifest and
   the service worker are all already in place, which is what iOS requires before it will grant
   web push (§10). Once added, open Settings inside the app and "Turn on notifications" to
   actually subscribe this device — real day-before appointment/vaccine nudges arrive as real OS
   push after that, with mark done/snooze/dismiss where the platform honors action buttons (Git
   #3160; §10 documents the real, confirmed gap on Safari specifically).
7. **Verify the live deployment:**
   ```bash
   SL_CHECK_URL=https://<host> npm run check
   ```

## Shopping (#3088)

The first room built on this foundation, and the first consumer of the typed-tables decision
below. "One run": `GET /api/shopping` finds-or-creates the one real `lists` row (category
`shopping`) per user, rather than the client tracking a list id — matching the design's own
`grocery words -> the run` capture-grammar line. Real CRUD lives in `src/core/lists.mjs`
(`getOrCreateShoppingList`, `addListItems`, `setListItemChecked`, `deleteListItem`,
`clearCheckedItems`, `replaceListItems`), reachable both from the signed-in web UI
(`#/shopping` in `public/app.js`) and from Claude over MCP: `push_list` (the capture-grammar
entry point — add onto the run, or `replace: true` for a fresh one), `get_list`, and
`check_list_item`. The no-login share link reuses #3116's kind-agnostic `share_links` layer,
extended for real add capability + live activity by #3186 (see its own section below). Barcode
scan (#3109), aisle memory + Best-path (#3108), weekly-ad verdicts (#3110) and per-run budget
(#3111) — all real, all drawn in `Shanes Life 04 - Shopping.dc.html` — each landed as their own
separate Feature after this one; barcode scan specifically was NOT extended to the share-link
side by #3186 (a deliberate scope cut, not an oversight — see that issue's completion comment).

## Shopping — Shared list: real add + Best-path + live activity (#3186)

Real, explicit capability expansion beyond #3116's original check-off-only decision — Shane's
own decision comment on #3186, not a guess: "Share links get the full real capability the design
specifies." Design `Shanes Life 12 - Shared list.dc.html`, turn 2 / option 2a is the target.

- **`can_add`** — a second per-share flag alongside `can_check` (migration 047), set at creation
  time from the owner's own "Shared links" card (`public/app.js`'s `shareSection`). Off by
  default, so every share minted before this existed keeps its old check-off-only shape.
- **Real provenance** — `list_items.added_by` / `.checked_by` (migration 047), "owner" for the
  owner's own writes, "share" / "share:\<label\>" for a can_add-enabled link's own writes, mirroring
  `entity_items.checked_by`'s existing convention. Shown back to the owner as "Added by \<label\>"
  on the private Shopping room's own item rows.
- **Flat / Category / Best-path** on the public shape too (`routes/public.mjs`'s `orderForShare`),
  reusing `core/shopping-order.mjs` + `core/store-aisles.mjs` verbatim — not a re-derived copy.
  Flat/Category are a pure function of item text, so any can_check link gets them; Best-path
  additionally needs the list's real current store + its accumulated aisle map, which is real,
  private data about the owner's shopping habits — gated to a can_add-enabled link specifically,
  per Shane's own decision comment, never shown to a plain check-off link even if it asks for it.
- **Live activity** — `GET /api/public/share/:token/activity` polls `audit.recentForEntity`
  (`core/audit.mjs`), a real query scoped to exactly this list's own `entity_id` (defense in
  depth: filtered on the link's real `user_id` too), never a general per-user stream. Both the
  owner's own web actions and a share's actions now write real `list.item.check` /
  `list.item.add` audit rows with the item's own text, so "Shane just checked off Milk" /
  "Ronnie just added Bread" is real narration of real events either side of the link can already
  see on refresh, not a new exposure.
- **Add** — `POST /api/public/share/:token/items`, gated on `can_add` (and list-kind only; no
  real entity-kind share has ever needed this, verified live against `share_links` before
  building it — see the #3186 completion comment).
- **Deliberately not extended to a share link**: barcode scan (#3109). Real, external
  network calls (Open Food Facts) and a materially larger write surface for a real, uncontrolled
  privacy-boundary tradeoff the issue's own verification ask didn't require — a scope cut, not an
  oversight.

## Shopping — per-store price history (#3112)

The design's own line: "Prices are stored per store and per date, and Claude reads them over MCP
(`get_prices`) so the next list carries real numbers instead of estimates." This is the real
historical record, not a single current-price field — `stores` and `item_prices`
(migration 021) hold a real, dated observation per (store, item), and `src/core/prices.mjs` is
the CRUD: `getOrCreateStore`, `recordPrice`, `getPriceHistory`, `attachLatestPrices`.

`item_prices.item_text` is the normalised item name, not a foreign key onto `list_items` — list
rows are deleted every "Done shopping" clear-checked pass (#3088), so history keyed on the row
would evaporate with the run. This is deliberately independent of barcode scan (#3109, separate,
not built here): logging a price is a manual "Log price" action on any Shopping row, not gated
on a scan first landing.

Reachable both ways: the signed-in web UI (`public/app.js` — "Log price" opens an inline
store/price/date form on each Shopping row; "History" reads back every real observation for
that item) and Claude over MCP (`get_prices`, read-only — writing a price is a manual, in-app
action per the design, not an MCP tool). `GET /api/shopping` attaches each item's real latest
price (`lastPrice`) in the same response, one extra query for the whole list rather than one
per item.

"Synced across Shane's own devices" (the design README's "store per phone") needs no sync
mechanism: every observation is one real row in the shared database, reachable from any
signed-in session — there is no per-device local copy to keep in step.

## Shopping — weekly-ad verdicts, coupons, multi-buy (#3110)

Contract Section 5's own line: "an already-working real capability … feeding Claude actual
weekly store ad flyers and had it find where specific real grocery items were cheapest across
stores." This is that capability wired into the app, not a new prices table: a weekly-ad price is
the same real shape #3112 already built (one item, one store, one date, one price) — it lands in
the SAME `item_prices`/`stores` tables with `source = 'weekly_ad'` instead of the default
`'shane'`, plus a new `unit` column (`item_prices` didn't need one for a single scanned/logged
price; a flyer's "$4/lb" does). Coupons and multi-buy counts ("2 for $5") are a genuinely
different shape and get their own real table, `coupons` (migration 023).

Claude pushes both over MCP after reading a real flyer conversationally — `push_deals` (prices)
and `push_coupons` (coupons/multi-buy) — and can check what's already on file first with the
existing `get_prices` (#3112) or the new `fetch_weekly_ad` (one store's whole current ad). The app
still does no AI inference of its own (§10): nothing here fetches a live ad or calls a model: it
only stores and matches what Claude already extracted.

`GET /api/shopping` decorates each item with a real `weeklyAdVerdict` (`src/core/prices.mjs`'s
`attachWeeklyAdVerdicts`) — the cheapest currently-known weekly-ad price across every store, plus
the best matching coupon, or `null` when nothing matches yet. This is a different question from
`lastPrice` (#3112, "what did this cost last time, anywhere, any source") — `weeklyAdVerdict`
answers "what does the CURRENT weekly ad say, and where's it cheapest right now" — so both fields
exist side by side. Matching is case-insensitive substring, both ways ("milk" matches "whole
milk"), since one side is Claude's flyer-extracted text and the other is Shane's own
capture-grammar wording. A weekly-ad price older than 10 days stops counting toward a verdict —
"weekly" means this week's, not a forgotten push from a month ago. `public/app.js` renders it as a
real badge ("Kroger $2.49/loaf · 2 for $2.49") on the matching Shopping row, next to (not
replacing) the `lastPrice` hint.

## Recipes — core list + ingredient matching (#3124)

Section 5's real superseding update, applied: "Recipes are real, wanted full-screen modes ...
populated by Claude-generated content pushed in via MCP, not built as an in-app database/form
system." `src/core/recipes.mjs` is the real CRUD + matching (`createRecipe`, `pushRecipes`,
`archiveRecipe`, `listRecipesWithMatch`, `addMissingIngredients`), a `recipes` table (migration
024) holding `name`/`time_text`/`needs` (the real ingredient list)/`steps`/`heart_healthy`, and a
`users.health_context` column for Section 5's real, stated-once heart-healthy context.

`GET /api/recipes` (`#/recipes` in `public/app.js`) matches each real recipe's `needs` against
what's currently on the one real Shopping list (`getOrCreateShoppingList` + `getListDetail`, the
same real run #3088 built) using the same case-insensitive, both-ways substring match #3110's
weekly-ad verdicts use — a recipe with everything already on the run shows `canMake: true`; one
missing something lists the real gap. "Add missing" (`POST /api/recipes/:id/add-missing`)
recomputes the gap at call time and pushes it straight onto the run via `lists.addListItems` —
the same write path `push_list`/the Shopping screen already use.

Reachable both ways: the signed-in web UI, and Claude over MCP — `get_recipes` (real list +
match), `push_recipes` (the real generation entry point; `replace: true` swaps out every
previously saved recipe for a fresh set), `add_missing_ingredients`, and `get_health_context`/
`set_health_context` for Section 5's real heart-healthy context, read before generation rather
than re-asked every time (Section 8: "state once, respected everywhere, forever"). The app still
does no AI inference of its own (Section 10) — `heart_healthy` on a pushed recipe is Claude's own
real judgement at push time, not something this server computes.

Explicitly not built here, per the issue's own scope: Cook mode (step-by-step, ingredient
checkboxes, the in-step timer), Tonight (multi-dish timing), and the Sunday meal-planning ritual
— each a separate, real sibling Feature under #3086.

## Recipes — Cook mode (#3125)

Real step-by-step cooking view for a single recipe, `#/cook/<recipeId>` in `public/app.js`,
reachable from a "Cook" button on any recipe with real steps saved. `recipes.mjs`'s
`normaliseSteps` now carries each step's real intended shape — `{text, ings}` (the design's own
seed data shape, contract pack prototype's `RECIPES`), not the bare string #3124 stored, since
nothing read the `ings` half until Cook mode needed real per-step ingredients to check off. A
plain string step (anything pushed before this) still normalises fine, with an empty `ings`.

Next/back step navigation and per-ingredient checks are real client-side state
(`public/app.js`'s `cookSession` — `{recipeId, stepIndex, checks}`), deliberately not persisted
server-side or to `localStorage`: same "one real cooking session in front of Shane right now"
model as the design's own `this.setState({cook: {...}})`, reset on leaving cook mode or a reload.
Per the issue's own locked line, copied verbatim into the UI's own footer text: **"Screen stays
awake in cook mode. Unchecked ingredients never block Next."** An unchecked ingredient is only
ever a display state, never a gate on the Next button.

"Screen stays awake" is the real Wake Lock API (`navigator.wakeLock.request("screen")`),
requested on entering cook mode and released the moment navigation leaves it (or on
`visibilitychange` regaining visibility while still in cook mode, since the browser auto-releases
a wake lock the instant a tab isn't visible). Feature-detected — a browser without Wake Lock
support just doesn't get the lock; cook mode itself still works.

Explicitly not built here, per the issue's own scope: the in-step timer, Tonight (multi-dish
timing), and the Sunday meal-planning ritual — each a separate, real sibling Feature under #3086.

## People & Patterns (#3157)

Section 7's own real, explicit boundary, stated directly and worth repeating here: **NOT a
companion or chatbot persona.** A private journal capturing Shane's own words about people in his
life, threaded under the right person through the same one-box capture used everywhere else —
`people` (find-or-create by `lower(name)`, same upsert pattern `things.recordThing` and
`contacts` already use) and `person_entries` (migration 035), both typed tables per #3116's own
recorded decision, not the generic `entities`/`entity_items` pair.

**"Threaded automatically based on who's mentioned" is a Claude-conversation step, not something
this app infers itself** (Section 10): Claude reads a pending capture (`list_captures`),
recognises who it's genuinely about, and calls the real `log_person_note` MCP tool with that
person's name — creating them on first mention, matching an existing one case-insensitively
otherwise (`list_people` is there to check first, so "Mom" and "Mother" don't split into two
people). The room's own capture bar ("Note about Dana") is the direct path when Shane is already
looking at exactly who a note is about.

**The patterns panel is deliberately dumb** (`people.computePatterns`) — word counts and timing
over Shane's own words, quoted back verbatim, never a generated summary or an opinion about the
person. Three real, independent, plain-arithmetic signals, each only surfaced when there's a real
majority in the data (never padded to look meaningful): a word repeated in at least 3 of the last
5 notes, a proper-noun phrase (e.g. "The Rental") mentioned in at least 2 notes overall, and a
time-of-day majority (at least 60% of all notes, minimum 3) written in the same part of the day.
Fewer than 3 notes on file returns an empty pattern list — the honest answer, not a padded one.

**The real "search/ask interface for pattern recall"** (`GET /api/people?q=`) is genuinely
deterministic substring search, not a natural-language query: typing a name jumps straight to
that person's thread ("how have things with Dana been"), typing a word or phrase surfaces every
real note that used it, across everyone. `get_person_notes` (MCP) is the same real data read from
inside a live Claude conversation, for when Shane asks the question there instead of in the app —
the tool's own description tells Claude to answer from the real notes directly, never add a
diagnosis or advice framed as certainty.

**Export is a real, literal, chronological (oldest-first) transcript** (`GET
/api/people/:id/export`, "Export for therapist" in the UI) — never an AI-generated summary. The
contract's own "no advice framed as certainty" boundary rules that out, and Section 10 rules out
this app ever calling a model to produce one; what's exported is exactly what Shane wrote, in
order, dated — real material to bring to an actual therapist conversation, not a substitute for
one.

## Money — Banks: Plaid webhooks + reconnect (#3168)

**This app does not link banks and does not sync transactions.** ShanesSurvival's WPF app already
owns both, into this same real database: the initial Plaid Link, and the real cursor-based
`/transactions/sync` whose cursor lives in `plaid_items.sync_cursor` (migration 002). Two writers
on one cursor is exactly the bug this split exists to avoid, so nothing in `src/core/plaid.mjs`
fetches a transaction or a balance, and `bin/check.mjs` asserts that opening the Banks room moves
neither `sync_cursor` nor `last_synced_at`.

What lives here is the two real gaps **neither** app had (confirmed against
`FINANCE_TRACKER_AUDIT.md` §3 in `shanemccaw/Finance-Tracker`, the app being decommissioned):

**1. The webhook receiver** — `POST /api/plaid/webhook`, wired in `server.mjs` above both routers
because it authenticates by Plaid's own signature, never by the session cookie. Item health
(`ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT`, revocation) used to be
discovered only when a sync happened to fail, and a desktop app that isn't running discovers
nothing. This is the always-on hosted half, so it is the half that can hold a URL open.

Every delivery is verified before anything is applied: the `Plaid-Verification` JWS is checked as
ES256 (the `alg` is pinned, not read from the token), against the key Plaid serves for that `kid`,
with a SHA-256 comparison against the raw body and Plaid's own 5-minute replay window. A failed
check is a `403` **and** a real `plaid_webhook_events` row with `verified = false` — the evidence
is worth more than the silence. Every accepted webhook is stored verbatim too, including ones this
app has no opinion about, and including ones for an `item_id` this database has never seen (those
get a `200`, because no retry can fix them).

**2. The reconnect / update-mode Link flow** — ported from Finance-Tracker's real implementation.
`POST /api/money/banks/:id/reconnect-token` creates a Link token with `access_token` instead of
`products`, which is what makes Plaid re-authenticate the **existing** item: the item id and the
access token both survive, so the desktop app's stored cursor keeps working afterwards. Nothing
here exchanges a public token.

**The real open question in #3168 — where the reconnect UI lives — is decided: here, in the web
app, not in ShanesSurvival.** Not because this codebase is nicer, but because of where Shane is
when a bank breaks. The webhook that discovers the break has to land on an always-on hosted URL;
putting the alert here and the fix on his desktop would split one action across two apps and a
walk to the PC. Plaid Link in a plain browser also needs none of the WebView2 `"null"`-origin
workaround the WPF host required. ShanesSurvival keeps the initial-link flow unchanged.

`POST .../reconnect-complete` does **not** trust Link's `onSuccess` — that only means Shane
finished the flow. It re-reads the item from Plaid with `/item/get` and clears the state only if
the real answer is clean; a reconnect that didn't take stays broken on screen.

Two honest limits the Banks screen states out loud rather than hiding:

- **Plaid only delivers to a public HTTPS URL.** On a localhost origin `webhookDeliverable` is
  `false` and the screen says health is poll-only until the app is deployed.
- **Every item in this database was linked by the WPF app, which never set a webhook**, so they
  start with `webhook_url` NULL and cannot report their own health. `POST
  /api/money/banks/register-webhooks` (and the 6-hourly `runPlaidItemMaintenance` sweep) points
  them at this receiver via `/item/webhook/update`; the same sweep polls `/item/get` so a break
  is still caught — later than a webhook, but caught.

A real health transition **into** a reconnectable state queues a `bank` nudge through the same
1–3/day cap everything else respects. A repeat does not: Plaid re-sends `ITEM: ERROR` on every
failed call, and a nudge per repeat trains you to ignore the one that matters.

`npm run selftest-plaid-webhook` drives the real receiver end to end against the real database
with real ES256 signatures (25 checks: valid signature, tampered body, `alg` downgrade, stale
timestamp, missing header, health transitions, unknown `item_id`, cleanup). It works on a
disposable `zz-selftest-3168` row and deletes it in a `finally`. What it deliberately does not
claim to cover: that Plaid's own servers can reach a deployed URL, and that a key fetched from
`/webhook_verification_key/get` verifies a genuinely Plaid-signed body — both need a real public
HTTPS deployment and live credentials.

## Which rooms are real today

This section was written during #3107, when Shopping was the only real room and every table
under #3086 was schema-only. That is no longer true — each row below is a shipped Feature with
a live route, not a placeholder:

| table(s) | read/written by | issue |
|---|---|---|
| `dates`, `date_asks`, `date_visits`, `date_photos`, `federal_holidays` | `/api/dates*` | #3136 |
| `pets`, `pet_vaccines`, `pet_care`, `pet_records` | `/api/pets*` | Pets Feature |
| `things`, `contacts` | `/api/things*`, `/api/contacts*` | #3156 |
| `vault`, `vault_reveals` | `/api/vault*` | #3150 |
| `vehicles` | `/api/cars*` | #3149 |
| `wins` | `/api/money/wins` | #3151 |
| `smoke_log`, `catches` | `/api/money/catches`, `money.mjs` habit tracking | #3153, #3154 |
| `nudges`, `nudge_events` | `/api/nudges*` | (Nudges Feature) |
| Money generally | `/api/money/*` | #3137, #3147, #3148 |

Web push is also live end to end, not just scaffolded: `/api/push/subscribe` /
`/api/push/unsubscribe` register a real subscription, and `core/push-subscriptions.mjs`'s
`notifyUser()` calls `sendWebPush()` to actually deliver — the tray's remaining open question is
§10's iOS/Safari interactive-notification-action support, not whether anything sends.

**Genuinely not built yet:** the `hooks` table (migration 018) has no route reading or writing
it — nothing in this repo creates or consumes a hook. If you're picking this up, that's the one
real gap left from the original list.

Two things worth knowing before building one:

- **`entities`/`entity_items` and the typed tables overlap on purpose — and which one a room
  reads is now a real, recorded decision, not an open question.** Real decision from Shane on
  #3116, 2026-09-07: rooms use their own typed tables (`lists`/`list_items`, `things`,
  `contacts`, …), not the generic `entities`/`entity_items` pair — Shopping (#3088, above) is the
  first real consumer. `entities` stays real for its own actual purpose: the open tail that lets
  Claude file something under a category nobody has coded for, on the day it invents one.
- **`vehicles.loan_bill_id` is a real FK into ShanesSurvival's `accounts`.** That is the shared
  database paying for itself, and the pattern the rest of Money should follow: read the real
  Plaid-synced row, do not copy the number.

What this foundation owes the later Features is a shape they can be built on without a schema
change — which is why `entities`, `entity_items`, `categories` and `data jsonb` are shaped the way
they are, and why `captures.category` is free text rather than a foreign key.

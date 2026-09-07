# Shane's Life

The real hosted app for [Epic #3086](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3086).
This directory is the **App Foundation** ([#3087](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3087)):
hosting, database, auth, the universal capture box, no-login share links, and the MCP write
plane. It deliberately contains no content features — Shopping Lists is the next Feature and is
built on top of what is here, not beside it.

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
directory, so neither can run the other's. The number space, though, is now genuinely shared:
**check both `desktop/ShanesSurvival/migrations/` and `web/shanes-life/migrations/` before naming
a new migration file.**

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

Plain ES modules served as-is, and one runtime dependency (`pg`). Three real reasons:

1. **Instant redeploy-and-refresh** is a stated reason the Home Screen web app won over Expo
   (§10). A build step reintroduces the wait it was chosen to avoid.
2. **Bandwidth is a hard constraint on this project** (`CLAUDE.md`, Git #1987). A React + Vite +
   Tailwind toolchain is roughly a thousand packages to install and reinstall; `pg` is eight.
3. **`pg` was already resolvable**, so this app was built and verified without a single package
   download.

This is a foundation-scale decision, not a permanent vow: if the UI outgrows it, adding a bundler
later is ordinary work. Nothing here is structured to prevent that.

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
`sessions.last_verified_at` records when a session last passed a real assertion — the vault's
"fresh passkey per reveal" requirement is measured against it, via `POST /api/auth/reverify`.

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
   web push (§10).
7. **Verify the live deployment:**
   ```bash
   SL_CHECK_URL=https://<host> npm run check
   ```

## Not built here, on purpose

The notification tray, Today's real content, Money, Dates, Pets, Lists, Things, the Vault and
everything else in the handoff are later Features under #3086.

Their **schema** is here — migrations 014–018 create the real tables the handoff's *Data model
additions* section names (`dates`, `date_asks`, `date_visits`, `date_photos`,
`federal_holidays`, `pets`, `pet_vaccines`, `pet_care`, `pet_records`, `lists`, `list_items`,
`things`, `contacts`, `wins`, `smoke_log`, `catches`, `vault`, `vault_reveals`, `vehicles`,
`nudges`, `nudge_events`, `hooks`). **No route reads or writes any of them yet**, and they are
empty — no seed rows, no sample content, nothing invented to fill a screen. #3107's scope was the
shared database and the auth correction; each room is its own Feature, and each one starts with
its table already there and already the right shape.

Two things worth knowing before building one:

- **`entities`/`entity_items` and the typed tables overlap on purpose.** The typed tables back the
  rooms the design actually draws; `entities` is the open tail that lets Claude file something
  under a category nobody has coded for, on the day it invents one. Which of the two a given room
  reads is a real decision that room's Feature has to make and record — it is **not** settled here.
  Filed as a finding so it is decided deliberately rather than by whichever build gets there first.
- **`vehicles.loan_bill_id` is a real FK into ShanesSurvival's `accounts`.** That is the shared
  database paying for itself, and the pattern the rest of Money should follow: read the real
  Plaid-synced row, do not copy the number.

What this foundation owes the later Features is a shape they can be built on without a schema
change — which is why `entities`, `entity_items`, `categories` and `data jsonb` are shaped the way
they are, and why `captures.category` is free text rather than a foreign key.

Web push has its service-worker handler and its manifest in place, but **nothing subscribes and
nothing sends yet** — the tray Feature owns that, along with the real open question §10 raises
about how much of iOS's interactive notification-action support Safari genuinely delivers.

# Shane's Life

The real hosted app for [Epic #3086](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3086).
This directory is the **App Foundation** ([#3087](https://github.com/shanemccaw/Shane-McCaw-MSP/issues/3087)):
hosting, database, auth, the universal capture box, no-login share links, and the MCP write
plane. It deliberately contains no content features — Shopping Lists is the next Feature and is
built on top of what is here, not beside it.

**Read the design contract pack first:** `desktop/ShanesSurvival/docs/shanes-life-design-contract-pack.md`.
Every decision below traces to a section of it, and the section is cited in the code.

---

## What actually exists

| Contract-pack requirement | Where it lives |
|---|---|
| Real login/auth (§9) | `src/auth/`, `src/core/users.mjs`, `POST /api/auth/login` |
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
cp .env.example .env          # then fill in DATABASE_URL
npm install                   # one dependency: pg
npm run create-user -- --email you@example.com --name "Your Name"
npm start                     # http://localhost:5000
```

Migrations apply themselves on boot, so there is no separate setup step. `npm run migrate` runs
them without starting the server.

Verify the whole thing end to end against the real database, with the server running:

```bash
npm run check
```

That signs in, captures something, has MCP classify it into a category nothing in this codebase
has ever heard of, mints a share link, ticks an item off through that link with no credential at
all, and confirms the tick is visible to the owner. It creates and then deletes its own
disposable account, so it leaves no residue.

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

### The database is its own instance, not a schema inside an existing one

Audited before deciding, rather than assumed either way (the issue asked for exactly that):

- **The hosted Neon project is dead.** Its free-plan data-transfer quota was exhausted and its
  compute is suspended — the reason `CLAUDE.md` moved local dev onto a local Postgres 18 install
  in the first place. Putting a new app on it would have been building on a known-dead resource.
- **`shanemccawmsp` (the MSP platform database) is the wrong domain.** It carries customer/tenant
  business data and has migrations applied to it automatically by `scripts/post-merge.sh` on
  every merge. A personal app has no business sharing that blast radius.
- **`shanessurvival` is the right *eventual* home, but not yet.** Contract-pack §1 says the
  financial core becomes the foundation this app is built on — but #3087 states plainly that the
  unification is "a real, later, deliberate step, not assumed now", and that database is a local
  Windows install a Replit deployment cannot reach.

So: **a real database of its own, `shanes_life`, reached only through `DATABASE_URL`.** Locally
that is the local Postgres 18 install; in production it is Replit's own Postgres. When §1's
unification actually happens, ShanesSurvival's tables migrate *into* this hosted database —
which is the direction §1 describes, and is why nothing here is nested inside anyone else's
schema.

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

### Passwords use scrypt, sessions are opaque and server-side

`node:crypto`'s scrypt at N=2^15, per-user salt, parameters stored per row so they can be raised
later without invalidating old rows. Argon2id would need a compiled native dependency that has to
build on both Windows and Replit's Linux container — not worth it for the marginal gain here.

Sessions are random tokens in an `HttpOnly; SameSite=Lax` cookie, with only the SHA-256 stored.
Not JWTs, specifically because **a JWT cannot be revoked** and "sign out everywhere" is a real
requirement for an app that will hold financial reference data (§3, the bill-payment vault).

Login failures are rate-limited per address and per source, and every outcome — success, wrong
password, unknown account, throttled — is recorded in `auth_events`. The response is one identical
message for every failure, so it never reveals whether an address has an account.

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

The code is deploy-ready; **creating the deployment is Shane's own action** — it needs his Replit
account, and per `CLAUDE.md` an agent does not perform a hosting deploy.

1. **Create the Repl** from the GitHub repo `shanemccaw/Shane-McCaw-MSP`. `.replit` in this
   directory already points every command at `web/shanes-life`.
2. **Add the Postgres database** (Tools → Database → create). Replit sets `DATABASE_URL` itself.
3. **Set these Secrets:**
   | Secret | Value |
   |---|---|
   | `PUBLIC_ORIGIN` | the deployment's real HTTPS URL, no trailing slash |
   | `PGSSLMODE` | `require` |
   | `NODE_ENV` | `production` |

   `PUBLIC_ORIGIN` is load-bearing: it is what share links and the MCP endpoint are built from.
   Getting it wrong produces links that point at localhost.
4. **Deploy as a Reserved VM**, not Autoscale — the reasoning is in `.replit`, and it matters:
   the login limiter is per-process, and the notification tray this app is built toward needs a
   single long-lived process to schedule from.
5. **Create the real account**, once, in the Repl's shell:
   ```bash
   cd web/shanes-life && npm run create-user -- --email <shane's email> --name "Shane"
   ```
   There is no public sign-up route, by design.
6. **Add it to the Home Screen** — Safari → Share → Add to Home Screen. HTTPS, the manifest and
   the service worker are all already in place, which is what iOS requires before it will grant
   web push (§10).
7. **Verify the live deployment:**
   ```bash
   SL_CHECK_URL=https://<host> npm run check
   ```

## Not built here, on purpose

The notification tray, Today's real content, Money, People & Patterns, pets, medication and
everything else in the contract pack are later Features under #3086. What this foundation owes
them is a generic shape they can be built on without a schema change — which is why `entities`,
`entity_items`, `categories` and `data jsonb` are shaped the way they are.

Web push has its service-worker handler and its manifest in place, but **nothing subscribes and
nothing sends yet** — the tray Feature owns that, along with the real open question §10 raises
about how much of iOS's interactive notification-action support Safari genuinely delivers.

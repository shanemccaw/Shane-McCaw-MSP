# Shane's Life — Vault Autofill (Git #3243)

A real Chrome (Manifest V3) browser extension that autofills a real login form from
#3242's password vault — the real autofill LastPass currently provides, built on top of
the vault's existing storage and security rather than duplicating either.

#3243's own issue body flagged three real, explicit open questions and said not to
assume answers. Answered here, with the reasoning, rather than guessed at silently:

## 1. Auth model — how does the extension prove it's really Shane?

**It doesn't invent a credential of its own.** Two different real trust levels for two
different real actions, both borrowed from what the web app already has:

- **Finding which vault entries might belong to this page** (masked data only — id,
  label, site, username; never a plaintext password, because `vault.listEntries` has no
  plaintext path at all) reuses whatever real `sl_session` cookie already exists for the
  app's origin in Shane's own browser. `background.js`'s `fetch(..., { credentials:
  "include" })` is the one privileged, non-CORS-restricted place in the extension that
  can do this (see the "Why the background script, not the content script" note below).
  If Shane isn't signed in there, this comes back `401` and the extension says so — it
  never tries to sign in on its own.
- **Actually revealing a real password** goes through the exact same real,
  fresh-per-entry WebAuthn ceremony the Vault room's own "Reveal" button already
  requires (`POST /api/vault/:id/reveal/options` + `/reveal`) — same 20-second window,
  same rate limit, same `vault_reveals` audit row. This is deliberately **not**
  weakened for the extension's convenience: #3242's own recorded bar is "same real
  security bar ... Not a lighter version because there are more entries," and autofill
  *is* a reveal. Because a WebAuthn ceremony has to run on a page whose origin actually
  matches the Relying Party ID — a `chrome-extension://` page cannot perform it against
  the app's real origin — `background.js` opens a small real popup window onto the
  app's own hosted page instead of trying to fake the ceremony inside the extension.
  `public/app.js` runs the ceremony exactly as it already does for a normal in-app
  reveal (see the `extensionReveal` bridge added there), and hands the plaintext back
  across the extension boundary the only way a web page can talk to extension code: a
  `CustomEvent` on `window`, relayed by `bridge.js` (the one content script that runs on
  the app's own origin, not on the page being autofilled).

No new bearer token, no new backend auth path, no new table. The extension is exactly
as trusted as the browser it runs in already was, for lookup, and no more trusted than
a fresh Face ID scan, for an actual reveal — the same two-tier trust the web UI already
has, just crossing a process boundary in the middle.

**Real, honest limit not resolved here:** this whole design depends on being able to
read the app's own session cookie from an extension background fetch with
`credentials: "include"`. That is standard, documented Chrome extension behavior for a
host-permitted origin, but it has not been exercised against a real running browser in
this session (see "What is NOT verified" below) — if it turns out `SameSite=Lax`
blocks it in practice, the honest fallback is the same either way: a `401` shows
"Sign in to Shane's Life first," never a silent failure or a weaker credential.

## 2. Matching logic — how does it know which credential belongs to the page?

Plain, case-insensitive, both-directions substring matching between the page's real
`location.hostname` and each `login`-kind vault entry's `site` **and** `label` field —
`extension/lib/site-match.mjs`, real node-runnable assertions in
`extension/site-match.test.mjs` (run: `node extension/site-match.test.mjs`, 8/8 pass).
This is the same real trade-off #3242's own weekly-ad-verdict matching and vault search
already made: one side is Shane's own free text, the other is a fixed real value, so an
exact-match lookup would miss real matches (a `site` of "Chase" against a hostname of
"chase.com"). Deliberately **not** attempted: public-suffix-list-aware "registrable
domain" parsing — real complexity this zero-dependency, no-build-step app has never
needed before, for a case a plain substring match already gets right.

## 3. Browser scope — which browsers?

**Chrome (Manifest V3) only, for this phase.** Reasoned, not assumed, and cheaply
reversible: MV3's `chrome.scripting.registerContentScripts` (used here for the
dynamic app-origin bridge, since the app has no fixed public host yet — see below) is
the real mechanism this design depends on, and Firefox's own MV3 support and its
cross-origin-cookie behavior for extension background fetches are both genuinely
different enough to need their own real verification, not an assumption that "it's the
same WebExtensions API so it'll just work." A Firefox port is real, scoped follow-up
work, not a gap papered over here.

---

## Why the App URL is a setting, not a hardcoded origin

The shanes-life README's own "Deploying to Replit — Not yet, deliberately" section is
still true: there is no fixed public host for this app yet. `manifest.json` therefore
declares no static `host_permissions` and no static content-script match for the app's
own origin. Instead:

- `options.html` asks Shane for the real App URL (default `http://localhost:5000` for
  local dev) and requests that one origin via `chrome.permissions.request` —
  `optional_host_permissions` in `manifest.json`, not a blanket grant.
- `background.js` registers `bridge.js` (the content script that talks to the app's own
  page) dynamically, for whatever origin was actually granted, via
  `chrome.scripting.registerContentScripts`.

When #3107's real deployment happens, updating the App URL in Settings is the only
change this extension needs — nothing here has a `localhost` string baked in anywhere
except the one default value in `options.html`.

## Why the background script, not the content script

A content script's own `fetch()`/`XMLHttpRequest` is still subject to the *page's* CORS
restrictions even with `host_permissions` granted — since Chrome 76, cross-origin
`fetch()` from a content script is blocked outright. `chrome.scripting`'s privileged
background/service-worker context is not: `host_permissions` is itself the extension's
authorization to cross origins there, which is why every real network call in this
extension (`SL_FIND_MATCHES`, opening the reveal popup) happens in `background.js`, and
a content script only ever talks to it over `chrome.runtime.sendMessage`.

## The 30-day trust model (Git #3276)

**Superseded by this section:** every earlier revision of this file said every fill costs a
Face ID. Shane's own explicit request (recorded in the design handoff, `Shanes Life 19 -
Vault Autofill.dc.html`) was the opposite of that for day-to-day use: "One Face ID a month,
not one per password." The crypto, the audit trail and the 20-second reveal window
(`src/core/vault.mjs`) are completely unchanged — what changed is that a successful reveal
from this extension can now ALSO mint a real, revocable `vault_device_trust` token (migration
062/063, shape of `widget_tokens`: a high-entropy value handed out once, only its SHA-256
ever stored, `expires_at` = 7/30/90 days, `revoked_at`), and a later fill from that same
browser can spend that token instead of running WebAuthn again.

- **`POST /api/vault/:id/fill`** (new, `src/routes/api.mjs`) takes the trust token in the
  request body, not the session cookie — it is the one deliberately cross-origin route in
  this whole app (`server.mjs`'s `checkOrigin` exempts exactly this path), because it is
  called straight from `background.js`'s privileged context, never through a same-origin
  popup. It returns the plaintext once and writes a real `vault_reveals` row with
  `via = 'extension-trusted'`, and refuses outright (409) an entry with `vault.always_ask`
  set — that one keeps demanding Face ID no matter how trusted the browser is.
- The token itself lives in `chrome.storage.session`, not `chrome.storage.local` — it
  survives a service-worker restart within the same real browser session, but is gone the
  moment the browser itself closes. A deliberately more conservative choice for a bearer
  credential that fills passwords than a persistent 30-day cookie would have been.
- **Minting rides the SAME reveal request that already ran WebAuthn**, never a second
  ceremony: `completeExtensionReveal` in `public/app.js` sends `trustDevice`/`deviceLabel`/
  `trustDays` alongside the assertion on `POST /api/vault/:id/reveal` whenever this browser
  doesn't currently hold a live token, and `vault.mintTrustedDevice` mints it server-side in
  that same handler, after the same real passkey check every other reveal already requires.
- **Forget** (the chip's popup, the toolbar popup, the options page, and the Vault room's own
  Browser add-on card all reach it) and **Sign out everywhere** in the app's own Settings
  both revoke every trust token for real — `vault.forgetDevice` / `vault.revokeAllTrustedDevices`.

## How a fill actually happens

1. `content-script.js` (runs on every page) looks for a visible `input[type=password]`
   and its likely username/email sibling inside the same `<form>`.
2. It asks `background.js` (`SL_FIND_MATCHES`) which real vault logins might match this
   page's hostname, and whether this browser currently holds a live trust token. If any
   entries match, a dark pill chip appears bottom-right of the page — the toolbar popup
   (`popup.html`) offers the same list as a fallback for a page whose CSS swallows the chip.
3. **Trusted, and the entry isn't `always_ask`:** the chip's own **Fill** button asks
   `background.js` (`SL_TRY_FILL`) to `POST /api/vault/:id/fill` with the stored token —
   no popup window, no WebAuthn prompt. A 401/409 back from that (token expired/revoked, or
   the entry really does always ask) falls through to step 4 exactly as if there had never
   been a token at all.
4. **Not trusted, or `always_ask`:** the chip's **Unlock** button asks `background.js`
   (`SL_REQUEST_REVEAL`) to open a real popup window onto the app's own origin, carrying
   `?extReveal=<id>&extNonce=<n>` and — when no live trust exists yet —
   `&extOfferTrust=1&extDeviceLabel=…&extTrustDays=…`.
5. `public/app.js` (see the `extensionReveal` block) opens straight to the Vault tab,
   runs the real fresh WebAuthn ceremony for that one entry (minting a trust token too, if
   offered and the toggle was left on), and on success or failure dispatches a
   `CustomEvent` and closes the popup.
6. `bridge.js` relays that event (plaintext, and the minted trust token if there is one) to
   `background.js`, which stores the token in `chrome.storage.session` and relays the fill
   itself to the original tab's content script, which fills the real value into the real
   fields using a native `<input>` value setter + real `input`/`change` events (the standard
   way to make a React/Vue-controlled form actually notice the fill) — the plaintext itself
   is never written to `chrome.storage` or anywhere else that outlives that one message.

## Installing (unpacked, for local testing)

1. `cd web/shanes-life && npm start` (needs `SL_VAULT_KEY` set — see the main README).
2. Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select this `extension/` directory.
3. Click the extension's icon → **Settings** → confirm the App URL
   (`http://localhost:5000` for local dev) → **Save** → grant the permission prompt.
4. Visit any real page with a login form. The first fill for a site shows the amber
   **Unlock** chip and opens the real Face ID popup, with "Trust this Chrome for N days"
   on by default; a fill within that window on the same real browser instead shows the
   blue **Fill** chip and skips straight to a one-click fill.

## What is NOT verified in this build

This session has no way to drive a real Chrome window, click "Load unpacked," or
satisfy a real WebAuthn biometric prompt — the same honest boundary #3242's own
`bin/check.mjs` already states for its browser half ("What it does not cover... is the
browser half"). Verified here (Git #3276): `vault.mjs`'s new trust functions and the
`/api/vault/:id/fill` route exercised directly against the local database and a running
dev server (mint → fill → refuse an always-ask entry → Forget revokes → a forgotten
token's next fill 401s), the migration applied for real, and every extension file still
parses (`node --check`). **Not** verified: the real extension loading in Chrome, the real
chip/popup/options UI rendering, the real one-click **Fill** button firing from
`chrome.storage.session`, and the real Face ID → trust-toggle → mint round trip end to
end in a real third-party login form — that is the real, live test #3276's own
"Verification" section asks for, and it needs Shane's own hands on a real browser to run.

// The extension's one privileged network context. Real jobs, Git #3243's original two plus
// Git #3276's real trust model on top:
//
// 1. FIND_MATCHES -- ask the app "which of my logins might belong to this page", using the
//    SAME masked list the web app's own Vault room reads (`GET /api/vault?kind=login`), over
//    the real, already-authenticated browser session cookie for the app's origin. This is
//    the extension's whole answer to #3243's "how does it prove it's really Shane" question:
//    it does NOT invent its own credential. Matching never sees a plaintext password -- there
//    isn't one to see; `listEntries` (src/core/vault.mjs) has no plaintext path at all. Each
//    match now also carries `alwaysAsk` (062) so the content script/popup can tell a Fill row
//    from a Face ID row before anyone clicks anything.
//
// 2. REQUEST_REVEAL -- open a real popup window onto the app's own origin, where the app's
//    EXISTING per-entry fresh-WebAuthn reveal ceremony runs completely unmodified
//    (`POST /api/vault/:id/reveal/options` + `/reveal`, same 20-second window, same
//    `vault_reveals` audit row, same rate limit). This is deliberately NOT weakened for the
//    extension's convenience -- #3242's own recorded bar is "same real security bar ...
//    Not a lighter version because there are more entries", and autofill IS a reveal. When
//    there's no currently-valid trust for this browser, the popup also offers "Trust this
//    Chrome for N days" on the SAME request (Git #3276) -- see completeExtensionReveal in
//    public/app.js -- and the minted token comes back through this same round trip.
//
// 3. TRY_FILL (Git #3276) -- the one-click path a trusted browser gets: POST
//    /api/vault/:id/fill with the stored trust token, straight from this background context,
//    no popup window at all. Refused (401/409) falls back to REQUEST_REVEAL -- a trust token
//    that turned out to be expired/revoked/refused is a real "ask again", never a silent dead
//    end for the content script.
//
// 4. Trust storage -- chrome.storage.session (README, Git #3276: "the extension keeps only
//    the token ... in chrome.storage.session, never the password"). Session storage, not
//    local: it survives a service-worker restart within the same real browser session but is
//    cleared when the browser itself closes, a deliberately more conservative choice than a
//    persistent 30-day cookie would be for a bearer credential that fills passwords.
//
// 5. FORGET_DEVICE / LIST_LOGINS / SET_ALWAYS_ASK -- the small number of other authenticated
//    calls the popup and options page need (Forget this Chrome, the "Everything else" list,
//    the options page's Always-ask list). Kept here rather than fetched directly from
//    popup.js/options.js so there is still exactly one place in this extension that ever
//    talks to the network -- the reason this file's very first line says "one privileged
//    network context".
//
// A content script's own fetch() is subject to page CORS even with host permissions; only
// this privileged background context is not (see extension/README.md's "Why the background
// script, not the content script" note). Fetches here run with `credentials: "include"` so
// the browser attaches whatever real `sl_session` cookie already exists for the app's origin
// -- if Shane isn't signed in there, this comes back 401 and the caller says so.

import { findMatches } from "./lib/site-match.mjs";

const REVEAL_TIMEOUT_MS = 90_000;
const DEFAULT_TRUST_DAYS = 30;

/** nonce -> { tabId, windowId, timeoutId } for a reveal popup that is currently open,
 *  waiting on bridge.js (running inside that popup, on the app's own origin) to relay back
 *  what the real WebAuthn ceremony produced. Cleared the moment it resolves, times out, or
 *  the popup window is closed by hand. */
const pendingReveals = new Map();

async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  return appUrl || null;
}

async function getTrustDays() {
  const { trustDays } = await chrome.storage.local.get("trustDays");
  return Number(trustDays) || DEFAULT_TRUST_DAYS;
}

async function hasHostPermission(appUrl) {
  try {
    return await chrome.permissions.contains({ origins: [new URL(appUrl).origin + "/*"] });
  } catch {
    return false;
  }
}

// -- Trust storage (Git #3276) -----------------------------------------------------------

/** The stored trust for THIS browser, or null if there never was one. Does not itself check
 *  `expiresAt` -- most callers want to know "is there a token to try at all" (server-side
 *  expiry/revocation is still the real check, on every fill); `isTrustCurrentlyValid` below
 *  is the one that also compares against wall-clock time for UI purposes. */
async function getStoredTrust() {
  const { trust } = await chrome.storage.session.get("trust");
  return trust || null;
}

async function setStoredTrust(trust) {
  if (trust) await chrome.storage.session.set({ trust });
  else await chrome.storage.session.remove("trust");
}

/** Client-side estimate only -- "is it even worth trying the one-click path, and should the
 *  chip/popup show a green trusted line or an amber untrusted one". The server's own
 *  `expires_at`/`revoked_at` check inside resolveTrustedDevice is the real gate; this just
 *  avoids firing a fill that's obviously going to 401 and avoids a UI that claims trust the
 *  token doesn't actually have any more. */
async function isTrustCurrentlyValid() {
  const trust = await getStoredTrust();
  if (!trust) return false;
  return new Date(trust.expiresAt).getTime() > Date.now();
}

/** Guessed from the one real signal a service worker has -- its own `navigator.userAgent` --
 *  never asked of Shane as a form field. Good enough for a device LABEL (the design's own
 *  "Work laptop" is itself just a human-friendly name, not a real device fingerprint); Shane
 *  can always rename by Forgetting and re-trusting under a different browser profile. */
function guessDeviceLabel() {
  const ua = navigator.userAgent || "";
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\//i.test(ua) ? "Opera" : "Chrome";
  const os = /mac os x/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : "this device";
  return `${browser} on ${os}`;
}

/** Re-registers the bridge content script (the one piece of this extension that runs on the
 *  app's OWN real page, not a page being autofilled) for whatever origin is currently
 *  configured. Called on startup and whenever options.html saves a new App URL. There is no
 *  static origin in manifest.json to match against -- the app has no fixed public host yet
 *  (the shanes-life README's own "Deploying to Replit -- Not yet, deliberately" section), so
 *  this has to be dynamic, via `chrome.scripting.registerContentScripts` under the optional
 *  host permission granted in options.html, not a hardcoded manifest entry. */
async function registerBridgeForConfiguredOrigin() {
  await chrome.scripting.unregisterContentScripts({ ids: ["sl-bridge"] }).catch(() => {});
  const appUrl = await getAppUrl();
  if (!appUrl || !(await hasHostPermission(appUrl))) return;
  const origin = new URL(appUrl).origin;
  await chrome.scripting.registerContentScripts([
    {
      id: "sl-bridge",
      matches: [origin + "/*"],
      js: ["bridge.js"],
      runAt: "document_idle",
    },
  ]);
}

chrome.runtime.onInstalled.addListener(registerBridgeForConfiguredOrigin);
chrome.runtime.onStartup.addListener(registerBridgeForConfiguredOrigin);

function settleReveal(nonce, message) {
  const pending = pendingReveals.get(nonce);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingReveals.delete(nonce);
  chrome.tabs.sendMessage(pending.tabId, message).catch(() => {
    // The tab that asked may have navigated away or closed -- nothing more to do.
  });
  if (pending.windowId != null) {
    chrome.windows.remove(pending.windowId).catch(() => {});
  }
}

// If Shane just closes the popup instead of completing (or cancelling) Face ID, that is a
// real "no" -- the requesting tab should stop waiting, not sit on a spinner for 90 seconds.
chrome.windows.onRemoved.addListener((closedWindowId) => {
  for (const [nonce, pending] of pendingReveals) {
    if (pending.windowId === closedWindowId) {
      settleReveal(nonce, { type: "SL_FILL", ok: false, reason: "cancelled" });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SL_APP_URL_SAVED") {
    registerBridgeForConfiguredOrigin().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "SL_FIND_MATCHES") {
    (async () => {
      const appUrl = await getAppUrl();
      if (!appUrl || !(await hasHostPermission(appUrl))) {
        sendResponse({ ok: false, reason: "not-configured" });
        return;
      }
      let res;
      try {
        res = await fetch(`${appUrl}/api/vault?kind=login`, { credentials: "include" });
      } catch (err) {
        sendResponse({ ok: false, reason: "network-error", message: String(err?.message || err) });
        return;
      }
      if (res.status === 401) {
        sendResponse({ ok: false, reason: "signed-out" });
        return;
      }
      if (!res.ok) {
        sendResponse({ ok: false, reason: "server-error", message: `HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      const matches = findMatches(body.entries || [], message.hostname).map((entry) => ({
        id: entry.id,
        label: entry.label,
        site: entry.site,
        username: entry.username || null,
        alwaysAsk: Boolean(entry.alwaysAsk),
      }));
      const trust = (await isTrustCurrentlyValid()) ? await getStoredTrust() : null;
      sendResponse({ ok: true, matches, trust });
    })();
    return true; // async response
  }

  // Git #3276: everything else the vault holds, masked, for the popup's "Everything else"
  // section (README, 1b: "fills the username only; the password still needs a site match").
  // Same list SL_FIND_MATCHES already fetches, just unfiltered by hostname.
  if (message?.type === "SL_LIST_LOGINS") {
    (async () => {
      const appUrl = await getAppUrl();
      if (!appUrl || !(await hasHostPermission(appUrl))) {
        sendResponse({ ok: false, reason: "not-configured" });
        return;
      }
      let res;
      try {
        res = await fetch(`${appUrl}/api/vault?kind=login`, { credentials: "include" });
      } catch (err) {
        sendResponse({ ok: false, reason: "network-error", message: String(err?.message || err) });
        return;
      }
      if (res.status === 401) {
        sendResponse({ ok: false, reason: "signed-out" });
        return;
      }
      if (!res.ok) {
        sendResponse({ ok: false, reason: "server-error", message: `HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      sendResponse({
        ok: true,
        entries: (body.entries || [])
          .filter((e) => e.kind === "login")
          .map((e) => ({ id: e.id, label: e.label, site: e.site, username: e.username || null, alwaysAsk: Boolean(e.alwaysAsk) })),
      });
    })();
    return true;
  }

  // Git #3276: options page's own "Stop asking" action (README, 1d: "Add more from the Vault
  // room ... " -- this is the options page's own symmetric way to remove one).
  if (message?.type === "SL_SET_ALWAYS_ASK") {
    (async () => {
      const appUrl = await getAppUrl();
      if (!appUrl) {
        sendResponse({ ok: false, reason: "not-configured" });
        return;
      }
      let res;
      try {
        res = await fetch(`${appUrl}/api/vault/${encodeURIComponent(message.entryId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alwaysAsk: Boolean(message.alwaysAsk) }),
        });
      } catch (err) {
        sendResponse({ ok: false, reason: "network-error", message: String(err?.message || err) });
        return;
      }
      sendResponse(res.ok ? { ok: true } : { ok: false, reason: "server-error", message: `HTTP ${res.status}` });
    })();
    return true;
  }

  // Git #3276: real trust status for the popup's trust card / options page's "This Chrome"
  // card -- client-cached (see isTrustCurrentlyValid's own note), not a network call.
  if (message?.type === "SL_TRUST_STATUS") {
    (async () => {
      const trust = await getStoredTrust();
      const trustDays = await getTrustDays();
      sendResponse({
        ok: true,
        trust: trust && new Date(trust.expiresAt).getTime() > Date.now() ? trust : null,
        trustDays,
      });
    })();
    return true;
  }

  if (message?.type === "SL_SET_TRUST_DAYS") {
    (async () => {
      const days = Number(message.days);
      if (![7, 30, 90].includes(days)) {
        sendResponse({ ok: false, reason: "bad-days" });
        return;
      }
      await chrome.storage.local.set({ trustDays: days });
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Git #3276: "Forget this Chrome" (the chip's popup, the app's own popup, and the options
  // page all reach this same one action) -- revokes the real vault_device_trust row server-
  // side (session-cookie authed, same as SL_FIND_MATCHES) and clears the local cache either
  // way, so a Forget can never leave a stale, already-revoked token sitting in
  // chrome.storage.session pretending to still be good.
  if (message?.type === "SL_FORGET_DEVICE") {
    (async () => {
      const trust = await getStoredTrust();
      await setStoredTrust(null);
      if (!trust?.id) {
        sendResponse({ ok: true, hadTrust: false });
        return;
      }
      const appUrl = await getAppUrl();
      try {
        if (appUrl) {
          await fetch(`${appUrl}/api/vault/device-trust/${encodeURIComponent(trust.id)}`, {
            method: "DELETE",
            credentials: "include",
          });
        }
      } catch {
        // The local cache is already cleared either way -- a network failure here just means
        // the server-side row outlives its real usefulness until it naturally expires.
      }
      sendResponse({ ok: true, hadTrust: true });
    })();
    return true;
  }

  // Git #3276: the one-click path. Tries the stored trust token straight against
  // POST /api/vault/:id/fill; the caller (content-script.js) falls back to SL_REQUEST_REVEAL
  // on anything but ok:true, exactly the same as if no trust had ever existed.
  if (message?.type === "SL_TRY_FILL") {
    (async () => {
      const appUrl = await getAppUrl();
      const trust = await getStoredTrust();
      if (!appUrl || !trust) {
        sendResponse({ ok: false, reason: "not-trusted" });
        return;
      }
      let res;
      try {
        res = await fetch(`${appUrl}/api/vault/${encodeURIComponent(message.entryId)}/fill`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: trust.token, site: message.hostname || null }),
        });
      } catch (err) {
        sendResponse({ ok: false, reason: "network-error", message: String(err?.message || err) });
        return;
      }
      if (res.status === 401) {
        // The token really is dead server-side (expired/revoked) -- stop pretending locally.
        await setStoredTrust(null);
        sendResponse({ ok: false, reason: "not-trusted" });
        return;
      }
      if (res.status === 409) {
        // "This login always asks" -- a real refusal, not a bug; the caller's own fallback to
        // SL_REQUEST_REVEAL is the correct next step, same as it would be for any other login.
        sendResponse({ ok: false, reason: "always-ask" });
        return;
      }
      if (!res.ok) {
        sendResponse({ ok: false, reason: "server-error", message: `HTTP ${res.status}` });
        return;
      }
      const body = await res.json();
      sendResponse({ ok: true, value: body.value, username: body.username || null });
    })();
    return true;
  }

  if (message?.type === "SL_REQUEST_REVEAL") {
    (async () => {
      const appUrl = await getAppUrl();
      if (!appUrl) {
        sendResponse({ ok: false, reason: "not-configured" });
        return;
      }
      // A content script's message always carries sender.tab; the popup UI has no tab of its
      // own, so it passes the active tab's id explicitly instead.
      const tabId = sender.tab?.id ?? message.tabId;
      if (tabId == null) {
        sendResponse({ ok: false, reason: "no-tab" });
        return;
      }
      const nonce = crypto.randomUUID();
      // Git #3273: the Vault is its own room now (#3272), not a Money sub-tab -- point the
      // popup at #/vault so viewVault's own completeExtensionReveal() wiring has somewhere
      // real to land.
      //
      // Git #3276: offer the trust toggle whenever this browser doesn't currently hold a live
      // token -- design 1c, "First time on this Chrome, or the 30 days are up". Trusting the
      // browser during an always-ask entry's own reveal is still worth offering: THIS entry
      // will keep asking regardless (the fill route enforces that server-side), but every
      // OTHER login benefits from the same one Face ID.
      const offerTrust = !(await isTrustCurrentlyValid());
      const days = await getTrustDays();
      const url =
        `${appUrl}/?extReveal=${encodeURIComponent(message.entryId)}&extNonce=${encodeURIComponent(nonce)}` +
        (offerTrust
          ? `&extOfferTrust=1&extDeviceLabel=${encodeURIComponent(guessDeviceLabel())}&extTrustDays=${days}`
          : "") +
        `#/vault`;
      const win = await chrome.windows.create({ url, type: "popup", width: 420, height: 640 });
      const timeoutId = setTimeout(() => {
        settleReveal(nonce, { type: "SL_FILL", ok: false, reason: "timeout" });
      }, REVEAL_TIMEOUT_MS);
      pendingReveals.set(nonce, { tabId, windowId: win.id, timeoutId });
      sendResponse({ ok: true, nonce });
    })();
    return true;
  }

  // From bridge.js, running inside the popup on the app's own real origin -- the ONLY place
  // a plaintext value ever crosses from a web page into this extension's message bus. It is
  // relayed straight through to the waiting tab and never written to chrome.storage. `trust`
  // (Git #3276), when present, is a different kind of payload -- not a secret, the token that
  // stands in for one -- and IS written to chrome.storage.session, since that's the whole
  // point of it existing.
  if (message?.type === "SL_REVEAL_RESULT") {
    if (message.ok && message.trust) {
      setStoredTrust({
        id: message.trust.id,
        token: message.trust.token,
        label: message.trust.label,
        expiresAt: message.trust.expiresAt,
      });
    }
    settleReveal(message.nonce, {
      type: "SL_FILL",
      ok: message.ok,
      value: message.value,
      username: message.username,
      reason: message.reason,
      message: message.message,
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

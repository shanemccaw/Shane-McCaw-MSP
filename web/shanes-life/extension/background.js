// The extension's one privileged network context. Two, and only two, real jobs:
//
// 1. FIND_MATCHES -- ask the app "which of my logins might belong to this page", using the
//    SAME masked list the web app's own Vault room reads (`GET /api/vault?kind=login`), over
//    the real, already-authenticated browser session cookie for the app's origin. This is
//    the extension's whole answer to #3243's "how does it prove it's really Shane" question:
//    it does NOT invent its own credential. Matching never sees a plaintext password -- there
//    isn't one to see; `listEntries` (src/core/vault.mjs) has no plaintext path at all.
//
// 2. REQUEST_REVEAL -- open a real popup window onto the app's own origin, where the app's
//    EXISTING per-entry fresh-WebAuthn reveal ceremony runs completely unmodified
//    (`POST /api/vault/:id/reveal/options` + `/reveal`, same 20-second window, same
//    `vault_reveals` audit row, same rate limit). This is deliberately NOT weakened for the
//    extension's convenience -- #3242's own recorded bar is "same real security bar ...
//    Not a lighter version because there are more entries", and autofill IS a reveal.
//
// A content script's own fetch() is subject to page CORS even with host permissions; only
// this privileged background context is not (see extension/README.md's "Why the background
// script, not the content script" note). Fetches here run with `credentials: "include"` so
// the browser attaches whatever real `sl_session` cookie already exists for the app's origin
// -- if Shane isn't signed in there, this comes back 401 and the content script says so.

import { findMatches } from "./lib/site-match.mjs";

const REVEAL_TIMEOUT_MS = 90_000;

/** nonce -> { tabId, windowId, timeoutId } for a reveal popup that is currently open,
 *  waiting on bridge.js (running inside that popup, on the app's own origin) to relay back
 *  what the real WebAuthn ceremony produced. Cleared the moment it resolves, times out, or
 *  the popup window is closed by hand. */
const pendingReveals = new Map();

async function getAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  return appUrl || null;
}

async function hasHostPermission(appUrl) {
  try {
    return await chrome.permissions.contains({ origins: [new URL(appUrl).origin + "/*"] });
  } catch {
    return false;
  }
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
      }));
      sendResponse({ ok: true, matches });
    })();
    return true; // async response
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
      const url = `${appUrl}/?extReveal=${encodeURIComponent(message.entryId)}&extNonce=${encodeURIComponent(nonce)}#/money`;
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
  // relayed straight through to the waiting tab and never written to chrome.storage.
  if (message?.type === "SL_REVEAL_RESULT") {
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

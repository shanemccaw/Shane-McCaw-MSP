/**
 * content.js — runs on https://claude.ai/chat/* pages.
 *
 * Only extracts data (conversation id from the URL, title from
 * document.title) and hands it to background.js via chrome.runtime.sendMessage.
 * Deliberately does NOT fetch from here: a content script's network requests
 * are subject to the PAGE's own Content-Security-Policy, and claude.ai's is
 * strict enough that a cross-origin POST to your own API would likely be
 * blocked. The background service worker's fetch uses the extension's own
 * granted host permission instead and isn't subject to that.
 */

const CONVERSATION_ID_RE = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** How long to wait for the title to stop changing before sending it. */
const SETTLE_DELAY_MS = 1500;

/**
 * Titles claude.ai shows before it's actually generated a real one — a new
 * chat starts as "New chat"/blank and claude.ai suffixes "Claude" onto every
 * tab title, so a still-loading page can genuinely have nothing better to
 * send yet. Sending one of these would just get discarded server-side anyway
 * (title only backfills a chat still stubbed as its own conversation id) but
 * there's no reason to fire the request at all.
 */
const PLACEHOLDER_TITLES = new Set(["", "new chat", "claude"]);

function conversationIdFromUrl() {
  const match = location.pathname.match(CONVERSATION_ID_RE);
  return match ? match[1] : null;
}

/** Strips claude.ai's own " - Claude" (or similar) tab-title suffix. */
function cleanTitle(raw) {
  return raw.replace(/\s*[-–|]\s*Claude\s*$/i, "").trim();
}

let sendTimer = null;

function scheduleSend() {
  const conversationId = conversationIdFromUrl();
  if (!conversationId) return;

  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    const title = cleanTitle(document.title);
    if (PLACEHOLDER_TITLES.has(title.toLowerCase())) return; // not settled yet
    chrome.runtime.sendMessage({ type: "build-tracker-ingest", conversationId, title });
  }, SETTLE_DELAY_MS);
}

// Fire once on load — covers revisiting a chat whose title is already final.
scheduleSend();

// claude.ai updates <title> asynchronously (streams the generated name in
// after your first message). A direct `document.title =` write doesn't
// dispatch any DOM event, so watch the <title> element's own childList
// instead — that's what actually changes under the hood.
const titleEl = document.querySelector("title");
if (titleEl) {
  new MutationObserver(scheduleSend).observe(titleEl, { childList: true });
}

// claude.ai is a client-routed SPA — clicking from one chat to another in
// the sidebar doesn't reload the page, so content.js only ever runs once per
// tab. Watch the URL itself so switching chats without a reload still fires.
let lastPath = location.pathname;
new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    scheduleSend();
  }
}).observe(document.body, { childList: true, subtree: true });

/**
 * background.js — MV3 service worker.
 *
 * Does every actual authenticated request to Build Tracker's API. content.js
 * only messages data here — see its own doc comment for why: a content
 * script's own fetch is subject to claude.ai's page CSP (confirmed directly —
 * its `connect-src` only allows 'self' and a Cloudflare challenge host, so a
 * cross-origin fetch to our own API would be blocked outright), while the
 * service worker's fetch uses the extension's own granted host permission
 * instead and isn't subject to that.
 */

/** Don't re-send the exact same (conversationId, title, issueId, epicId) tuple more than once a minute. */
const RECENT_SEND_TTL_MS = 60_000;
const recentSends = new Map(); // key -> timestamp

async function getConfig() {
  const { apiBaseUrl, ingestToken } = await chrome.storage.local.get(["apiBaseUrl", "ingestToken"]);
  return { apiBaseUrl, ingestToken };
}

/**
 * POSTs to /chats/ingest. Used both for the passive title-sync (content.js's
 * own settle timer) and for the panel's "link this chat to X" click —
 * issueId/epicId are optional in both cases; the server only ever applies
 * them to a chat that's still unlinked, so sending them opportunistically on
 * every title-sync call is harmless, not just on an explicit link click.
 */
async function ingestChat(conversationId, title, issueId, epicId) {
  const key = `${conversationId}:${title ?? ""}:${issueId ?? ""}:${epicId ?? ""}`;
  const now = Date.now();
  const last = recentSends.get(key);
  if (last && now - last < RECENT_SEND_TTL_MS) return { ok: true, deduped: true };
  recentSends.set(key, now);

  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    const err = "Not configured — open the extension's Options page.";
    await chrome.storage.local.set({ lastError: err });
    return { ok: false, error: err };
  }

  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/chats/ingest`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({
        conversation_id: conversationId,
        title: title || undefined,
        issueId: typeof issueId === "number" ? issueId : undefined,
        epicId: typeof epicId === "number" ? epicId : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
      await chrome.storage.local.set({ lastError: err });
      return { ok: false, error: err };
    }

    const data = await res.json().catch(() => null);
    await chrome.storage.local.set({
      lastError: null,
      lastSyncAt: now,
      lastConversationId: conversationId,
      lastTitle: data?.title ?? title ?? conversationId,
    });
    return { ok: true, chat: data };
  } catch (err) {
    const msg = String(err);
    await chrome.storage.local.set({ lastError: msg });
    return { ok: false, error: msg };
  }
}

/** GETs /extension/board — the panel's Milestone/Epic/Issue list + current-chat link status. */
async function getBoard(conversationId) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }

  const base = apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api/admin/build-tracker/extension/board?conversationId=${encodeURIComponent(conversationId ?? "")}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ingestToken}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    const data = await res.json();
    return { ok: true, board: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "build-tracker-ingest") {
    void ingestChat(message.conversationId, message.title, message.issueId, message.epicId).then(sendResponse);
    return true; // keep the channel open for the async sendResponse above
  }
  if (message?.type === "build-tracker-get-board") {
    void getBoard(message.conversationId).then(sendResponse);
    return true;
  }
  return false;
});

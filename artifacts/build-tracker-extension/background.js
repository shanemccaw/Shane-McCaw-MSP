/**
 * background.js — MV3 service worker.
 *
 * Does the actual authenticated POST to Build Tracker's ingest endpoint.
 * content.js only messages {conversationId, title} here — see its own doc
 * comment for why the fetch has to happen from this side, not there.
 */

/** Don't re-send the exact same (conversationId, title) pair more than once a minute. */
const RECENT_SEND_TTL_MS = 60_000;
const recentSends = new Map(); // `${conversationId}:${title}` -> timestamp

async function getConfig() {
  const { apiBaseUrl, ingestToken } = await chrome.storage.local.get(["apiBaseUrl", "ingestToken"]);
  return { apiBaseUrl, ingestToken };
}

async function ingestChat(conversationId, title) {
  const key = `${conversationId}:${title ?? ""}`;
  const now = Date.now();
  const last = recentSends.get(key);
  if (last && now - last < RECENT_SEND_TTL_MS) return;
  recentSends.set(key, now);

  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    await chrome.storage.local.set({ lastError: "Not configured — open the extension's Options page." });
    return;
  }

  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/chats/ingest`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ingestToken}`,
      },
      body: JSON.stringify({ conversation_id: conversationId, title: title || undefined }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await chrome.storage.local.set({
        lastError: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      });
      return;
    }

    const data = await res.json().catch(() => null);
    await chrome.storage.local.set({
      lastError: null,
      lastSyncAt: now,
      lastConversationId: conversationId,
      lastTitle: data?.title ?? title ?? conversationId,
    });
  } catch (err) {
    await chrome.storage.local.set({ lastError: String(err) });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "build-tracker-ingest") {
    void ingestChat(message.conversationId, message.title);
    sendResponse({ ok: true });
  }
  return true;
});

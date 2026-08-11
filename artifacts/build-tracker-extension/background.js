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
 * Reads a response body as JSON, but never throws "Unexpected token '<'" at
 * the caller — that error means the API base URL resolved to something that
 * isn't actually the api-server (most often its own frontend's index.html,
 * served with a 200 for any unrecognized path by the SPA's own dev server).
 * Diagnosing that from a raw SyntaxError is opaque, so this reads the body as
 * text first and gives a specific, actionable message when it looks like
 * HTML rather than the generic parse error.
 */
async function readJson(res) {
  const text = await res.text();
  try {
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch {
    if (/^\s*<(!doctype|html)/i.test(text)) {
      return {
        ok: false,
        error:
          "Got an HTML page back instead of JSON — the API base URL in Settings isn't reaching your api-server " +
          "(it's landing on a page instead, e.g. the admin panel's own frontend). Double-check that URL.",
      };
    }
    return { ok: false, error: `Response wasn't valid JSON: ${text.slice(0, 200)}` };
  }
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

    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      const err = !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}`;
      await chrome.storage.local.set({ lastError: err });
      return { ok: false, error: err };
    }

    const data = parsed.data;
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
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, board: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * POSTs to /github-sync — a real pull from GitHub, not just a re-read of
 * Build Tracker's own (possibly stale) DB. The panel's Refresh button drives
 * this (Git #693): without it, a freshly-applied in-flight/complete label
 * only shows up here after Shane goes to the admin panel and clicks its own
 * "Sync GitHub" button. Can take a few seconds on a real repo (paginated
 * GitHub fetch) — the caller shows its own "Syncing…" state while this runs.
 */
async function syncGithub() {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/github-sync`;
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${ingestToken}` } });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * POSTs to /extension/quick-sync — a fast, targeted alternative to
 * syncGithub() above (Git #695: the full sync was too slow just to catch a
 * label change on issues already on screen). Fetches only the given issue
 * numbers directly, no whole-repo pagination.
 */
async function quickSync(issueNumbers) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/extension/quick-sync`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ issueNumbers }),
    });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * POSTs to /extension/sync-epic — Git #698: quickSync() above only refreshes
 * issue NUMBERS it's already given, so a brand-new sub-issue added to an
 * epic on GitHub never shows up in the panel until a full sync. This calls
 * GitHub's own sub-issues list for one epic (a single request) so newly
 * added children get pulled in too, not just refreshed. Used by the panel's
 * Refresh button whenever the current chat is focused on one epic.
 */
async function syncEpic(epicNumber) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/extension/sync-epic`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ epicNumber }),
    });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Git #702 — floaty SQL Runner + Deploy Console. Both reuse EXISTING,
 * already-shipped admin routes (the admin panel's own SQL Runner and Deploy
 * Console) rather than new backend capability — see admin-engines.ts and
 * admin-deploy-console.ts's own doc comments. Shane's development server,
 * full read/write, by his explicit choice.
 */
async function runSql(query) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/simulator/sql/execute`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ query }),
    });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function listDeployOperations() {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/simulator/deploy/operations`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ingestToken}` } });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** `operationKey` runs one whitelisted operation; `freeCommand` (if given instead) runs verbatim shell text through the real Deploy Console's free-text route. */
async function runDeploy({ operationKey, freeCommand }) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const base = apiBaseUrl.replace(/\/$/, "");
  const url = operationKey
    ? `${base}/api/admin/simulator/deploy/${encodeURIComponent(operationKey)}`
    : `${base}/api/admin/simulator/deploy/console`;
  const body = operationKey ? undefined : JSON.stringify({ command: freeCommand });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: operationKey
        ? { Authorization: `Bearer ${ingestToken}` }
        : { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body,
    });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * PATCHes /issues/:id with {status: "closed"} — Shane: "when I close it in
 * this, that IS me closing it." Reuses the admin panel's own issue-edit
 * route, which already pushes the real close to GitHub (and to the
 * Projects v2 Status field) when `status` changes — not new capability,
 * just widened auth (Git #714 follow-up).
 */
async function setIssueStatus(issueId, status) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/issues/${encodeURIComponent(issueId)}`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ingestToken}` },
      body: JSON.stringify({ status }),
    });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, issue: parsed.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function closeIssue(issueId) {
  return setIssueStatus(issueId, "closed");
}

/** Undo for an accidental close click (Shane: "I'm OK with undo right now") — reopens on GitHub, back to "done" locally since it's still complete-labeled, just not closed. */
function reopenIssue(issueId) {
  return setIssueStatus(issueId, "done");
}

/** GETs /extension/issue-lookup — powers the hover card for any #N the content script finds in a claude.ai message. */
async function lookupIssue(number) {
  const { apiBaseUrl, ingestToken } = await getConfig();
  if (!apiBaseUrl || !ingestToken) {
    return { ok: false, error: "Not configured — open the extension's Options page." };
  }
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/admin/build-tracker/extension/issue-lookup?number=${encodeURIComponent(number)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ingestToken}` } });
    const parsed = await readJson(res);
    if (!res.ok || !parsed.ok) {
      return { ok: false, error: !parsed.ok ? parsed.error : `HTTP ${res.status}: ${JSON.stringify(parsed.data)}` };
    }
    return { ok: true, result: parsed.data };
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
  if (message?.type === "build-tracker-sync-github") {
    void syncGithub().then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-quick-sync") {
    void quickSync(message.issueNumbers).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-sync-epic") {
    void syncEpic(message.epicNumber).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-run-sql") {
    void runSql(message.query).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-list-deploy-ops") {
    void listDeployOperations().then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-run-deploy") {
    void runDeploy({ operationKey: message.operationKey, freeCommand: message.freeCommand }).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-close-issue") {
    void closeIssue(message.issueId).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-reopen-issue") {
    void reopenIssue(message.issueId).then(sendResponse);
    return true;
  }
  if (message?.type === "build-tracker-lookup-issue") {
    void lookupIssue(message.number).then(sendResponse);
    return true;
  }
  return false;
});

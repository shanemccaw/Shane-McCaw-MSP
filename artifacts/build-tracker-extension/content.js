/**
 * content.js — runs on https://claude.ai/chat/* pages.
 *
 * Two jobs, both driven by the same conversation id:
 *   1. Passive title-sync — unchanged from before, sends {conversationId,
 *      title} to background.js once the tab title settles.
 *   2. A small floating panel ("What am I working on?") listing open
 *      Milestones/Epics/Issues so Shane can see his Build Tracker context
 *      without leaving the chat, and link the CURRENT chat to one with a
 *      click — instead of always landing unlinked and triaging it later in
 *      Build Tracker itself.
 *
 * Never fetches directly — see background.js's doc comment for why (claude.ai's
 * own CSP would block it); this file only extracts data and messages it over.
 */

const CONVERSATION_ID_RE = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SETTLE_DELAY_MS = 1500;
const PLACEHOLDER_TITLES = new Set(["", "new chat", "claude"]);
/** Board data older than this refetches on next panel expand, rather than reusing a stale list. */
const BOARD_STALE_MS = 2 * 60 * 1000;

function conversationIdFromUrl() {
  const match = location.pathname.match(CONVERSATION_ID_RE);
  return match ? match[1] : null;
}

/** Strips claude.ai's own " - Claude" (or similar) tab-title suffix. */
function cleanTitle(raw) {
  return raw.replace(/\s*[-–|]\s*Claude\s*$/i, "").trim();
}

function currentSettledTitle() {
  const title = cleanTitle(document.title);
  return PLACEHOLDER_TITLES.has(title.toLowerCase()) ? null : title;
}

// ── 1. Passive title-sync (unchanged behavior) ─────────────────────────────

let sendTimer = null;

function scheduleTitleSync() {
  const conversationId = conversationIdFromUrl();
  if (!conversationId) return;

  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    const title = currentSettledTitle();
    if (!title) return; // not settled yet
    chrome.runtime.sendMessage({ type: "build-tracker-ingest", conversationId, title });
  }, SETTLE_DELAY_MS);
}

scheduleTitleSync();

const titleEl = document.querySelector("title");
if (titleEl) {
  new MutationObserver(scheduleTitleSync).observe(titleEl, { childList: true });
}

// ── SPA navigation watcher — drives both title-sync and the panel ─────────

let lastPath = location.pathname;
new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    scheduleTitleSync();
    onConversationChanged();
  }
}).observe(document.body, { childList: true, subtree: true });

// ── 2. Floating "What am I working on?" panel ──────────────────────────────

let boardCache = null; // { data, fetchedAt }
let panelEls = null; // { host, tab, panel, current, list, search }

function buildPanel() {
  if (panelEls) return panelEls;

  const host = document.createElement("div");
  host.style.all = "initial"; // isolate from claude.ai's own styles
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", sans-serif; }
    .tab {
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      writing-mode: vertical-rl; padding: 10px 6px; border-radius: 8px 0 0 8px;
      background: #0f6cbd; color: #fff; font-size: 11.5px; font-weight: 700;
      letter-spacing: .04em; cursor: pointer; box-shadow: -2px 0 8px rgba(0,0,0,.3);
      user-select: none;
    }
    .panel {
      position: fixed; top: 40px; right: 0; bottom: 40px; width: 320px;
      background: #1f1f1f; border-left: 1px solid #3b3b3b; box-shadow: -4px 0 16px rgba(0,0,0,.4);
      display: flex; flex-direction: column; color: #f3f2f1;
    }
    .panel[hidden] { display: none; }
    .header {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid #2e2e2e; font-size: 12.5px; font-weight: 700; flex: none;
    }
    .header .title { flex: 1; }
    .iconbtn {
      background: transparent; border: 0; color: #a19f9d; cursor: pointer;
      font-size: 13px; padding: 2px 6px; border-radius: 4px;
    }
    .iconbtn:hover { background: #292929; color: #fff; }
    .current {
      padding: 8px 12px; font-size: 11px; color: #a19f9d; border-bottom: 1px solid #2e2e2e; flex: none;
    }
    .current.linked { color: #7fae91; }
    .search {
      margin: 8px 12px; padding: 6px 8px; border-radius: 5px; border: 1px solid #3b3b3b;
      background: #292929; color: #f3f2f1; font-size: 12px; outline: none; flex: none;
    }
    .list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
    .milestone { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      color: #f2ca63; margin: 10px 6px 4px; }
    .epic-row {
      display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 5px;
      cursor: pointer; font-size: 12.5px; font-weight: 600;
    }
    .epic-row:hover { background: #292929; }
    .epic-row .pill { font-size: 9px; color: #8f8c88; }
    .issue-row {
      display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 22px; border-radius: 5px;
      cursor: pointer; font-size: 12px; color: #c8c6c4;
    }
    .issue-row:hover { background: #292929; color: #fff; }
    .empty { padding: 16px 8px; font-size: 12px; color: #8f8c88; text-align: center; }
    .linked-badge { color: #7fae91; font-size: 11px; margin-left: auto; }
  `;
  shadow.appendChild(style);

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.textContent = "BUILD TRACKER";
  shadow.appendChild(tab);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="header">
      <span class="title">What am I working on?</span>
      <button class="iconbtn" data-action="refresh" title="Refresh">⟳</button>
      <button class="iconbtn" data-action="close" title="Close">✕</button>
    </div>
    <div class="current"></div>
    <input class="search" placeholder="Search…" />
    <div class="list"></div>
  `;
  shadow.appendChild(panel);

  const current = panel.querySelector(".current");
  const list = panel.querySelector(".list");
  const search = panel.querySelector(".search");

  tab.addEventListener("click", () => togglePanel(true));
  panel.querySelector('[data-action="close"]').addEventListener("click", () => togglePanel(false));
  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => loadBoard(true));
  search.addEventListener("input", () => renderList(search.value));

  // claude.ai listens for keystrokes on the document to auto-focus its own
  // chat composer ("type anywhere to start typing") — keyboard events are
  // composed, so they bubble straight out of this shadow root to that
  // listener same as any other DOM event, and every keystroke in our search
  // box was getting redirected into claude.ai's own input instead. Stopping
  // propagation here (on the panel, so it covers every field inside it, not
  // just this one) keeps every keystroke typed inside the panel local to it.
  for (const evt of ["keydown", "keyup", "keypress"]) {
    panel.addEventListener(evt, (e) => e.stopPropagation());
  }

  panelEls = { host, tab, panel, current, list, search };
  return panelEls;
}

function togglePanel(open) {
  const { panel, tab } = buildPanel();
  panel.hidden = !open;
  tab.style.display = open ? "none" : "block";
  if (open) loadBoard(false);
}

async function loadBoard(force) {
  const conversationId = conversationIdFromUrl();
  const { list } = buildPanel();

  const fresh = boardCache && Date.now() - boardCache.fetchedAt < BOARD_STALE_MS;
  if (!force && fresh) {
    renderList(panelEls.search.value);
    return;
  }

  list.innerHTML = `<div class="empty">Loading…</div>`;
  const res = await chrome.runtime.sendMessage({ type: "build-tracker-get-board", conversationId });
  if (!res?.ok) {
    list.innerHTML = `<div class="empty">${escapeHtml(res?.error ?? "Couldn't load — check the extension's settings.")}</div>`;
    return;
  }

  boardCache = { data: res.board, fetchedAt: Date.now() };
  renderCurrent(res.board.currentChat);
  renderList(panelEls.search.value);
}

function renderCurrent(currentChat) {
  const { current } = panelEls;
  if (currentChat && (currentChat.issueId || currentChat.epicId)) {
    current.textContent = `Linked to: ${currentChat.title}`;
    current.classList.add("linked");
  } else {
    current.textContent = "Not linked yet — click an item below.";
    current.classList.remove("linked");
  }
}

function renderList(query) {
  const { list } = panelEls;
  if (!boardCache) return;
  const { milestones, epics, issues } = boardCache.data;
  const q = (query ?? "").trim().toLowerCase();

  const matches = (title, num) =>
    !q || title.toLowerCase().includes(q) || (num != null && String(num).includes(q.replace(/^#/, "")));

  const issuesByEpic = new Map();
  const unassignedIssues = [];
  for (const issue of issues) {
    if (issue.epicId == null) { unassignedIssues.push(issue); continue; }
    if (!issuesByEpic.has(issue.epicId)) issuesByEpic.set(issue.epicId, []);
    issuesByEpic.get(issue.epicId).push(issue);
  }

  const milestoneFor = (epic) =>
    milestones.find((m) => m.githubNumber === epic.milestoneId || m.id === epic.milestoneId);

  const groups = new Map(); // milestone title (or "Unsorted") -> epics[]
  for (const epic of epics) {
    const epicIssues = (issuesByEpic.get(epic.id) ?? []).filter((i) => matches(i.title, i.githubNumber));
    const epicMatches = matches(epic.title, epic.githubNumber);
    if (!epicMatches && epicIssues.length === 0) continue;
    const ms = milestoneFor(epic);
    const key = ms ? ms.title : "Unsorted Epics";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ epic, issues: epicIssues });
  }

  const filteredUnassigned = unassignedIssues.filter((i) => matches(i.title, i.githubNumber));

  if (groups.size === 0 && filteredUnassigned.length === 0) {
    list.innerHTML = `<div class="empty">${q ? "No matches." : "Nothing open right now."}</div>`;
    return;
  }

  list.innerHTML = "";
  for (const [milestoneTitle, entries] of groups) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = milestoneTitle;
    list.appendChild(h);

    for (const { epic, issues: epicIssues } of entries) {
      const row = document.createElement("div");
      row.className = "epic-row";
      row.innerHTML = `<span>${escapeHtml(epic.title)}</span>${epic.githubNumber ? `<span class="pill">#${epic.githubNumber}</span>` : ""}`;
      row.addEventListener("click", () => linkTo({ epicId: epic.id }, epic.title));
      list.appendChild(row);

      for (const issue of epicIssues) {
        const irow = document.createElement("div");
        irow.className = "issue-row";
        irow.textContent = `${issue.githubNumber ? `#${issue.githubNumber} ` : ""}${issue.title}`;
        irow.addEventListener("click", () => linkTo({ issueId: issue.id }, issue.title));
        list.appendChild(irow);
      }
    }
  }

  if (filteredUnassigned.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = "No Epic";
    list.appendChild(h);
    for (const issue of filteredUnassigned) {
      const irow = document.createElement("div");
      irow.className = "issue-row";
      irow.style.paddingLeft = "8px";
      irow.textContent = `${issue.githubNumber ? `#${issue.githubNumber} ` : ""}${issue.title}`;
      irow.addEventListener("click", () => linkTo({ issueId: issue.id }, issue.title));
      list.appendChild(irow);
    }
  }
}

async function linkTo(target, label) {
  const conversationId = conversationIdFromUrl();
  if (!conversationId) return;
  const { current } = panelEls;
  current.textContent = `Linking to ${label}…`;
  const res = await chrome.runtime.sendMessage({
    type: "build-tracker-ingest",
    conversationId,
    title: currentSettledTitle() || undefined,
    issueId: target.issueId,
    epicId: target.epicId,
  });
  if (res?.ok) {
    // The server only applies a link if the chat was still unlinked — re-fetch
    // so "Not linked yet" flips to the real result rather than assuming success.
    void loadBoard(true);
  } else {
    current.textContent = `Couldn't link: ${res?.error ?? "unknown error"}`;
    current.classList.remove("linked");
  }
}

function onConversationChanged() {
  if (!panelEls || panelEls.panel.hidden) return;
  loadBoard(true);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Build the (collapsed) panel shell once on load so the tab is there
// immediately, without eagerly hitting the API before you've asked for it.
buildPanel();

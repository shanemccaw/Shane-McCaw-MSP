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
let panelEls = null; // { host, tab, panel, progress, current, list, search }
/** True once the user explicitly asks to browse past a focused epic — reset on every new chat/link. */
let showAllOverride = false;

/**
 * Rows Shane has clicked ✕ on — "complete" issues that are done with (he's
 * already sent the "landed" prompt, or otherwise doesn't need to see it
 * anymore) but that otherwise stick around in the panel forever, since
 * nothing else ever removes a row. Keyed by githubNumber and persisted in
 * chrome.storage.local so a dismissal survives a reload/re-sync, not just
 * this page view.
 */
let dismissedIssues = new Set();
let dismissedLoaded = false;

async function loadDismissed() {
  if (dismissedLoaded) return;
  const { dismissedIssues: stored } = await chrome.storage.local.get("dismissedIssues");
  dismissedIssues = new Set(stored ?? []);
  dismissedLoaded = true;
}

function isDismissed(issue) {
  return issue.githubNumber != null && dismissedIssues.has(issue.githubNumber);
}

async function dismissIssue(issue) {
  if (issue.githubNumber == null) return;
  dismissedIssues.add(issue.githubNumber);
  await chrome.storage.local.set({ dismissedIssues: Array.from(dismissedIssues) });
  render();
}

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
      position: fixed; top: 40px; right: 0; bottom: 40px; width: 272px;
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
    .progress { padding: 10px 12px 4px; flex: none; }
    .progress[hidden] { display: none; }
    .progress-label {
      display: flex; justify-content: space-between; font-size: 11px; color: #c8c6c4;
      margin-bottom: 5px; font-weight: 600;
    }
    .progress-bar { height: 6px; border-radius: 3px; background: #292929; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 200ms ease; }
    .current {
      padding: 8px 12px; font-size: 11px; color: #a19f9d; border-bottom: 1px solid #2e2e2e; flex: none;
    }
    .current.linked { color: #7fae91; }
    .current a.showall {
      color: #7fb4d8; margin-left: 8px; text-decoration: none; font-weight: 600;
    }
    .current a.showall:hover { text-decoration: underline; }
    .search {
      margin: 8px 12px; padding: 6px 8px; border-radius: 5px; border: 1px solid #3b3b3b;
      background: #292929; color: #f3f2f1; font-size: 12px; outline: none; flex: none;
    }
    .list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
    .footer { padding: 7px 12px; border-top: 1px solid #2e2e2e; flex: none; }
    .footer button {
      background: transparent; border: 0; color: #7fb4d8; font-size: 10.5px; cursor: pointer; padding: 0;
    }
    .footer button:hover { text-decoration: underline; }
    .footer button:disabled { color: #6d6b69; cursor: default; text-decoration: none; }
    .milestone { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      color: #f2ca63; margin: 10px 6px 4px; }
    .epic-row {
      display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 5px;
      cursor: pointer; font-size: 12.5px; font-weight: 600;
    }
    .epic-row:hover { background: #292929; }
    .epic-row .pill { font-size: 9px; color: #8f8c88; }
    /* A small boxed card, not a single truncated line — title can wrap to two
       lines, and the two action buttons live in their own row underneath so
       they don't fight the title for space at this panel's width. */
    .issue-row {
      display: flex; flex-direction: column; gap: 5px; padding: 7px 9px;
      margin: 4px 0 4px 16px; border-radius: 6px; background: #242424;
      border: 1px solid #2e2e2e; cursor: pointer; font-size: 12px; color: #c8c6c4;
    }
    .issue-row:hover { border-color: #3b3b3b; background: #272727; }
    .issue-row .issue-top { display: flex; align-items: flex-start; gap: 6px; }
    .issue-row .issue-text {
      flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; line-height: 1.35;
    }
    /* "in-flight" GitHub label — Claude Code is actively working on this
       issue right now (see CLAUDE.md's "GitHub issue label sync"). A small
       glowing/pulsing dot, not a full tint — this is a "still moving" signal,
       lighter-weight than the finished "complete" state below. */
    .issue-row .dot {
      width: 7px; height: 7px; border-radius: 50%; background: #3fb950; flex: none;
      margin-top: 4px; animation: bt-pulse 1.6s ease-out infinite;
    }
    @keyframes bt-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(63,185,80,.55); }
      70%  { box-shadow: 0 0 0 6px rgba(63,185,80,0); }
      100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); }
    }
    /* "complete" GitHub label — code is done and confirmed, not yet reviewed/
       closed by Shane. A full green tint on the row, deliberately heavier
       than the in-flight dot since this is the "stop and look at this" state. */
    .issue-row.label-complete {
      background: rgba(127,174,145,.16); border-color: rgba(127,174,145,.35); color: #dff2e6;
    }
    .issue-row.label-complete:hover { background: rgba(127,174,145,.26); }
    .issue-row .check { color: #7fae91; font-weight: 800; flex: none; margin-top: 1px; }
    .issue-row .issue-actions { display: flex; gap: 4px; flex: none; }
    .issue-row .ibtn {
      width: 22px; height: 20px; border-radius: 4px; border: 0; background: transparent;
      color: #8f8c88; display: flex; align-items: center; justify-content: center;
      cursor: pointer; font-size: 12px; padding: 0;
    }
    .issue-row .ibtn:hover { background: #333; color: #fff; }
    .empty { padding: 16px 8px; font-size: 12px; color: #8f8c88; text-align: center; }

    /* Details dialog — a proper centered modal, not squeezed into the 320px
       panel, since reading a full description needs real width. */
    .dlg-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
    }
    .dlg-backdrop[hidden] { display: none; }
    .dlg {
      width: 420px; max-width: 90vw; max-height: 70vh; background: #1f1f1f;
      border: 1px solid #3b3b3b; border-radius: 10px; box-shadow: 0 20px 50px rgba(0,0,0,.5);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .dlg-header {
      display: flex; align-items: flex-start; gap: 8px; padding: 14px 16px;
      border-bottom: 1px solid #2e2e2e; flex: none;
    }
    .dlg-header .dlg-title { flex: 1; font-size: 14px; font-weight: 700; color: #fff; line-height: 1.4; }
    .dlg-status { padding: 10px 16px 0; flex: none; }
    .dlg-status .pill {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      padding: 3px 8px; border-radius: 10px; background: #292929; color: #a19f9d;
    }
    .dlg-body {
      padding: 10px 16px 16px; overflow-y: auto; font-size: 12.5px; line-height: 1.6;
      color: #d6d4d2; white-space: pre-wrap;
    }
    .dlg-expand {
      margin: 0 16px 16px; padding: 6px 12px; border-radius: 6px; border: 1px solid #3b3b3b;
      background: #292929; color: #7fb4d8; font-size: 11.5px; cursor: pointer; align-self: flex-start;
      flex: none;
    }
    .dlg-expand[hidden] { display: none; }
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
      <button class="iconbtn" data-action="copy-last" title="Copy Claude's last code block (the panel sits over its own copy button)">📋</button>
      <button class="iconbtn" data-action="navigate" title="Find another chat — browse Milestone → Epic → chat">🧭</button>
      <button class="iconbtn" data-action="refresh" title="Quick sync — checks just the issues on screen">⟳</button>
      <button class="iconbtn" data-action="close" title="Close">✕</button>
    </div>
    <div class="progress" hidden></div>
    <div class="current"></div>
    <input class="search" placeholder="Search…" />
    <div class="list"></div>
    <div class="footer">
      <button type="button" data-action="full-sync">Full sync from GitHub (discover new items)</button>
    </div>
  `;
  shadow.appendChild(panel);

  const dlgBackdrop = document.createElement("div");
  dlgBackdrop.className = "dlg-backdrop";
  dlgBackdrop.hidden = true;
  dlgBackdrop.innerHTML = `
    <div class="dlg" role="dialog" aria-label="Issue details">
      <div class="dlg-header">
        <span class="dlg-title"></span>
        <button class="iconbtn" data-action="dlg-close" title="Close">✕</button>
      </div>
      <div class="dlg-status"></div>
      <div class="dlg-body"></div>
      <button class="dlg-expand" hidden>Read more</button>
    </div>
  `;
  shadow.appendChild(dlgBackdrop);

  // Milestone → Epic → chat navigator (Git #697) — the base panel only ever
  // shows the CURRENT chat's own context; this is the way to get to a
  // *different* chat's epic without leaving claude.ai to go dig through
  // Build Tracker itself. Reuses the same .dlg/.epic-row look as everything
  // else, just a separate backdrop so it can stack independently of the
  // details dialog.
  const navBackdrop = document.createElement("div");
  navBackdrop.className = "dlg-backdrop";
  navBackdrop.hidden = true;
  navBackdrop.innerHTML = `
    <div class="dlg" role="dialog" aria-label="Find a chat">
      <div class="dlg-header">
        <button class="iconbtn" data-action="nav-back" title="Back">←</button>
        <span class="dlg-title">Find a chat</span>
        <button class="iconbtn" data-action="nav-close" title="Close">✕</button>
      </div>
      <div class="dlg-body nav-body"></div>
    </div>
  `;
  shadow.appendChild(navBackdrop);

  const navTitle = navBackdrop.querySelector(".dlg-title");
  const navBody = navBackdrop.querySelector(".nav-body");
  const navBackBtn = navBackdrop.querySelector('[data-action="nav-back"]');

  const closeNavigator = () => { navBackdrop.hidden = true; };
  navBackdrop.querySelector('[data-action="nav-close"]').addEventListener("click", closeNavigator);
  navBackdrop.querySelector('[data-action="nav-back"]').addEventListener("click", () => navBack());
  navBackdrop.addEventListener("click", (e) => { if (e.target === navBackdrop) closeNavigator(); });
  for (const evt of ["keydown", "keyup", "keypress"]) {
    navBackdrop.addEventListener(evt, (e) => {
      e.stopPropagation();
      if (evt === "keydown" && e.key === "Escape") closeNavigator();
    });
  }

  const dlgTitle = dlgBackdrop.querySelector(".dlg-title");
  const dlgStatus = dlgBackdrop.querySelector(".dlg-status");
  const dlgBody = dlgBackdrop.querySelector(".dlg-body");
  const dlgExpand = dlgBackdrop.querySelector(".dlg-expand");

  const closeDetails = () => { dlgBackdrop.hidden = true; };
  dlgBackdrop.querySelector('[data-action="dlg-close"]').addEventListener("click", closeDetails);
  // Click the dimmed backdrop (not the dialog box itself) to dismiss.
  dlgBackdrop.addEventListener("click", (e) => { if (e.target === dlgBackdrop) closeDetails(); });
  for (const evt of ["keydown", "keyup", "keypress"]) {
    dlgBackdrop.addEventListener(evt, (e) => {
      e.stopPropagation();
      if (evt === "keydown" && e.key === "Escape") closeDetails();
    });
  }

  const progress = panel.querySelector(".progress");
  const current = panel.querySelector(".current");
  const list = panel.querySelector(".list");
  const search = panel.querySelector(".search");

  tab.addEventListener("click", () => togglePanel(true));
  panel.querySelector('[data-action="close"]').addEventListener("click", () => togglePanel(false));
  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => void quickRefresh());
  panel.querySelector('[data-action="full-sync"]').addEventListener("click", () => void fullSyncFromGithub());
  panel.querySelector('[data-action="copy-last"]').addEventListener("click", () => void copyLastCodeBlock());
  panel.querySelector('[data-action="navigate"]').addEventListener("click", () => openNavigator());
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

  panelEls = {
    host, tab, panel, progress, current, list, search,
    dlgBackdrop, dlgTitle, dlgStatus, dlgBody, dlgExpand,
    navBackdrop, navTitle, navBody, navBackBtn,
  };
  return panelEls;
}

/** Short first pass — long enough to be useful, short enough to actually be a "summary." */
const SUMMARY_CHARS = 220;

function openDetails(issue) {
  const { dlgBackdrop, dlgTitle, dlgStatus, dlgBody, dlgExpand } = buildPanel();
  dlgTitle.textContent = `${issue.githubNumber ? `#${issue.githubNumber} ` : ""}${issue.title}`;
  dlgStatus.innerHTML = issue.status
    ? `<span class="pill">${escapeHtml(issue.status.replace(/_/g, " "))}</span>`
    : "";

  const desc = (issue.description ?? "").trim();
  if (!desc) {
    dlgBody.textContent = "No description.";
    dlgExpand.hidden = true;
  } else if (desc.length <= SUMMARY_CHARS) {
    dlgBody.textContent = desc;
    dlgExpand.hidden = true;
  } else {
    dlgBody.textContent = `${desc.slice(0, SUMMARY_CHARS).trim()}…`;
    dlgExpand.hidden = false;
    dlgExpand.textContent = "Read more";
    dlgExpand.onclick = () => {
      dlgBody.textContent = desc;
      dlgExpand.hidden = true;
    };
  }

  dlgBackdrop.hidden = false;
}

/**
 * Copies the most recent code block Claude wrote — Shane's own workflow is
 * "Claude gives me a copy block with build instructions, I copy it into a
 * new Claude Code session" — straight to the clipboard. Exists because this
 * panel sits fixed over the right edge of the page, which covers claude.ai's
 * own per-block copy button; this sidesteps hunting around the panel for it
 * entirely rather than just narrowing the panel and hoping it still fits.
 * Best-effort like findComposer() below: grabs the last <pre> in document
 * order, since that's always the most recent message's code block.
 */
async function copyLastCodeBlock() {
  const btn = panelEls.panel.querySelector('[data-action="copy-last"]');
  const blocks = document.querySelectorAll("pre");
  const last = blocks[blocks.length - 1];
  if (!last) {
    flashButton(btn, "✗");
    return;
  }
  const text = (last.innerText ?? last.textContent ?? "").trim();
  const ok = await copyText(text);
  flashButton(btn, ok ? "✓" : "✗");
}

/** navigator.clipboard.writeText first; a hidden-textarea + execCommand fallback if that's blocked. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flashButton(btn, symbol, ms = 1300) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = symbol;
  setTimeout(() => { btn.textContent = original; }, ms);
}

/**
 * Finds claude.ai's own chat composer so a prompt can be inserted into it.
 * Best-effort: claude.ai doesn't expose a stable id/data-testid this file can
 * rely on, so this picks the largest visible contenteditable on the page —
 * in practice always the composer, since nothing else on a chat page is both
 * that large and directly editable. If claude.ai's layout changes this is
 * the one function that needs revisiting.
 */
function findComposer() {
  const candidates = Array.from(document.querySelectorAll('div[contenteditable="true"]')).filter(
    (el) => el.offsetParent !== null,
  );
  candidates.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight);
  return candidates[0] ?? null;
}

/**
 * `complete` means Claude Code already confirmed this landed — Shane's own
 * follow-up workflow is typing "687 landed" back at the Claude he's talking
 * to, so it can check and close it out. Everything else gets the original
 * "come look at this" starter instead.
 */
function issuePromptText(issue) {
  if (issueLabelState(issue) === "complete") return `${issue.githubNumber} landed`;
  return `Let's look at Git #${issue.githubNumber}...`;
}

/**
 * Inserts (never sends — Shane's explicit ask, so it never reads as a bot
 * talking to Claude) a starter prompt into the composer, positioned at the
 * end of whatever's already typed there. Uses execCommand('insertText')
 * because that's what produces a real native `input` event with
 * inputType "insertText" — the same shape a real keystroke produces, which
 * is what makes React/ProseMirror-style editors (claude.ai's composer is one)
 * actually pick up the change instead of silently ignoring a plain
 * textContent write. Falls back to a manual insert + dispatched InputEvent
 * for the rare case execCommand is unsupported.
 */
function insertPrompt(issue) {
  const composer = findComposer();
  if (!composer) {
    window.alert("Couldn't find the chat box on this page — claude.ai's layout may have changed.");
    return;
  }
  const text = issuePromptText(issue);

  composer.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false); // end of existing content, not the start
  sel.removeAllRanges();
  sel.addRange(range);

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    range.insertNode(document.createTextNode(text));
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}

/**
 * "I'd rather close it less than open it more" — the panel now defaults to
 * OPEN on every claude.ai page (initPanelVisibility() below), and every
 * explicit open/close click persists here too, so the one time Shane does
 * close it for something (e.g. reading a wide code block) it stays closed
 * on the next page, but a fresh browser/reinstall still starts open.
 */
function togglePanel(open) {
  const { panel, tab } = buildPanel();
  panel.hidden = !open;
  tab.style.display = open ? "none" : "block";
  void chrome.storage.local.set({ panelOpen: open });
  if (open) loadBoard(false);
}

async function initPanelVisibility() {
  const { panelOpen } = await chrome.storage.local.get("panelOpen");
  togglePanel(panelOpen !== false); // default OPEN unless Shane explicitly closed it last time
}

async function loadBoard(force) {
  const conversationId = conversationIdFromUrl();
  const { list } = buildPanel();
  await loadDismissed();

  const fresh = boardCache && Date.now() - boardCache.fetchedAt < BOARD_STALE_MS;
  if (!force && fresh) {
    render();
    return;
  }

  list.innerHTML = `<div class="empty">Loading…</div>`;
  const res = await chrome.runtime.sendMessage({ type: "build-tracker-get-board", conversationId });
  if (!res?.ok) {
    list.innerHTML = `<div class="empty">${escapeHtml(res?.error ?? "Couldn't load — check the extension's settings.")}</div>`;
    return;
  }

  boardCache = { data: res.board, fetchedAt: Date.now() };
  render();
}

/** GitHub issue numbers for whatever's actually on screen right now — the set quickRefresh() checks. */
function visibleIssueNumbers() {
  if (!boardCache) return [];
  const { currentChat, issues } = boardCache.data;
  const focusEpic = currentChat?.focusEpic;
  const source = focusEpic && !showAllOverride ? (currentChat.focusEpicOpenIssues ?? []) : issues;
  return Array.from(
    new Set(source.filter((i) => !isDismissed(i)).map((i) => i.githubNumber).filter((n) => typeof n === "number")),
  );
}

/**
 * The Refresh button (Git #693, sped up in #695) — checks GitHub for just
 * the issues currently visible in the panel, not the whole repo. Shane
 * flagged the original full-sync-on-every-click as slow, which it is: a
 * full sync pages through every issue in the repo to catch a label change
 * on two or three he's already looking at. This is the fast path for that
 * common case; "Full sync from GitHub" below is still there for when he
 * actually needs to discover something new.
 */
async function quickRefresh() {
  const { list } = buildPanel();
  const numbers = visibleIssueNumbers();
  if (numbers.length === 0) {
    await loadBoard(true);
    return;
  }

  list.innerHTML = `<div class="empty">Checking ${numbers.length} issue${numbers.length === 1 ? "" : "s"}…</div>`;
  const res = await chrome.runtime.sendMessage({ type: "build-tracker-quick-sync", issueNumbers: numbers });
  if (!res?.ok) {
    list.innerHTML = `<div class="empty">${escapeHtml(`Quick sync failed: ${res?.error ?? "unknown error"}`)}</div>`;
    return;
  }
  await loadBoard(true);
}

/**
 * "Full sync from GitHub" footer link — the original behavior from #693: a
 * real whole-repo pull, THEN a board reload. Needed to discover an epic/
 * issue/milestone Build Tracker doesn't know about yet at all — quickRefresh()
 * above only ever updates rows that already exist.
 */
async function fullSyncFromGithub() {
  const { list } = buildPanel();
  list.innerHTML = `<div class="empty">Full syncing from GitHub…</div>`;

  const syncRes = await chrome.runtime.sendMessage({ type: "build-tracker-sync-github" });
  if (!syncRes?.ok) {
    list.innerHTML = `<div class="empty">${escapeHtml(`Sync failed: ${syncRes?.error ?? "unknown error"}`)}</div>`;
    return;
  }
  await loadBoard(true);
}

/**
 * Dispatches between two very different views: a chat linked to an epic
 * shows ONLY that epic and its own open issues (plus the milestone it
 * belongs to, as a progress bar) — Shane's ask was explicit that seeing the
 * whole board once a chat already has a home is just noise. Search only
 * makes sense in the browse view, so it's hidden while focused.
 */
function render() {
  if (!boardCache) return;
  const { search, progress } = panelEls;
  const currentChat = boardCache.data.currentChat;
  const focusEpic = currentChat?.focusEpic ?? null;

  if (focusEpic && !showAllOverride) {
    search.style.display = "none";
    renderProgress(currentChat.focusMilestone);
    renderFocused(currentChat);
  } else {
    search.style.display = "";
    renderProgress(null);
    renderCurrent(currentChat, focusEpic);
    renderList(search.value);
  }
}

function renderProgress(milestone) {
  const { progress } = panelEls;
  if (!milestone) {
    progress.hidden = true;
    progress.innerHTML = "";
    return;
  }
  progress.hidden = false;
  const { done, total, pct } = milestone.progress;
  const color = pct >= 100 ? "#7fae91" : "#f2ca63";
  progress.innerHTML = `
    <div class="progress-label">
      <span>${escapeHtml(milestone.title)}</span>
      <span>${done}/${total} · ${pct}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color};"></div></div>
  `;
}

/** The linked-epic-only view — read-only (already linked, nothing to click). */
function renderFocused(currentChat) {
  const { current, list } = panelEls;
  const epic = currentChat.focusEpic;

  current.className = "current linked";
  current.innerHTML = `Linked to Epic: ${escapeHtml(epic.title)}<a href="#" class="showall">Show everything</a>`;
  current.querySelector(".showall").addEventListener("click", (e) => {
    e.preventDefault();
    showAllOverride = true;
    render();
  });

  list.innerHTML = "";
  const row = document.createElement("div");
  row.className = "epic-row";
  row.style.cursor = "default";
  row.innerHTML = `<span>${escapeHtml(epic.title)}</span>${epic.githubNumber ? `<span class="pill">#${epic.githubNumber}</span>` : ""}`;
  list.appendChild(row);

  const openIssues = (currentChat.focusEpicOpenIssues ?? []).filter((i) => !isDismissed(i));
  if (openIssues.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No open issues on this epic.";
    list.appendChild(empty);
  } else {
    for (const issue of openIssues) {
      list.appendChild(buildIssueRow(issue, null));
    }
  }
}

/** The full browse view's status line — same as before, plus a way back to a focused epic if one exists. */
function renderCurrent(currentChat, focusEpic) {
  const { current } = panelEls;
  if (currentChat && (currentChat.issueId || currentChat.epicId)) {
    current.className = "current linked";
    current.innerHTML = `Linked to: ${escapeHtml(currentChat.title)}`;
  } else {
    current.className = "current";
    current.textContent = "Not linked yet — click an item below.";
  }
  if (focusEpic) {
    current.innerHTML += `<a href="#" class="showall">Back to this chat's epic</a>`;
    current.querySelector(".showall").addEventListener("click", (e) => {
      e.preventDefault();
      showAllOverride = false;
      render();
    });
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
    if (isDismissed(issue)) continue;
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
        list.appendChild(buildIssueRow(issue, () => linkTo({ issueId: issue.id }, issue.title)));
      }
    }
  }

  if (filteredUnassigned.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = "No Epic";
    list.appendChild(h);
    for (const issue of filteredUnassigned) {
      const irow = buildIssueRow(issue, () => linkTo({ issueId: issue.id }, issue.title));
      irow.style.paddingLeft = "8px";
      list.appendChild(irow);
    }
  }
}

// ── Milestone → Epic → chat navigator (Git #697) ───────────────────────────
// Drill-down picker for jumping to a DIFFERENT chat's context, rather than
// the always-current-chat view the rest of the panel shows. `navMilestone`/
// `navEpic` track how deep we are; null/null means "list all milestones."

let navMilestone = null;
let navEpic = null;

function openNavigator() {
  const { navBackdrop } = buildPanel();
  navMilestone = null;
  navEpic = null;
  renderNavStep();
  navBackdrop.hidden = false;
}

function navBack() {
  if (navEpic) { navEpic = null; renderNavStep(); return; }
  if (navMilestone) { navMilestone = null; renderNavStep(); return; }
  panelEls.navBackdrop.hidden = true;
}

function renderNavStep() {
  const { navTitle, navBackBtn } = panelEls;
  navBackBtn.style.visibility = navMilestone || navEpic ? "visible" : "hidden";
  if (!boardCache) {
    navTitle.textContent = "Find a chat";
    panelEls.navBody.innerHTML = `<div class="empty">Loading…</div>`;
    return;
  }
  if (navEpic) {
    navTitle.textContent = navEpic.title;
    renderNavChats();
  } else if (navMilestone) {
    navTitle.textContent = navMilestone.title;
    renderNavEpics();
  } else {
    navTitle.textContent = "Find a chat — pick a Milestone";
    renderNavMilestones();
  }
}

function renderNavMilestones() {
  const { navBody } = panelEls;
  const { milestones, epics } = boardCache.data;
  navBody.innerHTML = "";

  for (const m of milestones) {
    const epicCount = epics.filter((e) => e.milestoneId === m.githubNumber).length;
    if (epicCount === 0) continue;
    const row = document.createElement("div");
    row.className = "epic-row";
    row.innerHTML = `<span>${escapeHtml(m.title)}</span><span class="pill">${epicCount} epic${epicCount === 1 ? "" : "s"} · ${m.progress.pct}%</span>`;
    row.addEventListener("click", () => { navMilestone = m; navEpic = null; renderNavStep(); });
    navBody.appendChild(row);
  }

  const unsorted = epics.filter((e) => e.milestoneId == null);
  if (unsorted.length > 0) {
    const row = document.createElement("div");
    row.className = "epic-row";
    row.innerHTML = `<span>Unsorted Epics</span><span class="pill">${unsorted.length}</span>`;
    row.addEventListener("click", () => { navMilestone = { title: "Unsorted Epics", githubNumber: null }; navEpic = null; renderNavStep(); });
    navBody.appendChild(row);
  }

  if (!navBody.firstChild) navBody.innerHTML = `<div class="empty">No open milestones with epics.</div>`;
}

function renderNavEpics() {
  const { navBody } = panelEls;
  const { epics, chats } = boardCache.data;
  const list = epics.filter((e) => e.milestoneId === navMilestone.githubNumber);
  navBody.innerHTML = "";
  if (list.length === 0) {
    navBody.innerHTML = `<div class="empty">No open epics in this milestone.</div>`;
    return;
  }
  for (const epic of list) {
    const chatCount = chats.filter((c) => c.epicId === epic.id).length;
    const row = document.createElement("div");
    row.className = "epic-row";
    row.innerHTML = `<span>${escapeHtml(epic.title)}</span><span class="pill">${epic.githubNumber ? `#${epic.githubNumber} · ` : ""}${chatCount} chat${chatCount === 1 ? "" : "s"}</span>`;
    row.addEventListener("click", () => { navEpic = epic; renderNavStep(); });
    navBody.appendChild(row);
  }
}

/** Clicking a chat here navigates the TAB there (location.href) — a real chat switch, not a link-the-current-chat action like the rest of the panel does. */
function renderNavChats() {
  const { navBody } = panelEls;
  const { chats } = boardCache.data;
  const conversationId = conversationIdFromUrl();
  const linked = chats
    .filter((c) => c.epicId === navEpic.id)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  navBody.innerHTML = "";
  if (linked.length === 0) {
    navBody.innerHTML = `<div class="empty">No chats linked to this epic yet.</div>`;
    return;
  }
  for (const chat of linked) {
    const isCurrent = chat.conversationId === conversationId;
    const row = document.createElement("div");
    row.className = "epic-row";
    row.style.cursor = isCurrent ? "default" : "pointer";
    row.innerHTML = `<span>${escapeHtml(chat.title)}</span><span class="pill">${isCurrent ? "current chat" : "→"}</span>`;
    if (!isCurrent) {
      row.addEventListener("click", () => { location.href = chat.claudeUrl; });
    }
    navBody.appendChild(row);
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
    // Drop back to the focused view for whatever just got linked, rather than
    // staying on "Show everything" after the whole point was to link it.
    showAllOverride = false;
    void loadBoard(true);
  } else {
    current.textContent = `Couldn't link: ${res?.error ?? "unknown error"}`;
    current.classList.remove("linked");
  }
}

function onConversationChanged() {
  showAllOverride = false;
  if (!panelEls || panelEls.panel.hidden) return;
  loadBoard(true);
}

/** `complete` wins over `in-flight` if a row somehow carries both (stale sync mid-transition). */
function issueLabelState(issue) {
  const labels = issue.labels ?? [];
  if (labels.includes("complete")) return "complete";
  if (labels.includes("in-flight")) return "in-flight";
  return null;
}

/**
 * One issue row, shared by the focused view and the full browse tree so the
 * in-flight dot / complete tint (and the two action buttons) can't drift
 * between the two places an issue shows up. `onClick` omitted (focused view)
 * means the row itself would otherwise be read-only — nothing to link, it's
 * already linked — EXCEPT a `complete`-labeled row, which becomes a single
 * big "tell Claude this landed" click target instead of doing nothing: the
 * whole point of showing it green is that there's now exactly one useful
 * thing left to do with it, so clicking the row itself does it (Shane: "I
 * should be able to just click that topic"). The Details/Prompt buttons
 * still work regardless, and still stopPropagation so they never also
 * trigger whatever the row itself does.
 */
function buildIssueRow(issue, onClick) {
  const irow = document.createElement("div");
  const labelState = issueLabelState(issue);
  const isComplete = labelState === "complete";
  irow.className = "issue-row" + (isComplete ? " label-complete" : "");
  const rowClick = onClick ?? (isComplete ? () => insertPrompt(issue) : null);
  if (!rowClick) irow.style.cursor = "default";
  else irow.addEventListener("click", rowClick);

  const top = document.createElement("div");
  top.className = "issue-top";

  const text = document.createElement("span");
  text.className = "issue-text";
  text.textContent = `${issue.githubNumber ? `#${issue.githubNumber} ` : ""}${issue.title}`;
  top.appendChild(text);

  if (labelState === "in-flight") {
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.title = "Claude Code is actively working on this";
    top.appendChild(dot);
  } else if (isComplete) {
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    check.title = "Confirmed done in code — click to tell Claude it landed";
    top.appendChild(check);
  }
  irow.appendChild(top);

  const actions = document.createElement("div");
  actions.className = "issue-actions";

  const detailsBtn = document.createElement("button");
  detailsBtn.type = "button";
  detailsBtn.className = "ibtn";
  detailsBtn.title = "View summary";
  detailsBtn.textContent = "ⓘ";
  detailsBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // don't also trigger the row's own click
    openDetails(issue);
  });
  actions.appendChild(detailsBtn);

  if (issue.githubNumber) {
    const promptBtn = document.createElement("button");
    promptBtn.type = "button";
    promptBtn.className = "ibtn";
    promptBtn.title = isComplete
      ? `Tell Claude "${issue.githubNumber} landed" (inserted, you press Enter)`
      : "Insert a prompt for this issue into the chat box (you send it)";
    promptBtn.textContent = "➜";
    promptBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      insertPrompt(issue);
    });
    actions.appendChild(promptBtn);
  }

  // Only a `complete` row gets a dismiss button — nothing removes a still-open
  // row, since there's nothing to "clean up" until the work is actually done.
  // Multiple builds running at once meant these piled up with no way to clear
  // them (Shane: "sometimes they get left behind when doing multiple at a time").
  if (isComplete) {
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ibtn";
    dismissBtn.title = "Dismiss — hide this from the panel";
    dismissBtn.textContent = "✕";
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void dismissIssue(issue);
    });
    actions.appendChild(dismissBtn);
  }

  irow.appendChild(actions);
  return irow;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Build the panel shell once on load, then open it by default (see
// togglePanel's doc comment) — unlike before, this now does hit the API
// immediately rather than waiting for a click, since "open by default" only
// works if it's actually showing real data.
buildPanel();
void initPanelVisibility();

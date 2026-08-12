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

/**
 * Every chrome.runtime.sendMessage() call in this file expects an
 * {ok, ...} result back from background.js — but if the background
 * service worker gets suspended/restarted, or a long-running call (a slow
 * SQL query, a multi-minute pnpm build via the Deploy Console) outlives it,
 * the message channel can close before any response arrives. That surfaces
 * as an UNCAUGHT promise rejection ("the message channel closed before a
 * response was received"), a different failure shape than the {ok:false}
 * result every caller here already handles. This wrapper folds that
 * rejection into the same {ok:false, error} shape so nothing has to special-
 * case it — always use this instead of calling chrome.runtime.sendMessage
 * directly.
 */
async function sendMessageSafe(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    return { ok: false, error: `Extension messaging failed: ${err?.message ?? String(err)}` };
  }
}

const CONVERSATION_ID_RE = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
/** Query param carrying openNewEpicChat()'s prefill text through to a fresh tab — see tryInsertPrefillFromUrl(). */
const EPIC_CHAT_PREFILL_PARAM = "bt_prefill";
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
    sendMessageSafe({ type: "build-tracker-ingest", conversationId, title });
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
/** An epic manually opened via the 📚 Browse Epics button — reset on any real chat switch (onConversationChanged). Takes priority over the current chat's own linked epic while set. */
let manualEpicView = null;

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
    /* Git #722 follow-up — a SEPARATE floaty panel for in-flight work,
       docked at the left edge: Shane collapses claude.ai's own left-side
       chat list and wants that freed space filled with "what's actively
       building right now" instead of having to open the main panel. */
    .ip-tab {
      position: fixed; top: 50%; left: 0; transform: translateY(-50%);
      writing-mode: vertical-rl; padding: 10px 6px; border-radius: 0 8px 8px 0;
      background: #3fb950; color: #0d1b0f; font-size: 11.5px; font-weight: 700;
      letter-spacing: .04em; cursor: pointer; box-shadow: 2px 0 8px rgba(0,0,0,.3);
      user-select: none;
    }
    .ip-panel {
      position: fixed; top: 40px; left: 0; bottom: 40px; width: 260px;
      background: #1f1f1f; border-right: 1px solid #3b3b3b; box-shadow: 4px 0 16px rgba(0,0,0,.4);
      display: flex; flex-direction: column; color: #f3f2f1;
    }
    .ip-panel[hidden] { display: none; }
    .ip-header {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid #2e2e2e; font-size: 12.5px; font-weight: 700; flex: none;
    }
    .ip-header .title { flex: 1; color: #7fdb8f; }
    .ip-list { flex: 1; overflow-y: auto; padding: 8px; }
    .header {
      display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
      border-bottom: 1px solid #2e2e2e; font-size: 12.5px; font-weight: 700; flex: none;
    }
    .header-top { display: flex; align-items: center; gap: 8px; }
    .header-top .title { flex: 1; }
    .header-toolbar { display: flex; align-items: center; gap: 4px; }
    .sync-indicator { font-size: 10.5px; font-weight: 600; color: #7fb4d8; flex: none; }
    .sync-indicator[hidden] { display: none; }
    .iconbtn {
      background: transparent; border: 0; color: #a19f9d; cursor: pointer;
      font-size: 13px; padding: 2px 6px; border-radius: 4px;
    }
    .iconbtn:hover { background: #292929; color: #fff; }
    .iconbtn:disabled { opacity: .45; cursor: default; }
    .iconbtn:disabled:hover { background: transparent; color: #a19f9d; }
    .iconbtn.spinning { animation: bt-spin 0.8s linear infinite; }
    @keyframes bt-spin { to { transform: rotate(360deg); } }
    .progress { padding: 10px 12px 4px; flex: none; }
    .progress[hidden] { display: none; }
    .progress-label {
      display: flex; justify-content: space-between; font-size: 11px; color: #c8c6c4;
      margin-bottom: 5px; font-weight: 600;
    }
    .progress-bar { height: 6px; border-radius: 3px; background: #292929; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 200ms ease; }
    .progress-note { font-size: 10px; color: #8f8c88; margin-top: 5px; }
    .progress-siblings { display: block; font-size: 10.5px; color: #7fb4d8; margin-top: 4px; text-decoration: none; font-weight: 600; }
    .progress-siblings:hover { text-decoration: underline; }
    /* Git #699 — a closed epic that still has open work underneath it, so it
       would otherwise be invisible everywhere else in the panel. Shown
       regardless of which chat/epic is currently in focus — this is the
       "you might have closed something you shouldn't have" flag. */
    /* Undo toast (Shane: "I'm OK with undo right now") — a real close is
       now one un-gated click, so a stray click needs a fast way back. */
    .undo-toast {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 7px 12px; background: rgba(127,174,145,.18); border-bottom: 1px solid rgba(127,174,145,.35);
      font-size: 11.5px; color: #dff2e6; flex: none;
    }
    .undo-toast[hidden] { display: none; }
    .undo-toast button {
      background: transparent; border: 1px solid rgba(127,174,145,.5); color: #dff2e6;
      border-radius: 4px; padding: 2px 10px; font-size: 11px; font-weight: 700; cursor: pointer; flex: none;
    }
    .undo-toast button:hover { background: rgba(127,174,145,.28); }
    .alerts { padding: 8px 12px; background: rgba(224,108,90,.14); border-bottom: 1px solid rgba(224,108,90,.3); flex: none; }
    .alerts[hidden] { display: none; }
    .alert-title { font-size: 11px; font-weight: 700; color: #e8a08f; margin-bottom: 4px; }
    .alert-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #f0c9bf; padding: 2px 0; }
    .alert-row-text { flex: 1; }
    .alert-row-text:hover { text-decoration: underline; }
    .alert-resync {
      flex: none; width: 20px; height: 18px; border-radius: 4px; border: 0; background: transparent;
      color: #f0c9bf; cursor: pointer; font-size: 12px; padding: 0;
    }
    .alert-resync:hover { background: rgba(224,108,90,.25); }
    .alert-resync:disabled { opacity: .5; cursor: default; }
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
    /* Same green treatment for an epic row in the In Progress panel — Git
       #723 follow-up: a complete-labeled epic should stay visible (just
       highlighted), not disappear until actually closed. */
    .epic-row.label-complete { background: rgba(127,174,145,.16); border: 1px solid rgba(127,174,145,.35); }
    .epic-row.label-complete:hover { background: rgba(127,174,145,.26); }
    /* Git #770 — Shane: "if there are more than one Epic listed... highlight
       the Epic of the chat that is currently loaded." A left accent bar
       (rather than a background tint) so it reads as "this one" even when
       label-complete's green tint also applies to the same row. */
    .epic-row.current-chat-epic { border-left: 3px solid #0f6cbd; padding-left: 5px; }
    /* Git #784 — Shane: "put a red blocked box around it... when the block
       is removed, make it a different color so I know I can go start it
       again." A wrapper around the row + its "blocked by" note, not a class
       on the row itself, since the note needs its own line underneath. */
    .blocked-wrap {
      border: 1px solid rgba(229,122,122,.5); border-radius: 6px; margin: 4px 0 4px 0;
      background: rgba(229,122,122,.08);
    }
    .blocked-wrap.nested { margin-left: 18px; }
    .blocked-wrap .epic-row, .blocked-wrap .issue-row { margin: 0; border: none; background: transparent; }
    .blocked-note {
      padding: 3px 9px 6px; font-size: 11px; color: #e5a3a3; display: flex;
      align-items: center; justify-content: space-between; gap: 6px;
    }
    /* The moment a block clears — a distinct blue/purple so it visually
       reads as "different" from both the red it just was and the plain
       amber in-flight dot, specifically so Shane notices it changed. */
    .just-unblocked-wrap {
      border: 1px solid rgba(167,139,250,.55); border-radius: 6px; margin: 4px 0 4px 0;
      background: rgba(167,139,250,.12);
    }
    .just-unblocked-wrap .epic-row, .just-unblocked-wrap .issue-row { margin: 0; border: none; background: transparent; }
    .just-unblocked-note {
      padding: 3px 9px 6px; font-size: 11px; color: #c9b8fb; display: flex;
      align-items: center; justify-content: space-between; gap: 6px;
    }
    .just-unblocked-note button, .blocked-note button {
      background: none; border: 1px solid currentColor; border-radius: 4px; color: inherit;
      font-size: 10px; padding: 1px 6px; cursor: pointer; flex: none;
    }
    /* Git #790 — queued-build rows, same issue-row shape with a status-colored left accent so queued/running/done/failed read apart at a glance. */
    .queue-item-meta { font-size: 11px; color: #a19f9d; }
    .queue-item-row.queue-status-queued  { border-left: 3px solid #8f8c88; }
    .queue-item-row.queue-status-running { border-left: 3px solid #f2ca63; }
    .queue-item-row.queue-status-done    { border-left: 3px solid #7fae91; opacity: .75; }
    .queue-item-row.queue-status-failed  { border-left: 3px solid #e57a7a; }
    .queue-item-row.queue-status-canceled { border-left: 3px solid #5a5856; opacity: .6; }
    /* Git #798 — a queued item nested under the queued item that blocks it.
       .issue-row's own base margin-left is 16px; this needs to visibly
       clear that, not just tie with it. */
    .queue-item-row.nested-queue-item { margin-left: 34px; }
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

    /* Git #716 follow-up — the #N hover card. pointer-events: none so it
       never itself becomes a hover target (no flicker fighting the
       underlined span it's anchored to). */
    .issue-tooltip {
      position: fixed; z-index: 2147483647; max-width: 300px;
      background: #1f1f1f; border: 1px solid #3b3b3b; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 9px 11px;
      font-size: 12px; color: #d6d4d2; line-height: 1.4;
    }
    .issue-tooltip[hidden] { display: none; }
    .issue-tooltip .tt-title { font-weight: 700; color: #fff; margin-bottom: 3px; }
    .issue-tooltip .tt-meta { font-size: 10.5px; color: #8f8c88; text-transform: uppercase; letter-spacing: .03em; }
    .issue-tooltip .tt-meta.closed { color: #7fae91; }
    .issue-tooltip .tt-actions { display: flex; gap: 6px; margin-top: 7px; }
    .issue-tooltip .tt-btn {
      flex: 1; padding: 4px 8px; border-radius: 5px; border: 1px solid #3b3b3b;
      background: #292929; color: #f3f2f1; font-size: 11px; font-weight: 600; cursor: pointer;
    }
    .issue-tooltip .tt-btn:hover { background: #333; }
    .issue-tooltip .tt-btn:disabled { opacity: .5; cursor: default; }

    /* Git #702 — SQL Runner / Deploy Console. Wider than the details dialog
       since query text and command output both need real room. */
    .dlg-wide { width: 640px; max-height: 80vh; }
    .tool-chat-toggle {
      display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
      color: #a19f9d; flex: none; cursor: pointer; user-select: none;
    }
    .tool-chat-toggle input { margin: 0; cursor: pointer; }
    .tool-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 16px; overflow: hidden; flex: 1; min-height: 0; }
    .tool-input {
      width: 100%; min-height: 70px; resize: vertical; font-family: ui-monospace, Consolas, monospace;
      font-size: 12px; background: #141414; color: #e6e6e6; border: 1px solid #3b3b3b; border-radius: 6px;
      padding: 8px; box-sizing: border-box;
    }
    .tool-run {
      align-self: flex-start; padding: 6px 16px; border-radius: 6px; border: 1px solid #3b3b3b;
      background: #292929; color: #f3f2f1; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .tool-run:hover { background: #333; }
    .tool-output {
      flex: 1; min-height: 120px; overflow: auto; background: #141414; border: 1px solid #2e2e2e;
      border-radius: 6px; padding: 8px; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
      color: #c8c6c4; white-space: pre-wrap; margin: 0;
    }
    .tool-ops { display: flex; flex-wrap: wrap; gap: 6px; flex: none; }
    .tool-op-btn {
      padding: 4px 10px; border-radius: 12px; border: 1px solid #3b3b3b; background: #242424;
      color: #c8c6c4; font-size: 11px; cursor: pointer;
    }
    .tool-op-btn:hover { background: #2e2e2e; }
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
      <div class="header-top">
        <span class="title">What am I working on?</span>
        <span class="sync-indicator" hidden>Syncing…</span>
        <button class="iconbtn" data-action="close" title="Close">✕</button>
      </div>
      <div class="header-toolbar">
        <button class="iconbtn" data-action="copy-last" title="Copy Claude's last code block (the panel sits over its own copy button)">📋</button>
        <button class="iconbtn" data-action="navigate" title="Find another chat — browse Milestone → Epic → chat">🧭</button>
        <button class="iconbtn" data-action="browse-epics" title="Browse all Epics — view one's details right here">📚</button>
        <button class="iconbtn" data-action="sql" title="SQL Runner (dev server)">🗄</button>
        <button class="iconbtn" data-action="console" title="Deploy Console (dev server)">💻</button>
        <button class="iconbtn" data-action="refresh" title="Sync — the whole epic when one's in focus, otherwise just the issues on screen">⟳</button>
      </div>
    </div>
    <div class="undo-toast" hidden></div>
    <div class="alerts" hidden></div>
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
  for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
    navBackdrop.addEventListener(evt, (e) => {
      e.stopPropagation();
      if (evt === "keydown" && e.key === "Escape") closeNavigator();
    });
  }

  // Shane: "we have a button... to show me the list of Milestones [🧭] —
  // add me the same type of button to see the list of Epics. Then clicking
  // an Epic loads it and its details into the right panel." A flat list,
  // no milestone step first, and picking one shows its details in the MAIN
  // panel (reusing the same layout the focused-on-a-linked-chat view
  // already uses) instead of drilling toward a chat like the navigator
  // does — a separate, simpler modal rather than overloading the
  // navigator's own milestone/epic/chat state machine with a second
  // purpose.
  const epicsBackdrop = document.createElement("div");
  epicsBackdrop.className = "dlg-backdrop";
  epicsBackdrop.hidden = true;
  epicsBackdrop.innerHTML = `
    <div class="dlg" role="dialog" aria-label="Browse Epics">
      <div class="dlg-header">
        <span class="dlg-title">Browse Epics</span>
        <button class="iconbtn" data-action="epics-close" title="Close">✕</button>
      </div>
      <input class="search" style="margin: 0 16px 8px;" placeholder="Search epics…" />
      <div class="dlg-body epics-body" style="padding-top: 0;"></div>
    </div>
  `;
  shadow.appendChild(epicsBackdrop);

  const epicsSearch = epicsBackdrop.querySelector(".search");
  const epicsBody = epicsBackdrop.querySelector(".epics-body");
  const closeEpicsBrowser = () => { epicsBackdrop.hidden = true; };
  epicsBackdrop.querySelector('[data-action="epics-close"]').addEventListener("click", closeEpicsBrowser);
  epicsBackdrop.addEventListener("click", (e) => { if (e.target === epicsBackdrop) closeEpicsBrowser(); });
  epicsSearch.addEventListener("input", () => renderEpicsBrowserList(epicsSearch.value));
  for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
    epicsBackdrop.addEventListener(evt, (e) => {
      e.stopPropagation();
      if (evt === "keydown" && e.key === "Escape") closeEpicsBrowser();
    });
  }

  // Git #702 — floaty SQL Runner + Deploy Console, both reusing EXISTING
  // admin routes (see background.js's runSql()/runDeploy() doc comment).
  // Full read/write, no restrictions — Shane's explicit choice for his own
  // dev server, after being walked through the risk. The "arm, then
  // confirm" pattern on Run buttons here is a lightweight speedbump against
  // a stray click, not a real gate — there is no query/command it blocks.
  const sqlBackdrop = document.createElement("div");
  sqlBackdrop.className = "dlg-backdrop";
  sqlBackdrop.hidden = true;
  sqlBackdrop.innerHTML = `
    <div class="dlg dlg-wide" role="dialog" aria-label="SQL Runner">
      <div class="dlg-header">
        <span class="dlg-title">🗄 SQL Runner — dev server</span>
        <label class="tool-chat-toggle"><input type="checkbox" data-action="sql-chat-toggle" checked /> Send to chat</label>
        <button class="iconbtn" data-action="sql-close" title="Close">✕</button>
      </div>
      <div class="tool-body">
        <textarea class="tool-input" placeholder="SELECT * FROM bt_epics LIMIT 20;" spellcheck="false"></textarea>
        <button type="button" class="tool-run" data-action="sql-run">Run</button>
        <pre class="tool-output">Results appear here.</pre>
      </div>
    </div>
  `;
  shadow.appendChild(sqlBackdrop);

  const consoleBackdrop = document.createElement("div");
  consoleBackdrop.className = "dlg-backdrop";
  consoleBackdrop.hidden = true;
  consoleBackdrop.innerHTML = `
    <div class="dlg dlg-wide" role="dialog" aria-label="Deploy Console">
      <div class="dlg-header">
        <span class="dlg-title">💻 Deploy Console — dev server</span>
        <label class="tool-chat-toggle"><input type="checkbox" data-action="console-chat-toggle" checked /> Send to chat</label>
        <button class="iconbtn" data-action="console-close" title="Close">✕</button>
      </div>
      <div class="tool-body">
        <div class="tool-ops">Loading operations…</div>
        <textarea class="tool-input" placeholder="Or type any shell command…" spellcheck="false"></textarea>
        <button type="button" class="tool-run" data-action="console-run">Run</button>
        <pre class="tool-output">Output appears here.</pre>
      </div>
    </div>
  `;
  shadow.appendChild(consoleBackdrop);

  for (const [backdrop, closeAction] of [[sqlBackdrop, "sql-close"], [consoleBackdrop, "console-close"]]) {
    const close = () => { backdrop.hidden = true; };
    backdrop.querySelector(`[data-action="${closeAction}"]`).addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
      backdrop.addEventListener(evt, (e) => {
        e.stopPropagation();
        if (evt === "keydown" && e.key === "Escape") close();
      });
    }
  }

  // Git #716 follow-up — hover card for any #N Claude mentions in a chat
  // message. Lives in this same shadow root (isolated from claude.ai's own
  // styles, consistent with every other floating element here), but the
  // underlined #N spans themselves get injected directly into claude.ai's
  // own message DOM (outside this shadow root) — see scanForIssueRefs().
  const issueTooltip = document.createElement("div");
  issueTooltip.className = "issue-tooltip";
  issueTooltip.hidden = true;
  // Now interactive (Close/Reopen + Ask Claude buttons) — moving the
  // pointer from the underlined span onto the card itself must not
  // dismiss it, same debounced-hide dance as everywhere else in this file.
  issueTooltip.addEventListener("mouseenter", () => clearTimeout(tooltipHideTimer));
  issueTooltip.addEventListener("mouseleave", onIssueRefUnhover);
  shadow.appendChild(issueTooltip);

  // Git #722 follow-up — a second, independent floaty panel for in-flight
  // work, docked at the LEFT edge (Shane: "I collapse the Claude chat so
  // that entire space is open"). Own toggle tab, own open/closed
  // persistence, own render pass — deliberately not folded into the main
  // right-docked panel, so both can be open side by side.
  const ipTab = document.createElement("div");
  ipTab.className = "ip-tab";
  ipTab.textContent = "IN PROGRESS";
  shadow.appendChild(ipTab);

  const ipPanel = document.createElement("div");
  ipPanel.className = "ip-panel";
  ipPanel.hidden = true;
  ipPanel.innerHTML = `
    <div class="ip-header">
      <span class="title">🟢 In Progress</span>
      <button class="iconbtn" data-action="ip-close" title="Close">✕</button>
    </div>
    <div class="ip-list"></div>
  `;
  shadow.appendChild(ipPanel);
  const ipList = ipPanel.querySelector(".ip-list");
  ipTab.addEventListener("click", () => toggleInProgressPanel(true));
  ipPanel.querySelector('[data-action="ip-close"]').addEventListener("click", () => toggleInProgressPanel(false));
  for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
    ipPanel.addEventListener(evt, (e) => e.stopPropagation());
  }

  const dlgTitle = dlgBackdrop.querySelector(".dlg-title");
  const dlgStatus = dlgBackdrop.querySelector(".dlg-status");
  const dlgBody = dlgBackdrop.querySelector(".dlg-body");
  const dlgExpand = dlgBackdrop.querySelector(".dlg-expand");

  const closeDetails = () => { dlgBackdrop.hidden = true; };
  dlgBackdrop.querySelector('[data-action="dlg-close"]').addEventListener("click", closeDetails);
  // Click the dimmed backdrop (not the dialog box itself) to dismiss.
  dlgBackdrop.addEventListener("click", (e) => { if (e.target === dlgBackdrop) closeDetails(); });
  for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
    dlgBackdrop.addEventListener(evt, (e) => {
      e.stopPropagation();
      if (evt === "keydown" && e.key === "Escape") closeDetails();
    });
  }

  const undoToast = panel.querySelector(".undo-toast");
  const alertsEl = panel.querySelector(".alerts");
  const progress = panel.querySelector(".progress");
  const current = panel.querySelector(".current");
  const list = panel.querySelector(".list");
  const search = panel.querySelector(".search");
  const refreshBtn = panel.querySelector('[data-action="refresh"]');
  const syncIndicator = panel.querySelector(".sync-indicator");

  tab.addEventListener("click", () => togglePanel(true));
  panel.querySelector('[data-action="close"]').addEventListener("click", () => togglePanel(false));
  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => void quickRefresh());
  panel.querySelector('[data-action="full-sync"]').addEventListener("click", () => void fullSyncFromGithub());
  panel.querySelector('[data-action="copy-last"]').addEventListener("click", () => void copyLastCodeBlock());
  panel.querySelector('[data-action="navigate"]').addEventListener("click", () => openNavigator());
  panel.querySelector('[data-action="browse-epics"]').addEventListener("click", () => openEpicsBrowser());
  panel.querySelector('[data-action="sql"]').addEventListener("click", () => openSqlRunner());
  panel.querySelector('[data-action="console"]').addEventListener("click", () => openDeployConsole());
  // Git #700 — search now works in BOTH views (render() itself decides
  // which render*() to call), so this can't call renderList() directly
  // anymore or typing while focused on an epic would silently do nothing.
  search.addEventListener("input", () => render());

  // claude.ai listens for keystrokes (and, separately, paste — Git #738
  // follow-up: Shane pasting into the floaty SQL Runner landed in the
  // claude.ai composer instead, because "paste" was missing from this list
  // entirely; keydown/keyup/keypress alone don't cover it, it's its own
  // event) on the document to auto-focus its own chat composer ("type
  // anywhere to start typing") — these events are composed, so they bubble
  // straight out of this shadow root to that listener same as any other DOM
  // event, and every keystroke/paste in one of our own inputs was getting
  // redirected into claude.ai's own composer instead. Stopping propagation
  // here (on the panel, so it covers every field inside it, not just one)
  // keeps everything typed or pasted inside the panel local to it.
  for (const evt of ["keydown", "keyup", "keypress", "paste"]) {
    panel.addEventListener(evt, (e) => e.stopPropagation());
  }

  panelEls = {
    host, tab, panel, undoToast, alertsEl, progress, current, list, search,
    refreshBtn, syncIndicator,
    dlgBackdrop, dlgTitle, dlgStatus, dlgBody, dlgExpand,
    navBackdrop, navTitle, navBody, navBackBtn,
    sqlBackdrop, consoleBackdrop,
    issueTooltip,
    ipTab, ipPanel, ipList,
    epicsBackdrop, epicsSearch, epicsBody,
  };
  wireSqlRunner();
  wireDeployConsole();
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
  // Trailing space (Git #760, Shane) — so clicking several of these buttons
  // in a row in the left In Progress panel lands as "759 landed 758 landed"
  // instead of them running together with no separator.
  if (issueLabelState(issue) === "complete") return `${issue.githubNumber} landed `;
  return `Let's look at Git #${issue.githubNumber}... `;
}

/**
 * Inserts (never sends — Shane's explicit ask, so it never reads as a bot
 * talking to Claude) text into the composer, positioned at the end of
 * whatever's already typed there. Uses execCommand('insertText') because
 * that's what produces a real native `input` event with inputType
 * "insertText" — the same shape a real keystroke produces, which is what
 * makes React/ProseMirror-style editors (claude.ai's composer is one)
 * actually pick up the change instead of silently ignoring a plain
 * textContent write. Falls back to a manual insert + dispatched InputEvent
 * for the rare case execCommand is unsupported. Shared by the issue-prompt
 * buttons AND the SQL Runner/Deploy Console (Git #702 follow-up) — same
 * "land it in the chat, don't make me copy/paste" need either way.
 */
function insertTextIntoComposer(text) {
  const composer = findComposer();
  if (!composer) {
    window.alert("Couldn't find the chat box on this page — claude.ai's layout may have changed.");
    return false;
  }

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
  return true;
}

/**
 * Git #772 — Shane: "can the add-on manipulate the name of the chat? I
 * currently manually rename them to the Git ID of the Epic they are
 * working on." Clicking claude.ai's own title button (`aria-label` ends in
 * ", rename chat") swaps it for a real `<input data-testid="name-chat">` —
 * confirmed directly from Shane's own DevTools inspection (Git #775
 * follow-up: the FIRST attempt's generic container-scoped search never
 * found it, and console commands kept losing it because switching focus to
 * DevTools itself blurs — and apparently discards — the field, so this had
 * to be nailed down via a `setTimeout` + `document.activeElement` capture
 * instead of a live inspect). Searched document-wide rather than scoped to
 * the trigger button's own container, in case it renders as a sibling/
 * portal rather than a true child.
 */
async function renameCurrentChat(newTitle) {
  const container = document.querySelector('[data-testid="chat-title-split"]');
  const renameBtn = container?.querySelector('button[aria-label$=", rename chat"]');
  if (!renameBtn) return false;
  renameBtn.click();

  let field = null;
  for (let i = 0; i < 10 && !field; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    field = document.querySelector('input[data-testid="name-chat"]')
      ?? container.querySelector('input, textarea, [contenteditable="true"]');
  }
  if (!field) return false;

  if (field.tagName === "INPUT" || field.tagName === "TEXTAREA") {
    // Native setter, not field.value = ... — React tracks its own value via
    // the prototype setter, so a plain assignment doesn't trigger its change
    // handler (same reasoning as insertTextIntoComposer's execCommand use).
    const proto = field.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(field, newTitle);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    field.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, newTitle);
  }
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  return true;
}

function insertPrompt(issue) {
  insertTextIntoComposer(issuePromptText(issue));
}

/**
 * A `complete`-labeled row's click (Git #714 follow-up) — Shane: "this is
 * replacing that manual step in GitHub... when I close it in this, that IS
 * me closing it." So this is a real close, not just cosmetic: PATCHes the
 * real GitHub issue to closed (via the existing /issues/:id route, which
 * already pushes state to GitHub + Projects for the admin panel's own
 * editing UI), THEN still inserts the "N landed" text same as before — the
 * two aren't mutually exclusive, telling Claude it landed is still useful
 * context even though the close itself no longer needs a manual GitHub trip.
 */
async function closeIssueAndAnnounce(issue) {
  insertTextIntoComposer(issuePromptText(issue));
  if (issue.id == null) return;
  setSyncing(true);
  try {
    const res = await sendMessageSafe({ type: "build-tracker-close-issue", issueId: issue.id });
    if (!res?.ok) {
      console.warn("[Build Tracker] failed to close issue on GitHub:", res?.error);
      return;
    }
    showUndoToast(issue);
    await loadBoard(true, true); // quiet — the now-closed issue drops out of every open-work list on its own
  } finally {
    setSyncing(false);
  }
}

let undoToastTimer = null;

/** Shane: "I'm OK with undo right now" — a real close is now a single un-gated click (Git #715), so a stray click needs a fast way back. Self-dismisses; doesn't slow the close itself down. */
function showUndoToast(issue) {
  const { undoToast } = panelEls;
  clearTimeout(undoToastTimer);
  undoToast.hidden = false;
  undoToast.innerHTML = `<span>Closed ${issue.githubNumber ? `#${issue.githubNumber}` : "issue"}</span>`;
  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.textContent = "Undo";
  undoBtn.addEventListener("click", () => {
    clearTimeout(undoToastTimer);
    undoToast.hidden = true;
    void reopenIssue(issue);
  });
  undoToast.appendChild(undoBtn);
  undoToastTimer = setTimeout(() => { undoToast.hidden = true; }, 8000);
}

async function reopenIssue(issue) {
  if (issue.id == null) return;
  setSyncing(true);
  try {
    const res = await sendMessageSafe({ type: "build-tracker-reopen-issue", issueId: issue.id });
    if (!res?.ok) {
      window.alert(`Couldn't reopen #${issue.githubNumber}: ${res?.error ?? "unknown error"}`);
      return;
    }
    await loadBoard(true, true);
  } finally {
    setSyncing(false);
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
  syncPollingState();
}

async function initPanelVisibility() {
  const { panelOpen } = await chrome.storage.local.get("panelOpen");
  togglePanel(panelOpen !== false); // default OPEN unless Shane explicitly closed it last time
}

/**
 * The left-docked In Progress panel — own open/closed persistence, same
 * default-open reasoning as the main panel, and deliberately usable
 * independently of it: Shane's whole point is freeing up screen space by
 * collapsing things, so this shouldn't require the main (right-docked)
 * panel to also be open just to see what's building.
 */
function toggleInProgressPanel(open) {
  const { ipPanel, ipTab } = buildPanel();
  ipPanel.hidden = !open;
  ipTab.style.display = open ? "none" : "block";
  void chrome.storage.local.set({ inProgressPanelOpen: open });
  if (open) { void loadInProgress(false); void loadQueue(false); }
  syncPollingState();
}

async function initInProgressVisibility() {
  const { inProgressPanelOpen } = await chrome.storage.local.get("inProgressPanelOpen");
  toggleInProgressPanel(inProgressPanelOpen !== false);
}

/** Either floaty panel being open is enough to justify background polling — see pollingBlocked(). */
function anyPanelOpen() {
  return !!panelEls && (!panelEls.panel.hidden || !panelEls.ipPanel.hidden);
}

function syncPollingState() {
  if (anyPanelOpen()) startPolling();
  else stopPolling();
}

/**
 * Git #723 follow-up — Shane: "The In Progress panel should show me
 * everything in progress not just what Epic chat I am currently looking
 * at." Sourced straight from GitHub's `in-flight` label repo-wide (the
 * /extension/in-progress endpoint), completely independent of boardCache
 * — this session's syncs have all been targeted (one epic, one issue at a
 * time), so other concurrent sessions' in-flight work was never pulled
 * into the local DB at all and would've been invisible if this still read
 * from there. Cached with its own staleness window, same shape as
 * loadBoard()'s.
 */
let inProgressCache = null; // { issues, fetchedAt }
const IN_PROGRESS_STALE_MS = 20_000; // roughly matches the 15s poll cadence below

/**
 * Git #784 — Shane: "when the block is removed, make it a different color
 * so I know I can go start it again." Detecting THAT transition (was
 * blocked, now isn't) needs a memory of the previous poll's blocked set,
 * not just the current one. In-memory only — resets on a page reload,
 * same tradeoff as every other "just noticed" signal in this file.
 */
let previousBlockedNumbers = new Set();
/** githubNumbers flagged "just unblocked" until Shane clicks the ✓ to acknowledge — see renderInProgressList(). */
let recentlyUnblockedNumbers = new Set();

/**
 * Deliberately does NOT bail out when the ip panel is hidden — a "Mark in
 * progress" click on an epic anywhere (the main panel, browse view) needs
 * to refresh this cache so the ▶/✓ button state is correct THE NEXT time
 * either panel renders, even if the left panel isn't open right now.
 * renderInProgressList() itself still no-ops while hidden, so this stays a
 * quiet background cache refresh in that case, not a wasted render.
 */
async function loadInProgress(force) {
  const fresh = inProgressCache && Date.now() - inProgressCache.fetchedAt < IN_PROGRESS_STALE_MS;
  if (!force && fresh) {
    renderInProgressList();
    updateCodeBlockButtonStates();
    return;
  }
  const res = await sendMessageSafe({ type: "build-tracker-list-in-progress" });
  if (!res?.ok) {
    if (panelEls && !panelEls.ipPanel.hidden) {
      panelEls.ipList.innerHTML = `<div class="empty">${escapeHtml(res?.error ?? "Couldn't load")}</div>`;
    }
    return;
  }
  inProgressCache = { issues: res.result?.issues ?? [], fetchedAt: Date.now() };
  // Git #784 — a number that was blocked last poll and isn't anymore just
  // got unblocked; flag it until Shane acknowledges it in renderInProgressList().
  const currentBlockedNumbers = new Set(
    inProgressCache.issues.filter((i) => i.isBlocked).map((i) => i.githubNumber),
  );
  for (const num of previousBlockedNumbers) {
    if (!currentBlockedNumbers.has(num)) recentlyUnblockedNumbers.add(num);
  }
  previousBlockedNumbers = currentBlockedNumbers;
  renderInProgressList();
  updateCodeBlockButtonStates();
}

/**
 * Git #790 — the "📋 Queue" button's list, same cache/poll shape as
 * inProgressCache above. Deliberately its own cache/request, not merged
 * into loadInProgress()'s — a queue with nothing running yet has nothing to
 * do with GitHub's in-flight label at all.
 */
let queueCache = null; // { items, fetchedAt }
const QUEUE_STALE_MS = 15_000;

async function loadQueue(force) {
  const fresh = queueCache && Date.now() - queueCache.fetchedAt < QUEUE_STALE_MS;
  if (!force && fresh) { renderInProgressList(); return; }
  const res = await sendMessageSafe({ type: "build-tracker-list-queue" });
  if (!res?.ok) return;
  queueCache = { items: res.result?.items ?? [], fetchedAt: Date.now() };
  renderInProgressList();
}

/**
 * Epics and plain issues render differently — an epic entry is its own
 * unit of work (Shane: "I tend to work 2-3 epics at a time... I should be
 * able to mark those Epics as in progress"), a plain issue reuses
 * buildIssueRow() as-is (its in-flight dot + Details/prompt buttons
 * already do the right thing).
 */
/** Opens the SQL Runner and loads a migration file's real text straight into it — Shane: "if that thing is for me to run a SQL script, a link should be shown to load the SQL file into the floaty SQL panel so I can run it directly there." */
async function loadSqlIntoRunner(sqlPath) {
  openSqlRunner();
  const input = panelEls.sqlBackdrop.querySelector(".tool-input");
  input.value = "Loading…";
  const res = await sendMessageSafe({ type: "build-tracker-get-file-content", path: sqlPath });
  if (!res?.ok) {
    input.value = "";
    window.alert(`Couldn't load ${sqlPath}: ${res?.error ?? "unknown error"}`);
    return;
  }
  input.value = res.result?.content ?? "";
  input.focus();
}

/** "Shane To-Do" row's own Mark Done — Shane: "a button on this issue that allows me to mark it as done. Remove the Shane To-Do label, and close the issue in Git." Two real GitHub actions, both already-built endpoints, just chained. */
async function markTodoDone(item, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  const labelRes = await sendMessageSafe({ type: "build-tracker-toggle-label", number: item.githubNumber, label: "Shane To-Do", add: false });
  if (!labelRes?.ok) {
    btn.disabled = false;
    btn.textContent = "✓ Done";
    window.alert(`Couldn't remove the Shane To-Do label from #${item.githubNumber}: ${labelRes?.error ?? "unknown error"}`);
    return;
  }
  const closeRes = await sendMessageSafe({ type: "build-tracker-set-issue-state", number: item.githubNumber, state: "closed" });
  if (!closeRes?.ok) {
    window.alert(`Label removed, but couldn't close #${item.githubNumber}: ${closeRes?.error ?? "unknown error"}`);
    await loadInProgress(true);
    return;
  }
  await loadInProgress(true);
}

/** Git #784 — a red box around a blocked row, with a note naming exactly what it's waiting on. */
function wrapBlockedRow(item, rowEl, nested) {
  const wrap = document.createElement("div");
  wrap.className = "blocked-wrap" + (nested ? " nested" : "");
  wrap.appendChild(rowEl);
  const note = document.createElement("div");
  note.className = "blocked-note";
  const b = item.blockedBy;
  const span = document.createElement("span");
  span.textContent = b
    ? `🔴 Blocked by #${b.number}: ${b.title}${(b.state === "closed" || b.complete) ? " — looks done, check it" : ""}`
    : "🔴 Blocked — no GitHub dependency set yet";
  note.appendChild(span);
  wrap.appendChild(note);
  return wrap;
}

/** The moment a block clears — Shane: "make it a different color so I know I can go start it again." Stays flagged until he clicks ✓. */
function wrapJustUnblockedRow(item, rowEl, nested) {
  const wrap = document.createElement("div");
  wrap.className = "just-unblocked-wrap" + (nested ? " nested" : "");
  wrap.appendChild(rowEl);
  const note = document.createElement("div");
  note.className = "just-unblocked-note";
  const span = document.createElement("span");
  span.textContent = "🔓 Unblocked — go start it";
  note.appendChild(span);
  const ackBtn = document.createElement("button");
  ackBtn.type = "button";
  ackBtn.textContent = "✓ Got it";
  ackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    recentlyUnblockedNumbers.delete(item.githubNumber);
    renderInProgressList();
  });
  note.appendChild(ackBtn);
  wrap.appendChild(note);
  return wrap;
}

/**
 * Git #784 — Shane: "nest the build under what it's waiting on." Renders
 * `items` via `buildRowFn(item) -> rowEl`, placing a blocked item directly
 * under its blocker's row (indented) WHEN the blocker is also present in
 * this same section — issue-blocks-issue or epic-blocks-epic. A blocker
 * living in a different section (e.g. an epic blocking a plain issue) still
 * gets its full blocked-by note, just not nested under it — reaching across
 * the Epics/Issues section boundary is a reasonable follow-up, not part of
 * this first pass.
 */
function renderSectionWithBlocking(container, items, buildRowFn) {
  const byNumber = new Map(items.map((i) => [i.githubNumber, i]));
  const childrenOf = new Map(); // blockerNumber -> item[]
  const topLevel = [];
  for (const item of items) {
    const blockerNum = item.isBlocked ? (item.blockedBy?.number ?? null) : null;
    if (blockerNum != null && blockerNum !== item.githubNumber && byNumber.has(blockerNum)) {
      if (!childrenOf.has(blockerNum)) childrenOf.set(blockerNum, []);
      childrenOf.get(blockerNum).push(item);
    } else {
      topLevel.push(item);
    }
  }
  const renderOne = (item, nested) => {
    const rowEl = buildRowFn(item);
    const justUnblocked = !item.isBlocked && recentlyUnblockedNumbers.has(item.githubNumber);
    if (item.isBlocked) {
      container.appendChild(wrapBlockedRow(item, rowEl, nested));
    } else if (justUnblocked) {
      container.appendChild(wrapJustUnblockedRow(item, rowEl, nested));
    } else {
      container.appendChild(rowEl);
    }
    for (const child of childrenOf.get(item.githubNumber) ?? []) renderOne(child, true);
  };
  for (const item of topLevel) renderOne(item, false);
}

const QUEUE_STATUS_LABEL = {
  queued: "⏳ Queued",
  running: "▶ Running",
  done: "✓ Done",
  failed: "✕ Failed",
  canceled: "— Canceled",
};

/** Git #790 — one row in the "📋 Queued Builds" section; a Cancel button only while it's still actually cancelable. */
function buildQueueItemRow(item) {
  const row = document.createElement("div");
  row.className = "issue-row queue-item-row queue-status-" + item.status;
  const meta = [QUEUE_STATUS_LABEL[item.status] ?? item.status];
  const blockerNums = item.blockedByNumbers ?? (item.blockedByNumber != null ? [item.blockedByNumber] : []);
  if (blockerNums.length > 0) meta.push(`waiting on ${blockerNums.map((n) => `#${n}`).join(", ")}`);
  if (item.status === "failed" && item.exitCode != null) meta.push(`exit code ${item.exitCode}`);
  row.innerHTML =
    `<div class="issue-top"><span class="issue-text">${escapeHtml(item.title)}</span></div>` +
    `<div class="queue-item-meta">${escapeHtml(meta.join(" · "))}</div>`;
  if (item.status === "queued") {
    const actions = document.createElement("div");
    actions.className = "issue-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ibtn";
    cancelBtn.textContent = "✕ Cancel";
    cancelBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      cancelBtn.disabled = true;
      const res = await sendMessageSafe({ type: "build-tracker-cancel-queue-item", id: item.id });
      cancelBtn.disabled = false;
      if (!res?.ok) {
        window.alert(`Couldn't cancel: ${res?.error ?? "unknown error"}`);
        return;
      }
      void loadQueue(true);
    });
    actions.appendChild(cancelBtn);
    row.appendChild(actions);
  }
  // Git #801 — Shane: "796 is stuck in the queue even though it's done
  // and closed." The watcher's own completion tracking is in-memory only
  // (a Process handle per running build) - restarting the watcher throws
  // that away for anything already `running`, orphaning the row forever
  // since nothing is left to report its completion. Manual escape hatch,
  // reusing the exact endpoint the watcher itself calls.
  if (item.status === "running") {
    const actions = document.createElement("div");
    actions.className = "issue-actions";
    const markDoneBtn = document.createElement("button");
    markDoneBtn.type = "button";
    markDoneBtn.className = "ibtn";
    markDoneBtn.title = "Mark this done by hand — use if the watcher lost track of it (e.g. after a restart)";
    markDoneBtn.textContent = "✓ Mark Done";
    markDoneBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      markDoneBtn.disabled = true;
      const res = await sendMessageSafe({ type: "build-tracker-mark-queue-item-complete", id: item.id, exitCode: 0 });
      markDoneBtn.disabled = false;
      if (!res?.ok) {
        window.alert(`Couldn't mark done: ${res?.error ?? "unknown error"}`);
        return;
      }
      void loadQueue(true);
    });
    actions.appendChild(markDoneBtn);
    row.appendChild(actions);
  }
  return row;
}

/**
 * Git #798/#813 — Shane: "if 797 is blocked by 796 it should be nested under
 * 796." Then: "--blocked-by 807,808,809" — an item can wait on SEVERAL
 * others, not just one. Matches `blockedByNumbers` (plural — #813) against
 * other queue items' own `githubNumber`s; when at least one blocker is also
 * sitting in the queue, indent the blocked item under the FIRST such match
 * (an item only nests once, under one parent, even with multiple blockers —
 * the full list still shows via buildQueueItemRow's "waiting on #N, #M"
 * line). A blocker that isn't itself queued still shows there too, just not
 * nested — same scoping choice renderSectionWithBlocking() made for the
 * Epics/Issues sections.
 */
function renderQueueSection(container, queueItems) {
  const byGithubNumber = new Map();
  for (const item of queueItems) {
    if (item.githubNumber != null) byGithubNumber.set(item.githubNumber, item);
  }
  const childrenOf = new Map(); // blocker githubNumber -> queue item[]
  const topLevel = [];
  for (const item of queueItems) {
    const blockerNums = item.blockedByNumbers ?? (item.blockedByNumber != null ? [item.blockedByNumber] : []);
    const nestUnder = blockerNums.find((n) => n !== item.githubNumber && byGithubNumber.has(n));
    if (nestUnder != null) {
      if (!childrenOf.has(nestUnder)) childrenOf.set(nestUnder, []);
      childrenOf.get(nestUnder).push(item);
    } else {
      topLevel.push(item);
    }
  }
  // Git #818 — childrenOf is keyed by githubNumber, not a specific row's
  // id: two SEPARATE queue rows sharing a githubNumber (e.g. the same issue
  // queued twice) each independently pull and render the FULL
  // childrenOf[number] list, fanning the whole subtree out once per
  // duplicate. A visited-by-id guard renders each real row at most once no
  // matter how many other rows share its githubNumber — also guards
  // against a genuine blocker cycle causing infinite recursion.
  const renderedIds = new Set();
  const renderOne = (item, nested) => {
    if (renderedIds.has(item.id)) return;
    renderedIds.add(item.id);
    const row = buildQueueItemRow(item);
    if (nested) row.classList.add("nested-queue-item");
    container.appendChild(row);
    for (const child of childrenOf.get(item.githubNumber) ?? []) renderOne(child, true);
  };
  for (const item of topLevel) renderOne(item, false);
}

function renderInProgressList() {
  if (!panelEls || panelEls.ipPanel.hidden) return;
  const { ipList } = panelEls;
  const items = inProgressCache?.issues ?? [];
  // Git #790 — queued builds render as their own section regardless of
  // whether anything's actually in-flight yet (a fresh queue with nothing
  // running is the NORMAL state right after queuing several builds).
  const queueItems = queueCache?.items ?? [];

  ipList.innerHTML = "";
  if (items.length === 0 && queueItems.length === 0) {
    ipList.innerHTML = `<div class="empty">Nothing in flight right now.</div>`;
    return;
  }

  if (queueItems.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = `📋 Queued Builds (${queueItems.length})`;
    ipList.appendChild(h);
    renderQueueSection(ipList, queueItems);
  }

  // Git #744 follow-up — Shane: "add a new label 'Shane To-Do'... In our
  // left In Progress panel, if there is a task with the label Shane To-Do
  // add it to its own area." Pulled out first — an action-for-Shane item
  // is a different KIND of thing than "Claude is building this," it
  // deserves top billing, not mixed into the epic/issue lists below.
  const todoItems = items.filter((i) => i.isTodo);
  const epicItems = items.filter((i) => i.isEpic && !i.isTodo);
  const issueItems = items.filter((i) => !i.isEpic && !i.isTodo);

  if (todoItems.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = `⚠ Shane To-Do (${todoItems.length})`;
    ipList.appendChild(h);
    for (const item of todoItems) {
      const row = document.createElement("div");
      row.className = "issue-row";
      row.innerHTML = `<div class="issue-top"><span class="issue-text">#${item.githubNumber} ${escapeHtml(item.title)}</span></div>`;
      const actions = document.createElement("div");
      actions.className = "issue-actions";

      if (item.sqlPath) {
        const sqlBtn = document.createElement("button");
        sqlBtn.type = "button";
        sqlBtn.className = "ibtn";
        sqlBtn.title = `Load ${item.sqlPath} into the SQL Runner`;
        sqlBtn.textContent = "🗄";
        sqlBtn.addEventListener("click", () => void loadSqlIntoRunner(item.sqlPath));
        actions.appendChild(sqlBtn);
      }

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "ibtn";
      doneBtn.title = "Mark done — removes Shane To-Do and closes the issue";
      doneBtn.textContent = "✓ Done";
      doneBtn.addEventListener("click", () => void markTodoDone(item, doneBtn));
      actions.appendChild(doneBtn);

      row.appendChild(actions);
      ipList.appendChild(row);
    }
  }

  if (epicItems.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = `Epics (${epicItems.length})`;
    ipList.appendChild(h);
    // Git #770 — Shane: "if there are more than One Epic listed... highlight
    // the Epic of the chat that is currently loaded." The server already
    // resolves the current chat's own epic (self-or-parent, same as every
    // other epic lookup in this file) — no extra request needed.
    const currentEpicNumber = boardCache?.data?.currentChat?.focusEpic?.githubNumber ?? null;
    renderSectionWithBlocking(ipList, epicItems, (item) => {
      const chat = chatForEpicId(item.epic?.id);
      const isComplete = (item.labels ?? []).includes("complete");
      const isCurrent = currentEpicNumber != null && item.githubNumber === currentEpicNumber;
      const row = document.createElement("div");
      row.className = "epic-row" + (isComplete ? " label-complete" : "") + (isCurrent ? " current-chat-epic" : "");
      row.innerHTML = `<span>${isComplete ? "✓ " : ""}${escapeHtml(item.title)}</span><span class="pill">${isCurrent ? "● " : ""}#${item.githubNumber}</span>`;
      const currentNote = isCurrent ? "Your current chat is linked to this epic. " : "";
      if (chat) {
        row.title = `${currentNote}Go to: "${chat.title}"`;
        row.addEventListener("click", () => { location.href = chat.claudeUrl; });
      } else {
        row.style.cursor = "default";
        row.title = `${currentNote}No chat linked to this epic yet`;
      }
      return row;
    });
  }

  if (issueItems.length > 0) {
    const h = document.createElement("div");
    h.className = "milestone";
    h.textContent = `Issues (${issueItems.length})`;
    ipList.appendChild(h);
    renderSectionWithBlocking(ipList, issueItems, (item) =>
      buildIssueRow(
        { githubNumber: item.githubNumber, title: item.title, labels: item.labels, epicId: item.epic?.id ?? null },
        null,
      ),
    );
  }
}

// ── Git #701: auto-poll instead of manual refresh ───────────────────────────
// Shane: "poll Git instead of me having to hit refresh every time... ADHD, I
// just want to look and see it going and be cool, not OCD click click click."
// Runs in THIS content script, not the background service worker — a service
// worker gets suspended between events in MV3, so a setInterval there isn't
// reliable; a content script stays alive for as long as the tab itself is
// open, which is exactly the lifetime this needs.
const INFLIGHT_POLL_MS = 15_000;
const EPIC_POLL_MS = 30_000;
const IN_PROGRESS_POLL_MS = 15_000;
let inflightPollTimer = null;
let epicPollTimer = null;
let inProgressPollTimer = null;

function startPolling() {
  stopPolling();
  inflightPollTimer = setInterval(() => void pollInFlightIssues(), INFLIGHT_POLL_MS);
  epicPollTimer = setInterval(() => void pollFocusedEpic(), EPIC_POLL_MS);
  inProgressPollTimer = setInterval(() => void pollInProgressList(), IN_PROGRESS_POLL_MS);
}

function stopPolling() {
  clearInterval(inflightPollTimer);
  clearInterval(epicPollTimer);
  clearInterval(inProgressPollTimer);
  inflightPollTimer = null;
  epicPollTimer = null;
  inProgressPollTimer = null;
}

/** Keeps the left In Progress panel's own GitHub-sourced list fresh — independent of boardCache, so this works even if the main panel's never been opened this session. */
async function pollInProgressList() {
  if (pollingBlocked()) return;
  if (!panelEls || panelEls.ipPanel.hidden) return;
  await loadInProgress(true);
  await loadQueue(true);
}

// Switching tabs to close something on GitHub, then back, is the exact
// workflow polling exists for — but pollingBlocked() pauses everything while
// the tab's backgrounded, and setInterval keeps ticking on its ORIGINAL
// schedule regardless, so coming back could mean waiting up to another 30s
// before anything happens. That reads as "not updating," not "about to
// update" (Shane: "still not updating when I close Issues"). Firing both
// polls immediately the moment the tab becomes visible again closes that gap.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  void pollInFlightIssues();
  void pollFocusedEpic();
  void pollInProgressList();
});

/**
 * Shane: "when a refresh is happening... minimize flash, but add a
 * 'Syncing...' indicator so I know... and maybe even make the sync button
 * spin and disable." Covers every sync source — the manual ⟳ click, both
 * background polls, an alert row's resync, a sub-epic's resync — so
 * there's always a passive "it's going" signal without ever blanking the
 * list itself (that's what `loadBoard(force, quiet)` is for).
 */
function setSyncing(active) {
  if (!panelEls) return;
  const { refreshBtn, syncIndicator } = panelEls;
  refreshBtn.disabled = active;
  refreshBtn.classList.toggle("spinning", active);
  syncIndicator.hidden = !active;
}

/** Don't yank content out from under Shane while a dialog's open, the tab's backgrounded, or the panel's closed. */
function pollingBlocked() {
  if (!anyPanelOpen()) return true;
  if (document.hidden) return true;
  if (!panelEls.dlgBackdrop.hidden || !panelEls.navBackdrop.hidden) return true;
  return false;
}

/**
 * Every 15s: quiet quick-sync of every in-flight-labeled issue Build
 * Tracker currently knows about — GLOBAL, not just currentIssueList()'s
 * scope (whatever the main panel's current view happens to be showing).
 * Git #723 follow-up — Shane: "things are moving I have to manually
 * refresh it." Root cause: the left In Progress panel shows in-flight work
 * across every epic, but this poll only ever checked issues tied to
 * whichever epic the CURRENT claude.ai chat happens to be linked to — an
 * issue moving in a totally different epic (the normal case when running
 * several parallel sessions) was invisible to it no matter how long you
 * waited. boardCache.data.issues is already every OPEN issue site-wide, so
 * filtering that instead covers both panels with the same one poll.
 */
async function pollInFlightIssues() {
  if (pollingBlocked() || !boardCache) return;
  const numbers = (boardCache.data.issues ?? [])
    .filter((i) => (i.labels ?? []).includes("in-flight") && typeof i.githubNumber === "number")
    .map((i) => i.githubNumber);
  if (numbers.length === 0) return;
  setSyncing(true);
  try {
    const res = await sendMessageSafe({ type: "build-tracker-quick-sync", issueNumbers: numbers });
    if (res?.ok) await loadBoard(true, true);
    // A failed background sync used to disappear silently — no error anywhere,
    // making it indistinguishable from "nothing changed yet." At least log it.
    else console.warn("[Build Tracker] background quick-sync failed:", res?.error);
  } finally {
    setSyncing(false);
  }
}

/** Every 30s: quiet sync-epic of the focused epic — catches a brand-new or newly-closed sub-issue, not just label changes. */
async function pollFocusedEpic() {
  if (pollingBlocked() || !boardCache) return;
  const focusEpic = boardCache.data.currentChat?.focusEpic;
  if (!focusEpic || showAllOverride || !focusEpic.githubNumber) return;
  setSyncing(true);
  try {
    const res = await sendMessageSafe({ type: "build-tracker-sync-epic", epicNumber: focusEpic.githubNumber });
    if (res?.ok) await loadBoard(true, true);
    else console.warn("[Build Tracker] background epic sync failed:", res?.error);
  } finally {
    setSyncing(false);
  }
}

/** `quiet` skips the "Loading…" placeholder — for background polling (Git #701), where blanking the list every 15-30s would read as flicker, not a refresh. */
async function loadBoard(force, quiet = false) {
  const conversationId = conversationIdFromUrl();
  const { list } = buildPanel();
  await loadDismissed();

  const fresh = boardCache && Date.now() - boardCache.fetchedAt < BOARD_STALE_MS;
  if (!force && fresh) {
    render();
    return;
  }

  if (!quiet) list.innerHTML = `<div class="empty">Loading…</div>`;
  const res = await sendMessageSafe({ type: "build-tracker-get-board", conversationId });
  if (!res?.ok) {
    if (!quiet) list.innerHTML = `<div class="empty">${escapeHtml(res?.error ?? "Couldn't load — check the extension's settings.")}</div>`;
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
  const focusEpic = boardCache?.data?.currentChat?.focusEpic;

  setSyncing(true);
  try {
    // Git #698: focused on one epic → sync THAT epic for real, discovering
    // any new sub-issues GitHub-side, not just refreshing the numbers
    // already on screen — "I dont have to sync the whole thing again to get
    // new items in that one epic." Only makes sense with a single epic in
    // view; the browse view (multiple epics/issues at once) keeps the
    // numbers-only quick-sync. Errors still get a real message — only the
    // "Syncing…"/"Checking N…" placeholders (Shane: "minimize flash") are
    // gone, replaced by the header's spinner + indicator.
    if (focusEpic && !showAllOverride && focusEpic.githubNumber) {
      const res = await sendMessageSafe({ type: "build-tracker-sync-epic", epicNumber: focusEpic.githubNumber });
      if (!res?.ok) {
        list.innerHTML = `<div class="empty">${escapeHtml(`Epic sync failed: ${res?.error ?? "unknown error"}`)}</div>`;
        return;
      }
      await loadBoard(true, true);
      return;
    }

    const numbers = visibleIssueNumbers();
    if (numbers.length === 0) {
      await loadBoard(true, true);
      return;
    }

    const res = await sendMessageSafe({ type: "build-tracker-quick-sync", issueNumbers: numbers });
    if (!res?.ok) {
      list.innerHTML = `<div class="empty">${escapeHtml(`Quick sync failed: ${res?.error ?? "unknown error"}`)}</div>`;
      return;
    }
    await loadBoard(true, true);
  } finally {
    setSyncing(false);
  }
}

/**
 * "Full sync from GitHub" footer link — the original behavior from #693: a
 * real whole-repo pull, THEN a board reload. Needed to discover an epic/
 * issue/milestone Build Tracker doesn't know about yet at all — quickRefresh()
 * above only ever updates rows that already exist.
 */
async function fullSyncFromGithub() {
  const { list } = buildPanel();
  setSyncing(true);
  try {
    const syncRes = await sendMessageSafe({ type: "build-tracker-sync-github" });
    if (!syncRes?.ok) {
      list.innerHTML = `<div class="empty">${escapeHtml(`Sync failed: ${syncRes?.error ?? "unknown error"}`)}</div>`;
      return;
    }
    await loadBoard(true, true);
  } finally {
    setSyncing(false);
  }
}

/** Shared by both views' search — title substring or a bare/`#`-prefixed number match. */
function textMatches(title, num, q) {
  return !q || title.toLowerCase().includes(q) || (num != null && String(num).includes(q.replace(/^#/, "")));
}

function renderAlerts() {
  const { alertsEl } = panelEls;
  const alerts = boardCache?.data?.alerts ?? [];
  if (alerts.length === 0) {
    alertsEl.hidden = true;
    alertsEl.innerHTML = "";
    return;
  }
  alertsEl.hidden = false;
  alertsEl.innerHTML = `<div class="alert-title">⚠ ${alerts.length} closed item${alerts.length === 1 ? "" : "s"} still ha${alerts.length === 1 ? "s" : "ve"} open sub-work</div>`;
  for (const a of alerts) {
    const row = document.createElement("div");
    row.className = "alert-row";

    const text = document.createElement("span");
    text.className = "alert-row-text";
    text.textContent = `${a.githubNumber ? `#${a.githubNumber} ` : ""}${a.title}`;
    if (a.githubUrl) {
      text.style.cursor = "pointer";
      text.addEventListener("click", () => window.open(a.githubUrl, "_blank", "noopener"));
    }
    row.appendChild(text);

    // This entry is a CLOSED epic — invisible to the Navigator (browse only
    // lists open epics) and skipped by #701's polling (which only ever
    // touches the focused OPEN epic). Nothing else in the panel would ever
    // re-check it once flagged, so a fix made on GitHub could sit unseen
    // here indefinitely — "I fixed it... maybe it didn't save" was really
    // "nothing here was resyncing this specific item." sync-epic doesn't
    // care whether the epic is open or closed, so this works either way.
    if (a.githubNumber) {
      const resyncBtn = document.createElement("button");
      resyncBtn.type = "button";
      resyncBtn.className = "alert-resync";
      resyncBtn.title = "Re-check this item on GitHub";
      resyncBtn.textContent = "⟳";
      resyncBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        resyncBtn.disabled = true;
        setSyncing(true);
        try {
          const res = await sendMessageSafe({ type: "build-tracker-sync-epic", epicNumber: a.githubNumber });
          if (!res?.ok) {
            window.alert(`Couldn't resync #${a.githubNumber}: ${res?.error ?? "unknown error"}`);
            return;
          }
          await loadBoard(true, true);
        } finally {
          resyncBtn.disabled = false;
          setSyncing(false);
        }
      });
      row.appendChild(resyncBtn);
    }

    alertsEl.appendChild(row);
  }
}

/**
 * Dispatches between two very different views: a chat linked to an epic
 * shows ONLY that epic and its own open issues (plus the milestone it
 * belongs to, as a progress bar) — Shane's ask was explicit that seeing the
 * whole board once a chat already has a home is just noise. Search (Git
 * #700) stays visible and functional in BOTH views now — with 19 issues
 * under one epic, "hard to find" applied just as much to the focused view
 * as the browse one.
 */
/**
 * Shane: "clicking an Epic loads it and its details into the right panel."
 * Reuses the SAME layout a chat-linked epic already gets (renderFocused),
 * computed client-side from boardCache.data (already fully loaded — no
 * extra request) rather than the server's own focusEpic resolution, which
 * only ever runs for the CURRENT chat.
 */
function buildManualFocusChat(epic) {
  const openIssues = (boardCache.data.issues ?? []).filter((i) => i.epicId === epic.id);
  const subEpics = (boardCache.data.epics ?? [])
    .filter((e) => e.parentEpicId === epic.id)
    .map((e) => ({
      id: e.id,
      title: e.title,
      githubNumber: e.githubNumber,
      status: e.status,
      openIssueCount: (boardCache.data.issues ?? []).filter((i) => i.epicId === e.id).length,
    }));
  const milestone = (boardCache.data.milestones ?? []).find((m) => m.githubNumber === epic.milestoneId) ?? null;
  return { focusEpic: epic, focusEpicOpenIssues: openIssues, focusEpicSubEpics: subEpics, focusMilestone: milestone };
}

function render() {
  if (!boardCache) return;
  const { search } = panelEls;
  const currentChat = boardCache.data.currentChat;
  // A manually browsed epic (Git #755 follow-up — the 📚 Browse Epics
  // button) takes priority over whatever the current chat happens to be
  // linked to — Shane explicitly asked to SEE that epic, not the chat's own.
  const manualChat = manualEpicView ? buildManualFocusChat(manualEpicView) : null;
  const effectiveChat = manualChat ?? currentChat;
  const focusEpic = effectiveChat?.focusEpic ?? null;

  renderAlerts();

  if (focusEpic && !showAllOverride) {
    search.placeholder = "Search this epic's issues…";
    // Other epics sharing this milestone — the actual answer to "where are
    // the other N items the progress bar counts" (Git #699/#712 follow-up:
    // a passive disclaimer wasn't enough, Shane still couldn't tell WHERE
    // the rest of the count lived). Computed client-side from data already
    // in hand — no extra request.
    const siblingEpics = (boardCache.data.epics ?? []).filter(
      (e) => e.milestoneId === focusEpic.milestoneId && e.id !== focusEpic.id,
    );
    renderProgress(effectiveChat.focusMilestone, siblingEpics);
    renderFocused(effectiveChat, search.value, !!manualEpicView);
  } else {
    search.placeholder = "Search…";
    renderProgress(null, []);
    renderCurrent(currentChat, focusEpic);
    renderList(search.value);
  }
}

function renderProgress(milestone, siblingEpics) {
  const { progress } = panelEls;
  if (!milestone) {
    progress.hidden = true;
    progress.innerHTML = "";
    return;
  }
  progress.hidden = false;
  const { done, total, pct } = milestone.progress;
  const color = pct >= 100 ? "#7fae91" : "#f2ca63";
  const siblings = siblingEpics ?? [];
  progress.innerHTML = `
    <div class="progress-label">
      <span>Milestone: ${escapeHtml(milestone.title)}</span>
      <span>${done}/${total} · ${pct}%</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${color};"></div></div>
    <div class="progress-note">Whole milestone, across every epic in it — not just this one.</div>
    ${siblings.length > 0 ? `<a href="#" class="progress-siblings">${siblings.length} other epic${siblings.length === 1 ? "" : "s"} in this milestone — show them</a>` : ""}
  `;
  const siblingsLink = progress.querySelector(".progress-siblings");
  if (siblingsLink) {
    siblingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      openNavigator({ milestone, epic: null });
    });
  }
}

/** The linked-epic-only view — read-only (already linked, nothing to click except sub-epics/search). */
/**
 * Git #723 follow-up — Shane: "I tend to work 2-3 epics at a time... I
 * should be able to mark those Epics as in progress... This means you need
 * to also add a quick button to the Epic to set its status to In
 * Progress." Applies the real `in-flight` GitHub label directly to the
 * epic issue — same label plain issues already use, so it's picked up by
 * the exact same /extension/in-progress endpoint with zero extra plumbing.
 * Shared by every place an epic shows up (focused view's own header,
 * browse view's epic rows).
 */
/** Epics carry no `labels` field locally (bt_epics has no such column — only issues do), so the ✓/▶ state has to come from whatever the left panel's own GitHub-sourced cache already knows, not from board data. Defaults to ▶ if that cache hasn't loaded yet — same as before, not a regression. */
function isEpicMarkedInProgress(githubNumber) {
  const item = (inProgressCache?.issues ?? []).find((i) => i.isEpic && i.githubNumber === githubNumber);
  return !!item && (item.labels ?? []).includes("in-flight");
}

function buildMarkInProgressButton(githubNumber) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ibtn";
  const setState = (marked) => {
    btn.textContent = marked ? "✓" : "▶";
    btn.title = marked ? "Marked in progress" : "Mark in progress — shows up in the left In Progress panel";
  };
  setState(isEpicMarkedInProgress(githubNumber));
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    const res = await sendMessageSafe({ type: "build-tracker-toggle-label", number: githubNumber, label: "in-flight", add: true });
    btn.disabled = false;
    if (!res?.ok) {
      window.alert(`Couldn't mark #${githubNumber} in progress: ${res?.error ?? "unknown error"}`);
      return;
    }
    setState(true);
    // Refresh regardless of whether the left panel is open right now — see
    // loadInProgress()'s own doc comment. Without this, marking an epic
    // in-progress from the MAIN panel while the left one was closed left
    // its cache stale, so the button (and the left panel, once opened)
    // both still showed the old ▶ state — Shane: "doesn't show up in the
    // left In Progress window anymore even after clicking all the syncs."
    void loadInProgress(true);
  });
  return btn;
}

/**
 * Git #772 — Shane: "I currently manually rename them to the Git ID of the
 * Epic they are working on." For a chat that's ALREADY linked (not the
 * Browse Epics manual view — renaming the current chat to some unrelated
 * epic you're just browsing would be wrong), a one-click way to sync its
 * title without leaving the chat.
 */
function buildRenameChatButton(githubNumber) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ibtn";
  btn.textContent = "✎";
  btn.title = `Rename this chat to "Epic #${githubNumber}"`;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    const ok = await renameCurrentChat(`Epic #${githubNumber}`);
    btn.disabled = false;
    if (!ok) window.alert("Couldn't find claude.ai's rename control — its layout may have changed.");
  });
  return btn;
}

function renderFocused(currentChat, query, isManual) {
  const { current, list } = panelEls;
  const epic = currentChat.focusEpic;
  const q = (query ?? "").trim().toLowerCase();

  current.className = "current linked";
  if (isManual) {
    // A manually browsed epic (Git #755 follow-up) isn't actually linked to
    // this chat — "Show everything" would be misleading here since there's
    // no real link to fall back past. "Close" just drops the manual view.
    current.innerHTML = `Viewing Epic: ${escapeHtml(epic.title)}<a href="#" class="showall">Close</a>`;
    current.querySelector(".showall").addEventListener("click", (e) => {
      e.preventDefault();
      manualEpicView = null;
      render();
    });
    // Git #769 — Shane: "if a chat is not yet added to that Epic... give me
    // a link to create a new chat associated to my project." No chat found
    // for this epic (chatForEpicId) means the whole point of Browse Epics
    // (finding work with nowhere to go yet) is unmet without this.
    if (!chatForEpicId(epic.id)) {
      const newChatLink = document.createElement("a");
      newChatLink.href = "#";
      newChatLink.className = "showall";
      newChatLink.textContent = "+ New chat for this epic";
      newChatLink.title = "Opens a new chat in your Build Tracker project, pre-filled with this epic";
      newChatLink.addEventListener("click", (e) => {
        e.preventDefault();
        void openNewEpicChat(epic);
      });
      current.appendChild(newChatLink);
    }
  } else {
    current.innerHTML = `Linked to Epic: ${escapeHtml(epic.title)}<a href="#" class="showall">Show everything</a>`;
    current.querySelector(".showall").addEventListener("click", (e) => {
      e.preventDefault();
      showAllOverride = true;
      render();
    });
  }

  list.innerHTML = "";
  const row = document.createElement("div");
  row.className = "epic-row";
  row.style.cursor = "default";
  row.innerHTML = `<span>${escapeHtml(epic.title)}</span>${epic.githubNumber ? `<span class="pill">#${epic.githubNumber}</span>` : ""}`;
  if (epic.githubNumber) {
    row.appendChild(buildMarkInProgressButton(epic.githubNumber));
    if (!isManual) row.appendChild(buildRenameChatButton(epic.githubNumber));
  }
  list.appendChild(row);

  // Sub-epics (Git #699) — an issue under this epic that itself has
  // sub-issues gets tracked as its own epic, not a plain issue, so it would
  // otherwise never show up here at all: "if there are sub items under
  // items I need to know that so I can work them too." Shown ABOVE the
  // plain open-issues list since these need drilling into, not just a click.
  const subEpics = (currentChat.focusEpicSubEpics ?? []).filter((e) => textMatches(e.title, e.githubNumber, q));
  if (subEpics.length > 0) {
    const subHeading = document.createElement("div");
    subHeading.className = "milestone";
    subHeading.textContent = `⚠ Sub-epics under this one — they have their own checklist (${subEpics.length})`;
    list.appendChild(subHeading);
    for (const sub of subEpics) {
      const subRow = document.createElement("div");
      subRow.className = "epic-row";
      subRow.innerHTML = `<span>${escapeHtml(sub.title)}</span><span class="pill">${sub.githubNumber ? `#${sub.githubNumber} · ` : ""}${sub.openIssueCount} open</span>`;
      subRow.addEventListener("click", () => {
        openNavigator({
          milestone: currentChat.focusMilestone ?? { title: epic.title, githubNumber: null },
          epic: sub,
        });
      });
      list.appendChild(subRow);
    }
  }

  const openIssues = (currentChat.focusEpicOpenIssues ?? [])
    .filter((i) => !isDismissed(i) && textMatches(i.title, i.githubNumber, q));
  const heading = document.createElement("div");
  heading.className = "milestone";
  heading.textContent = `This epic's open issues (${openIssues.length})`;
  list.appendChild(heading);

  if (openIssues.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = q
      ? "No matches."
      : "No open issues on this epic — the milestone progress above covers other epics too.";
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
  scheduleSearchIssueLookup(q);

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
      if (epic.githubNumber) row.appendChild(buildMarkInProgressButton(epic.githubNumber));
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

/**
 * Opens the navigator dialog. With no args, starts at the top (Milestones)
 * — the header 🧭 button's behavior. Passed `{ milestone, epic }`, jumps
 * straight to that epic's chat list instead — used by the sub-epic rows in
 * the focused view (Git #699) to drill into a nested epic directly, rather
 * than making Shane re-pick the milestone he's already looking at.
 */
function openNavigator(startAt) {
  const { navBackdrop } = buildPanel();
  navMilestone = startAt?.milestone ?? null;
  navEpic = startAt?.epic ?? null;
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

// ── Git #702 (+ follow-up): floaty SQL Runner + Deploy Console ─────────────
// Both reuse existing, already-shipped admin routes (background.js's
// runSql()/runDeploy()) — full read/write, no restrictions, Shane's explicit
// choice for his own dev server. Single click runs it — Shane: "please don't
// make me click buttons twice, I'm building this so I can quickly get
// through it, not add more gates." Every result also lands straight in the
// composer, not just the on-screen output — "so I can send the results to
// Claude chat when it's done... right now I run this, copy, paste, copy,
// back, paste." The on-screen `.tool-output` stays pretty JSON (readable
// here); what goes to the composer is a plain, compact rendering — pretty
// JSON repeats every field name per row, which burns characters fast on a
// real result set.

const SQL_CHAT_ROW_LIMIT = 50;

/**
 * Plain pipe-table, not JSON — one header line, one line per row, no
 * repeated field names. Far fewer characters for the same data. No query
 * text either (Git #739 follow-up — Shane: "we dont need to send the SQL
 * we ran back, just the results") — he's already looking at the query he
 * typed, in the SQL Runner right above the output; results are the only
 * part worth handing to Claude.
 */
function formatSqlResultForChat(statements) {
  const parts = [];
  for (const s of statements ?? []) {
    if (!s.success) {
      parts.push(`[${s.statementIndex}] FAILED (${s.executionMs}ms): ${s.error ?? "unknown error"}`);
      continue;
    }
    if (!s.rows || s.rows.length === 0) {
      parts.push(`[${s.statementIndex}] OK — ${s.rowCount} row(s), ${s.executionMs}ms`);
      continue;
    }
    const fields = s.fields ?? Object.keys(s.rows[0]);
    const shown = s.rows.slice(0, SQL_CHAT_ROW_LIMIT);
    const lines = [
      `[${s.statementIndex}] ${s.rowCount} row(s), ${s.executionMs}ms`,
      fields.join(" | "),
      ...shown.map((row) => fields.map((f) => String(row[f] ?? "")).join(" | ")),
    ];
    if (s.rows.length > shown.length) lines.push(`… ${s.rows.length - shown.length} more row(s) not shown`);
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

/** Same idea for Deploy Console — raw command output, no JSON wrapper. */
function formatDeployResultForChat(label, result) {
  if (result?.steps) {
    return [`$ ${label}`, ...result.steps.map((s) => `— ${s.label} —\n${s.output || "(no output)"}`)].join("\n\n");
  }
  return `$ ${label}\n${result?.output || "(no output)"}`;
}

function openSqlRunner() {
  const { sqlBackdrop } = buildPanel();
  sqlBackdrop.hidden = false;
  sqlBackdrop.querySelector(".tool-input").focus();
}

/** Loads a persisted checkbox preference and keeps it saved on every change — shared by both consoles' "Send to chat" toggle. */
function wireChatToggle(checkbox, storageKey) {
  chrome.storage.local.get(storageKey).then((stored) => {
    checkbox.checked = stored[storageKey] !== false; // default ON, matches the original always-insert behavior
  });
  checkbox.addEventListener("change", () => {
    void chrome.storage.local.set({ [storageKey]: checkbox.checked });
  });
}

function wireSqlRunner() {
  const { sqlBackdrop } = panelEls;
  const input = sqlBackdrop.querySelector(".tool-input");
  const output = sqlBackdrop.querySelector(".tool-output");
  const runBtn = sqlBackdrop.querySelector('[data-action="sql-run"]');
  const chatToggle = sqlBackdrop.querySelector('[data-action="sql-chat-toggle"]');
  wireChatToggle(chatToggle, "sqlSendToChat");
  runBtn.addEventListener("click", () => {
    void (async () => {
      const query = input.value.trim();
      if (!query) return;
      output.textContent = "Running…";
      const res = await sendMessageSafe({ type: "build-tracker-run-sql", query });
      if (!res?.ok) {
        output.textContent = `Error: ${res?.error ?? "unknown error"}`;
        return;
      }
      output.textContent = JSON.stringify(res.result, null, 2);
      if (chatToggle.checked) insertTextIntoComposer(formatSqlResultForChat(res.result?.statements));
    })();
  });
}

function openDeployConsole() {
  const { consoleBackdrop } = buildPanel();
  consoleBackdrop.hidden = false;
  void loadDeployOps();
}

async function loadDeployOps() {
  const { consoleBackdrop } = panelEls;
  const opsEl = consoleBackdrop.querySelector(".tool-ops");
  const res = await sendMessageSafe({ type: "build-tracker-list-deploy-ops" });
  if (!res?.ok) {
    opsEl.textContent = `Couldn't load operations: ${res?.error ?? "unknown error"}`;
    return;
  }
  const ops = res.result?.operations ?? [];
  opsEl.innerHTML = "";
  for (const op of ops) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-op-btn";
    btn.textContent = op.key;
    btn.title = (op.steps ?? []).join(" → ");
    btn.addEventListener("click", () => void runDeployAction({ operationKey: op.key, label: op.key }));
    opsEl.appendChild(btn);
  }
}

async function runDeployAction({ operationKey, freeCommand, label }) {
  const { consoleBackdrop } = panelEls;
  const output = consoleBackdrop.querySelector(".tool-output");
  output.textContent = `Running ${label}…`;
  const res = await sendMessageSafe({ type: "build-tracker-run-deploy", operationKey, freeCommand });
  if (!res?.ok) {
    output.textContent = `Error: ${res?.error ?? "unknown error"}`;
    return;
  }
  output.textContent = JSON.stringify(res.result, null, 2);
  const chatToggle = consoleBackdrop.querySelector('[data-action="console-chat-toggle"]');
  if (chatToggle.checked) insertTextIntoComposer(formatDeployResultForChat(label, res.result));
}

function wireDeployConsole() {
  const { consoleBackdrop } = panelEls;
  const input = consoleBackdrop.querySelector(".tool-input");
  const runBtn = consoleBackdrop.querySelector('[data-action="console-run"]');
  const chatToggle = consoleBackdrop.querySelector('[data-action="console-chat-toggle"]');
  wireChatToggle(chatToggle, "consoleSendToChat");
  runBtn.addEventListener("click", () => {
    const command = input.value.trim();
    if (!command) return;
    void runDeployAction({ freeCommand: command, label: command });
  });
}

/**
 * Git #737 follow-up — Shane: "if I search for a Issue number 686 it should
 * bring back the epic too so I can get to the chat." The browse view's
 * search only ever looked at the OPEN issue list — a landed/closed issue
 * like #686 is invisible to it entirely, no matter how exactly you type its
 * number. For a numeric query, this fetches straight from GitHub (same
 * lookup the hover cards use, same cache) and shows the issue's real title/
 * state/epic — plus a Go to Chat button if that epic has a linked chat —
 * regardless of whether it's still in the open list above.
 */
let searchLookupTimer = null;
let searchLookupToken = 0; // guards a slow lookup from overwriting a newer query's results

function scheduleSearchIssueLookup(q) {
  clearTimeout(searchLookupTimer);
  const bareNum = q.replace(/^#/, "");
  if (!/^\d{2,5}$/.test(bareNum)) return;
  const myToken = ++searchLookupToken;
  searchLookupTimer = setTimeout(() => {
    void (async () => {
      let info = issueRefCache.get(bareNum);
      if (!info) {
        const res = await sendMessageSafe({ type: "build-tracker-lookup-issue", number: Number(bareNum) });
        info = res?.ok ? res.result : { error: res?.error ?? "Not found" };
        issueRefCache.set(bareNum, info);
      }
      if (myToken !== searchLookupToken) return; // superseded by a newer keystroke
      renderSearchLookupResult(bareNum, info);
    })();
  }, 400);
}

function renderSearchLookupResult(num, info) {
  if (!panelEls || panelEls.panel.hidden || panelEls.search.style.display === "none") return;
  if (panelEls.search.value.trim().replace(/^#/, "") !== num) return; // query changed since this fired

  const { list } = panelEls;
  const card = document.createElement("div");

  if (info?.error) {
    card.innerHTML = `<div class="milestone">From GitHub</div><div class="empty">${escapeHtml(info.error)}</div>`;
    list.prepend(card);
    return;
  }

  const closed = info.state === "closed";
  const epicChat = info.epic
    ? (boardCache?.data?.chats ?? [])
        .filter((c) => c.epicId === info.epic.id)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] ?? null
    : null;

  card.innerHTML = `
    <div class="milestone">From GitHub — not necessarily in the list below</div>
    <div class="epic-row" style="cursor:default;">
      <span>#${num} ${escapeHtml(info.title)}</span>
      <span class="pill">${closed ? "closed" : "open"}</span>
    </div>
    ${info.epic
      ? `<div class="epic-row" style="padding-left:16px; cursor:default;"><span>Epic: ${escapeHtml(info.epic.title)}</span>${info.epic.githubNumber ? `<span class="pill">#${info.epic.githubNumber}</span>` : ""}</div>`
      : `<div class="empty">No epic tracked locally for this issue yet.</div>`}
  `;
  if (epicChat) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-op-btn";
    btn.style.cssText = "margin: 4px 0 8px 16px;";
    btn.textContent = `Go to Chat: ${epicChat.title}`;
    btn.addEventListener("click", () => { location.href = epicChat.claudeUrl; });
    card.appendChild(btn);
  }
  list.prepend(card);
}

// ── Browse Epics (Git #755 follow-up) ───────────────────────────────────────
// A flat, searchable list of every open epic, independent of milestones —
// clicking one shows its details right in the main panel via manualEpicView
// (see render()/renderFocused()), not a chat-jump like the navigator does.

function openEpicsBrowser() {
  const { epicsBackdrop, epicsSearch } = buildPanel();
  epicsBackdrop.hidden = false;
  epicsSearch.value = "";
  renderEpicsBrowserList("");
  epicsSearch.focus();
}

function renderEpicsBrowserList(query) {
  const { epicsBody } = panelEls;
  const q = (query ?? "").trim().toLowerCase();
  const epics = (boardCache?.data?.epics ?? [])
    .filter((e) => textMatches(e.title, e.githubNumber, q))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));

  epicsBody.innerHTML = "";
  if (epics.length === 0) {
    epicsBody.innerHTML = `<div class="empty">${q ? "No matches." : "No open epics."}</div>`;
    return;
  }
  for (const epic of epics) {
    const row = document.createElement("div");
    row.className = "epic-row";
    row.innerHTML = `<span>${escapeHtml(epic.title)}</span>${epic.githubNumber ? `<span class="pill">#${epic.githubNumber}</span>` : ""}`;
    row.addEventListener("click", () => viewEpicDetails(epic));
    epicsBody.appendChild(row);
  }
}

function viewEpicDetails(epic) {
  panelEls.epicsBackdrop.hidden = true;
  manualEpicView = epic;
  showAllOverride = false;
  render();
}

async function linkTo(target, label) {
  const conversationId = conversationIdFromUrl();
  if (!conversationId) return;
  const { current } = panelEls;
  current.textContent = `Linking to ${label}…`;
  const res = await sendMessageSafe({
    type: "build-tracker-ingest",
    conversationId,
    title: currentSettledTitle() || undefined,
    issueId: target.issueId,
    epicId: target.epicId,
    // Git #781 — Shane: "when I click on the Epic in a chat I already had
    // it's supposed to assign the chat to that epic... not working." The
    // server's non-clobbering rule (meant for the passive title-sync call)
    // was silently no-op'ing this explicit click too. This IS the deliberate
    // relink action the server's own doc comment says should be allowed.
    force: true,
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
  manualEpicView = null;
  if (!panelEls) return;
  if (!panelEls.panel.hidden) {
    loadBoard(true);
  } else if (!panelEls.ipPanel.hidden) {
    // Git #770 — the left In Progress panel's current-chat-epic highlight
    // reads boardCache.data.currentChat too now, so a chat switch with only
    // the left panel open (main panel closed) still needs a fresh board
    // fetch, or the highlight would keep showing the PREVIOUS chat's epic.
    // Quiet - no "Loading…" flash since the main list is hidden anyway.
    loadBoard(true, true).then(() => renderInProgressList());
  }
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
  const rowClick = onClick ?? (isComplete ? () => void closeIssueAndAnnounce(issue) : null);
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
    check.title = "Confirmed done in code — click to close the GitHub issue and tell Claude it landed";
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

  // Git #728 follow-up — "I only know their Issue number... how do I get
  // back to their chat." Same lookup the hover card uses; only shown when a
  // chat is actually linked (most issues aren't linked to any one chat).
  const linkedChat = issue.githubNumber != null ? findChatForIssueNumber(issue.githubNumber, issue.epicId) : null;
  if (linkedChat) {
    const gotoBtn = document.createElement("button");
    gotoBtn.type = "button";
    gotoBtn.className = "ibtn";
    gotoBtn.title = `Go to the linked chat: "${linkedChat.title}"`;
    gotoBtn.textContent = "💬";
    gotoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      location.href = linkedChat.claudeUrl;
    });
    actions.appendChild(gotoBtn);
  }

  if (issue.githubNumber) {
    const promptBtn = document.createElement("button");
    promptBtn.type = "button";
    promptBtn.className = "ibtn";
    promptBtn.title = isComplete
      ? `Close #${issue.githubNumber} on GitHub and tell Claude it landed`
      : "Insert a prompt for this issue into the chat box (you send it)";
    promptBtn.textContent = "➜";
    promptBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isComplete) void closeIssueAndAnnounce(issue);
      else insertPrompt(issue);
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

// ── 3. #N hover cards in claude.ai's own chat messages ──────────────────────
// Shane: "Claude Chat spits out Git numbers like I remember what all 700+
// are... underline it, hover over it, show me the Issue." Underlines every
// #N found in the page's own text (outside this shadow root — claude.ai's
// message DOM, not our own UI) and shows a small hover card fetched straight
// from GitHub, so a number never has to be memorized.

const ISSUE_REF_RE = /#(\d{2,5})\b/g;
const issueRefCache = new Map(); // number (string) -> lookup result | { error }
let tooltipHideTimer = null;

/** Shared by both scan modes — the inline `#N` regex match AND the bare-number table cell. `displayText` is what's shown ("#619" inline vs just "619" in a "#" column). */
function makeIssueRefSpan(num, displayText) {
  const span = document.createElement("span");
  span.className = "bt-issue-ref";
  span.dataset.num = num;
  span.textContent = displayText;
  // Inline styles, not a stylesheet — this span lives in claude.ai's own DOM
  // (outside our shadow root), so nothing else here would isolate it from
  // the page's own CSS.
  span.style.cssText = "border-bottom: 1px dotted #7fb4d8; cursor: help;";
  span.addEventListener("mouseenter", onIssueRefHover);
  span.addEventListener("mouseleave", onIssueRefUnhover);
  return span;
}

/** Splits a matching text node into text/span/text/… — spans wrap each #N. Idempotent by construction: once wrapped, the number lives inside a <span>, so a later re-walk of the same subtree just won't find it as plain text again. */
function wrapIssueRefsInTextNode(textNode) {
  const text = textNode.nodeValue;
  ISSUE_REF_RE.lastIndex = 0;
  if (!ISSUE_REF_RE.test(text)) return;
  ISSUE_REF_RE.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  let match;
  while ((match = ISSUE_REF_RE.exec(text))) {
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    frag.appendChild(makeIssueRefSpan(match[1], match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  textNode.parentNode.replaceChild(frag, textNode);
}

/**
 * Shane: "Another way it sends me git numbers" — a markdown table with a
 * bare "#" header column, e.g. "# | Title" then rows like "619 | ...", no
 * literal `#` character on the number itself. Regex text-matching can't
 * tell a bare "619" apart from any other 3-digit number in prose, so this
 * is detected structurally instead: a <table> whose first header cell is
 * literally "#" (or ends with one, e.g. "Git #") gets its first body-row
 * cell in each row treated as an issue number if it's purely digits.
 */
function scanForBareNumberTableRefs(root) {
  const tables = root.querySelectorAll ? root.querySelectorAll("table") : [];
  for (const table of tables) {
    const headerRow = table.querySelector("thead tr") ?? table.querySelector("tr");
    const headerCell = headerRow?.querySelector("th, td");
    const headerText = headerCell?.textContent.trim().toLowerCase() ?? "";
    if (headerText !== "#" && !headerText.endsWith("#")) continue;

    const bodyRows = table.querySelectorAll("tbody tr");
    const rows = bodyRows.length > 0 ? Array.from(bodyRows) : Array.from(table.querySelectorAll("tr")).slice(1);
    for (const row of rows) {
      const firstCell = row.querySelector("td, th");
      if (!firstCell || firstCell.querySelector(".bt-issue-ref")) continue; // already wrapped
      const text = firstCell.textContent.trim();
      if (!/^\d{2,5}$/.test(text)) continue;
      firstCell.textContent = "";
      firstCell.appendChild(makeIssueRefSpan(text, text));
    }
  }
}

/** Walks `root`'s light DOM for plain-text #N references — never descends into shadow roots (our own panel is naturally excluded), skips code/script/style so a real code snippet's "#123" never gets mangled. */
function scanForIssueRefs(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("pre, code, script, style, textarea")) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains("bt-issue-ref")) return NodeFilter.FILTER_REJECT;
      return ISSUE_REF_RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  // Collect first, then mutate — replacing nodes mid-walk confuses the TreeWalker.
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) wrapIssueRefsInTextNode(node);
  ISSUE_REF_RE.lastIndex = 0;
}

function positionTooltipNear(span) {
  const { issueTooltip } = buildPanel();
  const rect = span.getBoundingClientRect();
  issueTooltip.style.top = `${rect.bottom + 6}px`;
  issueTooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 316))}px`;
}

async function onIssueRefHover(e) {
  const span = e.currentTarget;
  const num = span.dataset.num;
  clearTimeout(tooltipHideTimer);

  const { issueTooltip } = buildPanel();
  issueTooltip.dataset.forNum = num;
  issueTooltip.innerHTML = `<div class="tt-title">Loading #${num}…</div>`;
  issueTooltip.hidden = false;
  positionTooltipNear(span);

  let info = issueRefCache.get(num);
  if (!info) {
    const res = await sendMessageSafe({ type: "build-tracker-lookup-issue", number: Number(num) });
    info = res?.ok ? res.result : { error: res?.error ?? "Not found" };
    issueRefCache.set(num, info);
  }
  // The pointer may have moved to a different #N (or left entirely) while
  // that lookup was in flight — only paint if this card is still the one showing.
  if (issueTooltip.hidden || issueTooltip.dataset.forNum !== num) return;
  renderIssueTooltip(info, num);
  positionTooltipNear(span); // title text just changed height — reposition
}

/**
 * Git #720 follow-up — Shane: "I should be able to close it right there, or
 * push a button to ask claude about that one item." Two independent
 * actions, deliberately not combined the way the panel's complete-row click
 * bundles close+announce — the tooltip works for ANY #N, not just
 * complete-labeled rows, so Shane picks whichever (or both) fits.
 */
/** The most recently updated chat linked to a given LOCAL epic id, or null if none. Shared by an epic's own chat lookup and an issue's fallback-to-its-epic lookup below. */
function chatForEpicId(epicId) {
  if (epicId == null) return null;
  const chats = boardCache?.data?.chats ?? [];
  const epicChats = chats.filter((c) => c.epicId === epicId);
  epicChats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return epicChats[0] ?? null;
}

/**
 * Git #728 follow-up — Shane: "I do something and while builds are going I
 * go to a new chat... now I have builds done... I only know their Issue
 * number... how do I get back to their chat." Finds the chat directly
 * linked to that GitHub number (board's `chats[].issueGithubNumber`, not
 * just an epic match) — works even after the issue's since closed, since
 * the server resolves that against every issue, not just open ones.
 *
 * Shane: "I am not seeing these new buttons" — because a chat almost never
 * links to one SPECIFIC issue in practice: linking only ever happens by
 * clicking an EPIC row (the focused view's own issue rows have no "link
 * this chat to just this issue" action at all), so the exact-issue match
 * this started with almost never fires. Falls back to the issue's EPIC's
 * own linked chat — the realistic common case, not a rare exception.
 * `epicIdHint`, when the caller already knows it (e.g. the In Progress
 * panel's own /extension/in-progress result), skips the boardCache lookup
 * entirely — needed for issues that aren't locally tracked at all.
 */
function findChatForIssueNumber(num, epicIdHint) {
  const n = Number(num);
  const chats = boardCache?.data?.chats ?? [];
  const direct = chats.find((c) => c.issueGithubNumber === n);
  if (direct) return direct;

  const epicId = epicIdHint ?? (boardCache?.data?.issues ?? []).find((i) => i.githubNumber === n)?.epicId ?? null;
  return chatForEpicId(epicId);
}

function goToChatButtonHtml(chat) {
  return chat ? `<button type="button" class="tt-btn" data-action="tt-goto">Go to Chat</button>` : "";
}

function wireGoToChatButton(container, chat) {
  const btn = container.querySelector('[data-action="tt-goto"]');
  if (btn) btn.addEventListener("click", () => { location.href = chat.claudeUrl; });
}

function renderIssueTooltip(info, num) {
  const { issueTooltip } = panelEls;
  const chat = findChatForIssueNumber(num, info?.epic?.id);
  if (info?.error) {
    // A failed lookup still shouldn't be a dead end — "Ask Claude"/"Go to
    // Chat" don't need any of the fetched data (Close/Reopen does, so
    // that's the one button that's genuinely unavailable here).
    issueTooltip.innerHTML = `
      <div class="tt-title">#${num}</div>
      <div class="tt-meta">${escapeHtml(info.error)}</div>
      <div class="tt-actions">
        <button type="button" class="tt-btn" data-action="tt-ask">Ask Claude</button>
        ${goToChatButtonHtml(chat)}
      </div>
    `;
    issueTooltip.querySelector('[data-action="tt-ask"]').addEventListener("click", () => {
      insertTextIntoComposer(`Let's look at Git #${num}...`);
    });
    wireGoToChatButton(issueTooltip, chat);
    return;
  }
  const closed = info.state === "closed";
  issueTooltip.innerHTML = `
    <div class="tt-title">#${num} ${escapeHtml(info.title)}</div>
    <div class="tt-meta${closed ? " closed" : ""}">${closed ? "closed" : "open"}${info.isEpic ? " · epic" : ""}${info.labels?.length ? " · " + info.labels.map(escapeHtml).join(", ") : ""}</div>
    <div class="tt-actions">
      <button type="button" class="tt-btn" data-action="tt-toggle">${closed ? "Reopen" : "Close"}</button>
      <button type="button" class="tt-btn" data-action="tt-ask">Ask Claude</button>
      ${goToChatButtonHtml(chat)}
    </div>
  `;
  issueTooltip.querySelector('[data-action="tt-toggle"]').addEventListener("click", () => void toggleIssueStateFromTooltip(info, num));
  issueTooltip.querySelector('[data-action="tt-ask"]').addEventListener("click", () => {
    insertTextIntoComposer(tooltipPromptText(info, num));
  });
  wireGoToChatButton(issueTooltip, chat);
}

/** Mirrors issuePromptText()'s own logic (complete → "landed", else → "let's look at") against the lookup's raw GitHub labels, since this isn't a board `issue` object. */
function tooltipPromptText(info, num) {
  if ((info.labels ?? []).includes("complete")) return `${num} landed`;
  return `Let's look at Git #${num}...`;
}

async function toggleIssueStateFromTooltip(info, num) {
  const { issueTooltip } = panelEls;
  const btn = issueTooltip.querySelector('[data-action="tt-toggle"]');
  const wasClosed = info.state === "closed";
  const newState = wasClosed ? "open" : "closed";
  btn.disabled = true;
  btn.textContent = "…";
  const res = await sendMessageSafe({ type: "build-tracker-set-issue-state", number: Number(num), state: newState });
  if (!res?.ok) {
    btn.disabled = false;
    btn.textContent = wasClosed ? "Reopen" : "Close";
    window.alert(`Couldn't update #${num}: ${res?.error ?? "unknown error"}`);
    return;
  }
  info.state = newState;
  issueRefCache.set(num, info);
  renderIssueTooltip(info, num);
  // Quiet — in case this number is also tracked/visible in the panel itself.
  if (boardCache) await loadBoard(true, true);
}

function onIssueRefUnhover() {
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = setTimeout(() => { panelEls.issueTooltip.hidden = true; }, 150);
}

// ── "Send to Builder" / "Load into SQL Runner" on Claude's own copy blocks ──
// Shane: "this button gets put on a copy block. If the copy block is a
// build prompt... execute [mybuilder://open?q=...&model=...&effort=...].
// If the button is a SQL script it should load in our SQL Floaty window."
// A small button bar goes ABOVE the block (not overlaid on it) specifically
// so it never fights claude.ai's own per-block copy button for the same
// corner.

const SQL_BLOCK_RE = /^\s*(--.*\n)*\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|BEGIN|GRANT|REVOKE)\b/i;

function classifyCodeBlock(text) {
  return SQL_BLOCK_RE.test(text) ? "sql" : "prompt";
}

function loadTextIntoSqlRunner(text) {
  openSqlRunner();
  const input = panelEls.sqlBackdrop.querySelector(".tool-input");
  input.value = text;
  input.focus();
}

/**
 * Shane's own prompts often start with a flags line like
 * `--model claude-opus-4-8 --effort high` before the real prompt text — Git
 * #761: "use that to set the proper parameters directly in the execute."
 * Only treats the FIRST line as flags (and strips it from the prompt body)
 * when that line is made up entirely of --flag value pairs, so a real
 * prompt that merely happens to contain "--" somewhere isn't misread.
 */
function extractLeadingFlags(text) {
  const newlineIdx = text.indexOf("\n");
  const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
  // Git #820 — [\w-] (not \w alone) so a hyphenated flag name like
  // --blocked-by actually matches. \w excludes "-", so "--blocked-by 805"
  // never matched at all; the whole-line guard below then bailed out and
  // returned the FULL unstripped text (flags line included) as the prompt.
  // Since that starts with "--model", claude.exe's own arg parser read the
  // positional prompt argument as an attempted (unrecognized) option and
  // refused to run at all — Git #820, "806 failed... exit 1".
  const flagRe = /--([\w-]+)\s+(\S+)/g;
  const flags = {};
  let matched;
  while ((matched = flagRe.exec(firstLine)) !== null) {
    flags[matched[1]] = matched[2];
  }
  if (Object.keys(flags).length === 0 || firstLine.replace(/--([\w-]+)\s+(\S+)/g, "").trim() !== "") {
    return { flags: {}, rest: text };
  }
  const rest = (newlineIdx === -1 ? "" : text.slice(newlineIdx + 1)).replace(/^\n+/, "");
  return { flags, rest };
}

/**
 * Receives the prompt text, builds a mybuilder://open?... URI carrying the
 * message payload `{ prompt, title, model, effort, cwd }` (URLSearchParams,
 * matching Shane's own spec) and navigates to it — the OS-registered
 * mybuilder:// handler (scripts/setup-extension-host.ps1) picks it up from
 * there and launches a local Claude Code session with the prompt
 * pre-filled. A leading `--model ... --effort ... --title ...` line in the
 * prompt itself (Git #761/#762) wins over the configured Options defaults,
 * since that's Shane saying THIS prompt needs specific parameters — title
 * has no Options-page default, it only ever comes from that leading line.
 */
async function sendToBuilder(prompt) {
  const { builderModel, builderEffort, builderCwd } = await chrome.storage.local.get([
    "builderModel", "builderEffort", "builderCwd",
  ]);
  const { flags, rest } = extractLeadingFlags(prompt);
  const params = new URLSearchParams();
  params.set("q", rest);
  const title = flags.title;
  const model = flags.model || builderModel;
  const effort = flags.effort || builderEffort;
  const cwd = flags.cwd || builderCwd;
  // Git #768 - a leading --mode flag (e.g. --mode manual) overrides
  // run-claude.ps1's own default of --permission-mode auto for one specific
  // prompt; no Options-page default needed since "auto" is already the
  // baseline on the runner side.
  const mode = flags.mode;
  if (title) params.set("title", title);
  if (model) params.set("model", model);
  if (effort) params.set("effort", effort);
  if (cwd) params.set("cwd", cwd);
  if (mode) params.set("mode", mode);
  window.location.href = `mybuilder://open?${params.toString()}`;
}

/**
 * Git #790/#813 — the "📋 Queue" button's handler. Same flag parsing as
 * sendToBuilder() (a leading --model/--effort/--cwd line still works
 * exactly the same way), plus a --blocked-by <number>[,<number>...] flag
 * specific to queuing — a build launched right now can't usefully declare
 * "wait for X," but a QUEUED one can, since the watcher won't claim it
 * until every listed blocker clears. Comma-separated (Shane: "--blocked-by
 * 807,808,809") — earlier this silently dropped to "no blocker" whenever it
 * wasn't a single bare number; now it's parsed for real, and anything that
 * doesn't parse as a number at all surfaces an alert instead of vanishing.
 */
async function queueBuildFromBlock(prompt, referencedNumber, btn) {
  const { builderModel, builderEffort, builderCwd } = await chrome.storage.local.get([
    "builderModel", "builderEffort", "builderCwd",
  ]);
  const { flags, rest } = extractLeadingFlags(prompt);
  const model = flags.model || builderModel || null;
  const effort = flags.effort || builderEffort || null;
  const cwd = flags.cwd || builderCwd || null;
  let blockedByNumbers = null;
  if (flags["blocked-by"]) {
    const parts = flags["blocked-by"].split(",").map((s) => s.trim()).filter(Boolean);
    const nums = parts.filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));
    if (nums.length !== parts.length) {
      window.alert(`--blocked-by "${flags["blocked-by"]}" has a non-numeric entry — fix it and try again (comma-separate multiple issue numbers, e.g. --blocked-by 807,808,809).`);
      return;
    }
    blockedByNumbers = nums;
  }
  const title = flags.title
    ? (referencedNumber != null ? `#${referencedNumber} — ${flags.title}` : flags.title)
    : (referencedNumber != null ? `#${referencedNumber}` : rest.split("\n")[0].slice(0, 80));

  btn.disabled = true;
  const original = btn.textContent;
  const res = await sendMessageSafe({
    type: "build-tracker-queue-build",
    item: { title, prompt: rest, model, effort, cwd, githubNumber: referencedNumber, blockedByNumbers },
  });
  btn.disabled = false;
  if (!res?.ok) {
    window.alert(`Couldn't queue build: ${res?.error ?? "unknown error"}`);
    return;
  }
  btn.textContent = "✓ Queued";
  setTimeout(() => { btn.textContent = original; }, 2000);
  void loadQueue(true);
}

/**
 * Git #769 — Shane: on the Browse Epics screen, an epic with no chat linked
 * yet should offer a link straight to a new chat in his Build Tracker
 * project, pre-filled with "Epic #N" and (his explicit, repeated ask) a
 * token he pastes in himself. That token is NOT the server's own
 * GITHUB_TOKEN (never exposed to the browser) — it's a separate,
 * purpose-scoped PAT Shane configures himself in this extension's Options
 * page and rotates/invalidates on his own schedule, stored only in
 * chrome.storage.local (this browser profile, never transmitted anywhere
 * except the claude.ai tab HE explicitly opens).
 */
async function openNewEpicChat(epic) {
  const { epicChatProjectUrl, epicChatToken } = await chrome.storage.local.get([
    "epicChatProjectUrl", "epicChatToken",
  ]);
  if (!epicChatProjectUrl) {
    window.alert('Set a "New chat project URL" in the extension\'s Options page first.');
    return;
  }
  let url;
  try {
    url = new URL(epicChatProjectUrl);
  } catch {
    window.alert("The configured New chat project URL isn't valid.");
    return;
  }
  const label = epic.githubNumber != null ? `Epic #${epic.githubNumber}` : `Epic ${epic.title}`;
  const text = epicChatToken ? `${label}\r\n${epicChatToken}` : label;
  url.searchParams.set(EPIC_CHAT_PREFILL_PARAM, text);
  window.open(url.toString(), "_blank");
}

/**
 * The other half of openNewEpicChat() above — runs on EVERY page load
 * (including the fresh https://claude.ai/cowork/project/... tab that opens
 * to), checks for a bt_prefill param left in the URL, and once the
 * composer actually exists (a brand-new tab needs the whole SPA to boot
 * first, so this polls rather than assuming it's ready immediately) inserts
 * it via the same insertTextIntoComposer() the Send to Builder/SQL buttons
 * already use. Strips the param afterward so a reload/back doesn't
 * re-insert it.
 */
function tryInsertPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get(EPIC_CHAT_PREFILL_PARAM);
  if (!text) return;
  let attempts = 0;
  const maxAttempts = 30; // ~15s at 500ms — a fresh tab's SPA boot is slower than an already-open one
  const tryInsert = () => {
    attempts++;
    const composer = findComposer();
    if (composer) {
      insertTextIntoComposer(text);
      const url = new URL(window.location.href);
      url.searchParams.delete(EPIC_CHAT_PREFILL_PARAM);
      history.replaceState(null, "", url.toString());
      // Git #772 — the prefill's first line is always the "Epic #N" label
      // (see openNewEpicChat) - reuse it as the chat's own title too, so
      // Shane doesn't have to rename it by hand right after.
      const label = text.split("\r\n")[0];
      if (label) void renameCurrentChat(label);
      return;
    }
    if (attempts < maxAttempts) setTimeout(tryInsert, 500);
  };
  tryInsert();
}

/**
 * Git #783 — Shane: "If its already in flight, change the button to
 * disabled and In Flight. If its Done, change the button to disabled &
 * Done." A build-prompt block's --title flag (or, failing that, the first
 * bare #N in the text) is treated as the issue/epic it's for; its real
 * label state comes from the SAME inProgressCache the left panel already
 * polls every 15s (Git #701), so this stays current without its own fetch.
 */
function extractReferencedIssueNumber(text) {
  const { flags } = extractLeadingFlags(text);
  if (flags.title && /^\d+$/.test(flags.title)) return parseInt(flags.title, 10);
  const m = text.match(/#(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Every "Send to Builder" button tied to a detected issue/epic number — kept in sync by updateCodeBlockButtonStates() on every inProgressCache refresh. */
let codeBlockSmartButtons = [];

function applyCodeBlockButtonState(entry) {
  const item = (inProgressCache?.issues ?? []).find((i) => i.githubNumber === entry.number);
  const state = issueLabelState({ labels: item?.labels ?? [] });
  const { btn } = entry;
  if (state === "complete") {
    btn.disabled = true;
    btn.textContent = "✓ Done";
    btn.style.background = "rgba(127,174,145,.18)";
    btn.style.color = "#9fd4b3";
    btn.style.cursor = "default";
  } else if (state === "in-flight") {
    btn.disabled = true;
    btn.textContent = "⏳ In Flight";
    btn.style.background = "rgba(242,202,99,.14)";
    btn.style.color = "#f2ca63";
    btn.style.cursor = "default";
  } else {
    btn.disabled = false;
    btn.textContent = "🚀 Send to Builder";
    btn.style.background = "#242424";
    btn.style.color = "#d6d4d2";
    btn.style.cursor = "pointer";
  }
}

function updateCodeBlockButtonStates() {
  for (const entry of codeBlockSmartButtons) applyCodeBlockButtonState(entry);
}

/** Shared by both the above- and below-block bars (Git #777) so the two never drift apart in styling/behavior. */
function buildCodeBlockButtonBar(kind, text, marginSide, referencedNumber) {
  const bar = document.createElement("div");
  bar.style.cssText = `display: flex; justify-content: flex-end; gap: 6px; margin-${marginSide}: 4px;`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = kind === "sql" ? "🗄 Load into SQL Runner" : "🚀 Send to Builder";
  btn.style.cssText =
    "padding: 3px 10px; border-radius: 5px; border: 1px solid #3b3b3b; background: #242424; " +
    "color: #d6d4d2; font-size: 11px; font-weight: 600; cursor: pointer; font-family: -apple-system, sans-serif;";
  btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.background = "#2e2e2e"; });
  btn.addEventListener("mouseleave", () => { if (!btn.disabled) btn.style.background = "#242424"; });
  btn.addEventListener("click", () => {
    if (kind === "sql") loadTextIntoSqlRunner(text);
    else void sendToBuilder(text);
  });
  bar.appendChild(btn);
  if (kind === "prompt" && referencedNumber != null) {
    const entry = { number: referencedNumber, btn };
    codeBlockSmartButtons.push(entry);
    applyCodeBlockButtonState(entry);
  }
  // Git #790 — Shane: "if we could really build me a true queued up
  // build... that would speed up my development time like mad." An
  // alternative to launching right now: park it on the queue instead, for
  // scripts/build-queue-watcher.ps1 to pick up when a slot frees.
  if (kind === "prompt") {
    const queueBtn = document.createElement("button");
    queueBtn.type = "button";
    queueBtn.textContent = "📋 Queue";
    queueBtn.title = "Add to the build queue instead of launching now";
    queueBtn.style.cssText =
      "padding: 3px 10px; border-radius: 5px; border: 1px solid #3b3b3b; background: #242424; " +
      "color: #d6d4d2; font-size: 11px; font-weight: 600; cursor: pointer; font-family: -apple-system, sans-serif;";
    queueBtn.addEventListener("mouseenter", () => { queueBtn.style.background = "#2e2e2e"; });
    queueBtn.addEventListener("mouseleave", () => { queueBtn.style.background = "#242424"; });
    queueBtn.addEventListener("click", () => void queueBuildFromBlock(text, referencedNumber, queueBtn));
    bar.appendChild(queueBtn);
  }
  return bar;
}

function scanForCodeBlockButtons(root) {
  const blocks = root.querySelectorAll ? root.querySelectorAll("pre") : [];
  for (const pre of blocks) {
    if (pre.dataset.btScanned || !pre.parentElement) continue;
    pre.dataset.btScanned = "1";
    const text = (pre.innerText ?? pre.textContent ?? "").trim();
    if (!text) continue;

    const kind = classifyCodeBlock(text);
    const referencedNumber = kind === "prompt" ? extractReferencedIssueNumber(text) : null;
    pre.parentElement.insertBefore(buildCodeBlockButtonBar(kind, text, "bottom", referencedNumber), pre);
    // Git #777 — Shane: "can you put the Send to Builder at the bottom of
    // the copy block too?" A long build prompt means scrolling all the way
    // back up just to click the button he already read past.
    pre.parentElement.insertBefore(buildCodeBlockButtonBar(kind, text, "top", referencedNumber), pre.nextSibling);
  }
}

// Debounced so a burst of DOM mutations (Claude streaming a response in)
// triggers one rescan after things settle, not one per keystroke-sized chunk.
let scanDebounceTimer = null;
function scheduleIssueRefScan() {
  clearTimeout(scanDebounceTimer);
  scanDebounceTimer = setTimeout(() => {
    scanForIssueRefs(document.body);
    scanForBareNumberTableRefs(document.body);
    scanForCodeBlockButtons(document.body);
  }, 600);
}
new MutationObserver(scheduleIssueRefScan).observe(document.body, { childList: true, subtree: true, characterData: true });
scheduleIssueRefScan(); // catch whatever's already on the page (e.g. a hard reload mid-conversation)

// Build the panel shell once on load, then open it by default (see
// togglePanel's doc comment) — unlike before, this now does hit the API
// immediately rather than waiting for a click, since "open by default" only
// works if it's actually showing real data.
buildPanel();
void initPanelVisibility();
void initInProgressVisibility();
tryInsertPrefillFromUrl();

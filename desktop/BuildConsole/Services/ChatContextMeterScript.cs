namespace BuildConsole.Services
{
    /// <summary>
    /// JavaScript content-script equivalent to scrape turn count and character length
    /// per turn from the claude.ai DOM.
    /// </summary>
    public static class ChatContextMeterScript
    {
        public const string Script = """
(function () {
  if (window.__bcChatContextMeterInjected) return;
  window.__bcChatContextMeterInjected = true;

  // Git #2808 — the context meter is only meaningful for the top-level claude.ai chat document.
  // This script is added via AddScriptToExecuteOnDocumentCreatedAsync, which WebView2 runs in
  // EVERY frame (any ad/analytics/embed iframe included). A subframe's location.pathname is never
  // /chat/<uuid>, so it computes a null conversation id and posts a BT_CHAT_STATS the host then
  // can't persist (ChatContextMeterStore.Merge is skipped on an empty id) — and, worse, that
  // subframe reading would also overwrite the live in-memory meter with junk. Both are real
  // candidates for the "store never written / Band 1 frozen at the 40k floor" symptom #2808 is
  // chasing across three attempts. Only ever run the meter in the real top frame.
  try { if (window.top !== window.self) return; } catch (e) { /* cross-origin frame: definitely not the top chat doc */ return; }

  // Git #1628 — the meter used to recompute its whole total from whatever was
  // MOUNTED on each 2s poll, so any DOM churn (a heavy turn scrolling out of the
  // virtualization window, a mid-render/streaming poll, a re-render dropping the
  // aria-setsize signal to 0) moved the bar in either direction, including DOWN,
  // even though a real transcript only ever grows. The fix is a persistent in-page
  // ACCUMULATOR keyed by stable per-message identity and by conversation id: a row's
  // observed length is recorded once and NEVER deleted when that row unmounts, and
  // the meter reports the sum of the accumulator, not the sum of what happens to be
  // mounted right now. A genuinely different conversation id resets it; a re-render
  // of the same id never does.
  function conversationId() {
    // Same /chat/<uuid> shape used host-side at MainWindow.xaml.cs:1871.
    const m = /\/chat\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(location.pathname);
    return m ? m[1] : null;
  }

  function store() {
    const convId = conversationId();
    let s = window.__bcCtxStore;
    if (!s || s.convId !== convId) {
      // New (or first) conversation — start clean. This is the ONLY thing that
      // resets accumulated state; a re-render of the same id reuses the store.
      s = window.__bcCtxStore = {
        convId: convId,
        observedChars: Object.create(null), // stable-identity key -> max observed char length
        observedHeavy: Object.create(null), // stable-identity key -> true once ever heavy
        trueTotal: 0,                        // high-water aria-setsize (conversation's real turn total)
        hwChar: 0,                           // per-conversation monotonic high-water char total
        hwTurn: 0,                           // per-conversation monotonic high-water turn count
        hwHeavy: 0                           // per-conversation monotonic high-water heavy-turn count
      };
    }
    return s;
  }

  function isHeavy(el, txtLen) {
    return txtLen > 4000 || el.querySelector('pre') !== null || el.querySelector('code') !== null;
  }

  function countStats() {
    const s = store();

    // Git #2808 — LINK 1 diagnostic: emit the REAL pathname/href and the conversation id THIS
    // script actually computed, once per distinct pathname (rare — only on navigation, so not
    // per-poll spam). The host logs it (ChatWv_WebMessageReceived → ActivityLog, channel
    // system.core.chat-context), so on the next live occurrence Shane can read the log and see at
    // a glance whether link 1 (this scraper) is alive AND whether it derived a real conversation
    // id — the exact key the whole write chain (UpdateContextMeter → ChatContextMeterStore.Merge)
    // persists under. A null id here is precisely why the store stays empty and Band 1 sits at the
    // 40k floor with "Messages: —", even with #2781's + #2802's fixes both present.
    try {
      if (window.__bcCtxDiagPath !== location.pathname) {
        window.__bcCtxDiagPath = location.pathname;
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'BT_CHAT_METER_DIAG',
          pathname: location.pathname,
          href: location.href,
          conversationId: s.convId,
          matched: s.convId != null
        }));
      }
    } catch (e) {}

    // Git #1436 — content selectors (specific class/testid hooks first, structural
    // fallbacks after). Kept for the stale-selector self-diagnostic below, which is
    // deliberately keyed off the MOUNTED content-selector count so a genuine markup
    // rename still surfaces honestly, independent of the aria-setsize signal.
    const contentSelectors = [
      '.font-user-message',
      '.font-claude-message',
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid^="conversation-turn"]',
      '[data-test-render-count]'
    ].join(', ');
    const mountedTurnCount = document.querySelectorAll(contentSelectors).length;

    // Primary identity carriers: message articles carry a real aria-posinset (the
    // turn's stable 1-based position) AND aria-setsize (the conversation's true
    // total), regardless of what's virtualized away (Git #1468). Accumulate each
    // mounted article's observed length under its posinset key; never delete a key
    // when the row unmounts.
    const articles = Array.from(document.querySelectorAll('[role="article"][aria-posinset]'));
    articles.forEach(el => {
      const pos = parseInt(el.getAttribute('aria-posinset'), 10);
      if (isNaN(pos)) return;
      const key = 'p' + pos;
      const txt = (el.innerText || el.textContent || "").trim();
      const len = txt.length;
      // Monotonic per key: a streaming turn only grows, and a transiently-empty
      // mid-render read must never shrink an already-observed length.
      if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
      if (isHeavy(el, len)) s.observedHeavy[key] = true;

      const setsize = parseInt(el.getAttribute('aria-setsize'), 10);
      if (!isNaN(setsize) && setsize > s.trueTotal) s.trueTotal = setsize;
    });

    // Fallback ONLY when the aria markup is entirely absent (no article carries
    // aria-posinset at all): key by the mounted transcript-row's index. This is the
    // best available identity when the primary signal is gone; it is intentionally
    // narrow so it can't double-count against the posinset keys above.
    if (articles.length === 0) {
      const rows = Array.from(document.querySelectorAll('[data-testid="transcript-row"]'));
      rows.forEach((row, i) => {
        const txt = (row.innerText || row.textContent || "").trim();
        const len = txt.length;
        if (len === 0) return;
        const key = 'r' + i;
        if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
        if (isHeavy(row, len)) s.observedHeavy[key] = true;
      });
      // aria-setsize text fallback ("Message 1228 of 1238") when no attribute carries it.
      if (s.trueTotal === 0) {
        const labelled = document.querySelector('[aria-label*=" of "]');
        if (labelled) {
          const lm = /of\s+(\d+)/.exec(labelled.getAttribute('aria-label') || '');
          if (lm) { const n = parseInt(lm[1], 10) || 0; if (n > s.trueTotal) s.trueTotal = n; }
        }
      }
    }

    // Sum the ACCUMULATOR (everything ever observed for this conversation), not the
    // mounted tail.
    const keys = Object.keys(s.observedChars);
    const observedCount = keys.length;
    let observedSum = 0;
    for (const k of keys) observedSum += s.observedChars[k];
    let observedHeavy = 0;
    for (const k of Object.keys(s.observedHeavy)) if (s.observedHeavy[k]) observedHeavy++;

    // Extrapolate ONLY for turns evicted before the meter ever observed them (opening
    // an existing long chat partway, so its earliest turns were never mounted while we
    // watched). observedSum + avgObserved × (trueTotal − observedCount) — NOT
    // avgObserved × trueTotal, which would re-estimate turns we already measured exactly.
    const avgObserved = observedCount > 0 ? observedSum / observedCount : 0;
    const unobserved = Math.max(0, s.trueTotal - observedCount);
    const estCharCount = observedSum + avgObserved * unobserved;
    const turnCount = Math.max(s.trueTotal, observedCount);
    const heavyEstimate = observedHeavy + (observedCount > 0
      ? Math.round((observedHeavy / observedCount) * unobserved)
      : 0);

    // Per-conversation monotonic high-water clamp: a transcript only grows, so a lower
    // reading is always a measurement artifact, never real. The accumulator already
    // never shrinks per key, but the extrapolation term can wobble as the average
    // shifts — the high-water is the belt-and-suspenders floor. The host clamps too.
    if (estCharCount > s.hwChar) s.hwChar = estCharCount;
    if (turnCount > s.hwTurn) s.hwTurn = turnCount;
    if (heavyEstimate > s.hwHeavy) s.hwHeavy = heavyEstimate;

    // Git #1436 — self-diagnostic: if this looks like a real, populated chat page but
    // every MOUNTED content selector found zero turns for a sustained run, the scraper
    // is silently broken (renamed class/testid) rather than genuinely looking at an
    // empty chat. Keyed off mountedTurnCount (content selectors), independent of the
    // aria-setsize/accumulator signal, so a real markup rename still surfaces.
    const bodyLen = (document.body && (document.body.innerText || document.body.textContent) || "").length;
    const looksLikeRealChat = /\/chat\//.test(location.pathname) && bodyLen > 500;
    if (mountedTurnCount === 0 && looksLikeRealChat) {
      window.__bcZeroTurnTicks = (window.__bcZeroTurnTicks || 0) + 1;
    } else {
      window.__bcZeroTurnTicks = 0;
    }
    const selectorsLikelyStale = window.__bcZeroTurnTicks >= 5;

    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_CHAT_STATS',
        conversationId: s.convId,
        turnCount: s.hwTurn,
        charCount: Math.round(s.hwChar),
        heavyTurnCount: s.hwHeavy,
        selectorsLikelyStale: selectorsLikelyStale
      }));
    } catch(e) {}
  }

  // Poll DOM stats every 2 seconds
  setInterval(countStats, 2000);
  countStats();
})();
""";
    }
}

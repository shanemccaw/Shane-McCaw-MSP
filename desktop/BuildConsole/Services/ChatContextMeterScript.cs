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
    // Git #3167 — this is re-read on EVERY poll (via store()), so a tab that started on
    // /new correctly picks up its real id the moment claude.ai's router flips the URL to
    // /chat/<uuid>. The frozen-gauge root cause was NOT a memoised/one-shot read — it was
    // this regex being malformed: a UUID is 8-4-4-4-12 (five hyphen-separated groups) and
    // this pattern had only 8-4-4-12 (four groups, one {4} group missing), so it returned
    // null for EVERY well-formed /chat/<uuid> pathname. The [link 1] diagnostic proved it
    // live: pathname='/chat/110b8198-222f-40dd-8b9a-493b399c3246' → convId=<NULL>. With the
    // id always null, ChatContextMeterStore.Merge was skipped forever and the store was
    // never written. Use the real 5-group UUID shape — the same one the working chat-
    // association regexes already use (MainWindow.xaml.cs ExtractConversationId ~4912).
    const m = /\/chat\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(location.pathname);
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
        observedWords: Object.create(null), // Git #3724 — stable-identity key -> max observed word count
        observedHeavy: Object.create(null), // stable-identity key -> true once ever heavy
        trueTotal: 0,                        // high-water aria-setsize (conversation's real turn total)
        hwChar: 0,                           // per-conversation monotonic high-water char total
        hwWord: 0,                           // Git #3724 — per-conversation monotonic high-water word total
        hwHeavyChar: 0,                      // Git #3724 — per-conversation monotonic high-water HEAVY-turn char total (code/JSON tokenizes denser per char than prose — kept separate so the host can weight it differently instead of one flat chars/4)
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
      // Git #3724 — textContent FIRST, not innerText. innerText respects CSS layout/visibility
      // (display:none, collapsed height:0/overflow:hidden accordions, etc.), so a real turn
      // containing a COLLAPSED tool-use/tool-result block (claude.ai renders these as
      // collapsible disclosure widgets, collapsed by default) would have that content silently
      // excluded from innerText even though it's genuinely part of the turn's real token cost.
      // textContent walks every text node regardless of visibility, so it captures collapsed
      // content too. This is a mechanical DOM-API fact, true independent of claude.ai's exact
      // markup/class names — it does not require live-confirming the specific tool-block
      // structure (this session had no way to do that; see the build-journal note on #3724).
      const txt = (el.textContent || el.innerText || "").trim();
      const len = txt.length;
      const words = len > 0 ? (txt.match(/\S+/g) || []).length : 0;
      // Monotonic per key: a streaming turn only grows, and a transiently-empty
      // mid-render read must never shrink an already-observed length.
      if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
      if (words > (s.observedWords[key] || 0)) s.observedWords[key] = words;
      if (isHeavy(el, len)) s.observedHeavy[key] = true;

      const setsize = parseInt(el.getAttribute('aria-setsize'), 10);
      if (!isNaN(setsize) && setsize > s.trueTotal) s.trueTotal = setsize;
    });

    // Git #3724 — defensive net for tool-use/tool-result content that might render as a
    // structurally SEPARATE element from message articles rather than nested inside one (a
    // real possibility this issue raised: claude.ai may render a tool call/result as its own
    // block outside the [role="article"] the scraper already walks above). This session had no
    // live-DOM way to confirm one way or the other (no browser/DOM-inspection tool is reachable
    // from a Claude Code build session — see AGENT_PROTOCOLS.md's real surface), so this is a
    // best-effort, UNVERIFIED-against-live-markup addition, not a confirmed fix. el.closest()
    // guards against double-counting the more likely case (a tool block nested INSIDE its turn's
    // own article), where the textContent walk above already includes it.
    const toolBlockSelectors = [
      '[data-testid*="tool" i]',
      '[data-testid*="mcp" i]',
      '[aria-label*="tool" i]'
    ].join(', ');
    Array.from(document.querySelectorAll(toolBlockSelectors)).forEach((el, i) => {
      if (el.closest('[role="article"][aria-posinset]')) return; // already counted above
      const txt = (el.textContent || "").trim();
      if (txt.length === 0) return;
      const key = 'tb' + i;
      const len = txt.length;
      const words = (txt.match(/\S+/g) || []).length;
      if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
      if (words > (s.observedWords[key] || 0)) s.observedWords[key] = words;
      if (isHeavy(el, len)) s.observedHeavy[key] = true;
    });

    // Fallback ONLY when the aria markup is entirely absent (no article carries
    // aria-posinset at all): key by the mounted transcript-row's index. This is the
    // best available identity when the primary signal is gone; it is intentionally
    // narrow so it can't double-count against the posinset keys above.
    if (articles.length === 0) {
      const rows = Array.from(document.querySelectorAll('[data-testid="transcript-row"]'));
      rows.forEach((row, i) => {
        // Git #3724 — textContent first, same reasoning as the primary article walk above.
        const txt = (row.textContent || row.innerText || "").trim();
        const len = txt.length;
        if (len === 0) return;
        const key = 'r' + i;
        const words = (txt.match(/\S+/g) || []).length;
        if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
        if (words > (s.observedWords[key] || 0)) s.observedWords[key] = words;
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
    let observedWordSum = 0;          // Git #3724
    let observedHeavyCharSum = 0;     // Git #3724 — chars belonging to heavy (code/JSON-flagged) keys only
    for (const k of keys) {
      observedSum += s.observedChars[k];
      observedWordSum += (s.observedWords[k] || 0);
      if (s.observedHeavy[k]) observedHeavyCharSum += s.observedChars[k];
    }
    let observedHeavy = 0;
    for (const k of Object.keys(s.observedHeavy)) if (s.observedHeavy[k]) observedHeavy++;

    // Extrapolate ONLY for turns evicted before the meter ever observed them (opening
    // an existing long chat partway, so its earliest turns were never mounted while we
    // watched). observedSum + avgObserved × (trueTotal − observedCount) — NOT
    // avgObserved × trueTotal, which would re-estimate turns we already measured exactly.
    const avgObserved = observedCount > 0 ? observedSum / observedCount : 0;
    const avgWordObserved = observedCount > 0 ? observedWordSum / observedCount : 0;          // Git #3724
    const avgHeavyCharObserved = observedCount > 0 ? observedHeavyCharSum / observedCount : 0; // Git #3724
    const unobserved = Math.max(0, s.trueTotal - observedCount);
    const estCharCount = observedSum + avgObserved * unobserved;
    const estWordCount = observedWordSum + avgWordObserved * unobserved;           // Git #3724
    const estHeavyCharCount = observedHeavyCharSum + avgHeavyCharObserved * unobserved; // Git #3724
    const turnCount = Math.max(s.trueTotal, observedCount);
    const heavyEstimate = observedHeavy + (observedCount > 0
      ? Math.round((observedHeavy / observedCount) * unobserved)
      : 0);

    // Per-conversation monotonic high-water clamp: a transcript only grows, so a lower
    // reading is always a measurement artifact, never real. The accumulator already
    // never shrinks per key, but the extrapolation term can wobble as the average
    // shifts — the high-water is the belt-and-suspenders floor. The host clamps too.
    if (estCharCount > s.hwChar) s.hwChar = estCharCount;
    if (estWordCount > s.hwWord) s.hwWord = estWordCount;                    // Git #3724
    if (estHeavyCharCount > s.hwHeavyChar) s.hwHeavyChar = estHeavyCharCount; // Git #3724
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
        wordCount: Math.round(s.hwWord),           // Git #3724 — word-aware estimate input
        heavyCharCount: Math.round(s.hwHeavyChar), // Git #3724 — code/JSON-flagged chars, tokenize denser than prose
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

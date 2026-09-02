namespace ShaneBuilder.Services;

/// <summary>
/// Git #2325 (Feature #2318 item 9) — real DOM-based transcript-size estimator, ported from
/// <c>desktop/BuildConsole/Services/ChatContextMeterScript.cs</c> (proven, landed infra —
/// Git #1436/#1468/#1628). Before this, ShaneBuilder's own <c>UpdateContextGauge()</c>
/// (MainWindow.xaml.cs §2, Git #2209) explicitly estimated context from the COMPOSER DRAFT plus a
/// fixed 40k overhead — an honest placeholder, not a real reading, because "the transcript's own
/// length isn't reachable without a full DOM read" (its own comment). This script is that DOM
/// read: it scrapes claude.ai's own message markup for real per-turn character counts and posts
/// them back to the host via <c>window.chrome.webview.postMessage</c>.
///
/// Renamed message type (<c>SB_CHAT_STATS</c> vs. BuildConsole's <c>BT_CHAT_STATS</c>) and injected
/// flag (<c>__sbChatContextMeterInjected</c>) so the two apps' scripts can never collide if a chat
/// page is ever shared between them; the scraping logic itself is unchanged since it targets the
/// same claude.ai DOM both apps embed.
/// </summary>
public static class ChatContextMeterScript
{
    public const string Script = """
(function () {
  if (window.__sbChatContextMeterInjected) return;
  window.__sbChatContextMeterInjected = true;

  // Git #1628 (ported) — accumulate per-message length under a STABLE identity key so DOM
  // virtualization (a turn scrolling out of the mounted window) never drags the total back down.
  // A transcript only ever grows; only a genuinely different conversation id resets the store.
  function conversationId() {
    const m = /\/chat\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(location.pathname);
    return m ? m[1] : null;
  }

  function store() {
    const convId = conversationId();
    let s = window.__sbCtxStore;
    if (!s || s.convId !== convId) {
      s = window.__sbCtxStore = {
        convId: convId,
        observedChars: Object.create(null),
        trueTotal: 0,
        hwChar: 0,
        hwTurn: 0
      };
    }
    return s;
  }

  function countStats() {
    const s = store();

    const contentSelectors = [
      '.font-user-message',
      '.font-claude-message',
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid^="conversation-turn"]'
    ].join(', ');
    const mountedTurnCount = document.querySelectorAll(contentSelectors).length;

    const articles = Array.from(document.querySelectorAll('[role="article"][aria-posinset]'));
    articles.forEach(el => {
      const pos = parseInt(el.getAttribute('aria-posinset'), 10);
      if (isNaN(pos)) return;
      const key = 'p' + pos;
      const txt = (el.innerText || el.textContent || "").trim();
      const len = txt.length;
      if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;

      const setsize = parseInt(el.getAttribute('aria-setsize'), 10);
      if (!isNaN(setsize) && setsize > s.trueTotal) s.trueTotal = setsize;
    });

    if (articles.length === 0) {
      const rows = Array.from(document.querySelectorAll('[data-testid="transcript-row"]'));
      rows.forEach((row, i) => {
        const txt = (row.innerText || row.textContent || "").trim();
        const len = txt.length;
        if (len === 0) return;
        const key = 'r' + i;
        if (len > (s.observedChars[key] || 0)) s.observedChars[key] = len;
      });
      if (s.trueTotal === 0) {
        const labelled = document.querySelector('[aria-label*=" of "]');
        if (labelled) {
          const lm = /of\s+(\d+)/.exec(labelled.getAttribute('aria-label') || '');
          if (lm) { const n = parseInt(lm[1], 10) || 0; if (n > s.trueTotal) s.trueTotal = n; }
        }
      }
    }

    const keys = Object.keys(s.observedChars);
    const observedCount = keys.length;
    let observedSum = 0;
    for (const k of keys) observedSum += s.observedChars[k];

    // Extrapolate ONLY for turns evicted before the meter ever observed them (a long chat opened
    // partway through) — never re-estimate turns already measured exactly.
    const avgObserved = observedCount > 0 ? observedSum / observedCount : 0;
    const unobserved = Math.max(0, s.trueTotal - observedCount);
    const estCharCount = observedSum + avgObserved * unobserved;
    const turnCount = Math.max(s.trueTotal, observedCount);

    if (estCharCount > s.hwChar) s.hwChar = estCharCount;
    if (turnCount > s.hwTurn) s.hwTurn = turnCount;

    // Git #1436 (ported) — self-diagnostic: a real, populated chat page with zero mounted turns for
    // a sustained run means the selectors likely went stale (claude.ai markup rename), not that the
    // chat is genuinely empty.
    const bodyLen = (document.body && (document.body.innerText || document.body.textContent) || "").length;
    const looksLikeRealChat = /\/chat\//.test(location.pathname) && bodyLen > 500;
    if (mountedTurnCount === 0 && looksLikeRealChat) {
      window.__sbZeroTurnTicks = (window.__sbZeroTurnTicks || 0) + 1;
    } else {
      window.__sbZeroTurnTicks = 0;
    }
    const selectorsLikelyStale = window.__sbZeroTurnTicks >= 5;

    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'SB_CHAT_STATS',
        conversationId: s.convId,
        turnCount: s.hwTurn,
        charCount: Math.round(s.hwChar),
        selectorsLikelyStale: selectorsLikelyStale
      }));
    } catch (e) {}
  }

  setInterval(countStats, 2000);
  countStats();
})();
""";
}

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

  function countStats() {
    // Claude conversation message selectors (covers different markup versions).
    // Git #1436 — claude.ai's markup drifts under Shane; this list is layered
    // (specific class/testid hooks first, structural fallbacks after) so a
    // single renamed class doesn't zero out the whole meter. Fallbacks are
    // additive only — they widen the match set, never narrow it.
    const selectors = [
      '.font-user-message',
      '.font-claude-message',
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid^="conversation-turn"]',
      '[data-test-render-count]'
    ].join(', ');
    const msgEls = Array.from(document.querySelectorAll(selectors));

    const mountedTurnCount = msgEls.length;
    let mountedCharCount = 0;
    let heavyTurnCount = 0;

    msgEls.forEach(el => {
      const txt = (el.innerText || el.textContent || "").trim();
      mountedCharCount += txt.length;

      // Heavy turn heuristic: contains preformatted blocks/code OR is > 4000 characters
      const isHeavy = txt.length > 4000 || el.querySelector('pre') !== null || el.querySelector('code') !== null;
      if (isHeavy) {
        heavyTurnCount++;
      }
    });

    // Git #1468 — claude.ai virtualizes the transcript: only a tail window of
    // rows stays mounted in the DOM (data-testid="transcript-row", flanked by a
    // "transcript-spacer" placeholder for the un-mounted rest, plus a "Load
    // earlier messages" button — confirmed against a real long conversation's
    // page source). Counting querySelectorAll results alone plateaus at the
    // window size the moment a conversation outgrows it — that's exactly why
    // the meter "starts working correctly, then stops updating" partway
    // through a long session, rather than ever reading zero. Every mounted
    // message article carries a real aria-setsize/aria-posinset (e.g.
    // aria-setsize="1238" on a conversation with 1238 real turns and only 11
    // mounted) reflecting the conversation's TRUE total regardless of what's
    // mounted — read that instead of trusting the DOM node count.
    let trueTotalTurns = 0;
    document.querySelectorAll('[role="article"][aria-setsize]').forEach(el => {
      const n = parseInt(el.getAttribute('aria-setsize'), 10);
      if (!isNaN(n) && n > trueTotalTurns) trueTotalTurns = n;
    });
    if (trueTotalTurns === 0) {
      // Fallback for markup that only carries the count in an aria-label's
      // text ("Message 1228 of 1238") rather than a dedicated attribute.
      const labelled = document.querySelector('[aria-label*=" of "]');
      if (labelled) {
        const lm = /of\s+(\d+)/.exec(labelled.getAttribute('aria-label') || '');
        if (lm) trueTotalTurns = parseInt(lm[1], 10) || 0;
      }
    }
    const turnCount = Math.max(trueTotalTurns, mountedTurnCount);

    // Text is only ever readable for currently-mounted turns — claude.ai
    // doesn't mount the rest until "Load earlier messages" is clicked, so
    // virtualized-away turns' text genuinely isn't in the DOM to sum. When the
    // true total exceeds what's mounted, extrapolate from the mounted turns'
    // average length instead of silently under-counting the rest of the chat
    // (which is what produced the frozen meter this issue reports).
    const avgCharsPerTurn = mountedTurnCount > 0 ? mountedCharCount / mountedTurnCount : 0;
    const charCount = turnCount > mountedTurnCount && avgCharsPerTurn > 0
      ? Math.round(avgCharsPerTurn * turnCount)
      : mountedCharCount;
    const heavyTurnEstimate = turnCount > mountedTurnCount && mountedTurnCount > 0
      ? Math.round(heavyTurnCount * (turnCount / mountedTurnCount))
      : heavyTurnCount;

    // Git #1436 — self-diagnostic: if this looks like a real, populated chat
    // page (URL is a /chat/<id> conversation with real body text) but every
    // content selector above found zero MOUNTED turns for a sustained run,
    // the scraper is silently broken (renamed class/testid) rather than
    // genuinely looking at an empty chat. Deliberately keyed off
    // mountedTurnCount, not the aria-setsize-derived turnCount above — those
    // are two independent signals, and a markup rename that breaks the
    // content selectors shouldn't be masked just because the unrelated
    // aria-setsize attribute still resolves. Surface that as an explicit flag
    // instead of just letting the progress bar sit at 0 with no indication
    // anything is wrong.
    const bodyLen = (document.body && (document.body.innerText || document.body.textContent) || "").length;
    const looksLikeRealChat = /\/chat\//.test(location.pathname) && bodyLen > 500;
    if (mountedTurnCount === 0 && looksLikeRealChat) {
      window.__bcZeroTurnTicks = (window.__bcZeroTurnTicks || 0) + 1;
    } else {
      window.__bcZeroTurnTicks = 0;
    }
    // 5 consecutive 2s polls (~10s) of "looks like a chat, found nothing" —
    // long enough to rule out a mid-navigation blip, short enough to surface fast.
    const selectorsLikelyStale = window.__bcZeroTurnTicks >= 5;

    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_CHAT_STATS',
        turnCount: turnCount,
        charCount: charCount,
        heavyTurnCount: heavyTurnEstimate,
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

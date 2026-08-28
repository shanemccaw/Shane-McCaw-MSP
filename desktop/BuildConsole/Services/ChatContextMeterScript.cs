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

    let turnCount = msgEls.length;
    let charCount = 0;
    let heavyTurnCount = 0;

    msgEls.forEach(el => {
      const txt = (el.innerText || el.textContent || "").trim();
      charCount += txt.length;

      // Heavy turn heuristic: contains preformatted blocks/code OR is > 4000 characters
      const isHeavy = txt.length > 4000 || el.querySelector('pre') !== null || el.querySelector('code') !== null;
      if (isHeavy) {
        heavyTurnCount++;
      }
    });

    // Git #1436 — self-diagnostic: if this looks like a real, populated chat
    // page (URL is a /chat/<id> conversation with real body text) but every
    // selector above found zero turns for a sustained run, the scraper is
    // silently broken (renamed class/testid) rather than genuinely looking at
    // an empty chat. Surface that as an explicit flag instead of just letting
    // the progress bar sit at 0 with no indication anything is wrong.
    const bodyLen = (document.body && (document.body.innerText || document.body.textContent) || "").length;
    const looksLikeRealChat = /\/chat\//.test(location.pathname) && bodyLen > 500;
    if (turnCount === 0 && looksLikeRealChat) {
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
        heavyTurnCount: heavyTurnCount,
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

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
    // Claude conversation message selectors (covers different markup versions)
    const msgEls = Array.from(document.querySelectorAll('.font-user-message, .font-claude-message, [data-testid="user-message"], [data-testid="assistant-message"]'));
    
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

    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_CHAT_STATS',
        turnCount: turnCount,
        charCount: charCount,
        heavyTurnCount: heavyTurnCount
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

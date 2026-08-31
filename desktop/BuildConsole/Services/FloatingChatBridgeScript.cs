namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2059 — Floating Chat Window (Phase 1 of the #2035 Global Chat Drawer epic).
    ///
    /// This is the JavaScript half of the floaty's send/receive bridge. It is NOT a new
    /// injection mechanism — it deliberately reuses the two techniques already proven
    /// elsewhere in this codebase for talking to a claude.ai chat DOM:
    ///
    ///  • RECEIVE (<see cref="CaptureScript"/>): the same content selectors the context
    ///    meter uses (<see cref="ChatContextMeterScript"/> — <c>.font-claude-message</c>,
    ///    <c>[data-testid="assistant-message"]</c>, <c>[role="article"][aria-posinset]</c>)
    ///    to locate the LAST assistant turn, then walks that turn's DOM into a lightweight
    ///    markdown string (headings, bold/italic, inline code, fenced code, ordered/
    ///    unordered lists, links, paragraphs) so the host can render it with the existing
    ///    <see cref="MarkdownRenderer"/> — i.e. the epic's "capture the webpage equivalent
    ///    of stdout … rendered as RichText" note. Posts <c>BT_FLOATY_RESPONSE</c> only when
    ///    the captured text actually changes, so a streaming reply updates live without
    ///    spamming identical frames.
    ///
    ///  • SEND (<see cref="BuildSendScript"/>): the SAME largest-visible
    ///    <c>div[contenteditable="true"]</c> + <c>execCommand('insertText')</c> +
    ///    <c>InputEvent</c> fallback that MainWindow.StickyNotesComposerInsertScript (#937/
    ///    #940) established for the ProseMirror composer. Unlike Sticky Notes / LinkedIn —
    ///    which deliberately never submit because Shane reviews first — the floaty's whole
    ///    point is to fire a quick message WITHOUT switching to the tab, so this variant
    ///    also submits: it clicks the real Send button when present, falling back to an
    ///    Enter keydown, and reports back whether the submit actually happened.
    /// </summary>
    public static class FloatingChatBridgeScript
    {
        /// <summary>
        /// Injected via AddScriptToExecuteOnDocumentCreatedAsync (before navigation, per #816).
        /// Polls the transcript ~1.2s and posts the latest assistant reply as markdown.
        /// </summary>
        public const string CaptureScript = """
(function () {
  if (window.__bcFloatyCaptureInjected) return;
  window.__bcFloatyCaptureInjected = true;

  function conversationId() {
    var m = /\/chat\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(location.pathname);
    return m ? m[1] : null;
  }

  // The last assistant message element. Same content selectors the context meter
  // (ChatContextMeterScript) relies on — specific class/testid first, structural
  // aria fallback after — so a claude.ai markup change breaks both in one place,
  // not silently here alone.
  function lastAssistantEl() {
    var claude = document.querySelectorAll('.font-claude-message, [data-testid="assistant-message"]');
    if (claude.length) return claude[claude.length - 1];
    // Fallback: assistant turns are the even aria-posinset articles (user = odd),
    // but rather than assume parity, take the last article that is NOT a user turn.
    var arts = Array.prototype.slice.call(document.querySelectorAll('[role="article"][aria-posinset]'));
    for (var i = arts.length - 1; i >= 0; i--) {
      var a = arts[i];
      if (a.querySelector('.font-user-message, [data-testid="user-message"]')) continue;
      return a;
    }
    return null;
  }

  // Minimal, dependency-free DOM -> markdown for a single assistant message subtree.
  // Only the constructs claude.ai actually emits and MarkdownRenderer actually renders.
  function inline(node) {
    var out = '';
    node.childNodes.forEach(function (c) {
      if (c.nodeType === 3) { out += c.textContent; return; }
      if (c.nodeType !== 1) return;
      var tag = c.tagName.toLowerCase();
      if (tag === 'code') { out += '`' + (c.textContent || '') + '`'; }
      else if (tag === 'strong' || tag === 'b') { out += '**' + inline(c) + '**'; }
      else if (tag === 'em' || tag === 'i') { out += '*' + inline(c) + '*'; }
      else if (tag === 'a') {
        var href = c.getAttribute('href') || '';
        var txt = inline(c);
        out += href ? ('[' + txt + '](' + href + ')') : txt;
      }
      else if (tag === 'br') { out += '\n'; }
      else { out += inline(c); }
    });
    return out;
  }

  function blockToMd(el, lines) {
    el.childNodes.forEach(function (c) {
      if (c.nodeType === 3) {
        var t = (c.textContent || '').trim();
        if (t) { lines.push(t); lines.push(''); }
        return;
      }
      if (c.nodeType !== 1) return;
      var tag = c.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        var level = parseInt(tag.charAt(1), 10);
        lines.push(new Array(level + 1).join('#') + ' ' + inline(c)); lines.push('');
      } else if (tag === 'p') {
        lines.push(inline(c)); lines.push('');
      } else if (tag === 'ul') {
        c.querySelectorAll(':scope > li').forEach(function (li) { lines.push('- ' + inline(li)); });
        lines.push('');
      } else if (tag === 'ol') {
        var n = 1;
        c.querySelectorAll(':scope > li').forEach(function (li) { lines.push((n++) + '. ' + inline(li)); });
        lines.push('');
      } else if (tag === 'pre') {
        var codeEl = c.querySelector('code');
        var code = (codeEl ? codeEl.innerText : c.innerText) || '';
        lines.push('```'); lines.push(code.replace(/\n$/, '')); lines.push('```'); lines.push('');
      } else if (tag === 'blockquote') {
        inline(c).split('\n').forEach(function (l) { lines.push('> ' + l); });
        lines.push('');
      } else if (tag === 'hr') {
        lines.push('---'); lines.push('');
      } else if (tag === 'table') {
        // Flatten a table to plain rows — MarkdownRenderer has no table grammar,
        // so this stays readable rather than emitting broken pipe syntax.
        c.querySelectorAll('tr').forEach(function (tr) {
          var cells = [];
          tr.querySelectorAll('th,td').forEach(function (td) { cells.push(inline(td).trim()); });
          if (cells.length) lines.push(cells.join(' | '));
        });
        lines.push('');
      } else {
        // Unknown wrapper (claude wraps content in many divs) — recurse.
        blockToMd(c, lines);
      }
    });
  }

  function toMarkdown(el) {
    var lines = [];
    blockToMd(el, lines);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  var lastSent = null;

  function poll() {
    var el = lastAssistantEl();
    if (!el) return;
    var md = toMarkdown(el);
    if (!md || md === lastSent) return;
    lastSent = md;
    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_FLOATY_RESPONSE',
        conversationId: conversationId(),
        markdown: md
      }));
    } catch (e) {}
  }

  setInterval(poll, 1200);
  poll();
})();
""";

        /// <summary>
        /// One-shot script (run via ExecuteScriptAsync). Inserts <paramref name="text"/> into
        /// the composer using the identical technique as StickyNotesComposerInsertScript
        /// (#937/#940). Returns a JSON string status: 'inserted' | 'no-composer' | 'error: …'.
        /// The host runs <see cref="SubmitScript"/> a beat later — WebView2's ExecuteScriptAsync
        /// does not await a returned Promise, so submit is a SEPARATE call after a short C# delay
        /// rather than a setTimeout here, both so the status is real and so claude.ai's Send
        /// button has a tick to enable off the input event React batches asynchronously.
        /// </summary>
        public static string BuildInsertScript(string text)
        {
            string js = System.Text.Json.JsonSerializer.Serialize(text);
            return $@"
(function () {{
  try {{
    var text = {js};
    function findComposer() {{
      var c = Array.prototype.slice.call(document.querySelectorAll('div[contenteditable=""true""]'))
        .filter(function (el) {{ return el.offsetParent !== null; }});
      c.sort(function (a, b) {{ return b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight; }});
      return c[0] || null;
    }}
    var composer = findComposer();
    if (!composer) return 'no-composer';
    composer.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    var inserted = document.execCommand('insertText', false, text);
    if (!inserted) {{
      range.insertNode(document.createTextNode(text));
      composer.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    }}
    return 'inserted';
  }} catch (ex) {{
    return 'error: ' + ex.message;
  }}
}})();";
        }

        /// <summary>
        /// One-shot script (run via ExecuteScriptAsync a short delay after
        /// <see cref="BuildInsertScript"/> reports 'inserted'). Submits the composer — the
        /// floaty's whole point is to fire without switching to the tab, so unlike the Sticky
        /// Notes/LinkedIn insert this one presses Send: it clicks the real Send button when
        /// present (it also carries claude.ai's own guards), falling back to an Enter keydown.
        /// Returns 'sent' | 'inserted-no-send' | 'no-composer' | 'error: …'.
        /// </summary>
        public const string SubmitScript = """
(function () {
  try {
    function findComposer() {
      var c = Array.prototype.slice.call(document.querySelectorAll('div[contenteditable="true"]'))
        .filter(function (el) { return el.offsetParent !== null; });
      c.sort(function (a, b) { return b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight; });
      return c[0] || null;
    }
    var composer = findComposer();
    if (!composer) return 'no-composer';
    function findSendButton() {
      var btns = Array.prototype.slice.call(document.querySelectorAll('button[aria-label]'));
      return btns.filter(function (b) {
        var l = (b.getAttribute('aria-label') || '').toLowerCase();
        return l.indexOf('send') !== -1 && !b.disabled && b.offsetParent !== null;
      })[0] || null;
    }
    var before = (composer.innerText || '').trim();
    var btn = findSendButton();
    if (btn) { btn.click(); return 'sent'; }
    composer.focus();
    var opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    composer.dispatchEvent(new KeyboardEvent('keydown', opts));
    composer.dispatchEvent(new KeyboardEvent('keyup', opts));
    // If the composer still holds the same text, the Enter didn't submit.
    var after = (composer.innerText || '').trim();
    return (after.length > 0 && after === before) ? 'inserted-no-send' : 'sent';
  } catch (ex) {
    return 'error: ' + ex.message;
  }
})();
""";
    }
}

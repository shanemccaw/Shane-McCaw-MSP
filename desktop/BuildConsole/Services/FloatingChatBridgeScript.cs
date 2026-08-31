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

  // Every assistant turn, in document order. Same content selectors the context meter
  // (ChatContextMeterScript) relies on — specific class/testid first, structural aria
  // fallback after — so a claude.ai markup change breaks both in one place, not silently
  // here alone. Returned as an array so the caller can both take the last turn AND count
  // turns (the send/receive correlation gate below needs the count, Git #2072).
  function assistantEls() {
    var claude = document.querySelectorAll('.font-claude-message, [data-testid="assistant-message"]');
    if (claude.length) return Array.prototype.slice.call(claude);
    // Fallback: assistant turns are the even aria-posinset articles (user = odd), but
    // rather than assume parity, keep the articles that are NOT user turns, in order.
    var arts = Array.prototype.slice.call(document.querySelectorAll('[role="article"][aria-posinset]'));
    return arts.filter(function (a) {
      return !a.querySelector('.font-user-message, [data-testid="user-message"]');
    });
  }

  function lastAssistantEl() {
    var els = assistantEls();
    return els.length ? els[els.length - 1] : null;
  }

  // Non-content controls claude.ai renders INSIDE / around a message subtree — copy,
  // retry, thumbs, and their icon-font glyphs (often Private-Use-Area codepoints that
  // render as tofu boxes once scraped, Git #2072). Skip these so only real message
  // text is walked into markdown.
  function isSkippable(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'svg' || tag === 'button' || tag === 'style' || tag === 'script') return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    var role = el.getAttribute('role');
    if (role === 'button' || role === 'menu' || role === 'menuitem' || role === 'toolbar') return true;
    return false;
  }

  // Minimal, dependency-free DOM -> markdown for a single assistant message subtree.
  // Only the constructs claude.ai actually emits and MarkdownRenderer actually renders.
  function inline(node) {
    var out = '';
    node.childNodes.forEach(function (c) {
      if (c.nodeType === 3) { out += c.textContent; return; }
      if (c.nodeType !== 1) return;
      if (isSkippable(c)) return;
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
      if (isSkippable(c)) return;
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

  // Send/receive correlation gate (Git #2072).
  // The old poll posted whatever assistant turn was last in the DOM the first time it
  // saw text (lastSent === null), with NO link to a message the user actually sent. On
  // an existing conversation that surfaced the PRE-EXISTING last reply as if it were the
  // response to what you just typed — and if the send silently failed, it kept showing
  // that stale turn indefinitely. That is the trust-critical bug this issue reports.
  //
  // The host arms this gate the instant it submits (BeginWait, below). While armed, poll
  // refuses to surface the last turn until a GENUINELY NEW/changed assistant turn appears
  // (turn count grew past the baseline, or the last turn's text changed from the baseline
  // snapshot). So a stale pre-send reply can never masquerade as the fresh answer: you get
  // the real new reply, or you keep seeing the host's honest "waiting" state — never a lie.
  var waiting = false;
  var baselineCount = 0;
  var baselineMd = null;

  window.__bcFloatyBeginWait = function () {
    var els = assistantEls();
    baselineCount = els.length;
    baselineMd = els.length ? toMarkdown(els[els.length - 1]) : null;
    waiting = true;
    lastSent = null; // force the eventual new turn to post even if text repeats
  };
  window.__bcFloatyCancelWait = function () { waiting = false; };

  function poll() {
    var els = assistantEls();
    if (!els.length) return;
    var el = els[els.length - 1];
    var md = toMarkdown(el);

    if (waiting) {
      // Only release once a genuinely new/changed assistant turn exists. Until then,
      // do NOT surface the stale turn that was last on screen when we sent.
      if (els.length > baselineCount || md !== baselineMd) {
        waiting = false;
      } else {
        return;
      }
    }

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
        ///
        /// Critically (Git #2072), it ARMS the receive-side correlation gate
        /// (<c>window.__bcFloatyBeginWait</c>) at the exact instant of submit — capturing the
        /// baseline transcript BEFORE the new turn can appear — so the stale last turn can never
        /// be surfaced as the reply. Returns 'submitted' (provisional — the host CONFIRMS the
        /// send actually landed via <see cref="VerifySubmitScript"/> rather than trusting a
        /// button click, which used to report a false 'sent'), 'no-composer', or 'error: …'.
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
    // Arm the receive-side gate with the baseline transcript BEFORE we submit, so the
    // capture poll knows exactly which turns pre-existed and never surfaces one of them
    // as the reply to this send.
    if (typeof window.__bcFloatyBeginWait === 'function') { try { window.__bcFloatyBeginWait(); } catch (e) {} }

    var btn = findSendButton();
    if (btn) { btn.click(); return 'submitted'; }
    composer.focus();
    var opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    composer.dispatchEvent(new KeyboardEvent('keydown', opts));
    composer.dispatchEvent(new KeyboardEvent('keyup', opts));
    return 'submitted';
  } catch (ex) {
    return 'error: ' + ex.message;
  }
})();
""";

        /// <summary>
        /// One-shot script (run via ExecuteScriptAsync a short delay AFTER
        /// <see cref="SubmitScript"/>). Verifies the submit actually landed rather than trusting
        /// the button click (Git #2072): a genuine claude.ai submit clears the composer, so an
        /// empty composer is real confirmation the message left the box. Returns 'confirmed'
        /// (composer cleared — the send took), 'unconfirmed' (the text is still sitting there —
        /// the submit didn't take), 'no-composer', or 'error: …'. On 'unconfirmed' the host
        /// cancels the receive-side wait gate so the pane doesn't sit waiting for a reply that
        /// will never come.
        /// </summary>
        public const string VerifySubmitScript = """
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
    var txt = (composer.innerText || '').replace(/[\u200B\uFEFF]/g, '').trim();
    return txt.length === 0 ? 'confirmed' : 'unconfirmed';
  } catch (ex) {
    return 'error: ' + ex.message;
  }
})();
""";

        /// <summary>
        /// Cancels the receive-side correlation wait gate armed by <see cref="SubmitScript"/>.
        /// Run when the submit could not be confirmed (Git #2072) so the capture poll resumes
        /// its normal behaviour instead of silently waiting forever for a turn that never comes.
        /// </summary>
        public const string CancelWaitScript =
            "(function(){ try { if (typeof window.__bcFloatyCancelWait === 'function') window.__bcFloatyCancelWait(); } catch(e){} return 'ok'; })();";
    }
}

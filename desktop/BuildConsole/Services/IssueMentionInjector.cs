namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1253 — Shane: "When Claude mentions a Git issue by number an underline would
    /// appear and I could run my mouse over it get a popup that told me that Git issue's
    /// details... if I clicked it, it would open the Git issue in the Git document tab."
    ///
    /// Injects a content-script-equivalent JS observer into every claude.ai WebView2.
    ///
    /// v2 design — debounced, React-safe:
    ///   Uses a 1.5-second debounce so the scan runs only after React finishes streaming.
    ///   Snapshots all matching text nodes into an Array before any DOM edits.
    ///   isConnected guards + try/catch on every replaceChild call.
    ///
    /// v3 close-button fix:
    ///   The onclick attribute approach was blocked by claude.ai's Content Security Policy
    ///   (CSP forbids inline event handlers). Now the close button is a permanent real DOM
    ///   element wired with addEventListener — it is never rebuilt via innerHTML — and only
    ///   the inner content area is updated when the tooltip refreshes.
    ///
    /// Git #2066 — every scan also reports the full set of #NNN numbers it finds
    /// (BT_ISSUE_MENTIONS_SCAN, delta-only after the first report) so MainWindow can
    /// maintain a live per-chat "every issue this chat has ever mentioned" registry —
    /// a separate, noisy signal from the deliberate bt_chat_issues association table.
    ///
    /// Git #2123 — bare numbers (no leading '#') are also decorated, since some chats
    /// write "1511 — NOT landed" instead of "#1511 — NOT landed" and got zero underline.
    /// A bare number is inherently ambiguous (could be a year, a port, a count, ...), so
    /// this uses two independent, non-exclusive heuristics rather than one strict rule —
    /// either is treated as sufficient on its own, per Shane's explicit call ("I'd rather
    /// a few false positives than arguing with agent at 3am"):
    ///   1. BARE_ISSUE_RE — any standalone 4-5 digit run, anywhere in the text. This runs
    ///      as injected page-context JS with no cheap per-match way to hit the GitHub API
    ///      (a live min/max lookup isn't practical here), so the 4-digit floor is a fixed
    ///      approximation of this repo's real issue-number range, not a live query —
    ///      confirmed 2026-08-31 the repo's live issues run from the low hundreds through
    ///      the low 2000s. Known false positives: years (2026), ports (8080), any other
    ///      4-5 digit quantity in prose. Known false negative: real 1-3 digit issue
    ///      numbers (this repo does have some, e.g. #305) outside structural context.
    ///   2. BARE_ISSUE_CTX_RE — a 2-5 digit run at the start of a line/bullet immediately
    ///      followed by an em/en-dash or colon (the exact shape of the reported example).
    ///      This structural correlation is strong enough on its own to admit smaller,
    ///      sub-1000 numbers that BARE_ISSUE_RE's floor would otherwise miss. Known false
    ///      positive: a numbered heading/line using "N: " or "N — " for something other
    ///      than an issue reference.
    /// Both heuristics only add candidate matches; the existing index-sorted overlap
    /// dedup in decorateTextNode still gives priority to a real "#NNN" or ".sql" match
    /// covering the same text, so a bare-number heuristic never overrides a stronger one.
    /// </summary>
    public static class IssueMentionInjector
    {
        public const string Script = """
(function () {
  if (window.__bcIssueMentionInjected) return;
  window.__bcIssueMentionInjected = true;

  /* ── Tooltip (permanent DOM structure, built once) ─────────────── */
  var tip = document.createElement('div');
  tip.id = 'bc-issue-tip';
  tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:340px;padding:8px 28px 8px 12px;'
    + 'border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'font-size:13px;line-height:1.45;color:#CDD6F4;background:#1E1E2E;border:1px solid #313244;'
    + 'box-shadow:0 4px 20px rgba(0,0,0,.55);pointer-events:auto;opacity:0;'
    + 'transition:opacity .15s ease;white-space:pre-wrap;word-break:break-word;display:none';

  /* Close button — real element, addEventListener, never rebuilt */
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close';
  closeBtn.style.cssText = 'position:absolute;top:5px;right:7px;background:none;border:none;'
    + 'color:#585B70;font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;'
    + 'border-radius:3px;font-family:inherit;transition:color .1s';
  closeBtn.addEventListener('mouseenter', function () { closeBtn.style.color = '#CDD6F4'; });
  closeBtn.addEventListener('mouseleave', function () { closeBtn.style.color = '#585B70'; });
  closeBtn.addEventListener('click', function () {
    tip.style.opacity = '0';
    _tipVisible = false;
    setTimeout(function () { tip.style.display = 'none'; }, 160);
  });
  tip.appendChild(closeBtn);

  /* Content area — the only part updated on each hover */
  var tipBody = document.createElement('div');
  tip.appendChild(tipBody);

  function appendTip() {
    if (document.body && !document.getElementById('bc-issue-tip')) {
      document.body.appendChild(tip);
    }
  }
  appendTip();

  var _tipNum = 0, _tipVisible = false;

  /* Git #2080 — the tip now hosts real interactive buttons (Dispatch/Cancel/Retry/Open/Reply),
     not just a close button, so a bare "mouseleave the underline -> hide" would make them
     unreachable: the mouse has to cross the gap between the underlined text and the tip below
     it. Same debounced show/hide pattern LeftSidebar's native IssueHoverPopup already uses
     (ScheduleIssueHoverHide/CancelIssueHoverHide) — hide is delayed and cancelled if the pointer
     lands back on the tip itself. */
  var _hideTimer = null;
  function cancelHide() { if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; } }
  function scheduleHide() {
    cancelHide();
    _hideTimer = setTimeout(function () {
      tip.style.opacity = '0';
      _tipVisible = false;
    }, 250);
  }
  tip.addEventListener('mouseenter', cancelHide);
  tip.addEventListener('mouseleave', scheduleHide);

  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function positionTip(anchorEl) {
    var r = anchorEl.getBoundingClientRect();
    var left = r.left;
    var top  = r.bottom + 6;
    if (left + 350 > window.innerWidth) left = Math.max(4, window.innerWidth - 354);
    if (top  + 90  > window.innerHeight) top = r.top - (tip.offsetHeight || 70) - 6;
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
  }

  function showTip(anchorEl) {
    tip.style.display = 'block';
    tip.style.opacity = '0';
    positionTip(anchorEl);
    requestAnimationFrame(function () { tip.style.opacity = '1'; });
    _tipVisible = true;
  }

  /* Git #2080 \u2014 state-aware action buttons, posting BT_ISSUE_ACTION back to the host. Reused
     by both the sender-tab lookup in MainWindow.ChatWv_WebMessageReceived and
     FloatingChatWindow.OnBridgeMessage; those handlers call the exact same
     BuildQueuePanel.Quick*Async methods #2061 built for the Git Board popover \u2014 this file only
     renders the buttons and posts the click. */
  function postIssueAction(action, buildId, message) {
    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_ISSUE_ACTION', number: _tipNum, action: action, buildId: buildId, message: message
      }));
    } catch (e) {}
  }

  var ACTION_BTN_STYLE = 'padding:4px 10px;margin:2px 6px 2px 0;border-radius:5px;border:1px solid #45475A;'
    + 'background:#313244;color:#CDD6F4;font-size:11px;font-family:inherit;cursor:pointer';

  function renderActions(actions) {
    if (!actions) return '';
    if (actions.blocked) {
      var by = actions.blocked.number
        ? ('Waiting on #' + actions.blocked.number + (actions.blocked.title ? ' \u2014 ' + escHtml(actions.blocked.title) : ''))
        : 'Blocked';
      return '<div style="margin-top:6px;font-size:11px;color:#F38BA8">\ud83d\udd12 ' + by + '</div>';
    }
    if (actions.noBuildDispatch) {
      return '<hr style="border:none;border-top:1px solid #313244;margin:6px 0">'
        + '<button type="button" class="bc-issue-action" data-bc-action="dispatchask" style="' + ACTION_BTN_STYLE + '">'
        + '\u26a1 Dispatch (asks active chat if no BUILD: yet)</button>';
    }
    if (!actions.build) return '';
    var b = actions.build;
    var html = '<hr style="border:none;border-top:1px solid #313244;margin:6px 0">'
      + '<div style="font-size:11px;color:#BAC2DE;margin-bottom:4px">' + escHtml(b.statusText) + '</div>';
    if (typeof b.progressPercent === 'number') {
      html += '<div style="background:#313244;border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px">'
        + '<div style="background:#89B4FA;height:100%;width:' + b.progressPercent + '%"></div></div>';
      if (b.progressLabel) html += '<div style="font-size:10px;color:#585B70;margin-bottom:6px">' + escHtml(b.progressLabel) + '</div>';
      if (b.stale && b.staleText) html += '<div style="font-size:10px;color:#FAB387;margin-bottom:6px">\u26a0 ' + escHtml(b.staleText) + '</div>';
    }
    html += '<button type="button" class="bc-issue-action" data-bc-action="' + b.actionKind + '" data-bc-build="' + b.id + '" style="' + ACTION_BTN_STYLE + '">'
      + escHtml(b.actionLabel) + '</button>';
    if (b.allowReply) {
      html += '<div style="margin-top:6px;display:flex;gap:4px">'
        + '<input type="text" class="bc-issue-reply-input" placeholder="Reply and resume\u2026" '
        + 'style="flex:1;min-width:0;padding:4px 6px;border-radius:4px;border:1px solid #45475A;background:#181825;color:#CDD6F4;font-size:11px;font-family:inherit">'
        + '<button type="button" class="bc-issue-reply-send" data-bc-build="' + b.id + '" style="' + ACTION_BTN_STYLE + ';margin:0">\ud83d\udcac Send</button></div>';
    }
    return html;
  }

  /* Called by MainWindow/FloatingChatWindow after resolving issue + action data */
  window.__btShowIssueTip = function (number, title, status, isEpic, actions) {
    if (_tipNum !== number || !_tipVisible) return;
    var anchor = document.querySelector('.bc-issue-mention[data-bc-num="' + number + '"]:hover');
    if (!anchor) return;
    var icon  = isEpic ? '\ud83d\udd37' : '\ud83d\udd39';
    var badge = status === 'CLOSED'
      ? '<span style="color:#F38BA8;font-size:11px;font-weight:600">\u25cf CLOSED</span>'
      : '<span style="color:#A6E3A1;font-size:11px;font-weight:600">\u25cf OPEN</span>';
    tipBody.innerHTML = icon + ' <strong style="color:#89B4FA">#' + number + '</strong> '
      + badge + '<br><span style="color:#BAC2DE">' + escHtml(title) + '</span>'
      + renderActions(actions);

    var actionBtn = tipBody.querySelector('.bc-issue-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var buildIdAttr = actionBtn.getAttribute('data-bc-build');
        postIssueAction(actionBtn.getAttribute('data-bc-action'), buildIdAttr ? parseInt(buildIdAttr, 10) : null, null);
        cancelHide();
        tip.style.opacity = '0';
        _tipVisible = false;
      });
    }
    var replyBtn = tipBody.querySelector('.bc-issue-reply-send');
    var replyInput = tipBody.querySelector('.bc-issue-reply-input');
    if (replyBtn && replyInput) {
      replyInput.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
      replyInput.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      replyBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var message = (replyInput.value || '').trim();
        if (!message) return;
        postIssueAction('reply', parseInt(replyBtn.getAttribute('data-bc-build'), 10), message);
        cancelHide();
        tip.style.opacity = '0';
        _tipVisible = false;
      });
    }

    positionTip(anchor);
    requestAnimationFrame(function () { tip.style.opacity = '1'; });
  };

  /* ── Issue & SQL mention decoration ───────────────────────────── */
  var ISSUE_RE = /#(\d{1,5})\b/g;
  var SQL_RE = /\b([\w\-\./\\]+\.sql)\b/gi;
  /* Git #2123 — bare (no '#') issue-number heuristics. See the class doc-comment above
     for the full rationale and known false-positive/false-negative tradeoffs. */
  var BARE_ISSUE_RE = /\b(\d{4,5})\b/g;
  var BARE_ISSUE_CTX_RE = /(?<=^|\n)[ \t]*(?:[-*•]\s*)?(\d{2,5})(?=[ \t]*[—–:])/g;
  var SKIP_TAGS = { CODE:1, PRE:1, SCRIPT:1, STYLE:1, TEXTAREA:1, INPUT:1 };

  function makeIssueSpan(num, rawText) {
    var span = document.createElement('span');
    span.className = 'bc-issue-mention';
    span.setAttribute('data-bc-num', String(num));
    span.textContent = rawText;
    span.style.cssText = 'border-bottom:1.5px dashed #89B4FA;cursor:pointer;'
      + 'border-radius:2px;padding-bottom:1px;'
      + 'transition:background .12s,border-color .12s';

    span.addEventListener('mouseenter', function () {
      cancelHide();
      span.style.background  = 'rgba(137,180,250,.13)';
      span.style.borderColor = '#CBA6F7';
      _tipNum     = num;
      _tipVisible = true;
      appendTip();
      tipBody.innerHTML = '\ud83d\udd39 <strong style="color:#89B4FA">#' + num + '</strong>'
        + ' <span style="color:#585B70">Loading\u2026</span>';
      showTip(span);
      try { window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_HOVER_ISSUE', number: num })); } catch(e) {}
    });

    span.addEventListener('mouseleave', function () {
      span.style.background  = '';
      span.style.borderColor = '#89B4FA';
      scheduleHide();
    });

    span.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      cancelHide();
      tip.style.opacity = '0';
      _tipVisible = false;
      try { window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_OPEN_ISSUE', number: num })); } catch(e) {}
    });

    return span;
  }

  function makeSqlSpan(file, rawText) {
    var span = document.createElement('span');
    span.className = 'bc-sql-mention';
    span.setAttribute('data-bc-file', file);
    span.textContent = rawText;
    span.style.cssText = 'border-bottom:1.5px dashed #A6E3A1;cursor:pointer;'
      + 'border-radius:2px;padding-bottom:1px;'
      + 'transition:background .12s,border-color .12s';

    span.addEventListener('mouseenter', function () {
      span.style.background  = 'rgba(166,227,161,.13)';
      span.style.borderColor = '#A6E3A1';
      appendTip();
      tipBody.innerHTML = '📄 <strong style="color:#A6E3A1">' + escHtml(rawText) + '</strong>'
        + '<br><span style="color:#BAC2DE;font-size:11px">Click to open in SQL viewer</span>';
      showTip(span);
    });

    span.addEventListener('mouseleave', function () {
      span.style.background  = '';
      span.style.borderColor = '#A6E3A1';
      tip.style.opacity = '0';
      _tipVisible = false;
    });

    span.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      tip.style.opacity = '0';
      _tipVisible = false;
      try { window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_OPEN_SQL_FILE', file: file })); } catch(e) {}
    });

    return span;
  }

  function decorateTextNode(tn) {
    if (!tn.isConnected) return;
    var parent = tn.parentElement;
    if (!parent) return;
    if (parent.classList && (parent.classList.contains('bc-issue-mention') || parent.classList.contains('bc-sql-mention'))) return;
    var el = parent;
    while (el) {
      if (SKIP_TAGS[el.nodeName]) return;
      el = el.parentElement;
    }
    var text = tn.nodeValue || '';

    var matches = [];
    var m;

    ISSUE_RE.lastIndex = 0;
    while ((m = ISSUE_RE.exec(text)) !== null) {
      var num = parseInt(m[1], 10);
      if (num < 100000) {
        matches.push({ index: m.index, length: m[0].length, type: 'issue', value: num, text: m[0] });
      }
    }

    SQL_RE.lastIndex = 0;
    while ((m = SQL_RE.exec(text)) !== null) {
      matches.push({ index: m.index, length: m[0].length, type: 'sql', value: m[1], text: m[0] });
    }

    /* Git #2123 — bare-number candidates are pushed last so the overlap dedup below
       (sorted by index, first match at a given position wins) always prefers a real
       "#NNN" or ".sql" match over a bare-number guess covering the same text. */
    BARE_ISSUE_RE.lastIndex = 0;
    while ((m = BARE_ISSUE_RE.exec(text)) !== null) {
      matches.push({ index: m.index, length: m[0].length, type: 'issue', value: parseInt(m[1], 10), text: m[0] });
    }

    BARE_ISSUE_CTX_RE.lastIndex = 0;
    while ((m = BARE_ISSUE_CTX_RE.exec(text)) !== null) {
      var digitStart = m.index + (m[0].length - m[1].length);
      matches.push({ index: digitStart, length: m[1].length, type: 'issue', value: parseInt(m[1], 10), text: m[1] });
    }

    if (matches.length === 0) return;

    matches.sort(function (a, b) { return a.index - b.index; });

    var cleanMatches = [];
    var lastEnd = 0;
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      if (match.index >= lastEnd) {
        cleanMatches.push(match);
        lastEnd = match.index + match.length;
      }
    }

    if (cleanMatches.length === 0) return;

    var frag = document.createDocumentFragment();
    var last = 0;
    for (var i = 0; i < cleanMatches.length; i++) {
      var match = cleanMatches[i];
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      if (match.type === 'issue') {
        frag.appendChild(makeIssueSpan(match.value, match.text));
      } else if (match.type === 'sql') {
        frag.appendChild(makeSqlSpan(match.value, match.text));
      }
      last = match.index + match.length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    if (!tn.isConnected) return;
    try { parent.replaceChild(frag, tn); } catch(e) {}
  }

  /* ── Debounced scanner ────────────────────────────────────────── */
  var _timer = null;

  /* Git #2066 — the full, noisy "every #NNN this chat has ever mentioned" registry.
     Reuses this exact detector (one detector, two consumers: the underline/tooltip
     above, and this batch report) rather than parsing the DOM a second time. Reported
     numbers are remembered per page-load so a re-scan (streaming text, re-renders)
     only posts the NEW delta, not the whole set again on every debounce tick. */
  var _reportedMentionNums = {};

  function conversationIdFromUrl() {
    var m = /\/chat\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(location.pathname);
    return m ? m[1] : null;
  }

  function reportMentionsIfAny() {
    var convId = conversationIdFromUrl();
    if (!convId) return;
    var els = document.querySelectorAll('.bc-issue-mention[data-bc-num]');
    var fresh = [];
    for (var i = 0; i < els.length; i++) {
      var num = parseInt(els[i].getAttribute('data-bc-num'), 10);
      if (!num || _reportedMentionNums[num]) continue;
      _reportedMentionNums[num] = true;
      fresh.push(num);
    }
    if (fresh.length === 0) return;
    try {
      window.chrome.webview.postMessage(JSON.stringify({
        type: 'BT_ISSUE_MENTIONS_SCAN',
        conversationId: convId,
        numbers: fresh
      }));
    } catch (e) {}
  }

  function runScan() {
    _timer = null;
    appendTip();
    var body = document.body;
    if (!body) return;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    var batch = [];
    var node;
    while ((node = walker.nextNode()) !== null) {
      var txt = node.nodeValue || '';
      ISSUE_RE.lastIndex = 0;
      SQL_RE.lastIndex = 0;
      BARE_ISSUE_RE.lastIndex = 0;
      BARE_ISSUE_CTX_RE.lastIndex = 0;
      if (ISSUE_RE.test(txt) || SQL_RE.test(txt) || BARE_ISSUE_RE.test(txt) || BARE_ISSUE_CTX_RE.test(txt)) batch.push(node);
    }
    batch.forEach(decorateTextNode);
    reportMentionsIfAny();
  }

  function scheduleOrReset() {
    clearTimeout(_timer);
    _timer = setTimeout(runScan, 1500);
  }

  /* ── MutationObserver ─────────────────────────────────────────── */
  var observer = new MutationObserver(function (mutations) {
    var skip = true;
    for (var i = 0; i < mutations.length && skip; i++) {
      var mut = mutations[i];
      for (var j = 0; j < mut.addedNodes.length && skip; j++) {
        var n = mut.addedNodes[j];
        if (n.nodeType === 1 && n.classList && (n.classList.contains('bc-issue-mention') || n.classList.contains('bc-sql-mention'))) continue;
        skip = false;
      }
      if (mut.type === 'characterData') skip = false;
    }
    if (!skip) scheduleOrReset();
  });

  function start() {
    var target = document.body || document.documentElement;
    if (!target) { setTimeout(start, 300); return; }
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    scheduleOrReset();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
""";
    }
}

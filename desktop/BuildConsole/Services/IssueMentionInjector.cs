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
    ///   The v1 script modified text nodes synchronously inside MutationObserver callbacks,
    ///   which raced with Claude's React streaming renderer. React was still updating those
    ///   very text nodes (via characterData mutations or wholesale replaceChild during
    ///   reconciliation), so our replaceChild either lost the race silently or produced
    ///   detached nodes that never reached the visible DOM.
    ///
    ///   v2 uses a 1.5-second debounce: every mutation just (re)sets a timer; after
    ///   1.5 s of silence (streaming is done, React has settled), one scan runs.  Inside
    ///   the scan all matching text nodes are collected into an Array BEFORE any replaceChild
    ///   call is made (so the TreeWalker is never invalidated mid-walk), and each node is
    ///   checked for isConnected right before the DOM edit.  Parent elements that already
    ///   carry data-bc-decorated are skipped on repeat scans, so we never double-process.
    ///
    ///   Tooltip: a single shared floating div; MainWindow pushes issue details back via
    ///   window.__btShowIssueTip(number, title, status, isEpic) through ExecuteScriptAsync.
    /// </summary>
    public static class IssueMentionInjector
    {
        public const string Script = """
(function () {
  if (window.__bcIssueMentionInjected) return;
  window.__bcIssueMentionInjected = true;

  /* ── Tooltip ──────────────────────────────────────────────────── */
  var tip = document.createElement('div');
  tip.id = 'bc-issue-tip';
  tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:340px;padding:8px 12px;'
    + 'border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'font-size:13px;line-height:1.45;color:#CDD6F4;background:#1E1E2E;border:1px solid #313244;'
    + 'box-shadow:0 4px 20px rgba(0,0,0,.55);pointer-events:auto;opacity:0;'
    + 'transition:opacity .15s ease;white-space:pre-wrap;word-break:break-word;display:none';

  function appendTip() {
    if (document.body && !document.getElementById('bc-issue-tip')) {
      document.body.appendChild(tip);
    }
  }
  appendTip();

  var _tipNum = 0, _tipVisible = false;

  /* Close button injected into every tooltip state */
  function closeBtnHtml() {
    return '<button onclick="(function(){'
      + 'var t=document.getElementById(\'bc-issue-tip\');'
      + 'if(t){t.style.opacity=\'0\';setTimeout(function(){t.style.display=\'none\';},160);}'
      + '})()" style="position:absolute;top:5px;right:7px;background:none;border:none;'
      + 'color:#585B70;font-size:14px;line-height:1;cursor:pointer;padding:0;'
      + 'font-family:inherit" title="Close">✕</button>';
  }

  /* Make the tip container relatively positioned so the close btn is anchored */
  tip.style.position = 'fixed';

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

  /* Called by MainWindow after resolving issue data */
  window.__btShowIssueTip = function (number, title, status, isEpic) {
    if (_tipNum !== number || !_tipVisible) return;
    var anchor = document.querySelector('.bc-issue-mention[data-bc-num="' + number + '"]:hover');
    if (!anchor) return;
    var icon  = isEpic ? '🔷' : '🔹';
    var badge = status === 'CLOSED'
      ? '<span style="color:#F38BA8;font-size:11px;font-weight:600">● CLOSED</span>'
      : '<span style="color:#A6E3A1;font-size:11px;font-weight:600">● OPEN</span>';
    tip.style.paddingRight = '28px';
    tip.innerHTML = closeBtnHtml()
      + icon + ' <strong style="color:#89B4FA">#' + number + '</strong> '
      + badge + '<br><span style="color:#BAC2DE">' + escHtml(title) + '</span>';
    positionTip(anchor);
    requestAnimationFrame(function () { tip.style.opacity = '1'; });
  };

  /* ── Issue-mention decoration ─────────────────────────────────── */
  var ISSUE_RE = /#(\d{1,5})\b/g;
  var SKIP_TAGS = { CODE:1, PRE:1, SCRIPT:1, STYLE:1, TEXTAREA:1, INPUT:1 };

  function makeSpan(num, rawText) {
    var span = document.createElement('span');
    span.className = 'bc-issue-mention';
    span.setAttribute('data-bc-num', String(num));
    span.textContent = rawText;
    span.style.cssText = 'border-bottom:1.5px dashed #89B4FA;cursor:pointer;'
      + 'border-radius:2px;padding-bottom:1px;'
      + 'transition:background .12s,border-color .12s';

    span.addEventListener('mouseenter', function () {
      span.style.background  = 'rgba(137,180,250,.13)';
      span.style.borderColor = '#CBA6F7';
      _tipNum     = num;
      _tipVisible = true;
      appendTip();
      /* Show "loading" state immediately while C# fetches details */
      tip.style.paddingRight = '28px';
      tip.innerHTML = closeBtnHtml()
        + '🔹 <strong style="color:#89B4FA">#' + num + '</strong>'
        + ' <span style="color:#585B70">Loading…</span>';
      tip.style.display  = 'block';
      tip.style.opacity  = '0';
      positionTip(span);
      requestAnimationFrame(function () { tip.style.opacity = '1'; });
      try { window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_HOVER_ISSUE', number: num })); } catch(e) {}
    });

    span.addEventListener('mouseleave', function () {
      span.style.background  = '';
      span.style.borderColor = '#89B4FA';
      tip.style.opacity = '0';
      _tipVisible = false;
    });

    span.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      tip.style.opacity = '0';
      _tipVisible = false;
      try { window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_OPEN_ISSUE', number: num })); } catch(e) {}
    });

    return span;
  }

  function decorateTextNode(tn) {
    /* Must still be in the document */
    if (!tn.isConnected) return;

    var parent = tn.parentElement;
    if (!parent) return;

    /* Skip if parent is already one of our spans */
    if (parent.classList && parent.classList.contains('bc-issue-mention')) return;

    /* Skip code / pre / script / style ancestry */
    var el = parent;
    while (el) {
      if (SKIP_TAGS[el.nodeName]) return;
      el = el.parentElement;
    }

    var text = tn.nodeValue || '';
    ISSUE_RE.lastIndex = 0;
    if (!ISSUE_RE.test(text)) return;

    /* Build replacement fragment */
    ISSUE_RE.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var last = 0, m;
    while ((m = ISSUE_RE.exec(text)) !== null) {
      var num = parseInt(m[1], 10);
      if (num >= 100000) continue;           /* not a realistic issue number */
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeSpan(num, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    /* Final isConnected guard + silent-fail replaceChild */
    if (!tn.isConnected) return;
    try { parent.replaceChild(frag, tn); } catch(e) {}
  }

  /* ── Debounced scanner ────────────────────────────────────────── */
  var _timer = null;

  function runScan() {
    _timer = null;
    appendTip(); /* ensure tip is in body after SPA navigations */

    var body = document.body;
    if (!body) return;

    /* Collect ALL matching text nodes into an array FIRST,
       then modify — avoids invalidating the TreeWalker mid-walk */
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    var batch = [];
    var node;
    while ((node = walker.nextNode()) !== null) {
      var txt = node.nodeValue || '';
      ISSUE_RE.lastIndex = 0;
      if (ISSUE_RE.test(txt)) batch.push(node);
    }
    batch.forEach(decorateTextNode);
  }

  function scheduleOrReset() {
    clearTimeout(_timer);
    _timer = setTimeout(runScan, 1500); /* 1.5 s quiet period after last mutation */
  }

  /* ── MutationObserver ─────────────────────────────────────────── */
  var observer = new MutationObserver(function (mutations) {
    /* Ignore mutations that are only our own spans being inserted
       (they'd ping-pong the timer forever otherwise) */
    var skip = true;
    for (var i = 0; i < mutations.length && skip; i++) {
      var m = mutations[i];
      for (var j = 0; j < m.addedNodes.length && skip; j++) {
        var n = m.addedNodes[j];
        if (n.nodeType === 1 && n.classList && n.classList.contains('bc-issue-mention')) continue;
        skip = false;
      }
      if (m.type === 'characterData') skip = false;
    }
    if (!skip) scheduleOrReset();
  });

  function start() {
    var target = document.body || document.documentElement;
    if (!target) { setTimeout(start, 300); return; }
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    /* Initial scan for content already in the DOM */
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

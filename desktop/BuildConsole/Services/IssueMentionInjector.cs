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

  /* Called by MainWindow after resolving issue data */
  window.__btShowIssueTip = function (number, title, status, isEpic) {
    if (_tipNum !== number || !_tipVisible) return;
    var anchor = document.querySelector('.bc-issue-mention[data-bc-num="' + number + '"]:hover');
    if (!anchor) return;
    var icon  = isEpic ? '\ud83d\udd37' : '\ud83d\udd39';
    var badge = status === 'CLOSED'
      ? '<span style="color:#F38BA8;font-size:11px;font-weight:600">\u25cf CLOSED</span>'
      : '<span style="color:#A6E3A1;font-size:11px;font-weight:600">\u25cf OPEN</span>';
    tipBody.innerHTML = icon + ' <strong style="color:#89B4FA">#' + number + '</strong> '
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
      tipBody.innerHTML = '\ud83d\udd39 <strong style="color:#89B4FA">#' + num + '</strong>'
        + ' <span style="color:#585B70">Loading\u2026</span>';
      showTip(span);
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
    if (!tn.isConnected) return;
    var parent = tn.parentElement;
    if (!parent) return;
    if (parent.classList && parent.classList.contains('bc-issue-mention')) return;
    var el = parent;
    while (el) {
      if (SKIP_TAGS[el.nodeName]) return;
      el = el.parentElement;
    }
    var text = tn.nodeValue || '';
    ISSUE_RE.lastIndex = 0;
    if (!ISSUE_RE.test(text)) return;

    ISSUE_RE.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var last = 0, m;
    while ((m = ISSUE_RE.exec(text)) !== null) {
      var num = parseInt(m[1], 10);
      if (num >= 100000) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeSpan(num, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    if (!tn.isConnected) return;
    try { parent.replaceChild(frag, tn); } catch(e) {}
  }

  /* ── Debounced scanner ────────────────────────────────────────── */
  var _timer = null;

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
      if (ISSUE_RE.test(txt)) batch.push(node);
    }
    batch.forEach(decorateTextNode);
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
        if (n.nodeType === 1 && n.classList && n.classList.contains('bc-issue-mention')) continue;
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

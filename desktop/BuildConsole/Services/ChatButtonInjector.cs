namespace BuildConsole.Services
{
    /// <summary>
    /// Git #814 — Shane: "can I use it like the addon? with the UI elements
    /// in the Chat?" Ports content.js's "Send to Builder" / "Queue" button
    /// bar (scanForCodeBlockButtons/buildCodeBlockButtonBar) into a script
    /// injected via CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync on
    /// every claude.ai WebView2 this app owns — same DOM-scanning approach,
    /// same button behavior, but chrome.runtime/chrome.storage calls are
    /// replaced with window.chrome.webview.postMessage() so MainWindow's own
    /// WebMessageReceived handler can act on them directly (call the real
    /// API client, or Process.Start the same mybuilder:// URI the browser
    /// extension already uses — same OS-registered handler either way).
    /// First pass: skips #783's "smart disabled state" (needs live
    /// in-progress polling wired into the script) and #777's --blocked-by
    /// smart validation UX beyond the alert — not browser/live-verified.
    /// </summary>
    public static class ChatButtonInjector
    {
        public const string Script = """
(function () {
  if (window.__btInjected) return;
  window.__btInjected = true;

  const SQL_BLOCK_RE = /^\s*(--.*\n)*\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|BEGIN|GRANT|REVOKE)\b/i;
  function classifyCodeBlock(text) { return SQL_BLOCK_RE.test(text) ? "sql" : "prompt"; }

  function extractLeadingFlags(text) {
    const newlineIdx = text.indexOf("\n");
    const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
    // Git #820 — [\w-] not \w alone, so a hyphenated flag name like
    // --blocked-by actually matches (see content.js's same fix for the
    // full story: this bug sent claude.exe an unstripped prompt starting
    // with "--model", which its own arg parser rejected as an unknown
    // option — "806 failed... exit 1").
    const flagRe = /--([\w-]+)\s+(\S+)/g;
    const flags = {};
    let matched;
    while ((matched = flagRe.exec(firstLine)) !== null) flags[matched[1]] = matched[2];
    if (Object.keys(flags).length === 0 || firstLine.replace(/--([\w-]+)\s+(\S+)/g, "").trim() !== "") {
      return { flags: {}, rest: text };
    }
    const rest = (newlineIdx === -1 ? "" : text.slice(newlineIdx + 1)).replace(/^\n+/, "");
    return { flags, rest };
  }

  function extractReferencedIssueNumber(text) {
    const { flags } = extractLeadingFlags(text);
    if (flags.title && /^\d+$/.test(flags.title)) return parseInt(flags.title, 10);
    const m = text.match(/#(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function post(type, payload) {
    window.chrome.webview.postMessage(JSON.stringify(Object.assign({ type: type }, payload)));
  }

  // Git #942 — the app's bridge back onto the injected Queue buttons. Right
  // after a Queue click the clicked button carries data-bt-correlation (a token
  // the app echoes back so it can find the exact element that was clicked); once
  // the app has the real queue item id from the POST it swaps that for
  // data-bt-queue-id — and tags the block's OTHER bar's Queue button (same
  // data-bt-block) with it too, so both bars live-update in lockstep. Every
  // later status push finds its targets by that id. All three look elements up
  // by attribute so they keep working even after the click handler's closure is
  // long gone.
  var __btCorrSeq = 0;
  var __btBlockSeq = 0;
  window.__btTagQueued = function (correlation, queueId) {
    // Git #942 follow-up — find the exact button that was clicked (by its
    // correlation token), then tag EVERY Queue button belonging to the same
    // source block, not just this one. buildButtonBar stamps both the top and
    // bottom bars' Queue buttons with the same data-bt-block id, so the sibling
    // bar's button (whichever one wasn't clicked) gets the real data-bt-queue-id
    // too and can be found + live-updated later — before this fix it was never
    // tagged at all and stayed stuck on its original "📋 Queue" label forever.
    var clicked = document.querySelector('[data-bt-correlation="' + correlation + '"]');
    if (!clicked) return;
    var block = clicked.dataset.btBlock;
    var els = block
      ? document.querySelectorAll('[data-bt-block="' + block + '"]')
      : [clicked];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.dataset.btQueueId = String(queueId);
      delete el.dataset.btCorrelation;
      delete el.dataset.btFailed;
      el.disabled = true;
      el.textContent = "In Progress...";
    }
  };
  window.__btApplyStatus = function (queueId, label, mode) {
    // querySelectorAll, not querySelector: __btTagQueued now stamps BOTH the top
    // and bottom bars' Queue buttons for a block with the same data-bt-queue-id
    // (Git #942 follow-up), so one status push updates every bar at once.
    var els = document.querySelectorAll('[data-bt-queue-id="' + queueId + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.textContent = label;
      // Git #942 follow-up — the "Send to Builder" button is this Queue button's
      // immediate previous sibling in the same bar (buildButtonBar appends
      // Send-to-Builder then Queue). Hide it once the block is queued/running/
      // done so the bar isn't still offering "launch now" for an in-flight
      // build; restore it only if the build fails and Queue reverts to its
      // retry-able state.
      var sendSib = el.previousElementSibling;
      if (mode === "failed") {
        // Stays clickable on purpose: its existing click handler re-runs
        // queueBuild(), which IS the retry (a brand new correlation -> new id).
        el.dataset.btFailed = "1";
        el.disabled = false;
        if (sendSib) sendSib.style.display = "";
      } else {
        // "In Progress..." and "Done" are both non-interactive terminal-ish states.
        delete el.dataset.btFailed;
        el.disabled = true;
        if (sendSib) sendSib.style.display = "none";
      }
    }
  };
  window.__btQueueFailed = function (correlation) {
    // The queue POST itself failed (or the app isn't connected) — nothing was
    // ever queued, so restore the button to its original clickable label
    // rather than leaving it stuck disabled on "In Progress...".
    var el = document.querySelector('[data-bt-correlation="' + correlation + '"]');
    if (!el) return;
    delete el.dataset.btCorrelation;
    el.disabled = false;
    el.textContent = el.dataset.btOrigLabel || "📋 Queue";
  };

  function sendToBuilder(prompt) {
    const { flags, rest } = extractLeadingFlags(prompt);
    post("BT_SEND_TO_BUILDER", {
      prompt: rest,
      title: flags.title || null,
      model: flags.model || null,
      effort: flags.effort || null,
      cwd: flags.cwd || null,
      mode: flags.mode || null,
    });
  }

  function queueBuild(prompt, referencedNumber, btn) {
    const { flags, rest } = extractLeadingFlags(prompt);
    let blockedByNumbers = null;
    if (flags["blocked-by"]) {
      const parts = flags["blocked-by"].split(",").map((s) => s.trim()).filter(Boolean);
      const nums = parts.filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));
      if (nums.length !== parts.length) {
        window.alert('--blocked-by "' + flags["blocked-by"] + '" has a non-numeric entry - fix it and try again (comma-separate multiple issue numbers).');
        return;
      }
      blockedByNumbers = nums;
    }
    // Git #1034 — Shane: "I'm doing a lot of builds that dont need git... it's
    // just noise. But I want to use the same queue... can we create our own
    // customer numbering as a fallback? --notGit 2 --block-by 1 same type of
    // thing." --notGit N declares this build as a LOCAL pseudo-issue N (Shane's
    // own small per-session numbering, not a real GitHub issue) — encoded as
    // githubNumber = -N so it can never collide with a real GitHub issue number
    // (those are always positive), while still flowing through every existing
    // githubNumber-keyed mechanism (queue grouping/nesting, chat-tab
    // correlation, retry-upsert) unmodified. --block-by N[,N...] is the same
    // idea for blockedByNumbers — a local-numbering-only sibling of the real
    // --blocked-by flag above, negated the same way, so "--notGit 2 --block-by 1"
    // queues local #2 blocked on local #1, entirely independent of any real
    // GitHub issue.
    let effectiveNumber = referencedNumber;
    if (flags.notGit && /^\d+$/.test(flags.notGit)) {
      effectiveNumber = -parseInt(flags.notGit, 10);
    }
    if (flags["block-by"]) {
      const parts = flags["block-by"].split(",").map((s) => s.trim()).filter(Boolean);
      const nums = parts.filter((s) => /^\d+$/.test(s)).map((s) => -parseInt(s, 10));
      if (nums.length !== parts.length) {
        window.alert('--block-by "' + flags["block-by"] + '" has a non-numeric entry - fix it and try again (comma-separate multiple LOCAL --notGit numbers).');
        return;
      }
      blockedByNumbers = (blockedByNumbers || []).concat(nums);
    }
    const numberLabel = effectiveNumber != null ? (effectiveNumber < 0 ? "local #" + (-effectiveNumber) : "#" + effectiveNumber) : null;
    const title = flags.title
      ? (numberLabel != null ? numberLabel + " — " + flags.title : flags.title)
      : (numberLabel != null ? numberLabel : rest.split("\n")[0].slice(0, 80));
    // Git #942 — tag THIS exact button with a unique correlation token so the
    // app can push the real queue id back onto it (via __btTagQueued) once the
    // POST returns, then push live status onto that same element by id. It
    // stays disabled on "In Progress..." until the app answers: __btTagQueued
    // on success, or __btQueueFailed if the queue call failed. This same
    // function is also the retry path — a "Failed: Retry" click re-enters here
    // and re-queues under a fresh correlation/id (btFailed cleared below).
    const correlation = "btq-" + (++__btCorrSeq) + "-" + Date.now();
    btn.dataset.btCorrelation = correlation;
    delete btn.dataset.btFailed;
    btn.disabled = true;
    btn.textContent = "In Progress...";
    post("BT_QUEUE_BUILD", {
      title: title,
      prompt: rest,
      model: flags.model || null,
      effort: flags.effort || null,
      cwd: flags.cwd || null,
      githubNumber: effectiveNumber,
      blockedByNumbers: blockedByNumbers,
      correlation: correlation,
    });
  }

  function loadIntoSqlRunner(text) {
    post("BT_LOAD_SQL", { sql: text });
  }

  function buildButtonBar(kind, text, marginSide, referencedNumber, blockId) {
    const bar = document.createElement("div");
    bar.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-" + marginSide + ": 4px;";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = kind === "sql" ? "🗄 Load into SQL Runner" : "🚀 Send to Builder";
    btn.style.cssText =
      "padding: 3px 10px; border-radius: 5px; border: 1px solid #3b3b3b; background: #242424; " +
      "color: #d6d4d2; font-size: 11px; font-weight: 600; cursor: pointer; font-family: -apple-system, sans-serif;";
    btn.addEventListener("mouseenter", function () { if (!btn.disabled) btn.style.background = "#2e2e2e"; });
    btn.addEventListener("mouseleave", function () { if (!btn.disabled) btn.style.background = "#242424"; });
    btn.addEventListener("click", function () { if (kind === "sql") loadIntoSqlRunner(text); else sendToBuilder(text); });
    bar.appendChild(btn);
    if (kind === "prompt") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "✏️ Edit";
      editBtn.title = "Open in editor window to modify prompt and configure blockers before building";
      editBtn.style.cssText = btn.style.cssText;
      editBtn.addEventListener("mouseenter", function () { editBtn.style.background = "#2e2e2e"; });
      editBtn.addEventListener("mouseleave", function () { editBtn.style.background = "#242424"; });
      editBtn.addEventListener("click", function () {
        post("BT_EDIT_BUILD", {
          rawText: text,
          referencedNumber: referencedNumber
        });
      });
      bar.appendChild(editBtn);

      const queueBtn = document.createElement("button");
      queueBtn.type = "button";
      queueBtn.textContent = "📋 Queue";
      // Git #942 — remembered so __btQueueFailed can restore it verbatim if the
      // queue POST fails after the click already flipped it to "In Progress...".
      queueBtn.dataset.btOrigLabel = "📋 Queue";
      // Git #942 follow-up — the shared per-block id (identical on this block's
      // OTHER bar's Queue button) so __btTagQueued can find and tag both bars at
      // once when either one's click resolves to a real queue id.
      queueBtn.dataset.btBlock = blockId;
      queueBtn.title = "Add to the build queue instead of launching now";
      queueBtn.style.cssText = btn.style.cssText;
      queueBtn.addEventListener("mouseenter", function () { queueBtn.style.background = "#2e2e2e"; });
      queueBtn.addEventListener("mouseleave", function () { queueBtn.style.background = "#242424"; });
      queueBtn.addEventListener("click", function () { queueBuild(text, referencedNumber, queueBtn); });
      bar.appendChild(queueBtn);
    }
    return bar;
  }

  function scan(root) {
    const blocks = root.querySelectorAll ? root.querySelectorAll("pre") : [];
    for (const pre of blocks) {
      if (pre.dataset.btScanned || !pre.parentElement) continue;
      pre.dataset.btScanned = "1";
      const text = (pre.innerText || pre.textContent || "").trim();
      if (!text) continue;
      const kind = classifyCodeBlock(text);
      const referencedNumber = kind === "prompt" ? extractReferencedIssueNumber(text) : null;
      // Git #942 follow-up — one id shared by BOTH bars built for this block, so
      // a Queue click on either can tag the other with the same data-bt-queue-id.
      const blockId = "btb-" + (++__btBlockSeq);
      pre.parentElement.insertBefore(buildButtonBar(kind, text, "bottom", referencedNumber, blockId), pre);
      pre.parentElement.insertBefore(buildButtonBar(kind, text, "top", referencedNumber, blockId), pre.nextSibling);
    }
  }

  function init() {
    let debounce = null;
    function schedule() {
      clearTimeout(debounce);
      debounce = setTimeout(function () { scan(document.body); }, 600);
    }
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
""";
    }
}

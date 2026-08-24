namespace BuildConsole.Services
{
    /// <summary>
    /// Git #814 — Shane: "can I use it like the addon? with the UI elements
    /// in the Chat?" Ports content.js's "Send to Builder" / "Queue" / "Edit" button
    /// bar (scanForCodeBlockButtons/buildCodeBlockButtonBar) into a script
    /// injected via CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync on
    /// every claude.ai WebView2 this app owns — same DOM-scanning approach,
    /// same button behavior, but chrome.runtime/chrome.storage calls are
    /// replaced with window.chrome.webview.postMessage() so MainWindow's own
    /// WebMessageReceived handler can act on them directly (call the real
    /// API client, or Process.Start the same mybuilder:// URI the browser
    /// extension already uses — same OS-registered handler either way).
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

  var __btCorrSeq = 0;
  var __btBlockSeq = 0;
  window.__btTagQueued = function (correlation, queueId) {
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
    var els = document.querySelectorAll('[data-bt-queue-id="' + queueId + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.textContent = label;
      var bar = el.parentElement;
      if (!bar) continue;
      var sendSib = bar.querySelector(".bt-btn-send");
      var editSib = bar.querySelector(".bt-btn-edit");
      if (mode === "waiting") {
        el.dataset.btWaiting = "1";
        delete el.dataset.btFailed;
        el.disabled = false;
        el.style.borderColor = "#F9E2AF";
        el.style.backgroundColor = "#3E2C1A";
        el.style.color = "#F9E2AF";
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
      } else if (mode === "progress") {
        delete el.dataset.btWaiting;
        delete el.dataset.btFailed;
        el.disabled = true;
        el.style.borderColor = "#89B4FA";
        el.style.backgroundColor = "#1D2E45";
        el.style.color = "#89B4FA";
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
      } else if (mode === "done") {
        delete el.dataset.btWaiting;
        delete el.dataset.btFailed;
        el.disabled = true;
        el.style.borderColor = "#A6E3A1";
        el.style.backgroundColor = "#1C3527";
        el.style.color = "#A6E3A1";
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
      } else if (mode === "failed") {
        el.dataset.btFailed = "1";
        delete el.dataset.btWaiting;
        el.disabled = false;
        el.style.borderColor = "#F38BA8";
        el.style.backgroundColor = "#3A1E26";
        el.style.color = "#F38BA8";
        if (sendSib) sendSib.style.display = "";
        if (editSib) editSib.style.display = "";
      } else {
        delete el.dataset.btFailed;
        delete el.dataset.btWaiting;
        el.disabled = true;
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
      }
    }
  };

  window.__btQueueFailed = function (correlation) {
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
      chatUrl: window.location.href,
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
      chatUrl: window.location.href,
    });
  }

  function loadIntoSqlRunner(text) {
    post("BT_LOAD_SQL", { sql: text });
  }

  // Reads the block's CURRENT full text straight off the live DOM node.
  // Buttons must call this at CLICK time, not capture a string when the bar
  // is first built - Claude still streams tokens into the <pre> after the
  // MutationObserver's debounce first settles enough to attach a bar (a
  // quiet gap of >600ms mid-stream is enough to trigger it early), and a
  // captured closure over that early snapshot would forever stay stuck at
  // whatever had rendered by then - typically just the block's first line.
  function currentBlockText(pre) {
    return (pre.innerText || pre.textContent || "").trim();
  }

  function buildButtonBar(kind, pre, marginSide, blockId) {
    const bar = document.createElement("div");
    bar.className = "bt-button-bar bt-button-bar-" + marginSide;
    bar.dataset.btBlock = blockId;
    bar.style.cssText = "display: flex; justify-content: flex-end; gap: 6px; margin-" + marginSide + ": 4px;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bt-btn-send";
    btn.textContent = kind === "sql" ? "🗄 Load into SQL Runner" : "🚀 Send to Builder";
    btn.style.cssText =
      "padding: 3px 10px; border-radius: 5px; border: 1px solid #3b3b3b; background: #242424; " +
      "color: #d6d4d2; font-size: 11px; font-weight: 600; cursor: pointer; font-family: -apple-system, sans-serif;";
    btn.addEventListener("mouseenter", function () { if (!btn.disabled) btn.style.background = "#2e2e2e"; });
    btn.addEventListener("mouseleave", function () { if (!btn.disabled) btn.style.background = "#242424"; });
    btn.addEventListener("click", function () {
      const text = currentBlockText(pre);
      if (kind === "sql") loadIntoSqlRunner(text); else sendToBuilder(text);
    });
    bar.appendChild(btn);

    if (kind === "prompt") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "bt-btn-edit";
      editBtn.textContent = "✏️ Edit";
      editBtn.title = "Open in editor window to modify prompt and configure blockers before building";
      editBtn.style.cssText = btn.style.cssText;
      editBtn.addEventListener("mouseenter", function () { editBtn.style.background = "#2e2e2e"; });
      editBtn.addEventListener("mouseleave", function () { editBtn.style.background = "#242424"; });
      editBtn.addEventListener("click", function () {
        const text = currentBlockText(pre);
        post("BT_EDIT_BUILD", {
          rawText: text,
          referencedNumber: extractReferencedIssueNumber(text)
        });
      });
      bar.appendChild(editBtn);

      const queueBtn = document.createElement("button");
      queueBtn.type = "button";
      queueBtn.className = "bt-btn-queue";
      queueBtn.textContent = "📋 Queue";
      queueBtn.dataset.btOrigLabel = "📋 Queue";
      queueBtn.dataset.btBlock = blockId;
      queueBtn.title = "Add to the build queue instead of launching now";
      queueBtn.style.cssText = btn.style.cssText;
      queueBtn.addEventListener("mouseenter", function () { queueBtn.style.background = "#2e2e2e"; });
      queueBtn.addEventListener("mouseleave", function () { queueBtn.style.background = "#242424"; });
      queueBtn.addEventListener("click", function () {
        const text = currentBlockText(pre);
        queueBuild(text, extractReferencedIssueNumber(text), queueBtn);
      });
      bar.appendChild(queueBtn);
    }
    return bar;
  }

  function scan(root) {
    const blocks = root.querySelectorAll ? root.querySelectorAll("pre") : [];
    for (const pre of blocks) {
      if (!pre.parentElement) continue;

      // If already scanned and has its attached bar, don't duplicate
      if (pre.dataset.btScanned && pre.previousElementSibling && pre.previousElementSibling.classList.contains("bt-button-bar")) {
        continue;
      }

      const text = currentBlockText(pre);
      if (!text) continue;

      // Clean up any stale or duplicated adjacent button bars before inserting
      while (pre.previousElementSibling && pre.previousElementSibling.classList.contains("bt-button-bar")) {
        pre.previousElementSibling.remove();
      }
      while (pre.nextElementSibling && pre.nextElementSibling.classList.contains("bt-button-bar")) {
        pre.nextElementSibling.remove();
      }

      pre.dataset.btScanned = "1";
      const kind = classifyCodeBlock(text);
      const blockId = "btb-" + (++__btBlockSeq);

      // Top bar (above pre)
      pre.parentElement.insertBefore(buildButtonBar(kind, pre, "bottom", blockId), pre);
      // Bottom bar (below pre)
      pre.parentElement.insertBefore(buildButtonBar(kind, pre, "top", blockId), pre.nextSibling);
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

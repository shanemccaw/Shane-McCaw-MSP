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

  // Git #2774 — a shell/CLI command block, same-style heuristic as SQL_BLOCK_RE. Anchored at the
  // string start (no /m flag): leading blank lines and #-comment lines are consumed first, so this
  // matches only the FIRST real command line — a prose "prompt" block whose body happens to mention
  // one of these words further down is NOT caught. Build-dispatch blocks start with a "--flag" line
  // (or "BUILD:" / plain prose) and never with one of these executables, so they still fall through
  // to "prompt" and keep the Send-to-Builder bar. The list is the real CLIs this repo drives from
  // chat (the issue names npm/npx/pnpm/yarn/git first), extend as needed. Git #2810 added
  // winget (the reported gap) plus other genuinely-likely real Windows commands: choco,
  // msiexec, robocopy, copy, del, type, findstr.
  const SHELL_BLOCK_RE = /^\s*(?:#.*\n|\s*\n)*\s*(?:sudo\s+)?(npm|npx|pnpm|yarn|node|tsc|vitest|jest|deno|bun|git|gh|az|dotnet|python3?|pip3?|curl|wget|docker|kubectl|terraform|make|cargo|go|psql|bash|sh|pwsh|powershell|winget|choco|msiexec|robocopy|copy|del|type|findstr|cd|ls|dir|cat|echo|mkdir|rm|cp|mv|export|set)\b/i;

  function classifyCodeBlock(text) {
    if (SQL_BLOCK_RE.test(text)) return "sql";
    if (SHELL_BLOCK_RE.test(text)) return "shell";
    return "prompt";
  }

  // Git #2774 — real tools a shell block can be sent to for execution. Only tools that are ACTUALLY
  // built and wired right now belong here (Terminal, from #2769). Add a row as each new tool lands;
  // the picker below renders straight from this array, so it's never hardcoded to one entry.
  const SEND_TO_TOOLS = [
    { id: "terminal", label: "Terminal" },
  ];

  function extractLeadingFlags(text) {
    const newlineIdx = text.indexOf("\n");
    let firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
    // Allow a valueless --notGit (letter id auto-allocated): normalize a bare "--notGit"
    // (end of line, or right before another --flag) to "--notGit local" so the flag/value
    // regex still recognizes it. "--notGit 109" is left untouched (value ignored downstream).
    firstLine = firstLine.replace(/--notGit(?=\s+--|\s*$)/g, "--notGit local");
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

  // Git #1638 — tags the exact button (+ its bar-mates, same as __btTagQueued) with the
  // real queue id of a PARKED row, and gives it its own neutral "staged, not running yet"
  // look distinct from __btApplyStatus's "progress" blue — parked isn't in progress.
  window.__btTagParked = function (correlation, queueId) {
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
      el.textContent = "📥 Parked";
      el.style.borderColor = "#6C7086";
      el.style.backgroundColor = "#21222E";
      el.style.color = "#BAB4CD";
    }
  };

  // Git #1638 — the generalized dedup check found an existing row (active or a confirmed
  // terminal re-run) instead of inserting a new one. Leaves the button ENABLED (unlike
  // __btTagQueued/__btTagParked) and tags it data-bt-duplicate-id so its own click handler
  // (see queueBuild/park button wiring below) posts BT_REVEAL_QUEUE_ITEM instead of queuing
  // again — "jump to the existing item" instead of a silent second row.
  window.__btAlreadyExists = function (correlation, queueId, label) {
    var clicked = document.querySelector('[data-bt-correlation="' + correlation + '"]');
    if (!clicked) return;
    var block = clicked.dataset.btBlock;
    var els = block
      ? document.querySelectorAll('[data-bt-block="' + block + '"]')
      : [clicked];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      delete el.dataset.btCorrelation;
      delete el.dataset.btFailed;
      el.dataset.btDuplicateId = String(queueId);
      el.disabled = false;
      el.textContent = label;
      el.title = "Already exists in the Build Queue — click to jump to it.";
      el.style.borderColor = "#89B4FA";
      el.style.backgroundColor = "#1E2030";
      el.style.color = "#89B4FA";
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
      if (mode === "parked") {
        el.dataset.btWaiting = "0";
        delete el.dataset.btFailed;
        el.disabled = true;
        el.style.borderColor = "#6C7086";
        el.style.backgroundColor = "#21222E";
        el.style.color = "#BAB4CD";
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
      } else if (mode === "waiting") {
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
      } else if (mode === "capped") {
        // Git #1989 — Conservation Cap: parked because it exceeded Sonnet High.
        // Peach, not "parked"'s neutral gray, matching the same distinct accent
        // BuildQueuePanel's own capped pill/card use.
        el.dataset.btWaiting = "0";
        delete el.dataset.btFailed;
        el.disabled = true;
        el.style.borderColor = "#FAB387";
        el.style.backgroundColor = "#2A201A";
        el.style.color = "#FAB387";
        if (sendSib) sendSib.style.display = "none";
        if (editSib) editSib.style.display = "none";
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

  // Git #1638 — jumps to an existing queue item instead of re-queuing/re-parking it.
  function revealQueueItem(queueId) {
    post("BT_REVEAL_QUEUE_ITEM", { queueId: queueId });
  }

  function queueBuild(prompt, referencedNumber, btn, park) {
    const { flags, rest } = extractLeadingFlags(prompt);

    // GitHub blockers (--blocked-by): plain issue numbers.
    let gitBlockers = [];
    if (flags["blocked-by"]) {
      const parts = flags["blocked-by"].split(",").map((s) => s.trim()).filter(Boolean);
      const bad = parts.filter((s) => !/^\d+$/.test(s));
      if (bad.length) {
        window.alert('--blocked-by "' + flags["blocked-by"] + '" must be GitHub issue numbers. For LOCAL blockers use --block-by with letter ids (e.g. --block-by A,AB).');
        return;
      }
      gitBlockers = parts;
    }

    // LOCAL blockers (--block-by): letter ids (A, AB…). Legacy numeric ids still tolerated.
    let localBlockers = [];
    if (flags["block-by"]) {
      const parts = flags["block-by"].split(",").map((s) => s.trim()).filter(Boolean);
      const bad = parts.filter((s) => !/^[A-Za-z]+$/.test(s) && !/^\d+$/.test(s));
      if (bad.length) {
        window.alert('--block-by "' + flags["block-by"] + '" must be LOCAL letter ids (e.g. --block-by A,AB).');
        return;
      }
      localBlockers = parts;
    }

    // --notGit (any value, or none) => LOCAL build. The letter id (A, B, C…) is
    // auto-allocated by BuildConsole when queued, so no number is computed here.
    // Otherwise the build is tied to its referenced GitHub issue.
    const localBuild = flags.notGit != null;
    const effectiveNumber = localBuild ? null : referencedNumber;

    const numberLabel = localBuild ? "local (new)" : (effectiveNumber != null ? "#" + effectiveNumber : null);
    const title = flags.title
      ? (numberLabel != null ? numberLabel + " — " + flags.title : flags.title)
      : (numberLabel != null ? numberLabel : rest.split("\n")[0].slice(0, 80));
    const correlation = "btq-" + (++__btCorrSeq) + "-" + Date.now();
    btn.dataset.btCorrelation = correlation;
    delete btn.dataset.btFailed;
    btn.disabled = true;
    btn.textContent = park ? "Parking..." : "In Progress...";
    post("BT_QUEUE_BUILD", {
      title: title,
      prompt: rest,
      model: flags.model || null,
      effort: flags.effort || null,
      cwd: flags.cwd || null,
      buildSet: flags.buildSet || null,
      cli: flags.cli || null,
      account: flags.account || null,
      githubNumber: effectiveNumber,
      localBuild: localBuild,
      gitBlockers: gitBlockers,
      localBlockers: localBlockers,
      correlation: correlation,
      chatUrl: window.location.href,
      park: !!park,
    });
  }

  function loadIntoSqlRunner(text) {
    post("BT_LOAD_SQL", { sql: text });
  }

  // Git #2774 — hand a shell block's real text to a chosen tool for real execution. The C# handler
  // (BT_SEND_TO_TOOL in MainWindow.xaml.cs) resolves this chat tab, opens/focuses its tool rail with
  // the tool active, and feeds the text in (Terminal runs it as a real queued multi-line sequence).
  function sendToTool(tool, text) {
    post("BT_SEND_TO_TOOL", { tool: tool, text: text });
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

    // Git #2774 — a shell/CLI block is NOT a build-dispatch prompt, so it gets a real tool-picker
    // dropdown ("Select tool ▾") instead of the Send-to-Builder / Edit / Queue / Park bar. Picking a
    // tool sends the block's real text into that tool for real execution (BT_SEND_TO_TOOL). Rendered
    // straight from SEND_TO_TOOLS so it extends automatically as more real tools land — no other
    // buttons on a shell block.
    if (kind === "shell") {
      const picker = document.createElement("select");
      picker.className = "bt-tool-picker";
      picker.title = "Send this command block to a tool for execution";
      picker.style.cssText =
        "padding: 3px 10px; border-radius: 5px; border: 1px solid #3b3b3b; background: #242424; " +
        "color: #d6d4d2; font-size: 11px; font-weight: 600; cursor: pointer; font-family: -apple-system, sans-serif;";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select tool ▾";
      placeholder.disabled = true;
      placeholder.selected = true;
      picker.appendChild(placeholder);
      for (const tool of SEND_TO_TOOLS) {
        const opt = document.createElement("option");
        opt.value = tool.id;
        opt.textContent = tool.label;
        picker.appendChild(opt);
      }
      picker.addEventListener("change", function () {
        const toolId = picker.value;
        if (!toolId) return;
        sendToTool(toolId, currentBlockText(pre));
        // Reset back to the placeholder so the same block can be re-sent (a re-run) with one click.
        picker.selectedIndex = 0;
      });
      bar.appendChild(picker);
      return bar;
    }

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
        // Git #1638 — a previous click on this exact block already surfaced an
        // existing duplicate; clicking again jumps to it instead of re-checking.
        if (queueBtn.dataset.btDuplicateId) {
          revealQueueItem(parseInt(queueBtn.dataset.btDuplicateId, 10));
          return;
        }
        const text = currentBlockText(pre);
        queueBuild(text, extractReferencedIssueNumber(text), queueBtn, false);
      });
      bar.appendChild(queueBtn);

      // Git #1638 — Park: stages the same payload as Queue, but lands in the
      // 'parked' status instead of 'queued', which the watcher's claim query
      // (WHERE status = 'queued') never picks up. A staging spot Shane can send
      // into the real queue later via the Build Queue panel's Un-park action.
      const parkBtn = document.createElement("button");
      parkBtn.type = "button";
      parkBtn.className = "bt-btn-park";
      parkBtn.textContent = "🅿️ Park";
      parkBtn.dataset.btOrigLabel = "🅿️ Park";
      parkBtn.dataset.btBlock = blockId;
      parkBtn.title = "Stage this build without queuing it to run yet";
      parkBtn.style.cssText = btn.style.cssText;
      parkBtn.addEventListener("mouseenter", function () { if (!parkBtn.disabled) parkBtn.style.background = "#2e2e2e"; });
      parkBtn.addEventListener("mouseleave", function () { if (!parkBtn.disabled) parkBtn.style.background = "#242424"; });
      parkBtn.addEventListener("click", function () {
        if (parkBtn.dataset.btDuplicateId) {
          revealQueueItem(parseInt(parkBtn.dataset.btDuplicateId, 10));
          return;
        }
        const text = currentBlockText(pre);
        queueBuild(text, extractReferencedIssueNumber(text), parkBtn, true);
      });
      bar.appendChild(parkBtn);
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

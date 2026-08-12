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
    const flagRe = /--(\w+)\s+(\S+)/g;
    const flags = {};
    let matched;
    while ((matched = flagRe.exec(firstLine)) !== null) flags[matched[1]] = matched[2];
    if (Object.keys(flags).length === 0 || firstLine.replace(/--(\w+)\s+(\S+)/g, "").trim() !== "") {
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
    const title = flags.title
      ? (referencedNumber != null ? "#" + referencedNumber + " — " + flags.title : flags.title)
      : (referencedNumber != null ? "#" + referencedNumber : rest.split("\n")[0].slice(0, 80));
    btn.disabled = true;
    post("BT_QUEUE_BUILD", {
      title: title,
      prompt: rest,
      model: flags.model || null,
      effort: flags.effort || null,
      cwd: flags.cwd || null,
      githubNumber: referencedNumber,
      blockedByNumbers: blockedByNumbers,
    });
    setTimeout(function () { btn.disabled = false; btn.textContent = "📋 Queued"; }, 400);
  }

  function loadIntoSqlRunner(text) {
    post("BT_LOAD_SQL", { sql: text });
  }

  function buildButtonBar(kind, text, marginSide, referencedNumber) {
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
      const queueBtn = document.createElement("button");
      queueBtn.type = "button";
      queueBtn.textContent = "📋 Queue";
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
      pre.parentElement.insertBefore(buildButtonBar(kind, text, "bottom", referencedNumber), pre);
      pre.parentElement.insertBefore(buildButtonBar(kind, text, "top", referencedNumber), pre.nextSibling);
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

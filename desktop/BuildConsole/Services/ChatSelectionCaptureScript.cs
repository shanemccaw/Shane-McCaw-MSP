namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2699 (Feature: Test Pad #2530) — "right-click a real text selection → Send Selection
    /// to Test Pad". This is the JS half: a one-shot script (run via <c>ExecuteScriptAsync</c>)
    /// that reads the USER's live DOM selection in a claude.ai chat and walks it into markdown,
    /// with real table structure preserved.
    ///
    /// <para><b>Why a JS getSelection round-trip and not <c>ContextMenuTarget.SelectionText</c>
    /// (the point-1 choice).</b> The native <c>CoreWebView2.ContextMenuRequested</c> event is what
    /// the host uses to ADD the menu item (gated on <c>ContextMenuTarget.HasSelection</c> so it
    /// only appears on a real selection). But its <c>SelectionText</c> is flattened plain text —
    /// a rendered markdown table comes back as word-soup with the row/column structure gone, which
    /// is exactly what point 2 of the issue says must NOT happen. So the host adds the item via
    /// the native event, but on click runs THIS script to read <c>window.getSelection()</c> and
    /// reconstruct real markdown (including <c>| # | Feature | … |</c> table syntax) from the
    /// selected DOM range. Cleaner structure beats the flat string.</para>
    ///
    /// <para>Extraction walks <c>range.cloneContents()</c> (a fragment that keeps the selected
    /// subtree's real element structure — <c>table</c>/<c>tr</c>/<c>td</c> and all) rather than
    /// <c>innerText</c>, whose own line-break behaviour destroys a table. The block/inline walkers
    /// are the same shape already proven in <see cref="FloatingChatBridgeScript"/>'s capture
    /// script, EXCEPT tables are emitted as genuine markdown tables (header row + <c>---</c>
    /// separator + body rows), not the flattened rows that script deliberately produces (its
    /// consumer, <see cref="MarkdownRenderer"/>, has no table grammar; a Test Pad note is plain
    /// markdown text a human reads back, so real pipe syntax is correct here).</para>
    ///
    /// <para>Returns a plain string (the markdown, or <c>""</c> when there is no usable selection).
    /// <c>ExecuteScriptAsync</c> hands it back JSON-encoded, so the host deserializes with
    /// <c>JsonSerializer.Deserialize&lt;string&gt;</c>. Never throws out of the IIFE — on any DOM
    /// surprise it falls back to the selection's plain text, and only ever returns <c>""</c> when
    /// there is genuinely nothing selected.</para>
    /// </summary>
    public static class ChatSelectionCaptureScript
    {
        public const string Script = """
(function () {
  try {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
    var plain = (sel.toString() || "");

    // Pull every selected range into one container so mixed prose + table selections
    // walk as a single document order. cloneContents keeps real element structure
    // (table/thead/tbody/tr/td) that innerText would otherwise flatten away.
    var container = document.createElement("div");
    for (var r = 0; r < sel.rangeCount; r++) {
      try { container.appendChild(sel.getRangeAt(r).cloneContents()); } catch (e) {}
    }

    // Non-content controls claude.ai renders inside a message (copy/retry/thumbs buttons,
    // their icon-font glyphs, svgs) — skip so only real text is walked. Same guard family
    // as FloatingChatBridgeScript.isSkippable.
    function isSkippable(el) {
      var tag = el.tagName.toLowerCase();
      if (tag === "svg" || tag === "button" || tag === "style" || tag === "script") return true;
      if (el.getAttribute("aria-hidden") === "true") return true;
      var role = el.getAttribute("role");
      if (role === "button" || role === "menu" || role === "menuitem" || role === "toolbar") return true;
      return false;
    }

    function inline(node) {
      var out = "";
      node.childNodes.forEach(function (c) {
        if (c.nodeType === 3) { out += c.textContent; return; }
        if (c.nodeType !== 1) return;
        if (isSkippable(c)) return;
        var tag = c.tagName.toLowerCase();
        if (tag === "code") { out += "`" + (c.textContent || "") + "`"; }
        else if (tag === "strong" || tag === "b") { out += "**" + inline(c) + "**"; }
        else if (tag === "em" || tag === "i") { out += "*" + inline(c) + "*"; }
        else if (tag === "a") {
          var href = c.getAttribute("href") || "";
          var txt = inline(c);
          out += href ? ("[" + txt + "](" + href + ")") : txt;
        }
        else if (tag === "br") { out += "\n"; }
        else { out += inline(c); }
      });
      return out;
    }

    // A single table cell's markdown: inline content, pipes escaped, newlines collapsed to
    // spaces (a markdown table cell is one line by grammar) and whitespace tidied.
    function cellMd(td) {
      return inline(td).replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
    }

    // Emit a REAL markdown table: header row, --- separator, body rows. First row is the
    // header (thead's row if present, else the first tr). Ragged rows are padded to the
    // widest row so the pipe columns stay aligned and parseable.
    function tableToMd(tableEl, lines) {
      var rows = [];
      tableEl.querySelectorAll("tr").forEach(function (tr) {
        var cells = [];
        tr.querySelectorAll("th,td").forEach(function (td) { cells.push(cellMd(td)); });
        if (cells.length) rows.push(cells);
      });
      if (!rows.length) return;
      var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      function line(cells) {
        var padded = cells.slice();
        while (padded.length < cols) padded.push("");
        return "| " + padded.join(" | ") + " |";
      }
      lines.push(line(rows[0]));
      var sep = [];
      for (var i = 0; i < cols; i++) sep.push("---");
      lines.push("| " + sep.join(" | ") + " |");
      for (var j = 1; j < rows.length; j++) lines.push(line(rows[j]));
      lines.push("");
    }

    function blockToMd(el, lines) {
      // Snapshot: the bare-<tr> branch below reparents nodes OUT of el, and iterating a
      // live NodeList while mutating it would skip siblings.
      Array.prototype.slice.call(el.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var t = (c.textContent || "").trim();
          if (t) { lines.push(t); lines.push(""); }
          return;
        }
        if (c.nodeType !== 1) return;
        if (isSkippable(c)) return;
        var tag = c.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          var level = parseInt(tag.charAt(1), 10);
          lines.push(new Array(level + 1).join("#") + " " + inline(c)); lines.push("");
        } else if (tag === "p") {
          lines.push(inline(c)); lines.push("");
        } else if (tag === "ul") {
          c.querySelectorAll(":scope > li").forEach(function (li) { lines.push("- " + inline(li)); });
          lines.push("");
        } else if (tag === "ol") {
          var n = 1;
          c.querySelectorAll(":scope > li").forEach(function (li) { lines.push((n++) + ". " + inline(li)); });
          lines.push("");
        } else if (tag === "pre") {
          var codeEl = c.querySelector("code");
          var code = (codeEl ? codeEl.innerText : c.innerText) || "";
          lines.push("```"); lines.push(code.replace(/\n$/, "")); lines.push("```"); lines.push("");
        } else if (tag === "blockquote") {
          inline(c).split("\n").forEach(function (l) { lines.push("> " + l); });
          lines.push("");
        } else if (tag === "hr") {
          lines.push("---"); lines.push("");
        } else if (tag === "table") {
          tableToMd(c, lines);
        } else if (tag === "tr") {
          // A partial selection can clone bare rows without their <table> wrapper.
          // Reparent this run of sibling rows into a synthetic table so they still
          // render as a real markdown table rather than word-soup.
          var synth = document.createElement("table");
          var cur = c;
          while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() === "tr") {
            var next = cur.nextSibling;
            synth.appendChild(cur);
            cur = next;
            while (cur && cur.nodeType === 3 && !(cur.textContent || "").trim()) cur = cur.nextSibling;
          }
          tableToMd(synth, lines);
        } else {
          // Unknown wrapper (claude wraps content in many divs) — recurse.
          blockToMd(c, lines);
        }
      });
    }

    var lines = [];
    blockToMd(container, lines);
    var md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    // If structural walking produced nothing usable (e.g. selection inside a single text
    // node), fall back to the plain selection text rather than returning empty.
    if (!md) md = plain.trim();
    return md;
  } catch (ex) {
    try { var s = window.getSelection(); return s ? (s.toString() || "") : ""; } catch (e) { return ""; }
  }
})();
""";
    }
}

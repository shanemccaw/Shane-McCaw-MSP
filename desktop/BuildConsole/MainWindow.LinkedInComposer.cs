using System;
using System.Windows.Controls;

namespace BuildConsole
{
    /// <summary>
    /// Git #973 — LinkedIn post pre-fill via WebView2. Partial of MainWindow (kept
    /// in its own file, like MainWindow.SettingsTab.cs / MainWindow.GitDetailTabs.cs,
    /// so this feature adds almost nothing to the hot MainWindow.xaml.cs — only the
    /// single ActivityBar wiring line lives there).
    ///
    /// Flow: the #937-shaped LinkedInComposerWindow floaty raises SendRequested with
    /// the post text; we open/focus a LinkedIn WebView2 tab and inject the text into
    /// its real compose box via the #871 native-value-setter (input/textarea) + #922
    /// contenteditable execCommand technique. We NEVER click Schedule/Post — Shane
    /// completes that himself in LinkedIn's own UI. If the configured selector
    /// (BuildConsoleSettings.LinkedInComposerSelector) matches no element, we show a
    /// clear inline "recalibrate the selector" message rather than failing silently.
    /// </summary>
    public partial class MainWindow
    {
        private LinkedInComposerWindow? _linkedInComposer;

        /// <summary>Git #973 — opens the always-on-top LinkedIn composer floaty, or closes it if already open.</summary>
        private void ToggleLinkedInComposer()
        {
            if (_linkedInComposer != null)
            {
                _linkedInComposer.Close(); // Closed handler nulls the ref and logs "close"
                return;
            }

            _linkedInComposer = new LinkedInComposerWindow { Owner = this };
            _linkedInComposer.SendRequested += LinkedInComposer_SendRequested;
            _linkedInComposer.Closed += (s, e) =>
            {
                _linkedInComposer = null;
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", "composer close");
            };
            _linkedInComposer.Show();
            BuildConsole.Services.ActivityLog.Log("linkedin.prefill", "composer open");
        }

        /// <summary>Git #973 — Send clicked in the LinkedIn composer floaty. Opens/focuses a LinkedIn tab and injects the post text; reports every outcome inline on the floaty.</summary>
        private async void LinkedInComposer_SendRequested(object? sender, string text)
        {
            var win = _linkedInComposer;
            if (win == null) return;
            await SendTextToLinkedInComposerAsync(text, (msg, isError) => win.ShowInlineMessage(msg, isError));
        }

        /// <summary>
        /// Git #973 — the LinkedIn tab (and its owning pane) across all four #893
        /// panes whose WebView2 is currently on a linkedin.com URL. Matched by the
        /// live Source, not the tab's original Tag URL, because Shane navigates
        /// within LinkedIn (feed, "Start a post", etc.) after the tab first opens.
        /// </summary>
        private (Microsoft.Web.WebView2.Wpf.WebView2? Wv, TabControl? Pane, TabItem? Tab) FindLinkedInTabWebView()
        {
            var panes = new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 };
            foreach (var pane in panes)
            {
                if (pane == null) continue;
                foreach (var obj in pane.Items)
                {
                    if (obj is not TabItem ti) continue;
                    var wv = WebViewOf(ti);
                    if (wv?.CoreWebView2 == null) continue;
                    string url = "";
                    try { url = wv.Source?.ToString() ?? ""; } catch { }
                    if (url.Contains("linkedin.com", StringComparison.OrdinalIgnoreCase))
                        return (wv, pane, ti);
                }
            }
            return (null, null, null);
        }

        /// <summary>
        /// Git #973 — shared: find the open LinkedIn tab, confirm its compose box
        /// exists via the configured selector, and inject <paramref name="text"/>
        /// into it (never presses Schedule/Post). If no LinkedIn tab is open yet,
        /// opens one and tells Shane to open "Start a post" then Send again. Every
        /// outcome is reported back through <paramref name="showMessage"/> and logged
        /// on the <c>linkedin.prefill</c> channel.
        /// </summary>
        public async System.Threading.Tasks.Task SendTextToLinkedInComposerAsync(
            string text,
            Action<string, bool> showMessage)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            string selector = (settings.LinkedInComposerSelector ?? "").Trim();
            if (string.IsNullOrWhiteSpace(selector))
            {
                showMessage("No LinkedIn composer selector configured — set one in Settings > LinkedIn.", true);
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", "send-failed: no selector configured");
                return;
            }

            var (wv, pane, tab) = FindLinkedInTabWebView();
            if (wv?.CoreWebView2 == null)
            {
                // No LinkedIn tab open — open one, but don't try to inject yet:
                // the compose box only exists once Shane opens "Start a post".
                string url = string.IsNullOrWhiteSpace(settings.LinkedInComposeUrl)
                    ? "https://www.linkedin.com/feed/"
                    : settings.LinkedInComposeUrl.Trim();
                OpenWebTab(url, "LinkedIn", "");
                showMessage("Opened LinkedIn — sign in, click “Start a post” to open the composer, then press Send to LinkedIn again.", false);
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", $"opened LinkedIn tab (no tab was open) -> {url}");
                return;
            }

            // Bring the LinkedIn tab to the front so Shane sees the result.
            if (pane != null && tab != null)
                pane.SelectedItem = tab;

            string liveUrl = "";
            try { liveUrl = wv.Source?.ToString() ?? ""; } catch { }

            string status;
            try
            {
                string raw = await wv.ExecuteScriptAsync(LinkedInComposerInsertScript(selector, text)) ?? "";
                status = System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "";
            }
            catch (Exception ex)
            {
                status = "error: " + ex.Message;
            }

            if (status == "inserted")
            {
                showMessage("Pre-filled into LinkedIn — review it, then press Schedule or Post yourself in LinkedIn.", false);
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", $"inserted post into LinkedIn composer ({liveUrl})");
            }
            else if (status == "no-element")
            {
                showMessage(
                    $"Couldn't find the LinkedIn compose box with selector “{selector}”. Open “Start a post” first, or recalibrate the selector in Settings > LinkedIn.",
                    true);
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", $"no-element: selector '{selector}' matched nothing ({liveUrl}) — recalibration needed");
            }
            else
            {
                showMessage("Pre-fill failed while inserting into LinkedIn's compose box.", true);
                BuildConsole.Services.ActivityLog.Log("linkedin.prefill", $"send-failed: {status} ({liveUrl})");
            }
        }

        /// <summary>
        /// Git #973 — injects <paramref name="text"/> into the element matched by
        /// <paramref name="selector"/> using BOTH proven techniques from #871/#922:
        /// for an &lt;input&gt;/&lt;textarea&gt; it grabs the native prototype value
        /// setter (Object.getOwnPropertyDescriptor(proto,'value').set) so a
        /// React/controlled input actually updates (#871), and for a contenteditable
        /// (LinkedIn's real composer is a Quill contenteditable div) it uses
        /// execCommand('insertText') with a text-node fallback (#922). Both then
        /// dispatch input/change so the page's own state machine notices. It never
        /// clicks any button — Shane presses Schedule/Post himself. The selector and
        /// text are JSON-encoded into safe JS string literals. Returns
        /// 'inserted' | 'no-element' | 'error: ...'.
        /// </summary>
        private static string LinkedInComposerInsertScript(string selector, string text)
        {
            string jsSelector = System.Text.Json.JsonSerializer.Serialize(selector);
            string jsText = System.Text.Json.JsonSerializer.Serialize(text);
            return $@"
(function () {{
  try {{
    var selector = {jsSelector};
    var text = {jsText};
    var el = document.querySelector(selector);
    if (!el) return 'no-element';
    // A matched-but-hidden element (zero box, e.g. the composer not opened yet)
    // is treated as 'no-element' so Shane gets the recalibrate/open-composer hint
    // rather than a silent no-op.
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return 'no-element';
    el.focus();
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {{
      // #871 — native value setter for React/controlled inputs.
      var proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event('input', {{ bubbles: true }}));
      el.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }} else {{
      // #922 — contenteditable (LinkedIn's Quill composer) insert.
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      var inserted = document.execCommand('insertText', false, text);
      if (!inserted) {{
        range.insertNode(document.createTextNode(text));
      }}
      el.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    }}
    return 'inserted';
  }} catch (ex) {{
    return 'error: ' + ex.message;
  }}
}})();";
        }
    }
}

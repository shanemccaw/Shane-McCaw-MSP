using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1837 — the one builder for the "new project chat" <c>bt_prefill</c> URL, replacing
    /// five independent copies that had drifted apart: MainWindow.xaml.cs's File &gt; New Chat
    /// (<c>MenuNewChat_Click</c>) and Hand Off Now (<c>TriggerHandoffAsync</c>),
    /// MainWindow.GitDetailTabs.cs's <c>OpenOrCreateEpicChat</c>, and LeftSidebar.xaml.cs's
    /// milestone and issue/epic "New Chat" context-menu items. <c>bt_prefill</c> is the exact
    /// param name the browser extension's own content.js recognises (LeftSidebar.xaml.cs:208,
    /// <c>tryInsertPrefillFromUrl</c>) — never rename it; a URL BuildConsole opens has to stay
    /// one the extension would also recognise.
    /// </summary>
    public static class EpicChatUrlBuilder
    {
        public const string PrefillParam = "bt_prefill";

        /// <summary>
        /// Builds the full new-chat URL. This builder only builds the string — validating
        /// <paramref name="baseUrl"/>, the "not configured" / "not a valid URL" toasts, and the
        /// ActivityLog line all stay at each call site, same as before.
        ///
        /// When <paramref name="handoffFromChatUrl"/> is null (the default), behaviour is
        /// byte-identical to the five call sites this replaces: <c>&lt;PAT&gt;\r\n&lt;label&gt;</c>
        /// (or just <c>&lt;label&gt;</c> when no PAT is configured). <paramref name="label"/>
        /// defaults to <c>Epic #{epicNumber}</c> — what File &gt; New Chat, Hand Off Now, and
        /// <c>OpenOrCreateEpicChat</c> all built; pass an explicit <paramref name="label"/> for
        /// the Milestone/Issue menu items, whose label text isn't "Epic" (e.g. "Milestone #12",
        /// "Issue #34").
        ///
        /// When <paramref name="handoffFromChatUrl"/> IS supplied, the prefill becomes the PAT
        /// line (if configured), the label, a "Handoff from: &lt;url&gt;" line, and the fixed
        /// catch-up instruction telling the successor to read the predecessor via its past-chat
        /// tools rather than fetching the (auth-walled) URL — see Git #1837. That wording is
        /// deliberate; do not edit it.
        /// </summary>
        public static string BuildEpicChatUrl(string baseUrl, string pat, int epicNumber, string? handoffFromChatUrl = null, string? label = null)
        {
            pat ??= "";
            label ??= $"Epic #{epicNumber}";

            string prefill;
            if (!string.IsNullOrEmpty(handoffFromChatUrl))
            {
                var lines = new List<string>();
                if (!string.IsNullOrEmpty(pat)) lines.Add(pat);
                lines.Add(label);
                lines.Add($"Handoff from: {handoffFromChatUrl}");
                lines.Add("Read that conversation with your past-chat tools before anything else — pass it the conversation id from that URL. Do not fetch the URL itself; it is auth-walled and the fetch will fail. Catch up on where it left off, then continue.");
                prefill = string.Join("\r\n", lines);
            }
            else
            {
                prefill = string.IsNullOrEmpty(pat) ? label : $"{pat}\r\n{label}";
            }

            var sep = baseUrl.Contains('?') ? "&" : "?";
            return $"{baseUrl}{sep}bt_prefill={Uri.EscapeDataString(prefill)}";
        }
    }
}

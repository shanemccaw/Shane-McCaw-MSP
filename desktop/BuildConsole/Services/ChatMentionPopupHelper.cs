using System;
using System.Text.Json;
using BuildConsole.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2080 — the "resolve a #NNN mention into title/status/epic + a state-aware action
    /// payload, then build the __btShowIssueTip(...) call" sequence is identical for both hosts
    /// of <see cref="IssueMentionInjector"/>: MainWindow's <c>ChatWv_WebMessageReceived</c> (chat
    /// tabs docked in the main window) and FloatingChatWindow's <c>OnBridgeMessage</c> (popped-out
    /// chat windows). This is the one shared implementation both call into, so the two hosts
    /// never drift on what a hover shows.
    /// </summary>
    internal static class ChatMentionPopupHelper
    {
        private static readonly JsonSerializerOptions PayloadJsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        /// <summary>Resolves issue #<paramref name="n"/> (cache first, live GitHub fetch as
        /// fallback — same precedence <see cref="LeftSidebar.BuildDetailIssue"/> callers already
        /// use elsewhere) and the state-aware action payload for it (blocked / build quick-action
        /// / no-tracked-build dispatch — see <see cref="LeftSidebar.BuildChatMentionActionPayload"/>),
        /// then returns the ready-to-execute JS call for <c>window.__btShowIssueTip</c>.</summary>
        public static async System.Threading.Tasks.Task<string> BuildShowTipScriptAsync(int n, LeftSidebar? leftSidebar)
        {
            string tipTitle = "Unknown";
            string tipStatus = "OPEN";
            bool tipEpic = false;

            var cached = leftSidebar?.BuildDetailIssue(n);
            GitIssue issue;
            if (cached != null)
            {
                tipTitle = cached.RawTitle;
                tipStatus = cached.Status;
                tipEpic = cached.IsEpic;
                issue = cached;
            }
            else
            {
                issue = new GitIssue { IssueNumber = n, Title = tipTitle, RawTitle = tipTitle, Status = tipStatus, IsEpic = tipEpic };

                var settings = BuildConsoleSettings.Load();
                if (settings.HasGitHubPat)
                {
                    try
                    {
                        var ghClient = new GitHubApiClient(settings.GitHubPat);
                        var detail = await ghClient.GetIssueAsync(n);
                        if (detail != null)
                        {
                            tipTitle = detail.Title;
                            tipStatus = string.Equals(detail.State, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN";
                            issue.Title = tipTitle;
                            issue.RawTitle = tipTitle;
                            issue.Status = tipStatus;
                        }
                    }
                    catch { /* best-effort; keep defaults */ }
                }
            }

            string actionsJs = "null";
            var payload = leftSidebar?.BuildChatMentionActionPayload(issue);
            if (payload != null)
            {
                actionsJs = JsonSerializer.Serialize(payload, PayloadJsonOptions);
            }

            return "window.__btShowIssueTip && window.__btShowIssueTip(" +
                   $"{n}," +
                   $"{JsonSerializer.Serialize(tipTitle)}," +
                   $"{JsonSerializer.Serialize(tipStatus)}," +
                   $"{(tipEpic ? "true" : "false")}," +
                   $"{actionsJs});";
        }
    }
}

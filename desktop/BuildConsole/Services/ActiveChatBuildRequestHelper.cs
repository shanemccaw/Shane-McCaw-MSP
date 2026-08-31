namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2063 — shared between <see cref="Controls.DispatchPanel"/>'s Dispatch box and the
    /// Git Board hover popover's (#2061) equivalent dead-end: both ask "the currently active
    /// chat" to write and post a `BUILD:` comment on an issue that doesn't have one yet, via
    /// <see cref="MainWindow.SendToActiveChatAsync"/>. This holds the one prompt text and the
    /// one status→human-message mapping so both call sites report the same outcome instead of
    /// drifting into two different wordings for the same real result.
    /// </summary>
    public static class ActiveChatBuildRequestHelper
    {
        /// <summary>The message injected into the active chat's composer.</summary>
        public static string BuildAskMessage(int issueNumber, string issueTitle)
        {
            return $"This is ready to build. Please write and post a `BUILD:` comment on GitHub " +
                   $"issue #{issueNumber} (\"{issueTitle}\") so it can be dispatched — follow this " +
                   $"repo's build-prompt header convention from CLAUDE.md (a `BUILD: model=... " +
                   $"effort=...` line, then a `Posted: <UTC ISO8601>` line, then the `--model ... " +
                   $"--effort ... --title {issueNumber}` flags line, then the real build prompt " +
                   $"body), post it with `gh issue comment {issueNumber} --body \"...\"`, then " +
                   $"confirm here once it's posted.";
        }

        /// <summary>
        /// Maps <see cref="MainWindow.SendToActiveChatAsync"/>'s status vocabulary to a
        /// human message plus whether it should read as an error. 'sent' is the only
        /// non-error outcome — everything else means Shane still has to do something himself.
        /// </summary>
        public static (string Message, bool IsError) DescribeStatus(string status, int issueNumber)
        {
            return status switch
            {
                "sent" => ($"No BUILD: comment yet on #{issueNumber} — asked the active chat to write and post one. Dispatch again once it's posted.", false),
                "inserted-no-send" => ($"No BUILD: comment yet on #{issueNumber} — inserted the request into the active chat but couldn't auto-send it; press Send there yourself.", true),
                "no-composer" => ($"No BUILD: comment yet on #{issueNumber}, and couldn't find a composer in the active chat — is a conversation open there?", true),
                "no-active-tab" or "no-active-chat" => ($"No BUILD: comment yet on #{issueNumber}, and no active chat to ask — open a Claude chat (or the floating chat window) first.", true),
                _ => ($"No BUILD: comment yet on #{issueNumber}, and asking the active chat failed ({status}).", true),
            };
        }
    }
}

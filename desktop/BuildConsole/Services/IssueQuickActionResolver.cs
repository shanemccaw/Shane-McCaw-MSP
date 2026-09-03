using BuildConsole.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2080 — the status→action classification #2061 built inline inside
    /// <see cref="LeftSidebar.BuildQuickActionArea"/> for the Git Board row hover popover
    /// (native WPF), extracted so the chat-mention hover popup (#1253, HTML/JS, a completely
    /// different render target) can offer the exact same action set without a second
    /// implementation of "what does a queued/running/done/failed build offer." Both surfaces
    /// call <see cref="Resolve"/> on the same <see cref="QueueItem"/> and render the result in
    /// their own native format — WPF controls here, HTML buttons over there.
    /// </summary>
    public enum IssueQuickActionKind { Dispatch, Cancel, Retry, OpenBuild, OpenChat }

    public sealed class IssueQuickActionState
    {
        public string StatusText { get; set; } = "";
        public IssueQuickActionKind ActionKind { get; set; }
        public string ActionLabel { get; set; } = "";
        public bool AllowReply { get; set; }
        public int? ProgressPercent { get; set; }
        public string? ProgressLabel { get; set; }
        public bool IsStale { get; set; }
        public string? StalenessText { get; set; }
    }

    public static class IssueQuickActionResolver
    {
        /// <summary>Git #2691 — the real, already-live subset of <see cref="QueueItem.Status"/>
        /// values the mention-color feature cares about: actively executing right now
        /// ("running"/"verifying" — <see cref="BuildQueuePostgresClient.VerifyingStatus"/>) vs
        /// sitting tracked-but-not-dispatched ("queued", i.e. Batter Up). Anything else (done,
        /// failed, parked, capped, external, canceled…) returns null — no live-state color, falls
        /// through to the epic/closed/default coloring. One classification, reused by both
        /// <see cref="ChatMentionPopupHelper.BuildSetMentionColorsScript"/> (eager batch push) and
        /// <see cref="Controls.LeftSidebar.BuildChatMentionActionPayload"/> (hover round-trip), so
        /// the eager span color and the hover-refreshed color never disagree.</summary>
        public static string? ClassifyLiveStatus(QueueItem build) => build.Status switch
        {
            "running" => "running",
            var s when s == BuildQueuePostgresClient.VerifyingStatus => "verifying",
            "queued" => "queued",
            _ => null
        };

        /// <summary>Same six-bucket classification #2061 established: queued -> Dispatch,
        /// running -> Cancel/Stop (+ progress + inline reply, #2036's question-detection still
        /// deferred so a running build always offers reply), done -> Open Build, failed -> Retry,
        /// anything else (parked/external/capped/limit-paused/verifying) -> plain status + Open
        /// Chat fallback. Blocked precedence is handled by the caller before this is reached, same
        /// as <see cref="LeftSidebar.BuildIssueHoverPopupContent"/> already does.</summary>
        public static IssueQuickActionState Resolve(QueueItem build)
        {
            switch (build.Status)
            {
                case "queued":
                    return new IssueQuickActionState
                    {
                        StatusText = "⏳ Queued",
                        ActionKind = IssueQuickActionKind.Dispatch,
                        ActionLabel = "⚡ Dispatch Now"
                    };

                case "running":
                {
                    var state = new IssueQuickActionState
                    {
                        StatusText = "▶ Running…",
                        ActionKind = IssueQuickActionKind.Cancel,
                        ActionLabel = "⏹ Cancel / Stop",
                        AllowReply = true
                    };
                    var progress = BuildProgressTracker.GetProgress(build.Id);
                    if (progress != null && progress.Total > 0)
                    {
                        state.ProgressPercent = (int)progress.Percent;
                        state.ProgressLabel = $"{progress.Step}/{progress.Total} ({progress.Percent:0}%) — " +
                            (string.IsNullOrWhiteSpace(progress.CurrentLabel) ? "Running…" : progress.CurrentLabel);
                        state.IsStale = progress.IsStale;
                        state.StalenessText = progress.StalenessText;
                    }
                    return state;
                }

                case "done":
                    return new IssueQuickActionState
                    {
                        StatusText = "✅ Done",
                        ActionKind = IssueQuickActionKind.OpenBuild,
                        ActionLabel = "📄 Open Build"
                    };

                case "failed":
                    return new IssueQuickActionState
                    {
                        StatusText = "✕ Failed",
                        ActionKind = IssueQuickActionKind.Retry,
                        ActionLabel = "🔄 Retry"
                    };

                default:
                    return new IssueQuickActionState
                    {
                        StatusText = build.Status.ToUpperInvariant(),
                        ActionKind = IssueQuickActionKind.OpenChat,
                        ActionLabel = "💬 Open Chat"
                    };
            }
        }
    }

    /// <summary>Serializable shape of <see cref="LeftSidebar.BuildChatMentionActionPayload"/> —
    /// what the chat-mention popup's JS side (<see cref="IssueMentionInjector"/>'s
    /// <c>__btShowIssueTip</c>) needs to render the same action set as the Git Board popover.
    /// Exactly one of <see cref="Blocked"/> / <see cref="Build"/> / <see cref="NoBuildDispatch"/>
    /// is populated, matching the three branches of <see cref="LeftSidebar.BuildIssueHoverPopupContent"/>.</summary>
    public sealed class ChatMentionActionPayload
    {
        public ChatMentionBlocked? Blocked { get; set; }
        public ChatMentionBuild? Build { get; set; }
        public bool NoBuildDispatch { get; set; }
    }

    public sealed class ChatMentionBlocked
    {
        public int? Number { get; set; }
        public string? Title { get; set; }
    }

    public sealed class ChatMentionBuild
    {
        public int Id { get; set; }
        public string StatusText { get; set; } = "";
        /// <summary>Lowercase <see cref="IssueQuickActionKind"/> name — "dispatch"/"cancel"/"retry"/"openbuild"/"openchat" — the exact string the JS button posts back as BT_ISSUE_ACTION's "action" field.</summary>
        public string ActionKind { get; set; } = "";
        public string ActionLabel { get; set; } = "";
        public bool AllowReply { get; set; }
        public int? ProgressPercent { get; set; }
        public string? ProgressLabel { get; set; }
        public bool Stale { get; set; }
        public string? StaleText { get; set; }
        /// <summary>Git #2691 — "running"/"verifying"/"queued", or null. Same
        /// <see cref="ClassifyLiveStatus"/> classification the eager <c>__btSetMentionColors</c>
        /// batch push uses, carried through the hover round-trip so <c>window.__btShowIssueTip</c>
        /// recolors the span with the identical live-state color, not a second resolution.</summary>
        public string? LiveStatus { get; set; }
    }
}

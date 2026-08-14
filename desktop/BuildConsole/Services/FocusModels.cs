using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    // ---------------------------------------------------------------------
    // Focus Mode — plain data models (no UI types), shared by FocusModeService,
    // the FocusModeBar control and MainWindow's integration partial.
    //
    // Shane's ask (verbatim): a real focus mode that HIDES everything except the
    // one milestone he's working, gives him small on-milestone quick tasks during
    // build downtime, snapshots exactly what he was doing and snaps him back when
    // the build finishes — with a tasteful game layer on the REAL milestone numbers.
    // These types are the currency all of that passes around.
    // ---------------------------------------------------------------------

    /// <summary>A real GitHub milestone as the focus picker / game layer sees it.
    /// Number/Title come straight from GitHub's milestone object; Open/Closed are
    /// GitHub's own <c>open_issues</c>/<c>closed_issues</c> counts (never derived
    /// from the OPEN-only board fetch — that was the #875 bug), so the progress
    /// bar is honest.</summary>
    public class FocusMilestone
    {
        public int? Number { get; set; }
        public string Title { get; set; } = "";
        public int OpenIssues { get; set; }
        public int ClosedIssues { get; set; }
        public int TotalIssues => OpenIssues + ClosedIssues;
        public int ProgressPercent => TotalIssues == 0 ? 0 : (ClosedIssues * 100 / TotalIssues);
    }

    /// <summary>One bounded, low-commitment thing to do during downtime — always
    /// scoped to the ACTIVE milestone (never an off-milestone side quest, by
    /// design). Backed by a real open issue.</summary>
    public class FocusSuggestion
    {
        public int IssueNumber { get; set; }
        public string Title { get; set; } = "";
        /// <summary>"Waiting on you" (Shane To-Do) or "Quick task" (small non-epic issue).</summary>
        public string Kind { get; set; } = "";
        /// <summary>The build --effort (low/medium/high) size proxy, only when a queued
        /// build for this issue carries one — issues themselves have no effort label.</summary>
        public string? Effort { get; set; }
        public string Emoji { get; set; } = "•";
        public string NumberStr => $"#{IssueNumber}";
    }

    /// <summary>A snapshot of real build-slot saturation, the ONLY thing downtime detection
    /// keys off (there is no idle timer — Shane never lets builds sit, so "idle" was the wrong
    /// signal). Downtime is genuine saturation: every one of the <see cref="SlotCount"/> Build
    /// Watch slots is occupied by a running build AND at least one more item is still
    /// <c>queued</c> behind them — the precise moment Shane has zero builds he can start and
    /// wanders off into a side quest. All three counts come from the shared server queue
    /// snapshot (<c>BuildQueuePanel.CurrentQueueItems</c>), so foreign / standalone-watcher
    /// builds count too. A default value (<see cref="SlotCount"/> == 0) reads as "not saturated".</summary>
    public struct FocusBuildSaturation
    {
        /// <summary>Items with server status <c>running</c> — i.e. occupied Build Watch slots.</summary>
        public int RunningCount { get; set; }
        /// <summary>Items with server status <c>queued</c> — the backlog waiting behind the running ones (blocked or not; either way Shane can't start them and there's no free slot).</summary>
        public int QueuedCount { get; set; }
        /// <summary>The number of concurrent build slots (Build Watch's 8). Saturation needs RunningCount ≥ this.</summary>
        public int SlotCount { get; set; }
        /// <summary>All slots occupied AND real backlog behind them — the genuine downtime trigger.</summary>
        public readonly bool IsSaturated => SlotCount > 0 && RunningCount >= SlotCount && QueuedCount > 0;
    }

    /// <summary>A tasteful, earned badge for a REAL event under the active milestone
    /// (an issue closed, an epic issue cleared, the To-Do pile hit zero, the milestone
    /// completed). In the same spirit as Build Watch's "Reticulating Splines" — a wink,
    /// not a slot machine.</summary>
    public class FocusAchievement
    {
        public string Id { get; set; } = "";
        public string Emoji { get; set; } = "🏆";
        public string Title { get; set; } = "";
        public string Detail { get; set; } = "";
        public DateTime UnlockedAt { get; set; }
    }

    /// <summary>Honest progress + estimated-time-to-completion for the active milestone.
    /// The ETA is fit with the SAME least-squares growth-rate math as the Claude
    /// usage-meter's "time until 100%" (see <see cref="UsageProjection"/>), over real
    /// closed-count samples — withheld entirely until there's enough signal to trust.</summary>
    public class FocusProgress
    {
        public int? MilestoneNumber { get; set; }
        public string MilestoneTitle { get; set; } = "";
        public int Closed { get; set; }
        public int Total { get; set; }
        public int Percent => Total == 0 ? 0 : (Closed * 100 / Total);
        public int Points { get; set; }
        /// <summary>True only when the projection cleared its confidence gates.</summary>
        public bool HasEta { get; set; }
        public TimeSpan? Eta { get; set; }
        /// <summary>Fitted pace, issues closed per day (for the honest "at this rate" line).</summary>
        public double IssuesPerDay { get; set; }
        /// <summary>Why no ETA yet, for the diagnostic log / bar tooltip.</summary>
        public string EtaReason { get; set; } = "";
    }

    // ----- persisted snapshot POCOs (focus-mode.json) --------------------

    /// <summary>One captured open chat tab — the serializable slice of MainWindow's
    /// live tab state needed to reopen it exactly where it was. Mirrors
    /// <see cref="PersistedChatTab"/> but is owned by Focus Mode so context capture
    /// is independent of the #874 "Where You Left Off" persistence.</summary>
    public class FocusContextTab
    {
        public string ConversationId { get; set; } = "";
        public string Title { get; set; } = "";
        public string ClaudeUrl { get; set; } = "";
        public int? EpicId { get; set; }
        public int? IssueGithubNumber { get; set; }
        public int PaneIndex { get; set; }
    }

    /// <summary>Exactly what Shane was doing when downtime began — restored verbatim
    /// when the build that caused the downtime finishes (or he finishes a quick task).</summary>
    public class FocusContextSnapshot
    {
        public List<FocusContextTab> Tabs { get; set; } = new();
        public int ActivePaneIndex { get; set; }
        /// <summary>The pane layout mode string ("SplitH"/"SplitV"/"Grid4"/single) so the
        /// arrangement — not just the tabs — comes back.</summary>
        public string LayoutMode { get; set; } = "";
        /// <summary>ConversationId of the tab that had focus (null if the focused tab
        /// wasn't a chat, e.g. Home).</summary>
        public string? ActiveTabConversationId { get; set; }
        public bool ActiveTabWasHome { get; set; }
        public DateTime SavedAt { get; set; }
        public bool IsEmpty => Tabs.Count == 0 && !ActiveTabWasHome;
    }

    /// <summary>One (time, closed-count) reading for a milestone — the series the ETA
    /// is fit over. Persisted so pace/ETA survive a restart.</summary>
    public class FocusClosedSample
    {
        public int MilestoneNumber { get; set; }
        public DateTime At { get; set; }
        public int Closed { get; set; }
        public int Total { get; set; }
    }

    /// <summary>The whole persisted Focus Mode state (focus-mode.json). Additive,
    /// field-initialized defaults so an older/absent file round-trips cleanly.</summary>
    public class FocusPersistState
    {
        public int? ActiveMilestoneNumber { get; set; }
        public string ActiveMilestoneTitle { get; set; } = "";
        public bool IsActive { get; set; }
        public int Points { get; set; }
        public List<FocusAchievement> Achievements { get; set; } = new();
        public List<FocusClosedSample> ClosedSamples { get; set; } = new();
        public FocusContextSnapshot? LastContext { get; set; }
        /// <summary>milestoneNumber -> last-seen closed count, so a close that happens while
        /// the app was shut still isn't mis-counted as "just closed" on next launch.</summary>
        public Dictionary<int, int> ClosedBaseline { get; set; } = new();
        /// <summary>milestoneNumber -> last-seen open Shane-To-Do count, to fire the
        /// "inbox zero" achievement only on a real &gt;0 -&gt; 0 transition.</summary>
        public Dictionary<int, int> TodoBaseline { get; set; } = new();
    }
}

using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    // ---------------------------------------------------------------------
    // Focus Mode — plain data models (no UI types), shared by FocusModeService,
    // the FocusModeBar control and MainWindow's integration partial.
    //
    // Shane's ask (verbatim): a real focus mode that HIDES everything except the
    // one milestone he's working, with a tasteful game layer on the REAL milestone
    // numbers. (#1874 — the downtime quick-task band and its context capture/
    // auto-restore were removed; the FocusSuggestion list survives only as the
    // immersive empty state's own data source.)
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
        /// <summary>True only when Open/Closed came from the real, placeholder-filtered
        /// ALL-states computation (<c>GitBoardIssueFilters.ComputeRealMilestoneCounts</c>).
        /// False on a cold board, where these counts are GitHub's raw native
        /// <c>open_issues</c>/<c>closed_issues</c> fallback — which "may include Epic/Feature/
        /// internal-tooling placeholders" and can show a briefly wrong number (Git #3591).
        /// <see cref="FocusModeBar"/> uses this to show an honest loading state instead of
        /// rendering the fallback number.</summary>
        public bool HasRealCounts { get; set; }
        /// <summary>Git #3757 — GitHub's real milestone state (closed vs. open), carried through
        /// from <see cref="GitHubApiClient.GitHubMilestoneInfo.IsClosed"/> so the Focus picker can
        /// exclude already-closed milestones even when they read 100% complete — completion percent
        /// and closed state are separate facts.</summary>
        public bool IsClosed { get; set; }
    }

    /// <summary>One bounded, low-commitment thing to do — always scoped to the ACTIVE
    /// milestone (never an off-milestone side quest, by design). Backed by a real open
    /// issue. (#1874 removed the downtime band this originally fed; #3568 removed the
    /// Immersive view that later consumed it — currently unused, kept as-is per #3568's
    /// own explicit scope, which left every FocusModeService member other than the
    /// Immersive-only ones untouched.)</summary>
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
        /// <summary>Mirrors <see cref="FocusMilestone.HasRealCounts"/> for the active milestone —
        /// false on a cold board (no ALL-states fetch has landed yet this session), so
        /// <see cref="FocusModeBar"/> can show an honest loading state instead of the
        /// potentially-wrong native-counter fallback (Git #3591).</summary>
        public bool HasRealCounts { get; set; }
        /// <summary>Git #3869 — true when these counts are the stricter "production scope"
        /// (<see cref="GitBoardIssueFilters.ComputeProductionScopedMilestoneCounts"/>) rather than
        /// the default real-work count. Mirrors <see cref="FocusModeService.ProductionScopeOnly"/>
        /// at the moment this progress was built, so the bar can label the tile honestly.</summary>
        public bool IsProductionScope { get; set; }
    }

    // ----- persisted snapshot POCOs (focus-mode.json) --------------------
    //
    // (#1874 — FocusContextTab / FocusContextSnapshot, the serializable open-tab snapshot
    // used by the downtime context-capture/auto-restore machinery, were removed along with
    // it, along with FocusPersistState.LastContext. Any snapshot a prior session already
    // wrote to focus-mode.json is left alone on disk — just no longer modeled or read.)

    // Git #3915 — FocusClosedSample / FocusPersistState.ClosedSamples (a local,
    // only-while-BuildConsole-was-open snapshot log the Focus bar ETA used to fit its
    // pace against) were retired. Audited: RecordClosedSample/ClosedSamples had exactly
    // one reader (FocusModeService.BuildProgress) and one writer (RecordClosedSample) —
    // both in FocusModeService.cs, no other real consumer anywhere in the app. The Focus
    // bar ETA now sources its window from the same real, calendar-based
    // GitHubIssueTimeSeriesService.BuildSeries data HomeEtaProjectionService already used,
    // so it no longer needs a locally-accumulated log at all. A pre-existing
    // focus-mode.json with a "ClosedSamples" array round-trips fine — System.Text.Json
    // silently ignores the now-unmodeled property.

    public class PersistedInProgressChat
    {
        public string ConversationId { get; set; } = "";
        public string Title { get; set; } = "";
        public string ClaudeUrl { get; set; } = "";
        public DateTime MarkedAtUtc { get; set; } = DateTime.UtcNow;
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
        /// <summary>milestoneNumber -> last-seen closed count, so a close that happens while
        /// the app was shut still isn't mis-counted as "just closed" on next launch.</summary>
        public Dictionary<int, int> ClosedBaseline { get; set; } = new();
        /// <summary>milestoneNumber -> last-seen open Shane-To-Do count, to fire the
        /// "inbox zero" achievement only on a real &gt;0 -&gt; 0 transition.</summary>
        public Dictionary<int, int> TodoBaseline { get; set; } = new();
        /// <summary>Chats marked as In Progress (e.g. LinkedIn posts, ad-hoc tasks, side chats)
        /// that remain quickly accessible while in Focus mode.</summary>
        public List<PersistedInProgressChat> InProgressChats { get; set; } = new();
        /// <summary>Git #3869 — whether the Focus bar's milestone tile is scoped to only the epics
        /// that actually ship (<see cref="GitBoardIssueFilters.ComputeProductionScopedMilestoneCounts"/>),
        /// excluding BuildConsole/#1202, MyArchitect/#3454, and disconnected legacy epics. Persisted
        /// so Shane's choice survives a restart. Defaults false (the existing real-work count).</summary>
        public bool ProductionScopeOnly { get; set; }
    }
}

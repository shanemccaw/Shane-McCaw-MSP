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
    }

    /// <summary>One bounded, low-commitment thing to do — always scoped to the ACTIVE
    /// milestone (never an off-milestone side quest, by design). Backed by a real open
    /// issue. Surfaced only by <c>FocusImmersiveView</c>'s empty state (#1874 removed the
    /// downtime band this originally fed).</summary>
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
    }

    // ----- persisted snapshot POCOs (focus-mode.json) --------------------
    //
    // (#1874 — FocusContextTab / FocusContextSnapshot, the serializable open-tab snapshot
    // used by the downtime context-capture/auto-restore machinery, were removed along with
    // it, along with FocusPersistState.LastContext. Any snapshot a prior session already
    // wrote to focus-mode.json is left alone on disk — just no longer modeled or read.)

    /// <summary>One (time, closed-count) reading for a milestone — the series the ETA
    /// is fit over. Persisted so pace/ETA survive a restart.</summary>
    public class FocusClosedSample
    {
        public int MilestoneNumber { get; set; }
        public DateTime At { get; set; }
        public int Closed { get; set; }
        public int Total { get; set; }
    }

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
        /// <summary>Whether the dedicated full-screen immersive Focus view was engaged when the app last
        /// closed — restored on next launch (only if <see cref="IsActive"/>) so a focus session resumes
        /// exactly where it was left, matching Shane's "get me back right where I was" ask.</summary>
        public bool ImmersiveActive { get; set; }
        public int Points { get; set; }
        public List<FocusAchievement> Achievements { get; set; } = new();
        public List<FocusClosedSample> ClosedSamples { get; set; } = new();
        /// <summary>milestoneNumber -> last-seen closed count, so a close that happens while
        /// the app was shut still isn't mis-counted as "just closed" on next launch.</summary>
        public Dictionary<int, int> ClosedBaseline { get; set; } = new();
        /// <summary>milestoneNumber -> last-seen open Shane-To-Do count, to fire the
        /// "inbox zero" achievement only on a real &gt;0 -&gt; 0 transition.</summary>
        public Dictionary<int, int> TodoBaseline { get; set; } = new();
        /// <summary>Chats marked as In Progress (e.g. LinkedIn posts, ad-hoc tasks, side chats)
        /// that remain quickly accessible in Focus and Focus Immersive modes.</summary>
        public List<PersistedInProgressChat> InProgressChats { get; set; } = new();
    }
}

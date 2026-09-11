using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3700 (sub-issue of Feature #1788) — one real issue currently sitting in the
    /// project board's "Ask Shane" status: it genuinely needs Shane's own decision, per the
    /// confirmed real gap on #3577 ("this same circle happens" — Shane's own words). No
    /// board-mutation fields here (unlike <see cref="AiBatterUpRow"/>'s Yes/No shape) because
    /// there is no decision for BuildConsole to make on Shane's behalf — the only real
    /// resolution is Shane answering the actual question on the issue and moving it off this
    /// status himself.
    /// </summary>
    public class AskShaneItem
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        public string RepoOwner { get; init; } = RepoIdentity.DefaultOwner;
        public string RepoName { get; init; } = RepoIdentity.DefaultName;
    }

    /// <summary>
    /// Git #3700 — the real, live "needs Shane's decision" read, applying the same
    /// Git #3134 mirror-first pattern <see cref="AiBatterUpQueueService"/> already
    /// established: a local <see cref="GitHubIssueMirror"/> read when it's usable (zero live
    /// GitHub cost), falling back to a live project-page walk
    /// (<see cref="GitHubApiClient.GetAskShaneIssuesAsync"/>) only when the mirror hasn't
    /// synced yet. No closed-sweep here — unlike AI Batter Up's review queue, an issue
    /// genuinely resolved out of "Ask Shane" moves by Shane's own hand (or a session picking
    /// it back up), not by a real bookend/DONE signal this service could auto-detect.
    /// </summary>
    public static class AskShaneMonitorService
    {
        /// <summary>The real, open "Ask Shane" items right now — mirror-first, live-walk fallback.</summary>
        public static async Task<List<AskShaneItem>> GetOpenItemsAsync(GitHubApiClient gh)
        {
            var mirror = await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.AskShaneOptionId, "open");
            if (mirror != null)
            {
                ActivityLog.Log("ask-shane", $"Ask Shane board read from local mirror (Git #3134 pattern) — {mirror.Count} open item(s).");
                var settings = BuildConsoleSettings.Load();
                return mirror.Select(m => new AskShaneItem
                {
                    Number = m.Number,
                    Title = m.Title,
                    HtmlUrl = m.HtmlUrl,
                    RepoOwner = settings.GitHubOwner,
                    RepoName = settings.GitHubRepoName,
                }).ToList();
            }

            ActivityLog.Log("ask-shane", "Ask Shane board — mirror not usable yet; falling back to a live project-page walk this pass.");
            var live = await gh.GetAskShaneIssuesAsync();
            return live.Select(i => new AskShaneItem
            {
                Number = i.Number,
                Title = i.Title,
                HtmlUrl = i.HtmlUrl,
                RepoOwner = i.RepoOwner,
                RepoName = i.RepoName,
            }).ToList();
        }
    }
}

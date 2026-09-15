using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #4202 — one row under "Waiting On You"'s "Needs your action" section: a real,
    /// open issue carrying the <c>Shane To-Do</c> label repo-wide.</summary>
    public class ShaneToDoItem
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        public string RepoOwner { get; init; } = RepoIdentity.DefaultOwner;
        public string RepoName { get; init; } = RepoIdentity.DefaultName;
        /// <summary>The issue's own first real body line — "whatever real one-line context is
        /// cheaply available" per #4202, never a fabricated summary. Null when the body is blank
        /// or couldn't be read this pass.</summary>
        public string? Excerpt { get; init; }
    }

    /// <summary>
    /// Git #4202 — Shane: "How do I track this. How do I know what's waiting for me. How do I
    /// know when a contract pack is done so I can do my part." "Maybe it's not a chat thing. It's
    /// a missing view I need." The real, persistent read behind the "Waiting On You" document tab:
    /// every real open issue genuinely blocked on Shane himself, repo-wide (never scoped to one
    /// Epic), split into the two real, different asks CLAUDE.md already tracks separately — a
    /// <c>Shane To-Do</c> labeled issue ("needs your action", do something) and an item sitting in
    /// the real "Ask Shane" board column ("needs your decision", decide something).
    ///
    /// No new query path, per the issue's own audit requirement: the <c>Shane To-Do</c> read
    /// reuses <see cref="GitHubIssueMirror.TryGetBoardIssuesAsync"/> — the same local-mirror-first
    /// mechanism <see cref="AiBatterUpQueueService"/> and <see cref="AskShaneMonitorService"/>
    /// already established for their own board reads (Git #3113/#3134) — falling back to
    /// <see cref="GitHubApiClient.SearchIssuesAsync"/>'s existing label-search support (Git #834)
    /// only when the mirror hasn't synced yet. The "Ask Shane" read is a straight call into
    /// <see cref="AskShaneMonitorService.GetOpenItemsAsync"/> — that service already implements
    /// the exact board-column query this panel needs (Git #3700), so it's reused wholesale rather
    /// than re-derived a third time.
    /// </summary>
    public static class WaitingOnYouService
    {
        private const string ShaneToDoLabel = "Shane To-Do";

        /// <summary>One read pass: every open <c>Shane To-Do</c> issue plus every open "Ask Shane"
        /// board item, repo-wide.</summary>
        public static async Task<(List<ShaneToDoItem> ToDo, List<AskShaneItem> AskShane)> GetWaitingOnYouAsync(GitHubApiClient gh)
        {
            // One mirror read serves both sections: the full repo-wide open-issue list (with real
            // Labels + Body) is a superset of what either section needs, so the Ask Shane items
            // (which carry no body of their own — see AskShaneItem.Excerpt) can borrow their
            // excerpt from here too, at zero extra cost.
            var mirror = await GitHubIssueMirror.TryGetBoardIssuesAsync(openOnly: true);

            var toDo = await GetShaneToDoItemsAsync(gh, mirror);
            var askShane = await GetAskShaneItemsAsync(gh, mirror);
            return (toDo, askShane);
        }

        private static async Task<List<ShaneToDoItem>> GetShaneToDoItemsAsync(GitHubApiClient gh, List<GitBoardIssue>? mirror)
        {
            if (mirror != null)
            {
                ActivityLog.Log("waiting-on-you", $"Shane To-Do read from local mirror (Git #3113 pattern) — scanned {mirror.Count} open issue(s) repo-wide, no live GitHub call.");
                return mirror
                    .Where(HasShaneToDoLabel)
                    .Select(i => new ShaneToDoItem
                    {
                        Number = i.Number,
                        Title = i.Title,
                        HtmlUrl = i.HtmlUrl,
                        Excerpt = FirstRealLine(i.Body),
                    })
                    .ToList();
            }

            ActivityLog.Log("waiting-on-you", "Shane To-Do — mirror not usable yet; falling back to a live label search this pass (Git #834's existing SearchIssuesAsync).");
            var live = await gh.SearchIssuesAsync($"label:\"{ShaneToDoLabel}\" state:open");
            return live
                .Where(i => !i.IsClosed && i.Labels.Any(l => string.Equals(l.Name, ShaneToDoLabel, StringComparison.OrdinalIgnoreCase)))
                .Select(i => new ShaneToDoItem
                {
                    Number = i.Number,
                    Title = i.Title,
                    HtmlUrl = i.HtmlUrl,
                    Excerpt = FirstRealLine(i.Body),
                })
                .ToList();
        }

        private static bool HasShaneToDoLabel(GitBoardIssue i) =>
            i.Labels.Any(l => string.Equals(l.Name, ShaneToDoLabel, StringComparison.OrdinalIgnoreCase));

        private static async Task<List<AskShaneItem>> GetAskShaneItemsAsync(GitHubApiClient gh, List<GitBoardIssue>? mirror)
        {
            var items = await AskShaneMonitorService.GetOpenItemsAsync(gh);
            if (mirror == null) return items;

            var bodyByNumber = mirror.ToDictionary(i => i.Number, i => i.Body);
            return items
                .Select(i => bodyByNumber.TryGetValue(i.Number, out var body)
                    ? new AskShaneItem
                    {
                        Number = i.Number,
                        Title = i.Title,
                        HtmlUrl = i.HtmlUrl,
                        RepoOwner = i.RepoOwner,
                        RepoName = i.RepoName,
                        Excerpt = FirstRealLine(body),
                    }
                    : i)
                .ToList();
        }

        /// <summary>The issue's own first non-blank line, stripped of markdown heading markers and
        /// capped to a reasonable single-line length.</summary>
        private static string? FirstRealLine(string? body)
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            var line = body
                .Replace("\r\n", "\n")
                .Split('\n')
                .Select(l => l.Trim().TrimStart('#').Trim())
                .FirstOrDefault(l => l.Length > 0);
            if (string.IsNullOrEmpty(line)) return null;
            return line.Length > 140 ? line[..140].TrimEnd() + "…" : line;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1709 — one Batter Up board row as the panel renders it: the real project-board
    /// item plus whatever this service could resolve about it (its `BUILD:` comment, its
    /// real GitHub blocked-by dependencies, and whether it's already tracked in the queue).
    /// </summary>
    public class BatterUpRow
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        public string? Model { get; init; }
        public string? Effort { get; init; }
        public string? BuildSet { get; init; }
        /// <summary>False when this Batter Up item has no `BUILD:` comment yet — shown in the table, never auto-queued.</summary>
        public bool HasBuildComment { get; init; }
        /// <summary>Every real GitHub `blocked_by` dependency number declared on this issue (open or closed).</summary>
        public List<int> BlockedByNumbers { get; init; } = new();
        /// <summary>The subset of <see cref="BlockedByNumbers"/> GitHub currently reports still OPEN — what the row's blocked badge shows.</summary>
        public List<int> OpenBlockedByNumbers { get; init; } = new();
        public bool IsBlocked => OpenBlockedByNumbers.Count > 0;
        /// <summary>True when a `bt_build_queue` row already exists for this issue (any status) — this refresh left it alone.</summary>
        public bool AlreadyTracked { get; init; }
        /// <summary>Set true only on the refresh pass that actually inserted a fresh queue row for this item.</summary>
        public bool JustAutoQueued { get; set; }
    }

    /// <summary>
    /// Git #1709 — reads the real "Batter Up" project-board status, parses each item's
    /// `BUILD:` comment, and auto-queues anything not already tracked through the exact
    /// same <see cref="BuildQueuePostgresClient.QueueBuildAsync"/> path Queue / Send to
    /// Builder already use — this is a new SOURCE feeding that one real pipeline, not a
    /// second launch mechanism. Blocked-by numbers are always passed straight through
    /// from GitHub's real dependency data so the existing #1600 fail-closed watcher (see
    /// BuildQueuePostgresClient.GetNextAsync) governs whether a queued item actually
    /// launches, exactly like every other launch path.
    /// </summary>
    public static class BatterUpQueueService
    {
        /// <summary>
        /// Parses a `BUILD:` comment body:
        /// <code>
        /// BUILD: model=claude-sonnet-5 effort=high buildSet=Portal
        /// &lt;the rest of the comment is the self-contained prompt&gt;
        /// </code>
        /// Returns null if <paramref name="commentBody"/> doesn't start with a `BUILD:`
        /// header line, or the header line has no prompt text following it.
        /// </summary>
        public static (string? Model, string? Effort, string? BuildSet, string Prompt)? ParseBuildComment(string commentBody)
        {
            if (string.IsNullOrWhiteSpace(commentBody)) return null;

            var lines = commentBody.Replace("\r\n", "\n").Split('\n');
            int headerIdx = Array.FindIndex(lines, l => l.TrimStart().StartsWith("BUILD:", StringComparison.OrdinalIgnoreCase));
            if (headerIdx < 0) return null;

            var headerLine = lines[headerIdx].TrimStart();
            var afterPrefix = headerLine.Substring(headerLine.IndexOf("BUILD:", StringComparison.OrdinalIgnoreCase) + "BUILD:".Length);

            string? model = null, effort = null, buildSet = null;
            foreach (var token in afterPrefix.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            {
                int eq = token.IndexOf('=');
                if (eq <= 0) continue;
                var key = token.Substring(0, eq).Trim();
                var val = token.Substring(eq + 1).Trim();
                if (val.Length == 0) continue;
                if (string.Equals(key, "model", StringComparison.OrdinalIgnoreCase)) model = val;
                else if (string.Equals(key, "effort", StringComparison.OrdinalIgnoreCase)) effort = val;
                else if (string.Equals(key, "buildSet", StringComparison.OrdinalIgnoreCase)) buildSet = val;
            }

            var prompt = string.Join("\n", lines.Skip(headerIdx + 1)).Trim();
            if (prompt.Length == 0) return null;

            return (model, effort, buildSet, prompt);
        }

        /// <summary>
        /// Real GitHub issue comments, most-recent-first, so an updated `BUILD:` comment
        /// (Shane editing launch params after the fact) wins over an older one.
        /// </summary>
        public static async Task<(string? RawComment, (string? Model, string? Effort, string? BuildSet, string Prompt)? Parsed)>
            FindBuildCommentAsync(GitHubApiClient gh, int issueNumber)
        {
            var comments = await gh.GetIssueCommentsAsync(issueNumber);
            for (int i = comments.Count - 1; i >= 0; i--)
            {
                var parsed = ParseBuildComment(comments[i].Body);
                if (parsed.HasValue) return (comments[i].Body, parsed);
            }
            return (null, null);
        }

        /// <summary>
        /// One full refresh pass: reads the real Batter Up board, resolves each item's
        /// `BUILD:` comment + real blocked-by state, auto-queues anything new through
        /// <paramref name="queueDb"/>.QueueBuildAsync, and returns every row for display —
        /// tracked or not, blocked or not, parsed or not, so the panel can show all of it.
        /// </summary>
        public static async Task<List<BatterUpRow>> RefreshAndAutoQueueAsync(
            GitHubApiClient gh, BuildQueuePostgresClient? queueDb, Action<string> log)
        {
            var boardItems = await gh.GetBatterUpIssuesAsync();
            var rows = new List<BatterUpRow>();

            foreach (var item in boardItems)
            {
                var (rawComment, parsed) = await FindBuildCommentAsync(gh, item.Number);
                var blockers = await gh.GetBlockedByAsync(item.Number);
                var blockedByNumbers = blockers.Select(b => b.Number).ToList();
                var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();

                if (rawComment == null)
                {
                    log($"Batter Up #{item.Number} \"{item.Title}\" — no BUILD: comment yet, listed but not auto-queued.");
                    rows.Add(new BatterUpRow
                    {
                        Number = item.Number,
                        Title = item.Title,
                        HtmlUrl = item.HtmlUrl,
                        HasBuildComment = false,
                        BlockedByNumbers = blockedByNumbers,
                        OpenBlockedByNumbers = openBlockedByNumbers,
                    });
                    continue;
                }

                var (model, effort, buildSet, prompt) = parsed!.Value;
                bool alreadyTracked = false;
                bool justQueued = false;

                if (queueDb != null)
                {
                    var existing = await queueDb.FindDedupCandidateAsync(item.Number, prompt);
                    if (existing != null)
                    {
                        alreadyTracked = true;
                    }
                    else
                    {
                        try
                        {
                            await queueDb.QueueBuildAsync(
                                title: item.Title,
                                prompt: prompt,
                                model: model,
                                effort: effort,
                                cwd: null,
                                githubNumber: item.Number,
                                blockedByNumbers: blockedByNumbers,
                                buildSet: buildSet);
                            justQueued = true;
                            log($"Batter Up #{item.Number} \"{item.Title}\" — auto-queued (model={model ?? "default"}, effort={effort ?? "default"}, buildSet={buildSet ?? "none"}" +
                                (blockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", blockedByNumbers)}" : "") + ").");
                        }
                        catch (Exception ex)
                        {
                            log($"Batter Up #{item.Number} \"{item.Title}\" — auto-queue FAILED: {ex.Message}");
                        }
                    }
                }

                rows.Add(new BatterUpRow
                {
                    Number = item.Number,
                    Title = item.Title,
                    HtmlUrl = item.HtmlUrl,
                    Model = model,
                    Effort = effort,
                    BuildSet = buildSet,
                    HasBuildComment = true,
                    BlockedByNumbers = blockedByNumbers,
                    OpenBlockedByNumbers = openBlockedByNumbers,
                    AlreadyTracked = alreadyTracked,
                    JustAutoQueued = justQueued,
                });
            }

            return rows;
        }
    }
}

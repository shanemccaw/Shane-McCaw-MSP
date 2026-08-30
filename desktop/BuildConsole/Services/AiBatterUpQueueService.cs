using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1710 — one row in the "AI Batter Up" review panel: an agent-filed finding
    /// awaiting Shane's Yes/No, per CLAUDE.md's "Board status" routing rule. May or may
    /// not have a `BUILD:` comment yet (a raw finding usually won't) — shown either way.
    /// </summary>
    public class AiBatterUpRow
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        public string ItemId { get; init; } = "";
        public string? Model { get; init; }
        public string? Effort { get; init; }
        public string? BuildSet { get; init; }
        public bool HasBuildComment { get; init; }
    }

    /// <summary>
    /// Git #1710 — reads the real "AI Batter Up" project-board status (agent findings
    /// review queue, distinct from #1709's plain "Batter Up" launch queue) and exposes
    /// the real Yes/No board-status mutations. This service owns no launch/queue logic
    /// of its own: Yes only promotes the Status field to "Batter Up" via
    /// <see cref="GitHubApiClient.SetProjectItemStatusAsync"/> — #1709's
    /// BatterUpQueueService.RefreshAndAutoQueueAsync is what actually queues it, on its
    /// own next poll. No demotes to "Backlog" the same way. Neither action here ever
    /// calls BuildQueuePostgresClient directly.
    /// </summary>
    public static class AiBatterUpQueueService
    {
        /// <summary>
        /// One read pass: the real AI Batter Up board rows, each with its BUILD: comment parsed
        /// (reusing #1709's parser read-only) if one exists yet.
        /// Git #1808 — checked whether this panel has an equivalent "shown forever after it's
        /// actually queued" case: it doesn't. This service only ever reads items whose real board
        /// Status is "AI Batter Up"; the instant Yes promotes one to "Batter Up"
        /// (<see cref="PromoteToBatterUpAsync"/>), it stops matching that query and drops out of
        /// this panel's own next refresh on its own, before #1709's queue/dedup logic ever runs
        /// against it. No filtering needed here.
        /// </summary>
        public static async Task<List<AiBatterUpRow>> RefreshAsync(GitHubApiClient gh)
        {
            var boardItems = await gh.GetAiBatterUpIssuesAsync();
            var rows = new List<AiBatterUpRow>();

            foreach (var item in boardItems)
            {
                var (_, parsed) = await BatterUpQueueService.FindBuildCommentAsync(gh, item.Number);

                rows.Add(new AiBatterUpRow
                {
                    Number = item.Number,
                    Title = item.Title,
                    HtmlUrl = item.HtmlUrl,
                    ItemId = item.ItemId,
                    Model = parsed?.Model,
                    Effort = parsed?.Effort,
                    BuildSet = parsed?.BuildSet,
                    HasBuildComment = parsed.HasValue,
                });
            }

            return rows;
        }

        /// <summary>Yes — promotes the item's Status to real "Batter Up". Does NOT queue or launch anything; #1709's panel picks it up on its own next refresh.</summary>
        public static Task PromoteToBatterUpAsync(GitHubApiClient gh, string itemId) =>
            gh.SetProjectItemStatusAsync(itemId, GitHubApiClient.BatterUpPromoteOptionId);

        /// <summary>No — demotes the item's Status to "Backlog", same primitive the existing Cancel action already uses elsewhere in this app.</summary>
        public static Task DemoteToBacklogAsync(GitHubApiClient gh, string itemId) =>
            gh.SetProjectItemStatusAsync(itemId, GitHubApiClient.BacklogOptionId);
    }
}

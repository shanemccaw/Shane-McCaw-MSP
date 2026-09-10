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
        public static async Task<(List<AiBatterUpRow> Rows, ClosedSweepResult SweepResult)> RefreshAsync(GitHubApiClient gh)
        {
            // Git #3494 / fix: Under an open circuit, do NOT throw an exception that blanks the UI.
            // Serve board items from the local mirror and cached BUILD: comments.
            if (GitHubRateLimitCircuit.IsOpen)
            {
                ActivityLog.Log("ai-batter-up",
                    $"AI Batter Up refresh: GitHub rate-limit circuit open ({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left); " +
                    "serving board items from local mirror and cached comments (Git #3494).");
            }

            // Git #2557 — auto-sweep: a closed issue sitting in "AI Batter Up" status is
            // structurally invisible to the OPEN-only board read below (GetAiBatterUpIssuesAsync),
            // so nothing ever demotes it on its own. Runs BEFORE the open-only row list is built
            // so a just-closed item can never flash into the visible list on the same refresh
            // it's being swept off of. Git #3448 — its real result is now carried out (not just
            // logged) so the caller can report honest sync status via a toast.
            var sweepResult = await SweepClosedIssuesAsync(gh);

            var boardItems = await GetAiBatterUpBoardItemsAsync(gh);
            var rows = new List<AiBatterUpRow>();

            // Git #3350 — resolve every open item's BUILD: comment in a handful of batched GraphQL
            // reads instead of one live REST call per item (the same de-burst as the Batter Up panel;
            // most AI Batter Up items are raw findings with no BUILD: comment, so this is pure win). A
            // missing entry (circuit open / batch failed) just means "no BUILD: comment resolved this
            // pass", the same HasBuildComment=false outcome a null parse already produced.
            var buildComments = await BatterUpQueueService.ResolveBuildCommentsAsync(
                gh, boardItems.Select(b => b.Number).ToList(),
                s => ActivityLog.Log("ai-batter-up", s));

            foreach (var item in boardItems)
            {
                var parsed = buildComments.TryGetValue(item.Number, out var bc) ? bc.Parsed : null;

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

            return (rows, sweepResult);
        }

        /// <summary>
        /// Git #3134 — the real "AI Batter Up" board rows, mirror-first: reads the local
        /// <see cref="GitHubIssueMirror"/> (whose periodic whole-board sweep already captured every
        /// issue's Status option) instead of firing this panel's own live paginated project-page walk
        /// (<see cref="GitHubApiClient.GetAiBatterUpIssuesAsync"/>). Falls back to that live walk only
        /// when the mirror has no usable data yet (never synced) or errored.
        ///
        /// The mirror does not store each item's ProjectV2Item node id, so a mirror-sourced row carries
        /// an empty <see cref="AiBatterUpRow.ItemId"/>; Yes/No no longer needs it — it addresses the
        /// item by issue NUMBER through <see cref="GitHubApiClient.SetIssueStatusByNumberAsync"/>
        /// (see <see cref="PromoteToBatterUpAsync"/> / <see cref="DemoteToBacklogAsync"/>), resolving
        /// the node id at click-time. A click is a live write anyway, not part of the refresh this
        /// issue is keeping off GitHub.
        /// </summary>
        private static async Task<List<AiBatterUpBoardIssue>> GetAiBatterUpBoardItemsAsync(GitHubApiClient gh)
        {
            var mirror = await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.AiBatterUpOptionId, "open");
            if (mirror != null)
            {
                ActivityLog.Log("ai-batter-up", $"AI Batter Up board read from local mirror (Git #3134) — {mirror.Count} open item(s), no live project-page walk.");
                return mirror.Select(m => new AiBatterUpBoardIssue { Number = m.Number, Title = m.Title, HtmlUrl = m.HtmlUrl, ItemId = "" }).ToList();
            }
            ActivityLog.Log("ai-batter-up", "AI Batter Up board — mirror not usable yet; falling back to a live project-page walk this pass.");
            return await gh.GetAiBatterUpIssuesAsync();
        }

        /// <summary>
        /// Git #3469 — the badge-only path for a mirror sync while the panel's document tab isn't
        /// open: a plain local-mirror read of the open board count, with ZERO live GitHub calls —
        /// no closed-sweep, no batched BUILD-comment resolution, no fallback to a live project-page
        /// walk. Returns null (leave the badge at its last value) when the mirror isn't usable yet;
        /// the next visible-panel refresh (or the next sync once the mirror IS usable) catches up.
        /// </summary>
        public static async Task<int?> GetMirrorOnlyOpenCountAsync() =>
            (await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.AiBatterUpOptionId, "open"))?.Count;

        /// <summary>
        /// Git #2557 — sweeps every real CLOSED issue still sitting in "AI Batter Up" status to
        /// "Done" (<see cref="GitHubApiClient.DoneOptionId"/>). Git #3134 — the closed-issue READ is
        /// mirror-first (<see cref="GitHubIssueMirror.TryGetByBoardStatusAsync"/> with
        /// <c>state="closed"</c>), falling back to the live
        /// <see cref="GitHubApiClient.GetClosedAiBatterUpIssuesAsync"/> project-page walk only when the
        /// mirror isn't usable.
        ///
        /// Git #3347 — the actual MOVE is no longer one resolve+mutation per item (that burst is the
        /// root of the cold-start rate-limit cascade); it delegates to the shared, batched, bounded,
        /// circuit-aware <see cref="BatterUpQueueService.SweepClosedCandidatesToDoneAsync"/> — the
        /// same cross-service reuse this class already uses for <c>FindBuildCommentAsync</c>.
        /// </summary>
        private static async Task<ClosedSweepResult> SweepClosedIssuesAsync(GitHubApiClient gh)
        {
            List<(int Number, string Title)> stale;
            try
            {
                var mirror = await GitHubIssueMirror.TryGetByBoardStatusAsync(GitHubApiClient.AiBatterUpOptionId, "closed");
                if (mirror != null)
                {
                    stale = mirror.Select(m => (m.Number, m.Title)).ToList();
                    if (stale.Count > 0)
                        ActivityLog.Log("ai-batter-up", $"AI Batter Up closed-sweep read from local mirror (Git #3134) — {stale.Count} closed item(s) still in AI Batter Up, no live (closed sweep) walk.");
                }
                else
                {
                    stale = await gh.GetClosedAiBatterUpIssuesAsync();
                }
            }
            catch (System.Exception ex)
            {
                ActivityLog.Log("ai-batter-up", $"Auto-sweep: closed-issue scan failed: {ex.Message}");
                return new ClosedSweepResult { Error = ex.Message };
            }

            return await BatterUpQueueService.SweepClosedCandidatesToDoneAsync(
                gh, GitHubApiClient.AiBatterUpOptionId, stale,
                s => ActivityLog.Log("ai-batter-up", "AI Batter Up " + s));
        }

        /// <summary>Yes — promotes the item's Status to real "Batter Up". Does NOT queue or launch
        /// anything; #1709's panel picks it up on its own next refresh. Git #3134 — addresses the item
        /// by issue NUMBER (<see cref="GitHubApiClient.SetIssueStatusByNumberAsync"/>, which resolves the
        /// ProjectV2Item node id itself) rather than requiring an item id up front, so the panel can
        /// source its rows from the local mirror (which doesn't store the node id) and still promote.</summary>
        public static Task PromoteToBatterUpAsync(GitHubApiClient gh, int issueNumber) =>
            gh.SetIssueStatusByNumberAsync(issueNumber, GitHubApiClient.BatterUpPromoteOptionId);

        /// <summary>No — demotes the item's Status to "Backlog", same primitive the existing Cancel action
        /// already uses elsewhere in this app. Git #3134 — by issue NUMBER, see
        /// <see cref="PromoteToBatterUpAsync"/>.</summary>
        public static Task DemoteToBacklogAsync(GitHubApiClient gh, int issueNumber) =>
            gh.SetIssueStatusByNumberAsync(issueNumber, GitHubApiClient.BacklogOptionId);
    }
}

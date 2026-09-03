using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2195 — one still-open edge in a mentioned issue's dependency chain, at some hop
    /// distance from the root. <see cref="Reverse"/> distinguishes "what blocks this" from
    /// "what this blocks" so the dock can render the two directions separately, same split
    /// #2081 already draws in the Git Board hover popup.
    /// </summary>
    public sealed class ChatDockEdge
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public bool IsClosed { get; init; }
        /// <summary>1 = a direct blocker/blockee of the root item; 2+ = a further hop discovered by
        /// walking that node's own relationships (the #2007→#2002→#2005 chain case from #2035's
        /// 2026-08-31 16:07 comment).</summary>
        public int Depth { get; init; }
        public bool Reverse { get; init; }
    }

    /// <summary>Git #2195 — one mentioned issue that survived the live actionable filter, with its
    /// real current GitHub state and its dependency chain in both directions.</summary>
    public sealed class ChatDockItem
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        /// <summary>True when GitHub was unreachable for THIS number specifically — the item is still
        /// included (fail-closed, never silently dropped) but the dock should say so rather than
        /// implying a clean live check.</summary>
        public bool StateUnknown { get; init; }
        /// <summary>The real board "Status" column name (e.g. "Batter Up", "In Progress"), null if
        /// unavailable (no PAT configured, or the lookup itself failed).</summary>
        public string? BoardStatus { get; init; }
        /// <summary>Git #2686 — the real live build-queue status for this number ("queued", "running",
        /// "verifying", "failed", "parked", etc — raw <c>QueueItem.Status</c>), cross-referenced from
        /// <c>BuildQueuePanel.CurrentQueueItems</c> (the same in-memory, already-current collection
        /// #2548's Chat Document Container context bar already reuses for this exact class of
        /// problem). Distinct from <see cref="BoardStatus"/> on purpose — the board column is a static
        /// project-board label, this is what the build is ACTUALLY doing right now. Null when no live
        /// queue row exists for this number; the panel falls back to <see cref="BoardStatus"/> then.</summary>
        public string? LiveQueueStatus { get; init; }
        public List<ChatDockEdge> BlockedBy { get; init; } = new();
        public List<ChatDockEdge> Blocks { get; init; } = new();
        public bool HasChain => BlockedBy.Count > 0 || Blocks.Count > 0;
    }

    /// <summary>Git #2195 — the whole per-chat dock snapshot: the filtered, chain-mapped mentioned
    /// issues plus that chat's active pinned questions, synthesized into one view per #2035's
    /// 2026-08-31 dock-direction comments.</summary>
    public sealed class ChatDockData
    {
        public List<ChatDockItem> Items { get; init; } = new();
        public List<PinnedQuestion> PinnedQuestions { get; init; } = new();
        /// <summary>False when the live open/closed cross-check itself couldn't reach GitHub this
        /// pass (the gh CLI failed to run/auth) — every mentioned number is then treated as still
        /// actionable/unknown rather than silently dropped (fail-closed, Git #1600's same rule).</summary>
        public bool GitHubReachable { get; init; } = true;
        public string? GitHubError { get; init; }

        public static readonly ChatDockData Empty = new();
    }

    /// <summary>
    /// Git #2195 — the data-merge + live-filter + chain-walk service behind the Floating Chat
    /// Window's side dock. Joins #2066's <c>bt_chat_mentioned_issues</c> with #2104/#2105's active
    /// pinned questions for one chat, cross-checks every mentioned number against real GitHub state,
    /// and drops anything already closed — the filtering step is the actual point of this feature,
    /// not a raw dump of every number the chat has ever spat out (#2035, 2026-08-31 16:05).
    ///
    /// Real audit finding: #2030 (Build Queue click-to-highlight dependency-chain visualization) is
    /// NOT landed — confirmed via BuildQueuePanel.xaml.cs's own doc comment on the #2081 build ("no
    /// #2030 chain-highlight landed to reuse"). What IS landed and reused here verbatim is #2081's
    /// bidirectional single-hop fetch (<see cref="GitHubApiClient.GetBlockedByAsync"/> /
    /// <see cref="GitHubApiClient.GetBlockingAsync"/>), extended into a bounded multi-hop walk so the
    /// dock can show a real chain (#2007→#2002→#2005 kind of case) rather than just direct links —
    /// the smallest real extension of the one mechanism that actually exists, not a second invented
    /// visualization system.
    /// </summary>
    public static class ChatDockService
    {
        /// <summary>Matches #2030's own worked example (a 2-hop chain) with one hop of headroom,
        /// bounded because this is a small per-chat scope, not the whole queue graph.</summary>
        private const int MaxChainDepth = 3;

        /// <summary>
        /// Git #2195 — the "not stale" third of the filter's own definition ("open, not already
        /// resolved elsewhere, not stale"). A real production chat_url was measured with 449 tracked
        /// mentions (`bt_chat_mentioned_issues` has no expiry on an OPEN issue, only on a closed one)
        /// — most of those are a number mentioned once in passing weeks ago, not "actually pending in
        /// this chat right now". Anything not re-mentioned within this window is dropped from the
        /// dock (and from the live GitHub check entirely, so a high-mention chat doesn't burn hundreds
        /// of network calls on numbers nobody's brought up in a month).
        /// </summary>
        private static readonly TimeSpan StalenessWindow = TimeSpan.FromDays(14);

        /// <summary>Hard safety cap on how many non-stale mentions get the full live/chain enrichment
        /// pass, most-recently-mentioned first — a backstop under the staleness window, not the
        /// primary filter, so one unusually chatty recent thread still can't turn a dock refresh into
        /// hundreds of sequential GitHub calls.</summary>
        private const int MaxEnrichedItems = 40;

        public static Task<ChatDockData> BuildAsync(BuildQueuePostgresClient db, string chatUrl, int chatId) =>
            BuildAsync(db, chatUrl, chatId, null);

        /// <param name="liveQueueItems">Git #2686 — <c>BuildQueuePanel.CurrentQueueItems</c> (or an
        /// equivalent already-current snapshot), used to cross-reference each mentioned issue's REAL
        /// live build state. Null (the default, and every pre-#2686 call site) means "no live queue
        /// available this pass" — every item then simply has a null <see cref="ChatDockItem.LiveQueueStatus"/>
        /// and the panel falls back to the plain board-status chip, same as before this change.</param>
        public static async Task<ChatDockData> BuildAsync(
            BuildQueuePostgresClient db,
            string chatUrl,
            int chatId,
            IReadOnlyList<QueueItem>? liveQueueItems)
        {
            if (db == null) return ChatDockData.Empty;

            List<BuildQueuePostgresClient.ChatIssueMention> mentionRows;
            List<PinnedQuestion> pins;
            try
            {
                mentionRows = await db.GetChatIssueMentionsForUrlAsync(chatUrl);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.dock", $"mentions load failed for {chatUrl}: {ex.Message}");
                mentionRows = new List<BuildQueuePostgresClient.ChatIssueMention>();
            }
            try
            {
                pins = chatId > 0 ? await db.GetOpenPinnedQuestionsForChatAsync(chatId) : new List<PinnedQuestion>();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.dock", $"pinned questions load failed for chat {chatId}: {ex.Message}");
                pins = new List<PinnedQuestion>();
            }

            var cutoff = DateTimeOffset.UtcNow - StalenessWindow;
            var mentioned = mentionRows
                .Where(m => m.LastSeenAt >= cutoff)
                .Take(MaxEnrichedItems)
                .Select(m => m.Number)
                .ToList();

            if (mentioned.Count == 0)
                return new ChatDockData { Items = new List<ChatDockItem>(), PinnedQuestions = pins };

            // Step 2 — live open/closed cross-check, batched in one gh CLI call (Git #1600's
            // fail-closed shape: Success=false means GitHub was unreachable, never "nothing open").
            var openResult = await GitHubIssuesService.TryGetOpenIssueNumbersAsync();
            bool reachedGitHub = openResult.Success;

            var settings = BuildConsoleSettings.Load();
            GitHubApiClient? gh = settings.HasGitHubPat ? new GitHubApiClient(settings.GitHubPat) : null;

            // Git #2686 — was a sequential `foreach` doing 3-4 real awaited GitHub calls PER mentioned
            // issue (title, board-status, two chain walks), each item fully blocking the next — O(N ×
            // chain-depth) sequential round trips. Fan every item's own fetch out concurrently instead;
            // each still fails closed on its own (a single item's fetch failure never aborts the batch,
            // it just lands with less metadata — same behavior as before, just not serialized).
            var itemTasks = mentioned
                .Select(number => BuildItemAsync(number, reachedGitHub, openResult, gh, liveQueueItems))
                .ToList();
            var built = await Task.WhenAll(itemTasks);
            var items = built.Where(i => i != null).Select(i => i!).ToList();

            return new ChatDockData
            {
                Items = items,
                PinnedQuestions = pins,
                GitHubReachable = reachedGitHub,
                GitHubError = openResult.Error,
            };
        }

        /// <summary>Git #2686 — one mentioned issue's full fetch (title, board-status, both chain
        /// walks, live-queue cross-reference), extracted so <see cref="BuildAsync"/> can run every
        /// mentioned number's fetch concurrently via <c>Task.WhenAll</c> instead of a blocking
        /// sequential loop. Returns null only for a confirmed-closed issue (dropped from the dock);
        /// every other outcome — including every kind of per-field fetch failure — still returns a
        /// real item, same fail-closed shape the original sequential loop had.</summary>
        private static async Task<ChatDockItem?> BuildItemAsync(
            int number,
            bool reachedGitHub,
            LiveOpenIssuesResult openResult,
            GitHubApiClient? gh,
            IReadOnlyList<QueueItem>? liveQueueItems)
        {
            bool? isOpen = reachedGitHub ? openResult.OpenNumbers.Contains(number) : (bool?)null;
            // Fail-closed: unknown (GitHub unreachable) is treated as still-relevant, same as a
            // confirmed-open issue. Only a CONFIRMED closed state drops it from the dock.
            if (isOpen == false) return null;

            string title = $"#{number}";
            string? boardStatus = null;
            var blockedBy = new List<ChatDockEdge>();
            var blocks = new List<ChatDockEdge>();

            try
            {
                var titleLookup = await GitHubIssuesService.GetIssueTitleAsync(number);
                if (!string.IsNullOrWhiteSpace(titleLookup.Title)) title = titleLookup.Title!;
            }
            catch { /* title stays the bare number — not fatal, the item is still real */ }

            if (gh != null)
            {
                try
                {
                    var statusTask = gh.GetIssueBoardStatusAsync(number);
                    var blockedByTask = WalkChainAsync(gh, number, reverse: false);
                    var blocksTask = WalkChainAsync(gh, number, reverse: true);
                    await Task.WhenAll(statusTask, blockedByTask, blocksTask);
                    boardStatus = statusTask.Result?.StatusName;
                    blockedBy = blockedByTask.Result;
                    blocks = blocksTask.Result;
                }
                catch (Exception ex)
                {
                    // Metadata-only failure — the item itself stays in the actionable list
                    // (fail-closed), it just renders without a chain/board-status this pass.
                    ActivityLog.Log("chat.dock", $"relationship/board-status fetch failed for #{number}: {ex.Message}");
                }
            }

            return new ChatDockItem
            {
                Number = number,
                Title = title,
                StateUnknown = isOpen == null,
                BoardStatus = boardStatus,
                LiveQueueStatus = FindLiveQueueStatus(number, liveQueueItems),
                BlockedBy = blockedBy,
                Blocks = blocks,
            };
        }

        /// <summary>Git #2686 — reuses the exact match shape #2548's Chat Document Container context
        /// bar already proved for this class of problem (<c>ChatDocumentContainer.ComputeAndRenderCounts</c>):
        /// a queue row belongs to this issue number if either its own <c>GithubNumber</c> or any of its
        /// <c>AssociatedIssueNumbers</c> matches. When more than one live row matches (a re-dispatch
        /// history), prefer a still-ACTIVE row over a terminal one, then the most recently updated —
        /// the real "what's happening right now" signal, not just whichever row sorts first.</summary>
        private static string? FindLiveQueueStatus(int number, IReadOnlyList<QueueItem>? liveQueueItems)
        {
            if (liveQueueItems == null || liveQueueItems.Count == 0) return null;

            var match = liveQueueItems
                .Where(q => (q.GithubNumber.HasValue && q.GithubNumber.Value == number) || q.AssociatedIssueNumbers.Contains(number))
                .OrderByDescending(q => BuildQueuePostgresClient.IsActiveStatus(q.Status) ? 1 : 0)
                .ThenByDescending(q => q.UpdatedAt ?? DateTimeOffset.MinValue)
                .FirstOrDefault();

            return match?.Status;
        }

        /// <summary>
        /// Bounded BFS chain walk reusing #2081's single-hop <see cref="GitHubApiClient.GetBlockedByAsync"/>
        /// / <see cref="GitHubApiClient.GetBlockingAsync"/> repeatedly, so a chain like #2007 blocked by
        /// #2002 blocked by #2005 surfaces as three real hops instead of stopping at the first link. Stops
        /// walking through a node once it's CLOSED (a closed link can't propagate a live block further),
        /// and never revisits a number already seen (cycle-safe).
        /// </summary>
        private static async Task<List<ChatDockEdge>> WalkChainAsync(GitHubApiClient gh, int root, bool reverse)
        {
            var edges = new List<ChatDockEdge>();
            var visited = new HashSet<int> { root };
            var frontier = new List<int> { root };

            for (int depth = 1; depth <= MaxChainDepth && frontier.Count > 0; depth++)
            {
                var next = new List<int>();
                foreach (var node in frontier)
                {
                    List<GitHubIssueResult> related;
                    try
                    {
                        related = reverse ? await gh.GetBlockingAsync(node) : await gh.GetBlockedByAsync(node);
                    }
                    catch
                    {
                        continue; // one node's hop failing doesn't abort the whole chain walk
                    }

                    foreach (var r in related)
                    {
                        if (!visited.Add(r.Number)) continue;
                        edges.Add(new ChatDockEdge
                        {
                            Number = r.Number,
                            Title = r.Title,
                            IsClosed = r.IsClosed,
                            Depth = depth,
                            Reverse = reverse,
                        });
                        if (!r.IsClosed) next.Add(r.Number);
                    }
                }
                frontier = next;
            }

            return edges;
        }
    }
}

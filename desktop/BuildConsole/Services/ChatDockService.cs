using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
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

        // Git #3113 — the whole live-GitHub concurrency-bounding apparatus this service used to carry
        // (#2889's MaxConcurrentItemFetches, #3073's process-wide SharedItemFetchGate, the per-number
        // metadata cooldown) is GONE, because the dock no longer makes ANY live GitHub call. Every
        // mentioned issue's title, open/closed state, board Status and blocked-by/blocking chain now
        // reads from the local bt_issue_mirror (refreshed by one periodic batched sync, #3113's real
        // root fix). There is nothing left to stagger — local Postgres reads have none of the
        // secondary-rate-limit sensitivity that made those gates necessary.

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

            // Git #3113 — Step 2 is now a LOCAL mirror read, not a live GitHub round-trip. One batched
            // read of every mentioned number's mirrored row (title, open/closed state, board Status,
            // blocked-by/blocking) replaces the old per-issue `gh issue view` + per-issue board-status
            // GraphQL + live BFS chain walk — the exact per-issue burst the dock used to contribute to
            // the recurring rate-limit cycle. The mirror is refreshed by one periodic batched sync
            // (GitHubIssueMirror), so this dock refresh costs GitHub nothing.
            var cache = await GitHubIssueMirror.GetManyAsync(mentioned);

            // Fail-closed exactly as before: if the mirror has never completed a successful sync, we
            // can't tell open from closed, so every mention is kept (unknown) rather than silently
            // dropped — the same rule #1600 applied when the live `gh` check was unreachable.
            bool mirrorUsable = await GitHubIssueMirror.HasUsableDataAsync();

            var items = new List<ChatDockItem>();
            foreach (var number in mentioned)
            {
                var item = await BuildItemFromMirrorAsync(number, mirrorUsable, cache, liveQueueItems);
                if (item != null) items.Add(item);
            }

            return new ChatDockData
            {
                Items = items,
                PinnedQuestions = pins,
                // GitHubReachable now means "the mirror has real, synced data"; when false the dock
                // shows every mention unfiltered with the note below (same fail-closed UX as before).
                GitHubReachable = mirrorUsable,
                GitHubError = mirrorUsable ? null : "issue mirror not yet populated — showing all mentions unfiltered until the first sync completes",
            };
        }

        /// <summary>
        /// Git #3113 — one mentioned issue's dock item, built entirely from the local
        /// <see cref="GitHubIssueMirror"/> (no live GitHub call). Drop rules mirror the old live
        /// cross-check exactly:
        ///   • mirror usable + row is CLOSED  → drop (confirmed resolved).
        ///   • mirror usable + NO row         → drop: the mirror's open set is every open repo issue,
        ///                                       so an absent number is not open (the old
        ///                                       <c>isOpen == false</c> case).
        ///   • mirror usable + row is OPEN    → keep, StateUnknown = false.
        ///   • mirror NOT usable (never synced) → keep every mention, StateUnknown = true (fail-closed).
        /// </summary>
        private static async Task<ChatDockItem?> BuildItemFromMirrorAsync(
            int number,
            bool mirrorUsable,
            Dictionary<int, GitHubIssueMirror.MirrorIssue> cache,
            IReadOnlyList<QueueItem>? liveQueueItems)
        {
            cache.TryGetValue(number, out var row);

            if (mirrorUsable)
            {
                if (row == null) return null;       // not in the open set → resolved/closed → drop
                if (row.IsClosed) return null;      // confirmed closed → drop
            }

            string title = row != null && !string.IsNullOrWhiteSpace(row.Title) ? row.Title : $"#{number}";
            var blockedBy = await WalkChainFromMirrorAsync(number, cache, reverse: false);
            var blocks = await WalkChainFromMirrorAsync(number, cache, reverse: true);

            return new ChatDockItem
            {
                Number = number,
                Title = title,
                // Unknown only when the mirror can't yet vouch for state at all (never synced) or the
                // issue has no row while the mirror IS usable can't happen here (dropped above).
                StateUnknown = !mirrorUsable,
                BoardStatus = row?.BoardStatusName,
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
        /// Git #3113 — the same bounded, cycle-safe BFS chain walk as before (#2007 blocked-by #2002
        /// blocked-by #2005 surfaces as three hops; stops walking through a CLOSED node), but over the
        /// LOCAL mirror graph (<see cref="GitHubIssueMirror.MirrorIssue.BlockedByNumbers"/> /
        /// <see cref="GitHubIssueMirror.MirrorIssue.BlockingNumbers"/>) instead of a live per-hop
        /// <c>GetBlockedByAsync</c>/<c>GetBlockingAsync</c> REST call. <paramref name="cache"/> is the
        /// per-dock row cache (seeded from the batched GetManyAsync); any node not yet in it is filled
        /// from the mirror on demand. A number the mirror has never heard of simply has no further
        /// hops (same as a live hop returning nothing) — never a GitHub call.
        /// </summary>
        private static async Task<List<ChatDockEdge>> WalkChainFromMirrorAsync(
            int root, Dictionary<int, GitHubIssueMirror.MirrorIssue> cache, bool reverse)
        {
            var edges = new List<ChatDockEdge>();
            var visited = new HashSet<int> { root };
            var frontier = new List<int> { root };

            for (int depth = 1; depth <= MaxChainDepth && frontier.Count > 0; depth++)
            {
                var next = new List<int>();
                foreach (var node in frontier)
                {
                    var nodeRow = await GetCachedRowAsync(node, cache);
                    if (nodeRow == null) continue;
                    var related = reverse ? nodeRow.BlockingNumbers : nodeRow.BlockedByNumbers;

                    foreach (var num in related)
                    {
                        if (!visited.Add(num)) continue;
                        var relRow = await GetCachedRowAsync(num, cache);
                        bool isClosed = relRow?.IsClosed ?? false;
                        string title = relRow != null && !string.IsNullOrWhiteSpace(relRow.Title) ? relRow.Title : $"#{num}";
                        edges.Add(new ChatDockEdge
                        {
                            Number = num,
                            Title = title,
                            IsClosed = isClosed,
                            Depth = depth,
                            Reverse = reverse,
                        });
                        if (!isClosed) next.Add(num);
                    }
                }
                frontier = next;
            }

            return edges;
        }

        /// <summary>A mirrored row from the per-dock cache, filling it from the local mirror on a miss.
        /// A local, pooled Postgres read — never a GitHub call. Returns null when the mirror has no row
        /// for that number.</summary>
        private static async Task<GitHubIssueMirror.MirrorIssue?> GetCachedRowAsync(
            int number, Dictionary<int, GitHubIssueMirror.MirrorIssue> cache)
        {
            if (cache.TryGetValue(number, out var cached)) return cached;
            var row = await GitHubIssueMirror.TryGetAsync(number);
            if (row != null) cache[number] = row;
            return row;
        }
    }
}

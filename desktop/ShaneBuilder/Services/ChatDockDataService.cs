using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2195 — one still-open (or closed) edge in a mentioned issue's dependency chain, at
/// some hop distance from the root. <see cref="Reverse"/> distinguishes "what blocks this" from "what
/// this blocks". Ported shape-for-shape from BuildConsole's <c>ChatDockEdge</c>.</summary>
public sealed class ChatDockEdge
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    /// <summary>1 = a direct blocker/blockee of the root item; 2+ = a further hop discovered by
    /// walking that node's own relationships (the #2007→#2002→#2005 chain case from #2035).</summary>
    public int Depth { get; init; }
    public bool Reverse { get; init; }
}

/// <summary>Git #2195 — one mentioned issue that survived the live actionable filter, with its real
/// current GitHub state and its dependency chain in both directions.</summary>
public sealed class ChatDockItem
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    /// <summary>True when GitHub was unreachable for THIS number specifically — the item is still
    /// included (fail-closed, never silently dropped) but the dock should say so rather than implying
    /// a clean live check.</summary>
    public bool StateUnknown { get; init; }
    /// <summary>The real board "Status" column name (e.g. "Batter Up", "In Progress"), null if
    /// unavailable (lookup failed or the issue isn't on the board).</summary>
    public string? BoardStatus { get; init; }
    public List<ChatDockEdge> BlockedBy { get; init; } = new();
    public List<ChatDockEdge> Blocks { get; init; } = new();
    public bool HasChain => BlockedBy.Count > 0 || Blocks.Count > 0;
}

/// <summary>Git #2195 — the whole per-chat dock snapshot: the filtered, chain-mapped mentioned issues
/// plus that chat's active pinned questions, synthesized into one view.</summary>
public sealed class ChatDockData
{
    public List<ChatDockItem> Items { get; init; } = new();
    public List<PinnedQuestion> PinnedQuestions { get; init; } = new();
    /// <summary>False when the live open/closed cross-check itself couldn't reach GitHub this pass —
    /// every mentioned number is then treated as still actionable/unknown rather than silently
    /// dropped (fail-closed, Git #1600).</summary>
    public bool GitHubReachable { get; init; } = true;
    public string? GitHubError { get; init; }
    /// <summary>Git #2197 — null when a <c>bt_chats</c> row was found for the chat (pinned questions
    /// could be read); a stated reason when the FK couldn't be resolved (e.g. BuildConsole never
    /// recorded this conversation) so the caller can say WHY there are no pinned questions rather
    /// than implying there are none.</summary>
    public string? PinnedQuestionsUnavailableReason { get; init; }

    public static readonly ChatDockData Empty = new();
}

/// <summary>
/// Git #2197 — the ShaneBuilder-side port of #2195's landed <c>ChatDockService</c>
/// (<c>desktop/BuildConsole/Services/ChatDockService.cs</c>, commit <c>719656485</c>): the
/// data-merge + live-filter + bounded-chain-walk that turns "everything this chat ever mentioned"
/// into "what's actually still pending in this chat right now".
///
/// This is a faithful port of the real landed C#, not a re-derivation from the issue prose:
///  • same 14-day staleness window + 40-item hard cap that #2195 tuned against a real 449-mention
///    production chat, so a hyperactive chat can't turn one dock refresh into hundreds of gh calls;
///  • same #1600 fail-closed rule — GitHub unreachable ⇒ item kept as unknown, only a CONFIRMED
///    closed state drops it;
///  • same bounded (depth 3) bidirectional BFS chain walk reusing single-hop blocked_by/blocking.
///
/// The one deliberate ShaneBuilder difference: pinned questions are keyed on <c>chat_id</c>, which
/// ShaneBuilder resolves from the chat URL via <see cref="ChatReadClient.ResolveChatIdByChatUrlAsync"/>
/// (see that method's FK-gap note) rather than being handed a <c>chatId</c> from its own chat table,
/// because ShaneBuilder has no chat-tracking concept of its own. Infrastructure only — no UI here.
/// </summary>
public static class ChatDockDataService
{
    /// <summary>Matches #2030's own worked example (a 2-hop chain) with one hop of headroom.</summary>
    private const int MaxChainDepth = 3;

    /// <summary>The "not stale" third of the filter's definition ("open, not already resolved
    /// elsewhere, not stale"). Anything not re-mentioned within this window is dropped from the dock
    /// AND from the live GitHub check entirely. Value ported verbatim from #2195.</summary>
    private static readonly TimeSpan StalenessWindow = TimeSpan.FromDays(14);

    /// <summary>Hard safety cap on how many non-stale mentions get the full live/chain enrichment
    /// pass, most-recently-mentioned first — a backstop under the staleness window. Ported from #2195.</summary>
    private const int MaxEnrichedItems = 40;

    /// <summary>ShaneBuilder's natural entry point: it only has the chat URL. Resolves the pinned-
    /// questions <c>chat_id</c> from that URL via the shared <c>bt_chats</c> table, then runs the
    /// same merge/filter as the explicit-chatId overload.</summary>
    public static async Task<ChatDockData> BuildAsync(ChatReadClient db, ChatGitHubFilter gh, string chatUrl)
    {
        if (db == null) return ChatDockData.Empty;
        int? chatId = null;
        string? unavailableReason = null;
        try
        {
            chatId = await db.ResolveChatIdByChatUrlAsync(chatUrl);
            if (chatId == null)
                unavailableReason = "No bt_chats row found for this conversation (never tracked by BuildConsole) — pinned questions unavailable.";
        }
        catch (Exception ex)
        {
            unavailableReason = $"chat_id resolution failed: {ex.Message}";
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] chat_id resolve failed for {chatUrl}: {ex.Message}");
        }
        return await BuildAsync(db, gh, chatUrl, chatId ?? 0, unavailableReason);
    }

    /// <summary>Explicit-chatId overload, matching #2195's <c>BuildAsync(db, chatUrl, chatId)</c>
    /// signature for callers that already have a resolved <c>bt_chats.id</c>.</summary>
    public static async Task<ChatDockData> BuildAsync(ChatReadClient db, ChatGitHubFilter gh, string chatUrl, int chatId, string? pinnedUnavailableReason = null)
    {
        if (db == null) return ChatDockData.Empty;

        List<ChatIssueMention> mentionRows;
        List<PinnedQuestion> pins;
        try
        {
            mentionRows = await db.GetChatIssueMentionsForUrlAsync(chatUrl);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] mentions load failed for {chatUrl}: {ex.Message}");
            mentionRows = new List<ChatIssueMention>();
        }
        try
        {
            pins = chatId > 0 ? await db.GetOpenPinnedQuestionsForChatAsync(chatId) : new List<PinnedQuestion>();
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] pinned questions load failed for chat {chatId}: {ex.Message}");
            pins = new List<PinnedQuestion>();
        }

        var cutoff = DateTimeOffset.UtcNow - StalenessWindow;
        var mentioned = mentionRows
            .Where(m => m.LastSeenAt >= cutoff)
            .Take(MaxEnrichedItems)
            .Select(m => m.Number)
            .ToList();

        if (mentioned.Count == 0)
            return new ChatDockData
            {
                Items = new List<ChatDockItem>(),
                PinnedQuestions = pins,
                PinnedQuestionsUnavailableReason = pinnedUnavailableReason,
            };

        // Step 2 — live open/closed cross-check, one gh call (Git #1600 fail-closed shape:
        // Success=false means GitHub was unreachable, never "nothing open").
        var openResult = await gh.TryGetOpenIssueNumbersAsync();
        bool reachedGitHub = openResult.Success;

        var items = new List<ChatDockItem>();
        foreach (var number in mentioned)
        {
            bool? isOpen = reachedGitHub ? openResult.OpenNumbers.Contains(number) : (bool?)null;
            // Fail-closed: unknown (GitHub unreachable) is treated as still-relevant, same as a
            // confirmed-open issue. Only a CONFIRMED closed state drops it from the dock.
            if (isOpen == false) continue;

            string title = $"#{number}";
            string? boardStatus = null;
            var blockedBy = new List<ChatDockEdge>();
            var blocks = new List<ChatDockEdge>();

            try
            {
                var titleLookup = await gh.GetIssueTitleAsync(number);
                if (!string.IsNullOrWhiteSpace(titleLookup)) title = titleLookup!;
            }
            catch { /* title stays the bare number — not fatal, the item is still real */ }

            try
            {
                var statusTask = gh.GetBoardStatusAsync(number);
                blockedBy = await WalkChainAsync(gh, number, reverse: false);
                blocks = await WalkChainAsync(gh, number, reverse: true);
                boardStatus = await statusTask;
            }
            catch (Exception ex)
            {
                // Metadata-only failure — the item itself stays in the actionable list (fail-closed),
                // it just renders without a chain/board-status this pass.
                ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] relationship/board-status fetch failed for #{number}: {ex.Message}");
            }

            items.Add(new ChatDockItem
            {
                Number = number,
                Title = title,
                StateUnknown = isOpen == null,
                BoardStatus = boardStatus,
                BlockedBy = blockedBy,
                Blocks = blocks,
            });
        }

        return new ChatDockData
        {
            Items = items,
            PinnedQuestions = pins,
            GitHubReachable = reachedGitHub,
            GitHubError = openResult.Error,
            PinnedQuestionsUnavailableReason = pinnedUnavailableReason,
        };
    }

    /// <summary>
    /// Bounded BFS chain walk reusing #2081's single-hop <see cref="ChatGitHubFilter.GetBlockedByAsync"/>
    /// / <see cref="ChatGitHubFilter.GetBlockingAsync"/> repeatedly, so a chain like #2007 blocked by
    /// #2002 blocked by #2005 surfaces as three real hops instead of stopping at the first link. Stops
    /// walking through a node once it's CLOSED (a closed link can't propagate a live block further),
    /// and never revisits a number already seen (cycle-safe). Ported verbatim from #2195's
    /// <c>ChatDockService.WalkChainAsync</c>.
    /// </summary>
    private static async Task<List<ChatDockEdge>> WalkChainAsync(ChatGitHubFilter gh, int root, bool reverse)
    {
        var edges = new List<ChatDockEdge>();
        var visited = new HashSet<int> { root };
        var frontier = new List<int> { root };

        for (int depth = 1; depth <= MaxChainDepth && frontier.Count > 0; depth++)
        {
            var next = new List<int>();
            foreach (var node in frontier)
            {
                List<GitHubEdgeResult> related;
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

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2209 §6 — the typed vocabulary the "Detected in this chat" panel renders as chips. The five
/// kinds are the doc's own <c>DetectionKind</c> set. Only the two with a REAL landed data source are
/// ever populated today (see <see cref="ChatDetectionService"/>): <see cref="GitIssue"/> from the
/// #2195/#2197 chat-mention registry, and <see cref="Question"/> from the pinned-questions system.
/// <see cref="Task"/>/<see cref="Todo"/>/<see cref="Commitment"/> require free-form mining of the
/// transcript CONTENT, which has no engine yet (comment 2026-09-02 confirms this is a presentation
/// layer over the same pinned/mentions data, not a separate detector) — the panel supports the chip
/// but never invents a row for these until a real miner exists.
/// </summary>
public enum DetectionKind
{
    GitIssue,
    Task,
    Todo,
    Commitment,
    Question,
}

/// <summary>Git #2209 §6 — one detected, actionable item mined from this chat. Every field is real:
/// there is no fixture path. <see cref="Id"/> is stable across refreshes so the caller's Dismiss set
/// survives a re-render.</summary>
public sealed class Detection
{
    public required string Id { get; init; }
    public DetectionKind Kind { get; init; }
    public required string Title { get; init; }
    public string? Detail { get; init; }
    /// <summary>The GitHub issue number, for a <see cref="DetectionKind.GitIssue"/> — null otherwise.
    /// Drives "Promote to Queue" (needs a real leaf issue) vs. a promote that only stages text.</summary>
    public int? Number { get; init; }
    /// <summary>The real board Status column ("Verifying", "In Progress", …) for a GitIssue that has
    /// one; null when the issue isn't on the board or the lookup failed. Doubles as the group key.</summary>
    public string? BoardStatus { get; init; }
    public bool StateUnknown { get; init; }
}

/// <summary>Git #2209 §6 — a collapsible group of detections (e.g. "Verifying", "Claude asks").</summary>
public sealed class DetectionGroup
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public List<Detection> Items { get; init; } = new();
}

/// <summary>Git #2209 §6 — the whole Detected panel snapshot: grouped detections + loose cards, plus
/// the same honest-diagnostics pass-through <see cref="ChatDockData"/> already carries so the panel can
/// say WHY a section is empty rather than implying nothing was found.</summary>
public sealed class DetectionSnapshot
{
    public List<DetectionGroup> Groups { get; init; } = new();
    public List<Detection> Loose { get; init; } = new();
    public bool GitHubReachable { get; init; } = true;
    public string? GitHubError { get; init; }
    public string? PinnedQuestionsUnavailableReason { get; init; }
    /// <summary>True when the read layer itself was unavailable (no DATABASE_URL resolvable) — the
    /// panel then shows a stated reason, never a faked empty "nothing caught yet".</summary>
    public bool DataLayerAvailable { get; init; } = true;

    public int Total => Groups.Sum(g => g.Items.Count) + Loose.Count;

    public static readonly DetectionSnapshot NoDataLayer = new() { DataLayerAvailable = false };
}

/// <summary>
/// Git #2209 §6 — the presentation-layer mapper that turns #2197's already-landed
/// <see cref="ChatDockData"/> (real Postgres mentions + pinned questions, enriched with live GitHub
/// board status) into the Detected panel's grouped/loose <see cref="Detection"/> shape. This is the UI
/// wiring the #2195/#2197 pipe was "waiting for" (issue comment 2026-09-02) — no new detection engine,
/// no fixture rows: a GitHub-mentioned issue becomes a <see cref="DetectionKind.GitIssue"/> grouped by
/// its real board status, and an open pinned question becomes a <see cref="DetectionKind.Question"/>.
/// </summary>
public static class ChatDetectionService
{
    /// <summary>Status-column ordering so the most-actionable group ("Verifying" — a build awaiting
    /// review) sits first, matching the doc's own "Verifying: 6" example leading the panel.</summary>
    private static readonly string[] StatusOrder =
    {
        "Verifying", "In Progress", "In progress", "Batter Up", "AI Batter Up", "Blocked", "Backlog", "Done",
    };

    public static async Task<DetectionSnapshot> BuildAsync(ChatReadClient? db, ChatGitHubFilter gh, string chatUrl)
    {
        if (db == null) return DetectionSnapshot.NoDataLayer;

        var data = await ChatDockDataService.BuildAsync(db, gh, chatUrl);
        return Project(data);
    }

    /// <summary>Pure transform (no I/O) so it is unit-testable against a hand-built
    /// <see cref="ChatDockData"/> and reusable if a caller already has one.</summary>
    public static DetectionSnapshot Project(ChatDockData data)
    {
        var groups = new List<DetectionGroup>();
        var loose = new List<Detection>();

        // ── GitIssue detections from the real chat-mention registry ──────────────────────────
        // An issue WITH a live board status is grouped by that status; one without falls to loose,
        // exactly the "grouped detections + individual loose cards" split §6 describes.
        var byStatus = new Dictionary<string, DetectionGroup>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in data.Items)
        {
            var det = new Detection
            {
                Id = $"issue:{item.Number}",
                Kind = DetectionKind.GitIssue,
                Title = item.Title,
                Number = item.Number,
                BoardStatus = item.BoardStatus,
                StateUnknown = item.StateUnknown,
                Detail = DescribeChain(item),
            };

            if (string.IsNullOrWhiteSpace(item.BoardStatus))
            {
                loose.Add(det);
                continue;
            }

            if (!byStatus.TryGetValue(item.BoardStatus!, out var grp))
            {
                grp = new DetectionGroup { Key = item.BoardStatus!, Label = item.BoardStatus! };
                byStatus[item.BoardStatus!] = grp;
            }
            grp.Items.Add(det);
        }

        foreach (var grp in byStatus.Values.OrderBy(g => StatusRank(g.Key)).ThenBy(g => g.Key))
            groups.Add(grp);

        // ── Question detections from the real pinned-questions system ─────────────────────────
        if (data.PinnedQuestions.Count > 0)
        {
            var qGroup = new DetectionGroup { Key = "questions", Label = "Claude asks" };
            foreach (var q in data.PinnedQuestions)
            {
                qGroup.Items.Add(new Detection
                {
                    Id = $"pinq:{q.Id}",
                    Kind = DetectionKind.Question,
                    Title = q.QuestionText,
                    Detail = string.IsNullOrWhiteSpace(q.ChatTitle) ? null : q.ChatTitle,
                });
            }
            groups.Add(qGroup);
        }

        return new DetectionSnapshot
        {
            Groups = groups,
            Loose = loose,
            GitHubReachable = data.GitHubReachable,
            GitHubError = data.GitHubError,
            PinnedQuestionsUnavailableReason = data.PinnedQuestionsUnavailableReason,
            DataLayerAvailable = true,
        };
    }

    private static int StatusRank(string status)
    {
        for (int i = 0; i < StatusOrder.Length; i++)
            if (string.Equals(StatusOrder[i], status, StringComparison.OrdinalIgnoreCase))
                return i;
        return StatusOrder.Length; // unknown statuses sort after the known ones, before Done-only lists
    }

    private static string? DescribeChain(ChatDockItem item)
    {
        if (!item.HasChain) return null;
        var parts = new List<string>();
        if (item.BlockedBy.Count > 0)
            parts.Add("blocked by " + string.Join(" ", item.BlockedBy.Select(e => $"#{e.Number}")));
        if (item.Blocks.Count > 0)
            parts.Add("blocks " + string.Join(" ", item.Blocks.Select(e => $"#{e.Number}")));
        return parts.Count > 0 ? string.Join(" · ", parts) : null;
    }
}

/// <summary>
/// Git #2209 §7 — the cross-epic question round trip's real record. A question asked FROM one chat TO
/// another epic's chat carries a required <see cref="FromTabId"/> return address so "Bring the answer
/// back" knows exactly which tab to paste the answer into — the doc calls this out as the one field the
/// flow cannot work without. Held in memory on the shell (per-session); this is app state, not chat
/// content, so there is nothing fixture about a real user-authored question.
/// </summary>
public sealed class CrossEpicQuestion
{
    public required string Id { get; init; }
    /// <summary>The tab the question was asked FROM — the return address the answer comes back to.
    /// Required; a cross-epic question with no return address is the exact bug §7 guards against.</summary>
    public required string FromTabId { get; init; }
    /// <summary>The epic (issue number) the question was sent TO.</summary>
    public int TargetEpic { get; init; }
    /// <summary>The tab the question was written INTO (the target epic's chat), if that tab is open.</summary>
    public string? TargetTabId { get; init; }
    public required string QuestionText { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    /// <summary>Null until "Paste answer into this chat" captures the destination chat's real last
    /// assistant turn (or the user pastes it — the doc's fallback per resolved open question #2).</summary>
    public string? Answer { get; set; }
    public bool Answered => !string.IsNullOrWhiteSpace(Answer);
}

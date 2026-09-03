using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

// ── real shapes ─────────────────────────────────────────────────────────────────────────────

/// <summary>One real leaf issue under a feature — an actual GitHub sub-issue of a feature, with
/// the real timestamps burn rate/hours-left need. <c>ProjectItemId</c> is the real ProjectV2Item
/// id on the board (see <see cref="GitEpicPanelService"/>'s header) — null when the issue
/// genuinely isn't on the project, never a fabricated placeholder.</summary>
public sealed class GitEpicLeaf
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public List<string> Labels { get; init; } = new();
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? ClosedAt { get; init; }
    public string? ProjectItemId { get; init; }
}

/// <summary>One real direct sub-issue of the epic (a "feature"). <see cref="Leaves"/> is the real
/// actionable set under it: its own children when it has any, else the feature itself — a
/// childless feature IS the atomic work item, the same convention the tree (#2290) already uses
/// to decide chevron-vs-dot.</summary>
public sealed class GitEpicFeature
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public List<string> Labels { get; init; } = new();
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? ClosedAt { get; init; }
    public string? ProjectItemId { get; init; }
    public string? ProjectStatus { get; init; }
    public List<GitEpicLeaf> Children { get; init; } = new();
    public bool HasChildren => Children.Count > 0;

    public IEnumerable<GitEpicLeaf> Leaves => HasChildren
        ? Children
        : new[] { new GitEpicLeaf { Number = Number, Title = Title, IsClosed = IsClosed, Labels = Labels, CreatedAt = CreatedAt, ClosedAt = ClosedAt, ProjectItemId = ProjectItemId } };
}

/// <summary>The real epic-detail snapshot the Epic peek (#2303-#2308) renders from — one
/// GraphQL call, no second data path. <see cref="MilestoneDueOn"/> is GitHub's own real
/// milestone due date, used as the Epic panel's real "target date" (#2304) — never an invented
/// field.</summary>
public sealed class GitEpicDetail
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public DateTimeOffset? CreatedAt { get; init; }
    public int? MilestoneNumber { get; init; }
    public string? MilestoneTitle { get; init; }
    public DateTimeOffset? MilestoneDueOn { get; init; }
    public string? ProjectItemId { get; init; }
    public string? ProjectStatus { get; init; }
    public List<GitEpicFeature> Features { get; init; } = new();
    public int FeatureTotalCount { get; init; }
}

public sealed record GitBlockedByRef(int Number, string Title, bool IsClosed);

public enum GitEpicVerdict { NoTargetData, OnTarget, Behind }

public sealed class GitEpicVerdictResult
{
    public GitEpicVerdict Verdict { get; init; }
    public DateTimeOffset? ProjectedDate { get; init; }
    /// <summary>DueOn - ProjectedDate. Positive = buffer, negative = overrun.</summary>
    public TimeSpan? Margin { get; init; }
}

public sealed class GitEpicBurnStats
{
    public int TotalLeaves { get; init; }
    public int ClosedLeaves { get; init; }
    public int OpenLeaves { get; init; }
    public double RingFraction => TotalLeaves > 0 ? (double)ClosedLeaves / TotalLeaves : 0;
    /// <summary>Closures/week — last 28 real days if any landed, else the epic's real all-time
    /// average since its own earliest real sub-issue creation. Null = never any closures, so no
    /// rate can honestly be computed.</summary>
    public double? BurnRatePerWeek { get; init; }
    public double? EstimatedRemainingWeeks { get; init; }
    /// <summary>Real average (closedAt - createdAt) in hours across every closed leaf with both
    /// timestamps. Null when nothing has closed yet.</summary>
    public double? AvgCycleHours { get; init; }
}

public sealed class GitEpicFeatureStats
{
    public int ClosedCount { get; init; }
    public int OpenCount { get; init; }
    public double RingFraction { get; init; }
    public double? HoursLeft { get; init; }
    /// <summary>Only non-zero buckets, per #2305's own "non-zero state chips" ask — keys are the
    /// same six-state vocabulary Build Queue's own band header spec defines: up next, running,
    /// verifying, blocked, parked, paused.</summary>
    public Dictionary<string, int> Chips { get; init; } = new();
    public PaletteBuildQueueRow? LastBuild { get; init; }
    public TimeSpan? IdleGap { get; init; }
    public bool IsPaused { get; init; }
}

/// <summary>
/// Git #2303-#2308 — real data layer for the Git Panel's Epic detail peek (Feature #2289's
/// items 14-19). Same fail-closed `gh` shellout pattern <see cref="GitPanelService"/>/
/// <see cref="GitMapService"/> already established (kept local for the same don't-regress-a-
/// shipped-surface reason those two classes' own headers give).
///
/// Two real write paths live here, both bounded and both real:
///  • GitHub Project v2 Status field writes ("Queue all" -&gt; Batter Up, "Park" -&gt;
///    Park/Backlog toggle) via the same <c>updateProjectV2ItemFieldValue</c> mutation
///    CLAUDE.md's own "AI Batter Up" recipe already uses, against the real project
///    (<c>PVT_kwHOEiBDdc4BeoiY</c>) and Status field (<c>PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0</c>) —
///    real option ids, confirmed live against the field before this file was written, never
///    guessed.
///  • Pause, which has no native GitHub or <c>bt_build_queue</c> home — that table's real
///    status vocabulary (confirmed against live data: <c>SELECT DISTINCT status FROM
///    bt_build_queue</c>) has no 'paused' value, and the table is BuildConsole-owned/read-only
///    from ShaneBuilder by contract (<see cref="QueueReadClient"/>'s own header) — lives in a
///    new, small, ShaneBuilder-owned table: <c>shanebuilder_feature_flags</c> (migration
///    <c>lib/db/migrations/manual/2026-09-02-shanebuilder-feature-flags-2307.sql</c>, run against
///    local Postgres by this same build).
/// </summary>
public static class GitEpicPanelService
{
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    private const string Repo = "shanemccaw/Shane-McCaw-MSP";
    public const string ProjectId = "PVT_kwHOEiBDdc4BeoiY";
    public const string StatusFieldId = "PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0";

    // Real option ids read live off the project's own Status field before this file was written
    // (`gh api graphql` against the field) — the same ids CLAUDE.md's own AI Batter Up recipe
    // uses for this field.
    public const string StatusOption_BatterUp = "09b1927f";
    public const string StatusOption_Park = "19cfa11c";
    public const string StatusOption_Backlog = "63cc47c8";

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    // ── read: epic detail (#2303, #2304, #2305, #2306) ──────────────────────────────────────

    /// <summary>One GraphQL call: the epic's own identity + real milestone (with its real due
    /// date, the panel's real "target date" for #2304) + real project Status, then its full two-
    /// level sub-tree (features, each with their own leaf issues) carrying real
    /// created/closed timestamps and real ProjectV2Item ids for the write actions below.</summary>
    public static async Task<(bool Ok, GitEpicDetail? Detail, string? Error)> GetEpicDetailAsync(int epicNumber)
    {
        const string projFields =
            "projectItems(first: 10) { nodes { id project { id } fieldValueByName(name: \"Status\") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } }";
        string query =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + epicNumber + ") { " +
            "number title state createdAt " +
            "milestone { number title dueOn } " +
            projFields + " " +
            "subIssues(first: 100) { totalCount nodes { " +
            "number title state createdAt closedAt labels(first: 20) { nodes { name } } " +
            projFields + " " +
            "subIssues(first: 100) { nodes { " +
            "number title state createdAt closedAt labels(first: 20) { nodes { name } } " + projFields +
            " } } " +
            "} } } } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] detail fetch failed for epic #{epicNumber}: {stderr.Trim()}");
            return (false, null, $"epic detail fetch failed: {stderr.Trim()}");
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            if (issueEl.ValueKind != JsonValueKind.Object)
                return (false, null, $"epic #{epicNumber} not found");

            var (msNum, msTitle, msDue) = ReadMilestone(issueEl);
            var (projItemId, projStatus) = ReadProjectStatus(issueEl);

            var features = new List<GitEpicFeature>();
            int totalCount = 0;
            if (issueEl.TryGetProperty("subIssues", out var subEl) && subEl.ValueKind == JsonValueKind.Object)
            {
                totalCount = subEl.TryGetProperty("totalCount", out var tc) ? tc.GetInt32() : 0;
                foreach (var f in subEl.GetProperty("nodes").EnumerateArray())
                {
                    var children = new List<GitEpicLeaf>();
                    if (f.TryGetProperty("subIssues", out var cSubEl) && cSubEl.ValueKind == JsonValueKind.Object)
                        foreach (var c in cSubEl.GetProperty("nodes").EnumerateArray())
                            children.Add(ParseLeaf(c));

                    var (fProjItemId, fProjStatus) = ReadProjectStatus(f);
                    features.Add(new GitEpicFeature
                    {
                        Number = f.GetProperty("number").GetInt32(),
                        Title = f.TryGetProperty("title", out var ft) ? ft.GetString() ?? "" : "",
                        IsClosed = IsClosedState(f),
                        Labels = ReadLabels(f),
                        CreatedAt = ReadDate(f, "createdAt"),
                        ClosedAt = ReadDate(f, "closedAt"),
                        ProjectItemId = fProjItemId,
                        ProjectStatus = fProjStatus,
                        Children = children
                    });
                }
            }

            return (true, new GitEpicDetail
            {
                Number = issueEl.GetProperty("number").GetInt32(),
                Title = issueEl.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                IsClosed = IsClosedState(issueEl),
                CreatedAt = ReadDate(issueEl, "createdAt"),
                MilestoneNumber = msNum,
                MilestoneTitle = msTitle,
                MilestoneDueOn = msDue,
                ProjectItemId = projItemId,
                ProjectStatus = projStatus,
                Features = features,
                FeatureTotalCount = totalCount
            }, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] couldn't parse epic detail for #{epicNumber}: {ex.Message}");
            return (false, null, $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>Git #2306 — one issue's real upstream blockers via GitHub's own real dependency
    /// edges (REST, same endpoint CLAUDE.md's own blocked_by recipe reads/writes — GraphQL has no
    /// equivalent field in this schema). Empty list is a genuine "not blocked", never a guess.</summary>
    public static async Task<(bool Ok, List<GitBlockedByRef> Blockers, string? Error)> GetBlockedByAsync(int issueNumber)
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "api", $"repos/{Owner}/{RepoName}/issues/{issueNumber}/dependencies/blocked_by",
            "--jq", "[.[] | {number, title, state}]"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] blocked_by fetch failed for #{issueNumber}: {stderr.Trim()}");
            return (false, new List<GitBlockedByRef>(), $"blocked_by fetch failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<BlockedByRow>>(stdout, JsonOpts) ?? new();
            return (true, rows.Select(r => new GitBlockedByRef(r.Number, r.Title ?? $"#{r.Number}",
                string.Equals(r.State, "closed", StringComparison.OrdinalIgnoreCase))).ToList(), null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] couldn't parse blocked_by for #{issueNumber}: {ex.Message}");
            return (false, new List<GitBlockedByRef>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    // ── write: Queue all / Park (#2307) ─────────────────────────────────────────────────────

    /// <summary>One real ProjectV2 Status write. Used by Park (single item) and by the bulk
    /// variant below for Queue all.</summary>
    public static async Task<(bool Ok, string? Error)> SetProjectStatusAsync(string projectItemId, string statusOptionId)
    {
        string mutation = BuildStatusMutation(new[] { projectItemId }, statusOptionId);
        var (ok, _, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={mutation}" });
        if (!ok) ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] status write failed for {projectItemId}: {stderr.Trim()}");
        return (ok, ok ? null : stderr.Trim());
    }

    /// <summary>Git #2316 — the real "why" behind a Park. Posted as a normal GitHub issue comment
    /// (`Parked: &lt;reason&gt;`), not a new field anywhere — Project v2 Status has no free-text
    /// companion field, and a comment is the same "leave a real trail" pattern already used
    /// elsewhere in this repo (the `blocked` label's own comment requirement). <see
    /// cref="GitMapService"/>'s Focus Build fallback reads this same comment back to surface the
    /// reason on the card.</summary>
    public static async Task<(bool Ok, string? Error)> PostParkReasonCommentAsync(int issueNumber, string reason)
    {
        var (ok, _, stderr) = await RunGhAsync(new[]
        {
            "issue", "comment", issueNumber.ToString(), "--repo", Repo, "--body", $"Parked: {reason}",
        });
        if (!ok) ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] park reason comment failed for #{issueNumber}: {stderr.Trim()}");
        return (ok, ok ? null : stderr.Trim());
    }

    /// <summary>"Queue all" (#2307, item 6 in Build Queue's own spec: "promotes every open issue
    /// in the feature") — every real ProjectV2Item id gets its Status field set to Batter Up in
    /// ONE batched GraphQL request (aliased mutations), not N round-trips. Items with no real
    /// project item id (genuinely not on the board) are skipped and reported, never silently
    /// dropped nor invented.</summary>
    public static async Task<(bool Ok, int Written, int Skipped, string? Error)> SetProjectStatusBulkAsync(IEnumerable<string?> projectItemIds, string statusOptionId)
    {
        var all = projectItemIds.ToList();
        var ids = all.Where(id => !string.IsNullOrEmpty(id)).Cast<string>().Distinct().ToList();
        int skipped = all.Count - ids.Count;
        if (ids.Count == 0) return (true, 0, skipped, null);

        string mutation = BuildStatusMutation(ids, statusOptionId);
        var (ok, _, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={mutation}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] bulk status write failed: {stderr.Trim()}");
            return (false, 0, skipped, stderr.Trim());
        }
        return (true, ids.Count, skipped, null);
    }

    private static string BuildStatusMutation(IReadOnlyList<string> itemIds, string statusOptionId)
    {
        var sb = new StringBuilder("mutation { ");
        for (int i = 0; i < itemIds.Count; i++)
        {
            sb.Append("m").Append(i).Append(": updateProjectV2ItemFieldValue(input: { projectId: \"")
              .Append(ProjectId).Append("\", itemId: \"").Append(itemIds[i])
              .Append("\", fieldId: \"").Append(StatusFieldId)
              .Append("\", value: { singleSelectOptionId: \"").Append(statusOptionId)
              .Append("\" } }) { projectV2Item { id } } ");
        }
        sb.Append('}');
        return sb.ToString();
    }

    // ── propagation overlay (#2308) ──────────────────────────────────────────────────────────

    /// <summary>Git #2308 — the one real overlay every surface that renders a <see
    /// cref="GitMapFeature"/> list calls after its own fetch (Git Map's mini rail + full doc tab
    /// share ONE builder already, per that file's own header — this needs calling from exactly
    /// one of the two real call sites for both to get it), so Park/Pause read the same real state
    /// everywhere: GitHub's own Project Status field for Park (one batched aliased GraphQL call,
    /// capped at 60 issues to keep the request bounded — a single epic's open-feature count has
    /// never approached that), and <c>shanebuilder_feature_flags</c> for Pause.</summary>
    public static async Task OverlayParkPauseAsync(List<GitMapFeature> features, string? dbConnectionString)
    {
        if (features.Count == 0) return;
        var numbers = features.Select(f => f.Number).Distinct().ToList();

        var capped = numbers.Take(60).ToList();
        if (capped.Count > 0)
        {
            var sb = new StringBuilder("query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { ");
            for (int i = 0; i < capped.Count; i++)
                sb.Append('i').Append(i).Append(": issue(number: ").Append(capped[i]).Append(") { number ")
                  .Append("projectItems(first: 5) { nodes { project { id } fieldValueByName(name: \"Status\") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } ");
            sb.Append("} }");

            var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={sb}" });
            if (ok)
            {
                try
                {
                    using var doc = JsonDocument.Parse(stdout);
                    var repoEl = doc.RootElement.GetProperty("data").GetProperty("repository");
                    var parkedNumbers = new HashSet<int>();
                    foreach (var prop in repoEl.EnumerateObject())
                    {
                        var issueEl = prop.Value;
                        if (issueEl.ValueKind != JsonValueKind.Object) continue;
                        var (_, status) = ReadProjectStatus(issueEl);
                        if (string.Equals(status, "Park", StringComparison.OrdinalIgnoreCase) && issueEl.TryGetProperty("number", out var numEl))
                            parkedNumbers.Add(numEl.GetInt32());
                    }
                    foreach (var f in features) f.IsParked = parkedNumbers.Contains(f.Number);
                }
                catch (Exception ex)
                {
                    ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] park overlay parse failed: {ex.Message}");
                }
            }
            else
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] park overlay fetch failed: {stderr.Trim()}");
            }
        }

        if (!string.IsNullOrWhiteSpace(dbConnectionString))
        {
            var paused = await FeaturePauseStore.GetPausedAsync(numbers, dbConnectionString!);
            foreach (var f in features) f.IsPaused = paused.TryGetValue(f.Number, out var p) && p;
        }
    }

    // ── burn rate, estimate, verdict (#2303, #2304) ──────────────────────────────────────────

    public static GitEpicBurnStats ComputeBurnStats(IEnumerable<GitEpicLeaf> leaves, DateTimeOffset now)
    {
        var list = leaves.ToList();
        int closed = list.Count(l => l.IsClosed);
        int total = list.Count;

        double? avgCycleHours = null;
        var closedWithDates = list.Where(l => l.IsClosed && l.ClosedAt.HasValue && l.CreatedAt.HasValue).ToList();
        if (closedWithDates.Count > 0)
            avgCycleHours = closedWithDates.Average(l => (l.ClosedAt!.Value - l.CreatedAt!.Value).TotalHours);

        double? burnRatePerWeek = null;
        int recentClosures = list.Count(l => l.IsClosed && l.ClosedAt.HasValue && (now - l.ClosedAt.Value).TotalDays <= 28);
        if (recentClosures > 0)
        {
            burnRatePerWeek = recentClosures / 4.0;
        }
        else if (closed > 0)
        {
            var earliestCreated = list.Where(l => l.CreatedAt.HasValue).Select(l => l.CreatedAt!.Value).DefaultIfEmpty(now).Min();
            double weeksSince = Math.Max(1.0, (now - earliestCreated).TotalDays / 7.0);
            burnRatePerWeek = closed / weeksSince;
        }

        double? estimatedRemainingWeeks = burnRatePerWeek is > 0 ? (total - closed) / burnRatePerWeek.Value : null;

        return new GitEpicBurnStats
        {
            TotalLeaves = total,
            ClosedLeaves = closed,
            OpenLeaves = total - closed,
            BurnRatePerWeek = burnRatePerWeek,
            EstimatedRemainingWeeks = estimatedRemainingWeeks,
            AvgCycleHours = avgCycleHours
        };
    }

    /// <summary>Git #2304 — projects today + the real estimated-remaining onto the calendar and
    /// compares it to the epic's real milestone due date. No milestone/no due date/no burn data
    /// yet all honestly report <see cref="GitEpicVerdict.NoTargetData"/> rather than guessing.</summary>
    public static GitEpicVerdictResult ComputeVerdict(GitEpicBurnStats stats, DateTimeOffset? dueOn, DateTimeOffset now)
    {
        if (dueOn == null || stats.EstimatedRemainingWeeks == null)
            return new GitEpicVerdictResult { Verdict = GitEpicVerdict.NoTargetData };

        var projected = now.AddDays(stats.EstimatedRemainingWeeks.Value * 7.0);
        var margin = dueOn.Value - projected;
        return new GitEpicVerdictResult
        {
            Verdict = margin.TotalHours >= 0 ? GitEpicVerdict.OnTarget : GitEpicVerdict.Behind,
            ProjectedDate = projected,
            Margin = margin
        };
    }

    // ── per-feature stats (#2305) ────────────────────────────────────────────────────────────

    /// <summary><paramref name="relatedRows"/> is every real bt_build_queue row whose
    /// github_number matches one of this feature's own real leaf numbers — reduced here to the
    /// latest row per issue for "current" chip counts, per Build Queue's own six-state
    /// vocabulary (up next/running/verifying/blocked/parked/paused). "blocked" overrides
    /// queued/running when a real blocked_by_number is set and the row hasn't terminated.
    /// "paused" has no bt_build_queue backing (see class header) — it's this feature's own real
    /// local pause flag, applied to its real open count.</summary>
    public static GitEpicFeatureStats ComputeFeatureStats(GitEpicFeature feature, List<PaletteBuildQueueRow> relatedRows, bool paused, double? epicAvgCycleHours, DateTimeOffset now)
    {
        var leaves = feature.Leaves.ToList();
        int closedCount = leaves.Count(l => l.IsClosed);
        int openCount = leaves.Count - closedCount;
        double ring = leaves.Count > 0 ? (double)closedCount / leaves.Count : 0;
        double? hoursLeft = epicAvgCycleHours.HasValue ? openCount * epicAvgCycleHours.Value : null;

        var latestByNumber = relatedRows
            .Where(r => r.GithubNumber.HasValue)
            .GroupBy(r => r.GithubNumber!.Value)
            .Select(g => g.OrderByDescending(r => r.UpdatedAt).First())
            .ToList();

        var chips = new Dictionary<string, int>();
        foreach (var row in latestByNumber)
        {
            bool activelyBlocked = row.BlockedByNumber.HasValue && row.Status is "queued" or "running";
            string bucket = activelyBlocked ? "blocked" : row.Status switch
            {
                "queued" => "up next",
                "running" => "running",
                "verifying" => "verifying",
                "parked" => "parked",
                _ => ""
            };
            if (bucket.Length == 0) continue;
            chips[bucket] = chips.GetValueOrDefault(bucket) + 1;
        }
        if (paused && openCount > 0) chips["paused"] = openCount;

        var lastBuild = relatedRows.OrderByDescending(r => r.UpdatedAt).FirstOrDefault();

        return new GitEpicFeatureStats
        {
            ClosedCount = closedCount,
            OpenCount = openCount,
            RingFraction = ring,
            HoursLeft = hoursLeft,
            Chips = chips,
            LastBuild = lastBuild,
            IdleGap = lastBuild != null ? now - lastBuild.UpdatedAt : null,
            IsPaused = paused
        };
    }

    // ── parse helpers ────────────────────────────────────────────────────────────────────────

    private static GitEpicLeaf ParseLeaf(JsonElement el)
    {
        var (projItemId, _) = ReadProjectStatus(el);
        int number = el.GetProperty("number").GetInt32();
        return new GitEpicLeaf
        {
            Number = number,
            Title = el.TryGetProperty("title", out var t) ? t.GetString() ?? $"#{number}" : $"#{number}",
            IsClosed = IsClosedState(el),
            Labels = ReadLabels(el),
            CreatedAt = ReadDate(el, "createdAt"),
            ClosedAt = ReadDate(el, "closedAt"),
            ProjectItemId = projItemId
        };
    }

    private static bool IsClosedState(JsonElement el) =>
        el.TryGetProperty("state", out var s) && string.Equals(s.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase);

    private static List<string> ReadLabels(JsonElement el)
    {
        var labels = new List<string>();
        if (el.TryGetProperty("labels", out var labelsEl) && labelsEl.ValueKind == JsonValueKind.Object)
            foreach (var l in labelsEl.GetProperty("nodes").EnumerateArray())
                if (l.TryGetProperty("name", out var nameEl) && nameEl.GetString() is { Length: > 0 } name)
                    labels.Add(name);
        return labels;
    }

    private static DateTimeOffset? ReadDate(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var d) && d.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(d.GetString(), out var dt)
            ? dt : (DateTimeOffset?)null;

    private static (int? Number, string? Title, DateTimeOffset? DueOn) ReadMilestone(JsonElement issueEl)
    {
        if (!issueEl.TryGetProperty("milestone", out var msEl) || msEl.ValueKind != JsonValueKind.Object)
            return (null, null, null);
        int? number = msEl.TryGetProperty("number", out var n) ? n.GetInt32() : null;
        string? title = msEl.TryGetProperty("title", out var t) ? t.GetString() : null;
        DateTimeOffset? due = msEl.TryGetProperty("dueOn", out var d) && d.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(d.GetString(), out var dt)
            ? dt : (DateTimeOffset?)null;
        return (number, title, due);
    }

    /// <summary>Real ProjectV2Item id + real Status option name for THIS project
    /// (<see cref="ProjectId"/>) specifically — an issue can sit on more than one project board,
    /// so every projectItems node is checked and only the one whose own project id matches wins.</summary>
    private static (string? ItemId, string? StatusName) ReadProjectStatus(JsonElement issueEl)
    {
        if (!issueEl.TryGetProperty("projectItems", out var piEl) || piEl.ValueKind != JsonValueKind.Object)
            return (null, null);
        if (!piEl.TryGetProperty("nodes", out var nodesEl) || nodesEl.ValueKind != JsonValueKind.Array)
            return (null, null);
        foreach (var node in nodesEl.EnumerateArray())
        {
            if (!node.TryGetProperty("project", out var projEl) || projEl.ValueKind != JsonValueKind.Object) continue;
            if (!projEl.TryGetProperty("id", out var idEl) || idEl.GetString() != ProjectId) continue;
            string? itemId = node.TryGetProperty("id", out var iid) ? iid.GetString() : null;
            string? status = null;
            if (node.TryGetProperty("fieldValueByName", out var fvEl) && fvEl.ValueKind == JsonValueKind.Object &&
                fvEl.TryGetProperty("name", out var nameEl))
                status = nameEl.GetString();
            return (itemId, status);
        }
        return (null, null);
    }

    // ── gh process runner — mirrors GitPanelService/GitMapService's own local copy (kept local
    // for the same reason: this feature can't regress those already-shipped surfaces). ─────────
    private static Task<(bool Ok, string StdOut, string StdErr)> RunGhAsync(string[] args, int timeoutMs = 30000)
        => RunProcessAsync("gh", args, timeoutMs);

    private static async Task<(bool Ok, string StdOut, string StdErr)> RunProcessAsync(string fileName, string[] args, int timeoutMs)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        try
        {
            using var proc = new Process { StartInfo = psi };
            var sbOut = new StringBuilder();
            var sbErr = new StringBuilder();
            proc.OutputDataReceived += (_, e) => { if (e.Data != null) sbOut.AppendLine(e.Data); };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) sbErr.AppendLine(e.Data); };

            if (!proc.Start()) return (false, "", $"failed to start {fileName}");
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = new System.Threading.CancellationTokenSource(timeoutMs);
            try { await proc.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException)
            {
                try { proc.Kill(true); } catch { }
                return (false, sbOut.ToString(), $"{fileName} timed out after {timeoutMs}ms");
            }
            return (proc.ExitCode == 0, sbOut.ToString(), sbErr.ToString());
        }
        catch (Exception ex)
        {
            return (false, "", $"couldn't run {fileName}: {ex.Message}");
        }
    }

    private sealed class BlockedByRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
    }
}

/// <summary>Git #2307 — real, small, ShaneBuilder-owned store for per-feature Pause overrides
/// (see <see cref="GitEpicPanelService"/>'s header for why Pause can't live in bt_build_queue or
/// on the GitHub Project board). Table: <c>shanebuilder_feature_flags</c>, migration
/// <c>lib/db/migrations/manual/2026-09-02-shanebuilder-feature-flags-2307.sql</c>. This is a
/// genuine write path (unlike <see cref="QueueReadClient"/>/<see cref="BoardReadClient"/>'s
/// read-only contract) because ShaneBuilder is the sole, real owner of this one table.</summary>
public static class FeaturePauseStore
{
    public static async Task<Dictionary<int, bool>> GetPausedAsync(IEnumerable<int> featureNumbers, string connectionString)
    {
        var nums = featureNumbers.Distinct().ToArray();
        var result = new Dictionary<int, bool>();
        if (nums.Length == 0) return result;
        try
        {
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT feature_number, paused FROM shanebuilder_feature_flags WHERE feature_number = ANY(@nums)", conn);
            cmd.Parameters.AddWithValue("nums", nums);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                result[reader.GetInt32(0)] = reader.GetBoolean(1);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] pause read failed: {ex.Message}");
        }
        return result;
    }

    public static async Task<bool> SetPausedAsync(int featureNumber, bool paused, string connectionString, string? by = null)
    {
        try
        {
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                @"INSERT INTO shanebuilder_feature_flags (feature_number, paused, paused_at, paused_by, updated_at)
                  VALUES (@n, @p, CASE WHEN @p THEN now() ELSE NULL END, @by, now())
                  ON CONFLICT (feature_number) DO UPDATE SET
                      paused = @p, paused_at = CASE WHEN @p THEN now() ELSE NULL END,
                      paused_by = @by, updated_at = now()", conn);
            cmd.Parameters.AddWithValue("n", featureNumber);
            cmd.Parameters.AddWithValue("p", paused);
            cmd.Parameters.AddWithValue("by", (object?)by ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync();
            return true;
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] pause write failed for #{featureNumber}: {ex.Message}");
            return false;
        }
    }
}

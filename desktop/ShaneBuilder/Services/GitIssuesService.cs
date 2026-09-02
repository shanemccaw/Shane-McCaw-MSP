using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2203 — one real open issue for the Command Center's "Git Issues" category.
/// <see cref="ParentNumber"/>/<see cref="ParentTitle"/> come from a real GitHub GraphQL
/// <c>issue.parent</c> lookup (batched, see <see cref="GitIssuesService"/>), not a fabricated
/// epic tag — null means the issue genuinely has no sub-issue parent, not a lookup failure.</summary>
public sealed class GitIssueRow
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public string State { get; init; } = "open";
    public List<string> Labels { get; init; } = new();
    public int? ParentNumber { get; init; }
    public string? ParentTitle { get; init; }
}

/// <summary>Git #2203 — read-only data layer for the Command Center's "Git Issues" category.
/// Same real fail-closed `gh` shellout pattern <see cref="GitMapService"/> already established
/// (kept local rather than shared, same rationale as that class's own header comment) — never a
/// second data path, never an invented row.</summary>
public static class GitIssuesService
{
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    private const string Repo = "shanemccaw/Shane-McCaw-MSP";

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
    private static readonly System.Text.RegularExpressions.Regex FeatureTitlePrefix =
        new(@"^feature:\s*", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>Git #2321 — display helper, same real "strip the repo's own title-convention
    /// prefix" pattern GitMapService's own StripEpicTitlePrefix sibling uses for "Epic:".</summary>
    public static string StripFeatureTitlePrefix(string title) => FeatureTitlePrefix.Replace(title ?? "", "");

    /// <summary>Real, live open issues, most recently updated first, with real labels — then a
    /// single batched GraphQL call resolves each one's real parent (if any). Two calls total,
    /// never N+1.</summary>
    public static async Task<(bool Ok, List<GitIssueRow> Issues, string? Error)> GetRecentOpenIssuesAsync(int limit = 30)
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "issue", "list", "--repo", Repo, "--state", "open",
            "--json", "number,title,labels", "--limit", limit.ToString(),
            "--search", "sort:updated-desc"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] gh issue list failed: {stderr.Trim()}");
            return (false, new List<GitIssueRow>(), $"gh issue list failed: {stderr.Trim()}");
        }

        List<IssueRow> rows;
        try
        {
            rows = JsonSerializer.Deserialize<List<IssueRow>>(stdout, JsonOpts) ?? new();
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] couldn't parse gh output: {ex.Message}");
            return (false, new List<GitIssueRow>(), $"couldn't parse gh output: {ex.Message}");
        }

        var issues = rows.Select(r => new GitIssueRow
        {
            Number = r.Number,
            Title = r.Title ?? $"#{r.Number}",
            Labels = r.Labels?.Select(l => l.Name ?? "").Where(n => n.Length > 0).ToList() ?? new List<string>()
        }).ToList();

        return (true, await ResolveParentsAsync(issues), null);
    }

    /// <summary>One real GraphQL call with an alias per issue (<c>i0..iN</c>) resolving each
    /// issue's real <c>parent</c> sub-issue edge — the same relationship
    /// <see cref="GitMapService"/> reads the other direction (epic → features). A failed lookup
    /// leaves every row's parent honestly null rather than guessing.</summary>
    private static async Task<List<GitIssueRow>> ResolveParentsAsync(List<GitIssueRow> issues)
    {
        if (issues.Count == 0) return issues;

        var sb = new StringBuilder();
        sb.Append("query { repository(owner: \"").Append(Owner).Append("\", name: \"").Append(RepoName).Append("\") { ");
        for (int i = 0; i < issues.Count; i++)
            sb.Append($"i{i}: issue(number: {issues[i].Number}) {{ parent {{ number title }} }} ");
        sb.Append("} }");

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={sb}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] parent graphql lookup failed: {stderr.Trim()}");
            return issues; // honest — every ParentNumber stays null, not fabricated
        }

        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var repoEl = doc.RootElement.GetProperty("data").GetProperty("repository");
            var withParents = new List<GitIssueRow>(issues.Count);
            for (int i = 0; i < issues.Count; i++)
            {
                var issue = issues[i];
                int? parentNum = null;
                string? parentTitle = null;
                if (repoEl.TryGetProperty($"i{i}", out var issueEl) && issueEl.ValueKind == JsonValueKind.Object &&
                    issueEl.TryGetProperty("parent", out var parentEl) && parentEl.ValueKind == JsonValueKind.Object)
                {
                    if (parentEl.TryGetProperty("number", out var numEl)) parentNum = numEl.GetInt32();
                    if (parentEl.TryGetProperty("title", out var titleEl)) parentTitle = titleEl.GetString();
                }
                withParents.Add(new GitIssueRow
                {
                    Number = issue.Number,
                    Title = issue.Title,
                    State = issue.State,
                    Labels = issue.Labels,
                    ParentNumber = parentNum,
                    ParentTitle = parentTitle
                });
            }
            return withParents;
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] couldn't parse parent graphql response: {ex.Message}");
            return issues;
        }
    }

    /// <summary>Git #2319 — the real Feature-tier ancestor of one issue (a chat's EpicNumber
    /// anchor, currently), found by walking GitHub's own `parent` sub-issue edge up to 4 levels in
    /// a SINGLE nested GraphQL query (no N+1 — same real-parent edge <see cref="ResolveParentsAsync"/>
    /// already reads the other direction, batched). Stops at the first ancestor whose title genuinely
    /// starts with "Feature:"/"feature:" (the repo's own real naming convention — see
    /// <c>GitMapService.EpicTitlePrefix</c>'s sibling pattern for "Epic:"). Returns
    /// <c>(null, null)</c> when the issue genuinely has no Feature-tier ancestor within that depth —
    /// e.g. an Epic-tier anchor sitting at the top of the tree — or when the lookup itself fails;
    /// never guessed or fabricated.</summary>
    public static async Task<(int? Number, string? Title)> ResolveFeatureTierAncestorAsync(int issueNumber)
    {
        var query = "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { issue(number: " + issueNumber + ") { " +
            "parent { number title parent { number title parent { number title parent { number title } } } } } } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] feature-tier ancestor lookup failed for #{issueNumber}: {stderr.Trim()}");
            return (null, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var el = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            for (int depth = 0; depth < 4; depth++)
            {
                if (!el.TryGetProperty("parent", out el) || el.ValueKind != JsonValueKind.Object)
                    return (null, null); // real end of the chain — no Feature-tier ancestor found
                var title = el.TryGetProperty("title", out var titleEl) ? titleEl.GetString() : null;
                if (title != null && FeatureTitlePrefix.IsMatch(title))
                {
                    int number = el.TryGetProperty("number", out var numEl) ? numEl.GetInt32() : 0;
                    return (number, title);
                }
            }
            return (null, null); // walked 4 real levels, none were Feature-tier — honest null, not a guess
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] couldn't parse feature-tier ancestor response for #{issueNumber}: {ex.Message}");
            return (null, null);
        }
    }

    /// <summary>Git #2321 — every real open issue whose title genuinely starts with
    /// "Feature:"/"feature:" (<see cref="FeatureTitlePrefix"/>, the same real prefix-match
    /// convention <see cref="GitMapService.GetOpenEpicsAsync"/> already established for
    /// "Epic:" — never a fabricated registry, never full-text-search false positives like a
    /// title merely containing the word). Backs the New Chat anchor disclosure: each row needs
    /// its real parent Epic (<see cref="GitIssueRow.ParentNumber"/>/<see cref="GitIssueRow.ParentTitle"/>)
    /// and real state (labels — in-flight/blocked/complete, else plain open). Two real `gh` calls
    /// total (list + one batched parent GraphQL lookup, reusing <see cref="ResolveParentsAsync"/>),
    /// never N+1 per epic.</summary>
    public static async Task<(bool Ok, List<GitIssueRow> Features, string? Error)> GetActiveFeaturesAsync()
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "issue", "list", "--repo", Repo, "--state", "open",
            "--json", "number,title,labels", "--limit", "200",
            "--search", "Feature in:title"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] gh issue list (features) failed: {stderr.Trim()}");
            return (false, new List<GitIssueRow>(), $"gh issue list failed: {stderr.Trim()}");
        }

        List<IssueRow> rows;
        try
        {
            rows = JsonSerializer.Deserialize<List<IssueRow>>(stdout, JsonOpts) ?? new();
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-issues] couldn't parse gh output (features): {ex.Message}");
            return (false, new List<GitIssueRow>(), $"couldn't parse gh output: {ex.Message}");
        }

        var features = rows
            .Where(r => FeatureTitlePrefix.IsMatch(r.Title ?? ""))
            .Select(r => new GitIssueRow
            {
                Number = r.Number,
                Title = r.Title ?? $"#{r.Number}",
                Labels = r.Labels?.Select(l => l.Name ?? "").Where(n => n.Length > 0).ToList() ?? new List<string>()
            }).ToList();

        return (true, await ResolveParentsAsync(features), null);
    }

    // ── gh process runner — mirrors GitMapService's own local copy (kept local for the same
    // reason: this feature can't regress that one's already-shipped surface). ──────────────────
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

    private sealed class IssueRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("labels")] public List<LabelRow>? Labels { get; set; }
    }
    private sealed class LabelRow
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
    }
}

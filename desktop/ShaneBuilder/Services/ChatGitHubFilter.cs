using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2195 — one still-open (or closed) edge in a mentioned issue's dependency chain.
/// Matches <c>GitHubIssueResult</c>'s number/title/state trio used by BuildConsole's
/// <c>ChatDockService.WalkChainAsync</c>.</summary>
public readonly record struct GitHubEdgeResult(int Number, string Title, bool IsClosed);

/// <summary>Git #1600 fail-closed shape, ported from BuildConsole's
/// <c>GitHubIssuesService.LiveOpenIssuesResult</c>: <c>Success=false</c> means GitHub was
/// UNREACHABLE, never "nothing is open" — the caller must treat unknown as still-relevant.</summary>
public sealed class LiveOpenIssuesResult
{
    public bool Success { get; init; }
    public HashSet<int> OpenNumbers { get; init; } = new();
    public string? Error { get; init; }

    public static LiveOpenIssuesResult Ok(HashSet<int> openNumbers) => new() { Success = true, OpenNumbers = openNumbers };
    public static LiveOpenIssuesResult Failure(string error) => new() { Success = false, Error = error };
}

/// <summary>
/// Git #2197 — ShaneBuilder's live-GitHub filter for the chat dock read layer. This is the
/// ShaneBuilder-side port of the GitHub calls #2195's <c>ChatDockService</c> made through
/// BuildConsole's <c>GitHubIssuesService</c> + <c>GitHubApiClient</c>.
///
/// Real audit finding for #2197: ShaneBuilder has no <c>GitHubApiClient</c> / PAT-backed HttpClient
/// and no <c>BuildConsoleSettings</c>. Rather than port ~1,300 lines of PAT/HTTP plumbing, every call
/// here shells out to the <c>gh</c> CLI — which is exactly what BuildConsole's own
/// <c>GitHubIssuesService</c> already does for the open/title lookups, and which ShaneBuilder's
/// <see cref="GitDoctorService"/> already relies on for git/gh work. The two dependency reads
/// (<c>blocked_by</c>/<c>blocking</c>) and the board-status GraphQL that BuildConsole did via
/// HttpClient are reachable one-for-one through <c>gh api</c> / <c>gh api graphql</c> — verified live
/// against this repo before porting. No PAT stored in ShaneBuilder; <c>gh</c>'s own auth is reused.
/// </summary>
public sealed class ChatGitHubFilter
{
    private const string Repo = "shanemccaw/Shane-McCaw-MSP";
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    /// <summary>The AI/Batter-Up project board, same id BuildConsole's <c>GitHubApiClient</c> uses.</summary>
    private const string BatterUpProjectId = "PVT_kwHOEiBDdc4BeoiY";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // ── Open-issue-number set (one gh call, fail-closed) ─────────────────────────────────────
    /// <summary>Git #1600 — every currently-OPEN issue number, in one <c>gh issue list</c> call.
    /// <c>Success=false</c> means gh couldn't be reached/authed, and the caller treats every number
    /// as still-relevant rather than silently dropping it.</summary>
    public async Task<LiveOpenIssuesResult> TryGetOpenIssueNumbersAsync(int limit = 500)
    {
        var (ok, stdout, stderr) = await RunAsync("gh",
            new[] { "issue", "list", "--repo", Repo, "--state", "open", "--limit", limit.ToString(), "--json", "number" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] gh issue list (open numbers) failed: {stderr.Trim()}");
            return LiveOpenIssuesResult.Failure($"gh issue list failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<NumberRow>>(stdout, JsonOpts) ?? new();
            return LiveOpenIssuesResult.Ok(rows.Select(r => r.Number).ToHashSet());
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] couldn't parse gh open-numbers output: {ex.Message}");
            return LiveOpenIssuesResult.Failure($"couldn't parse gh output: {ex.Message}");
        }
    }

    // ── Issue title ──────────────────────────────────────────────────────────────────────────
    /// <summary>The real title for one issue, or null if it couldn't be fetched (the item stays in
    /// the actionable list either way — a missing title is not fatal, mirroring #2195's behavior).</summary>
    public async Task<string?> GetIssueTitleAsync(int number)
    {
        if (number <= 0) return null;
        var (ok, stdout, _) = await RunAsync("gh",
            new[] { "issue", "view", number.ToString(), "--repo", Repo, "--json", "title" });
        if (!ok) return null;
        try
        {
            var row = JsonSerializer.Deserialize<TitleRow>(stdout, JsonOpts);
            return string.IsNullOrWhiteSpace(row?.Title) ? null : row!.Title;
        }
        catch { return null; }
    }

    // ── Dependency edges (blocked_by / blocking) ─────────────────────────────────────────────
    /// <summary>Every issue THIS one declares as a <c>blocked_by</c> dependency (open AND closed),
    /// via <c>gh api .../dependencies/blocked_by</c> — the CLI equivalent of BuildConsole's
    /// <c>GitHubApiClient.GetBlockedByAsync</c>.</summary>
    public Task<List<GitHubEdgeResult>> GetBlockedByAsync(int number) => GetDependencyEdgesAsync(number, "blocked_by");

    /// <summary>The reverse direction (#2081): every issue that declares THIS one as its own
    /// <c>blocked_by</c>, i.e. what this issue blocks — via <c>gh api .../dependencies/blocking</c>.</summary>
    public Task<List<GitHubEdgeResult>> GetBlockingAsync(int number) => GetDependencyEdgesAsync(number, "blocking");

    private async Task<List<GitHubEdgeResult>> GetDependencyEdgesAsync(int number, string kind)
    {
        var edges = new List<GitHubEdgeResult>();
        if (number <= 0) return edges;

        // --jq trims GitHub's full issue objects down to the three fields the chain walk needs,
        // so a dock refresh isn't shuttling multi-KB payloads per hop.
        var (ok, stdout, _) = await RunAsync("gh",
            new[] { "api", $"repos/{Owner}/{RepoName}/issues/{number}/dependencies/{kind}", "--jq", "[.[]|{number,title,state}]" });
        if (!ok) return edges; // a 404 (no dependencies) or a transient failure — caller fails closed

        try
        {
            var rows = JsonSerializer.Deserialize<List<DependencyRow>>(stdout, JsonOpts) ?? new();
            foreach (var r in rows)
            {
                edges.Add(new GitHubEdgeResult(
                    r.Number,
                    r.Title ?? $"#{r.Number}",
                    string.Equals(r.State, "closed", StringComparison.OrdinalIgnoreCase)));
            }
        }
        catch { /* leave edges as-is; one bad hop can't abort the whole walk */ }
        return edges;
    }

    // ── Board status ─────────────────────────────────────────────────────────────────────────
    /// <summary>The real board "Status" column name (e.g. "Batter Up", "In Progress") for one issue,
    /// or null if it isn't on the board / the lookup failed. CLI port of BuildConsole's
    /// <c>GitHubApiClient.GetIssueBoardStatusAsync</c>, same GraphQL query and same
    /// <see cref="BatterUpProjectId"/> filter.</summary>
    public async Task<string?> GetBoardStatusAsync(int number)
    {
        if (number <= 0) return null;
        string query = $@"query {{
  repository(owner: ""{Owner}"", name: ""{RepoName}"") {{
    issue(number: {number}) {{
      projectItems(first: 20) {{
        nodes {{
          id
          project {{ id }}
          fieldValueByName(name: ""Status"") {{
            ... on ProjectV2ItemFieldSingleSelectValue {{ optionId name }}
          }}
        }}
      }}
    }}
  }}
}}";
        var (ok, stdout, _) = await RunAsync("gh", new[] { "api", "graphql", "-f", "query=" + query });
        if (!ok) return null;
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var nodes = doc.RootElement
                .GetProperty("data").GetProperty("repository").GetProperty("issue")
                .GetProperty("projectItems").GetProperty("nodes");
            foreach (var node in nodes.EnumerateArray())
            {
                if (!node.TryGetProperty("project", out var proj) ||
                    !proj.TryGetProperty("id", out var pid) ||
                    !string.Equals(pid.GetString(), BatterUpProjectId, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (node.TryGetProperty("fieldValueByName", out var fv) &&
                    fv.ValueKind == JsonValueKind.Object &&
                    fv.TryGetProperty("name", out var name))
                    return name.GetString();
            }
        }
        catch { /* board status is metadata-only; a parse miss is not fatal */ }
        return null;
    }

    /// <summary>Git #2410 — the real board Status for MANY issues in one <c>gh api graphql</c> call
    /// (aliased sub-queries, `i0:`/`i1:`/…), instead of one process spawn per number. Used by the
    /// Build Queue palette's refresh reconciliation so a queue with N locally-active rows doesn't
    /// spawn N `gh` subprocesses on every 30s cache refresh. A missing/failed entry maps to
    /// <c>null</c> (unknown — never treated by a caller as "confirmed Backlog"), same fail-open
    /// convention as the single-issue <see cref="GetBoardStatusAsync"/> above.</summary>
    public async Task<Dictionary<int, string?>> GetBoardStatusesAsync(IReadOnlyCollection<int> numbers)
    {
        var result = new Dictionary<int, string?>();
        var distinct = numbers.Where(n => n > 0).Distinct().ToList();
        if (distinct.Count == 0) return result;

        var sb = new StringBuilder("query {\n  repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") {\n");
        for (int i = 0; i < distinct.Count; i++)
        {
            sb.Append($@"    i{i}: issue(number: {distinct[i]}) {{
      number
      projectItems(first: 20) {{
        nodes {{
          project {{ id }}
          fieldValueByName(name: ""Status"") {{
            ... on ProjectV2ItemFieldSingleSelectValue {{ name }}
          }}
        }}
      }}
    }}
");
        }
        sb.Append("  }\n}");

        var (ok, stdout, _) = await RunAsync("gh", new[] { "api", "graphql", "-f", "query=" + sb });
        if (!ok)
        {
            foreach (var n in distinct) result[n] = null;
            return result;
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var repo = doc.RootElement.GetProperty("data").GetProperty("repository");
            for (int i = 0; i < distinct.Count; i++)
            {
                int number = distinct[i];
                result[number] = null;
                if (!repo.TryGetProperty($"i{i}", out var issueEl) || issueEl.ValueKind != JsonValueKind.Object)
                    continue;
                if (!issueEl.TryGetProperty("projectItems", out var pi) || !pi.TryGetProperty("nodes", out var nodes))
                    continue;
                foreach (var node in nodes.EnumerateArray())
                {
                    if (!node.TryGetProperty("project", out var proj) ||
                        !proj.TryGetProperty("id", out var pid) ||
                        !string.Equals(pid.GetString(), BatterUpProjectId, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (node.TryGetProperty("fieldValueByName", out var fv) &&
                        fv.ValueKind == JsonValueKind.Object &&
                        fv.TryGetProperty("name", out var name))
                    {
                        result[number] = name.GetString();
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[chat.dock] couldn't parse batched board-status output: {ex.Message}");
            foreach (var n in distinct) result[n] = null;
        }
        return result;
    }

    // ── gh process runner ────────────────────────────────────────────────────────────────────
    private static async Task<(bool Ok, string StdOut, string StdErr)> RunAsync(string fileName, string[] args, int timeoutMs = 30000)
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

            if (!proc.Start())
                return (false, "", "failed to start gh");
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = new System.Threading.CancellationTokenSource(timeoutMs);
            try
            {
                await proc.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                try { proc.Kill(true); } catch { }
                return (false, sbOut.ToString(), $"gh timed out after {timeoutMs}ms");
            }

            return (proc.ExitCode == 0, sbOut.ToString(), sbErr.ToString());
        }
        catch (Exception ex)
        {
            // gh not installed / not on PATH — treated as unreachable (fail closed), same as any hiccup.
            return (false, "", $"couldn't run gh: {ex.Message}");
        }
    }

    private sealed class NumberRow { [JsonPropertyName("number")] public int Number { get; set; } }
    private sealed class TitleRow { [JsonPropertyName("title")] public string? Title { get; set; } }
    private sealed class DependencyRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2214 §6.6 — the four real rule types, exactly as manually audited this session
/// against this repo's own board (parent-chain depth, Feature:/Epic: naming, dead-path references,
/// closed-parent/open-child orphans). No fifth rule is invented.</summary>
public enum RepoHealthRule { Depth, Naming, Stale, Orphan }

/// <summary>One real finding. <see cref="Evidence"/> is always the concrete proof — the depth chain,
/// the matched dead path, or the closed parent — never a generic "looks wrong" message, per this
/// project's evidence-in-the-body convention (see the GitHub-issue-filing rules in CLAUDE.md).</summary>
public sealed class RepoHealthFinding
{
    public required string Id { get; init; }
    public RepoHealthRule Rule { get; init; }
    public int Number { get; init; }
    public required string Title { get; init; }
    public required string Evidence { get; init; }

    /// <summary>Depth/Naming findings may be fixed directly (retitle, re-parent); a Stale reference
    /// must be reported, not silently closed out from under whoever relied on the dead path — the
    /// issue body's own closing-instruction distinction for the work order footer.</summary>
    public bool FixableDirectly => Rule is RepoHealthRule.Depth or RepoHealthRule.Naming;

    public string RuleLabel => Rule switch
    {
        RepoHealthRule.Depth => "Depth",
        RepoHealthRule.Naming => "Naming",
        RepoHealthRule.Stale => "Stale",
        RepoHealthRule.Orphan => "Orphan",
        _ => Rule.ToString(),
    };
}

public sealed class RepoHealthScan
{
    public DateTimeOffset ScanTime { get; init; } = DateTimeOffset.UtcNow;
    public List<RepoHealthFinding> Findings { get; init; } = new();
    public bool GitHubReachable { get; init; } = true;
    public string? GitHubError { get; init; }

    public int Count(RepoHealthRule rule) => Findings.Count(f => f.Rule == rule);
    public int Total => Findings.Count;

    public static RepoHealthScan Unreachable(string error) => new() { GitHubReachable = false, GitHubError = error };
}

/// <summary>
/// Git #2214 — Repo Health's real scanner. Reuses the exact patterns already proven and landed in
/// this codebase rather than re-deriving detection logic: the GraphQL shape (subIssuesSummary,
/// parent{...}) is BuildConsole's own <c>GitHubApiClient.ListBoardIssuesInternalAsync</c> query;
/// the gh-CLI shell-out (no PAT/HttpClient in ShaneBuilder) is <see cref="ChatGitHubFilter"/>'s own
/// established convention. No fixture data — every finding comes from a live `gh api graphql` call
/// against the real repo, or (Stale) a real check against files on this machine's own checkout.
/// </summary>
public sealed class RepoHealthService
{
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    private const int PageSize = 100;
    private const int MaxPages = 50; // 5,000 open issues of runway — the open set is far smaller than the full history GitHubApiClient paginates
    private const int DepthThreshold = 3; // > 3 ancestor levels is a Depth finding, per the issue body

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Matches a backtick-quoted, slash-containing path with a real extension — the shape
    /// issue bodies in this repo actually use for file references (e.g. `` `lib/db/migrations/manual/x.sql` ``).
    /// Deliberately conservative: no slash means "not obviously a repo path" and is left alone rather
    /// than risking a false Stale finding on an unrelated backtick-quoted word.</summary>
    private static readonly Regex PathReferenceRegex = new(@"`([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]+)`", RegexOptions.Compiled);

    private readonly string? _repoRoot;

    public RepoHealthService()
    {
        _repoRoot = FindRepoRoot(AppDomain.CurrentDomain.BaseDirectory) ?? FindRepoRoot(Environment.CurrentDirectory);
    }

    private static string? FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, ".git")) || File.Exists(Path.Combine(dir.FullName, ".git")))
                return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    public async Task<RepoHealthScan> RunScanAsync()
    {
        var issues = await FetchOpenIssuesAsync();
        if (issues == null)
            return RepoHealthScan.Unreachable("gh api graphql failed — see log for the real gh stderr");

        var findings = new List<RepoHealthFinding>();
        findings.AddRange(issues.SelectMany(EvaluateDepth));
        findings.AddRange(issues.Where(EvaluateNaming).Select(NamingFinding));
        findings.AddRange(issues.SelectMany(EvaluateStale));
        findings.AddRange(issues.Where(EvaluateOrphan).Select(OrphanFinding));

        return new RepoHealthScan { Findings = findings };
    }

    // ── Depth — parent-chain walk, exactly the technique proven by hand this session ──────────
    private IEnumerable<RepoHealthFinding> EvaluateDepth(RepoHealthIssueNode issue)
    {
        var chain = new List<RepoHealthIssueNode>();
        var cur = issue.Parent;
        while (cur != null)
        {
            chain.Add(cur);
            cur = cur.Parent;
        }
        if (chain.Count <= DepthThreshold) yield break;

        var chainText = string.Join(" ← ", new[] { $"#{issue.Number}" }.Concat(chain.Select(c => $"#{c.Number}")));
        yield return new RepoHealthFinding
        {
            Id = $"depth:{issue.Number}",
            Rule = RepoHealthRule.Depth,
            Number = issue.Number,
            Title = issue.Title,
            Evidence = $"{chain.Count} ancestor levels: {chainText}",
        };
    }

    // ── Naming — epic-shaped (has real sub-issues) but the title doesn't carry a recognized
    // container prefix. Real-audited against this repo's actual live titles (not assumed): both
    // "Epic:" (Git #1202) and "EPIC:" (Git #1096/#1095/#1485/#1571/#1093 — CLAUDE.md's own area-epic
    // routing table) are genuinely in active, correct use side by side, and "GATE:" (#1281) is a
    // third legitimate container prefix — an exact-case "Epic: " match alone produced dozens of
    // false positives against real epics on this board. A true violation is either "Feature: " on an
    // issue that has since grown real sub-issues (the exact "epic-shaped but wrong Feature: prefix"
    // case the issue body names), or no recognized prefix at all.
    private static readonly string[] ContainerPrefixes = { "epic:", "gate:" };

    private static bool EvaluateNaming(RepoHealthIssueNode issue) =>
        issue.SubIssueCount > 0 && !ContainerPrefixes.Any(p => issue.Title.TrimStart().StartsWith(p, StringComparison.OrdinalIgnoreCase));

    private static RepoHealthFinding NamingFinding(RepoHealthIssueNode issue)
    {
        var actual = issue.Title.Contains(':') ? issue.Title[..(issue.Title.IndexOf(':') + 1)].Trim() : "(no prefix)";
        return new RepoHealthFinding
        {
            Id = $"naming:{issue.Number}",
            Rule = RepoHealthRule.Naming,
            Number = issue.Number,
            Title = issue.Title,
            Evidence = $"{issue.SubIssueCount} real sub-issue(s) makes this epic-shaped, but its title prefix is \"{actual}\", not \"Epic:\"/\"EPIC:\"/\"GATE:\"",
        };
    }

    // ── Stale — a backtick-quoted path in the body that doesn't exist in this real checkout ─────
    private IEnumerable<RepoHealthFinding> EvaluateStale(RepoHealthIssueNode issue)
    {
        if (_repoRoot == null || string.IsNullOrEmpty(issue.Body)) yield break;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in PathReferenceRegex.Matches(issue.Body))
        {
            var relPath = m.Groups[1].Value;
            if (!seen.Add(relPath)) continue;
            var full = Path.Combine(_repoRoot, relPath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(full) || Directory.Exists(full)) continue;

            yield return new RepoHealthFinding
            {
                Id = $"stale:{issue.Number}:{relPath}",
                Rule = RepoHealthRule.Stale,
                Number = issue.Number,
                Title = issue.Title,
                Evidence = $"references `{relPath}`, which does not exist in this checkout",
            };
        }
    }

    // ── Orphan — this issue is open, but its direct parent is closed ───────────────────────────
    private static bool EvaluateOrphan(RepoHealthIssueNode issue) =>
        issue.Parent != null && string.Equals(issue.Parent.State, "CLOSED", StringComparison.OrdinalIgnoreCase);

    private static RepoHealthFinding OrphanFinding(RepoHealthIssueNode issue) => new()
    {
        Id = $"orphan:{issue.Number}",
        Rule = RepoHealthRule.Orphan,
        Number = issue.Number,
        Title = issue.Title,
        Evidence = $"parent #{issue.Parent!.Number} ({issue.Parent.Title}) is CLOSED, but this issue is still OPEN",
    };

    // ── GraphQL fetch — same subIssuesSummary/parent shape as GitHubApiClient.ListBoardIssuesInternalAsync,
    // shelled through `gh api graphql` per ChatGitHubFilter's established no-PAT convention ──────────
    private async Task<List<RepoHealthIssueNode>?> FetchOpenIssuesAsync()
    {
        var result = new List<RepoHealthIssueNode>();
        string? after = null;

        for (int page = 0; page < MaxPages; page++)
        {
            string afterArg = after == null ? "null" : $"\"{after}\"";
            string query = $@"query {{
  repository(owner: ""{Owner}"", name: ""{RepoName}"") {{
    issues(first: {PageSize}, after: {afterArg}, states: [OPEN], orderBy: {{field: CREATED_AT, direction: DESC}}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{
        number title state body
        subIssuesSummary {{ total }}
        parent {{
          number title state
          parent {{
            number title state
            parent {{
              number title state
              parent {{ number title state }}
            }}
          }}
        }}
      }}
    }}
  }}
}}";
            var (ok, stdout, stderr) = await RunAsync("gh", new[] { "api", "graphql", "-f", "query=" + query });
            if (!ok)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[repo.health] gh api graphql failed: {stderr.Trim()}");
                return page == 0 ? null : result; // fail closed only if we got NOTHING at all
            }

            RepoHealthGraphQlResponse? parsed;
            try { parsed = JsonSerializer.Deserialize<RepoHealthGraphQlResponse>(stdout, JsonOpts); }
            catch (Exception ex)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[repo.health] couldn't parse gh graphql output: {ex.Message}");
                return page == 0 ? null : result;
            }

            var conn = parsed?.Data?.Repository?.Issues;
            if (conn?.Nodes == null) break;

            foreach (var n in conn.Nodes)
            {
                result.Add(new RepoHealthIssueNode
                {
                    Number = n.Number,
                    Title = n.Title ?? "",
                    State = n.State ?? "OPEN",
                    Body = n.Body ?? "",
                    SubIssueCount = n.SubIssuesSummary?.Total ?? 0,
                    Parent = ToNode(n.Parent),
                });
            }

            if (conn.PageInfo?.HasNextPage != true) break;
            after = conn.PageInfo.EndCursor;
        }

        return result;
    }

    private static RepoHealthIssueNode? ToNode(RepoHealthParentRow? row)
    {
        if (row == null) return null;
        return new RepoHealthIssueNode
        {
            Number = row.Number,
            Title = row.Title ?? "",
            State = row.State ?? "OPEN",
            Body = "",
            SubIssueCount = 0,
            Parent = ToNode(row.Parent),
        };
    }

    private static async Task<(bool Ok, string StdOut, string StdErr)> RunAsync(string fileName, string[] args, int timeoutMs = 45000)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        try
        {
            using var proc = new System.Diagnostics.Process { StartInfo = psi };
            var sbOut = new System.Text.StringBuilder();
            var sbErr = new System.Text.StringBuilder();
            proc.OutputDataReceived += (_, e) => { if (e.Data != null) sbOut.AppendLine(e.Data); };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) sbErr.AppendLine(e.Data); };

            if (!proc.Start()) return (false, "", "failed to start gh");
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = new System.Threading.CancellationTokenSource(timeoutMs);
            try { await proc.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException)
            {
                try { proc.Kill(true); } catch { }
                return (false, sbOut.ToString(), $"gh timed out after {timeoutMs}ms");
            }

            return (proc.ExitCode == 0, sbOut.ToString(), sbErr.ToString());
        }
        catch (Exception ex)
        {
            return (false, "", $"couldn't run gh: {ex.Message}");
        }
    }

    // ── wire shapes for gh api graphql's raw JSON ───────────────────────────────────────────────
    private sealed class RepoHealthIssueNode
    {
        public int Number { get; init; }
        public required string Title { get; init; }
        public required string State { get; init; }
        public required string Body { get; init; }
        public int SubIssueCount { get; init; }
        public RepoHealthIssueNode? Parent { get; init; }
    }

    private sealed class RepoHealthGraphQlResponse { [JsonPropertyName("data")] public RepoHealthGraphQlData? Data { get; set; } }
    private sealed class RepoHealthGraphQlData { [JsonPropertyName("repository")] public RepoHealthGraphQlRepo? Repository { get; set; } }
    private sealed class RepoHealthGraphQlRepo { [JsonPropertyName("issues")] public RepoHealthIssuesConnection? Issues { get; set; } }
    private sealed class RepoHealthIssuesConnection
    {
        [JsonPropertyName("pageInfo")] public RepoHealthPageInfo? PageInfo { get; set; }
        [JsonPropertyName("nodes")] public List<RepoHealthIssueRow>? Nodes { get; set; }
    }
    private sealed class RepoHealthPageInfo
    {
        [JsonPropertyName("hasNextPage")] public bool HasNextPage { get; set; }
        [JsonPropertyName("endCursor")] public string? EndCursor { get; set; }
    }
    private sealed class RepoHealthIssueRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("body")] public string? Body { get; set; }
        [JsonPropertyName("subIssuesSummary")] public RepoHealthSubIssuesSummary? SubIssuesSummary { get; set; }
        [JsonPropertyName("parent")] public RepoHealthParentRow? Parent { get; set; }
    }
    private sealed class RepoHealthSubIssuesSummary { [JsonPropertyName("total")] public int Total { get; set; } }
    private sealed class RepoHealthParentRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("parent")] public RepoHealthParentRow? Parent { get; set; }
    }
}

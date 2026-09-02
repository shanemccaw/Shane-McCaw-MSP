using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>Git #2201 — one open, <c>blocked</c>-labelled issue, for the Alerts/Critters GitHub
/// watcher's "Issue blocked" alert/whammy.</summary>
public sealed record BlockedIssue(int Number, string Title);

/// <summary>Git #2235 — one closed milestone, for the tier-4 "Milestone Closed" mega-celebration
/// watcher.</summary>
public sealed record ClosedMilestone(int Number, string Title);

/// <summary>
/// Git #2176 — ShaneBuilder's real, read-only GitHub API client for app-shell startup
/// connectivity. Same real REST endpoint/auth shape as BuildConsole's
/// <c>Services/GitHubApiClient.cs</c> (Bearer PAT, <c>api.github.com</c>, the
/// <c>application/vnd.github+json</c> accept header) — not a reimplementation of that
/// whole client (Git Board/Batter Up/GraphQL are out of scope here), just its
/// connection shape, reused for one real call: the live open-issue count.
/// </summary>
public sealed class GitHubReadClient
{
    private const string Owner = "shanemccaw";
    private const string Repo = "Shane-McCaw-MSP";

    private readonly HttpClient _http;

    public GitHubReadClient(string pat)
    {
        _http = new HttpClient { BaseAddress = new Uri("https://api.github.com/"), Timeout = TimeSpan.FromSeconds(15) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", pat);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("ShaneBuilder");
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    /// <summary>Null means no real PAT was resolvable anywhere — callers report that honestly
    /// (e.g. "no PAT") rather than faking a count.</summary>
    public static GitHubReadClient? CreateFromEnvironment()
    {
        var pat = ResolvePat();
        return string.IsNullOrWhiteSpace(pat) ? null : new GitHubReadClient(pat!);
    }

    // ── PAT resolution ───────────────────────────────────────────────────────────────────────
    // 1. BuildConsole's own %AppData%\BuildConsole\settings.json "GitHubPat" field — the exact
    //    real credential store BuildConsole's `new GitHubApiClient(settings.GitHubPat)` call
    //    sites already populate and read, on this same machine.
    // 2. GIT_PAT= in the main repo's .env.local — the same real fallback credential CLAUDE.md's
    //    memory documents for GitHub MCP 403s (`github-mcp-403-use-gh-cli-or-git-pat`).
    private static string? ResolvePat()
    {
        try
        {
            var settingsPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "BuildConsole", "settings.json");
            if (File.Exists(settingsPath))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(settingsPath));
                if (doc.RootElement.TryGetProperty("GitHubPat", out var patEl))
                {
                    var pat = patEl.GetString();
                    if (!string.IsNullOrWhiteSpace(pat)) return pat;
                }
            }
        }
        catch { /* fall through to .env.local */ }

        try
        {
            var repoRoot = new LogService().MainRepoRoot;
            if (!string.IsNullOrEmpty(repoRoot))
            {
                var envLocal = Path.Combine(repoRoot, ".env.local");
                if (File.Exists(envLocal))
                {
                    foreach (var raw in File.ReadAllLines(envLocal))
                    {
                        var trimmed = raw.Trim();
                        if (trimmed.StartsWith('#') || !trimmed.StartsWith("GIT_PAT=", StringComparison.OrdinalIgnoreCase))
                            continue;
                        var pat = trimmed.Substring("GIT_PAT=".Length).Trim().Trim('"').Trim('\'');
                        if (!string.IsNullOrWhiteSpace(pat)) return pat;
                    }
                }
            }
        }
        catch { /* no PAT resolvable anywhere */ }

        return null;
    }

    private sealed class SearchResponse
    {
        [JsonPropertyName("total_count")]
        public int TotalCount { get; set; }
        [JsonPropertyName("items")]
        public List<SearchItem>? Items { get; set; }
    }

    private sealed class SearchItem
    {
        [JsonPropertyName("number")]
        public int Number { get; set; }
        [JsonPropertyName("title")]
        public string Title { get; set; } = "";
    }

    private sealed class MilestoneItem
    {
        [JsonPropertyName("number")]
        public int Number { get; set; }
        [JsonPropertyName("title")]
        public string Title { get; set; } = "";
        [JsonPropertyName("state")]
        public string State { get; set; } = "";
    }

    /// <summary>Real, live open-issue count for shanemccaw/Shane-McCaw-MSP via GitHub's real
    /// Search Issues API — one live network call, no cache, no fixture.</summary>
    public async Task<int> GetOpenIssueCountAsync()
    {
        string q = Uri.EscapeDataString($"repo:{Owner}/{Repo} is:issue is:open");
        var res = await _http.GetFromJsonAsync<SearchResponse>($"search/issues?q={q}");
        return res?.TotalCount ?? 0;
    }

    /// <summary>Git #2201 — every open issue carrying the real <c>blocked</c> label (CLAUDE.md's own
    /// "blocked" label convention), for the Alerts/Critters "Issue blocked" watcher. Live search, no
    /// cache — same shape as <see cref="GetOpenIssueCountAsync"/>.</summary>
    public async Task<List<BlockedIssue>> GetBlockedOpenIssuesAsync()
    {
        string q = Uri.EscapeDataString($"repo:{Owner}/{Repo} is:issue is:open label:blocked");
        var res = await _http.GetFromJsonAsync<SearchResponse>($"search/issues?q={q}&per_page=30");
        var list = new List<BlockedIssue>();
        if (res?.Items == null) return list;
        foreach (var item in res.Items) list.Add(new BlockedIssue(item.Number, item.Title));
        return list;
    }

    /// <summary>Git #2235 — every closed milestone on the real repo, for the tier-4 "Milestone
    /// Closed" mega-celebration watcher. Live REST call (not Search), no cache — same real
    /// connection shape as the calls above.</summary>
    public async Task<List<ClosedMilestone>> GetClosedMilestonesAsync()
    {
        var res = await _http.GetFromJsonAsync<List<MilestoneItem>>(
            $"repos/{Owner}/{Repo}/milestones?state=closed&per_page=30&sort=due_on&direction=desc");
        var list = new List<ClosedMilestone>();
        if (res == null) return list;
        foreach (var item in res) list.Add(new ClosedMilestone(item.Number, item.Title));
        return list;
    }
}

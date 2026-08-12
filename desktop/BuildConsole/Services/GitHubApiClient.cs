using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public class GitHubLabel
    {
        public string Name { get; set; } = "";
    }

    /// <summary>Matches enough of GitHub's real issue/search-result shape for the Git Board search box (Git #834).</summary>
    public class GitHubIssueResult
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string State { get; set; } = "";
        public List<GitHubLabel> Labels { get; set; } = new();
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";

        public bool IsClosed => string.Equals(State, "closed", StringComparison.OrdinalIgnoreCase);
        public bool HasInFlightLabel => Labels.Any(l => string.Equals(l.Name, "in-flight", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Git #834 — Shane: "I should be able to put in the Git number or title
    /// and it searches everything in Git... clearly finds even the closed
    /// ones." Talks directly to GitHub's REST API (not api-server — Shane
    /// confirmed a direct call) using the PAT from BuildConsoleSettings, so
    /// the Git Board search box isn't limited to whatever's currently in the
    /// live build queue (GET /extension/in-progress, which only ever returns
    /// in-flight items).
    /// </summary>
    public class GitHubApiClient
    {
        private const string Owner = "shanemccaw";
        private const string Repo = "Shane-McCaw-MSP";

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        private readonly HttpClient _http;

        public GitHubApiClient(string pat)
        {
            _http = new HttpClient { BaseAddress = new Uri("https://api.github.com/"), Timeout = TimeSpan.FromSeconds(20) };
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", pat);
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("BuildConsole");
            _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        }

        /// <summary>
        /// Number-aware: a purely numeric query (optionally prefixed with #)
        /// hits the single-issue endpoint directly, since GitHub's search API
        /// has no `in:number` qualifier to search by issue number. Anything
        /// else falls back to the real Search Issues API with `state:all` so
        /// closed issues come back too.
        /// </summary>
        public async Task<List<GitHubIssueResult>> SearchIssuesAsync(string query)
        {
            query = query.Trim();
            if (query.StartsWith("#")) query = query.Substring(1);

            if (int.TryParse(query, out var number))
            {
                try
                {
                    var single = await _http.GetFromJsonAsync<GitHubIssueResult>(
                        $"repos/{Owner}/{Repo}/issues/{number}", JsonOpts);
                    return single != null ? new List<GitHubIssueResult> { single } : new List<GitHubIssueResult>();
                }
                catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
                {
                    return new List<GitHubIssueResult>();
                }
            }

            string q = Uri.EscapeDataString($"repo:{Owner}/{Repo} {query} state:all");
            var res = await _http.GetFromJsonAsync<GitHubSearchResponse>($"search/issues?q={q}", JsonOpts);
            return res?.Items ?? new List<GitHubIssueResult>();
        }

        /// <summary>Real "blocked" state — a still-OPEN blocked_by relationship, the same GitHub issue-dependency link CLAUDE.md's blocked-label workflow sets/clears.</summary>
        public async Task<bool> HasOpenBlockedByAsync(int number)
        {
            try
            {
                var blockers = await _http.GetFromJsonAsync<List<GitHubIssueResult>>(
                    $"repos/{Owner}/{Repo}/issues/{number}/dependencies/blocked_by", JsonOpts);
                return blockers?.Any(b => !b.IsClosed) ?? false;
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return false;
            }
        }

        private class GitHubSearchResponse
        {
            public List<GitHubIssueResult> Items { get; set; } = new();
        }
    }
}

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

    /// <summary>Git #842 (Git Board Phase 4) — the fields of `POST /issues`'s response actually used: the new issue's number/url plus its numeric `id` for a follow-up `sub_issues` attach call.</summary>
    public class CreatedIssue
    {
        public int Number { get; set; }
        public long Id { get; set; }
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";
    }

    public enum GitHubIssueState { Open, Closed, All }

    /// <summary>
    /// Git #839 (Git Board Phase 1) — the real, reusable Git Board data model
    /// the later phases (#840-#845) consume. Every field comes from GitHub's
    /// actual GraphQL issue, never derived from a label:
    ///   • <see cref="State"/> is the real "OPEN"/"CLOSED" issue state.
    ///   • <see cref="IsEpic"/> is true iff the issue has at least one real
    ///     sub-issue (<see cref="SubIssueCount"/> &gt; 0) — full stop, no
    ///     "EPIC:" title-text convention.
    ///   • <see cref="MilestoneTitle"/> is the real GitHub Milestone feature.
    /// </summary>
    public class GitBoardIssue
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        /// <summary>Real GitHub issue state — "OPEN" or "CLOSED" (GraphQL IssueState), never a label.</summary>
        public string State { get; set; } = "OPEN";
        public List<GitHubLabel> Labels { get; set; } = new();
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";
        public string Body { get; set; } = "";
        /// <summary>The issue's real GitHub Milestone title, or null when it belongs to no milestone.</summary>
        public string? MilestoneTitle { get; set; }
        public int? MilestoneNumber { get; set; }
        /// <summary>subIssuesSummary.total straight from GraphQL — the real number of sub-issues.</summary>
        public int SubIssueCount { get; set; }

        /// <summary>Any issue with at least one sub-issue IS an Epic (Git #839) — no title-text convention.</summary>
        public bool IsEpic => SubIssueCount > 0;
        public bool IsClosed => string.Equals(State, "CLOSED", StringComparison.OrdinalIgnoreCase);
        public bool IsTodo => Labels.Any(l => string.Equals(l.Name, "Shane To-Do", StringComparison.OrdinalIgnoreCase));
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

        /// <summary>Git #843 (Git Board Phase 5) — real `PATCH /issues/{n}` via the REST API, same PAT/HttpClient as every other direct GitHub call here.</summary>
        public async Task UpdateIssueAsync(int number, string title, string body)
        {
            using var req = new HttpRequestMessage(HttpMethod.Patch, $"repos/{Owner}/{Repo}/issues/{number}")
            {
                Content = JsonContent.Create(new { title, body }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();
        }

        /// <summary>Git #841 (Git Board Phase 3) — real `PATCH /issues/{n}` with `state`, so Close/Reopen flips GitHub's actual issue state rather than the `complete` label.</summary>
        public async Task SetIssueStateAsync(int number, bool close)
        {
            using var req = new HttpRequestMessage(HttpMethod.Patch, $"repos/{Owner}/{Repo}/issues/{number}")
            {
                Content = JsonContent.Create(new { state = close ? "closed" : "open" }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();
        }

        /// <summary>
        /// Git #842 (Git Board Phase 4) — real `POST /issues`, the same
        /// endpoint/shape `exception-github-sync.ts`'s createGithubIssue uses.
        /// The response's numeric `id` is what <see cref="AddSubIssueAsync"/>
        /// wants as `sub_issue_id` to attach the new issue under an epic.
        /// </summary>
        public async Task<CreatedIssue> CreateIssueAsync(string title, string body)
        {
            var res = await _http.PostAsJsonAsync($"repos/{Owner}/{Repo}/issues", new { title, body });
            if (!res.IsSuccessStatusCode)
            {
                var errBody = await res.Content.ReadAsStringAsync();
                throw new Exception($"GitHub rejected issue creation ({(int)res.StatusCode}): {errBody}");
            }
            var created = await res.Content.ReadFromJsonAsync<CreatedIssue>(JsonOpts);
            if (created == null) throw new Exception("GitHub returned an empty response for the created issue.");
            return created;
        }

        /// <summary>
        /// Git #842 (Git Board Phase 4) — real `POST /issues/{parent}/sub_issues`,
        /// the same endpoint `exception-github-sync.ts`'s createGithubIssue
        /// already uses to attach a freshly-filed issue under Epic #530.
        /// GitHub wants the child's numeric database id here, not its number.
        /// </summary>
        public async Task AddSubIssueAsync(int parentNumber, long subIssueId)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"repos/{Owner}/{Repo}/issues/{parentNumber}/sub_issues")
            {
                Content = JsonContent.Create(new { sub_issue_id = subIssueId }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();
        }

        // ── Git #839: real Git Board data via GraphQL ───────────────────────
        private const int PageSize = 100;
        private const int MaxPages = 10; // runaway guard (up to 1000 issues per state)

        /// <summary>
        /// Git #839 (Git Board Phase 1) — lists the repo's real issues for the
        /// given <paramref name="state"/> via a single GraphQL query per page,
        /// pulling <c>subIssuesSummary {{ total }}</c> back in the same request
        /// so epic detection needs no N+1 REST follow-ups. The default Git
        /// Board asks for <see cref="GitHubIssueState.Open"/>; the 🟢 Done chip
        /// asks for <see cref="GitHubIssueState.Closed"/>.
        /// </summary>
        public Task<List<GitBoardIssue>> ListBoardIssuesAsync(GitHubIssueState state)
        {
            string states = state switch
            {
                GitHubIssueState.Open => "[OPEN]",
                GitHubIssueState.Closed => "[CLOSED]",
                _ => "[OPEN, CLOSED]",
            };
            return ListBoardIssuesInternalAsync(states);
        }

        private async Task<List<GitBoardIssue>> ListBoardIssuesInternalAsync(string statesLiteral)
        {
            var result = new List<GitBoardIssue>();
            string? after = null;

            for (int page = 0; page < MaxPages; page++)
            {
                string afterArg = after == null ? "null" : $"\"{after}\"";
                string query = $@"query {{
  repository(owner: ""{Owner}"", name: ""{Repo}"") {{
    issues(first: {PageSize}, after: {afterArg}, states: {statesLiteral}, orderBy: {{field: CREATED_AT, direction: DESC}}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{
        number title state url body
        labels(first: 20) {{ nodes {{ name }} }}
        milestone {{ title number }}
        subIssuesSummary {{ total }}
      }}
    }}
  }}
}}";

                var conn = await PostGraphQLIssuesAsync(query);
                if (conn?.Nodes != null)
                {
                    foreach (var n in conn.Nodes)
                    {
                        result.Add(new GitBoardIssue
                        {
                            Number = n.Number,
                            Title = n.Title ?? "",
                            State = n.State ?? "OPEN",
                            HtmlUrl = n.Url ?? "",
                            Body = n.Body ?? "",
                            Labels = n.Labels?.Nodes?.Select(l => new GitHubLabel { Name = l.Name }).ToList() ?? new List<GitHubLabel>(),
                            MilestoneTitle = n.Milestone?.Title,
                            MilestoneNumber = n.Milestone?.Number,
                            SubIssueCount = n.SubIssuesSummary?.Total ?? 0,
                        });
                    }
                }

                bool more = conn?.PageInfo?.HasNextPage == true && !string.IsNullOrEmpty(conn.PageInfo.EndCursor);
                if (more && page == MaxPages - 1)
                    ActivityLog.Log("git-board.data", $"issue list truncated at {result.Count} ({MaxPages} pages) — more exist for states {statesLiteral}");
                if (!more) break;
                after = conn!.PageInfo!.EndCursor;
            }

            return result;
        }

        private async Task<IssueConnection?> PostGraphQLIssuesAsync(string query)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "graphql")
            {
                Content = JsonContent.Create(new { query }),
            };
            // sub_issues went GA in 2025; the preview header is harmlessly ignored now, kept for older GHES.
            req.Headers.Add("GraphQL-Features", "sub_issues");

            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();

            var body = await res.Content.ReadFromJsonAsync<GraphQLIssuesResponse>(JsonOpts);
            if (body?.Errors is { Count: > 0 } errs)
                throw new Exception("GitHub GraphQL: " + string.Join("; ", errs.Select(e => e.Message)));
            return body?.Data?.Repository?.Issues;
        }

        private class GraphQLIssuesResponse
        {
            public IssuesData? Data { get; set; }
            public List<GraphQLError>? Errors { get; set; }
        }
        private class GraphQLError { public string Message { get; set; } = ""; }
        private class IssuesData { public RepositoryData? Repository { get; set; } }
        private class RepositoryData { public IssueConnection? Issues { get; set; } }
        private class IssueConnection
        {
            public PageInfoData? PageInfo { get; set; }
            public List<IssueNodeData> Nodes { get; set; } = new();
        }
        private class PageInfoData
        {
            public bool HasNextPage { get; set; }
            public string? EndCursor { get; set; }
        }
        private class IssueNodeData
        {
            public int Number { get; set; }
            public string? Title { get; set; }
            public string? State { get; set; }
            public string? Url { get; set; }
            public string? Body { get; set; }
            public LabelConnection? Labels { get; set; }
            public MilestoneData? Milestone { get; set; }
            public SubIssuesSummaryData? SubIssuesSummary { get; set; }
        }
        private class LabelConnection { public List<LabelNode> Nodes { get; set; } = new(); }
        private class LabelNode { public string Name { get; set; } = ""; }
        private class MilestoneData { public string? Title { get; set; } public int? Number { get; set; } }
        private class SubIssuesSummaryData { public int Total { get; set; } }
    }
}

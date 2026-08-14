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

    /// <summary>Git #840 (Git Board Phase 2) — the real `GET /issues/{n}` response shape for the issue detail panel (title/body/state, not the search-result subset).</summary>
    public class GitHubIssueDetail
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string Body { get; set; } = "";
        public string State { get; set; } = "";
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";
        [JsonPropertyName("created_at")]
        public DateTimeOffset CreatedAt { get; set; }
        public GitHubUser? User { get; set; }
        public List<GitHubLabel> Labels { get; set; } = new();
    }

    /// <summary>Git #840 (Git Board Phase 2) — one entry from `GET /issues/{n}/comments`.</summary>
    public class GitHubIssueComment
    {
        public string Body { get; set; } = "";
        [JsonPropertyName("created_at")]
        public DateTimeOffset CreatedAt { get; set; }
        public GitHubUser? User { get; set; }
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";
    }

    public class GitHubUser
    {
        public string Login { get; set; } = "";
    }

    /// <summary>Git #910 — one entry from `GET /issues/{n}/sub_issues`, the real GitHub sub-issues API (same family the existing `POST .../sub_issues` "Assign to Epic" call already uses).</summary>
    public class GitHubSubIssue
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string State { get; set; } = "";
        [JsonPropertyName("html_url")]
        public string HtmlUrl { get; set; } = "";
    }

    /// <summary>Git #842 (Git Board Phase 4) — the fields of `POST /issues`'s response actually used: the new issue's number/url plus its numeric `id` for the `sub_issues` attach call.</summary>
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
        /// <summary>GraphQL databaseId — the numeric REST id GitHub's sub_issues endpoint wants as `sub_issue_id` (NOT the issue Number). Populated by ListBoardIssuesAsync for Git #844.</summary>
        public long DatabaseId { get; set; }

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

        // ── Git #876 (reopened): conditional requests (ETag) + traffic telemetry ─
        // Shane: "heavy GitHub API traffic for no reason" / repeatedly crossing
        // GitHub's 5,000/hour REST limit. A GitHubApiClient is constructed fresh
        // on nearly every call across the app (LeftSidebar/BuildQueuePanel
        // `new GitHubApiClient(pat)` per poll), so this cache and these counters
        // MUST be static to survive between polls — it's all one repo/account, so
        // sharing across instances is safe. On a repeat GET we replay the last
        // resource's ETag as `If-None-Match`; when nothing changed GitHub answers
        // `304 Not Modified` and — per GitHub's documented behaviour — that 304
        // does NOT count against the primary rate limit, so an unchanged poll is
        // now free. GraphQL (ListBoardIssuesAsync) can't do this — it's POST and
        // uses a separate points budget — but the per-issue blocked_by sweep and
        // the milestones read (the two real REST rate-limit consumers here) can.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, CachedGet> _conditionalCache = new();
        private sealed class CachedGet { public EntityTagHeaderValue ETag = null!; public object? Value; }

        private static long _restGetTotal;  // REST GETs actually sent this session
        private static long _restGet304;    // of those, rate-limit-free 304s

        /// <summary>Git #876 — running REST GET totals this session: how many GETs went to the wire and how many came back 304 Not Modified (which GitHub does NOT count against the 5,000/hr limit). Lets the Git Board log its real before/after call frequency.</summary>
        public static (long Sent, long NotModified) RestGetStats =>
            (System.Threading.Interlocked.Read(ref _restGetTotal), System.Threading.Interlocked.Read(ref _restGet304));

        /// <summary>Git #876 — one activity-log line summarizing REST GET traffic and the rate-limit-free 304 share so the reduction is actually visible in the feed.</summary>
        public static void LogRestTrafficSummary(string context)
        {
            var (sent, notMod) = RestGetStats;
            long counted = sent - notMod;
            int pct = sent == 0 ? 0 : (int)Math.Round(100.0 * notMod / sent);
            ActivityLog.Log("git-board.traffic",
                $"{context}: REST GETs this session={sent}, of which 304-not-modified={notMod} ({pct}% rate-limit-free); ~{counted} actually counted against GitHub's 5,000/hr limit.");
        }

        /// <summary>
        /// Git #876 — conditional GET: replays this path's last ETag as
        /// `If-None-Match` so an unchanged resource comes back 304 (free of the
        /// rate limit) and we return the cached body. Any non-304 response still
        /// goes through <see cref="HttpResponseMessage.EnsureSuccessStatusCode"/>,
        /// so callers' existing 404 catches (blocked_by / sub_issues / single
        /// issue) keep working exactly as before.
        /// </summary>
        private async Task<T?> GetConditionalAsync<T>(string path) where T : class
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, path);
            if (_conditionalCache.TryGetValue(path, out var cached))
                req.Headers.IfNoneMatch.Add(cached.ETag);

            var res = await _http.SendAsync(req);
            System.Threading.Interlocked.Increment(ref _restGetTotal);

            if (res.StatusCode == HttpStatusCode.NotModified && cached != null)
            {
                System.Threading.Interlocked.Increment(ref _restGet304);
                return (T?)cached.Value;
            }

            res.EnsureSuccessStatusCode();
            var value = await res.Content.ReadFromJsonAsync<T>(JsonOpts);
            if (res.Headers.ETag is { } etag)
                _conditionalCache[path] = new CachedGet { ETag = etag, Value = value };
            return value;
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
                    var single = await GetConditionalAsync<GitHubIssueResult>(
                        $"repos/{Owner}/{Repo}/issues/{number}");
                    return single != null ? new List<GitHubIssueResult> { single } : new List<GitHubIssueResult>();
                }
                catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
                {
                    return new List<GitHubIssueResult>();
                }
            }

            string q = Uri.EscapeDataString($"repo:{Owner}/{Repo} {query} state:all");
            var res = await GetConditionalAsync<GitHubSearchResponse>($"search/issues?q={q}");
            return res?.Items ?? new List<GitHubIssueResult>();
        }

        /// <summary>Real "blocked" state — a still-OPEN blocked_by relationship, the same GitHub issue-dependency link CLAUDE.md's blocked-label workflow sets/clears.</summary>
        public async Task<bool> HasOpenBlockedByAsync(int number) => await GetOpenBlockedByAsync(number) != null;

        /// <summary>
        /// Git #845 (Git Board Phase 7) — same GitHub issue-dependency read as
        /// <see cref="HasOpenBlockedByAsync"/>, but returns the real still-OPEN
        /// blocker's number/title/state instead of just a bool, so the Git
        /// Board tree can show "Blocked by #N: Title" rather than a bare flag.
        /// </summary>
        public async Task<GitHubIssueResult?> GetOpenBlockedByAsync(int number)
        {
            try
            {
                var blockers = await GetConditionalAsync<List<GitHubIssueResult>>(
                    $"repos/{Owner}/{Repo}/issues/{number}/dependencies/blocked_by");
                return blockers?.FirstOrDefault(b => !b.IsClosed);
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return null;
            }
        }

        /// <summary>
        /// Git #845 (Git Board Phase 7) — sets a real GitHub issue-dependency
        /// link via the same `POST /issues/{n}/dependencies/blocked_by`
        /// endpoint CLAUDE.md's blocked-label workflow already uses. The API
        /// takes the blocking issue's real internal `id` (not its number), so
        /// this fetches that first, same two-step sequence CLAUDE.md documents.
        /// </summary>
        public async Task SetBlockedByAsync(int issueNumber, int blockingIssueNumber)
        {
            var blocker = await _http.GetFromJsonAsync<GitHubIssueIdResult>(
                $"repos/{Owner}/{Repo}/issues/{blockingIssueNumber}", JsonOpts);
            if (blocker == null)
                throw new Exception($"Issue #{blockingIssueNumber} not found on GitHub.");

            var res = await _http.PostAsJsonAsync(
                $"repos/{Owner}/{Repo}/issues/{issueNumber}/dependencies/blocked_by",
                new { issue_id = blocker.Id });

            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                throw new Exception($"GitHub rejected blocked_by ({(int)res.StatusCode}): {body}");
            }
        }

        /// <summary>
        /// Git #875 — Shane: "the progress on the Milestone node isnt right...
        /// it says 0%... I know I have things closed in all these current
        /// epics." Root cause: the Git Board's own GraphQL fetch only ever
        /// asks for OPEN issues (Git #839 - "done done get out of my view"),
        /// so a milestone's completed/total counts computed from THAT list
        /// can never see a closed issue - completed is structurally always 0.
        /// GitHub's real milestone object already tracks open/closed counts
        /// itself (`GET /repos/{o}/{r}/milestones`), so this reads the real
        /// numbers directly instead of trying to derive them from a list that
        /// was deliberately filtered down to OPEN-only.
        /// </summary>
        public class GitHubMilestoneInfo
        {
            public int Number { get; set; }
            public string Title { get; set; } = "";
            [JsonPropertyName("open_issues")]
            public int OpenIssues { get; set; }
            [JsonPropertyName("closed_issues")]
            public int ClosedIssues { get; set; }
        }

        /// <summary>Git #875 — real open+closed counts per milestone, state=all so both open and fully-closed milestones come back.</summary>
        public async Task<List<GitHubMilestoneInfo>> GetMilestonesAsync()
        {
            var milestones = await GetConditionalAsync<List<GitHubMilestoneInfo>>(
                $"repos/{Owner}/{Repo}/milestones?state=all&per_page=100");
            return milestones ?? new List<GitHubMilestoneInfo>();
        }

        private class GitHubIssueIdResult
        {
            public long Id { get; set; }
        }

        private class GitHubSearchResponse
        {
            public List<GitHubIssueResult> Items { get; set; } = new();
        }

        /// <summary>
        /// Git #910 — Shane: "how long does it take now when I assign an
        /// issue to a parent for it to show up in my right side panel under
        /// it's parent?... 906, 908, 909 should be showing." Root cause:
        /// "Issues in this Epic" (BuildQueuePanel) was reading the internal
        /// bt_issues.epic_id table server-side - a completely separate
        /// system from GitHub's real sub-issue graph that "Assign to
        /// Epic..." (#844) actually writes to. No sync connects the two, so
        /// it was never a timing issue - it would never show up no matter
        /// how long Shane waited. Fetches the epic's REAL sub-issues
        /// directly instead, same real-GitHub-state principle #839/#874
        /// already established elsewhere in this app.
        /// </summary>
        public async Task<List<GitHubSubIssue>> GetSubIssuesAsync(int parentNumber)
        {
            try
            {
                var subIssues = await GetConditionalAsync<List<GitHubSubIssue>>(
                    $"repos/{Owner}/{Repo}/issues/{parentNumber}/sub_issues");
                return subIssues ?? new List<GitHubSubIssue>();
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return new List<GitHubSubIssue>();
            }
        }

        /// <summary>Git #840 (Git Board Phase 2) — real `GET /issues/{n}`, the full current title/body for the issue detail panel.</summary>
        public async Task<GitHubIssueDetail?> GetIssueAsync(int number)
        {
            try
            {
                return await GetConditionalAsync<GitHubIssueDetail>(
                    $"repos/{Owner}/{Repo}/issues/{number}");
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return null;
            }
        }

        /// <summary>Git #840 (Git Board Phase 2) — real `GET /issues/{n}/comments`; GitHub returns these in chronological order already, no client-side re-sort needed.</summary>
        public async Task<List<GitHubIssueComment>> GetIssueCommentsAsync(int number)
        {
            try
            {
                var comments = await GetConditionalAsync<List<GitHubIssueComment>>(
                    $"repos/{Owner}/{Repo}/issues/{number}/comments");
                return comments ?? new List<GitHubIssueComment>();
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return new List<GitHubIssueComment>();
            }
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
        number title state url body databaseId
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
                            DatabaseId = n.DatabaseId,
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
            public long DatabaseId { get; set; }
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

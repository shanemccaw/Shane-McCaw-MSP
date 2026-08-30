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

    /// <summary>
    /// Git #1709 — one real, open issue sitting in the project board's "Batter Up"
    /// status (`Status` field `PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0`, option `Batter Up` =
    /// `09b1927f` — same field CLAUDE.md's "AI Batter Up" routing writes to, different
    /// option). Straight off <see cref="GitHubApiClient.GetBatterUpIssuesAsync"/>'s
    /// GraphQL project-items read, never derived from a label.
    /// </summary>
    public class BatterUpBoardIssue
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string HtmlUrl { get; set; } = "";
    }

    /// <summary>
    /// Git #1710 — one real, open issue sitting in the project board's "AI Batter Up"
    /// status (same `Status` field `PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0`, option `a0296971`) —
    /// the agent-filed-findings review queue CLAUDE.md's "Board status" section routes
    /// new findings into, distinct from the plain "Batter Up" launch queue #1709 reads.
    /// Carries the real ProjectV2Item node <see cref="ItemId"/> (not the issue's own id)
    /// because that's what `updateProjectV2ItemFieldValue` needs to promote/demote it.
    /// </summary>
    public class AiBatterUpBoardIssue
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string HtmlUrl { get; set; } = "";
        public string ItemId { get; set; } = "";
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
        /// <summary>The number of this issue's real GitHub parent (the epic it's a sub-issue of), or null
        /// when it has no parent. Straight from GraphQL's <c>parent</c> field on the sub-issues graph —
        /// the same graph "Assign to Epic…" writes to. Focus Mode needs this because Shane assigns a
        /// milestone to the EPIC, not to each sub-issue: a sub-issue carries <see cref="MilestoneNumber"/>
        /// == null but genuinely belongs to its parent epic's milestone, so the queue filter must resolve
        /// build → issue → parent epic → epic's milestone rather than trusting the sub-issue's own (null) one.</summary>
        public int? ParentNumber { get; set; }
        /// <summary>The parent epic's own real GitHub milestone number (null if the epic has none, or the
        /// issue has no parent). Carried directly off the parent so the chain resolves even when the epic
        /// itself isn't in the current OPEN-only board fetch.</summary>
        public int? ParentMilestoneNumber { get; set; }
        /// <summary>subIssuesSummary.total straight from GraphQL — the real number of sub-issues.</summary>
        public int SubIssueCount { get; set; }
        /// <summary>Numbers of sub-issues explicitly attached to this epic from GitHub GraphQL or sub_issues endpoint.</summary>
        public List<int> ChildIssueNumbers { get; set; } = new();
        /// <summary>GraphQL databaseId — the numeric REST id GitHub's sub_issues endpoint wants as `sub_issue_id` (NOT the issue Number). Populated by ListBoardIssuesAsync for Git #844.</summary>
        public long DatabaseId { get; set; }

        /// <summary>Any issue with at least one sub-issue IS an Epic (Git #839) — no title-text convention.</summary>
        public bool IsEpic => SubIssueCount > 0 || ChildIssueNumbers.Count > 0;
        public bool IsClosed => string.Equals(State, "CLOSED", StringComparison.OrdinalIgnoreCase);
        public bool IsComplete => Labels.Any(l => string.Equals(l.Name, "complete", StringComparison.OrdinalIgnoreCase));
        public bool IsTodo => Labels.Any(l => string.Equals(l.Name, "Shane To-Do", StringComparison.OrdinalIgnoreCase));
        public bool HasInFlightLabel => Labels.Any(l => string.Equals(l.Name, "in-flight", StringComparison.OrdinalIgnoreCase));
        public bool IsBlocked => Labels.Any(l => string.Equals(l.Name, "blocked", StringComparison.OrdinalIgnoreCase));
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
            // Git #1784 — raised from 20s. A full 18-page project walk measured ~16s on a bare
            // network with zero overhead, close enough to the old 20s ceiling that Shane's real
            // run genuinely timed out mid-walk ("The request was canceled due to the configured
            // HttpClient.Timeout ... elapsing"). 60s is a meaningful per-request ceiling; the
            // Batter Up scans additionally retry individual pages with backoff (see
            // PostProjectItemsQueryWithRetryAsync) so one slow page no longer kills the walk.
            _http = new HttpClient { BaseAddress = new Uri("https://api.github.com/"), Timeout = TimeSpan.FromSeconds(60) };
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
        ///
        /// <paramref name="bypassCache"/> — a deliberate, manual "Refresh right now"
        /// (the Git Board Refresh button, forceFresh) OMITS the `If-None-Match`
        /// header entirely so GitHub cannot answer 304 from a lagging ETag and hand
        /// back a stale body. This closes the manual-refresh-did-nothing bug for
        /// milestone open/closed counts: GitHub's milestones-list ETag can lag the
        /// actual open_issues/closed_issues counters by seconds-to-minutes, so a
        /// conditional re-GET after Shane closed issues would 304 and return the OLD
        /// counts — which feed BOTH the Git Board milestone-node % AND Focus Mode's
        /// progress bar (they share `milestoneInfos`). forceFresh already skipped the
        /// LeftSidebar TTL cache + the repaint-signature guard, but NOT this deeper
        /// static ETag cache; that gap is exactly what left "20/35" frozen after a
        /// manual refresh. The fresh 200 body still refreshes the cache below, so the
        /// next background (non-bypass) poll keeps its rate-limit-free 304 benefit.
        /// One extra rate-limited GET per rare manual click is a fair trade.
        /// </summary>
        private async Task<T?> GetConditionalAsync<T>(string path, bool bypassCache = false) where T : class
        {
            _conditionalCache.TryGetValue(path, out var cached);
            using var req = new HttpRequestMessage(HttpMethod.Get, path);
            if (!bypassCache && cached != null)
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
        public async Task<GitHubIssueResult?> GetOpenBlockedByAsync(int number) =>
            (await GetBlockedByAsync(number)).FirstOrDefault(b => !b.IsClosed);

        /// <summary>
        /// Git #1709 — the real, full `blocked_by` dependency list (open AND closed),
        /// factored out of <see cref="GetOpenBlockedByAsync"/> (which still returns just
        /// the first open one for the existing badge callers) so the Batter Up panel can
        /// pass every declared blocker number into `--blocked-by`/`blocked_by_numbers`
        /// and let the existing #1600 fail-closed watcher re-check each one live, exactly
        /// like every other launch path already does — not just the one this snapshot
        /// happened to see open first.
        /// </summary>
        public async Task<List<GitHubIssueResult>> GetBlockedByAsync(int number)
        {
            try
            {
                var blockers = await GetConditionalAsync<List<GitHubIssueResult>>(
                    $"repos/{Owner}/{Repo}/issues/{number}/dependencies/blocked_by");
                return blockers ?? new List<GitHubIssueResult>();
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return new List<GitHubIssueResult>();
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

        /// <summary>Removes the 'blocked' label and/or dependency link on GitHub to unblock the issue.</summary>
        public async Task RemoveBlockedAsync(int issueNumber, int? blockingIssueNumber = null)
        {
            try
            {
                await _http.DeleteAsync($"repos/{Owner}/{Repo}/issues/{issueNumber}/labels/blocked");
            }
            catch { }

            if (blockingIssueNumber.HasValue)
            {
                try
                {
                    var blocker = await _http.GetFromJsonAsync<GitHubIssueIdResult>(
                        $"repos/{Owner}/{Repo}/issues/{blockingIssueNumber.Value}", JsonOpts);
                    if (blocker != null)
                    {
                        var req = new HttpRequestMessage(HttpMethod.Delete,
                            $"repos/{Owner}/{Repo}/issues/{issueNumber}/dependencies/blocked_by")
                        {
                            Content = JsonContent.Create(new { issue_id = blocker.Id })
                        };
                        await _http.SendAsync(req);
                    }
                }
                catch { }
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
            public string State { get; set; } = "open";
            public bool IsClosed => string.Equals(State, "closed", StringComparison.OrdinalIgnoreCase);
            [JsonPropertyName("open_issues")]
            public int OpenIssues { get; set; }
            [JsonPropertyName("closed_issues")]
            public int ClosedIssues { get; set; }
        }

        /// <summary>Git #875 — real open+closed counts per milestone, state=all so both open and fully-closed milestones come back.
        /// <paramref name="bypassCache"/> (the manual Refresh button's forceFresh) skips the ETag conditional so GitHub can't 304 us
        /// with a lagging milestone-count body — see <see cref="GetConditionalAsync{T}"/> for why that mattered for the progress bar.</summary>
        public async Task<List<GitHubMilestoneInfo>> GetMilestonesAsync(bool bypassCache = false)
        {
            var milestones = await GetConditionalAsync<List<GitHubMilestoneInfo>>(
                $"repos/{Owner}/{Repo}/milestones?state=all&per_page=100", bypassCache);
            return milestones ?? new List<GitHubMilestoneInfo>();
        }

        /// <summary>Git #1418 — real `POST /repos/{o}/{r}/milestones`, creating a new GitHub Milestone.</summary>
        public async Task<GitHubMilestoneInfo> CreateMilestoneAsync(string title, string? description = null)
        {
            object payload = description != null
                ? new { title, description }
                : new { title };
            var res = await _http.PostAsJsonAsync($"repos/{Owner}/{Repo}/milestones", payload);
            if (!res.IsSuccessStatusCode)
            {
                var err = await res.Content.ReadAsStringAsync();
                throw new Exception($"GitHub rejected milestone creation ({(int)res.StatusCode}): {err}");
            }
            var created = await res.Content.ReadFromJsonAsync<GitHubMilestoneInfo>(JsonOpts);
            if (created == null) throw new Exception("GitHub returned an empty response for the created milestone.");
            return created;
        }

        /// <summary>
        /// Finds the real milestone with the given title (case-insensitive), creating it if it
        /// doesn't exist yet. Generic helper for lazily provisioning a milestone on demand
        /// rather than requiring a separate one-time setup step.
        /// </summary>
        public async Task<GitHubMilestoneInfo> GetOrCreateMilestoneAsync(string title, string? description = null)
        {
            var existing = await GetMilestonesAsync(bypassCache: true);
            var found = existing.FirstOrDefault(m => string.Equals(m.Title, title, StringComparison.OrdinalIgnoreCase));
            if (found != null) return found;
            return await CreateMilestoneAsync(title, description);
        }

        /// <summary>Git #1418 — real `PATCH /issues/{n}` setting (or clearing, when null) the issue's milestone.</summary>
        public async Task SetIssueMilestoneAsync(int issueNumber, int? milestoneNumber)
        {
            using var req = new HttpRequestMessage(HttpMethod.Patch, $"repos/{Owner}/{Repo}/issues/{issueNumber}")
            {
                Content = JsonContent.Create(new { milestone = milestoneNumber }),
            };
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var err = await res.Content.ReadAsStringAsync();
                throw new Exception($"GitHub rejected setting milestone on #{issueNumber} ({(int)res.StatusCode}): {err}");
            }
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
        /// <paramref name="bypassCache"/> — same contract as GetMilestonesAsync:
        /// skips the static ETag cache so a tab-switch always fetches fresh
        /// data. Without this, if GitHub previously returned an ETag for an
        /// empty sub-issues list (e.g. before issues were added as sub-issues),
        /// a 304 would hand back that stale empty list for the entire app session.
        /// </summary>
        public async Task<List<GitHubSubIssue>> GetSubIssuesAsync(int parentNumber, bool bypassCache = false)
        {
            try
            {
                var subIssues = await GetConditionalAsync<List<GitHubSubIssue>>(
                    $"repos/{Owner}/{Repo}/issues/{parentNumber}/sub_issues", bypassCache);
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

        /// <summary>
        /// Shane, 2026-08-30 — real `POST /issues/{n}/comments`, the write half of
        /// <see cref="GetIssueCommentsAsync"/>: posts a comment directly from
        /// IssueDetailView's new compose box instead of round-tripping through
        /// github.com. Returns the created comment (GitHub's response body) so the
        /// caller can append it to the thread immediately rather than waiting on a
        /// full re-fetch.
        /// </summary>
        public async Task<GitHubIssueComment> AddIssueCommentAsync(int number, string body)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"repos/{Owner}/{Repo}/issues/{number}/comments")
            {
                Content = JsonContent.Create(new { body }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();
            var created = await res.Content.ReadFromJsonAsync<GitHubIssueComment>(JsonOpts);
            if (created == null) throw new Exception("GitHub returned an empty response for the created comment.");
            return created;
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

        /// <summary>Closes (or reopens) a real GitHub milestone via `PATCH /repos/{o}/{r}/milestones/{n}`.</summary>
        public async Task CloseMilestoneAsync(int milestoneNumber, bool close = true)
        {
            using var req = new HttpRequestMessage(HttpMethod.Patch, $"repos/{Owner}/{Repo}/milestones/{milestoneNumber}")
            {
                Content = JsonContent.Create(new { state = close ? "closed" : "open" }),
            };
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var err = await res.Content.ReadAsStringAsync();
                throw new Exception($"GitHub API error ({(int)res.StatusCode}): {err}");
            }
        }

        /// <summary>
        /// Git #842 (Git Board Phase 4) — real `POST /issues`, the same
        /// endpoint/shape `exception-github-sync.ts`'s createGithubIssue uses.
        /// The response's numeric `id` is what <see cref="AddSubIssueAsync"/>
        /// wants as `sub_issue_id` to attach the new issue under an epic.
        /// </summary>
        public async Task<CreatedIssue> CreateIssueAsync(string title, string body, int? milestone = null)
        {
            object payload = milestone.HasValue
                ? new { title, body, milestone = milestone.Value }
                : new { title, body };

            var res = await _http.PostAsJsonAsync($"repos/{Owner}/{Repo}/issues", payload);
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
        // Git #1784 — was 10 (1,000 items). The real project is already 1,781 items / 18 pages
        // and growing, so a 10-page cap made items at page 17-18 structurally unreachable — a
        // guaranteed miss, not a timing issue. 100 pages (10,000 items) gives real headroom
        // without being truly unbounded; if the cap is ever actually hit, the paginated scans
        // log a loud warning rather than truncating silently (never fail silently again).
        private const int MaxPages = 100; // runaway guard (up to 10,000 items per walk)
        // Git #1784 — reverse-pagination early-stop margin. Batter Up / AI Batter Up are
        // early-lifecycle transient states, so their items reliably sit among the most-recently
        // -added project items (the tail of forward order == the head of a backward last/before
        // walk). Confirmed live: all 27 current matches landed in the last ~175 of 1,781 items.
        // Once the backward walk has passed the cluster and seen this many consecutive
        // all-miss pages (== a 300-item gap), we are safely past every candidate and stop —
        // finding all matches in ~2 pages instead of re-scanning the whole backlog each poll.
        private const int EmptyPageStopThreshold = 3;

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
        parent {{ number milestone {{ number }} }}
        subIssuesSummary {{ total }}
        subIssues(first: 50) {{ nodes {{ number }} }}
      }}
    }}
  }}
}}";

                var conn = await PostGraphQLIssuesAsync(query);
                if (conn?.Nodes != null)
                {
                    foreach (var n in conn.Nodes)
                    {
                        var childNums = n.SubIssues?.Nodes?.Select(s => s.Number).Where(num => num > 0).ToList() ?? new List<int>();
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
                            ParentNumber = n.Parent?.Number,
                            ParentMilestoneNumber = n.Parent?.Milestone?.Number,
                            SubIssueCount = Math.Max(n.SubIssuesSummary?.Total ?? 0, childNums.Count),
                            ChildIssueNumbers = childNums,
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

            // Post-processing pass: bidirectional parent-child reconciliation & milestone inheritance
            var issueByNum = result.GroupBy(i => i.Number).ToDictionary(g => g.Key, g => g.First());

            // 1. Text-based parent inference fallback (e.g. "Parent #454", "Epic #454", "Part of #454")
            foreach (var issue in result)
            {
                if (!issue.ParentNumber.HasValue && !string.IsNullOrWhiteSpace(issue.Body))
                {
                    var m = System.Text.RegularExpressions.Regex.Match(issue.Body, @"(?:[Ee]pic|[Pp]art of|[Pp]arent|[Ss]ub-issue of)\s+#(\d+)");
                    if (m.Success && int.TryParse(m.Groups[1].Value, out var parentNum) && parentNum != issue.Number)
                    {
                        issue.ParentNumber = parentNum;
                    }
                }
            }

            // 2. Parent's explicit ChildIssueNumbers -> link child's ParentNumber
            foreach (var issue in result)
            {
                if (issue.ChildIssueNumbers.Count > 0)
                {
                    issue.SubIssueCount = Math.Max(issue.SubIssueCount, issue.ChildIssueNumbers.Count);
                    foreach (var childNum in issue.ChildIssueNumbers)
                    {
                        if (issueByNum.TryGetValue(childNum, out var child))
                        {
                            child.ParentNumber ??= issue.Number;
                        }
                    }
                }
            }

            // 3. Child's ParentNumber -> ensure parent recognizes child & inherits milestone
            foreach (var issue in result)
            {
                if (issue.ParentNumber.HasValue && issueByNum.TryGetValue(issue.ParentNumber.Value, out var parent))
                {
                    if (!parent.ChildIssueNumbers.Contains(issue.Number))
                    {
                        parent.ChildIssueNumbers.Add(issue.Number);
                        parent.SubIssueCount = Math.Max(parent.SubIssueCount, parent.ChildIssueNumbers.Count);
                    }

                    if (string.IsNullOrEmpty(issue.MilestoneTitle) && !string.IsNullOrEmpty(parent.MilestoneTitle))
                    {
                        issue.MilestoneTitle = parent.MilestoneTitle;
                        issue.MilestoneNumber = parent.MilestoneNumber;
                    }
                }
            }

            return result;
        }

        // ── Git #1709: real "Batter Up" project-board status via GraphQL ────────────
        // Same project/field CLAUDE.md's "AI Batter Up" routing mutation already writes
        // to — just read here instead of written, and a different option (plain "Batter
        // Up", not the agent-filed-findings review queue "AI Batter Up").
        // Field is looked up by name ("Status") in the query below rather than by its id
        // (PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0, the same field CLAUDE.md's mutation writes to)
        // since GraphQL's fieldValueByName takes a name, not an id.
        private const string BatterUpProjectId = "PVT_kwHOEiBDdc4BeoiY";
        private const string BatterUpOptionId = "09b1927f";

        /// <summary>
        /// Git #1709 — every real, OPEN issue currently sitting in the project board's
        /// "Batter Up" status. Reads the project's items directly by node id (paginated,
        /// same MaxPages runaway guard as <see cref="ListBoardIssuesInternalAsync"/>) and
        /// filters to this repo + the Batter Up option locally, since GraphQL has no
        /// server-side "where fieldValue = X" filter on project items.
        /// </summary>
        public async Task<List<BatterUpBoardIssue>> GetBatterUpIssuesAsync()
        {
            var nodes = await ScanProjectItemsForStatusAsync(BatterUpOptionId, includeItemId: false, "Batter Up");
            return nodes.Select(n => new BatterUpBoardIssue
            {
                Number = n.Content!.Number,
                Title = n.Content.Title ?? "",
                HtmlUrl = n.Content.Url ?? "",
            }).ToList();
        }

        // ── Git #1710: real "AI Batter Up" review-queue read + promote/demote mutation ──
        // Same project + Status field as #1709's read above; a different option, and this
        // side WRITES back via the real updateProjectV2ItemFieldValue mutation (Yes → Batter
        // Up, No → Backlog) rather than only reading. Landing here triggers nothing by
        // itself — Yes only flips the Status option; #1709's GetBatterUpIssuesAsync panel
        // picks the promoted item up on its own next poll. One trigger mechanism, not two.
        private const string StatusFieldId = "PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0";
        private const string AiBatterUpOptionId = "a0296971";
        public const string BatterUpPromoteOptionId = "09b1927f"; // plain "Batter Up" — same value as BatterUpOptionId above
        public const string BacklogOptionId = "63cc47c8";

        /// <summary>
        /// Shane, 2026-08-30 — a real board bucket for a build a Claude agent had to
        /// stop mid-session because it's genuinely blocked on something else: "Create
        /// a new Bucket in Git like the 'Batter Up' called 'Park' and move the Git
        /// issue there... then it pulls it out of the Batter Up queue, puts it in its
        /// own queue away from the build." Added as a real option on the same Status
        /// field (`gh api graphql updateProjectV2Field`, preserving every existing
        /// option's id/name/color) — id confirmed live: 19cfa11c. Moving an issue here
        /// pulls it out of Batter Up / AI Batter Up structurally, for free: both scans
        /// filter on their own exact optionId, so a "Park"-valued item simply never
        /// matches either. See <see cref="SetIssueStatusByNumberAsync"/> for the
        /// by-issue-number write BuildQueuePanel's Park/Un-park actions use.
        /// </summary>
        public const string ParkOptionId = "19cfa11c";

        /// <summary>
        /// Git #1710 — every real, OPEN issue currently sitting in the project board's
        /// "AI Batter Up" status: agent-filed findings awaiting Shane's Yes/No. Same
        /// paginated project-items GraphQL read as <see cref="GetBatterUpIssuesAsync"/>,
        /// filtered to the review-queue option instead, and additionally carrying each
        /// item's real ProjectV2Item node id so Yes/No can address it directly.
        /// </summary>
        public async Task<List<AiBatterUpBoardIssue>> GetAiBatterUpIssuesAsync()
        {
            var nodes = await ScanProjectItemsForStatusAsync(AiBatterUpOptionId, includeItemId: true, "AI Batter Up");
            return nodes.Select(n => new AiBatterUpBoardIssue
            {
                Number = n.Content!.Number,
                Title = n.Content.Title ?? "",
                HtmlUrl = n.Content.Url ?? "",
                ItemId = n.Id ?? "",
            }).ToList();
        }

        /// <summary>
        /// Git #1784 — shared, backward-paginated scan of the project board's items for a
        /// single Status option, used by both <see cref="GetBatterUpIssuesAsync"/> and
        /// <see cref="GetAiBatterUpIssuesAsync"/> (they share this exact pagination shape).
        ///
        /// Walks the ProjectV2 <c>items</c> connection with <c>last</c>/<c>before</c> (backward
        /// from the end) rather than <c>first</c>/<c>after</c>. Confirmed live against the real
        /// project: all Batter Up / AI Batter Up items cluster in the last ~175 of 1,781 items,
        /// because both are early-lifecycle transient states and project items appear roughly in
        /// added order. Walking backward therefore reaches every real candidate within the first
        /// ~2 pages instead of re-scanning the entire 1,781-item (and rising) backlog on every
        /// 90-second poll — the fix that actually scales as the project grows. The old forward
        /// walk was doubly broken here: matches sat at forward page 17-18 while <c>MaxPages</c>
        /// was 10, so they were structurally unreachable regardless of timeout.
        ///
        /// Correctness is preserved by only early-stopping <see cref="EmptyPageStopThreshold"/>
        /// consecutive all-miss pages AFTER the cluster has been seen; and by the hard
        /// <see cref="MaxPages"/> ceiling, which logs a loud warning if ever hit rather than
        /// truncating silently. Individual pages retry with backoff so one slow page can't kill
        /// the walk.
        /// </summary>
        private async Task<List<ProjectItemNodeData>> ScanProjectItemsForStatusAsync(string targetOptionId, bool includeItemId, string label)
        {
            var matches = new List<ProjectItemNodeData>();
            string? before = null;
            bool foundAny = false;
            int consecutiveEmptyPages = 0;
            int pagesWalked = 0;

            for (int page = 0; page < MaxPages; page++)
            {
                pagesWalked = page + 1;
                string beforeArg = before == null ? "null" : $"\"{before}\"";
                string idField = includeItemId ? "id" : "";
                string query = $@"query {{
  node(id: ""{BatterUpProjectId}"") {{
    ... on ProjectV2 {{
      items(last: {PageSize}, before: {beforeArg}) {{
        pageInfo {{ hasPreviousPage startCursor }}
        nodes {{
          {idField}
          fieldValueByName(name: ""Status"") {{
            ... on ProjectV2ItemFieldSingleSelectValue {{ optionId }}
          }}
          content {{
            ... on Issue {{
              number title state url
              repository {{ nameWithOwner }}
            }}
          }}
        }}
      }}
    }}
  }}
}}";

                var conn = await PostProjectItemsQueryWithRetryAsync(query, label);

                int pageMatches = 0;
                if (conn?.Nodes != null)
                {
                    foreach (var n in conn.Nodes)
                    {
                        var issue = n.Content;
                        if (issue == null) continue;
                        if (!string.Equals(issue.Repository?.NameWithOwner, $"{Owner}/{Repo}", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!string.Equals(issue.State, "OPEN", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!string.Equals(n.FieldValueByName?.OptionId, targetOptionId, StringComparison.OrdinalIgnoreCase)) continue;

                        matches.Add(n);
                        pageMatches++;
                    }
                }

                if (pageMatches > 0) { foundAny = true; consecutiveEmptyPages = 0; }
                else if (foundAny) { consecutiveEmptyPages++; }

                // Early stop: we've passed the recent cluster (see EmptyPageStopThreshold).
                if (foundAny && consecutiveEmptyPages >= EmptyPageStopThreshold)
                    return matches;

                bool more = conn?.PageInfo?.HasPreviousPage == true && !string.IsNullOrEmpty(conn.PageInfo.StartCursor);
                if (!more)
                    return matches;

                before = conn!.PageInfo!.StartCursor;
            }

            // Loud, non-silent cap notice — the walk exhausted MaxPages while more pages still
            // remained. Never truncate quietly again (Git #1784).
            ActivityLog.Log("git-board.data",
                $"WARNING: {label} project scan hit the {MaxPages}-page ({MaxPages * PageSize}-item) cap with more items remaining after {pagesWalked} pages — results may be incomplete; raise MaxPages.");
            return matches;
        }

        /// <summary>
        /// Git #1784 — one project-items page fetch with retry-and-backoff, so a single slow or
        /// transiently-failing page (an HttpClient.Timeout, a dropped connection) no longer kills
        /// the whole multi-page walk. Non-transient errors (e.g. a GraphQL error) surface
        /// immediately on the first attempt.
        /// </summary>
        private async Task<ProjectItemConnection?> PostProjectItemsQueryWithRetryAsync(string query, string label)
        {
            const int maxAttempts = 3;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    return await PostProjectItemsQueryAsync(query);
                }
                catch (Exception ex) when (attempt < maxAttempts && (ex is TaskCanceledException || ex is HttpRequestException))
                {
                    int delayMs = 500 * (int)Math.Pow(2, attempt - 1); // 500ms, 1000ms
                    ActivityLog.Log("git-board.data",
                        $"{label} project page fetch attempt {attempt}/{maxAttempts} failed ({ex.GetType().Name}: {ex.Message}); retrying in {delayMs}ms.");
                    await Task.Delay(delayMs);
                }
            }
        }

        /// <summary>
        /// Git #1710 — the real `updateProjectV2ItemFieldValue` mutation, moving a single
        /// project item's Status field to <paramref name="optionId"/>. Used for both
        /// directions: Yes → <see cref="BatterUpPromoteOptionId"/>, No → <see cref="BacklogOptionId"/>.
        /// This is the SAME field CLAUDE.md's agent-filing routing mutation already writes to.
        /// </summary>
        public async Task SetProjectItemStatusAsync(string itemId, string optionId)
        {
            string mutation = $@"mutation {{
  updateProjectV2ItemFieldValue(input: {{
    projectId: ""{BatterUpProjectId}""
    itemId: ""{itemId}""
    fieldId: ""{StatusFieldId}""
    value: {{ singleSelectOptionId: ""{optionId}"" }}
  }}) {{ projectV2Item {{ id }} }}
}}";

            using var req = new HttpRequestMessage(HttpMethod.Post, "graphql")
            {
                Content = JsonContent.Create(new { query = mutation }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();

            var body = await res.Content.ReadFromJsonAsync<GraphQLMutationResponse>(JsonOpts);
            if (body?.Errors is { Count: > 0 } errs)
                throw new Exception("GitHub GraphQL: " + string.Join("; ", errs.Select(e => e.Message)));
        }

        private class GraphQLMutationResponse
        {
            public List<GraphQLError>? Errors { get; set; }
        }

        /// <summary>
        /// Resolves a plain GitHub issue number to its ProjectV2Item node id on THIS
        /// project (an issue can sit on several projects; only this one's item id is
        /// useful to <see cref="SetProjectItemStatusAsync"/>). Unlike
        /// <see cref="ScanProjectItemsForStatusAsync"/> (a full paginated board walk,
        /// built for "every item at option X") this goes straight at one issue via
        /// `issue(number:).projectItems`, so it's cheap enough to call inline from a
        /// button click. Returns null if the issue isn't on this project at all.
        /// </summary>
        public async Task<string?> GetProjectItemIdForIssueAsync(int issueNumber)
        {
            string query = $@"query {{
  repository(owner: ""{Owner}"", name: ""{Repo}"") {{
    issue(number: {issueNumber}) {{
      projectItems(first: 20) {{
        nodes {{ id project {{ id }} }}
      }}
    }}
  }}
}}";
            using var req = new HttpRequestMessage(HttpMethod.Post, "graphql")
            {
                Content = JsonContent.Create(new { query }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();
            var body = await res.Content.ReadFromJsonAsync<ProjectItemLookupResponse>(JsonOpts);
            if (body?.Errors is { Count: > 0 } errs)
                throw new Exception("GitHub GraphQL: " + string.Join("; ", errs.Select(e => e.Message)));

            var nodes = body?.Data?.Repository?.Issue?.ProjectItems?.Nodes;
            return nodes?.FirstOrDefault(n => string.Equals(n.Project?.Id, BatterUpProjectId, StringComparison.OrdinalIgnoreCase))?.Id;
        }

        /// <summary>
        /// Moves a plain GitHub issue number's Status field on this project — the
        /// by-number convenience <see cref="SetProjectItemStatusAsync"/> (which needs
        /// the item id up front) doesn't offer. Used by BuildQueuePanel's Park/Un-park
        /// actions, which only ever have a QueueItem's github_number, not an item id.
        /// A no-op (returns false, doesn't throw) if the issue isn't on the project —
        /// a local-only build (no linked GitHub issue's project card yet) shouldn't
        /// block the local park/un-park it's paired with.
        /// </summary>
        public async Task<bool> SetIssueStatusByNumberAsync(int issueNumber, string optionId)
        {
            var itemId = await GetProjectItemIdForIssueAsync(issueNumber);
            if (string.IsNullOrEmpty(itemId)) return false;
            await SetProjectItemStatusAsync(itemId, optionId);
            return true;
        }

        private class ProjectItemLookupResponse
        {
            public ProjectItemLookupData? Data { get; set; }
            public List<GraphQLError>? Errors { get; set; }
        }
        private class ProjectItemLookupData { public ProjectItemLookupRepo? Repository { get; set; } }
        private class ProjectItemLookupRepo { public ProjectItemLookupIssue? Issue { get; set; } }
        private class ProjectItemLookupIssue { public ProjectItemLookupConnection? ProjectItems { get; set; } }
        private class ProjectItemLookupConnection { public List<ProjectItemLookupNode> Nodes { get; set; } = new(); }
        private class ProjectItemLookupNode { public string? Id { get; set; } public ProjectItemLookupProject? Project { get; set; } }
        private class ProjectItemLookupProject { public string? Id { get; set; } }

        private async Task<ProjectItemConnection?> PostProjectItemsQueryAsync(string query)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "graphql")
            {
                Content = JsonContent.Create(new { query }),
            };
            var res = await _http.SendAsync(req);
            res.EnsureSuccessStatusCode();

            var body = await res.Content.ReadFromJsonAsync<GraphQLProjectResponse>(JsonOpts);
            if (body?.Errors is { Count: > 0 } errs)
                throw new Exception("GitHub GraphQL: " + string.Join("; ", errs.Select(e => e.Message)));
            return body?.Data?.Node?.Items;
        }

        private class GraphQLProjectResponse
        {
            public ProjectQueryData? Data { get; set; }
            public List<GraphQLError>? Errors { get; set; }
        }
        private class ProjectQueryData { public ProjectV2Data? Node { get; set; } }
        private class ProjectV2Data { public ProjectItemConnection? Items { get; set; } }
        private class ProjectItemConnection
        {
            public PageInfoData? PageInfo { get; set; }
            public List<ProjectItemNodeData> Nodes { get; set; } = new();
        }
        private class ProjectItemNodeData
        {
            /// <summary>The real ProjectV2Item node id — only requested/populated by the Git #1710 AI Batter Up query; #1709's read doesn't ask for it and leaves this null.</summary>
            public string? Id { get; set; }
            public FieldValueData? FieldValueByName { get; set; }
            public ProjectItemIssueData? Content { get; set; }
        }
        private class FieldValueData { public string? OptionId { get; set; } }
        private class ProjectItemIssueData
        {
            public int Number { get; set; }
            public string? Title { get; set; }
            public string? State { get; set; }
            public string? Url { get; set; }
            public ProjectItemRepoData? Repository { get; set; }
        }
        private class ProjectItemRepoData { public string? NameWithOwner { get; set; } }

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
            // Git #1784 — backward pagination (last/before) for the Batter Up project scans.
            public bool HasPreviousPage { get; set; }
            public string? StartCursor { get; set; }
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
            public ParentData? Parent { get; set; }
            public SubIssuesSummaryData? SubIssuesSummary { get; set; }
            public SubIssuesConnection? SubIssues { get; set; }
        }
        private class LabelConnection { public List<LabelNode> Nodes { get; set; } = new(); }
        private class LabelNode { public string Name { get; set; } = ""; }
        private class MilestoneData { public string? Title { get; set; } public int? Number { get; set; } }
        /// <summary>The GraphQL <c>parent</c> node — the epic this issue is a sub-issue of, plus that epic's own milestone (so the child's effective milestone resolves without the epic needing to be in the same fetch).</summary>
        private class ParentData { public int? Number { get; set; } public MilestoneData? Milestone { get; set; } }
        private class SubIssuesSummaryData { public int Total { get; set; } }
        private class SubIssuesConnection { public List<SubIssueNode> Nodes { get; set; } = new(); }
        private class SubIssueNode { public int Number { get; set; } }
    }
}

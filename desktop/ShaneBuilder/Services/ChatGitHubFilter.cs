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

/// <summary>Git #2357 — one Batter Up rail item's own identity plus its real immediate parent
/// (the GraphQL <c>parent</c> edge — same one-level field #2300's
/// <see cref="GitPanelService.GetAncestryAsync"/> uses), fetched inline off the same board-walk
/// query rather than a per-item round trip. <c>FeatureNumber</c> is null when the issue genuinely
/// has no parent — that's a real "No Feature" bucket, never an invented grouping key.</summary>
public sealed class BatterUpItemRef
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public int? FeatureNumber { get; init; }
    public string? FeatureTitle { get; init; }
    /// <summary>Git #2358 — the real parent Feature's own <c>state</c>/labels, fetched inline off
    /// the same <c>parent</c> edge as <c>FeatureNumber</c>/<c>FeatureTitle</c> (no second round
    /// trip). Null/empty when <see cref="FeatureNumber"/> is null (no real parent to have a
    /// state).</summary>
    public bool FeatureIsClosed { get; init; }
    public List<string> FeatureLabels { get; init; } = new();

    // ── Git #2360 — real per-item write targets for Hold/Release ────────────────────────────
    /// <summary>The real ProjectV2Item node id (not the issue's own id) — what
    /// <c>updateProjectV2ItemFieldValue</c> needs to move this item's Status. Null only if the
    /// GraphQL response genuinely didn't carry it (never fabricated).</summary>
    public string? ProjectItemId { get; init; }
    /// <summary>The real Status option id this item was actually sitting in when the lane walk
    /// fetched it (Batter Up / AI Batter Up / Ask Shane) — Release writes back to exactly this,
    /// so an item held from AI Batter Up returns to AI Batter Up, not a guessed default lane.</summary>
    public string? LaneOptionId { get; init; }

    // ── Git #2359 — item-card detail: real badge, effort, "why it is here". Resolved by a
    // second, batched GraphQL call scoped to just the items already sorted into one of the 3
    // lanes (see <see cref="ChatGitHubFilter.EnrichBatterUpItemDetailsAsync"/>), so these start
    // null/false and are filled in after the initial lane-count walk returns — mutable, not
    // init-only, for exactly that reason. ────────────────────────────────────────────────────
    /// <summary>True once the detail fetch has run for this item (success OR failure) — lets the
    /// panel distinguish "not fetched yet" from "fetched, genuinely nothing there".</summary>
    public bool DetailLoaded { get; set; }
    /// <summary>True when this issue carries the real <c>agent-finding</c> label — filed by a
    /// build session mid-build, unplanned. False (the default) means CHAT FILED — planned, filed
    /// by Claude.ai chat. GitHub gives no structural signal beyond this label (every issue is
    /// authored as <c>shanemccaw</c> via PAT regardless of real origin) — see #2359's own
    /// corrected badge semantics.</summary>
    public bool IsAgentFinding { get; set; }
    /// <summary>The real <c>effort=</c> token off this issue's own most-recent <c>BUILD:</c>
    /// comment header, or null when no <c>BUILD:</c> comment exists yet (not dispatched) — the
    /// panel shows an honest "not yet estimated" for null, never a fabricated default.</summary>
    public string? Effort { get; set; }
    /// <summary>The real "why it is here" line: the most-recent <c>BUILD:</c> comment's stated
    /// scope (its first real prose paragraph) when one exists, else the issue body's first real
    /// paragraph. Null only when both are genuinely empty.</summary>
    public string? WhyHere { get; set; }
    /// <summary>Set when the detail fetch for this item's batch failed — the real error text, so
    /// the panel can say "couldn't load" honestly instead of mislabeling a fetch failure as "not
    /// yet estimated".</summary>
    public string? DetailError { get; set; }
}

/// <summary>Git #2356 (Feature #2355 item 1) — real per-lane item counts for the Batter Up rail
/// panel's four tabs. <c>Success=false</c> means the walk got NOTHING (gh unreachable on the very
/// first page) — same fail-closed convention as <see cref="LiveOpenIssuesResult"/>. <c>Complete</c>
/// distinguishes a full walk to the start of the board from one that hit the page cap or lost a
/// later page mid-walk (counts are a real partial in that case, not silently treated as final).
/// <c>All</c> is the sum of the three actionable lanes — Status is a single-select field, so an
/// item can only ever be counted in one of them, and Backlog/Done/Park/etc. items are deliberately
/// excluded (they aren't staging-area items).
///
/// Git #2357 — <c>BatterUpItems</c>/<c>AiBatterUpItems</c>/<c>AskShaneItems</c> carry each lane's
/// real items (see <see cref="BatterUpItemRef"/>) so the panel can group by real parent Feature;
/// counts are the list lengths, not a separately-tracked tally.</summary>
public sealed class BatterUpLaneCounts
{
    public bool Success { get; init; }
    public List<BatterUpItemRef> BatterUpItems { get; init; } = new();
    public List<BatterUpItemRef> AiBatterUpItems { get; init; } = new();
    public List<BatterUpItemRef> AskShaneItems { get; init; } = new();
    public int BatterUp => BatterUpItems.Count;
    public int AiBatterUp => AiBatterUpItems.Count;
    public int AskShane => AskShaneItems.Count;
    public int All => BatterUp + AiBatterUp + AskShane;
    public bool Complete { get; init; } = true;
    public string? Error { get; init; }

    public static BatterUpLaneCounts Ok(List<BatterUpItemRef> batterUp, List<BatterUpItemRef> aiBatterUp, List<BatterUpItemRef> askShane, bool complete) =>
        new() { Success = true, BatterUpItems = batterUp, AiBatterUpItems = aiBatterUp, AskShaneItems = askShane, Complete = complete };
    public static BatterUpLaneCounts Failure(string error) => new() { Success = false, Error = error };
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

    // ── Status field option ids (Git #2356) — confirmed live via `gh api graphql` against the
    // real board's Status field (id PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0). "Batter Up" and "AI Batter Up"
    // match BuildConsole's own GitHubApiClient.BatterUpOptionId / AiBatterUpOptionId. "Ask Shane" is
    // new here — the design doc's stale "AI For Shane" name, corrected by Shane 2026-09-01.
    private const string BatterUpOptionId = "09b1927f";
    private const string AiBatterUpOptionId = "a0296971";
    private const string AskShaneOptionId = "404998bb";

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

    // ── Batter Up lane counts (reverse of board status — status → items) ────────────────────────
    private const int LanePageSize = 100;
    private const int LaneMaxPages = 50; // runaway guard; real board is ~2,403 items / ~25 pages today
    /// <summary>Git #2359 — items per batched detail-fetch GraphQL call. Scoped only to the real
    /// items already sorted into one of the 3 Batter Up lanes (dozens, realistically), never the
    /// whole board, so this stays modest without needing the lane walk's own page-cap machinery.</summary>
    private const int DetailBatchSize = 20;

    /// <summary>Git #2356 — the real per-lane counts (Batter Up / AI Batter Up / Ask Shane) driving
    /// the Batter Up rail panel's four tabs. This is the REVERSE of <see cref="GetBoardStatusAsync"/>
    /// (issue number → status): here we walk the whole project board and tally by status. Same
    /// backward `items(last, before)` pagination shape as BuildConsole's own
    /// <c>GitHubApiClient.ScanProjectItemsForStatusAsync</c> (Git #1784/#1995) — no early-stop on
    /// empty pages, since an item's position in the board's <c>items</c> connection reflects when it
    /// was ADDED to the project, never when its Status last changed, so a walk that gives up early
    /// can silently miss a long-lived issue only just promoted into one of these lanes today.
    /// Real GraphQL field is <c>ProjectV2.items</c> (not <c>issue.projectItems</c>, which is the
    /// per-issue direction <see cref="GetBoardStatusAsync"/> already uses) — ported through
    /// <c>gh api graphql</c> per this file's established no-PAT CLI convention.
    ///
    /// Git #2357 — the query also carries each item's own <c>number</c>/<c>title</c> and its real
    /// immediate <c>parent</c> (number/title), fetched inline off this same page rather than a
    /// second per-item round trip, so the panel can group by real parent Feature.</summary>
    public async Task<BatterUpLaneCounts> GetBatterUpLaneCountsAsync()
    {
        var batterUp = new List<BatterUpItemRef>();
        var aiBatterUp = new List<BatterUpItemRef>();
        var askShane = new List<BatterUpItemRef>();
        string? before = null;
        int pagesWalked = 0;

        for (int page = 0; page < LaneMaxPages; page++)
        {
            pagesWalked = page + 1;
            string beforeArg = before == null ? "null" : $"\"{before}\"";
            string query = $@"query {{
  node(id: ""{BatterUpProjectId}"") {{
    ... on ProjectV2 {{
      items(last: {LanePageSize}, before: {beforeArg}) {{
        pageInfo {{ hasPreviousPage startCursor }}
        nodes {{
          id
          fieldValueByName(name: ""Status"") {{
            ... on ProjectV2ItemFieldSingleSelectValue {{ optionId }}
          }}
          content {{
            ... on Issue {{
              number
              title
              state
              repository {{ nameWithOwner }}
              parent {{ number title state labels(first: 20) {{ nodes {{ name }} }} }}
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
                ConsoleOutputSink.Log(LogLevel.Warn, $"[batterup.lanes] gh api graphql failed on page {pagesWalked}: {stderr.Trim()}");
                if (page == 0) return BatterUpLaneCounts.Failure($"gh api graphql failed: {stderr.Trim()}");
                return BatterUpLaneCounts.Ok(batterUp, aiBatterUp, askShane, complete: false); // real partial, walk cut short
            }

            LaneGraphQlResponse? parsed;
            try { parsed = JsonSerializer.Deserialize<LaneGraphQlResponse>(stdout, JsonOpts); }
            catch (Exception ex)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[batterup.lanes] couldn't parse gh graphql output on page {pagesWalked}: {ex.Message}");
                if (page == 0) return BatterUpLaneCounts.Failure($"couldn't parse gh output: {ex.Message}");
                return BatterUpLaneCounts.Ok(batterUp, aiBatterUp, askShane, complete: false);
            }

            var conn = parsed?.Data?.Node?.Items;
            if (conn?.Nodes == null) break;

            foreach (var n in conn.Nodes)
            {
                var issue = n.Content;
                if (issue == null) continue; // a PR / draft item — not an issue, not a lane candidate
                if (!string.Equals(issue.Repository?.NameWithOwner, Repo, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.Equals(issue.State, "OPEN", StringComparison.OrdinalIgnoreCase)) continue;

                string? laneOptionId = n.FieldValueByName?.OptionId;
                var itemRef = new BatterUpItemRef
                {
                    Number = issue.Number,
                    Title = issue.Title ?? $"#{issue.Number}",
                    FeatureNumber = issue.Parent?.Number,
                    FeatureTitle = issue.Parent?.Title,
                    FeatureIsClosed = string.Equals(issue.Parent?.State, "CLOSED", StringComparison.OrdinalIgnoreCase),
                    FeatureLabels = issue.Parent?.Labels?.Nodes?.Select(l => l.Name).Where(n => !string.IsNullOrWhiteSpace(n)).ToList()
                        ?? new List<string>(),
                    ProjectItemId = n.Id,
                    LaneOptionId = laneOptionId,
                };

                switch (laneOptionId)
                {
                    case BatterUpOptionId: batterUp.Add(itemRef); break;
                    case AiBatterUpOptionId: aiBatterUp.Add(itemRef); break;
                    case AskShaneOptionId: askShane.Add(itemRef); break;
                    // any other Status (Backlog/Done/Park/etc.) — not one of the 4 lanes, skip
                }
            }

            bool more = conn.PageInfo?.HasPreviousPage == true && !string.IsNullOrEmpty(conn.PageInfo.StartCursor);
            if (!more)
            {
                ConsoleOutputSink.Log(LogLevel.Info,
                    $"[batterup.lanes] full walk reached the start of the board after {pagesWalked} page(s) — " +
                    $"Batter Up={batterUp.Count} AI Batter Up={aiBatterUp.Count} Ask Shane={askShane.Count}.");
                return BatterUpLaneCounts.Ok(batterUp, aiBatterUp, askShane, complete: true);
            }
            before = conn.PageInfo!.StartCursor;
        }

        ConsoleOutputSink.Log(LogLevel.Warn,
            $"[batterup.lanes] hit the {LaneMaxPages}-page cap with more items remaining — counts are a real partial, not final.");
        return BatterUpLaneCounts.Ok(batterUp, aiBatterUp, askShane, complete: false);
    }

    /// <summary>Git #2359 (Feature #2355 item 4) — real per-item detail for the Batter Up item
    /// cards: a real AGENT FOUND / CHAT FILED badge (the <c>agent-finding</c> label), a real
    /// effort label (the most-recent <c>BUILD:</c> comment's <c>effort=</c> token), and a real
    /// "why it is here" line (that same comment's stated scope, or the issue body when there's no
    /// <c>BUILD:</c> comment yet). Scoped to just <paramref name="items"/> — the real items
    /// already sorted into one of the 3 lanes by <see cref="GetBatterUpLaneCountsAsync"/>, not the
    /// whole ~2,400-item board walk — and batched via GraphQL aliases
    /// (<see cref="DetailBatchSize"/> issues per HTTP round trip) rather than one call per item,
    /// the same "no per-item round trip" discipline #2357 established for each item's parent.
    /// Mutates each <see cref="BatterUpItemRef"/> in place; a batch that fails leaves its items'
    /// <see cref="BatterUpItemRef.DetailError"/> set rather than silently guessing.</summary>
    public async Task EnrichBatterUpItemDetailsAsync(IReadOnlyList<BatterUpItemRef> items)
    {
        if (items.Count == 0) return;

        foreach (var batch in items.Chunk(DetailBatchSize))
        {
            var byNumber = batch.ToDictionary(i => i.Number);
            var sb = new StringBuilder("query {\n  repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") {\n");
            foreach (var item in batch)
            {
                sb.Append($"    i{item.Number}: issue(number: {item.Number}) {{\n");
                sb.Append("      body\n");
                sb.Append("      labels(first: 20) { nodes { name } }\n");
                // Most recent 20 comments is enough to find a re-dispatch's newer BUILD: comment
                // for any item realistically staged in one of these 3 lanes today; a real partial
                // for an outlier issue with a much longer thread is an honest limitation, not
                // silently wrong (same "real partial, not final" posture as the lane walk's own
                // page cap).
                sb.Append("      comments(last: 20) { nodes { body } }\n");
                sb.Append("    }\n");
            }
            sb.Append("  }\n}");

            var (ok, stdout, stderr) = await RunAsync("gh", new[] { "api", "graphql", "-f", "query=" + sb });
            if (!ok)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[batterup.detail] gh api graphql failed for a {batch.Length}-item batch: {stderr.Trim()}");
                foreach (var item in batch) { item.DetailError = stderr.Trim(); item.DetailLoaded = true; }
                continue;
            }

            try
            {
                using var doc = JsonDocument.Parse(stdout);
                if (!doc.RootElement.TryGetProperty("data", out var data) ||
                    !data.TryGetProperty("repository", out var repo) ||
                    repo.ValueKind != JsonValueKind.Object)
                {
                    foreach (var item in batch) { item.DetailError = "unexpected gh graphql response shape"; item.DetailLoaded = true; }
                    continue;
                }

                foreach (var prop in repo.EnumerateObject())
                {
                    if (!prop.Name.StartsWith("i", StringComparison.Ordinal)) continue;
                    if (!int.TryParse(prop.Name.AsSpan(1), out var number)) continue;
                    if (!byNumber.TryGetValue(number, out var item)) continue;

                    if (prop.Value.ValueKind != JsonValueKind.Object)
                    {
                        item.DetailError = "issue not found";
                        item.DetailLoaded = true;
                        continue;
                    }
                    ApplyItemDetail(item, prop.Value);
                }
            }
            catch (Exception ex)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[batterup.detail] couldn't parse gh graphql output: {ex.Message}");
                foreach (var item in batch) { item.DetailError = ex.Message; item.DetailLoaded = true; }
            }
        }
    }

    /// <summary>Applies one issue's real <c>body</c>/<c>labels</c>/<c>comments</c> onto its
    /// <see cref="BatterUpItemRef"/>: the <c>agent-finding</c> label decides the badge; the
    /// most-recent parseable <c>BUILD:</c> comment (see <see cref="ParseBuildComment"/>) supplies
    /// effort + "why it is here"; falling back to the issue body's own lead paragraph when there
    /// is no <c>BUILD:</c> comment yet.</summary>
    private static void ApplyItemDetail(BatterUpItemRef item, JsonElement issueEl)
    {
        string? body = issueEl.TryGetProperty("body", out var bodyEl) && bodyEl.ValueKind == JsonValueKind.String
            ? bodyEl.GetString() : null;

        bool isAgentFinding = false;
        if (issueEl.TryGetProperty("labels", out var labelsEl) &&
            labelsEl.TryGetProperty("nodes", out var labelNodes) &&
            labelNodes.ValueKind == JsonValueKind.Array)
        {
            foreach (var l in labelNodes.EnumerateArray())
            {
                var name = l.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.Equals(name, "agent-finding", StringComparison.OrdinalIgnoreCase)) { isAgentFinding = true; break; }
            }
        }

        string? effort = null;
        string? scope = null;
        if (issueEl.TryGetProperty("comments", out var commentsEl) &&
            commentsEl.TryGetProperty("nodes", out var commentNodes) &&
            commentNodes.ValueKind == JsonValueKind.Array)
        {
            // GraphQL `last: 20` returns oldest→newest within that tail — reverse so a later
            // BUILD: comment (a re-dispatch) is checked, and wins, before an older one. Same
            // most-recent-first convention as BuildConsole's own
            // BatterUpQueueService.FindBuildCommentAsync.
            var bodies = commentNodes.EnumerateArray()
                .Select(c => c.TryGetProperty("body", out var b) ? b.GetString() : null)
                .Where(b => !string.IsNullOrEmpty(b))
                .Reverse();
            foreach (var commentBody in bodies)
            {
                var parsed = ParseBuildComment(commentBody!);
                if (parsed == null) continue;
                effort = parsed.Value.Effort;
                scope = ExtractLeadParagraph(parsed.Value.Prompt);
                break;
            }
        }

        item.IsAgentFinding = isAgentFinding;
        item.Effort = effort;
        item.WhyHere = scope ?? ExtractLeadParagraph(body);
        item.DetailLoaded = true;
    }

    /// <summary>Parses a `BUILD:` comment body — mirrors BuildConsole's own
    /// <c>BatterUpQueueService.ParseBuildComment</c> so ShaneBuilder reads the exact same
    /// `BUILD:`/`Posted:` header convention (CLAUDE.md's "Build-prompt header convention") rather
    /// than growing a second, possibly-drifting parser:
    /// <code>
    /// BUILD: model=claude-sonnet-5 effort=high buildSet=Portal
    /// Posted: 2026-08-31T23:23:47Z
    /// &lt;the rest of the comment is the self-contained prompt&gt;
    /// </code>
    /// The `Posted:` line is optional — a legacy comment written before it was required has none,
    /// and that's not a parse failure, just a null <c>Posted</c>. Returns null if
    /// <paramref name="commentBody"/> has no `BUILD:` header line, or the header line has no
    /// prompt text following it.</summary>
    internal static (string? Model, string? Effort, string? BuildSet, DateTime? Posted, string Prompt)? ParseBuildComment(string commentBody)
    {
        if (string.IsNullOrWhiteSpace(commentBody)) return null;

        var lines = commentBody.Replace("\r\n", "\n").Split('\n');
        int headerIdx = Array.FindIndex(lines, l => l.TrimStart().StartsWith("BUILD:", StringComparison.OrdinalIgnoreCase));
        if (headerIdx < 0) return null;

        var headerLine = lines[headerIdx].TrimStart();
        var afterPrefix = headerLine.Substring(headerLine.IndexOf("BUILD:", StringComparison.OrdinalIgnoreCase) + "BUILD:".Length);

        string? model = null, effort = null, buildSet = null;
        foreach (var token in afterPrefix.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            int eq = token.IndexOf('=');
            if (eq <= 0) continue;
            var key = token.Substring(0, eq).Trim();
            var val = token.Substring(eq + 1).Trim();
            if (val.Length == 0) continue;
            if (string.Equals(key, "model", StringComparison.OrdinalIgnoreCase)) model = val;
            else if (string.Equals(key, "effort", StringComparison.OrdinalIgnoreCase)) effort = val;
            else if (string.Equals(key, "buildSet", StringComparison.OrdinalIgnoreCase)) buildSet = val;
        }

        int promptStartIdx = headerIdx + 1;
        DateTime? posted = null;
        if (promptStartIdx < lines.Length)
        {
            var nextLine = lines[promptStartIdx].TrimStart();
            if (nextLine.StartsWith("Posted:", StringComparison.OrdinalIgnoreCase))
            {
                var postedRaw = nextLine.Substring("Posted:".Length).Trim();
                if (DateTime.TryParse(postedRaw, null,
                    System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                    out var parsedPosted))
                {
                    posted = parsedPosted;
                }
                promptStartIdx++;
            }
        }

        var prompt = string.Join("\n", lines.Skip(promptStartIdx)).Trim();
        if (prompt.Length == 0) return null;

        return (model, effort, buildSet, posted, prompt);
    }

    /// <summary>Git #2359 — the "why it is here" line: the first real prose paragraph of a
    /// `BUILD:` comment's prompt (after its leading `--flag value` header line, per CLAUDE.md's
    /// build-prompt header convention) or of the issue body when there's no `BUILD:` comment yet.
    /// Never invents text — a genuinely empty/whitespace-only input returns null so the caller can
    /// show an honest empty-state line instead.</summary>
    private static string? ExtractLeadParagraph(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        var lines = text.Replace("\r\n", "\n").Split('\n');
        int i = 0;
        while (i < lines.Length && lines[i].Trim().Length == 0) i++;
        // Skip a leading `--flag value ...` line (the build-prompt header convention) — that's
        // launch plumbing, not the real "why it is here" prose.
        if (i < lines.Length && lines[i].TrimStart().StartsWith("--", StringComparison.Ordinal)) i++;
        while (i < lines.Length && lines[i].Trim().Length == 0) i++;

        var paragraph = new List<string>();
        while (i < lines.Length && lines[i].Trim().Length > 0)
        {
            paragraph.Add(lines[i].Trim());
            i++;
        }

        var joined = string.Join(" ", paragraph).Trim();
        return joined.Length == 0 ? null : joined;
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

    // ── Lane-count GraphQL response shape (Git #2356) — ProjectV2.items, backward-paginated ────
    private sealed class LaneGraphQlResponse { [JsonPropertyName("data")] public LaneGraphQlData? Data { get; set; } }
    private sealed class LaneGraphQlData { [JsonPropertyName("node")] public LaneProjectNode? Node { get; set; } }
    private sealed class LaneProjectNode { [JsonPropertyName("items")] public LaneItemConnection? Items { get; set; } }
    private sealed class LaneItemConnection
    {
        [JsonPropertyName("pageInfo")] public LanePageInfo? PageInfo { get; set; }
        [JsonPropertyName("nodes")] public List<LaneItemNode>? Nodes { get; set; }
    }
    private sealed class LanePageInfo
    {
        [JsonPropertyName("hasPreviousPage")] public bool HasPreviousPage { get; set; }
        [JsonPropertyName("startCursor")] public string? StartCursor { get; set; }
    }
    private sealed class LaneItemNode
    {
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("fieldValueByName")] public LaneFieldValue? FieldValueByName { get; set; }
        [JsonPropertyName("content")] public LaneIssueContent? Content { get; set; }
    }
    private sealed class LaneFieldValue { [JsonPropertyName("optionId")] public string? OptionId { get; set; } }
    private sealed class LaneIssueContent
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("repository")] public LaneRepository? Repository { get; set; }
        [JsonPropertyName("parent")] public LaneParentRef? Parent { get; set; }
    }
    private sealed class LaneRepository { [JsonPropertyName("nameWithOwner")] public string? NameWithOwner { get; set; } }
    /// <summary>Git #2357 — the item's real immediate parent (Feature, usually), null when the
    /// issue genuinely has none. Git #2358 — <c>State</c>/<c>Labels</c> added, fetched inline off
    /// this same edge, for the group header's real state pill.</summary>
    private sealed class LaneParentRef
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("labels")] public LaneLabelConnection? Labels { get; set; }
    }
    private sealed class LaneLabelConnection { [JsonPropertyName("nodes")] public List<LaneLabelNode>? Nodes { get; set; } }
    private sealed class LaneLabelNode { [JsonPropertyName("name")] public string Name { get; set; } = ""; }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

/// <summary>One real open GitHub milestone — number/title/counts straight off the REST
/// milestones endpoint, never a hand-picked "flagship" list.</summary>
public sealed class GitPanelMilestone
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public int OpenCount { get; init; }
    public int ClosedCount { get; init; }
}

/// <summary>One node of the Git Panel tree below an epic: a feature (an epic's direct sub-issue)
/// or an issue (a feature's direct sub-issue). Counts are computed from the node's own real
/// children in the same GraphQL response — <see cref="OpenChildCount"/> is open children,
/// <see cref="OpenBugCount"/> is open children carrying the real `bug` label.</summary>
public sealed class GitPanelIssueNode
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public List<string> Labels { get; init; } = new();
    public List<GitPanelIssueNode> Children { get; init; } = new();
    public int OpenChildCount { get; init; }
    public int OpenBugCount { get; init; }
    public bool HasChildren => Children.Count > 0;
}

/// <summary>One ancestor step of a real GitHub sub-issue `parent` chain, top-down.</summary>
public sealed class GitPanelAncestryStep
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
}

/// <summary>Git #2302 — one real "check" on a GATE issue: a direct sub-issue, straight off the
/// same `subIssues` edge the feature tree reads. A gate's own real sub-issue list IS its check
/// list — nothing invented, nothing scored beyond open/closed.</summary>
public sealed class GitGateCheck
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public List<string> Labels { get; init; } = new();
}

/// <summary>One real blocking edge off GitHub's own `dependencies/blocked_by` relationship —
/// <see cref="IsClosed"/> true means the blocker itself is already closed, i.e. a stale edge per
/// the CLAUDE.md Git #1987 guidance ("a closing blocker silently releases everything downstream"
/// — this is what surfaces that here instead of it going unnoticed).</summary>
public sealed class GitGateBlockerEdge
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
}

/// <summary>One real open `Epic:`-titled issue sharing the gate's own milestone and carrying the
/// repo's real `blocked` label — a "blocked critical epic" for this gate, with its actual
/// blocking edge(s) resolved so the panel can show what it's really waiting on, not a guess.</summary>
public sealed class GitGateBlockedEpic
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public List<GitGateBlockerEdge> BlockedBy { get; init; } = new();
}

/// <summary>Git #2302 — everything the Gate peek renders: the gate's own real check list (its
/// sub-issues), the real blocked critical epics sharing its milestone, and when this snapshot was
/// last swept. One <see cref="GitPanelService.GetGateDetailAsync"/> call produces it — "Run
/// Verification Sweep" is calling that method again.</summary>
public sealed class GitGateDetail
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public int? MilestoneNumber { get; init; }
    public string? MilestoneTitle { get; init; }
    public List<GitGateCheck> Checks { get; init; } = new();
    public List<GitGateBlockedEpic> BlockedCriticalEpics { get; init; } = new();
    public DateTime SweptAtUtc { get; init; }
    public int ClosedCheckCount => Checks.Count(c => c.IsClosed);
    public int TotalCheckCount => Checks.Count;
    public int StaleBlockerEdgeCount => BlockedCriticalEpics.Sum(e => e.BlockedBy.Count(b => b.IsClosed));
}

/// <summary>Git #2300 — real derived ancestry for one issue: its own state/labels, its nearest
/// real milestone (its own, or the closest ancestor's), and the full `parent` chain walked
/// top-down. Everything comes from one GraphQL call; nothing is guessed.</summary>
public sealed class GitPanelAncestry
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public List<string> Labels { get; init; } = new();
    public int? MilestoneNumber { get; init; }
    public string? MilestoneTitle { get; init; }
    /// <summary>Ancestors top-down (outermost first), excluding the issue itself.</summary>
    public List<GitPanelAncestryStep> Chain { get; init; } = new();
}

/// <summary>Git #2290 — read-only data layer for the Git Panel navigation shell (Feature #2289
/// items 1-11). Same real fail-closed `gh` shellout pattern <see cref="GitMapService"/> and
/// <see cref="GitIssuesService"/> already established (kept local for the same
/// don't-regress-shipped-surfaces rationale as those two classes' own headers).</summary>
public static class GitPanelService
{
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    private const string Repo = "shanemccaw/Shane-McCaw-MSP";

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Every real open milestone, straight off the REST endpoint (GitHub's own default
    /// due-date/number ordering) — the tree lists them all rather than inventing a favorite.</summary>
    public static async Task<(bool Ok, List<GitPanelMilestone> Milestones, string? Error)> GetOpenMilestonesAsync()
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "api", $"repos/{Owner}/{RepoName}/milestones",
            "--jq", "[.[] | {number, title, open_issues, closed_issues}]"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] milestones fetch failed: {stderr.Trim()}");
            return (false, new List<GitPanelMilestone>(), $"milestones fetch failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<MilestoneRow>>(stdout, JsonOpts) ?? new();
            var milestones = rows.Select(r => new GitPanelMilestone
            {
                Number = r.Number,
                Title = r.Title ?? $"milestone {r.Number}",
                OpenCount = r.OpenIssues,
                ClosedCount = r.ClosedIssues
            }).ToList();
            return (true, milestones, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse milestones: {ex.Message}");
            return (false, new List<GitPanelMilestone>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>Every open issue whose title genuinely starts with "GATE:" — the repo's real gate
    /// convention (#1281, #1269, #1918 as of this build). Search returns anything CONTAINING
    /// "gate"; filtered client-side to a real prefix match, same as GitMapService's epic filter.</summary>
    public static async Task<(bool Ok, List<GitPanelIssueNode> Gates, string? Error)> GetOpenGatesAsync()
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "issue", "list", "--repo", Repo, "--search", "GATE in:title", "--state", "open",
            "--json", "number,title", "--limit", "100"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] gate list failed: {stderr.Trim()}");
            return (false, new List<GitPanelIssueNode>(), $"gate list failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<NumberTitleRow>>(stdout, JsonOpts) ?? new();
            var gates = rows
                .Where(r => (r.Title ?? "").StartsWith("GATE:", StringComparison.OrdinalIgnoreCase))
                .Select(r => new GitPanelIssueNode { Number = r.Number, Title = r.Title ?? $"#{r.Number}" })
                .ToList();
            return (true, gates, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse gate list: {ex.Message}");
            return (false, new List<GitPanelIssueNode>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>One epic's full two-level real sub-tree in a single GraphQL call: its direct
    /// sub-issues (the FEATURE rows) each with their own direct sub-issues (the issue rows),
    /// states and labels included — so a feature row's state pill, bug count and open count
    /// come from the same response that renders it, never a second guessed lookup.
    /// <paramref name="totalCount"/> in the result is GitHub's own real total — #1202 already
    /// sits at 97 direct sub-issues against the 100-per-page GraphQL cap, so the caller shows
    /// the cap honestly when total exceeds what one page returned, rather than silently
    /// truncating.</summary>
    public static async Task<(bool Ok, List<GitPanelIssueNode> Features, int TotalCount, string? Error)> GetFeatureTreeAsync(int epicNumber)
    {
        if (epicNumber <= 0) return (true, new List<GitPanelIssueNode>(), 0, null);

        string query =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + epicNumber + ") { subIssues(first: 100) { totalCount nodes { " +
            "number title state labels(first: 20) { nodes { name } } " +
            "subIssues(first: 100) { nodes { number title state labels(first: 20) { nodes { name } } } } " +
            "} } } } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] feature tree fetch failed for epic #{epicNumber}: {stderr.Trim()}");
            return (false, new List<GitPanelIssueNode>(), 0, $"feature tree fetch failed: {stderr.Trim()}");
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            if (issueEl.ValueKind != JsonValueKind.Object)
                return (true, new List<GitPanelIssueNode>(), 0, null);
            int totalCount = issueEl.GetProperty("subIssues").TryGetProperty("totalCount", out var tc) ? tc.GetInt32() : 0;

            var features = new List<GitPanelIssueNode>();
            foreach (var f in issueEl.GetProperty("subIssues").GetProperty("nodes").EnumerateArray())
            {
                var children = new List<GitPanelIssueNode>();
                if (f.TryGetProperty("subIssues", out var subEl) && subEl.ValueKind == JsonValueKind.Object)
                {
                    foreach (var c in subEl.GetProperty("nodes").EnumerateArray())
                        children.Add(ParseNode(c, new List<GitPanelIssueNode>(), 0, 0));
                }
                int openChildren = children.Count(c => !c.IsClosed);
                int openBugs = children.Count(c => !c.IsClosed && c.Labels.Contains("bug", StringComparer.OrdinalIgnoreCase));
                features.Add(ParseNode(f, children, openChildren, openBugs));
            }
            return (true, features, totalCount, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse feature tree for epic #{epicNumber}: {ex.Message}");
            return (false, new List<GitPanelIssueNode>(), 0, $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>Git #2309 — one feature's own real identity plus its direct sub-issues (one
    /// level), fetched independently of any epic's cached two-level sub-tree so the Feature
    /// detail panel is correct whether opened by drilling the tree (where the owning epic's
    /// fetch already carries this) or by a cold direct open (an alert link, a derived-ancestry
    /// open) that never touched the epic at all. Same one-GraphQL-call, no-second-guessed-lookup
    /// shape as <see cref="GetFeatureTreeAsync"/>.</summary>
    public static async Task<(bool Ok, GitPanelIssueNode? Feature, int TotalCount, string? Error)> GetFeatureDetailAsync(int featureNumber)
    {
        string query =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + featureNumber + ") { number title state labels(first: 20) { nodes { name } } " +
            "subIssues(first: 100) { totalCount nodes { number title state labels(first: 20) { nodes { name } } } } " +
            "} } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] feature detail fetch failed for #{featureNumber}: {stderr.Trim()}");
            return (false, null, 0, $"feature detail fetch failed: {stderr.Trim()}");
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            if (issueEl.ValueKind != JsonValueKind.Object)
                return (false, null, 0, $"feature #{featureNumber} not found");

            int totalCount = issueEl.TryGetProperty("subIssues", out var subsCountEl) && subsCountEl.TryGetProperty("totalCount", out var tc)
                ? tc.GetInt32() : 0;

            var children = new List<GitPanelIssueNode>();
            if (issueEl.TryGetProperty("subIssues", out var subEl) && subEl.ValueKind == JsonValueKind.Object)
                foreach (var c in subEl.GetProperty("nodes").EnumerateArray())
                    children.Add(ParseNode(c, new List<GitPanelIssueNode>(), 0, 0));

            int openChildren = children.Count(c => !c.IsClosed);
            int openBugs = children.Count(c => !c.IsClosed && c.Labels.Contains("bug", StringComparer.OrdinalIgnoreCase));
            var feature = ParseNode(issueEl, children, openChildren, openBugs);
            return (true, feature, totalCount, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse feature detail for #{featureNumber}: {ex.Message}");
            return (false, null, 0, $"couldn't parse gh output: {ex.Message}");
        }
    }

    private static GitPanelIssueNode ParseNode(JsonElement el, List<GitPanelIssueNode> children, int openChildCount, int openBugCount)
    {
        var labels = new List<string>();
        if (el.TryGetProperty("labels", out var labelsEl) && labelsEl.ValueKind == JsonValueKind.Object)
            foreach (var l in labelsEl.GetProperty("nodes").EnumerateArray())
                if (l.TryGetProperty("name", out var nameEl) && nameEl.GetString() is { Length: > 0 } name)
                    labels.Add(name);

        int number = el.GetProperty("number").GetInt32();
        return new GitPanelIssueNode
        {
            Number = number,
            Title = el.TryGetProperty("title", out var t) ? t.GetString() ?? $"#{number}" : $"#{number}",
            IsClosed = el.TryGetProperty("state", out var s) &&
                       string.Equals(s.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase),
            Labels = labels,
            Children = children,
            OpenChildCount = openChildCount,
            OpenBugCount = openBugCount
        };
    }

    /// <summary>Git #2300 — one GraphQL call resolving an issue's own real state/labels/milestone
    /// plus its `parent` chain up to four levels (Issue → Feature → Epic covers the repo's real
    /// depth, with headroom). The milestone is the issue's own, or the nearest ancestor's when the
    /// issue itself has none — genuinely absent everywhere leaves it honestly null.</summary>
    public static async Task<(bool Ok, GitPanelAncestry? Ancestry, string? Error)> GetAncestryAsync(int issueNumber)
    {
        const string fields = "number title state milestone { number title } labels(first: 20) { nodes { name } }";
        string query =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + issueNumber + ") { " + fields +
            " parent { " + fields + " parent { " + fields + " parent { " + fields + " parent { " + fields + " } } } } } } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] ancestry fetch failed for #{issueNumber}: {stderr.Trim()}");
            return (false, null, $"ancestry fetch failed: {stderr.Trim()}");
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            if (issueEl.ValueKind != JsonValueKind.Object)
                return (false, null, $"issue #{issueNumber} not found");

            var labels = new List<string>();
            if (issueEl.TryGetProperty("labels", out var labelsEl) && labelsEl.ValueKind == JsonValueKind.Object)
                foreach (var l in labelsEl.GetProperty("nodes").EnumerateArray())
                    if (l.TryGetProperty("name", out var nameEl) && nameEl.GetString() is { Length: > 0 } name)
                        labels.Add(name);

            // Walk the parent chain bottom-up, remembering each ancestor and the nearest milestone.
            int? msNumber = null;
            string? msTitle = null;
            ReadMilestone(issueEl, ref msNumber, ref msTitle);

            var bottomUp = new List<GitPanelAncestryStep>();
            var current = issueEl;
            while (current.TryGetProperty("parent", out var parentEl) && parentEl.ValueKind == JsonValueKind.Object)
            {
                bottomUp.Add(new GitPanelAncestryStep
                {
                    Number = parentEl.GetProperty("number").GetInt32(),
                    Title = parentEl.TryGetProperty("title", out var pt) ? pt.GetString() ?? "" : ""
                });
                ReadMilestone(parentEl, ref msNumber, ref msTitle);
                current = parentEl;
            }
            bottomUp.Reverse();

            return (true, new GitPanelAncestry
            {
                Number = issueEl.GetProperty("number").GetInt32(),
                Title = issueEl.TryGetProperty("title", out var st) ? st.GetString() ?? $"#{issueNumber}" : $"#{issueNumber}",
                IsClosed = issueEl.TryGetProperty("state", out var stateEl) &&
                           string.Equals(stateEl.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase),
                Labels = labels,
                MilestoneNumber = msNumber,
                MilestoneTitle = msTitle,
                Chain = bottomUp
            }, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse ancestry for #{issueNumber}: {ex.Message}");
            return (false, null, $"couldn't parse gh output: {ex.Message}");
        }
    }

    private static void ReadMilestone(JsonElement issueEl, ref int? number, ref string? title)
    {
        if (number.HasValue) return; // nearest (lowest) milestone wins
        if (issueEl.TryGetProperty("milestone", out var msEl) && msEl.ValueKind == JsonValueKind.Object)
        {
            number = msEl.GetProperty("number").GetInt32();
            title = msEl.TryGetProperty("title", out var t) ? t.GetString() : null;
        }
    }

    /// <summary>Git #2302 — the full real snapshot a Gate peek renders: the gate's own real
    /// sub-issues as its check list (one GraphQL call), plus every real open `Epic:`-titled issue
    /// sharing the gate's milestone that carries the `blocked` label, each resolved against its
    /// actual `dependencies/blocked_by` edge(s) so a stale edge (blocker already closed) is
    /// flagged rather than silently trusted. "Run Verification Sweep" is calling this again.</summary>
    public static async Task<(bool Ok, GitGateDetail? Detail, string? Error)> GetGateDetailAsync(int gateNumber)
    {
        string gateQuery =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + gateNumber + ") { number title milestone { number title } " +
            "subIssues(first: 100) { totalCount nodes { number title state labels(first: 20) { nodes { name } } } } } } }";

        var (gateOk, gateStdout, gateStderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={gateQuery}" });
        if (!gateOk)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] gate detail fetch failed for #{gateNumber}: {gateStderr.Trim()}");
            return (false, null, $"gate detail fetch failed: {gateStderr.Trim()}");
        }

        int? msNumber;
        string? msTitle;
        string gateTitle;
        var checks = new List<GitGateCheck>();
        try
        {
            using var doc = JsonDocument.Parse(gateStdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            if (issueEl.ValueKind != JsonValueKind.Object)
                return (false, null, $"gate issue #{gateNumber} not found");

            gateTitle = issueEl.TryGetProperty("title", out var t) ? t.GetString() ?? $"#{gateNumber}" : $"#{gateNumber}";
            msNumber = null; msTitle = null;
            ReadMilestone(issueEl, ref msNumber, ref msTitle);

            foreach (var c in issueEl.GetProperty("subIssues").GetProperty("nodes").EnumerateArray())
            {
                var labels = new List<string>();
                if (c.TryGetProperty("labels", out var labelsEl) && labelsEl.ValueKind == JsonValueKind.Object)
                    foreach (var l in labelsEl.GetProperty("nodes").EnumerateArray())
                        if (l.TryGetProperty("name", out var nameEl) && nameEl.GetString() is { Length: > 0 } name)
                            labels.Add(name);
                checks.Add(new GitGateCheck
                {
                    Number = c.GetProperty("number").GetInt32(),
                    Title = c.TryGetProperty("title", out var ct) ? ct.GetString() ?? "" : "",
                    IsClosed = c.TryGetProperty("state", out var cs) &&
                               string.Equals(cs.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase),
                    Labels = labels
                });
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse gate detail for #{gateNumber}: {ex.Message}");
            return (false, null, $"couldn't parse gh output: {ex.Message}");
        }

        // Blocked critical epics: real open Epic:-titled issues sharing this gate's milestone,
        // carrying the repo's real `blocked` label. No milestone on the gate means honestly none.
        var blockedEpics = new List<GitGateBlockedEpic>();
        if (msNumber.HasValue)
        {
            var (blOk, blStdout, blStderr) = await RunGhAsync(new[]
            {
                "issue", "list", "--repo", Repo, "--label", "blocked", "--state", "open",
                "--json", "number,title,milestone", "--limit", "100"
            });
            if (!blOk)
            {
                ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] blocked-epics fetch failed for gate #{gateNumber}: {blStderr.Trim()}");
                // A failed leg doesn't fail the whole sweep — checks are still real; report the gap.
            }
            else
            {
                try
                {
                    using var blDoc = JsonDocument.Parse(blStdout);
                    foreach (var el in blDoc.RootElement.EnumerateArray())
                    {
                        var title = el.TryGetProperty("title", out var tt) ? tt.GetString() ?? "" : "";
                        if (!title.TrimStart().StartsWith("epic:", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!el.TryGetProperty("milestone", out var msEl) || msEl.ValueKind != JsonValueKind.Object) continue;
                        if (!msEl.TryGetProperty("number", out var msnEl) || msnEl.GetInt32() != msNumber.Value) continue;

                        int epicNumber = el.GetProperty("number").GetInt32();
                        var edges = await GetBlockedByEdgesAsync(epicNumber);
                        blockedEpics.Add(new GitGateBlockedEpic { Number = epicNumber, Title = title, BlockedBy = edges });
                    }
                }
                catch (Exception ex)
                {
                    ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse blocked-epics list for gate #{gateNumber}: {ex.Message}");
                }
            }
        }

        return (true, new GitGateDetail
        {
            Number = gateNumber,
            Title = gateTitle,
            MilestoneNumber = msNumber,
            MilestoneTitle = msTitle,
            Checks = checks,
            BlockedCriticalEpics = blockedEpics,
            SweptAtUtc = DateTime.UtcNow
        }, null);
    }

    /// <summary>Real `blocked_by` edges for one issue off GitHub's own dependency relationship —
    /// each edge's own real state, so a blocker that already closed (a stale edge, Git #1987)
    /// shows up as such rather than silently trusted.</summary>
    private static async Task<List<GitGateBlockerEdge>> GetBlockedByEdgesAsync(int issueNumber)
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "api", $"repos/{Owner}/{RepoName}/issues/{issueNumber}/dependencies/blocked_by",
            "--jq", "[.[] | {number, title, state}]"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] blocked_by fetch failed for #{issueNumber}: {stderr.Trim()}");
            return new List<GitGateBlockerEdge>();
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<BlockerEdgeRow>>(stdout, JsonOpts) ?? new();
            return rows.Select(r => new GitGateBlockerEdge
            {
                Number = r.Number,
                Title = r.Title ?? $"#{r.Number}",
                IsClosed = string.Equals(r.State, "closed", StringComparison.OrdinalIgnoreCase)
            }).ToList();
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-panel] couldn't parse blocked_by for #{issueNumber}: {ex.Message}");
            return new List<GitGateBlockerEdge>();
        }
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

    private sealed class MilestoneRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("open_issues")] public int OpenIssues { get; set; }
        [JsonPropertyName("closed_issues")] public int ClosedIssues { get; set; }
    }
    private sealed class NumberTitleRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
    }
    private sealed class BlockerEdgeRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
    }
}

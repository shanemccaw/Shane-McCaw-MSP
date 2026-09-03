using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Npgsql;

namespace ShaneBuilder.Services;

/// <summary>Git #2213 — one open "Epic:"/"EPIC:" issue, real title-convention match (not a fixture
/// list). <see cref="IsThisChat"/> is set by the caller against the active tab's derived epic
/// number (§11's existing pattern), never invented here.</summary>
public sealed class GitMapEpic
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsThisChat { get; init; }
    /// <summary>Real GitHub milestone title, or null when the epic genuinely has none set —
    /// never a fabricated default, per Git #2203's "Git Epics" palette category.</summary>
    public string? Milestone { get; init; }
}

/// <summary>One real sub-issue ("feature") of an epic, straight off GitHub's own sub_issues edge —
/// same relationship BuildConsole's Git Board reads, same relationship the CLAUDE.md "leaf issue,
/// never an epic" build-dispatch rule is written against.</summary>
public sealed class GitMapFeature
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public bool IsClosed { get; init; }
    public bool IsInFlight { get; init; }
    public bool IsBlocked { get; init; }
    public bool IsComplete { get; init; }
    /// <summary>Git #2308 — real overlay applied AFTER fetch (never fetched inline here, to keep
    /// this class's own real cost bounded): the real GitHub Project Status field reads "Park", or
    /// this feature's real row in <c>shanebuilder_feature_flags</c> has <c>paused = true</c>. Set
    /// by whichever caller resolved it (Epic panel's own load, Git Map's own load) — mutable
    /// (not <c>init</c>) so the same already-fetched list can be overlaid in place rather than
    /// re-fetched, single-sourced per this file's own header.</summary>
    public bool IsParked { get; set; }
    public bool IsPaused { get; set; }
    /// <summary>Git #2314 — real closed count of this feature's OWN sub-issues (its "gaps"), off
    /// GitHub's <c>subIssues</c> edge, same edge <see cref="GitEpicPanelService"/>'s epic-detail
    /// query already reads one level deeper. Zero for a childless feature — see
    /// <see cref="TotalCount"/> for the "IS the atomic work item" case, same convention
    /// <c>GitEpicFeature.Leaves</c> already uses.</summary>
    public int ClosedCount { get; init; }
    /// <summary>Real total sub-issue count off GitHub's own <c>subIssues.totalCount</c> — exact
    /// even beyond the first 100 nodes fetched for <see cref="ClosedCount"/>. Zero means this
    /// feature has no sub-issues of its own; the feature itself is then the one atomic unit
    /// (already covered by <see cref="IsClosed"/>), not a burndown gap.</summary>
    public int TotalCount { get; init; }
    /// <summary>Real fraction closed of <see cref="TotalCount"/>, for a burndown bar/ring. Null
    /// when the feature has no sub-issues of its own — an honest "no burndown here", never a
    /// fabricated 0% or 100%.</summary>
    public double? BurndownFraction => TotalCount > 0 ? (double)ClosedCount / TotalCount : (double?)null;
    /// <summary>Git #2317 — real GraphQL <c>createdAt</c>/<c>updatedAt</c> off this same fetch, used
    /// only to compute <see cref="StuckReason"/>'s staleness leg. Never rendered directly.</summary>
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
    /// <summary>Git #2317 — real "why is this stuck" reasoning for one open issue, off real signals
    /// only: an actual open <c>blocked_by</c> dependency edge (when this feature carries the real
    /// `blocked` label — see <see cref="Services.GitEpicPanelService.GetBlockedByAsync"/>), or real
    /// GraphQL staleness (<see cref="CreatedAt"/>/<see cref="UpdatedAt"/> against
    /// <see cref="Services.GitPanelService.StallThresholdDays"/>, the same threshold the Milestone
    /// panel's own stalled-feature detector already uses) when it isn't blocked. Null is a genuine
    /// "not stuck" — recently touched, unblocked — never a fabricated placeholder. Set by
    /// <see cref="GitMapService.OverlayStuckReasonsAsync"/> AFTER fetch (same overlay convention as
    /// <see cref="IsParked"/>/<see cref="IsPaused"/> above), so this same already-fetched list can be
    /// annotated in place rather than re-fetched.</summary>
    public string? StuckReason { get; set; }
}

/// <summary>Git #2315 — one real mirrored feature pair between Customer Portal (EPIC #1485) and
/// MSP / Portal Admin (EPIC #1571), matched by real title-token correspondence off each epic's own
/// established naming convention — sub-issues titled "Feature: &lt;name&gt; (Portal)" on one side and
/// "Feature: &lt;name&gt; (MSP Console)" on the other (confirmed live: #1486/#1681 "Change Control",
/// #1487/#1682 "Risk Register / RBD", etc). Not a fabricated pairing table — <see cref="MatchScore"/>
/// is the real Jaccard token-overlap score <see cref="GitMapService"/> computed to produce this pair,
/// so a partial-name match (e.g. "Microsoft Changes / Message Center" ↔ "Microsoft Changes") stays
/// visibly distinct from an exact one.</summary>
public sealed class GitMapMirroredPair
{
    public int PortalNumber { get; init; }
    public string PortalTitle { get; init; } = "";
    public bool PortalClosed { get; init; }
    public int AdminNumber { get; init; }
    public string AdminTitle { get; init; } = "";
    public bool AdminClosed { get; init; }
    public double MatchScore { get; init; }
}

/// <summary>The real, currently in-flight feature under one epic — "Focus Build" per §6.5's mini
/// panel description. Null when no feature in that epic currently carries the real `in-flight`
/// GitHub label AND no feature is currently Parked either (an honest empty state, never a
/// fabricated placeholder build). Git #2316: when nothing is in-flight but a feature in the epic
/// IS Parked (real Project Status="Park" overlay, same one <see cref="GitEpicPanelService"/>'s
/// Park/Pause actions write), that parked feature rides the same card instead of the epic simply
/// going blank — with <see cref="ParkReason"/> pulled from its own real latest "Parked: …" issue
/// comment, never invented.</summary>
public sealed class GitMapFocusBuild
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public int EpicNumber { get; init; }
    /// <summary>Real open sub-issue count of this feature ("gap count" — findings/children still
    /// open underneath it). Zero for an ordinary leaf feature; that is an honest zero, not a miss.</summary>
    public int OpenGapCount { get; init; }
    /// <summary>Real <c>bt_build_queue.status</c> for this issue's most recent row, if the local
    /// build tracker has one — <c>null</c> when it doesn't (never fabricated). No live cross-process
    /// step/total % is readable here: BuildConsole's <c>BuildProgressTracker</c> is in-process memory
    /// only (verified — no Postgres/file persistence), so this reports real coarse queue status
    /// instead of guessing a percentage.</summary>
    public string? BuildQueueStatus { get; init; }
    /// <summary>Git #2316 — true when this card represents a Parked feature rather than a real
    /// in-flight one (real GitHub Project Status="Park", same state <see cref="GitMapFeature.IsParked"/>
    /// carries elsewhere). False for the ordinary in-flight case.</summary>
    public bool IsParked { get; init; }
    /// <summary>Git #2316 — the real reason text, pulled from this feature issue's own most recent
    /// comment starting with "Parked:" (written by <see cref="GitEpicPanelService.PostParkReasonCommentAsync"/>
    /// when Shane parks a feature and gives a reason). Null when the feature is parked but no such
    /// comment exists — an honest "no reason recorded", never a fabricated one.</summary>
    public string? ParkReason { get; init; }
}

/// <summary>One real abandoned-in-place item: a `build-journal/&lt;n&gt;.md` bookend whose own last
/// `Status:` line is still ⏳ IN FLIGHT / 🛑 BLOCKED (never flipped to ✅ DONE) for an issue that is
/// still OPEN on GitHub — genuinely started, genuinely not finished, not merely closed-with-a-stale-
/// bookend. <see cref="BuildsSince"/> is a real count of other builds (`bt_build_queue` status='done')
/// that completed after this bookend's own last git-committed touch.</summary>
public sealed class GitMapDroppedItem
{
    public int Number { get; init; }
    public string Title { get; init; } = "";
    public DateTimeOffset LastTouchedAtUtc { get; init; }
    public int BuildsSince { get; init; }
}

public sealed class GitMapPendingQuestion
{
    public string FromLabel { get; init; } = "";
    public string QuestionText { get; init; } = "";
}

/// <summary>Git #2213 — the single-sourced Git Map snapshot for one epic-scoped chat. Both the mini
/// rail panel and the full Git Map document render off THIS SAME object (via
/// <see cref="GitMapService.BuildAsync"/>/<see cref="GitMapService.GetFeaturesForEpicAsync"/>) — no
/// second data path. The doc that would define the full document's own distinct layout
/// (`README-ClaudeChat.md`) does not exist in the repo (real audit, tracked at #2227); this shape
/// carries only what #2213's own issue body actually specifies for the mini panel.</summary>
public sealed class GitMapData
{
    public List<GitMapEpic> Epics { get; init; } = new();
    public GitMapFocusBuild? FocusBuild { get; init; }
    public List<GitMapDroppedItem> Dropped { get; init; } = new();
    /// <summary>Git #2315 — real matched pairs between EPIC #1485 (Portal) and EPIC #1571 (Portal
    /// Admin). Global, not epic-scoped — same convention as <see cref="Dropped"/>.</summary>
    public List<GitMapMirroredPair> MirroredPairs { get; init; } = new();
    /// <summary>Real "Feature: …" sub-issues under #1485 that found no matching #1571 counterpart —
    /// an honest gap list, not silently dropped.</summary>
    public List<GitMapFeature> UnmirroredPortalFeatures { get; init; } = new();
    /// <summary>Same as <see cref="UnmirroredPortalFeatures"/>, the #1571 side.</summary>
    public List<GitMapFeature> UnmirroredAdminFeatures { get; init; } = new();
    public bool GitHubReachable { get; init; } = true;
    public string? GitHubError { get; init; }

    public static readonly GitMapData Empty = new();
}

/// <summary>
/// Git #2213 — read-only data layer for Git Map. Real audit findings that shaped this:
///  • <c>bt_epics</c>/<c>bt_issues</c> (the local Postgres mirror BuildConsole's Git Board reads) are
///    STALE — last <c>updated_at</c> 2026-08-17, and #2198 (created 2026-09-01/02, this very epic)
///    isn't in <c>bt_epics</c> at all. Not used here; every epic/feature read goes straight to live
///    `gh`, same fail-closed shellout pattern <see cref="ChatGitHubFilter"/> already established
///    for #2197.
///  • BuildConsole's <c>BuildProgressTracker</c> (step/total % for an in-flight build) is verified
///    in-process memory only — no Postgres or file persistence — so it is NOT cross-process readable
///    from ShaneBuilder. Focus Build reports real `bt_build_queue.status` instead of a guessed %.
///  • `bt_build_queue.status` values are lowercase (`done`, `queued`, `running`, …), not the
///    capitalized display labels the UI shows elsewhere — queried as stored.
/// </summary>
public static class GitMapService
{
    private const string Owner = "shanemccaw";
    private const string RepoName = "Shane-McCaw-MSP";
    private const string Repo = "shanemccaw/Shane-McCaw-MSP";

    /// <summary>Git #2315 — the two real epic numbers CLAUDE.md's own area-epic routing table names
    /// for these two surfaces ("EPIC: Portal" / "EPIC: Portal Admin"), not invented here.</summary>
    public const int PortalEpicNumber = 1485;
    public const int AdminEpicNumber = 1571;

    private static readonly Regex EpicTitlePrefix = new(@"^epic:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FeatureTitlePrefix = new(@"^feature:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FeatureTitleSuffix = new(@"\s*\((Portal|MSP Console)\)\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WordPattern = new(@"[A-Za-z0-9]+", RegexOptions.Compiled);
    private static readonly HashSet<string> MirrorStopwords = new(StringComparer.OrdinalIgnoreCase) { "and", "or", "the", "of", "for", "a", "an" };
    private const double MirrorMatchThreshold = 0.5;
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Every open issue whose title genuinely starts with "Epic:"/"EPIC:" — the repo's own
    /// real naming convention (confirmed against CLAUDE.md's area-epic routing table and the live
    /// issue list), not a fabricated registry. GitHub full-text search returns false positives (any
    /// title merely CONTAINING "epic" — e.g. "…select epics)…"); filtered client-side to a real
    /// prefix match.</summary>
    public static async Task<(bool Ok, List<GitMapEpic> Epics, string? Error)> GetOpenEpicsAsync(int? thisChatEpic)
    {
        var (ok, stdout, stderr) = await RunGhAsync(
            new[] { "issue", "list", "--repo", Repo, "--search", "Epic in:title", "--state", "open", "--json", "number,title,milestone", "--limit", "200" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] gh issue list (epics) failed: {stderr.Trim()}");
            return (false, new List<GitMapEpic>(), $"gh issue list failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<NumberTitleRow>>(stdout, JsonOpts) ?? new();
            var epics = rows
                .Where(r => EpicTitlePrefix.IsMatch(r.Title ?? ""))
                .Select(r => new GitMapEpic
                {
                    Number = r.Number,
                    Title = r.Title ?? $"#{r.Number}",
                    IsThisChat = thisChatEpic.HasValue && r.Number == thisChatEpic.Value,
                    Milestone = r.Milestone?.Title
                })
                .OrderByDescending(e => e.IsThisChat)
                .ThenBy(e => e.Title, StringComparer.OrdinalIgnoreCase)
                .ToList();
            return (true, epics, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] couldn't parse gh epics output: {ex.Message}");
            return (false, new List<GitMapEpic>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>One epic's real sub-issues ("features"), straight off GitHub's own sub_issues edge —
    /// the SAME call both the mini panel's expand action and the full document's feature list use
    /// (single-source, per #2213's hard constraint). Labels come back in the same response, so
    /// in-flight/blocked/complete are real per-feature state, not a second lookup per card.
    /// Git #2314 — also pulls each feature's OWN one-level-deeper <c>subIssues</c> (real closed/
    /// total counts for the per-feature burndown), via GraphQL in this same one call rather than
    /// an N+1 REST round-trip per feature — the same nested-<c>subIssues</c> shape
    /// <see cref="GitEpicPanelService.GetEpicDetailAsync"/> already reads one level deeper.</summary>
    public static async Task<(bool Ok, List<GitMapFeature> Features, string? Error)> GetFeaturesForEpicAsync(int epicNumber)
    {
        if (epicNumber <= 0) return (true, new List<GitMapFeature>(), null);

        string query =
            "query { repository(owner: \"" + Owner + "\", name: \"" + RepoName + "\") { " +
            "issue(number: " + epicNumber + ") { subIssues(first: 100) { nodes { " +
            "number title state createdAt updatedAt labels(first: 20) { nodes { name } } " +
            "subIssues(first: 100) { totalCount nodes { state } } " +
            "} } } } }";

        var (ok, stdout, stderr) = await RunGhAsync(new[] { "api", "graphql", "-f", $"query={query}" });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] sub_issues fetch failed for epic #{epicNumber}: {stderr.Trim()}");
            return (false, new List<GitMapFeature>(), $"sub_issues fetch failed: {stderr.Trim()}");
        }
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            var issueEl = doc.RootElement.GetProperty("data").GetProperty("repository").GetProperty("issue");
            var features = new List<GitMapFeature>();
            if (issueEl.ValueKind == JsonValueKind.Object && issueEl.TryGetProperty("subIssues", out var subEl) && subEl.ValueKind == JsonValueKind.Object)
            {
                foreach (var f in subEl.GetProperty("nodes").EnumerateArray())
                {
                    int number = f.GetProperty("number").GetInt32();
                    string title = f.TryGetProperty("title", out var t) ? t.GetString() ?? $"#{number}" : $"#{number}";
                    bool closed = f.TryGetProperty("state", out var st) && string.Equals(st.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase);
                    var labels = new List<string>();
                    if (f.TryGetProperty("labels", out var labelsEl) && labelsEl.TryGetProperty("nodes", out var labelNodes))
                        foreach (var l in labelNodes.EnumerateArray())
                            if (l.TryGetProperty("name", out var ln) && ln.GetString() is string name) labels.Add(name);

                    int totalCount = 0, closedCount = 0;
                    if (f.TryGetProperty("subIssues", out var childEl) && childEl.ValueKind == JsonValueKind.Object)
                    {
                        totalCount = childEl.TryGetProperty("totalCount", out var tc) ? tc.GetInt32() : 0;
                        if (childEl.TryGetProperty("nodes", out var childNodes))
                            closedCount = childNodes.EnumerateArray().Count(c =>
                                c.TryGetProperty("state", out var cs) && string.Equals(cs.GetString(), "CLOSED", StringComparison.OrdinalIgnoreCase));
                    }

                    DateTimeOffset? createdAt = f.TryGetProperty("createdAt", out var caEl) && caEl.ValueKind == JsonValueKind.String
                        && DateTimeOffset.TryParse(caEl.GetString(), out var ca) ? ca : (DateTimeOffset?)null;
                    DateTimeOffset? updatedAt = f.TryGetProperty("updatedAt", out var uaEl) && uaEl.ValueKind == JsonValueKind.String
                        && DateTimeOffset.TryParse(uaEl.GetString(), out var ua) ? ua : (DateTimeOffset?)null;

                    features.Add(new GitMapFeature
                    {
                        Number = number,
                        Title = title,
                        IsClosed = closed,
                        IsInFlight = !closed && labels.Contains("in-flight", StringComparer.OrdinalIgnoreCase),
                        IsBlocked = !closed && labels.Contains("blocked", StringComparer.OrdinalIgnoreCase),
                        IsComplete = labels.Contains("complete", StringComparer.OrdinalIgnoreCase),
                        ClosedCount = closedCount,
                        TotalCount = totalCount,
                        CreatedAt = createdAt,
                        UpdatedAt = updatedAt,
                    });
                }
            }
            return (true, features, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] couldn't parse sub_issues for epic #{epicNumber}: {ex.Message}");
            return (false, new List<GitMapFeature>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>Git #2315 — real token set for one "Feature: …" title, used for mirror matching:
    /// strips the "Feature: " prefix and the trailing "(Portal)"/"(MSP Console)" suffix, then splits
    /// the remaining real name into lowercase word tokens, dropping stopwords. No fabricated
    /// synonym table — the two epics' own title text is the only input.</summary>
    private static HashSet<string> MirrorTokens(string title)
    {
        var stripped = FeatureTitleSuffix.Replace(FeatureTitlePrefix.Replace(title, ""), "");
        return WordPattern.Matches(stripped)
            .Select(m => m.Value.ToLowerInvariant())
            .Where(w => !MirrorStopwords.Contains(w))
            .ToHashSet();
    }

    /// <summary>Real Jaccard token-overlap score (|A∩B| / |A∪B|) between two title token sets — the
    /// actual similarity metric behind every mirrored pair, not a fixed synonym lookup.</summary>
    private static double MirrorJaccard(HashSet<string> a, HashSet<string> b)
    {
        if (a.Count == 0 || b.Count == 0) return 0;
        int union = a.Union(b).Count();
        if (union == 0) return 0;
        return (double)a.Intersect(b).Count() / union;
    }

    /// <summary>Git #2315 — real stable mutual-best pairing between EPIC #1485's and EPIC #1571's own
    /// "Feature: …" sub-issues, off real title-token overlap (see <see cref="MirrorTokens"/> /
    /// <see cref="MirrorJaccard"/>) — no fabricated pairing table. A pair only forms when each side's
    /// own best-scoring counterpart on the other side is genuinely each other, at or above
    /// <see cref="MirrorMatchThreshold"/>; everything else is reported honestly as unmirrored rather
    /// than force-matched.</summary>
    private static (List<GitMapMirroredPair> Pairs, List<GitMapFeature> UnmatchedPortal, List<GitMapFeature> UnmatchedAdmin)
        ComputeMirroredPairs(List<GitMapFeature> portalFeatures, List<GitMapFeature> adminFeatures)
    {
        var portalNamed = portalFeatures.Where(f => FeatureTitlePrefix.IsMatch(f.Title)).ToList();
        var adminNamed = adminFeatures.Where(f => FeatureTitlePrefix.IsMatch(f.Title)).ToList();

        var portalTokens = portalNamed.ToDictionary(f => f.Number, f => MirrorTokens(f.Title));
        var adminTokens = adminNamed.ToDictionary(f => f.Number, f => MirrorTokens(f.Title));

        var pairs = new List<GitMapMirroredPair>();
        foreach (var pf in portalNamed)
        {
            GitMapFeature? bestAdmin = null;
            double bestScore = 0;
            foreach (var af in adminNamed)
            {
                double score = MirrorJaccard(portalTokens[pf.Number], adminTokens[af.Number]);
                if (score > bestScore) { bestScore = score; bestAdmin = af; }
            }
            if (bestAdmin == null || bestScore < MirrorMatchThreshold) continue;

            // Mutual-best check: does that admin feature's own best portal match point back at pf?
            GitMapFeature? bestPortalForAdmin = null;
            double bestReverseScore = 0;
            foreach (var pf2 in portalNamed)
            {
                double score = MirrorJaccard(portalTokens[pf2.Number], adminTokens[bestAdmin.Number]);
                if (score > bestReverseScore) { bestReverseScore = score; bestPortalForAdmin = pf2; }
            }
            if (bestPortalForAdmin == null || bestPortalForAdmin.Number != pf.Number) continue;

            pairs.Add(new GitMapMirroredPair
            {
                PortalNumber = pf.Number, PortalTitle = pf.Title, PortalClosed = pf.IsClosed,
                AdminNumber = bestAdmin.Number, AdminTitle = bestAdmin.Title, AdminClosed = bestAdmin.IsClosed,
                MatchScore = bestScore,
            });
        }

        var pairedPortal = pairs.Select(p => p.PortalNumber).ToHashSet();
        var pairedAdmin = pairs.Select(p => p.AdminNumber).ToHashSet();
        var unmatchedPortal = portalNamed.Where(f => !pairedPortal.Contains(f.Number))
            .OrderBy(f => f.Title, StringComparer.OrdinalIgnoreCase).ToList();
        var unmatchedAdmin = adminNamed.Where(f => !pairedAdmin.Contains(f.Number))
            .OrderBy(f => f.Title, StringComparer.OrdinalIgnoreCase).ToList();

        return (pairs.OrderBy(p => p.PortalTitle, StringComparer.OrdinalIgnoreCase).ToList(), unmatchedPortal, unmatchedAdmin);
    }

    /// <summary>Git #2315 — the real mirrored-pair snapshot between EPIC #1485 (Portal) and EPIC
    /// #1571 (Portal Admin), fetched fresh off each epic's own real sub-issues (reuses
    /// <see cref="GetFeaturesForEpicAsync"/>, same single fetch path everything else here uses).</summary>
    public static async Task<(bool Ok, List<GitMapMirroredPair> Pairs, List<GitMapFeature> UnmatchedPortal, List<GitMapFeature> UnmatchedAdmin, string? Error)> GetMirroredPairsAsync()
    {
        var (portalOk, portalFeatures, portalError) = await GetFeaturesForEpicAsync(PortalEpicNumber);
        if (!portalOk) return (false, new(), new(), new(), portalError);
        var (adminOk, adminFeatures, adminError) = await GetFeaturesForEpicAsync(AdminEpicNumber);
        if (!adminOk) return (false, new(), new(), new(), adminError);

        var (pairs, unmatchedPortal, unmatchedAdmin) = ComputeMirroredPairs(portalFeatures, adminFeatures);
        return (true, pairs, unmatchedPortal, unmatchedAdmin, null);
    }

    /// <summary>Git #2317 — real per-issue "why is this stuck" overlay, applied AFTER fetch (same
    /// convention as <see cref="OverlayParkPauseAsync"/> in <see cref="GitEpicPanelService"/>): the
    /// same already-fetched feature list is annotated in place, no re-fetch. Only OPEN features are
    /// considered — a closed one is done, not stuck. Two real signals, checked in order:
    ///  1. Blocked label set → real `blocked_by` dependency lookup (one REST call per blocked
    ///     feature — bounded, since `blocked` is a real, sparse label, not every open feature).
    ///     An open blocker names it. A `blocked` label with no real open blocked_by edge is flagged
    ///     as a stale label (mirrors the exact wording <c>MainWindow.GitPanel.cs</c>'s gate-check
    ///     already uses for the same real gap).
    ///  2. Not blocked → real GraphQL staleness: <see cref="GitMapFeature.CreatedAt"/> old enough
    ///     and <see cref="GitMapFeature.UpdatedAt"/> stale past <see cref="GitPanelService.StallThresholdDays"/>
    ///     (the same 21-day threshold the Milestone panel's own stalled-feature detector already
    ///     uses — one real threshold, not a second invented one).
    /// Anything else (recently touched, unblocked) gets a null reason — a genuine "not stuck",
    /// never a fabricated placeholder.</summary>
    public static async Task OverlayStuckReasonsAsync(List<GitMapFeature> features)
    {
        var now = DateTimeOffset.UtcNow;
        var stallCutoff = now.AddDays(-GitPanelService.StallThresholdDays);

        foreach (var f in features)
        {
            if (f.IsClosed) continue;

            if (f.IsBlocked)
            {
                try
                {
                    var (ok, blockers, error) = await GitEpicPanelService.GetBlockedByAsync(f.Number);
                    if (!ok)
                    {
                        f.StuckReason = $"blocked label set — blocked_by lookup failed ({error})";
                        continue;
                    }
                    var openBlockers = blockers.Where(b => !b.IsClosed).ToList();
                    if (openBlockers.Count == 0)
                    {
                        f.StuckReason = "blocked label set, but no real open blocked_by edge — stale label?";
                    }
                    else if (openBlockers.Count == 1)
                    {
                        f.StuckReason = $"blocked by #{openBlockers[0].Number} — {openBlockers[0].Title}";
                    }
                    else
                    {
                        f.StuckReason = $"blocked by #{openBlockers[0].Number} — {openBlockers[0].Title} (+{openBlockers.Count - 1} more)";
                    }
                }
                catch (Exception ex)
                {
                    ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] stuck-reason blocked_by lookup failed for #{f.Number}: {ex.Message}");
                    f.StuckReason = "blocked label set — blocked_by lookup failed";
                }
                continue;
            }

            bool oldEnough = f.CreatedAt.HasValue && f.CreatedAt.Value <= stallCutoff;
            bool stale = !f.UpdatedAt.HasValue || f.UpdatedAt.Value <= stallCutoff;
            if (oldEnough && stale)
            {
                int daysSince = f.UpdatedAt.HasValue ? (int)(now - f.UpdatedAt.Value).TotalDays : GitPanelService.StallThresholdDays;
                f.StuckReason = $"no activity in {daysSince}d";
            }
        }
    }

    /// <summary>The active chat epic's real Focus Build: the one sub-issue (if any) currently
    /// carrying the `in-flight` label. Real open-child ("gap") count comes from that feature's OWN
    /// sub_issues; real queue status comes from ShaneBuilder's read-only <c>bt_build_queue</c> lookup
    /// (most recent row for that issue number). Multiple in-flight siblings — real, has happened — are
    /// reported as a count rather than silently picking one.
    ///
    /// Git #2316: when nothing is in-flight, falls back to the epic's real Parked feature (if any —
    /// real GitHub Project Status="Park" overlay, <see cref="GitEpicPanelService.OverlayParkPauseAsync"/>,
    /// the same call Git Map's own epic rows already make) so its real parking reason still rides this
    /// same card instead of the section just reading "nothing in flight".</summary>
    private static async Task<GitMapFocusBuild?> ResolveFocusBuildAsync(int epicNumber, List<GitMapFeature> epicFeatures, ChatReadClient? db)
    {
        var inFlight = epicFeatures.Where(f => f.IsInFlight).ToList();
        GitMapFeature f;
        bool parked;
        if (inFlight.Count > 0)
        {
            f = inFlight[0]; // real tie-break: first by GitHub's own sub_issues ordering, not invented ranking
            parked = false;
        }
        else
        {
            try { await GitEpicPanelService.OverlayParkPauseAsync(epicFeatures, null); }
            catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] park overlay failed for epic #{epicNumber}: {ex.Message}"); }

            var parkedFeatures = epicFeatures.Where(x => x.IsParked && !x.IsClosed).ToList();
            if (parkedFeatures.Count == 0) return null;
            f = parkedFeatures[0]; // real tie-break: first by GitHub's own sub_issues ordering, not invented ranking
            parked = true;
        }

        int gapCount = 0;
        try
        {
            var (ok, features, _) = await GetFeaturesForEpicAsync(f.Number);
            if (ok) gapCount = features.Count(c => !c.IsClosed);
        }
        catch { /* gap count is metadata-only; a lookup miss stays 0, not fatal */ }

        string? queueStatus = null;
        if (db != null)
        {
            try { queueStatus = await db.GetMostRecentBuildQueueStatusAsync(f.Number); }
            catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] build_queue status lookup failed for #{f.Number}: {ex.Message}"); }
        }

        string? parkReason = null;
        if (parked)
        {
            try { parkReason = await GetLatestParkReasonAsync(f.Number); }
            catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] park reason lookup failed for #{f.Number}: {ex.Message}"); }
        }

        return new GitMapFocusBuild
        {
            Number = f.Number,
            Title = f.Title,
            EpicNumber = epicNumber,
            OpenGapCount = gapCount,
            BuildQueueStatus = queueStatus,
            IsParked = parked,
            ParkReason = parkReason,
        };
    }

    /// <summary>Git #2316 — the real reason text behind a feature's Park, sourced from that issue's
    /// own most recent comment starting with "Parked:" (written by
    /// <see cref="GitEpicPanelService.PostParkReasonCommentAsync"/> when Park is invoked with a
    /// reason). Returns null on no such comment or a lookup failure — an honest empty, never a
    /// fabricated placeholder reason.</summary>
    private static async Task<string?> GetLatestParkReasonAsync(int issueNumber)
    {
        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "api", $"repos/{Owner}/{RepoName}/issues/{issueNumber}/comments",
            "--jq", "[.[] | select(.body | test(\"^Parked:\"; \"i\")) | .body][-1]",
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] park reason comment lookup failed for #{issueNumber}: {stderr.Trim()}");
            return null;
        }

        var text = stdout.Trim();
        if (string.IsNullOrEmpty(text) || text == "null") return null;

        var idx = text.IndexOf(':');
        return (idx >= 0 && idx < text.Length - 1 ? text[(idx + 1)..] : text).Trim();
    }

    /// <summary>Real "Started-and-Dropped" scan: every `build-journal/&lt;n&gt;.md` whose own last
    /// `Status:` line is not ✅ DONE, for an issue GitHub still shows OPEN (a bookend left stale on an
    /// issue already closed elsewhere is bookend housekeeping, not abandoned work — excluded). Global
    /// across epics, not epic-filtered: a dropped item's owning top-level epic can only be found by
    /// walking an arbitrary-depth GitHub `parent` chain per item, not worth the API cost for what is
    /// typically a handful of real rows. `BuildsSince` is a real count of `bt_build_queue` rows with
    /// `status='done'` and `completed_at` after this bookend file's own last git-committed touch.</summary>
    public static async Task<List<GitMapDroppedItem>> GetStartedAndDroppedAsync(string repoRoot, ChatReadClient? db, int maxItems = 5)
    {
        var result = new List<GitMapDroppedItem>();
        var journalDir = System.IO.Path.Combine(repoRoot, "build-journal");
        if (!System.IO.Directory.Exists(journalDir)) return result;

        var candidates = new List<(int Number, string Title, string Path)>();
        foreach (var path in System.IO.Directory.EnumerateFiles(journalDir, "*.md"))
        {
            var fileName = System.IO.Path.GetFileNameWithoutExtension(path);
            if (!int.TryParse(fileName, out var number)) continue; // README.md / letter-id local work — skip
            string text;
            try { text = await System.IO.File.ReadAllTextAsync(path); } catch { continue; }

            var statusLines = Regex.Matches(text, @"^\s*-?\s*\*\*Status:\*\*\s*(.+)$", RegexOptions.Multiline);
            if (statusLines.Count == 0) continue;
            var lastStatus = statusLines[^1].Groups[1].Value;
            bool isDone = lastStatus.Contains("DONE", StringComparison.OrdinalIgnoreCase);
            if (isDone) continue;

            var titleMatch = Regex.Match(text, @"^#\s*#?\d+\s*[—-]\s*(.+)$", RegexOptions.Multiline);
            string title = titleMatch.Success ? titleMatch.Groups[1].Value.Trim() : $"#{number}";
            candidates.Add((number, title, path));
        }
        if (candidates.Count == 0) return result;

        foreach (var (number, title, path) in candidates)
        {
            bool isOpen;
            try
            {
                var (ok, stdout, _) = await RunGhAsync(new[] { "issue", "view", number.ToString(), "--repo", Repo, "--json", "state" });
                if (!ok) continue; // fail-closed: unreachable state → not confidently "dropped", skip rather than guess
                var row = JsonSerializer.Deserialize<StateRow>(stdout, JsonOpts);
                isOpen = string.Equals(row?.State, "open", StringComparison.OrdinalIgnoreCase);
            }
            catch { continue; }
            if (!isOpen) continue; // closed elsewhere — stale bookend housekeeping, not abandoned work

            var lastTouch = await GitLastCommitTimeAsync(repoRoot, path);
            if (lastTouch == null) continue;

            int buildsSince = 0;
            if (db != null)
            {
                try { buildsSince = await db.CountDoneBuildsSinceAsync(lastTouch.Value); }
                catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] builds-since count failed for #{number}: {ex.Message}"); }
            }

            result.Add(new GitMapDroppedItem { Number = number, Title = title, LastTouchedAtUtc = lastTouch.Value, BuildsSince = buildsSince });
        }

        return result.OrderByDescending(d => d.BuildsSince).Take(maxItems).ToList();
    }

    private static async Task<DateTimeOffset?> GitLastCommitTimeAsync(string repoRoot, string filePath)
    {
        var relative = System.IO.Path.GetRelativePath(repoRoot, filePath).Replace('\\', '/');
        var (ok, stdout, _) = await RunProcessAsync("git", new[] { "log", "-1", "--format=%aI", "--", relative }, repoRoot);
        if (!ok) return null;
        var text = stdout.Trim();
        return DateTimeOffset.TryParse(text, out var dt) ? dt : (DateTimeOffset?)null;
    }

    /// <summary>Top-level orchestration: one epic-scoped snapshot. Global sections (Started-and-Dropped)
    /// are fetched once and shared across every epic view in the session — callers cache this, they
    /// don't re-fetch per render.</summary>
    public static async Task<GitMapData> BuildAsync(int? thisChatEpic, string repoRoot, ChatReadClient? db)
    {
        var (epicsOk, epics, epicsError) = await GetOpenEpicsAsync(thisChatEpic);
        if (!epicsOk)
            return new GitMapData { Epics = new List<GitMapEpic>(), GitHubReachable = false, GitHubError = epicsError };

        GitMapFocusBuild? focus = null;
        if (thisChatEpic.HasValue)
        {
            var (featOk, features, _) = await GetFeaturesForEpicAsync(thisChatEpic.Value);
            if (featOk) focus = await ResolveFocusBuildAsync(thisChatEpic.Value, features, db);
        }

        var dropped = await GetStartedAndDroppedAsync(repoRoot, db);

        var mirroredPairs = new List<GitMapMirroredPair>();
        var unmirroredPortal = new List<GitMapFeature>();
        var unmirroredAdmin = new List<GitMapFeature>();
        try
        {
            var (mirrorOk, pairs, unPortal, unAdmin, mirrorError) = await GetMirroredPairsAsync();
            if (mirrorOk) { mirroredPairs = pairs; unmirroredPortal = unPortal; unmirroredAdmin = unAdmin; }
            else ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] mirrored-pair fetch failed: {mirrorError}");
        }
        catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] mirrored-pair fetch threw: {ex.Message}"); }

        return new GitMapData
        {
            Epics = epics, FocusBuild = focus, Dropped = dropped, GitHubReachable = true,
            MirroredPairs = mirroredPairs, UnmirroredPortalFeatures = unmirroredPortal, UnmirroredAdminFeatures = unmirroredAdmin,
        };
    }

    // ── gh / git process runner (mirrors ChatGitHubFilter's proven RunAsync — kept local rather
    // than shared so this feature can't regress #2209's already-shipped chat dock). ──────────────
    private static Task<(bool Ok, string StdOut, string StdErr)> RunGhAsync(string[] args, int timeoutMs = 30000)
        => RunProcessAsync("gh", args, workingDirectory: null, timeoutMs);

    private static async Task<(bool Ok, string StdOut, string StdErr)> RunProcessAsync(string fileName, string[] args, string? workingDirectory, int timeoutMs = 15000)
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
        if (!string.IsNullOrEmpty(workingDirectory)) psi.WorkingDirectory = workingDirectory;
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

    private sealed class NumberTitleRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("milestone")] public MilestoneRow? Milestone { get; set; }
    }
    private sealed class MilestoneRow
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
    }
    private sealed class StateRow { [JsonPropertyName("state")] public string? State { get; set; } }
}

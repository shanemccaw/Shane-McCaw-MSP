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
}

/// <summary>The real, currently in-flight feature under one epic — "Focus Build" per §6.5's mini
/// panel description. Null when no feature in that epic currently carries the real `in-flight`
/// GitHub label (an honest empty state, never a fabricated placeholder build).</summary>
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

    private static readonly Regex EpicTitlePrefix = new(@"^epic:\s*", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Every open issue whose title genuinely starts with "Epic:"/"EPIC:" — the repo's own
    /// real naming convention (confirmed against CLAUDE.md's area-epic routing table and the live
    /// issue list), not a fabricated registry. GitHub full-text search returns false positives (any
    /// title merely CONTAINING "epic" — e.g. "…select epics)…"); filtered client-side to a real
    /// prefix match.</summary>
    public static async Task<(bool Ok, List<GitMapEpic> Epics, string? Error)> GetOpenEpicsAsync(int? thisChatEpic)
    {
        var (ok, stdout, stderr) = await RunGhAsync(
            new[] { "issue", "list", "--repo", Repo, "--search", "Epic in:title", "--state", "open", "--json", "number,title", "--limit", "200" });
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
                .Select(r => new GitMapEpic { Number = r.Number, Title = r.Title ?? $"#{r.Number}", IsThisChat = thisChatEpic.HasValue && r.Number == thisChatEpic.Value })
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
    /// in-flight/blocked/complete are real per-feature state, not a second lookup per card.</summary>
    public static async Task<(bool Ok, List<GitMapFeature> Features, string? Error)> GetFeaturesForEpicAsync(int epicNumber)
    {
        if (epicNumber <= 0) return (true, new List<GitMapFeature>(), null);

        var (ok, stdout, stderr) = await RunGhAsync(new[]
        {
            "api", $"repos/{Owner}/{RepoName}/issues/{epicNumber}/sub_issues",
            "--jq", "[.[] | {number, title, state, labels: [.labels[].name]}]"
        });
        if (!ok)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] sub_issues fetch failed for epic #{epicNumber}: {stderr.Trim()}");
            return (false, new List<GitMapFeature>(), $"sub_issues fetch failed: {stderr.Trim()}");
        }
        try
        {
            var rows = JsonSerializer.Deserialize<List<SubIssueRow>>(stdout, JsonOpts) ?? new();
            var features = rows.Select(r =>
            {
                var labels = r.Labels ?? new List<string>();
                bool closed = string.Equals(r.State, "closed", StringComparison.OrdinalIgnoreCase);
                return new GitMapFeature
                {
                    Number = r.Number,
                    Title = r.Title ?? $"#{r.Number}",
                    IsClosed = closed,
                    IsInFlight = !closed && labels.Contains("in-flight", StringComparer.OrdinalIgnoreCase),
                    IsBlocked = !closed && labels.Contains("blocked", StringComparer.OrdinalIgnoreCase),
                    IsComplete = labels.Contains("complete", StringComparer.OrdinalIgnoreCase),
                };
            }).ToList();
            return (true, features, null);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[git-map] couldn't parse sub_issues for epic #{epicNumber}: {ex.Message}");
            return (false, new List<GitMapFeature>(), $"couldn't parse gh output: {ex.Message}");
        }
    }

    /// <summary>The active chat epic's real Focus Build: the one sub-issue (if any) currently
    /// carrying the `in-flight` label. Real open-child ("gap") count comes from that feature's OWN
    /// sub_issues; real queue status comes from ShaneBuilder's read-only <c>bt_build_queue</c> lookup
    /// (most recent row for that issue number). Multiple in-flight siblings — real, has happened — are
    /// reported as a count rather than silently picking one.</summary>
    private static async Task<GitMapFocusBuild?> ResolveFocusBuildAsync(int epicNumber, List<GitMapFeature> epicFeatures, ChatReadClient? db)
    {
        var inFlight = epicFeatures.Where(f => f.IsInFlight).ToList();
        if (inFlight.Count == 0) return null;
        var f = inFlight[0]; // real tie-break: first by GitHub's own sub_issues ordering, not invented ranking

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

        return new GitMapFocusBuild
        {
            Number = f.Number,
            Title = f.Title,
            EpicNumber = epicNumber,
            OpenGapCount = gapCount,
            BuildQueueStatus = queueStatus,
        };
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

        return new GitMapData { Epics = epics, FocusBuild = focus, Dropped = dropped, GitHubReachable = true };
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
    }
    private sealed class StateRow { [JsonPropertyName("state")] public string? State { get; set; } }
    private sealed class SubIssueRow
    {
        [JsonPropertyName("number")] public int Number { get; set; }
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("state")] public string? State { get; set; }
        [JsonPropertyName("labels")] public List<string>? Labels { get; set; }
    }
}

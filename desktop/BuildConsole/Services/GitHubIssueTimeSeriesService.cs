using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2711 (Home dashboard foundation) — one real day in the issue history of a
    /// scope (the whole repo, a Milestone, or an Epic's issue set). Every number is a
    /// real count derived from real GitHub open/close timestamps
    /// (<see cref="GitBoardIssue.CreatedAt"/> / <see cref="GitBoardIssue.ClosedAt"/>),
    /// never interpolated or smoothed.
    /// </summary>
    public sealed class IssueTimeSeriesPoint
    {
        /// <summary>The calendar day (UTC) this point describes.</summary>
        public DateOnly Date { get; init; }
        /// <summary>Issues in scope that were OPENED on this day (real <c>created_at</c> date).</summary>
        public int Opened { get; init; }
        /// <summary>Issues in scope that were CLOSED on this day (real <c>closed_at</c> date).</summary>
        public int Closed { get; init; }
        /// <summary>Running number of issues in scope that are still open at the END of this day
        /// (cumulative opened − cumulative closed). Kept for callers that still want a raw
        /// open-count (e.g. a "N open now" readout), but this is NOT a real burndown value —
        /// with growing scope it trends up, not down (Git #2721).</summary>
        public int OpenCount { get; init; }
        /// <summary>Running total of issues in scope closed up to and including this day. The real
        /// cumulative-closed series a pace/ETA projection (#2714) fits its slope against, and the
        /// real "Completed" line of the #2721 burn-up chart.</summary>
        public int ClosedCumulative { get; init; }
        /// <summary>Running total of issues in scope opened up to and including this day — the real
        /// cumulative scope size at the end of this day. This is the real "Total Scope" line of the
        /// #2721 burn-up chart (a true burndown assumes ~fixed scope; this milestone's scope keeps
        /// growing via real ongoing issue filing, so the honest chart is scope-vs-completed, not a
        /// single open-count line trending toward zero).</summary>
        public int CumulativeOpened { get; init; }
    }

    /// <summary>
    /// Git #2711 — a real daily open/close time series for one scope, plus an explicit
    /// fail-closed signal. When <see cref="HasEnoughData"/> is false the series carries an
    /// honest <see cref="Reason"/> (GitHub unreachable, or too little real history) and the
    /// consumer must render an honest empty/"not enough data" state — never a fabricated
    /// curve. <see cref="Points"/> is still populated with whatever real data exists so a
    /// consumer that only needs a laxer gate (e.g. a single real day) can apply its own,
    /// but the default <see cref="HasEnoughData"/> is the shared, conservative threshold.
    ///
    /// This is the one shared foundational data shape the three sibling issues
    /// (#2712 burndown, #2713 open/close-rate crossing, #2714 Epic/Milestone ETA) all
    /// consume directly.
    /// </summary>
    public sealed class IssueTimeSeries
    {
        /// <summary>Human-readable label for the scope (e.g. "v1.1 - Monitoring & Launch Control"
        /// or "#1096 EPIC: Application Core"), for chart titles / logs.</summary>
        public string ScopeLabel { get; init; } = "";
        /// <summary>True iff the series has enough real history to be meaningful (see
        /// <see cref="GitHubIssueTimeSeriesService.MinSpanDays"/> / <see cref="GitHubIssueTimeSeriesService.MinActivityDays"/>).</summary>
        public bool HasEnoughData { get; init; }
        /// <summary>When <see cref="HasEnoughData"/> is false, the honest reason — never null in that case.</summary>
        public string? Reason { get; init; }
        /// <summary>The real per-day series, oldest day first. Contiguous (gap days carry the running
        /// count forward with zero opened/closed — that's real "nothing happened," not interpolation).</summary>
        public IReadOnlyList<IssueTimeSeriesPoint> Points { get; init; } = Array.Empty<IssueTimeSeriesPoint>();
        /// <summary>First day in the series (earliest real creation date in scope), or null when empty.</summary>
        public DateOnly? FirstDate { get; init; }
        /// <summary>Last day in the series (today, UTC), or null when empty.</summary>
        public DateOnly? LastDate { get; init; }
        /// <summary>Total real issues in this scope.</summary>
        public int TotalIssues { get; init; }
        /// <summary>Real issues in scope still open right now (== the last point's <see cref="IssueTimeSeriesPoint.OpenCount"/>).</summary>
        public int CurrentOpen { get; init; }
        /// <summary>Real issues in scope closed so far (== the last point's <see cref="IssueTimeSeriesPoint.ClosedCumulative"/>).</summary>
        public int CurrentClosed { get; init; }
        /// <summary>Number of distinct days on which anything real happened (an open or a close).</summary>
        public int DistinctActivityDays { get; init; }
        /// <summary>Inclusive span of the series in days (LastDate − FirstDate + 1), or 0 when empty.</summary>
        public int SpanDays { get; init; }

        /// <summary>Builds an honest "not enough data" result carrying the reason and whatever real
        /// scope metadata is known — never a fabricated series.</summary>
        public static IssueTimeSeries NotEnough(string scopeLabel, string reason, int totalIssues = 0,
            IReadOnlyList<IssueTimeSeriesPoint>? points = null, DateOnly? first = null, DateOnly? last = null,
            int currentOpen = 0, int currentClosed = 0, int distinctActivityDays = 0, int spanDays = 0) => new()
        {
            ScopeLabel = scopeLabel,
            HasEnoughData = false,
            Reason = reason,
            TotalIssues = totalIssues,
            Points = points ?? Array.Empty<IssueTimeSeriesPoint>(),
            FirstDate = first,
            LastDate = last,
            CurrentOpen = currentOpen,
            CurrentClosed = currentClosed,
            DistinctActivityDays = distinctActivityDays,
            SpanDays = spanDays,
        };
    }

    /// <summary>Git #2711 — outcome of the real, cached "all issues (open + closed, with
    /// timestamps)" fetch, with an explicit <see cref="Success"/> flag so a caller can fail
    /// closed on an unreachable GitHub instead of mistaking it for "no issues" — the same
    /// discipline <see cref="LiveOpenIssuesResult"/> already applies to the dispatch gate.</summary>
    public sealed class IssueFetchResult
    {
        public bool Success { get; init; }
        public string? Error { get; init; }
        public IReadOnlyList<GitBoardIssue> Issues { get; init; } = Array.Empty<GitBoardIssue>();

        public static IssueFetchResult Ok(IReadOnlyList<GitBoardIssue> issues) => new() { Success = true, Issues = issues };
        public static IssueFetchResult Failure(string error) => new() { Success = false, Error = error };
    }

    /// <summary>Git #2711 — the resolved "active" GitHub Milestone (the one the Home dashboard
    /// charts default to), plus its real open/closed issue counts straight off GitHub's own
    /// milestone object.</summary>
    public sealed class ActiveMilestone
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public int OpenIssues { get; init; }
        public int ClosedIssues { get; init; }
        public int TotalIssues => OpenIssues + ClosedIssues;
    }

    /// <summary>
    /// Git #2711 (Home dashboard foundation) — the one real, shared data source the Home
    /// progress-dashboard children (#2712 burndown, #2713 open/close-rate crossing chart,
    /// #2714 Epic/Milestone ETA projections) all consume. It:
    ///
    ///   1. fetches every real repo issue ONCE (open + closed) via
    ///      <see cref="GitHubApiClient.ListBoardIssuesAsync"/> with the new #2711
    ///      <c>createdAt</c>/<c>closedAt</c> timestamps, cached with a real TTL so it doesn't
    ///      refetch on every UI tick but still reflects newly-closed issues reasonably promptly;
    ///   2. reduces that into a real per-day open/close series (opened/day, closed/day, running
    ///      open-count, cumulative closed), scoped by Milestone or by Epic — the two real
    ///      groupings the children need;
    ///   3. fails closed: when GitHub is unreachable, no PAT is configured, or a scope has too
    ///      little real history, it returns an honest <see cref="IssueTimeSeries.HasEnoughData"/>
    ///      == false with a real <see cref="IssueTimeSeries.Reason"/> — never a smoothed or
    ///      interpolated series.
    ///
    /// The daily-reduction core (<see cref="BuildSeries"/>) is a pure static function so it's
    /// independently verifiable and each child can also apply it to a custom issue scope.
    /// </summary>
    public static class GitHubIssueTimeSeriesService
    {
        /// <summary>How long the "all issues" fetch is cached before a background read refetches.
        /// Historical data doesn't change per-tick, but a just-closed issue should surface within
        /// a few minutes — 5 minutes balances both (a manual refresh can force it sooner).</summary>
        public static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

        /// <summary>A scope needs at least this many inclusive days of span before its series is
        /// trusted as "enough data" — one or two same-day points can't show a real trend.</summary>
        public const int MinSpanDays = 2;

        /// <summary>A scope needs at least this many distinct days on which a real open/close
        /// happened before its series is trusted — guards a scope whose issues all landed on one day.</summary>
        public const int MinActivityDays = 2;

        // Runaway guard on the day loop — the repo is under two years old, so 20 years of days is
        // absurd headroom; it exists only so a corrupt/future timestamp can't spin an unbounded loop.
        private const int MaxSeriesDays = 366 * 20;

        private static readonly object _lock = new();
        private static DateTime _cacheFetchedUtc = DateTime.MinValue;
        private static List<GitBoardIssue>? _cache;

        /// <summary>
        /// Every real repo issue (open + closed) with its #2711 open/close timestamps, cached for
        /// <see cref="CacheTtl"/>. <paramref name="forceRefresh"/> bypasses the TTL (the Home
        /// dashboard's manual refresh). Fails closed with <see cref="IssueFetchResult.Failure"/>
        /// on a missing PAT or an unreachable/failed GitHub call rather than returning an empty
        /// set that a caller could mistake for "no issues."
        /// </summary>
        public static async Task<IssueFetchResult> GetAllIssuesAsync(bool forceRefresh = false)
        {
            if (!forceRefresh)
            {
                lock (_lock)
                {
                    if (_cache != null && DateTime.UtcNow - _cacheFetchedUtc < CacheTtl)
                        return IssueFetchResult.Ok(_cache);
                }
            }

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
                return IssueFetchResult.Failure("no GitHub PAT configured (Settings → GitHub) — can't build the issue time series.");

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                // ALL states: the time series needs every issue's real created date (opened/day) AND
                // every closed issue's real closed date (closed/day) to reconstruct the true history.
                var issues = await client.ListBoardIssuesAsync(GitHubIssueState.All);
                lock (_lock)
                {
                    _cache = issues;
                    _cacheFetchedUtc = DateTime.UtcNow;
                }
                ActivityLog.Log("git-board.data",
                    $"issue time-series fetch: {issues.Count} real issue(s) (open+closed) loaded with created/closed timestamps; cached for {CacheTtl.TotalMinutes:0}m.");
                return IssueFetchResult.Ok(issues);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-board.data", $"issue time-series fetch failed (fail-closed, no fabricated series): {ex.Message}");
                return IssueFetchResult.Failure($"GitHub fetch failed: {ex.Message}");
            }
        }

        /// <summary>
        /// The pure daily-reduction core. Turns a set of real issues (each carrying
        /// <see cref="GitBoardIssue.CreatedAt"/>, and <see cref="GitBoardIssue.ClosedAt"/> when
        /// closed) into a contiguous per-day series from the earliest real creation date through
        /// <paramref name="nowUtc"/>'s date. Gap days carry the running counts forward with zero
        /// opened/closed — real "nothing happened," not interpolation. Returns an honest
        /// <see cref="IssueTimeSeries.HasEnoughData"/> == false when the scope is empty or its
        /// real history is too thin (see <see cref="MinSpanDays"/> / <see cref="MinActivityDays"/>).
        /// Static and pure so it's independently verifiable and reusable on any custom scope.
        ///
        /// Git #2739 — <paramref name="scopedIssues"/> is filtered down to real work
        /// (<see cref="GitBoardIssueFilters.CountsAsRealWork"/>) BEFORE reducing into the daily
        /// series: Epic/Feature placeholder issues and anything owned by an internal-tooling Epic
        /// (#1202/#1095) never contribute an opened/closed day, so they can't skew the burndown,
        /// open/close-rate, or ETA panels that consume this series' output. <paramref name="allIssuesForAncestry"/>
        /// is the caller's full (ideally ALL-states) issue set used only to resolve the
        /// internal-tooling-Epic ancestor climb for issues whose parent chain reaches outside
        /// <paramref name="scopedIssues"/> itself; defaults to <paramref name="scopedIssues"/> when
        /// the caller has nothing broader on hand.
        /// </summary>
        public static IssueTimeSeries BuildSeries(IReadOnlyList<GitBoardIssue> scopedIssues, string scopeLabel, DateTime nowUtc,
            IReadOnlyList<GitBoardIssue>? allIssuesForAncestry = null)
        {
            var byNumber = GitBoardIssueFilters.BuildByNumberLookup(allIssuesForAncestry ?? scopedIssues);
            var realWork = scopedIssues.Where(i => GitBoardIssueFilters.CountsAsRealWork(i, byNumber)).ToList();

            // Only issues with a real creation timestamp can contribute — createdAt is always
            // present on a real GitHub issue, so a null here means the field wasn't fetched; skip
            // defensively rather than inventing a date.
            var withCreate = realWork.Where(i => i.CreatedAt.HasValue).ToList();
            int total = withCreate.Count;
            if (total == 0)
                return IssueTimeSeries.NotEnough(scopeLabel, "no real issues with creation timestamps in this scope yet.");

            var today = DateOnly.FromDateTime(nowUtc.ToUniversalTime());

            // Bucket real open/close events by UTC calendar day.
            var openedByDay = new Dictionary<DateOnly, int>();
            var closedByDay = new Dictionary<DateOnly, int>();
            DateOnly first = today;
            DateOnly lastEvent = DateOnly.MinValue;
            int currentClosed = 0;

            foreach (var issue in withCreate)
            {
                var created = DateOnly.FromDateTime(issue.CreatedAt!.Value.UtcDateTime);
                if (created < first) first = created;
                if (created > lastEvent) lastEvent = created;
                openedByDay[created] = openedByDay.GetValueOrDefault(created) + 1;

                if (issue.ClosedAt.HasValue)
                {
                    var closed = DateOnly.FromDateTime(issue.ClosedAt.Value.UtcDateTime);
                    // A close can't logically precede an open; clamp defensively so a bad timestamp
                    // can't push the running open-count negative.
                    if (closed < created) closed = created;
                    if (closed > lastEvent) lastEvent = closed;
                    closedByDay[closed] = closedByDay.GetValueOrDefault(closed) + 1;
                    currentClosed++;
                }
            }

            // The series runs from the first real creation to today (or the latest event, whichever
            // is later — a clock skew where an event post-dates "today" shouldn't truncate it).
            DateOnly last = today > lastEvent ? today : lastEvent;

            var points = new List<IssueTimeSeriesPoint>();
            int cumulativeOpened = 0, cumulativeClosed = 0, activityDays = 0, dayGuard = 0;
            for (var day = first; day <= last; day = day.AddDays(1))
            {
                if (++dayGuard > MaxSeriesDays) break; // runaway guard (corrupt/future timestamp)
                int opened = openedByDay.GetValueOrDefault(day);
                int closed = closedByDay.GetValueOrDefault(day);
                cumulativeOpened += opened;
                cumulativeClosed += closed;
                if (opened > 0 || closed > 0) activityDays++;
                points.Add(new IssueTimeSeriesPoint
                {
                    Date = day,
                    Opened = opened,
                    Closed = closed,
                    OpenCount = cumulativeOpened - cumulativeClosed,
                    ClosedCumulative = cumulativeClosed,
                    CumulativeOpened = cumulativeOpened,
                });
            }

            int spanDays = points.Count;
            int currentOpen = total - currentClosed;

            if (spanDays < MinSpanDays)
                return IssueTimeSeries.NotEnough(scopeLabel,
                    $"history only spans {spanDays} day(s) (< {MinSpanDays}) — too short to trust a trend.",
                    total, points, first, last, currentOpen, currentClosed, activityDays, spanDays);
            if (activityDays < MinActivityDays)
                return IssueTimeSeries.NotEnough(scopeLabel,
                    $"only {activityDays} day(s) of real open/close activity (< {MinActivityDays}) — not enough to trust a trend.",
                    total, points, first, last, currentOpen, currentClosed, activityDays, spanDays);

            return new IssueTimeSeries
            {
                ScopeLabel = scopeLabel,
                HasEnoughData = true,
                Points = points,
                FirstDate = first,
                LastDate = last,
                TotalIssues = total,
                CurrentOpen = currentOpen,
                CurrentClosed = currentClosed,
                DistinctActivityDays = activityDays,
                SpanDays = spanDays,
            };
        }

        /// <summary>Real daily series scoped to one GitHub Milestone (by number). The board fetch's
        /// own transitive milestone-inheritance (Git #2543) means a sub-issue that belongs to its
        /// epic's milestone is counted here even when its own milestone field is blank.</summary>
        public static async Task<IssueTimeSeries> GetMilestoneSeriesAsync(int milestoneNumber, string? milestoneTitle = null, bool forceRefresh = false)
        {
            string label = milestoneTitle ?? $"Milestone #{milestoneNumber}";
            var fetch = await GetAllIssuesAsync(forceRefresh);
            if (!fetch.Success)
                return IssueTimeSeries.NotEnough(label, $"GitHub unreachable: {fetch.Error}");

            var scoped = fetch.Issues.Where(i => i.MilestoneNumber == milestoneNumber).ToList();
            return BuildSeries(scoped, label, DateTime.UtcNow, fetch.Issues);
        }

        /// <summary>Real daily series scoped to one Epic's issue set — every transitive descendant
        /// (children, their children, …) of <paramref name="epicNumber"/> that's present in the
        /// fetch, excluding the Epic node itself (a container, not a work item). This is the
        /// per-Epic scope #2714's ETA projection consumes.</summary>
        public static async Task<IssueTimeSeries> GetEpicSeriesAsync(int epicNumber, bool forceRefresh = false)
        {
            var fetch = await GetAllIssuesAsync(forceRefresh);
            var epicTitle = fetch.Issues.FirstOrDefault(i => i.Number == epicNumber)?.Title;
            string label = epicTitle != null ? $"#{epicNumber} {epicTitle}" : $"Epic #{epicNumber}";
            if (!fetch.Success)
                return IssueTimeSeries.NotEnough(label, $"GitHub unreachable: {fetch.Error}");

            var descendants = GitBoardIssueFilters.CollectDescendants(fetch.Issues, epicNumber);
            return BuildSeries(descendants, label, DateTime.UtcNow, fetch.Issues);
        }

        /// <summary>The open Epics (Git #839 definition: top-level issue with ≥1 sub-issue) that
        /// belong to <paramref name="milestoneNumber"/>, so #2714 can produce one real ETA per Epic.
        /// Empty on an unreachable GitHub (fail-closed — the caller sees no epics rather than a wrong set).
        /// Git #2739 — excludes the internal-tooling Epics themselves (#1202/#1095): they're not
        /// customer-facing product work, so Home dashboard shouldn't project an ETA card for them
        /// (their own real descendant series is already filtered to empty by <see cref="BuildSeries"/>
        /// anyway; excluding the row itself avoids rendering an empty/misleading card for it).</summary>
        public static async Task<List<GitBoardIssue>> GetOpenEpicsInMilestoneAsync(int milestoneNumber, bool forceRefresh = false)
        {
            var fetch = await GetAllIssuesAsync(forceRefresh);
            if (!fetch.Success) return new List<GitBoardIssue>();
            return fetch.Issues
                .Where(i => i.IsEpic && !i.IsClosed && i.MilestoneNumber == milestoneNumber
                            && !GitBoardIssueFilters.InternalToolingEpicNumbers.Contains(i.Number))
                .OrderBy(i => i.Number)
                .ToList();
        }

        /// <summary>
        /// Resolves the real "active" GitHub Milestone the Home dashboard defaults to: among OPEN
        /// milestones, the one with the most total (open + closed) real issues — the one actually
        /// being worked. Reads GitHub's own milestone object counts, never a label. Returns null
        /// when no PAT is configured, GitHub is unreachable, or no open milestone has any issues
        /// (all fail-closed — the caller shows an honest empty state, not a guessed milestone).
        /// </summary>
        public static async Task<ActiveMilestone?> ResolveActiveMilestoneAsync()
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var milestones = await client.GetMilestonesAsync();
                var best = milestones
                    .Where(m => !m.IsClosed && (m.OpenIssues + m.ClosedIssues) > 0)
                    .OrderByDescending(m => m.OpenIssues + m.ClosedIssues)
                    .FirstOrDefault();
                if (best == null) return null;
                return new ActiveMilestone
                {
                    Number = best.Number,
                    Title = best.Title,
                    OpenIssues = best.OpenIssues,
                    ClosedIssues = best.ClosedIssues,
                };
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-board.data", $"active-milestone resolution failed (fail-closed): {ex.Message}");
                return null;
            }
        }

        /// <summary>Convenience: the real daily series for whatever <see cref="ResolveActiveMilestoneAsync"/>
        /// picks as the active milestone. Fails closed with an honest reason when no active milestone
        /// resolves.</summary>
        public static async Task<IssueTimeSeries> GetActiveMilestoneSeriesAsync(bool forceRefresh = false)
        {
            var active = await ResolveActiveMilestoneAsync();
            if (active == null)
                return IssueTimeSeries.NotEnough("Active milestone",
                    "no active GitHub milestone could be resolved (no PAT, GitHub unreachable, or no open milestone has issues).");
            return await GetMilestoneSeriesAsync(active.Number, active.Title, forceRefresh);
        }

    }
}

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
    ///
    /// Git #3577 — Shane's final decision (2026-09-11): the Home dashboard's own scope/burndown
    /// consumers (<see cref="GetMilestoneSeriesAsync"/>, <see cref="GetEpicSeriesAsync"/>,
    /// <see cref="GetActiveMilestoneSeriesAsync"/>, <see cref="GetOpenEpicsAsync"/>,
    /// <see cref="GetOpenEpicsInMilestoneAsync"/>, <see cref="ResolveActiveMilestoneAsync"/> — every
    /// one of them confirmed via repo-wide grep to have no caller outside the Home dashboard) read
    /// ONLY the local <c>bt_issue_mirror</c>/<c>bt_milestone_mirror</c> tables, never a live GitHub
    /// call, under any circumstance — unlike the general-purpose <see cref="GetAllIssuesAsync"/>
    /// above (still shared by Focus Mode / the Git Board tree / editor-panes stats, which are NOT
    /// in this issue's scope and keep their existing live-fallback behavior). Before drawing
    /// anything, each Home method runs a real completeness check — bt_issue_mirror's own count for
    /// that scope against an authoritative real aggregate — and returns an honest
    /// <see cref="IssueTimeSeries.HasEnoughData"/> == false with the real reason when the mirror is
    /// confirmed incomplete for that scope, rather than a technically-real-but-partial curve.
    /// </summary>
    public static class GitHubIssueTimeSeriesService
    {
        /// <summary>Git #2776 — one real, open Epic offered in the Home dashboard's per-Epic
        /// burndown picker, plus its real open-real-work count (used only to pick a sensible
        /// default selection, never faked).</summary>
        public sealed class EpicOption
        {
            public int Number { get; init; }
            public string Title { get; init; } = "";
            public int OpenRealWork { get; init; }
        }

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

                // Git #3359 read the whole issue set (open + closed, each with its real created/closed
                // timestamps) from the local mirror instead of a live ALL-states GraphQL walk, exactly
                // like #3358 did for the Git Board tree — removing Home's own per-5-min live walk from
                // GitHub's secondary-rate-limit budget.
                //
                // Git #3512 — serve from the mirror whenever it has completed at least one full sync
                // (HasUsableDataAsync), WITHOUT also requiring HasClosedBackfillAsync. That second gate
                // is exactly what perpetuated the 7-day rate-limit storm this issue exists to end:
                // under an OPEN secondary-rate-limit circuit the closed backfill can never run (it is
                // itself circuit-gated), so this method fell through to a live ~35-page
                // ListBoardIssuesAsync(All) walk — and because a FAILED live walk never populates the
                // 5-minute cache below, the 1-minute _editorPanesStatsTimer re-fired that whole walk
                // EVERY minute. That burst pinned the secondary limit, kept the circuit open, kept the
                // backfill skipped, kept this gate false — a self-perpetuating loop (the second-opinion
                // investigation's confirmed root cause). The mirror's closed set may be briefly
                // truncated until the once/24h backfill (MaybeBackfillClosedIssuesAsync) lands, but the
                // incremental since= pass already captures today's closures with real closed_at, and a
                // slightly-short historical closed line on the Home burndown is far better than a storm
                // that also silences Batter Up overnight. It self-heals the moment the circuit recovers
                // and the backfill runs its one walk. A miss/never-synced/error returns null and falls
                // through to the (now circuit-guarded) live path, so this can never be worse than today.
                if (await GitHubIssueMirror.HasUsableDataAsync())
                {
                    var served = await TryServeFromMirrorAsync();
                    if (served != null) return IssueFetchResult.Ok(served);
                }
            }

            // Live fallback — reached only when the mirror has no usable data yet (a true cold start,
            // before the first full sync) or on a manual forceRefresh. Git #3512 — NEVER fire the live
            // ~35-page ListBoardIssuesAsync(All) walk while the rate-limit circuit is OPEN: that live
            // walk IS the storm. Serve the best real data we have instead — a stale-but-real cache, or
            // the mirror even without the closed backfill — and only fail closed when there is
            // genuinely nothing to serve. (forceRefresh is honoured only when the circuit is closed;
            // you cannot force a fetch through an open rate limit — the mirror is the freshest data
            // obtainable at that moment.)
            if (GitHubRateLimitCircuit.IsOpen)
            {
                lock (_lock)
                {
                    if (_cache != null)
                    {
                        ActivityLog.Log("git-board.data",
                            $"issue time-series fetch: rate-limit circuit open ({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left) — serving the last cached {_cache.Count} issue(s) rather than firing a live ALL walk (Git #3512).");
                        return IssueFetchResult.Ok(_cache);
                    }
                }
                var served = await TryServeFromMirrorAsync();
                if (served != null)
                {
                    ActivityLog.Log("git-board.data",
                        $"issue time-series fetch: rate-limit circuit open — served {served.Count} issue(s) from the local mirror rather than firing a live ALL walk (Git #3512).");
                    return IssueFetchResult.Ok(served);
                }
                return IssueFetchResult.Failure(
                    $"GitHub rate-limit circuit open ({GitHubRateLimitCircuit.RemainingOpenSeconds()}s left) and the local mirror has no usable data yet — no live ALL walk fired (Git #3512).");
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
                // Git #3512 — a live walk that throws (e.g. a rate-limit response that trips the circuit
                // mid-walk) must not blank the Home dashboard when we still hold real data: prefer a
                // stale-but-real cache, then the mirror, before failing closed.
                lock (_lock)
                {
                    if (_cache != null)
                    {
                        ActivityLog.Log("git-board.data",
                            $"issue time-series fetch: live ALL walk failed ({ex.Message}) — serving the last cached {_cache.Count} issue(s) instead of failing closed (Git #3512).");
                        return IssueFetchResult.Ok(_cache);
                    }
                }
                var served = await TryServeFromMirrorAsync();
                if (served != null)
                {
                    ActivityLog.Log("git-board.data",
                        $"issue time-series fetch: live ALL walk failed ({ex.Message}) — served {served.Count} issue(s) from the local mirror instead of failing closed (Git #3512).");
                    return IssueFetchResult.Ok(served);
                }
                ActivityLog.Log("git-board.data", $"issue time-series fetch failed (fail-closed, no fabricated series): {ex.Message}");
                return IssueFetchResult.Failure($"GitHub fetch failed: {ex.Message}");
            }
        }

        /// <summary>Git #3512 — read the whole issue set (open + closed) from the local mirror and
        /// refresh the in-memory cache. Returns null on a mirror miss / never-synced / error, so the
        /// caller decides the fallback. Logs whether the closed backfill has completed so a
        /// briefly-truncated closed history (before the once/24h backfill lands) is visible in the
        /// ActivityLog rather than silently wrong.</summary>
        private static async Task<List<GitBoardIssue>?> TryServeFromMirrorAsync()
        {
            var mirrored = await GitHubIssueMirror.TryGetBoardIssuesAsync(openOnly: false);
            if (mirrored == null) return null;
            lock (_lock)
            {
                _cache = mirrored;
                _cacheFetchedUtc = DateTime.UtcNow;
            }
            bool backfilled = await GitHubIssueMirror.HasClosedBackfillAsync();
            ActivityLog.Log("git-board.data",
                $"issue time-series fetch: {mirrored.Count} real issue(s) (open+closed) served from the local mirror — no live GitHub call (Git #3359/#3512); " +
                $"closed backfill {(backfilled ? "complete" : "pending — historical closed line may be briefly truncated until the once/24h backfill lands")}; cached for {CacheTtl.TotalMinutes:0}m.");
            return mirrored;
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
        /// (#1202) never contribute an opened/closed day, so they can't skew the burndown,
        /// open/close-rate, or ETA panels that consume this series' output. <paramref name="allIssuesForAncestry"/>
        /// is the caller's full (ideally ALL-states) issue set used only to resolve the
        /// internal-tooling-Epic ancestor climb for issues whose parent chain reaches outside
        /// <paramref name="scopedIssues"/> itself; defaults to <paramref name="scopedIssues"/> when
        /// the caller has nothing broader on hand.
        ///
        /// <paramref name="selfRootEpicNumber"/> — Git #2776, the same #2773 self-rollup escape
        /// hatch <see cref="GitBoardIssueFilters.IsUnderInternalToolingEpic"/> already defines: pass
        /// the Epic number a per-Epic scope is itself rooted under (e.g. #1202) so THAT Epic's own
        /// real descendants aren't excluded from its own burndown — a per-Epic view must show that
        /// Epic's own real work, same principle #2773 established for #1202's own numbers.
        /// Null (default) is the original cross-scope aggregation behavior (whole-milestone charts):
        /// #1202 and everything under them stay excluded, unchanged.
        /// </summary>
        public static IssueTimeSeries BuildSeries(IReadOnlyList<GitBoardIssue> scopedIssues, string scopeLabel, DateTime nowUtc,
            IReadOnlyList<GitBoardIssue>? allIssuesForAncestry = null, int? selfRootEpicNumber = null)
        {
            var byNumber = GitBoardIssueFilters.BuildByNumberLookup(allIssuesForAncestry ?? scopedIssues);
            var realWork = scopedIssues.Where(i => GitBoardIssueFilters.CountsAsRealWork(i, byNumber, selfRootEpicNumber)).ToList();

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

        /// <summary>Git #3577 — one real, honest "is the local mirror complete enough to trust for
        /// this scope" verdict. <see cref="Reason"/> is the real, human-readable explanation shown
        /// on the card when <see cref="IsComplete"/> is false — never null in that case.</summary>
        private sealed class MirrorCompleteness
        {
            public bool IsComplete { get; init; }
            public string? Reason { get; init; }

            public static readonly MirrorCompleteness Ok = new() { IsComplete = true };
            public static MirrorCompleteness Incomplete(string reason) => new() { IsComplete = false, Reason = reason };
        }

        /// <summary>Git #3577 — every real repo issue (open + closed) read ONLY from the local
        /// <c>bt_issue_mirror</c>, never a live GitHub call. Returns null when the mirror has never
        /// completed a full sync — the caller renders the honest empty state, it never falls back
        /// live the way the general-purpose <see cref="GetAllIssuesAsync"/> does for its other
        /// (out-of-scope-for-this-issue) callers.</summary>
        private static Task<List<GitBoardIssue>?> TryGetAllIssuesLocalOnlyAsync()
            => GitHubIssueMirror.TryGetBoardIssuesAsync(openOnly: false);

        /// <summary>Git #3577 (comparison fixed under Git #3712) — the real completeness cross-check
        /// for a MILESTONE scope: the count of <paramref name="mirrored"/> rows whose OWN GitHub
        /// milestone field is <paramref name="milestoneNumber"/> against <c>bt_milestone_mirror</c>'s
        /// own real open+closed aggregate for that same number — GitHub's own authoritative
        /// milestone-level count, independent of whatever <c>bt_issue_mirror</c>'s own open-issues-walk
        /// + incremental mark-closed + closed-backfill have captured so far.
        ///
        /// Git #3712 — this MUST compare <see cref="GitBoardIssue.OwnMilestoneNumber"/>, not
        /// <see cref="GitBoardIssue.MilestoneNumber"/>. <c>bt_milestone_mirror.open_issues/closed_issues</c>
        /// counts only issues whose OWN milestone field is set; <c>MilestoneNumber</c> is the EFFECTIVE
        /// (Git #2543 transitively-inherited) value, a strict superset for any milestone with sub-issues
        /// that inherit it. Comparing inherited-vs-own let the gate pass while genuinely missing rows —
        /// measured live: +139 on milestone #5, +132 on #16, +124 on #11 (mirrored count read HIGHER
        /// than real even with the mirror fully synced). Comparing own-vs-own here is the fix.</summary>
        private static async Task<MirrorCompleteness> CheckMilestoneCompletenessAsync(int milestoneNumber, IReadOnlyList<GitBoardIssue> mirrored)
        {
            var infos = await GitHubIssueMirror.TryGetMilestoneInfosAsync();
            var real = infos?.FirstOrDefault(m => m.Number == milestoneNumber);
            if (real == null)
                return MirrorCompleteness.Incomplete(
                    $"no real bt_milestone_mirror aggregate for milestone #{milestoneNumber} yet — can't confirm the local mirror is complete enough to chart.");

            int realTotal = real.OpenIssues + real.ClosedIssues;
            int mirroredTotal = mirrored.Count(i => i.OwnMilestoneNumber == milestoneNumber);
            if (mirroredTotal < realTotal)
                return MirrorCompleteness.Incomplete(
                    $"historical data not yet fully synced for this milestone — {mirroredTotal} of {realTotal} real issue(s) mirrored locally (Git #3577's own backfill-completion follow-up covers closing this gap).");

            return MirrorCompleteness.Ok;
        }

        /// <summary>Git #3577 — the real completeness cross-check for an EPIC scope. There's no
        /// <c>bt_milestone_mirror</c> equivalent for an arbitrary epic's whole transitive subtree, so
        /// this walks the same real parent→children adjacency <see cref="GitBoardIssueFilters.CollectDescendants"/>
        /// builds (both real directions the sync reconciles: <see cref="GitBoardIssue.ParentNumber"/>
        /// and <see cref="GitBoardIssue.ChildIssueNumbers"/>) and, at EVERY real node in the subtree,
        /// compares how many of that node's children are actually present in <paramref name="mirrored"/>
        /// against that node's own real GitHub <see cref="GitBoardIssue.SubIssueCount"/> — GraphQL's
        /// <c>subIssuesSummary.total</c>, an authoritative real per-node truth independent of the
        /// mirror's own descendant walk. If every node in the tree has ALL its real direct children
        /// mirrored, the whole transitive subtree is genuinely complete by induction — built up from
        /// GitHub's own real per-node count, not a re-derivation of the same (possibly incomplete)
        /// data. One short-of-real node anywhere in the tree fails the whole scope closed.</summary>
        private static (bool Complete, string? Reason) CheckEpicCompleteness(int epicNumber, IReadOnlyList<GitBoardIssue> mirrored)
        {
            var byNumber = GitBoardIssueFilters.BuildByNumberLookup(mirrored);
            if (!byNumber.TryGetValue(epicNumber, out var root))
                return (false, $"epic #{epicNumber} itself is not present in the local mirror yet — no real completeness signal to check.");

            var childNumbers = new Dictionary<int, HashSet<int>>();
            void AddChild(int parent, int child)
            {
                if (parent == child) return;
                if (!childNumbers.TryGetValue(parent, out var set)) { set = new HashSet<int>(); childNumbers[parent] = set; }
                set.Add(child);
            }
            foreach (var issue in mirrored)
            {
                if (issue.ParentNumber.HasValue) AddChild(issue.ParentNumber.Value, issue.Number);
                foreach (var c in issue.ChildIssueNumbers) AddChild(issue.Number, c);
            }

            var visited = new HashSet<int> { epicNumber };
            var queue = new Queue<GitBoardIssue>();
            queue.Enqueue(root);
            while (queue.Count > 0)
            {
                var node = queue.Dequeue();
                int realDirectChildren = node.SubIssueCount;
                int mirroredDirectChildren = childNumbers.TryGetValue(node.Number, out var kids)
                    ? kids.Count(byNumber.ContainsKey)
                    : 0;
                if (mirroredDirectChildren < realDirectChildren)
                {
                    return (false,
                        $"issue #{node.Number} \"{node.Title}\" has {mirroredDirectChildren} of its real {realDirectChildren} " +
                        "direct sub-issue(s) mirrored locally — the epic's transitive subtree isn't fully synced yet (Git #3577).");
                }
                if (kids != null)
                {
                    foreach (var k in kids)
                    {
                        if (!visited.Add(k)) continue;
                        if (byNumber.TryGetValue(k, out var kidIssue)) queue.Enqueue(kidIssue);
                    }
                }
            }
            return (true, null);
        }

        /// <summary>Real daily series scoped to one GitHub Milestone (by number), read ONLY from the
        /// local mirror — Git #3577's final decision: database only, ever, no live GitHub call for
        /// this chart under any circumstance. The board fetch's own transitive milestone-inheritance
        /// (Git #2543) means a sub-issue that belongs to its epic's milestone is counted here even
        /// when its own milestone field is blank. Fails closed with an honest reason — never a
        /// partial/wrong chart — when the mirror has no usable data yet or the real completeness
        /// check (<see cref="CheckMilestoneCompletenessAsync"/>) finds this milestone's local data
        /// genuinely incomplete.</summary>
        public static async Task<IssueTimeSeries> GetMilestoneSeriesAsync(int milestoneNumber, string? milestoneTitle = null)
        {
            string label = milestoneTitle ?? $"Milestone #{milestoneNumber}";
            var mirrored = await TryGetAllIssuesLocalOnlyAsync();
            if (mirrored == null)
                return IssueTimeSeries.NotEnough(label,
                    "local issue mirror has no usable data yet (never completed a full sync) — Git #3577: this chart reads only the local database, never live GitHub.");

            var completeness = await CheckMilestoneCompletenessAsync(milestoneNumber, mirrored);
            if (!completeness.IsComplete)
                return IssueTimeSeries.NotEnough(label, completeness.Reason!);

            var scoped = mirrored.Where(i => i.MilestoneNumber == milestoneNumber).ToList();
            return BuildSeries(scoped, label, DateTime.UtcNow, mirrored);
        }

        /// <summary>Real daily series scoped to one Epic's issue set — every transitive descendant
        /// (children, their children, …) of <paramref name="epicNumber"/> that's present in the
        /// mirror, excluding the Epic node itself (a container, not a work item). Read ONLY from the
        /// local mirror (Git #3577), gated by the real per-node <see cref="CheckEpicCompleteness"/>
        /// check — an honest empty state when the subtree isn't fully synced, never a partial curve.
        ///
        /// Git #2776 — passes <paramref name="epicNumber"/> itself as <c>BuildSeries</c>'s
        /// <c>selfRootEpicNumber</c> so a caller charting one internal-tooling Epic's OWN burndown
        /// (e.g. #1202 Build Console) sees that Epic's real work, not an empty series — same
        /// self-rollup principle #2773 established, deliberately NOT the cross-scope exclusion
        /// <see cref="GetMilestoneSeriesAsync"/> still applies.</summary>
        public static async Task<IssueTimeSeries> GetEpicSeriesAsync(int epicNumber)
        {
            var mirrored = await TryGetAllIssuesLocalOnlyAsync();
            string label = mirrored?.FirstOrDefault(i => i.Number == epicNumber)?.Title is string t
                ? $"#{epicNumber} {t}" : $"Epic #{epicNumber}";
            if (mirrored == null)
                return IssueTimeSeries.NotEnough(label,
                    "local issue mirror has no usable data yet (never completed a full sync) — Git #3577: this chart reads only the local database, never live GitHub.");

            var (complete, reason) = CheckEpicCompleteness(epicNumber, mirrored);
            if (!complete)
                return IssueTimeSeries.NotEnough(label, reason!);

            var descendants = GitBoardIssueFilters.CollectDescendants(mirrored, epicNumber);
            return BuildSeries(descendants, label, DateTime.UtcNow, mirrored, selfRootEpicNumber: epicNumber);
        }

        /// <summary>Git #2776 — every real OPEN Epic in the repo (Git #839 definition: top-level
        /// issue with ≥1 sub-issue), for the Home dashboard's per-Epic burndown picker, read ONLY
        /// from the local mirror (Git #3577). Deliberately does NOT exclude the internal-tooling
        /// Epics (#1202) the way <see cref="GetOpenEpicsInMilestoneAsync"/> does — Shane
        /// explicitly wants #1202 selectable here so its own real burndown can be viewed (see
        /// <see cref="GetEpicSeriesAsync"/>'s self-rollup). <see cref="EpicOption.OpenRealWork"/> is
        /// each Epic's own real open descendant-work count (self-rollup applied) so the caller can
        /// pick a sensible default selection — the Epic with the most real open work — rather than
        /// defaulting to nothing selected. Empty when the mirror has no usable data yet (fail-closed;
        /// listing an epic here doesn't itself draw a chart — the real per-scope completeness gate
        /// is <see cref="GetEpicSeriesAsync"/>'s own check once one is actually selected).</summary>
        public static async Task<List<EpicOption>> GetOpenEpicsAsync()
        {
            var mirrored = await TryGetAllIssuesLocalOnlyAsync();
            if (mirrored == null) return new List<EpicOption>();

            var byNumber = GitBoardIssueFilters.BuildByNumberLookup(mirrored);
            var epics = mirrored.Where(i => i.IsEpic && !i.IsClosed).OrderBy(i => i.Number).ToList();

            var result = new List<EpicOption>();
            foreach (var epic in epics)
            {
                var descendants = GitBoardIssueFilters.CollectDescendants(mirrored, epic.Number);
                int openReal = descendants.Count(i =>
                    !i.IsClosed && GitBoardIssueFilters.CountsAsRealWork(i, byNumber, selfRootEpicNumber: epic.Number));
                result.Add(new EpicOption { Number = epic.Number, Title = $"#{epic.Number} {epic.Title}", OpenRealWork = openReal });
            }
            return result;
        }

        /// <summary>The open Epics (Git #839 definition: top-level issue with ≥1 sub-issue) that
        /// belong to <paramref name="milestoneNumber"/>, so #2714 can produce one real ETA per Epic,
        /// read ONLY from the local mirror (Git #3577). Empty when the mirror has no usable data yet
        /// (fail-closed — the caller sees no epics rather than a wrong set).
        /// Git #2739 — excludes the internal-tooling Epics themselves (#1202): they're not
        /// customer-facing product work, so Home dashboard shouldn't project an ETA card for them
        /// (their own real descendant series is already filtered to empty by <see cref="BuildSeries"/>
        /// anyway; excluding the row itself avoids rendering an empty/misleading card for it).</summary>
        public static async Task<List<GitBoardIssue>> GetOpenEpicsInMilestoneAsync(int milestoneNumber)
        {
            var mirrored = await TryGetAllIssuesLocalOnlyAsync();
            if (mirrored == null) return new List<GitBoardIssue>();
            return mirrored
                .Where(i => i.IsEpic && !i.IsClosed && i.MilestoneNumber == milestoneNumber
                            && !GitBoardIssueFilters.InternalToolingEpicNumbers.Contains(i.Number))
                .OrderBy(i => i.Number)
                .ToList();
        }

        /// <summary>
        /// Resolves the real "active" GitHub Milestone the Home dashboard defaults to: among OPEN
        /// milestones, the one with the most total (open + closed) real issues — the one actually
        /// being worked. Reads GitHub's own milestone object counts, never a label. Returns null
        /// when the local mirror has no usable data yet (fail-closed — the caller shows an honest
        /// empty state, not a guessed milestone).
        ///
        /// Git #3577 — reads ONLY <see cref="GitHubIssueMirror.TryGetMilestoneInfosAsync"/> (the
        /// #3358 read, backed by <c>bt_milestone_mirror</c>); the live <see cref="GitHubApiClient.GetMilestonesAsync"/>
        /// fallback #3468 added here has been removed for this Home-dashboard-only resolver per
        /// Shane's final decision (2026-09-11): no live GitHub call for these charts under any
        /// circumstance. (Confirmed via repo-wide grep this resolver has no caller outside the Home
        /// dashboard's burndown/rate/ETA cards, so removing the live fallback here can't regress any
        /// other consumer.)
        /// </summary>
        public static async Task<ActiveMilestone?> ResolveActiveMilestoneAsync()
        {
            var mirrored = await GitHubIssueMirror.TryGetMilestoneInfosAsync();
            if (mirrored == null) return null;

            var best = mirrored
                .Where(m => !m.IsClosed && (m.OpenIssues + m.ClosedIssues) > 0)
                .OrderByDescending(m => m.OpenIssues + m.ClosedIssues)
                .FirstOrDefault();
            if (best == null) return null;

            ActivityLog.Log("git-board.data",
                $"active-milestone resolution: #{best.Number} \"{best.Title}\" served from the local mirror — no live GitHub call, ever, for this resolver (Git #3577).");
            return new ActiveMilestone
            {
                Number = best.Number,
                Title = best.Title,
                OpenIssues = best.OpenIssues,
                ClosedIssues = best.ClosedIssues,
            };
        }

        /// <summary>Convenience: the real daily series for whatever <see cref="ResolveActiveMilestoneAsync"/>
        /// picks as the active milestone. Fails closed with an honest reason when no active milestone
        /// resolves, or when that milestone's local data isn't confirmed complete yet.</summary>
        public static async Task<IssueTimeSeries> GetActiveMilestoneSeriesAsync()
        {
            var active = await ResolveActiveMilestoneAsync();
            if (active == null)
                return IssueTimeSeries.NotEnough("Active milestone",
                    "no active milestone could be resolved from the local mirror (bt_milestone_mirror has no usable data yet) — Git #3577: this chart reads only the local database, never live GitHub.");
            return await GetMilestoneSeriesAsync(active.Number, active.Title);
        }

    }
}

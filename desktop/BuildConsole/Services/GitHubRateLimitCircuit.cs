using System;
using System.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2815 — one shared rate-limit circuit breaker for EVERY way BuildConsole talks to
    /// GitHub, so a rate-limit exhaustion recovers instead of compounding.
    ///
    /// The real incident this exists for: multiple independent subsystems (the `gh` CLI path via
    /// <see cref="SubprocessRunner"/> — board-status timeline, issue-title lookups, the dispatch
    /// blocker gate — AND the HTTP+PAT path via <see cref="GitHubApiClient"/> — board reconcile,
    /// <see cref="BoardStatusSync"/> mirrors, issue time-series) each retried GitHub on essentially
    /// every tick with no shared backoff. Once GitHub returned a secondary/primary rate-limit, they
    /// all kept hammering it every ~15s, which is why the limit "never cleared even after Shane and I
    /// both stopped making calls" — the app itself was actively re-triggering the exhaustion
    /// (Shane's #2815 comment, 2026-09-04T05:01:33Z).
    ///
    /// Both GitHub transports consult this ONE breaker before spawning/sending and report the
    /// outcome back to it. When either transport sees a rate-limit response, the breaker OPENS for a
    /// backoff window (exponential, capped) and BOTH transports short-circuit for that window
    /// instead of issuing real calls. After the window it half-opens: the next real call is allowed
    /// through; a success closes the breaker and resets the backoff, another rate-limit re-opens it
    /// with a longer window. A single call per window (worst case) replaces a storm every tick.
    ///
    /// This never changes what a CALLER sees relative to a real rate-limit today: a short-circuited
    /// `gh` call returns the same non-zero-exit failure shape a real rate-limited `gh` call returns,
    /// and a short-circuited HTTP call returns the same 403 a real rate-limited request returns —
    /// so every existing fail-closed path (the §4 blocker gate holding blocked builds; a fire-and-
    /// forget mirror logging and moving on) behaves exactly as it already does, just without the
    /// wasted round trip. Thread-safe; all state is guarded by <see cref="_gate"/>.
    /// </summary>
    public static class GitHubRateLimitCircuit
    {
        private static readonly object _gate = new();

        /// <summary>UTC instant the breaker is open until. Default (MinValue) = closed.</summary>
        private static DateTime _openUntilUtc = DateTime.MinValue;

        /// <summary>Consecutive rate-limit trips without an intervening success — drives the backoff.</summary>
        private static int _consecutiveTrips;

        /// <summary>Whether we've already logged a short-circuit for the current open window (so the
        /// short-circuit path logs once per window, not once per suppressed call).</summary>
        private static bool _loggedThisWindow;

        /// <summary>Backoff windows by consecutive-trip count (0-indexed): 1st trip → 60s, then 2, 4,
        /// 8, capped at 15m. Long enough that a secondary rate limit genuinely clears; short enough
        /// that we re-probe (half-open) well before a full primary-limit hour, so we recover as soon
        /// as the limit actually lifts rather than staying dark for the worst-case reset.</summary>
        private static readonly TimeSpan[] Backoff =
        {
            TimeSpan.FromSeconds(60),
            TimeSpan.FromSeconds(120),
            TimeSpan.FromSeconds(240),
            TimeSpan.FromSeconds(480),
            TimeSpan.FromMinutes(15),
        };

        /// <summary>Hard cap on any single open window, including one derived from a server-supplied
        /// reset time — we never stay silently dark longer than this without re-probing.</summary>
        private static readonly TimeSpan MaxWindow = TimeSpan.FromMinutes(15);

        /// <summary>
        /// True if a real GitHub call should be SUPPRESSED right now (the breaker is open and its
        /// window hasn't elapsed). When it returns true, <paramref name="reason"/> is a short human
        /// explanation for the caller to surface as its failure text. When the window has elapsed
        /// this returns false (half-open) so exactly one real call is allowed through to probe.
        /// </summary>
        public static bool ShouldShortCircuit(out string reason)
        {
            lock (_gate)
            {
                if (_openUntilUtc == DateTime.MinValue || DateTime.UtcNow >= _openUntilUtc)
                {
                    reason = "";
                    return false;
                }
                var remaining = _openUntilUtc - DateTime.UtcNow;
                reason = $"GitHub rate-limit circuit open — backing off {Math.Ceiling(remaining.TotalSeconds):F0}s more (Git #2815)";
                bool shouldLog = !_loggedThisWindow;
                _loggedThisWindow = true;
                if (shouldLog)
                    ActivityLog.Log("github",
                        $"Rate-limit circuit OPEN — suppressing GitHub calls for the next {Math.Ceiling(remaining.TotalSeconds):F0}s " +
                        "instead of retrying every tick (Git #2815). Real calls resume automatically when the window elapses.");
                return true;
            }
        }

        /// <summary>
        /// Record that a real GitHub call just came back rate-limited. Opens (or extends) the breaker
        /// with an exponential backoff window. <paramref name="serverResetUtc"/>, when known from a
        /// response (e.g. <c>x-ratelimit-reset</c> / <c>Retry-After</c>), is honored up to
        /// <see cref="MaxWindow"/> so we wait at least as long as GitHub told us to, but never stay
        /// dark past the cap without re-probing.
        /// </summary>
        public static void RecordRateLimited(string source, DateTime? serverResetUtc = null)
        {
            lock (_gate)
            {
                int idx = Math.Min(_consecutiveTrips, Backoff.Length - 1);
                var window = Backoff[idx];
                if (serverResetUtc is { } reset)
                {
                    var serverWait = reset - DateTime.UtcNow;
                    if (serverWait > window) window = serverWait;
                }
                if (window > MaxWindow) window = MaxWindow;
                if (window < TimeSpan.FromSeconds(30)) window = TimeSpan.FromSeconds(30);

                _consecutiveTrips++;
                _openUntilUtc = DateTime.UtcNow + window;
                _loggedThisWindow = false;
                ActivityLog.Log("github",
                    $"GitHub rate-limit hit via {source} — circuit breaker TRIPPED (consecutive #{_consecutiveTrips}); " +
                    $"holding all GitHub calls for {Math.Ceiling(window.TotalSeconds):F0}s (Git #2815).");
            }
        }

        /// <summary>Record that a real GitHub call succeeded — closes the breaker and resets the
        /// backoff ladder. Called on any clean GitHub result from either transport.</summary>
        public static void RecordSuccess()
        {
            lock (_gate)
            {
                if (_openUntilUtc == DateTime.MinValue && _consecutiveTrips == 0) return;
                bool wasOpenOrTripped = _consecutiveTrips > 0 || _openUntilUtc != DateTime.MinValue;
                _openUntilUtc = DateTime.MinValue;
                _consecutiveTrips = 0;
                _loggedThisWindow = false;
                if (wasOpenOrTripped)
                    ActivityLog.Log("github", "GitHub call succeeded — rate-limit circuit RESET/closed (Git #2815).");
            }
        }

        /// <summary>
        /// Heuristic: does this text (a `gh` stderr line, or an HTTP error body) describe a GitHub
        /// rate-limit? Covers both the primary ("API rate limit exceeded") and secondary
        /// ("secondary rate limit") wordings GitHub uses, plus the abuse-detection phrasing.
        /// </summary>
        public static bool LooksLikeRateLimit(string? text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            return text.Contains("rate limit", StringComparison.OrdinalIgnoreCase)
                || text.Contains("secondary rate", StringComparison.OrdinalIgnoreCase)
                || text.Contains("abuse detection", StringComparison.OrdinalIgnoreCase);
        }
    }
}

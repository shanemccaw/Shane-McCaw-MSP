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
        /// Git #2867 — how long a single half-open probe call is granted exclusive passage. When the
        /// backoff window elapses, exactly ONE real call is let through to probe GitHub; every other
        /// concurrent caller keeps short-circuiting for this brief lease until that probe reports its
        /// outcome (<see cref="RecordSuccess"/> closes the breaker, <see cref="RecordRateLimited"/>
        /// re-opens it — either way overwriting this lease). If the probe never reports back (it hit a
        /// non-rate-limit failure the circuit isn't told about, or was lost), the lease simply elapses
        /// and the next caller becomes a fresh probe — so a lost probe can never wedge the breaker
        /// open forever. Must comfortably exceed a single GitHub call's round trip yet be short enough
        /// that a lost probe recovers quickly.
        /// </summary>
        private static readonly TimeSpan ProbeLease = TimeSpan.FromSeconds(30);

        /// <summary>
        /// True if a real GitHub call should be SUPPRESSED right now.
        ///
        /// Git #2867 — the breaker has three real states, not two:
        /// <list type="bullet">
        /// <item>CLOSED (<c>_openUntilUtc == MinValue</c>): never suppress — every call runs.</item>
        /// <item>OPEN (<c>now &lt; _openUntilUtc</c>): suppress — the backoff window hasn't elapsed.</item>
        /// <item>HALF-OPEN (<c>now &gt;= _openUntilUtc &amp;&amp; _openUntilUtc != MinValue</c>): the window
        /// has elapsed. Let EXACTLY ONE call through as a probe and immediately push
        /// <c>_openUntilUtc</c> forward by <see cref="ProbeLease"/> so every other concurrent caller
        /// keeps suppressing until that probe reports back.</item>
        /// </list>
        /// The previous implementation returned <c>false</c> for EVERY caller the instant the window
        /// elapsed, releasing a thundering herd of simultaneous GitHub calls — which is exactly what
        /// re-triggers GitHub's <em>secondary</em> rate limit, re-tripping the breaker every window on
        /// a token that is actually healthy. That self-perpetuating live-lock is #2867. Leasing the
        /// probe makes the code honour the single-probe contract its own doc comment already promised.
        ///
        /// When this returns true, <paramref name="reason"/> is a short human explanation for the
        /// caller to surface as its failure text.
        /// </summary>
        public static bool ShouldShortCircuit(out string reason)
        {
            lock (_gate)
            {
                // CLOSED — nothing to suppress.
                if (_openUntilUtc == DateTime.MinValue)
                {
                    reason = "";
                    return false;
                }

                // HALF-OPEN — the backoff window has elapsed. Hand this ONE caller through as the
                // probe and lease the window forward so the rest keep short-circuiting until it
                // reports back. Exactly one real call per window, as documented.
                if (DateTime.UtcNow >= _openUntilUtc)
                {
                    _openUntilUtc = DateTime.UtcNow + ProbeLease;
                    _loggedThisWindow = false;
                    ActivityLog.Log("github",
                        "Rate-limit circuit HALF-OPEN — backoff window elapsed; letting exactly one probe " +
                        $"call through and holding the rest for up to {Math.Ceiling(ProbeLease.TotalSeconds):F0}s " +
                        "until it reports back (Git #2815/#2867).");
                    reason = "";
                    return false;
                }

                // OPEN — still inside the window (or a probe is in flight under its lease). Suppress.
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

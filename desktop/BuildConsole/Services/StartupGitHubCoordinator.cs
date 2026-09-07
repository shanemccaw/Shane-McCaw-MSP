using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3022 — a global, cold-start-aware coordinator that STAGGERS the independent,
    /// GitHub-call-heavy startup subsystems relative to each other so their aggregate burst
    /// never trips the shared #2815 rate-limit circuit in the first place.
    ///
    /// This is a different, higher-level problem than any single subsystem's own internal
    /// throttling — all of which is already in place and working correctly in isolation
    /// (#2890 bounded title-fetch concurrency + escalating cooldown, #2817 terminal-row skip,
    /// #3009 watcher consolidation, the #845/#876 blocked-sweep concurrency cap). What was
    /// missing is coordination ACROSS subsystems. On a genuine cold start, MANY completely
    /// independent subsystems each fire their own GitHub calls within the same ~5-10s window
    /// with zero coordination between them:
    ///
    ///   • Home queue/board reconciliation  — ~500 open issue numbers (gh CLI) + a board reconcile (HTTP)
    ///   • In-Flight tile initial load      — ~50 open in-flight issues (gh CLI)
    ///   • Orphan recovery                  — one board Status move per crashed build (HTTP)
    ///   • The blocked-by sweep             — one blocked_by REST call per open issue (~528, HTTP)
    ///   • Issue-title warm-up              — dozens of `gh issue view` calls (gh CLI)
    ///
    /// Fired in parallel the moment each one's own gate allows, that aggregate volume
    /// overwhelms GitHub's SECONDARY rate limit — the real #3022 log shows the #2815 circuit
    /// tripping and resetting repeatedly within a single second (12:53:23.199 → 12:53:23.436)
    /// as these land almost together. The #2815 circuit is REACTIVE: it only opens AFTER a
    /// rate-limit response, so it can't prevent the first burst — it only cleans up the
    /// aftermath (an 18.4s rate-limited blocked-by sweep, and the artifact whammy flood that
    /// followed it because that rate-limited sweep recorded a false-empty blocked baseline).
    ///
    /// This coordinator is PROACTIVE. During a bounded cold-start window (the first
    /// <see cref="WindowDuration"/> of process uptime) it runs each registered startup
    /// operation through a single global gate — at most ONE heavy startup GitHub operation at
    /// a time, with a small settle delay between them — so the calls spread across the window
    /// instead of bursting simultaneously. Each individual operation keeps its OWN internal
    /// bounded concurrency (the sweep still runs 6-at-a-time inside its own slot; the title
    /// warm-up still runs 3-at-a-time inside its slot); the coordinator only prevents
    /// DIFFERENT operations from overlapping. Once the window elapses, <see cref="RunAsync"/>
    /// becomes a pure pass-through, so a steady-state manual refresh is never delayed.
    ///
    /// Thread-safe. The gate is a single-permit <see cref="SemaphoreSlim"/>; an
    /// <see cref="AsyncLocal{T}"/> re-entrancy flag makes a coordinated op that (directly or
    /// via a captured continuation) calls back into the coordinator run its inner work
    /// directly rather than self-deadlocking on that single permit. A hung op can never freeze
    /// the app: a caller that can't acquire the gate within <see cref="MaxGateWait"/> proceeds
    /// uncoordinated (logged), and the window ages out on wall-clock regardless.
    /// </summary>
    public static class StartupGitHubCoordinator
    {
        public const string Channel = "startup";

        /// <summary>How long after process start the coordinator serializes startup GitHub work.
        /// Comfortably covers the first heavy wave (~10s) AND the #3005 gate-lift board refresh
        /// (~90s after readiness) that re-runs the blocked-by sweep; after this it is a pure
        /// pass-through so steady-state refreshes are never gated.</summary>
        private static readonly TimeSpan WindowDuration = TimeSpan.FromSeconds(120);

        /// <summary>Settle gap inserted AFTER each coordinated operation, before the next one is
        /// let through, so GitHub's secondary rate-limit budget breathes between operations
        /// rather than seeing back-to-back bursts. Small — the win is non-overlap, not idle
        /// time.</summary>
        private static readonly TimeSpan InterOpSettle = TimeSpan.FromMilliseconds(750);

        /// <summary>Never let a caller hang on the gate forever: if the gate can't be acquired
        /// within this long, the caller proceeds anyway (logged). A stuck startup op must
        /// degrade to "make the call uncoordinated", never "freeze the app".</summary>
        private static readonly TimeSpan MaxGateWait = TimeSpan.FromSeconds(60);

        private static readonly DateTime _processStartUtc = ResolveProcessStartUtc();
        private static readonly SemaphoreSlim _gate = new(1, 1);

        /// <summary>Flows with the async context so a coordinated operation that (directly or via
        /// a captured continuation) calls back into <see cref="RunAsync"/> runs its inner work
        /// DIRECTLY instead of re-acquiring the single-permit gate and self-deadlocking.</summary>
        private static readonly AsyncLocal<bool> _insideGate = new();

        private static long _opsCoordinated;

        /// <summary>True while process uptime is still inside the cold-start window — i.e. while
        /// <see cref="RunAsync"/> actually coordinates. False afterward (pure pass-through).</summary>
        public static bool IsColdStartWindow => DateTime.UtcNow - _processStartUtc < WindowDuration;

        /// <summary>
        /// Run one GitHub-call-heavy STARTUP operation under global cold-start coordination.
        /// During the cold-start window this serializes against every other coordinated startup
        /// operation (one at a time, with a small settle gap between them); after the window, or
        /// if already running inside another coordinated op, it simply awaits <paramref name="work"/>
        /// directly with no gating. Exceptions from <paramref name="work"/> propagate unchanged —
        /// the coordinator only orders the work, it never swallows the caller's own errors, so a
        /// caller's existing try/catch keeps behaving exactly as before.
        /// </summary>
        public static async Task RunAsync(string label, Func<Task> work)
        {
            // Pass-through: past the window, or re-entrant from inside an already-coordinated op.
            // Git #3071: no ConfigureAwait(false) anywhere in this method — callers (and the
            // `work` delegates they hand us) routinely touch WPF UI either before their own
            // first internal await or immediately after one of ours resumes. Stripping the
            // SynchronizationContext here silently moves that UI-touching code onto a
            // ThreadPool thread and crashes (`RenderIssuesTreeAsync`'s `ItemCollection.Clear()`
            // via `EnrichBlockedStatusCoreAsync`). Resume on the original context throughout,
            // matching this codebase's convention for UI-adjacent async work.
            if (!IsColdStartWindow || _insideGate.Value)
            {
                await work();
                return;
            }

            var waitSw = Stopwatch.StartNew();
            bool acquired = await _gate.WaitAsync(MaxGateWait);
            waitSw.Stop();
            if (!acquired)
            {
                ActivityLog.Log(Channel,
                    $"cold-start GitHub coordinator: '{label}' waited {waitSw.ElapsedMilliseconds}ms for the gate and proceeded uncoordinated (Git #3022).");
                await work();
                return;
            }

            _insideGate.Value = true;
            var runSw = Stopwatch.StartNew();
            try
            {
                long n = Interlocked.Increment(ref _opsCoordinated);
                ActivityLog.Log(Channel,
                    $"cold-start GitHub coordinator: running '{label}' (op #{n}, {waitSw.ElapsedMilliseconds}ms gate wait) (Git #3022).");
                await work();
                runSw.Stop();
                ActivityLog.Log(Channel,
                    $"cold-start GitHub coordinator: '{label}' done in {runSw.ElapsedMilliseconds}ms (Git #3022).");
            }
            finally
            {
                _insideGate.Value = false;
                // Settle gap before the next queued op — but only while still inside the window;
                // never hold the gate needlessly once we've aged out.
                if (IsColdStartWindow)
                {
                    try { await Task.Delay(InterOpSettle); } catch { /* delay is best-effort */ }
                }
                _gate.Release();
            }
        }

        /// <summary>
        /// Result-returning overload of <see cref="RunAsync(string, Func{Task})"/> for a
        /// coordinated startup operation that produces a value (e.g. the In-Flight tile's issue
        /// list). Same coordination and pass-through semantics; the result flows back to the
        /// caller and any exception propagates unchanged.
        /// </summary>
        public static async Task<T> RunAsync<T>(string label, Func<Task<T>> work)
        {
            T result = default!;
            await RunAsync(label, async () => { result = await work(); });
            return result;
        }

        private static DateTime ResolveProcessStartUtc()
        {
            try { return Process.GetCurrentProcess().StartTime.ToUniversalTime(); }
            catch { return DateTime.UtcNow; }
        }
    }
}

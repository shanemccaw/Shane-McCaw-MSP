using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>The lifecycle state of one real startup connection, in the order it travels through.</summary>
    public enum StartupConnectionState
    {
        /// <summary>Not started probing yet.</summary>
        Pending,
        /// <summary>The real request/observation is in flight right now.</summary>
        Connecting,
        /// <summary>Connected and got real data back.</summary>
        Success,
        /// <summary>Reachable but not fully healthy — e.g. the endpoint answered but empty, or a cached/stale copy was served because the live server was napping. Honest "yellow", not a failure.</summary>
        Degraded,
        /// <summary>The request threw (unreachable, HTTP error, auth wall).</summary>
        Failed,
        /// <summary>Didn't answer within this connection's own timeout (or the global launch cap fired).</summary>
        TimedOut,
        /// <summary>Deliberately not attempted (e.g. Build Tracker isn't configured on this machine), so it's neither pending nor a failure.</summary>
        Skipped,
    }

    /// <summary>
    /// One real startup connection's live status, as rendered by
    /// <see cref="BuildConsole.Controls.StartupLoadingView"/>. Mutated in place by
    /// <see cref="StartupConnectivityService"/> as the connection settles; the service
    /// raises <see cref="StartupConnectivityService.ConnectionChanged"/> with this same
    /// instance on every transition.
    /// </summary>
    public class StartupConnectionStatus
    {
        public string Key { get; }
        public string Label { get; }
        public StartupConnectionState State { get; set; } = StartupConnectionState.Pending;
        /// <summary>Short human detail for this row, e.g. "12 epics · 34 chats", "not configured", "timed out after 15s".</summary>
        public string Detail { get; set; } = "";
        /// <summary>Real wall-clock the probe took, once it's settled (null while pending/connecting, or for observed connections that report no timing).</summary>
        public TimeSpan? Elapsed { get; set; }

        public StartupConnectionStatus(string key, string label)
        {
            Key = key;
            Label = label;
        }
    }

    /// <summary>
    /// Drives the animated startup splash's HONEST per-connection progress. It probes
    /// the SAME real endpoints the app itself connects to at launch — the Build Tracker
    /// board / in-flight issues / build queue / deploy-status (all through the shared
    /// <see cref="BuildTrackerApiClient"/>) — in parallel, and separately OBSERVES the
    /// real Claude usage meter (a WebView2 poll with no HTTP endpoint to hit directly)
    /// via <see cref="ReportUsageMeter"/>. Each connection settles independently with its
    /// own timeout, and a global cap guarantees the splash never hangs on one slow or
    /// dead connection. Every transition is logged on the <c>startup</c> ActivityLog
    /// channel with which service, how long it took, and success/failure — the real
    /// startup-connection timing the task asks for.
    ///
    /// UI-agnostic: it raises plain events (<see cref="ConnectionChanged"/>,
    /// <see cref="AllSettled"/>); MainWindow marshals those onto the view.
    /// </summary>
    public class StartupConnectivityService
    {
        public const string Channel = "startup";

        // Connection keys — must match the rows the view builds from Connections.
        public const string KeyBoard      = "board";
        public const string KeyInProgress = "inprogress";
        public const string KeyQueue      = "queue";
        public const string KeyDeploy     = "deploy";
        public const string KeyUsage      = "usage";

        /// <summary>Per-HTTP-probe timeout. Below the client's own 20s so a single dead endpoint settles this row (as TimedOut) well before the global cap.</summary>
        private static readonly TimeSpan HttpProbeTimeout = TimeSpan.FromSeconds(15);

        /// <summary>Absolute ceiling from Start(): any connection still Pending/Connecting after this is force-settled to TimedOut so the splash always dismisses. Covers the observed usage meter, which has no timeout of its own we control here.</summary>
        private static readonly TimeSpan GlobalCap = TimeSpan.FromSeconds(20);

        private readonly BuildTrackerApiClient? _api;
        private readonly List<StartupConnectionStatus> _ordered;
        private readonly Dictionary<string, StartupConnectionStatus> _byKey;
        private readonly object _gate = new();
        private bool _allSettledRaised;

        /// <summary>Ordered connection list — the view builds one row per entry, preserving this order.</summary>
        public IReadOnlyList<StartupConnectionStatus> Connections => _ordered;

        /// <summary>Raised on every per-connection transition, with the (mutated-in-place) status. May fire on a background thread — the view marshals.</summary>
        public event Action<StartupConnectionStatus>? ConnectionChanged;

        /// <summary>Raised exactly once, when every connection has reached a terminal state (or the global cap fired). May fire on a background thread.</summary>
        public event Action? AllSettled;

        public StartupConnectivityService(BuildTrackerApiClient? api)
        {
            _api = api;
            _ordered = new List<StartupConnectionStatus>
            {
                new StartupConnectionStatus(KeyBoard,      "GitHub board"),
                new StartupConnectionStatus(KeyInProgress, "In-flight issues"),
                new StartupConnectionStatus(KeyQueue,      "Build queue"),
                new StartupConnectionStatus(KeyDeploy,     "Deploy status"),
                new StartupConnectionStatus(KeyUsage,      "Claude usage"),
            };
            _byKey = _ordered.ToDictionary(c => c.Key);
        }

        /// <summary>
        /// Kicks off all probes. Returns immediately — progress arrives via events. The
        /// four Build-Tracker-backed connections either probe live or, when Build Tracker
        /// isn't configured on this machine, settle straight to Skipped (honest, not a
        /// hang). The usage-meter row starts Connecting and is settled later by
        /// <see cref="ReportUsageMeter"/>. A global-cap watchdog is armed either way.
        /// </summary>
        public void Start()
        {
            ActivityLog.Log(Channel, "startup connectivity: probing real launch connections…");

            // The real Claude usage meter is already polling (MainWindow started it); this
            // row reflects that in-flight state until its StatusChanged reaches us.
            Transition(KeyUsage, StartupConnectionState.Connecting, "reading meter…");

            if (_api == null || !_api.IsConfigured)
            {
                foreach (var key in new[] { KeyBoard, KeyInProgress, KeyQueue, KeyDeploy })
                    Transition(key, StartupConnectionState.Skipped, "Build Tracker not configured");
            }
            else
            {
                _ = ProbeAsync(KeyBoard, () => _api.GetBoardAsync(),
                    r => $"{r.Data.Epics.Count} epics · {r.Data.Chats.Count} chats" + (r.IsStale ? " (cached)" : ""),
                    r => r.IsStale);
                _ = ProbeAsync(KeyInProgress, () => _api.GetInProgressAsync(),
                    r => Count(r.Count, "issue") + " in flight");
                _ = ProbeAsync(KeyQueue, () => _api.GetQueueAsync(),
                    r => Count(r.Count, "item") + " queued");
                _ = ProbeAsync(KeyDeploy, () => _api.GetDeployStatusAsync(),
                    r => r == null || string.IsNullOrEmpty(r.CommitHash) ? "no deploy info" : $"@ {ShortHash(r.CommitHash)}",
                    r => r == null || string.IsNullOrEmpty(r.CommitHash));
            }

            _ = GlobalCapWatchdogAsync();
        }

        /// <summary>
        /// Feed the real Claude usage meter's status in (MainWindow forwards its existing
        /// <c>ClaudeUsageMeterService.StatusChanged</c>). Ignored once the usage row is
        /// already terminal — the meter keeps polling every ~10min for the status bar, but
        /// for launch we only care about the first real reading. Safe to call from any thread.
        /// </summary>
        public void ReportUsageMeter(ClaudeUsageStatus status)
        {
            lock (_gate)
            {
                if (_byKey.TryGetValue(KeyUsage, out var cur) && IsTerminal(cur.State))
                    return;
            }

            switch (status.State)
            {
                case ClaudeUsageMeterState.Polling:
                    Transition(KeyUsage, StartupConnectionState.Connecting, "reading meter…");
                    break;
                case ClaudeUsageMeterState.Ok:
                    Transition(KeyUsage, StartupConnectionState.Success, status.DisplayText);
                    break;
                case ClaudeUsageMeterState.Unavailable:
                    // Page reached but the meter couldn't be read (usually: not logged in). Honest yellow.
                    Transition(KeyUsage, StartupConnectionState.Degraded, "meter unavailable (sign in to claude.ai?)");
                    break;
                case ClaudeUsageMeterState.Error:
                    Transition(KeyUsage, StartupConnectionState.Failed, "navigation failed");
                    break;
            }
        }

        // ── probe machinery ─────────────────────────────────────────────────────

        private async Task ProbeAsync<T>(string key, Func<Task<T>> fetch, Func<T, string> describe, Func<T, bool>? degraded = null)
        {
            Transition(key, StartupConnectionState.Connecting, "connecting…");
            var sw = Stopwatch.StartNew();
            try
            {
                var task = fetch();
                var done = await Task.WhenAny(task, Task.Delay(HttpProbeTimeout)).ConfigureAwait(false);
                if (done != task)
                {
                    sw.Stop();
                    // Don't leave the late task's eventual exception unobserved.
                    _ = task.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                    Transition(key, StartupConnectionState.TimedOut, $"timed out after {HttpProbeTimeout.TotalSeconds:F0}s", sw.Elapsed);
                    return;
                }

                var result = await task.ConfigureAwait(false); // observe result / re-throw its exception
                sw.Stop();
                bool isDegraded = degraded?.Invoke(result) ?? false;
                Transition(key,
                    isDegraded ? StartupConnectionState.Degraded : StartupConnectionState.Success,
                    describe(result), sw.Elapsed);
            }
            catch (Exception ex)
            {
                sw.Stop();
                Transition(key, StartupConnectionState.Failed, ShortError(ex), sw.Elapsed);
            }
        }

        private async Task GlobalCapWatchdogAsync()
        {
            await Task.Delay(GlobalCap).ConfigureAwait(false);

            List<StartupConnectionStatus> stuck;
            lock (_gate)
            {
                if (_allSettledRaised) return;
                stuck = _ordered.Where(c => !IsTerminal(c.State)).ToList();
            }
            foreach (var c in stuck)
                Transition(c.Key, StartupConnectionState.TimedOut, "timed out");
        }

        private void Transition(string key, StartupConnectionState state, string detail, TimeSpan? elapsed = null)
        {
            StartupConnectionStatus status;
            lock (_gate)
            {
                if (!_byKey.TryGetValue(key, out status!)) return;
                status.State = state;
                status.Detail = detail;
                if (elapsed.HasValue) status.Elapsed = elapsed;
            }

            LogTransition(status, state, elapsed);
            ConnectionChanged?.Invoke(status);
            MaybeRaiseAllSettled();
        }

        private static void LogTransition(StartupConnectionStatus status, StartupConnectionState state, TimeSpan? elapsed)
        {
            if (state == StartupConnectionState.Connecting)
            {
                ActivityLog.Log(Channel, $"{status.Label}: connecting…");
                return;
            }
            var timing = elapsed.HasValue ? $" ({elapsed.Value.TotalMilliseconds:F0}ms)" : "";
            var detail = string.IsNullOrEmpty(status.Detail) ? "" : $" — {status.Detail}";
            ActivityLog.Log(Channel, $"{status.Label}: {StateWord(state)}{timing}{detail}");
        }

        private void MaybeRaiseAllSettled()
        {
            lock (_gate)
            {
                if (_allSettledRaised) return;
                if (_ordered.Any(c => !IsTerminal(c.State))) return;
                _allSettledRaised = true;
            }
            ActivityLog.Log(Channel, "startup connectivity: all connections settled.");
            AllSettled?.Invoke();
        }

        private static bool IsTerminal(StartupConnectionState s) =>
            s == StartupConnectionState.Success
            || s == StartupConnectionState.Degraded
            || s == StartupConnectionState.Failed
            || s == StartupConnectionState.TimedOut
            || s == StartupConnectionState.Skipped;

        private static string StateWord(StartupConnectionState s) => s switch
        {
            StartupConnectionState.Connecting => "connecting",
            StartupConnectionState.Success    => "ok",
            StartupConnectionState.Degraded   => "degraded",
            StartupConnectionState.Failed     => "FAILED",
            StartupConnectionState.TimedOut   => "TIMED OUT",
            StartupConnectionState.Skipped    => "skipped",
            _                                 => "pending",
        };

        private static string Count(int n, string noun) => $"{n} {noun}{(n == 1 ? "" : "s")}";

        private static string ShortHash(string hash) => hash.Length > 8 ? hash.Substring(0, 8) : hash;

        private static string ShortError(Exception ex)
        {
            var msg = ex is AggregateException agg && agg.InnerException != null ? agg.InnerException.Message : ex.Message;
            msg = msg.Replace("\r", " ").Replace("\n", " ").Trim();
            return msg.Length > 80 ? msg.Substring(0, 79) + "…" : msg;
        }
    }
}

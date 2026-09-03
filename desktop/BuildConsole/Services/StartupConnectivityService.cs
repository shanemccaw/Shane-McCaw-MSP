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
        public const string KeySettings   = "settings";
        public const string KeyWorkspace  = "workspace";
        public const string KeyGit        = "git";
        public const string KeyTests      = "tests";
        public const string KeyReplit     = "replit";
        public const string KeyBoard      = "board";
        public const string KeyInProgress = "inprogress";
        public const string KeyQueue      = "queue";
        public const string KeyDeploy     = "deploy";
        public const string KeyUsage      = "usage";
        /// <summary>#1882 — the real "the whole app shell has finished initializing" signal, beyond the network probes. Non-terminal until MainWindow calls <see cref="MarkShellReady"/> at the end of its deferred startup, so AllSettled (and thus the overlay dismiss) genuinely means "ready to use", not just "the connection probes finished".</summary>
        public const string KeyShell      = "shell";

        /// <summary>Per-HTTP-probe timeout. Below the client's own 20s so a single dead endpoint settles this row (as TimedOut) well before the global cap.</summary>
        private static readonly TimeSpan HttpProbeTimeout = TimeSpan.FromSeconds(15);

        /// <summary>Absolute ceiling from Start(): any connection still Pending/Connecting after this is force-settled to TimedOut so the splash always dismisses. Covers the observed usage meter, which has no timeout of its own we control here.</summary>
        private static readonly TimeSpan GlobalCap = TimeSpan.FromSeconds(20);

        // #1882 — no longer readonly / no longer ctor-injected: the service is created
        // the instant the window paints (so the overlay's rows appear first), and these
        // are handed in later via Start(), once MainWindow has actually constructed them.
        private BuildTrackerApiClient? _api;
        private ReplitWatcherService? _replitWatcher;
        private BuildQueuePostgresClient? _queueDb;
        private readonly List<StartupConnectionStatus> _ordered;
        private readonly Dictionary<string, StartupConnectionStatus> _byKey;
        private readonly object _gate = new();
        private bool _allSettledRaised;
        private bool _started;
        private Stopwatch? _shellSw;

        /// <summary>Ordered connection list — the view builds one row per entry, preserving this order.</summary>
        public IReadOnlyList<StartupConnectionStatus> Connections => _ordered;

        /// <summary>Raised on every per-connection transition, with the (mutated-in-place) status. May fire on a background thread — the view marshals.</summary>
        public event Action<StartupConnectionStatus>? ConnectionChanged;

        /// <summary>Raised exactly once, when every connection has reached a terminal state (or the global cap fired). May fire on a background thread.</summary>
        public event Action? AllSettled;

        public StartupConnectivityService()
        {
            _ordered = new List<StartupConnectionStatus>
            {
                new StartupConnectionStatus(KeySettings,   "Settings & credentials"),
                new StartupConnectionStatus(KeyWorkspace,  "Workspace files"),
                new StartupConnectionStatus(KeyGit,        "Git branch & status"),
                new StartupConnectionStatus(KeyTests,      "Test manifests"),
                new StartupConnectionStatus(KeyReplit,     "Replit dev server"),
                new StartupConnectionStatus(KeyBoard,      "GitHub board"),
                new StartupConnectionStatus(KeyInProgress, "In-flight issues"),
                new StartupConnectionStatus(KeyQueue,      "Build queue"),
                new StartupConnectionStatus(KeyDeploy,     "Deploy status"),
                new StartupConnectionStatus(KeyUsage,      "Claude usage"),
                // #1882 — the umbrella "app shell is actually ready" row, last in the
                // list. Stays non-terminal (Connecting) until MarkShellReady() so the
                // overlay never dismisses while real init is still running underneath.
                new StartupConnectionStatus(KeyShell,      "Application shell"),
            };
            _byKey = _ordered.ToDictionary(c => c.Key);
        }

        /// <summary>
        /// Kicks off all subsystem probes with the (now-constructed) services they need.
        /// Returns immediately — progress arrives via events. Idempotent.
        /// </summary>
        public void Start(BuildTrackerApiClient? api, ReplitWatcherService? replitWatcher = null, BuildQueuePostgresClient? queueDb = null)
        {
            lock (_gate)
            {
                if (_started) return;
                _started = true;
                _api = api;
                _replitWatcher = replitWatcher;
                _queueDb = queueDb;
                _shellSw = Stopwatch.StartNew();
            }

            ActivityLog.Log(Channel, "startup connectivity: probing real launch connections & subsystems…");

            // #1882 — the shell is now genuinely initializing; mark its row so the overlay
            // shows honest "starting subsystems…" until MarkShellReady() lands.
            Transition(KeyShell, StartupConnectionState.Connecting, "starting subsystems…");

            // 1. Settings & credentials
            _ = Task.Run(() =>
            {
                Transition(KeySettings, StartupConnectionState.Connecting, "validating config…");
                var sw = Stopwatch.StartNew();
                try
                {
                    var settings = BuildConsoleSettings.Load();
                    bool hasPat = settings.HasGitHubPat;
                    sw.Stop();
                    string detail = hasPat ? "PAT ready" : "no PAT (Settings)";
                    Transition(KeySettings, hasPat ? StartupConnectionState.Success : StartupConnectionState.Degraded, detail, sw.Elapsed);
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    Transition(KeySettings, StartupConnectionState.Failed, ex.Message, sw.Elapsed);
                }
            });

            // 2. Local Workspace files
            _ = Task.Run(() =>
            {
                Transition(KeyWorkspace, StartupConnectionState.Connecting, "scanning workspace…");
                var sw = Stopwatch.StartNew();
                try
                {
                    string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                    if (repoRoot != null && System.IO.Directory.Exists(repoRoot))
                    {
                        var dirCount = System.IO.Directory.GetDirectories(repoRoot).Length;
                        sw.Stop();
                        Transition(KeyWorkspace, StartupConnectionState.Success, $"{System.IO.Path.GetFileName(repoRoot)} ({dirCount} dirs)", sw.Elapsed);
                    }
                    else
                    {
                        sw.Stop();
                        Transition(KeyWorkspace, StartupConnectionState.Degraded, "repo root not found", sw.Elapsed);
                    }
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    Transition(KeyWorkspace, StartupConnectionState.Failed, ex.Message, sw.Elapsed);
                }
            });

            // 3. Git branch & status
            _ = Task.Run(() =>
            {
                Transition(KeyGit, StartupConnectionState.Connecting, "checking git status…");
                var sw = Stopwatch.StartNew();
                try
                {
                    string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                    if (repoRoot != null && System.IO.Directory.Exists(System.IO.Path.Combine(repoRoot, ".git")))
                    {
                        // Git #2539 — was a raw spawn that read stdout only and NEVER checked the
                        // exit code: a git.exe that crashed/aborted (empty stdout, an NTSTATUS exit
                        // code — the real ancient-git crash class this issue traced) fell straight
                        // into the parse loop and reported "main (clean)", a silent false success.
                        // SubprocessRunner retries a crash with backoff and, when it genuinely
                        // fails, we now surface an honest Degraded row instead of a fake-clean one.
                        var res = SubprocessRunner.Run("git", "status --porcelain -b", repoRoot,
                            TimeSpan.FromSeconds(3), Channel);
                        sw.Stop();

                        if (!res.Ok)
                        {
                            Transition(KeyGit, StartupConnectionState.Degraded, $"git status failed — {res.ShortError()}", sw.Elapsed);
                        }
                        else
                        {
                            string branch = "main";
                            int changed = 0;
                            var lines = res.StdOut.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                            foreach (var line in lines)
                            {
                                if (line.StartsWith("##"))
                                {
                                    string bLine = line.Substring(2).Trim();
                                    int dots = bLine.IndexOf("...");
                                    branch = dots > 0 ? bLine.Substring(0, dots) : bLine;
                                }
                                else if (line.Length >= 2)
                                {
                                    changed++;
                                }
                            }
                            string detail = changed == 0 ? $"{branch} (clean)" : $"{branch} ({changed} uncommitted)";
                            Transition(KeyGit, StartupConnectionState.Success, detail, sw.Elapsed);
                        }
                    }
                    else
                    {
                        sw.Stop();
                        Transition(KeyGit, StartupConnectionState.Skipped, "not a git repo", sw.Elapsed);
                    }
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    Transition(KeyGit, StartupConnectionState.Degraded, ex.Message, sw.Elapsed);
                }
            });

            // 4. Test Manifests
            _ = Task.Run(() =>
            {
                Transition(KeyTests, StartupConnectionState.Connecting, "indexing manifests…");
                var sw = Stopwatch.StartNew();
                try
                {
                    string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                    int count = 0;
                    int historyCount = 0;
                    if (repoRoot != null)
                    {
                        var dir = System.IO.Path.Combine(repoRoot, "test-manifests");
                        if (System.IO.Directory.Exists(dir))
                        {
                            count = System.IO.Directory.GetFiles(dir, "*.json", System.IO.SearchOption.AllDirectories)
                                .Count(f => !System.IO.Path.GetFileName(f).Equals("_regression-suite.json", StringComparison.OrdinalIgnoreCase));
                        }
                        var hist = TestHistoryStore.ReadAll(repoRoot);
                        historyCount = hist.Count;
                    }
                    sw.Stop();
                    string detail = count > 0 ? $"{count} manifests · {historyCount} test runs" : "no manifests found";
                    Transition(KeyTests, StartupConnectionState.Success, detail, sw.Elapsed);
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    Transition(KeyTests, StartupConnectionState.Degraded, ex.Message, sw.Elapsed);
                }
            });

            // 5. Replit dev server & services check / auto-start
            //
            // Git 2026-08-23 local-first move — Shane: "we can pause ALL the replit
            // stuff. I don't need it waking up anymore... When I'm ready to go to
            // Replit I press a deploy button." (see [[local-first-scope-replit-is-
            // manual-staging]] / StagingDeployService). Replit is the manually-deployed
            // Staging tier now, not something a local launch should reach out to or
            // wake on its own — ReplitWatcherEnabled defaults to false for exactly
            // this reason. This probe used to ignore that setting and unconditionally
            // check-and-wake Replit on every single app start, which is the "checking
            // connections to Replit" behind an otherwise local-only launch. Skipped
            // outright while the watcher is disabled; only probes/wakes when Shane has
            // explicitly turned it back on.
            _ = Task.Run(async () =>
            {
                var s = BuildConsoleSettings.Load();
                if (!s.ReplitWatcherEnabled)
                {
                    Transition(KeyReplit, StartupConnectionState.Skipped, "watcher off — local-first (Deploy to Staging when ready)");
                    return;
                }

                Transition(KeyReplit, StartupConnectionState.Connecting, "checking services…");
                var sw = Stopwatch.StartNew();
                try
                {
                    string appUrl = s.ReplitAppUrl;
                    if (string.IsNullOrWhiteSpace(appUrl))
                    {
                        sw.Stop();
                        Transition(KeyReplit, StartupConnectionState.Skipped, "no Replit URL configured", sw.Elapsed);
                        return;
                    }

                    // Check if Replit services are already responding
                    bool isUp = false;
                    using (var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(3) })
                    {
                        try
                        {
                            var resp = await http.GetAsync(appUrl);
                            isUp = (int)resp.StatusCode < 500;
                        }
                        catch { isUp = false; }
                    }

                    if (isUp)
                    {
                        sw.Stop();
                        Transition(KeyReplit, StartupConnectionState.Success, "services running · app up", sw.Elapsed);
                        return;
                    }

                    // If down, auto-start Replit services
                    Transition(KeyReplit, StartupConnectionState.Connecting, "starting Replit services…");
                    if (_replitWatcher != null)
                    {
                        bool wakeSuccess = await _replitWatcher.CheckNowAndWakeIfDownAsync();
                        sw.Stop();
                        if (wakeSuccess)
                        {
                            Transition(KeyReplit, StartupConnectionState.Success, "services started · app up", sw.Elapsed);
                        }
                        else
                        {
                            Transition(KeyReplit, StartupConnectionState.Degraded, "wake sequence completed", sw.Elapsed);
                        }
                    }
                    else
                    {
                        sw.Stop();
                        Transition(KeyReplit, StartupConnectionState.Degraded, "services down", sw.Elapsed);
                    }
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    Transition(KeyReplit, StartupConnectionState.Degraded, ex.Message, sw.Elapsed);
                }
            });

            // 5. Claude usage meter (in-flight state)
            Transition(KeyUsage, StartupConnectionState.Connecting, "reading meter…");

            // 6-9. Build Tracker endpoints
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

                // Build queue reads go direct to Neon Postgres when a DATABASE_URL
                // connection is available (same reasoning as every other queue
                // operation — see BuildQueuePostgresClient's class doc comment): no
                // reason for a launch probe to depend on the Replit-hosted API server
                // napping/waking just to report how many items are queued.
                if (_queueDb != null)
                    _ = ProbeAsync(KeyQueue, () => _queueDb.GetQueueAsync(),
                        r => Count(r.Count, "item") + " queued");
                else
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

        /// <summary>
        /// #1882 — MainWindow calls this once its full deferred startup (core services,
        /// panels, Home tab, background timers) has actually finished. It settles the
        /// umbrella <see cref="KeyShell"/> row, which is what lets <see cref="AllSettled"/>
        /// fire — so the overlay dismisses only when the app is genuinely ready to use,
        /// not merely when the network probes returned. Idempotent; safe from any thread.
        /// </summary>
        public void MarkShellReady()
        {
            TimeSpan? elapsed;
            lock (_gate)
            {
                if (_byKey.TryGetValue(KeyShell, out var cur) && IsTerminal(cur.State))
                    return; // already settled (e.g. the global cap forced it) — don't churn
                elapsed = _shellSw?.Elapsed;
            }
            Transition(KeyShell, StartupConnectionState.Success, "ready", elapsed);
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

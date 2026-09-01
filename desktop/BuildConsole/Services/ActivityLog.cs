using System;
using System.IO;
using System.Threading;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #815 — Shane: "put the startup SSE and api calls in there... so
    /// we can just look and see whats happening as its happening in the
    /// background. This should be multi-threaded so my app doesnt hang."
    /// Any thread (a background HTTP call, the poll timers, startup) can
    /// call Log() directly — it never touches WPF objects itself, just
    /// raises an event; MainWindow's own subscriber is the one that marshals
    /// onto the UI thread via Dispatcher.BeginInvoke (fire-and-forget, so
    /// the calling thread never blocks on the UI). Nothing here is a real
    /// Server-Sent-Events connection (no SSE endpoint exists on the
    /// build-tracker API today, just polling) — this just makes the polling
    /// and every request/response actually visible instead of silent.
    ///
    /// Epic #803/#911 follow-up — the in-memory event was NOT enough: a line
    /// logged before MainWindow subscribed (early startup) was dropped, and
    /// nothing survived a crash/restart, so a "which stage of the auto
    /// deploy+test chain silently didn't happen" bug could only be chased by a
    /// fresh live repro. Every line is now ALSO appended to a durable per-day
    /// log file under %AppData%\BuildConsole\logs\ (best-effort, never throws,
    /// independent of whether any UI subscriber exists yet), so the full
    /// build-completed → deploy-called → confirmed → tests-triggered trail is
    /// readable straight off disk after the fact.
    ///
    /// Git #2168 — the durable sink is a diagnostic system, and a diagnostic
    /// system that can die silently defeats its own purpose. The original
    /// AppendToFile swallowed EVERY write exception with no trace, took a
    /// single global lock across up to five synchronous file opens, and let
    /// the event-dispatch half of Log() throw back into its caller — so three
    /// distinct failures ("writes started throwing", "the lock is wedged", "a
    /// UI subscriber threw and killed the caller's timer") all presented
    /// identically: the log just stops, with nothing on disk saying why. This
    /// class now:
    ///   • guards BOTH halves of Log() so it is genuinely never-throws;
    ///   • writes each sink independently (one failing sink no longer skips
    ///     the others) with a short retry on transient sharing violations;
    ///   • SELF-REPORTS through fallback channels that do NOT depend on the
    ///     failing sink (a temp sentinel file, Trace, and the in-memory event)
    ///     whenever the write path breaks or recovers;
    ///   • runs its own watchdog heartbeat: a low-cadence liveness pulse the
    ///     logger itself emits, plus a silent probe that detects a wedged
    ///     _fileGate (via Monitor.TryEnter with a timeout) — the exact
    ///     deadlock the old code could never observe — and self-reports it;
    ///   • bounds the otherwise-unbounded activity-latest.log so a multi-
    ///     hundred-MB file can't slow appends into that same failure.
    /// The heartbeat's regular cadence is the authoritative "the logger is
    /// alive" signal: its ABSENCE unambiguously means the process/logger died,
    /// where a quiet stretch of ordinary lines only ever meant "nothing
    /// happened worth logging" — that ambiguity is what wasted the #2168
    /// investigation.
    /// </summary>
    public static class ActivityLog
    {
        public static event Action<string>? LineLogged;
        private static Dispatcher? _uiDispatcher;

        private static readonly object _fileGate = new();
        private static readonly string LogDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "logs");

        private static readonly string? WorkspaceLogDir;

        // ── #2168 self-report / self-heal state ─────────────────────────────
        private const long LatestLogCapBytes = 100L * 1024 * 1024; // bound activity-latest.log
        private static readonly TimeSpan WatchdogInterval = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan LockStallThreshold = TimeSpan.FromSeconds(5);

        private static readonly object _stateGate = new();
        private static long _successfulWrites;
        private static long _failedWrites;
        private static long _consecutiveFailures;
        private static volatile bool _writePathHealthy = true;
        private static string? _lastError;
        private static DateTime? _lastErrorUtc;
        private static DateTime? _lastSuccessfulWriteUtc;
        private static DateTime _lastHeartbeatUtc = DateTime.MinValue;
        private static readonly Timer _watchdog;

        static ActivityLog()
        {
            try
            {
                var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
                while (dir != null)
                {
                    if (Directory.Exists(Path.Combine(dir.FullName, ".git")) ||
                        File.Exists(Path.Combine(dir.FullName, ".git")) ||
                        File.Exists(Path.Combine(dir.FullName, "Shane-McCaw-MSP.sln")))
                    {
                        WorkspaceLogDir = Path.Combine(dir.FullName, ".logs");
                        break;
                    }
                    dir = dir.Parent;
                }
            }
            catch { }

            // Watchdog: an internal liveness pulse + wedged-lock detector the
            // logger owns itself, so its silence is diagnosable (#2168).
            _watchdog = new Timer(WatchdogTick, null, WatchdogInterval, WatchdogInterval);
        }

        public static void Attach(Dispatcher uiDispatcher) => _uiDispatcher = uiDispatcher;

        /// <summary>The durable log file the current day's lines are appended to in AppData.</summary>
        public static string CurrentLogFilePath =>
            Path.Combine(LogDir, $"activity-{DateTime.Now:yyyy-MM-dd}.log");

        /// <summary>The durable log file in the repository .logs directory for AI agents and IDE inspection.</summary>
        public static string? CurrentWorkspaceLogFilePath =>
            WorkspaceLogDir != null ? Path.Combine(WorkspaceLogDir, $"activity-{DateTime.Now:yyyy-MM-dd}.log") : null;

        public static void Log(string channel, string message)
        {
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] [{channel}] {message}";

            // Durable sink FIRST — independent of any UI subscriber, so a line logged
            // before MainWindow attaches (or after a crash starts unwinding) is still
            // captured. Best-effort: a failed write must never disturb the caller.
            AppendToFile(line);

            // Event-dispatch half is now ALSO guarded (#2168): a throwing UI
            // subscriber on the synchronous (UI-thread caller) path used to
            // propagate back into whatever timer called Log(), which could kill
            // that timer and make the log go silent for reasons nothing recorded.
            RaiseLineLogged(line);
        }

        private static void RaiseLineLogged(string line)
        {
            try
            {
                var handler = LineLogged;
                if (handler == null) return;
                var dispatcher = _uiDispatcher;
                if (dispatcher != null && !dispatcher.CheckAccess())
                {
                    dispatcher.BeginInvoke(handler, line);
                }
                else
                {
                    handler(line);
                }
            }
            catch
            {
                // A subscriber (e.g. a WPF control being torn down at shutdown)
                // must never take down the thread that called Log(). Swallow —
                // the durable sink already captured the line.
            }
        }

        private static void AppendToFile(string line)
        {
            var payload = line + Environment.NewLine;
            bool anyWritten = false;
            bool anyFailed = false;
            Exception? firstError = null;

            lock (_fileGate)
            {
                // Each sink is written independently: a failure of one (say the
                // repo .logs junction is gone) must not skip the AppData copy,
                // and vice versa. Previously a single try wrapped all of them,
                // so the first throw silently dropped every remaining sink.

                // 1. AppData per-day log — the primary durable record.
                if (TryAppend(LogDir, CurrentLogFilePath, payload, ref firstError)) anyWritten = true;
                else anyFailed = true;

                // 2. Workspace repository .logs for local AI agents & tools.
                if (WorkspaceLogDir != null)
                {
                    var dayFile = Path.Combine(WorkspaceLogDir, $"activity-{DateTime.Now:yyyy-MM-dd}.log");
                    if (TryAppend(WorkspaceLogDir, dayFile, payload, ref firstError)) anyWritten = true;
                    else anyFailed = true;

                    var latest = Path.Combine(WorkspaceLogDir, "activity-latest.log");
                    TryCapLatest(latest);
                    if (TryAppend(WorkspaceLogDir, latest, payload, ref firstError)) anyWritten = true;
                    else anyFailed = true;
                }
            }

            // Health accounting + self-report happen OUTSIDE the lock so they
            // can never contribute to holding it.
            if (anyWritten)
            {
                Interlocked.Increment(ref _successfulWrites);
                OnWriteOutcome(success: true, error: null);
            }
            if (anyFailed && !anyWritten)
            {
                // Every sink failed — the durable record just went dark. This is
                // exactly the #2168 silent death; leave a trace instead of none.
                Interlocked.Increment(ref _failedWrites);
                OnWriteOutcome(success: false, error: firstError);
            }
        }

        /// <summary>
        /// Appends to one sink, tolerating transient sharing violations (an
        /// editor/tail viewer/AV briefly holding the file) with a bounded retry.
        /// Opens with FileShare.ReadWrite so our own writes never lock readers
        /// out. Returns false and reports the exception rather than throwing.
        /// </summary>
        private static bool TryAppend(string dir, string path, string payload, ref Exception? firstError)
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    Directory.CreateDirectory(dir);
                    using var fs = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                    using var sw = new StreamWriter(fs);
                    sw.Write(payload);
                    return true;
                }
                catch (IOException ex)
                {
                    // Transient (sharing violation / momentary lock): brief backoff
                    // and retry. Bounded so a permanent failure returns fast and
                    // self-reports rather than blocking the lock indefinitely.
                    firstError ??= ex;
                    Thread.Sleep(20);
                }
                catch (Exception ex)
                {
                    // Permissions, path, disk — not worth retrying.
                    firstError ??= ex;
                    return false;
                }
            }
            return false;
        }

        /// <summary>
        /// Bounds activity-latest.log (a convenience "everything, newest at the
        /// bottom" file that otherwise grows without limit — it was 424 MB when
        /// #2168 was filed). Keeps one prior generation so recent history isn't
        /// lost, and the rename is O(1) regardless of size.
        /// </summary>
        private static void TryCapLatest(string latest)
        {
            try
            {
                var info = new FileInfo(latest);
                if (info.Exists && info.Length > LatestLogCapBytes)
                {
                    var prev = latest + ".prev";
                    File.Move(latest, prev, overwrite: true);
                }
            }
            catch
            {
                // Rotation is best-effort; failing it must not stop the append.
            }
        }

        private static void OnWriteOutcome(bool success, Exception? error)
        {
            bool transitionedToBroken = false;
            bool transitionedToHealthy = false;
            long failuresAtBreak = 0;

            lock (_stateGate)
            {
                if (success)
                {
                    _lastSuccessfulWriteUtc = DateTime.UtcNow;
                    if (!_writePathHealthy)
                    {
                        transitionedToHealthy = true;
                        failuresAtBreak = _consecutiveFailures;
                    }
                    _consecutiveFailures = 0;
                    _writePathHealthy = true;
                }
                else
                {
                    _consecutiveFailures++;
                    _lastError = error?.Message ?? "unknown write failure";
                    _lastErrorUtc = DateTime.UtcNow;
                    if (_writePathHealthy)
                    {
                        transitionedToBroken = true;
                        failuresAtBreak = _consecutiveFailures;
                    }
                    _writePathHealthy = false;
                }
            }

            if (transitionedToBroken)
            {
                SelfReport($"WRITE PATH BROKEN — every durable sink is failing. First error: {error?.GetType().Name}: {error?.Message}");
            }
            else if (transitionedToHealthy)
            {
                SelfReport($"write path RECOVERED after {failuresAtBreak} consecutive failure(s).");
            }
        }

        /// <summary>
        /// Leaves a trace of a logging-system failure through channels that do
        /// NOT depend on the sink that just failed: a sentinel file in the temp
        /// dir (different location, may be a different volume), the debugger's
        /// Trace stream, and the in-memory event so any live UI shows it. This
        /// is the whole point of #2168 — the diagnostic system reporting its
        /// own death instead of vanishing without a word.
        /// </summary>
        private static void SelfReport(string what)
        {
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] [activity-log.SELF] {what}";

            try { System.Diagnostics.Trace.WriteLine(line); } catch { }

            try
            {
                var sentinel = Path.Combine(Path.GetTempPath(), "BuildConsole-activitylog-failures.log");
                File.AppendAllText(sentinel, line + Environment.NewLine);
            }
            catch { }

            // Route back through the durable sink too — harmless when the sink
            // is healthy (a recovery notice), and on the broken→healthy edge it
            // lands the recovery notice in the real log.
            try { AppendToFileBestEffort(line + Environment.NewLine); } catch { }

            RaiseLineLogged(line);
        }

        /// <summary>A no-accounting durable write used only by SelfReport, so a
        /// self-report can't recurse back into OnWriteOutcome/SelfReport.</summary>
        private static void AppendToFileBestEffort(string payload)
        {
            Exception? ignore = null;
            lock (_fileGate)
            {
                TryAppend(LogDir, CurrentLogFilePath, payload, ref ignore);
                if (WorkspaceLogDir != null)
                {
                    TryAppend(WorkspaceLogDir, Path.Combine(WorkspaceLogDir, $"activity-{DateTime.Now:yyyy-MM-dd}.log"), payload, ref ignore);
                }
            }
        }

        private static void WatchdogTick(object? _)
        {
            try
            {
                // Detect a WEDGED _fileGate. If the lock is held past the stall
                // threshold, some Log() is stuck inside a file op (network stall,
                // AV, a genuine hang) — the deadlock the old code could never see.
                // We report it WITHOUT needing the lock, since SelfReport's
                // fallback channels don't take _fileGate.
                if (!Monitor.TryEnter(_fileGate, LockStallThreshold))
                {
                    SelfReport($"WRITE PATH STALLED — _fileGate held > {LockStallThreshold.TotalSeconds:0}s; a write is wedged (possible deadlock/hang).");
                    return;
                }

                bool probeOk;
                Exception? probeErr = null;
                try
                {
                    // Silent probe: prove the primary sink dir is writable without
                    // spamming the log every 60s. Overwrite a tiny probe file.
                    Directory.CreateDirectory(LogDir);
                    File.WriteAllText(Path.Combine(LogDir, "activity-probe.tmp"),
                        DateTime.UtcNow.ToString("O"));
                    probeOk = true;
                }
                catch (Exception ex)
                {
                    probeErr = ex;
                    probeOk = false;
                }
                finally
                {
                    Monitor.Exit(_fileGate);
                }

                OnWriteOutcome(probeOk, probeErr);

                // Positive liveness pulse at a low cadence. Its regular presence
                // is the authoritative "logger is alive"; its absence is the
                // authoritative "logger/process died" — no more guessing whether
                // a quiet stretch meant death or merely nothing to say.
                if (DateTime.UtcNow - _lastHeartbeatUtc >= HeartbeatInterval)
                {
                    _lastHeartbeatUtc = DateTime.UtcNow;
                    var health = GetHealth();
                    Log("activity-log.heartbeat",
                        $"alive — {health.SuccessfulWrites} writes ok, {health.FailedWrites} failed, healthy={health.Healthy}");
                }
            }
            catch
            {
                // The watchdog itself must never throw onto the thread-pool.
            }
        }

        /// <summary>Snapshot of the durable sink's own health, for a UI/health surface.</summary>
        public static ActivityLogHealth GetHealth()
        {
            lock (_stateGate)
            {
                return new ActivityLogHealth
                {
                    Healthy = _writePathHealthy,
                    SuccessfulWrites = Interlocked.Read(ref _successfulWrites),
                    FailedWrites = Interlocked.Read(ref _failedWrites),
                    ConsecutiveFailures = _consecutiveFailures,
                    LastError = _lastError,
                    LastErrorUtc = _lastErrorUtc,
                    LastSuccessfulWriteUtc = _lastSuccessfulWriteUtc,
                    LastHeartbeatUtc = _lastHeartbeatUtc == DateTime.MinValue ? (DateTime?)null : _lastHeartbeatUtc
                };
            }
        }
    }

    /// <summary>Health snapshot of <see cref="ActivityLog"/>'s own durable write path (#2168).</summary>
    public sealed class ActivityLogHealth
    {
        public bool Healthy { get; set; }
        public long SuccessfulWrites { get; set; }
        public long FailedWrites { get; set; }
        public long ConsecutiveFailures { get; set; }
        public string? LastError { get; set; }
        public DateTime? LastErrorUtc { get; set; }
        public DateTime? LastSuccessfulWriteUtc { get; set; }
        public DateTime? LastHeartbeatUtc { get; set; }
    }
}

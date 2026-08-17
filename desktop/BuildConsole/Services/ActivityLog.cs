using System;
using System.IO;
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
    /// </summary>
    public static class ActivityLog
    {
        public static event Action<string>? LineLogged;
        private static Dispatcher? _uiDispatcher;

        private static readonly object _fileGate = new();
        private static readonly string LogDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "logs");

        private static readonly string? WorkspaceLogDir;

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

            var handler = LineLogged;
            if (handler == null) return;
            if (_uiDispatcher != null && !_uiDispatcher.CheckAccess())
            {
                _uiDispatcher.BeginInvoke(handler, line);
            }
            else
            {
                handler(line);
            }
        }

        private static void AppendToFile(string line)
        {
            try
            {
                lock (_fileGate)
                {
                    // 1. AppData per-day log
                    Directory.CreateDirectory(LogDir);
                    File.AppendAllText(CurrentLogFilePath, line + Environment.NewLine);

                    // 2. Workspace repository .logs for local AI agents & tools
                    if (WorkspaceLogDir != null)
                    {
                        Directory.CreateDirectory(WorkspaceLogDir);
                        File.AppendAllText(Path.Combine(WorkspaceLogDir, $"activity-{DateTime.Now:yyyy-MM-dd}.log"), line + Environment.NewLine);
                        File.AppendAllText(Path.Combine(WorkspaceLogDir, "activity-latest.log"), line + Environment.NewLine);
                    }
                }
            }
            catch
            {
                // A log file we can't write to (disk full, locked, permissions) must
                // never take down the app or the calling background thread. Swallow.
            }
        }
    }
}

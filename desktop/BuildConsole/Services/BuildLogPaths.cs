using System.IO;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #802 — shared path convention with scripts/build-queue-watcher.ps1.
    /// Both sides compute the same path from a queue item's id alone (no
    /// server round-trip needed to discover it): %TEMP%\bt-build-queue-logs\queue-{id}.log.
    /// The watcher writes it (via -RedirectStandardOutput, stderr folded in
    /// on completion); this app polls/tails it for a chat tab's build split pane.
    /// </summary>
    public static class BuildLogPaths
    {
        /// <summary>
        /// Git #1876 — the shared directory both sides write/read under, exposed so
        /// callers that need to reason about "which ids have a log" (a directory
        /// listing) don't have to re-derive it from <see cref="ForQueueItem"/>.
        /// </summary>
        public static string LogDirectory => Path.Combine(Path.GetTempPath(), "bt-build-queue-logs");

        public static string ForQueueItem(int id) =>
            Path.Combine(LogDirectory, $"queue-{id}.log");
    }
}

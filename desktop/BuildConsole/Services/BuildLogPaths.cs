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
        public static string ForQueueItem(int id) =>
            Path.Combine(Path.GetTempPath(), "bt-build-queue-logs", $"queue-{id}.log");
    }
}

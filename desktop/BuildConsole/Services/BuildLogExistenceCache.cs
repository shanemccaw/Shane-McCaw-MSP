using System;
using System.Collections.Generic;
using System.IO;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1876 — "does a real log file exist for this queue item" answers the
    /// Build Queue panel's per-card corner dot (see BuildQueuePanel.BuildQueueCard).
    /// A build with a log genuinely started running at some point, independent of
    /// bookend/DB status — the most reliable "actually launched" signal per that
    /// issue's investigation into crash-orphaned builds.
    ///
    /// RenderQueue rebuilds every card on each 15s poll tick (plus assorted
    /// on-demand refreshes), and hundreds of items can be queued at once — a
    /// synchronous File.Exists per card, per render would be hundreds of individual
    /// filesystem stats every tick. Instead this does ONE Directory.EnumerateFiles
    /// listing of BuildLogPaths.LogDirectory, cached for a short TTL, and every
    /// card's lookup becomes an in-memory HashSet.Contains.
    /// </summary>
    public static class BuildLogExistenceCache
    {
        private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(5);
        private static readonly object Lock = new();
        private static HashSet<int> _idsWithLogs = new();
        private static DateTime _lastRefreshUtc = DateTime.MinValue;

        /// <summary>True if a real stdout log file currently exists for this queue item id.</summary>
        public static bool HasLog(int queueItemId)
        {
            EnsureFresh();
            lock (Lock)
            {
                return _idsWithLogs.Contains(queueItemId);
            }
        }

        /// <summary>The real log path, for a tooltip — only meaningful when <see cref="HasLog"/> is true.</summary>
        public static string PathFor(int queueItemId) => BuildLogPaths.ForQueueItem(queueItemId);

        private static void EnsureFresh()
        {
            lock (Lock)
            {
                if (DateTime.UtcNow - _lastRefreshUtc < Ttl) return;
            }

            var found = new HashSet<int>();
            bool listedOk = false;
            try
            {
                var dir = BuildLogPaths.LogDirectory;
                if (Directory.Exists(dir))
                {
                    foreach (var file in Directory.EnumerateFiles(dir, "queue-*.log"))
                    {
                        var name = Path.GetFileNameWithoutExtension(file);
                        if (name.StartsWith("queue-", StringComparison.Ordinal) &&
                            int.TryParse(name.AsSpan("queue-".Length), out var id))
                        {
                            found.Add(id);
                        }
                    }
                }
                listedOk = true;
            }
            catch (IOException)
            {
                // Transient — fall through and keep the previous snapshot below.
            }
            catch (UnauthorizedAccessException)
            {
                // Same — this is a quiet diagnostic dot, never worth surfacing an error for.
            }

            lock (Lock)
            {
                // Always bump the timestamp, even on failure — a persistent error (e.g.
                // permission denied) must not turn this back into a per-call listing.
                _lastRefreshUtc = DateTime.UtcNow;
                if (listedOk) _idsWithLogs = found;
            }
        }
    }
}

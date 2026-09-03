using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2691 — every #NNN mention number <see cref="IssueMentionInjector"/> has ever eagerly
    /// colored, across every open chat surface: MainWindow's ClaudeWebView + embedded chat tabs,
    /// and the floating chat window's own tabs. <c>BT_ISSUE_MENTIONS_SCAN</c> only reports the
    /// NEW delta per page-load (Git #2066's per-page <c>_reportedMentionNums</c>), so point 3's
    /// live-queue-state re-push — driven by <see cref="Controls.BuildQueuePanel.QueueRefreshed"/>,
    /// not a chat-text mutation — needs this accumulated set to know which numbers are actually
    /// on screen somewhere and worth recoloring, since the delta-only set would miss every number
    /// already resolved on an earlier scan. In-memory only, process-lifetime; a page reload's
    /// first scan simply re-adds whatever it finds.
    /// </summary>
    internal static class LiveMentionNumberRegistry
    {
        private static readonly HashSet<int> _numbers = new();
        private static readonly object _lock = new();

        public static void Track(IEnumerable<int> numbers)
        {
            lock (_lock)
            {
                foreach (var n in numbers) _numbers.Add(n);
            }
        }

        public static List<int> Snapshot()
        {
            lock (_lock)
            {
                return _numbers.ToList();
            }
        }
    }
}

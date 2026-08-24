using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Windows;

namespace BuildConsole.Services
{
    public class ProgressStepEntry
    {
        public int Step { get; set; }
        public int Total { get; set; }
        public string Label { get; set; } = string.Empty;
        public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
        public TimeSpan ElapsedSinceStart { get; set; }
        public bool IsCurrent { get; set; }
    }

    public class BuildProgressReport
    {
        public int QueueItemId { get; set; }
        public int Step { get; set; }
        public int Total { get; set; }
        public string CurrentLabel { get; set; } = string.Empty;
        public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime LastReportedAtUtc { get; set; } = DateTime.UtcNow;
        public List<ProgressStepEntry> History { get; } = new();

        public double Percent => Total > 0 ? Math.Clamp((double)Step / Total * 100.0, 0, 100) : 0;

        /// <summary>True once the last reported step reached the total — a finished build is never "stale".</summary>
        public bool IsComplete => Total > 0 && Step >= Total;

        /// <summary>Wall-clock time since the most recent reportProgress call for this build landed.</summary>
        public TimeSpan TimeSinceLastReport => DateTime.UtcNow - LastReportedAtUtc;

        /// <summary>
        /// Git #1206 — how long a running (incomplete) build may go without a new reportProgress
        /// call before Build Watch surfaces a soft "no update in Xm" notice. This does not force an
        /// agent to report; it just makes a quiet panel read as honestly-stale instead of looking
        /// frozen on its first phase with no signal anything is wrong.
        /// </summary>
        public static readonly TimeSpan StaleThreshold = TimeSpan.FromMinutes(3);

        /// <summary>
        /// True when this build is still in progress yet hasn't reported a new step in longer than
        /// <see cref="StaleThreshold"/>. Complete builds are never stale.
        /// </summary>
        public bool IsStale => !IsComplete && Total > 0 && TimeSinceLastReport >= StaleThreshold;

        /// <summary>Human-readable "no progress update in Xm" text for the stale notice (only meaningful when <see cref="IsStale"/>).</summary>
        public string StalenessText
        {
            get
            {
                var ago = TimeSinceLastReport;
                if (ago.TotalHours >= 1)
                    return $"No progress update in {(int)ago.TotalHours}h {ago.Minutes}m";
                if (ago.TotalMinutes >= 1)
                    return $"No progress update in {(int)ago.TotalMinutes}m";
                return $"No progress update in {Math.Max(1, (int)ago.TotalSeconds)}s";
            }
        }

        public TimeSpan? EstimatedRemaining
        {
            get
            {
                if (Step <= 0 || Total <= Step) return null;
                var elapsed = LastReportedAtUtc - StartedAtUtc;
                if (elapsed.TotalSeconds < 5) return null; // need minimal baseline

                double msPerStep = elapsed.TotalMilliseconds / Step;
                double remainingMs = msPerStep * (Total - Step);
                return TimeSpan.FromMilliseconds(remainingMs);
            }
        }

        public string EstimatedRemainingText
        {
            get
            {
                if (Step >= Total && Total > 0) return "Complete";
                var rem = EstimatedRemaining;
                if (!rem.HasValue) return "Calculating est…";

                if (rem.Value.TotalHours >= 1)
                    return $"~{(int)rem.Value.TotalHours}h {rem.Value.Minutes}m remaining (est.)";
                if (rem.Value.TotalMinutes >= 1)
                    return $"~{(int)rem.Value.TotalMinutes}m {rem.Value.Seconds}s remaining (est.)";
                return $"~{Math.Max(1, (int)rem.Value.TotalSeconds)}s remaining (est.)";
            }
        }
    }

    /// <summary>
    /// Explicit progress tracking for running builds reporting via shaneapp://reportProgress or scripts/report-progress.mjs.
    /// Replaces brittle text parsing and heuristic checklist extraction.
    /// </summary>
    public static class BuildProgressTracker
    {
        public const string LogChannel = "build.progress";

        private static readonly ConcurrentDictionary<int, BuildProgressReport> _reports = new();

        public static event Action<BuildProgressReport>? ProgressChanged;

        public static BuildProgressReport? GetProgress(int queueItemId)
        {
            _reports.TryGetValue(queueItemId, out var report);
            return report;
        }

        public static BuildProgressReport Report(int queueItemId, int step, int total, string label)
        {
            var report = _reports.GetOrAdd(queueItemId, id => new BuildProgressReport
            {
                QueueItemId = id,
                StartedAtUtc = DateTime.UtcNow
            });

            report.Step = step;
            report.Total = Math.Max(total, step);
            report.CurrentLabel = label?.Trim() ?? string.Empty;
            report.LastReportedAtUtc = DateTime.UtcNow;

            // Mark previous steps in history as not current
            foreach (var h in report.History) h.IsCurrent = false;

            // Add step to history if not duplicate of last step
            if (report.History.Count == 0 || report.History[^1].Step != step || report.History[^1].Label != report.CurrentLabel)
            {
                report.History.Add(new ProgressStepEntry
                {
                    Step = step,
                    Total = report.Total,
                    Label = report.CurrentLabel,
                    TimestampUtc = DateTime.UtcNow,
                    ElapsedSinceStart = report.LastReportedAtUtc - report.StartedAtUtc,
                    IsCurrent = true
                });
            }
            else if (report.History.Count > 0)
            {
                report.History[^1].IsCurrent = true;
            }

            string est = report.EstimatedRemainingText;
            ActivityLog.Log(LogChannel,
                $"[reportProgress] build #{queueItemId}: step {step}/{report.Total} ({report.Percent:0}%) — '{report.CurrentLabel}' [{est}]");

            // Dispatch event onto UI thread
            if (Application.Current?.Dispatcher != null)
            {
                Application.Current.Dispatcher.BeginInvoke(() => ProgressChanged?.Invoke(report));
            }
            else
            {
                ProgressChanged?.Invoke(report);
            }

            return report;
        }

        public static void ClearForBuild(int queueItemId)
        {
            _reports.TryRemove(queueItemId, out _);
        }

        public static void ClearAll()
        {
            _reports.Clear();
        }
    }
}

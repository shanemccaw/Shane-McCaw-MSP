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
